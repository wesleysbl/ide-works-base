/**
 * O rascunho do formulário longo — F19c, refeito na F17.AUD02.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   Cada caso aqui é um jeito de o rascunho causar dano em vez de evitar:
 *   oferecer o rascunho de OUTRO cliente, oferecer o de OUTRA PESSOA depois de
 *   trocar de conta na mesma aba (achado 2 da auditoria de 09/09/2026),
 *   oferecer um de ontem como se fosse de agora, ou derrubar o formulário
 *   porque o navegador bloqueou armazenamento.
 *
 *   O último é o que mais importa: um rascunho que quebra a tela é pior que
 *   rascunho nenhum, e é o único que não aparece na máquina de quem
 *   desenvolveu.
 *
 * A SESSÃO É SIMULADA POR `assumirDono`
 *   Na tela, quem chama é `useSessao` com o id de `/auth/me`. Aqui o teste
 *   diz quem está na aba — e prova que, sem isso, nada se lê nem se grava.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Ficha,
  apagarRascunho,
  assumirDono,
  avisarOutrasAbas,
  chaveDaFicha,
  donoConfirmado,
  esquecerDono,
  guardarRascunho,
  lerRascunho,
  limparAoSair,
  quandoFoi,
  vigiarOutrasAbas,
} from '@/ui/rascunho';

/** Um `Storage` de mentira, para o teste não depender de navegador. */
function cofreDeMentira() {
  const mapa = new Map<string, string>();
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
    key: (i: number) => [...mapa.keys()][i] ?? null,
    get length() {
      return mapa.size;
    },
  } as Storage;
}

/** As chaves guardadas, para provar o que ficou e o que foi embora. */
const chavesGuardadas = (): string[] => {
  const s = window.sessionStorage;
  const chaves: string[] = [];
  for (let i = 0; i < s.length; i += 1) chaves.push(s.key(i) as string);
  return chaves.sort();
};

const fichaDe = (usuario: string, id: string | null = null): Ficha => ({
  usuario,
  tipo: 'cliente',
  id,
});

const A = fichaDe('ana');
const B = fichaDe('bia');

/** A chave e o conteúdo do formato ANTERIOR à F17.AUD02: sem dono, sem versão. */
const CHAVE_LEGADA = 'ideworks:rascunho:cliente:novo';
const CONTEUDO_LEGADO = JSON.stringify({
  valor: { name: 'Clínica da rua de cima', taxId: '12.345.678/0001-90' },
  guardadoEm: new Date().toISOString(),
});

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: cofreDeMentira(), localStorage: cofreDeMentira() });
  esquecerDono();
});
afterEach(() => {
  esquecerDono();
  vi.unstubAllGlobals();
});

describe('a chave separa uma ficha da outra — e um dono do outro', () => {
  it('cliente novo e cliente existente não se misturam', () => {
    expect(chaveDaFicha(fichaDe('ana', null))).not.toBe(chaveDaFicha(fichaDe('ana', 'abc')));
  });

  it('cada cliente tem a sua', () => {
    // O pior defeito possível num cadastro: abrir a ficha de um e ver o
    // rascunho de outro. Com uma chave só, é o comportamento padrão.
    expect(chaveDaFicha(fichaDe('ana', 'abc'))).not.toBe(chaveDaFicha(fichaDe('ana', 'def')));
  });

  it('a mesma ficha tem uma chave por pessoa', () => {
    expect(chaveDaFicha(A)).not.toBe(chaveDaFicha(B));
  });

  it('a chave nova não é a chave antiga', () => {
    // Se fosse, o rascunho sem dono de antes da publicação seria lido como
    // se fosse de quem abrir a ficha primeiro.
    expect(chaveDaFicha(A)).not.toBe(CHAVE_LEGADA);
  });
});

