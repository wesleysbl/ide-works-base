/**
 * A SAÍDA COM TEXTO POR SALVAR — etapa F17.AUD03.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   O achado 3 da auditoria de 09/09/2026, escrito ao contrário: o script
 *   `docs/auditoria-2026-09-09/reproduzir-fluxos.mjs` afirmava que o X saía
 *   sem perguntar e sem gravar; aqui cada saída interna com texto alterado
 *   passa por UMA decisão, e cada uma das três respostas faz o que promete.
 *
 * A FICHA DE MENTIRA
 *   `ficha()` é o que a tela da tarefa registra: se há alteração, como salvar
 *   (com resposta controlada) e como descartar. `bloqueio()` é o par
 *   `proceed`/`reset` do roteador, contado — porque o que se prova é que cada
 *   um é chamado no máximo uma vez.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  type PortaDeSaida,
  aoAbandonarDocumento,
  criarDecisaoDeSaida,
  deveBloquear,
  portaDeSaida,
  registrarSaida,
} from '@/ui/saida';

/** Uma gravação que a suíte resolve quando quiser. */
function gravacaoControlada() {
  let resolver: (ok: boolean) => void = () => {};
  let recusar: (e: unknown) => void = () => {};
  const promessa = new Promise<boolean>((ok, erro) => {
    resolver = ok;
    recusar = erro;
  });
  return { promessa, confirmar: () => resolver(true), falhar: () => resolver(false), estourar: (e: unknown) => recusar(e) };
}

function ficha(alterada = true) {
  const gravacao = gravacaoControlada();
  const salvar = vi.fn(() => gravacao.promessa);
  const descartar = vi.fn();
  const porta: PortaDeSaida = {
    temAlteracao: () => alterada,
    salvar,
    descartar,
  };
  return { porta, salvar, descartar, gravacao };
}

function bloqueio() {
  const prosseguir = vi.fn();
  const ficar = vi.fn();
  return { saidas: { prosseguir, ficar }, prosseguir, ficar };
}

const em = (pathname: string) => ({ pathname });

/* ────────────────────────────── bloquear? ────────────────────────────── */

describe('quando a saída interna espera uma decisão', () => {
  it('com porta e alteração, mudar de caminho bloqueia', () => {
    expect(deveBloquear(ficha().porta, em('/tarefa/a'), em('/quadro'))).toBe(true);
  });

  it('para a mãe ou para uma subtarefa é outro caminho: bloqueia', () => {
    expect(deveBloquear(ficha().porta, em('/tarefa/filha'), em('/tarefa/mae'))).toBe(true);
  });

  it('sem alteração, a saída é imediata', () => {
    expect(deveBloquear(ficha(false).porta, em('/tarefa/a'), em('/quadro'))).toBe(false);
  });

  it('sem porta registrada — nenhuma tela com texto —, nada bloqueia', () => {
    expect(deveBloquear(null, em('/tarefa/a'), em('/quadro'))).toBe(false);
  });

  it('⚠️ o MESMO caminho não é sair: trocar de aba (`?aba=`) não pergunta nada', () => {
    expect(deveBloquear(ficha().porta, em('/tarefa/a'), em('/tarefa/a'))).toBe(false);
  });

  it('a alteração é lida NA HORA da pergunta, não no registro', () => {
    let alterada = false;
    const porta: PortaDeSaida = { temAlteracao: () => alterada, salvar: async () => true, descartar: () => {} };
    expect(deveBloquear(porta, em('/tarefa/a'), em('/quadro'))).toBe(false);
    alterada = true;
    expect(deveBloquear(porta, em('/tarefa/a'), em('/quadro'))).toBe(true);
  });
});

/* ───────────────────── a ficha ao lado do Quadro (F43, Fase 7) ───────────────────── */

