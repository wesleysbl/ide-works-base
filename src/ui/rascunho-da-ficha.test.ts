/**
 * O rascunho de uma ficha aberta — F17.AUD02.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   Cada caso aqui é uma reprodução da auditoria de 09/09/2026 escrita ao
 *   contrário: `docs/auditoria-2026-09-09/reproduzir-cadastro.mjs` afirmava o
 *   DEFEITO no Chrome (abrir a ficha por cima de um rascunho pendente e, 800 ms
 *   depois, a chave conter nome vazio); aqui a mesma sequência afirma o
 *   comportamento certo, sem navegador. As esperas são timers falsos.
 *
 * A FICHA DE MENTIRA
 *   `abrirFicha()` faz o que `FichaDeCliente` faz, na ordem em que faz: abre
 *   com o dono que a sessão confirmou (ou sem dono), carrega, repassa cada
 *   mudança e encerra ao fechar. Se a tela um dia chamar em outra ordem, é a
 *   tela que está errada — a ordem aqui é a do cabeçalho do módulo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Ficha,
  assumirDono,
  chaveDaFicha,
  esquecerDono,
  guardarRascunho,
  lerRascunho,
  limparAoSair,
} from '@/ui/rascunho';
import { type EstadoDoRascunho, criarRascunhoDaFicha } from '@/ui/rascunho-da-ficha';

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

type Form = { nome: string; cidade: string };
const VAZIO: Form = { nome: '', cidade: '' };
const fichaDe = (usuario: string, id: string | null = null): Ficha => ({
  usuario,
  tipo: 'cliente',
  id,
});
const A = fichaDe('ana');
const B = fichaDe('bia');

/** O que está no cofre para esta ficha, cru — para ver o que a tela não vê. */
const guardadoDe = (ficha: Ficha): Form | null => {
  const cru = window.sessionStorage.getItem(chaveDaFicha(ficha));
  return cru === null ? null : (JSON.parse(cru) as { valor: Form }).valor;
};