describe('sem dono confirmado, nada acontece', () => {
  it('não há dono até a sessão dizer quem é', () => {
    expect(donoConfirmado()).toBeNull();
  });

  it('guardar sem dono não grava', () => {
    guardarRascunho(A, { nome: 'x' });
    expect(chavesGuardadas()).toEqual([]);
  });

  /**
   * Um registro VÁLIDO no formato atual, escrito por fora. Só a porta de dono
   * pode recusá-lo — a validação de conteúdo o aceitaria. É o que prova que a
   * porta existe: com um registro incompleto, o teste passaria sem ela.
   */
  const registroValidoDe = (ficha: Ficha, valor: unknown) =>
    JSON.stringify({
      versao: 2,
      usuario: ficha.usuario,
      ficha: `${ficha.tipo}:${ficha.id ?? 'novo'}`,
      valor,
      guardadoEm: new Date().toISOString(),
    });

  it('ler sem dono devolve nulo, mesmo com um registro válido lá', () => {
    assumirDono('ana');
    guardarRascunho(A, { nome: 'x' });
    esquecerDono();
    // `esquecerDono` já apagou — mas o ponto aqui é a PORTA: se algo tivesse
    // ficado, ainda assim não seria lido.
    window.sessionStorage.setItem(chaveDaFicha(A), registroValidoDe(A, { nome: 'x' }));
    expect(lerRascunho(A)).toBeNull();
    // A prova de que era a porta, e não o conteúdo: com o dono de volta, lê.
    assumirDono('ana');
    expect(lerRascunho<{ nome: string }>(A)?.valor).toEqual({ nome: 'x' });
  });

  it('ler a ficha de A com OUTRO dono confirmado devolve nulo, mesmo com registro válido de A lá', () => {
    // A ficha de A ainda montada quando a sessão desta aba já é de B — e algo
    // de A sobreviveu à varredura (ou foi escrito depois dela).
    assumirDono('bia');
    window.sessionStorage.setItem(chaveDaFicha(A), registroValidoDe(A, { nome: 'de ana' }));
    expect(lerRascunho(A)).toBeNull();
  });

  it('guardar para um dono que não é o confirmado não grava', () => {
    // O temporizador atrasado da ficha de A, disparando depois de B entrar.
    assumirDono('bia');
    guardarRascunho(A, { nome: 'de ana' });
    expect(chavesGuardadas()).toEqual([]);
  });
});