describe('fechar a ficha ao lado é sair — mesmo com o caminho igual', () => {
  /** A entrada do Quadro com (ou sem) a ficha aberta ao lado. */
  const quadro = (ficha?: string, resto: Record<string, unknown> = {}) => ({
    pathname: '/quadro/l1',
    state: ficha === undefined ? (Object.keys(resto).length > 0 ? resto : null) : { ...resto, fichaAoLado: ficha },
  });

  it('✕, Esc, clique fora ou Voltar com texto por salvar: a entrada sem ficha bloqueia', () => {
    expect(deveBloquear(ficha().porta, quadro('t1'), quadro())).toBe(true);
  });

  it('o progresso de Minhas tarefas no estado não confunde a pergunta', () => {
    const progresso = { progresso: { aba: 'pendente', paginas: 3 } };
    expect(deveBloquear(ficha().porta, quadro('t1', progresso), quadro(undefined, progresso))).toBe(true);
  });

  it('abrir OUTRA tarefa ao lado com texto por salvar também é sair desta', () => {
    expect(deveBloquear(ficha().porta, quadro('t1'), quadro('t2'))).toBe(true);
  });

  it('sem alteração, fechar é imediato', () => {
    expect(deveBloquear(ficha(false).porta, quadro('t1'), quadro())).toBe(false);
  });

  it('a mesma ficha no mesmo caminho não é sair (a tela de trás regrava o próprio estado)', () => {
    expect(deveBloquear(ficha().porta, quadro('t1'), quadro('t1', { progresso: { aba: 'feito', paginas: 1 } }))).toBe(false);
  });

  it('"Abrir em tela cheia" e os links de dentro da ficha mudam o caminho: bloqueia, como sempre', () => {
    expect(deveBloquear(ficha().porta, quadro('t1'), em('/tarefa/t1'))).toBe(true);
    expect(deveBloquear(ficha().porta, quadro('t1'), em('/tarefa/sub-1'))).toBe(true);
  });

  it('estado sem forma (outra versão da tela, F5) não é ficha: vale o caminho', () => {
    expect(deveBloquear(ficha().porta, { pathname: '/quadro/l1', state: 'lixo' }, { pathname: '/quadro/l1', state: 42 })).toBe(false);
  });
});

/* ────────────────────────────── o registro ────────────────────────────── */

describe('o registro da porta', () => {
  it('a tela registra ao montar e a baixa a tira', () => {
    const { porta } = ficha();
    const baixa = registrarSaida(porta);
    expect(portaDeSaida()).toBe(porta);
    baixa();
    expect(portaDeSaida()).toBeNull();
  });

  it('a baixa de uma montagem antiga não apaga a montagem nova (modo estrito)', () => {
    const primeira = ficha().porta;
    const segunda = ficha().porta;
    const baixaDaPrimeira = registrarSaida(primeira);
    const baixaDaSegunda = registrarSaida(segunda);
    baixaDaPrimeira();
    expect(portaDeSaida()).toBe(segunda);
    baixaDaSegunda();
    expect(portaDeSaida()).toBeNull();
  });
});

/* ─────────────────────────── o aviso nativo ─────────────────────────── */