/** A ficha de mentira: uma instância do módulo, com as chamadas na ordem da tela. */
function abrirFicha(ficha: Ficha | null, carregado: Form = VAZIO) {
  const estados: EstadoDoRascunho<Form>[] = [];
  const rascunho = criarRascunhoDaFicha<Form>({ aoMudar: (e) => estados.push(e) });
  rascunho.abrir(ficha);
  rascunho.carregou(carregado);
  rascunho.mudou(carregado);
  return {
    rascunho,
    estados,
    digitar: (form: Form) => rascunho.mudou(form),
    fechar: () => rascunho.encerrar(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { sessionStorage: cofreDeMentira(), localStorage: cofreDeMentira() });
  esquecerDono();
  assumirDono('ana');
});
afterEach(() => {
  esquecerDono();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ─────────────────────────── só o que mudou ─────────────────────────── */

describe('grava só o que mudou de fato', () => {
  it('abrir e fechar sem tocar em nada não escreve', () => {
    const f = abrirFicha(A);
    vi.advanceTimersByTime(2_000);
    f.fechar();
    expect(guardadoDe(A)).toBeNull();
  });

  it('digitar grava meio segundo depois, e não antes', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(499);
    expect(guardadoDe(A)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });

  it('só a última tecla conta: uma escrita para uma sequência', () => {
    const agendar = vi.fn((acao: () => void, ms: number) => setTimeout(acao, ms));
    const rascunho = criarRascunhoDaFicha<Form>({
      relogio: { agendar, cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
    });
    rascunho.abrir(A);
    rascunho.carregou(VAZIO);
    rascunho.mudou({ nome: 'C', cidade: '' });
    rascunho.mudou({ nome: 'Cl', cidade: '' });
    rascunho.mudou({ nome: 'Clí', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).toEqual({ nome: 'Clí', cidade: '' });
    // Três agendamentos, mas cada um cancelou o anterior: uma escrita só.
    expect(agendar).toHaveBeenCalledTimes(3);
  });

  it('o mesmo valor de novo não reagenda — comparação estrutural, não por referência', () => {
    const agendar = vi.fn((acao: () => void, ms: number) => setTimeout(acao, ms));
    const rascunho = criarRascunhoDaFicha<Form>({
      relogio: { agendar, cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
    });
    rascunho.abrir(A);
    rascunho.carregou(VAZIO);
    rascunho.mudou({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(agendar).toHaveBeenCalledTimes(1);
    // A tela redesenhou e repassou um objeto NOVO com o mesmo conteúdo.
    rascunho.mudou({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(agendar).toHaveBeenCalledTimes(1);
  });

  it('voltar ao que estava carregado apaga o rascunho: não há o que recuperar', () => {
    const f = abrirFicha(A, { nome: 'Salva', cidade: 'Ibitinga' });
    f.digitar({ nome: 'Salva 2', cidade: 'Ibitinga' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).toEqual({ nome: 'Salva 2', cidade: 'Ibitinga' });

    f.digitar({ nome: 'Salva', cidade: 'Ibitinga' });
    expect(guardadoDe(A)).toBeNull();
  });
});

/* ─────────────────── a recuperação pendente — achado 7 ─────────────────── */

describe('a recuperação pendente suspende a gravação — achado 7 da auditoria', () => {
  it('reabrir por cima de um rascunho e esperar 800 ms não o sobrescreve', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });

    const f = abrirFicha(A);
    expect(f.rascunho.estado().recuperacao).toBe('pendente');
    expect(f.rascunho.estado().oferecido?.valor).toEqual({ nome: 'Clínica', cidade: '' });

    // A reprodução da auditoria: sem decidir, esperar. Antes, aqui a chave já
    // continha nome vazio.
    vi.advanceTimersByTime(800);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });

  it('fechar sem decidir mantém o conteúdo pendente intacto', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    vi.advanceTimersByTime(800);
    f.fechar();
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });

  it('recuperação após mais de uma abertura: a terceira ainda oferece a mesma coisa', () => {
    // 1ª abertura: digita e fecha.
    const primeira = abrirFicha(A);
    primeira.digitar({ nome: 'Clínica', cidade: 'Ibitinga' });
    vi.advanceTimersByTime(500);
    primeira.fechar();

    // 2ª abertura: vê a oferta, espera, não decide, fecha.
    const segunda = abrirFicha(A);
    expect(segunda.rascunho.estado().recuperacao).toBe('pendente');
    vi.advanceTimersByTime(2_000);
    segunda.fechar();

    // 3ª abertura: a oferta é a mesma da primeira.
    const terceira = abrirFicha(A);
    expect(terceira.rascunho.estado().recuperacao).toBe('pendente');
    expect(terceira.rascunho.estado().oferecido?.valor).toEqual({
      nome: 'Clínica',
      cidade: 'Ibitinga',
    });
  });

  it('digitar enquanto a decisão está em aberto não grava por cima', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.digitar({ nome: 'Outra coisa', cidade: '' });
    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });
});

/* ───────────────────────── recuperar e descartar ───────────────────────── */

describe('recuperar, descartar, salvar', () => {
  it('recuperar devolve o conteúdo certo e não o regrava', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const antes = window.sessionStorage.getItem(chaveDaFicha(A));

    const f = abrirFicha(A);
    const valor = f.rascunho.recuperar();
    expect(valor).toEqual({ nome: 'Clínica', cidade: '' });
    expect(f.rascunho.estado().recuperacao).toBe('recuperado');

    // A tela aplica e repassa; igual ao guardado, não se escreve de novo.
    f.digitar(valor as Form);
    vi.advanceTimersByTime(1_000);
    expect(window.sessionStorage.getItem(chaveDaFicha(A))).toBe(antes);
  });

  it('depois de recuperar, continuar editando volta a gravar', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.digitar(f.rascunho.recuperar() as Form);
    f.digitar({ nome: 'Clínica', cidade: 'Ibitinga' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: 'Ibitinga' });
  });

  it('descartar apaga e não reaparece na abertura seguinte', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.rascunho.descartar();
    expect(f.rascunho.estado().recuperacao).toBe('descartado');
    expect(guardadoDe(A)).toBeNull();
    vi.advanceTimersByTime(2_000);
    f.fechar();

    expect(abrirFicha(A).rascunho.estado().recuperacao).toBe('sem-rascunho');
  });

  it('o que foi digitado enquanto se decidia vira rascunho depois de descartar', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.digitar({ nome: 'Nova', cidade: '' });
    f.rascunho.descartar();
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).toEqual({ nome: 'Nova', cidade: '' });
  });

  it('recuperar e descartar fora de `pendente` não fazem nada', () => {
    const f = abrirFicha(A);
    expect(f.rascunho.recuperar()).toBeNull();
    f.rascunho.descartar();
    expect(f.rascunho.estado().recuperacao).toBe('sem-rascunho');
  });

  it('salvar apaga o rascunho e o temporizador não o recria', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).not.toBeNull();

    f.digitar({ nome: 'Clínica', cidade: 'Ibitinga' }); // agendado, ainda não gravado
    f.rascunho.salvo();
    expect(guardadoDe(A)).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(A)).toBeNull();
    f.fechar();
    expect(guardadoDe(A)).toBeNull();
  });

  it('a tela é avisada a cada mudança de estado', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.rascunho.recuperar();
    expect(f.estados.map((e) => e.recuperacao)).toEqual(['pendente', 'recuperado']);
  });
});