describe('guardar e ler', () => {
  beforeEach(() => assumirDono('ana'));

  it('devolve o que foi guardado', () => {
    guardarRascunho(A, { nome: 'Clínica' });
    expect(lerRascunho<{ nome: string }>(A)?.valor).toEqual({ nome: 'Clínica' });
  });

  it('devolve nulo quando não há nada', () => {
    expect(lerRascunho(fichaDe('ana', 'nunca-guardado'))).toBeNull();
  });

  it('apagar remove de verdade', () => {
    guardarRascunho(A, { nome: 'x' });
    apagarRascunho(A);
    expect(lerRascunho(A)).toBeNull();
  });

  it('registra QUANDO foi guardado — é o que a tela mostra', () => {
    guardarRascunho(A, { nome: 'x' });
    expect(lerRascunho(A)?.guardadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('o conteúdo diz de quem é e de qual ficha — versionado', () => {
    guardarRascunho(fichaDe('ana', 'c1'), { nome: 'x' });
    const r = lerRascunho(fichaDe('ana', 'c1'));
    expect(r).toMatchObject({ versao: 2, usuario: 'ana', ficha: 'cliente:c1' });
  });
});

describe('isolamento entre pessoas — achado 2 da auditoria', () => {
  it('sair como A e entrar como B na mesma aba não oferece o rascunho de A', () => {
    assumirDono('ana');
    guardarRascunho(A, { nome: 'da Ana' });

    limparAoSair();
    assumirDono('bia');

    expect(lerRascunho(B)).toBeNull();
    expect(lerRascunho(A)).toBeNull();
    expect(chavesGuardadas()).toEqual([]);
  });

  it('a troca de identidade SEM saída explícita também limpa o que era de A', () => {
    // A sessão de A venceu; B entrou na mesma aba. Não houve `Sair`.
    assumirDono('ana');
    guardarRascunho(A, { nome: 'da Ana' });

    assumirDono('bia');
    expect(chavesGuardadas()).toEqual([]);
    expect(lerRascunho(B)).toBeNull();
  });

  it('confirmar o MESMO dono de novo não apaga o que é dele', () => {
    assumirDono('ana');
    guardarRascunho(A, { nome: 'da Ana' });
    assumirDono('ana');
    expect(lerRascunho<{ nome: string }>(A)?.valor).toEqual({ nome: 'da Ana' });
  });

  it('o rascunho de B não é lido pela ficha de A, mesmo com o dono B confirmado', () => {
    assumirDono('bia');
    guardarRascunho(B, { nome: 'da Bia' });
    expect(lerRascunho(A)).toBeNull();
  });
});

describe('o formato antigo, sem dono, é inválido — e não é adotado por ninguém', () => {
  it('confirmar um dono apaga a chave legada', () => {
    window.sessionStorage.setItem(CHAVE_LEGADA, CONTEUDO_LEGADO);
    assumirDono('ana');
    expect(window.sessionStorage.getItem(CHAVE_LEGADA)).toBeNull();
  });

  it('a chave legada nunca é oferecida como sendo do usuário atual', () => {
    window.sessionStorage.setItem(CHAVE_LEGADA, CONTEUDO_LEGADO);
    assumirDono('ana');
    expect(lerRascunho(A)).toBeNull();
  });

  it('conteúdo sem versão na chave nova some em vez de ser lido', () => {
    assumirDono('ana');
    window.sessionStorage.setItem(chaveDaFicha(A), CONTEUDO_LEGADO);
    expect(lerRascunho(A)).toBeNull();
    expect(window.sessionStorage.getItem(chaveDaFicha(A))).toBeNull();
  });

  it('conteúdo que diz ser de outra pessoa some em vez de ser lido', () => {
    assumirDono('ana');
    window.sessionStorage.setItem(
      chaveDaFicha(A),
      JSON.stringify({
        versao: 2,
        usuario: 'bia',
        ficha: 'cliente:novo',
        valor: { nome: 'x' },
        guardadoEm: new Date().toISOString(),
      }),
    );
    expect(lerRascunho(A)).toBeNull();
    expect(window.sessionStorage.getItem(chaveDaFicha(A))).toBeNull();
  });

  it('conteúdo de outra ficha sob esta chave também some', () => {
    assumirDono('ana');
    window.sessionStorage.setItem(
      chaveDaFicha(A),
      JSON.stringify({
        versao: 2,
        usuario: 'ana',
        ficha: 'cliente:outra',
        valor: { nome: 'x' },
        guardadoEm: new Date().toISOString(),
      }),
    );
    expect(lerRascunho(A)).toBeNull();
  });
});

describe('o rascunho velho não volta', () => {
  beforeEach(() => assumirDono('ana'));

  it('doze horas ainda vale', () => {
    guardarRascunho(A, { nome: 'x' });
    const daquiA11h = new Date(Date.now() + 11 * 3_600_000);
    expect(lerRascunho(A, daquiA11h)).not.toBeNull();
  });

  it('treze horas já não vale', () => {
    // Quem abandonou o formulário ontem não vai voltar para terminá-lo, e
    // oferecer aquilo faz a pessoa duvidar do que está salvo.
    guardarRascunho(A, { nome: 'x' });
    const daquiA13h = new Date(Date.now() + 13 * 3_600_000);
    expect(lerRascunho(A, daquiA13h)).toBeNull();
  });

  it('e some sozinho ao ser lido vencido, em vez de ficar tentando', () => {
    guardarRascunho(A, { nome: 'x' });
    lerRascunho(A, new Date(Date.now() + 13 * 3_600_000));
    // Lido de novo AGORA, já não existe: a leitura vencida apagou.
    expect(lerRascunho(A)).toBeNull();
  });
});

describe('a saída', () => {
  it('apaga todos os rascunhos da aba, de quem quer que sejam', () => {
    assumirDono('ana');
    guardarRascunho(A, { nome: 'x' });
    guardarRascunho(fichaDe('ana', 'c1'), { nome: 'y' });
    window.sessionStorage.setItem(CHAVE_LEGADA, CONTEUDO_LEGADO);

    esquecerDono();

    expect(chavesGuardadas()).toEqual([]);
    expect(donoConfirmado()).toBeNull();
  });

  it('não mexe no que não é rascunho', () => {
    assumirDono('ana');
    window.sessionStorage.setItem('ideworks:outra-coisa', 'fica');
    guardarRascunho(A, { nome: 'x' });
    esquecerDono();
    expect(chavesGuardadas()).toEqual(['ideworks:outra-coisa']);
  });

  it('`limparAoSair` limpa E avisa as outras abas', () => {
    assumirDono('ana');
    guardarRascunho(A, { nome: 'x' });
    limparAoSair();
    expect(chavesGuardadas()).toEqual([]);
    expect(window.localStorage.getItem('ideworks:sessao:mudou-em')).toMatch(/^\d+$/);
  });

  it('o aviso às outras abas não leva dado pessoal', () => {
    assumirDono('ana');
    avisarOutrasAbas();
    const marca = window.localStorage.getItem('ideworks:sessao:mudou-em') ?? '';
    expect(marca).not.toContain('ana');
    expect(Number(marca)).toBeGreaterThan(0);
  });
});

describe('as outras abas ficam sabendo', () => {
  type Ouvinte = (e: unknown) => void;
  let ouvintes: Record<string, Ouvinte[]>;
  let visibilidade: string;

  beforeEach(() => {
    ouvintes = {};
    visibilidade = 'visible';
    const registrar = (nome: string, f: Ouvinte) => (ouvintes[nome] ??= []).push(f);
    const remover = (nome: string, f: Ouvinte) => {
      ouvintes[nome] = (ouvintes[nome] ?? []).filter((x) => x !== f);
    };
    vi.stubGlobal('window', {
      sessionStorage: cofreDeMentira(),
      localStorage: cofreDeMentira(),
      addEventListener: registrar,
      removeEventListener: remover,
    });
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibilidade;
      },
      addEventListener: registrar,
      removeEventListener: remover,
    });
  });

  const disparar = (nome: string, evento: unknown) =>
    (ouvintes[nome] ?? []).forEach((f) => f(evento));

  it('o evento `storage` da marca acorda quem vigia — uma vez por mudança', () => {
    const acordou = vi.fn();
    vigiarOutrasAbas(acordou);

    // Outra aba saiu: ela escreve a marca, e o navegador dispara `storage` aqui.
    window.localStorage.setItem('ideworks:sessao:mudou-em', '1');
    disparar('storage', { key: 'ideworks:sessao:mudou-em' });
    expect(acordou).toHaveBeenCalledTimes(1);

    // O mesmo evento repetido, sem a marca mudar, não acorda de novo.
    disparar('storage', { key: 'ideworks:sessao:mudou-em' });
    expect(acordou).toHaveBeenCalledTimes(1);
  });

  it('outra chave em `storage` não acorda ninguém', () => {
    const acordou = vi.fn();
    vigiarOutrasAbas(acordou);
    window.localStorage.setItem('ideworks:tema', 'escuro');
    disparar('storage', { key: 'ideworks:tema' });
    expect(acordou).not.toHaveBeenCalled();
  });

  it('a aba que volta a ficar visível confere a marca — para quem perdeu o evento', () => {
    const acordou = vi.fn();
    vigiarOutrasAbas(acordou);

    // A aba estava congelada: a marca mudou sem evento nenhum.
    window.localStorage.setItem('ideworks:sessao:mudou-em', '2');
    visibilidade = 'hidden';
    disparar('visibilitychange', {});
    expect(acordou).not.toHaveBeenCalled();

    visibilidade = 'visible';
    disparar('visibilitychange', {});
    expect(acordou).toHaveBeenCalledTimes(1);

    // Voltar a ficar visível de novo, sem a marca mudar, não acorda.
    disparar('visibilitychange', {});
    expect(acordou).toHaveBeenCalledTimes(1);
  });

  it('desligar para de ouvir', () => {
    const acordou = vi.fn();
    const parar = vigiarOutrasAbas(acordou);
    parar();
    window.localStorage.setItem('ideworks:sessao:mudou-em', '3');
    disparar('storage', { key: 'ideworks:sessao:mudou-em' });
    disparar('visibilitychange', {});
    expect(acordou).not.toHaveBeenCalled();
    expect(ouvintes.storage ?? []).toHaveLength(0);
    expect(ouvintes.visibilitychange ?? []).toHaveLength(0);
  });
});