describe('recarregar ou fechar a aba', () => {
  const evento = () => {
    const e = { preventDefault: vi.fn(), returnValue: undefined as unknown };
    return e;
  };

  it('com alteração, o navegador é avisado', () => {
    const e = evento();
    expect(aoAbandonarDocumento(ficha().porta, e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(typeof e.returnValue).toBe('string');
    expect((e.returnValue as string).length).toBeGreaterThan(0);
  });

  it('sem alteração, o aviso não aparece — um aviso permanente ensina a ignorá-lo', () => {
    const e = evento();
    expect(aoAbandonarDocumento(ficha(false).porta, e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.returnValue).toBeUndefined();
  });

  it('sem porta, idem', () => {
    const e = evento();
    expect(aoAbandonarDocumento(null, e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────── as três respostas ─────────────────────────── */

describe('Continuar editando', () => {
  it('fica, sem gravar nem descartar', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    await decisao.escolher('continuar');
    expect(b.ficar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).not.toHaveBeenCalled();
    expect(f.salvar).not.toHaveBeenCalled();
    expect(f.descartar).not.toHaveBeenCalled();
    expect(decisao.concluida()).toBe(true);
  });

  it('Esc e fechar a janela são `continuar`: o texto não é descartado', async () => {
    // A janela chama `escolher('continuar')` nos dois gestos — é a mesma
    // chamada, e o que se prova é que ela não passa perto de `descartar`.
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    await decisao.escolher('continuar');
    await decisao.escolher('continuar');
    expect(f.descartar).not.toHaveBeenCalled();
    expect(b.ficar).toHaveBeenCalledTimes(1);
  });
});

describe('Descartar e sair', () => {
  it('abandona o rascunho desta ficha e conclui a navegação pedida', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    await decisao.escolher('descartar');
    expect(f.descartar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
    expect(b.ficar).not.toHaveBeenCalled();
    expect(f.salvar).not.toHaveBeenCalled();
  });

  it('descartar antes de prosseguir — a navegação só sai depois de o rascunho ir embora', async () => {
    const ordem: string[] = [];
    const porta: PortaDeSaida = {
      temAlteracao: () => true,
      salvar: async () => true,
      descartar: () => ordem.push('descartar'),
    };
    const decisao = criarDecisaoDeSaida(porta, {
      prosseguir: () => ordem.push('prosseguir'),
      ficar: () => ordem.push('ficar'),
    });
    await decisao.escolher('descartar');
    expect(ordem).toEqual(['descartar', 'prosseguir']);
  });
});

describe('Salvar e sair', () => {
  it('espera a confirmação do servidor e só então sai', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const escolha = decisao.escolher('salvar');
    expect(decisao.salvando()).toBe(true);
    expect(b.prosseguir).not.toHaveBeenCalled();
    f.gravacao.confirmar();
    await escolha;
    expect(decisao.salvando()).toBe(false);
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
    expect(b.ficar).not.toHaveBeenCalled();
    expect(f.descartar).not.toHaveBeenCalled();
  });

  it('falha de gravação: fica na ficha, com o texto, e pode tentar de novo', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const escolha = decisao.escolher('salvar');
    f.gravacao.falhar();
    await escolha;
    expect(b.ficar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).not.toHaveBeenCalled();
    expect(f.descartar).not.toHaveBeenCalled();
    expect(decisao.concluida()).toBe(true);
  });

  it('erro de rede que estoura: idem — a ficha já mostrou o erro', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const escolha = decisao.escolher('salvar');
    f.gravacao.estourar(new Error('rede'));
    await escolha;
    expect(b.ficar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).not.toHaveBeenCalled();
  });

  it('erro de validação é `salvar` devolvendo `false` antes de qualquer envio', async () => {
    const salvar = vi.fn(async () => false);
    const porta: PortaDeSaida = { temAlteracao: () => true, salvar, descartar: () => {} };
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(porta, b.saidas);
    await decisao.escolher('salvar');
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(b.ficar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────── uma decisão, uma vez ─────────────────────────── */

describe('uma única decisão por saída', () => {
  it('clicar `Salvar e sair` duas vezes envia UMA gravação e sai UMA vez', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const primeira = decisao.escolher('salvar');
    const segunda = decisao.escolher('salvar');
    f.gravacao.confirmar();
    await Promise.all([primeira, segunda]);
    expect(f.salvar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
  });

  it('Esc no meio da gravação não descarta nem cancela: a escrita já foi', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const escolha = decisao.escolher('salvar');
    await decisao.escolher('continuar');
    expect(b.ficar).not.toHaveBeenCalled();
    f.gravacao.confirmar();
    await escolha;
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
    expect(b.ficar).not.toHaveBeenCalled();
  });

  it('`Descartar` durante a gravação também não entra', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    const escolha = decisao.escolher('salvar');
    await decisao.escolher('descartar');
    expect(f.descartar).not.toHaveBeenCalled();
    f.gravacao.confirmar();
    await escolha;
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
  });

  it('depois de concluída, nenhuma escolha faz mais nada', async () => {
    const f = ficha();
    const b = bloqueio();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas);
    await decisao.escolher('descartar');
    await decisao.escolher('continuar');
    await decisao.escolher('salvar');
    expect(f.salvar).not.toHaveBeenCalled();
    expect(f.descartar).toHaveBeenCalledTimes(1);
    expect(b.prosseguir).toHaveBeenCalledTimes(1);
    expect(b.ficar).not.toHaveBeenCalled();
  });

  it('a janela é avisada ao começar e ao terminar a gravação, e ao concluir', async () => {
    const f = ficha();
    const b = bloqueio();
    const avisos = vi.fn();
    const decisao = criarDecisaoDeSaida(f.porta, b.saidas, avisos);
    const escolha = decisao.escolher('salvar');
    expect(avisos).toHaveBeenCalledTimes(1);
    f.gravacao.confirmar();
    await escolha;
    expect(avisos).toHaveBeenCalledTimes(2);
  });
});