/* ──────────────────── Descartar e sair — F17.AUD03 ──────────────────── */

describe('abandonar: a pessoa saiu sem querer o texto', () => {
  it('apaga o rascunho gravado e o agendado não o recria — nem ao fechar', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).not.toBeNull();

    f.digitar({ nome: 'Clínica', cidade: 'Ibitinga' }); // agendado, ainda não gravado
    f.rascunho.abandonar();
    expect(guardadoDe(A)).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(A)).toBeNull();
    // A desmontagem vem logo depois, e `encerrar` conclui o agendado — que
    // não existe mais. O texto abandonado não volta pela porta dos fundos.
    f.fechar();
    expect(guardadoDe(A)).toBeNull();
    expect(abrirFicha(A).rascunho.estado().recuperacao).toBe('sem-rascunho');
  });

  it('abandona só ESTA ficha: o rascunho de outra não é tocado', () => {
    const outra = fichaDe('ana', 'cliente-2');
    guardarRascunho(outra, { nome: 'Outra', cidade: '' });
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    f.rascunho.abandonar();
    expect(guardadoDe(A)).toBeNull();
    expect(guardadoDe(outra)).toEqual({ nome: 'Outra', cidade: '' });
  });

  it('com recuperação pendente, abandonar também a encerra sem aplicar', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    expect(f.rascunho.estado().recuperacao).toBe('pendente');
    f.rascunho.abandonar();
    expect(f.rascunho.estado()).toEqual({ recuperacao: 'sem-rascunho', oferecido: null });
    expect(guardadoDe(A)).toBeNull();
  });

  it('a tela é avisada', () => {
    const f = abrirFicha(A);
    f.rascunho.abandonar();
    expect(f.estados.map((e) => e.recuperacao)).toEqual(['sem-rascunho', 'sem-rascunho']);
  });
});

/* ───────────────────────────── fechar ───────────────────────────── */

describe('fechar a ficha com edição em curso', () => {
  it('conclui a gravação local antes de desmontar — sem esperar o meio segundo', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Última linha', cidade: '' });
    f.fechar();
    expect(guardadoDe(A)).toEqual({ nome: 'Última linha', cidade: '' });
  });

  it('e a abertura seguinte oferece exatamente isso', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Última linha', cidade: '' });
    f.fechar();
    const g = abrirFicha(A);
    expect(g.rascunho.estado().oferecido?.valor).toEqual({ nome: 'Última linha', cidade: '' });
  });

  it('fechar duas vezes não grava duas vezes', () => {
    const agendar = vi.fn((acao: () => void, ms: number) => setTimeout(acao, ms));
    const rascunho = criarRascunhoDaFicha<Form>({
      relogio: { agendar, cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
    });
    rascunho.abrir(A);
    rascunho.carregou(VAZIO);
    rascunho.mudou({ nome: 'x', cidade: '' });
    rascunho.encerrar();
    const depoisDaPrimeira = window.sessionStorage.getItem(chaveDaFicha(A));
    vi.advanceTimersByTime(1);
    rascunho.encerrar();
    expect(window.sessionStorage.getItem(chaveDaFicha(A))).toBe(depoisDaPrimeira);
  });
});

/* ──────────────────────── sem dono, e troca de dono ──────────────────────── */

describe('sem identidade confirmada, nada se lê nem se grava', () => {
  it('a sessão ainda carregando: digitar não grava', () => {
    const f = abrirFicha(null);
    f.digitar({ nome: 'Clínica', cidade: '' });
    vi.advanceTimersByTime(2_000);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('a sessão chega depois: o que já foi digitado passa a ser guardado', () => {
    const f = abrirFicha(null);
    f.digitar({ nome: 'Clínica', cidade: '' });
    f.rascunho.abrir(A);
    vi.advanceTimersByTime(500);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });

  it('a sessão chega depois: o rascunho que já existia é oferecido, e não sobrescrito', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(null);
    vi.advanceTimersByTime(800);
    f.rascunho.abrir(A);
    expect(f.rascunho.estado().recuperacao).toBe('pendente');
    vi.advanceTimersByTime(800);
    expect(guardadoDe(A)).toEqual({ nome: 'Clínica', cidade: '' });
  });

  it('a sessão falhou (sem dono): nada é oferecido, mesmo com rascunho no cofre', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(null);
    expect(f.rascunho.estado().recuperacao).toBe('sem-rascunho');
    expect(f.rascunho.estado().oferecido).toBeNull();
  });
});