describe('não quebra quando o navegador atrapalha', () => {
  it('armazenamento bloqueado não derruba nada', () => {
    // Navegação privada de alguns navegadores LANÇA ao tocar em
    // `sessionStorage`. É o caso que nunca aparece na máquina de quem
    // desenvolveu — e derrubaria o formulário inteiro de quem usa.
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('bloqueado pela política do navegador');
      },
      get localStorage(): Storage {
        throw new Error('bloqueado pela política do navegador');
      },
    });
    expect(() => assumirDono('ana')).not.toThrow();
    expect(() => guardarRascunho(A, { a: 1 })).not.toThrow();
    expect(lerRascunho(A)).toBeNull();
    expect(() => apagarRascunho(A)).not.toThrow();
    expect(() => limparAoSair()).not.toThrow();
    expect(() => vigiarOutrasAbas(() => {})()).not.toThrow();
  });

  it('sem janela nenhuma (a suíte) também não derruba', () => {
    vi.stubGlobal('window', undefined);
    expect(() => assumirDono('ana')).not.toThrow();
    expect(() => guardarRascunho(A, { a: 1 })).not.toThrow();
    expect(lerRascunho(A)).toBeNull();
  });

  it('conteúdo corrompido some em vez de quebrar', () => {
    assumirDono('ana');
    window.sessionStorage.setItem(chaveDaFicha(A), 'isto não é json');
    expect(lerRascunho(A)).toBeNull();
    expect(window.sessionStorage.getItem(chaveDaFicha(A))).toBeNull();
  });

  it('conteúdo sem os campos esperados também some', () => {
    assumirDono('ana');
    window.sessionStorage.setItem(chaveDaFicha(A), JSON.stringify({ qualquer: 'coisa' }));
    expect(lerRascunho(A)).toBeNull();
  });
});

describe('quandoFoi — a tela precisa dizer de quando é', () => {
  const agora = new Date('2026-08-24T12:00:00Z');
  const atras = (min: number) => new Date(agora.getTime() - min * 60_000).toISOString();

  it.each([
    [0, 'agora há pouco'],
    [1, 'há 1 minuto'],
    [7, 'há 7 minutos'],
    [60, 'há 1 hora'],
    [200, 'há 3 horas'],
  ])('%i minutos vira "%s"', (min, esperado) => {
    expect(quandoFoi(atras(min), agora)).toBe(esperado);
  });
});