describe('saída e troca de usuário — achado 2 da auditoria', () => {
  it('sair com temporizador pendente: a ficha cancela, e nada é regravado', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });

    // O que a tela faz ao ver a identidade sumir.
    limparAoSair();
    f.rascunho.abrir(null);

    vi.advanceTimersByTime(2_000);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('sair ANTES de a tela reagir: o temporizador dispara e bate na porta fechada', () => {
    // A limpeza acontece num `await`; o efeito da ficha só corre no próximo
    // desenho. Se o temporizador cair nesse vão, `guardarRascunho` recusa.
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    limparAoSair();
    vi.advanceTimersByTime(2_000);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('fechar a ficha depois de sair também não regrava', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Clínica', cidade: '' });
    limparAoSair();
    f.fechar();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('sair como A e entrar como B na mesma aba: B não vê nem aplica o rascunho de A', () => {
    const deA = abrirFicha(A);
    deA.digitar({ nome: 'Da Ana', cidade: '' });
    deA.fechar();
    expect(guardadoDe(A)).not.toBeNull();

    limparAoSair();
    assumirDono('bia');

    const deB = abrirFicha(B);
    expect(deB.rascunho.estado().recuperacao).toBe('sem-rascunho');
    expect(deB.rascunho.recuperar()).toBeNull();
    expect(guardadoDe(A)).toBeNull();
  });

  it('a identidade muda com a ficha aberta: o texto de A não vira rascunho de B', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Da Ana', cidade: '' });

    // Outra aba: A saiu, B entrou. Esta aba revalida e descobre B.
    assumirDono('bia');
    f.rascunho.abrir(B);

    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(B)).toBeNull();
    expect(guardadoDe(A)).toBeNull();

    // Mesmo uma tecla a mais não atribui o texto a B: a base é da ficha
    // anterior, e sem base nova não há comparação — nem gravação.
    f.digitar({ nome: 'Da Ana, mais uma letra', cidade: '' });
    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(B)).toBeNull();

    // Só uma nova carga — uma ficha aberta de novo, por B — volta a gravar.
    f.rascunho.carregou(VAZIO);
    f.digitar({ nome: 'Da Bia', cidade: '' });
    vi.advanceTimersByTime(500);
    expect(guardadoDe(B)).toEqual({ nome: 'Da Bia', cidade: '' });
  });

  it('passar por `null` no meio (saiu, entrou) não deixa a base de A valer para B', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Da Ana', cidade: '' });
    f.rascunho.abrir(null);
    assumirDono('bia');
    f.rascunho.abrir(B);
    f.digitar({ nome: 'Da Ana?', cidade: '' });
    vi.advanceTimersByTime(2_000);
    expect(guardadoDe(B)).toBeNull();
  });

  it('a mesma pessoa, outra ficha: o que estava agendado conclui antes de trocar', () => {
    const f = abrirFicha(A);
    f.digitar({ nome: 'Nova', cidade: '' });
    f.rascunho.abrir(fichaDe('ana', 'c1'));
    expect(guardadoDe(A)).toEqual({ nome: 'Nova', cidade: '' });
  });

  it('abrir a mesma ficha de novo não recomeça nada', () => {
    guardarRascunho(A, { nome: 'Clínica', cidade: '' });
    const f = abrirFicha(A);
    f.digitar(f.rascunho.recuperar() as Form);
    f.rascunho.abrir({ ...A });
    expect(f.rascunho.estado().recuperacao).toBe('recuperado');
  });
});

/* ─────────────────────── validade e formato legado ─────────────────────── */

describe('o que não vale não é oferecido', () => {
  it('rascunho vencido não aparece', () => {
    guardarRascunho(A, { nome: 'De ontem', cidade: '' });
    vi.advanceTimersByTime(13 * 3_600_000);
    const f = abrirFicha(A);
    expect(f.rascunho.estado().recuperacao).toBe('sem-rascunho');
    expect(lerRascunho(A)).toBeNull();
  });

  it('a chave legada, sem dono, não é oferecida como se fosse de quem abriu', () => {
    esquecerDono();
    window.sessionStorage.setItem(
      'ideworks:rascunho:cliente:novo',
      JSON.stringify({ valor: { nome: 'Sem dono', cidade: '' }, guardadoEm: new Date().toISOString() }),
    );
    assumirDono('ana');
    const f = abrirFicha(A);
    expect(f.rascunho.estado().recuperacao).toBe('sem-rascunho');
    expect(window.sessionStorage.length).toBe(0);
  });
});
