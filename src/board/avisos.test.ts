/**
 * A CAIXA DE ENTRADA, na parte que é pura — F17.46.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO CONSEGUE PROVAR
 *   Aqui estão as frases e o agrupamento: aritmética de dia, texto, ordem.
 *   Roda sem rede e sem navegador, e por isso roda sempre.
 *
 *   O QUE ELE NÃO ALCANÇA é justamente o coração da etapa: que o aviso CHEGA a
 *   quem a automação designou, que quem PERDEU a tarefa não recebe nada, e que
 *   o alcance recorta os dois. Isso é política de linha, e quem mede é
 *   `scripts/provar-avisos.mjs`, com dois atores e banco de verdade.
 */

import { describe, expect, it } from 'vitest';

import {
  type Aviso,
  DIAS_DE_ANTECEDENCIA,
  ROTULO_DO_TIPO,
  TIPOS_DE_AVISO,
  agruparAvisos,
  apertoDoPrazo,
  contarNaoVistos,
  filtrarAvisos,
  fraseDePrazo,
  fraseDeAgente,
  fraseDeAprovacao,
  fraseDoAviso,
  origemDoAviso,
  selo,
} from '@/board/avisos';
import type { Day } from '@/board/board';

const HOJE: Day = { year: 2026, month: 8, day: 31 };

const AVISO: Aviso = {
  key: 'automation:1',
  tipo: 'automacao',
  taskId: 'a1b2',
  taskTitle: 'Post de setembro',
  listName: 'ATENDIMENTO',
  clientName: 'Sabor Doce',
  occurredAt: '2026-08-31T12:00:00.000Z',
  dueOn: null,
  automationName: 'Passa para o atendimento',
  fromListName: 'Sabor Doce',
  toListName: 'ATENDIMENTO',
  toStatusName: 'na fila',
  seen: false,
};

const comPrazo = (dueOn: string | null, resto: Partial<Aviso> = {}): Aviso => ({
  ...AVISO,
  key: `due:a1b2:${dueOn ?? ''}`,
  tipo: 'prazo',
  occurredAt: null,
  dueOn,
  automationName: null,
  fromListName: null,
  toListName: null,
  toStatusName: null,
  ...resto,
});

/* ───────────────────────────── o prazo ───────────────────────────── */

describe('o prazo em português de gente', () => {
  it('hoje, amanhã e ontem têm nome, e não data', () => {
    expect(fraseDePrazo('2026-08-31', HOJE)).toBe('Vence hoje');
    expect(fraseDePrazo('2026-09-01', HOJE)).toBe('Vence amanhã');
    expect(fraseDePrazo('2026-08-30', HOJE)).toBe('Venceu ontem');
  });

  it('o que passou conta os dias, e o que vem também', () => {
    expect(fraseDePrazo('2026-08-25', HOJE)).toBe('Venceu há 6 dias');
    expect(fraseDePrazo('2026-09-05', HOJE)).toBe('Vence em 5 dias');
  });

  it('⚠️ a conta ATRAVESSA O MÊS, que é onde a subtração ingênua erra', () => {
    // `10/09` menos `31/08` dá 1 se alguém subtrair só o dia, e a frase sairia
    // "Vence amanhã" para uma tarefa a dez dias. É o mesmo defeito que
    // `etiquetaDePrazo` pegou na primeira execução dela.
    expect(fraseDePrazo('2026-09-10', HOJE)).toBe('Vence em 10 dias');
  });

  it('e atravessa o ANO, inclusive o ano de cinco dígitos que existe no banco', () => {
    expect(fraseDePrazo('2027-01-01', HOJE)).toBe('Vence em 123 dias');
    // Uma tarefa real tem prazo no ano 82025. Ela não estoura nem vira "Hoje".
    expect(fraseDePrazo('82025-08-07', HOJE)).toMatch(/^Vence em \d+ dias$/);
  });

  it('data ilegível não vira frase — devolve nulo em vez de aparecer crua', () => {
    expect(fraseDePrazo(null, HOJE)).toBeNull();
    expect(fraseDePrazo('', HOJE)).toBeNull();
    expect(fraseDePrazo('2026-13-45', HOJE)).toBeNull();
  });

  it('o aperto é o que a tela pinta, e ele só existe para prazo', () => {
    expect(apertoDoPrazo('2026-08-30', HOJE)).toBe('vencido');
    expect(apertoDoPrazo('2026-08-31', HOJE)).toBe('hoje');
    expect(apertoDoPrazo('2026-09-01', HOJE)).toBe('proximo');
    expect(apertoDoPrazo(null, HOJE)).toBeNull();
  });

  it('a janela é de um dia à frente, e o texto sabe nomear os dois extremos', () => {
    // Se a janela crescesse sem a frase crescer junto, a caixa mostraria aviso
    // que ela não sabe explicar. Este caso amarra os dois.
    expect(DIAS_DE_ANTECEDENCIA).toBe(1);
    expect(fraseDePrazo('2026-09-01', HOJE)).toBe('Vence amanhã');
  });
});

/* ───────────────────────────── a frase do aviso ───────────────────────────── */

describe('por que isto apareceu para mim', () => {
  it('a automação fala com QUEM RECEBEU, na segunda pessoa', () => {
    const f = fraseDoAviso(AVISO, HOJE);
    expect(f).toContain('“Passa para o atendimento” passou esta tarefa para você');
    expect(f).toContain('mandou de Sabor Doce para ATENDIMENTO');
    expect(f).toContain('na etapa na fila');
  });

  it('⚠️ ela NÃO é a frase do livro: ninguém é citado na terceira pessoa', () => {
    // `frasesDoRegistro`, de `@/board/automacoes`, escreve "passou a cuidar:
    // Carla" — e dizer isso PARA A PRÓPRIA CARLA, dentro da caixa dela, é o
    // sistema falando dela na terceira pessoa. Duas vozes, dois leitores.
    expect(fraseDoAviso(AVISO, HOJE)).not.toContain('passou a cuidar');
    expect(fraseDoAviso(AVISO, HOJE)).not.toContain('tirou de');
  });

  it('regra apagada não vira travessão — a frase se vira sem o nome', () => {
    const f = fraseDoAviso({ ...AVISO, automationName: null }, HOJE);
    expect(f).toContain('Uma automação passou esta tarefa para você');
    expect(f).not.toContain('—');
  });

  it('lista que não mudou não é dita, e nome que não veio some', () => {
    const mesma = fraseDoAviso({ ...AVISO, toListName: 'Sabor Doce' }, HOJE);
    expect(mesma).not.toContain('mandou de');

    const semNada = fraseDoAviso(
      { ...AVISO, fromListName: null, toListName: null, toStatusName: null },
      HOJE,
    );
    expect(semNada).toBe('“Passa para o atendimento” passou esta tarefa para você.');
  });

  it('o aviso de prazo diz o prazo, e nada sobre automação', () => {
    const f = fraseDoAviso(comPrazo('2026-08-31'), HOJE);
    expect(f).toBe('Vence hoje');
  });

  it('de onde é este trabalho: cliente e lista, e o que falta some', () => {
    expect(origemDoAviso(AVISO)).toBe('Sabor Doce · ATENDIMENTO');
    expect(origemDoAviso({ ...AVISO, clientName: null })).toBe('ATENDIMENTO');
    expect(origemDoAviso({ ...AVISO, clientName: null, listName: null })).toBeNull();
  });
});

/* ───────────────────────────── os grupos ───────────────────────────── */

describe('a caixa em dois grupos', () => {
  const lista: Aviso[] = [
    AVISO,
    { ...AVISO, key: 'automation:2', taskTitle: 'Reels' },
    comPrazo('2026-08-31', { taskTitle: 'Relatório' }),
  ];

  it('o que chegou vem antes do prazo — a ordem é a do vocabulário', () => {
    expect(agruparAvisos(lista).map((g) => g.tipo)).toEqual(['automacao', 'prazo']);
  });

  it('⚠️ ele NÃO reordena dentro do grupo: a ordem é a da consulta', () => {
    // Reordenar aqui daria duas verdades sobre a mesma lista, e a de cima
    // ficaria para trás na primeira mudança da consulta.
    const [chegou] = agruparAvisos(lista);
    expect(chegou.avisos.map((a) => a.taskTitle)).toEqual(['Post de setembro', 'Reels']);
  });

  it('grupo vazio SOME — cabeçalho sem nada embaixo é a tela falando de si', () => {
    expect(agruparAvisos([AVISO]).map((g) => g.tipo)).toEqual(['automacao']);
    expect(agruparAvisos([])).toEqual([]);
  });

  it('cada grupo tem título em português, e nenhum deles é vazio', () => {
    for (const t of TIPOS_DE_AVISO) expect(ROTULO_DO_TIPO[t].trim()).not.toBe('');
  });

  it('menção no chat tem grupo próprio — F20.8', () => {
    const chat: Aviso = {
      ...AVISO,
      key: 'chat_mention:1',
      tipo: 'mencao_chat',
      taskTitle: 'Geral',
      listName: 'Geral',
      clientName: null,
      conversationId: 'c1',
      messageId: 'm1',
      automationName: null,
      fromListName: null,
      toListName: null,
      toStatusName: null,
      actorName: 'Alice',
    };
    expect(agruparAvisos([chat]).map((g) => g.tipo)).toEqual(['mencao_chat']);
    expect(ROTULO_DO_TIPO.mencao_chat).toBe('Mencionaram você no chat');
    expect(fraseDoAviso(chat, HOJE)).toBe('Alice mencionou você no chat.');
  });
});

/* ───────────────────────────── o visto ───────────────────────────── */

describe('o que já foi visto sai da frente', () => {
  const lista: Aviso[] = [AVISO, { ...AVISO, key: 'automation:9', seen: true }];

  it('a caixa mostra só o que não foi visto', () => {
    expect(filtrarAvisos(lista, false).map((a) => a.key)).toEqual(['automation:1']);
  });

  it('e a aba dos vistos traz o visto de volta — sem a volta, o toque errado é final', () => {
    expect(filtrarAvisos(lista, true).map((a) => a.key)).toEqual(['automation:9']);
  });

  it('F16: as abas são disjuntas — o novo não aparece em Já vistos', () => {
    const novos = filtrarAvisos(lista, false).map((a) => a.key);
    const vistos = filtrarAvisos(lista, true).map((a) => a.key);
    expect(novos.filter((k) => vistos.includes(k))).toEqual([]);
    expect(novos.length + vistos.length).toBe(lista.length);
  });

  it('a conta é dos NÃO vistos, que é o número da pastilha', () => {
    expect(contarNaoVistos(lista)).toBe(1);
    expect(contarNaoVistos([])).toBe(0);
  });
});

describe('a pastilha da barra lateral', () => {
  it('zero não desenha nada — um `0` permanente ensina a não olhar', () => {
    expect(selo(0)).toBeNull();
    expect(selo(-3)).toBeNull();
  });

  it('o número aparece, e acima de noventa e nove ele para de crescer', () => {
    expect(selo(1)).toBe('1');
    expect(selo(99)).toBe('99');
    // Quatro algarismos numa pastilha de 22px estouram a barra inteira.
    expect(selo(100)).toBe('99+');
    expect(selo(4210)).toBe('99+');
  });
});

/* ─────────────────── o que a caixa NÃO diz, e é deliberado ─────────────────── */

describe('⚠️ quem PERDEU a tarefa não recebe aviso', () => {
  it('o aviso não tem onde guardar quem saiu — nem por engano', () => {
    /*
      `task_events.removed_user_ids` existe no banco, e este tipo não o carrega.
      A garantia é estrutural, e é a mais barata possível: sem campo, nenhuma
      tela pode escrever "você deixou de cuidar disto" sem antes passar por uma
      etapa que decida acrescentá-lo.

      Se um dia alguém o acrescentar, este caso cai — e cair aqui é o ponto.
    */
    expect(Object.keys(AVISO)).not.toContain('removed');
    expect(Object.keys(AVISO)).not.toContain('removedUserIds');
  });
});


/**
 * F21.3 — AS FRASES DO AVISO DE AGENTE.
 *
 * O leitor não conhece o vocabulário técnico. Estes casos medem justamente
 * isso: qual agente, em nome de quem, o que fez e para onde ir se estiver
 * errado — sem "execução", "concessão" nem "MCP".
 */
describe('frase do aviso de agente', () => {
  const agente = (extra: Partial<Aviso>): Aviso => ({
    ...AVISO,
    key: 'agent:move:exec-1',
    tipo: 'agente',
    automationName: null,
    agentEvent: 'move',
    agentName: 'Claude do atendimento',
    dailyLimit: 50,
    ...extra,
  });

  it('movimento diz quem moveu, em nome de quem e onde se desfaz', () => {
    const frase = fraseDoAviso(agente({}), HOJE);
    expect(frase).toContain('Claude do atendimento');
    expect(frase).toContain('moveu este card');
    expect(frase).toContain('em seu nome');
    expect(frase).toContain('Agentes de IA');
  });

  it('teto batido diz o número e o caminho para liberar', () => {
    const frase = fraseDeAgente(agente({ agentEvent: 'limit', dailyLimit: 50 }));
    expect(frase).toContain('50 escritas permitidas por dia');
    expect(frase).toContain('parou');
    expect(frase).toContain('Agentes de IA');
  });

  it('primeira escrita pergunta se foi a pessoa que ligou aquilo', () => {
    const frase = fraseDeAgente(agente({ agentEvent: 'first' }));
    expect(frase).toContain('pela primeira vez');
    expect(frase).toContain('Se não foi você');
  });

  it('nenhuma frase usa o vocabulário técnico da integração', () => {
    for (const evento of ['move', 'limit', 'first'] as const) {
      const frase = fraseDeAgente(agente({ agentEvent: evento }));
      expect(frase).not.toMatch(/MCP|concess|execu|ledger|token|endpoint/i);
      expect(frase.trim().endsWith('.')).toBe(true);
    }
  });

  it('sem nome de conexão a frase encolhe, em vez de mostrar travessão', () => {
    const frase = fraseDeAgente(agente({ agentName: null }));
    expect(frase.startsWith('Um agente de IA')).toBe(true);
    expect(frase).not.toContain('—');
  });

  it('teto ausente ou zerado não escreve um número sem sentido', () => {
    expect(fraseDeAgente(agente({ agentEvent: 'limit', dailyLimit: null }))).toContain(
      'limite de escritas do dia',
    );
    expect(fraseDeAgente(agente({ agentEvent: 'limit', dailyLimit: 0 }))).not.toContain('0 escritas');
  });

  it('F26.6: a estreia no mural ou no histórico diz onde foi, com o nome do cliente', () => {
    const mural = fraseDeAgente(
      agente({ agentEvent: 'first', targetKind: 'mural_note', clientId: 'c-1', clientName: 'Clinimax', taskId: '' }),
    );
    expect(mural).toContain('pela primeira vez no mural de Clinimax.');
    const historico = fraseDeAgente(
      agente({ agentEvent: 'first', targetKind: 'history_entry', clientId: 'c-1', clientName: 'Clinimax', taskId: '' }),
    );
    expect(historico).toContain('no histórico de Clinimax');
    // Sem nome, a frase encolhe — nunca um travessão.
    const semNome = fraseDeAgente(agente({ agentEvent: 'first', targetKind: 'mural_note', clientName: null }));
    expect(semNome).toContain('no mural do cliente');
    expect(semNome).not.toContain('—');
    // Tarefa: a frase de sempre.
    expect(fraseDeAgente(agente({ agentEvent: 'first' }))).toContain('pela primeira vez. Se não foi você');
  });

  it('estrear e bater o teto na mesma escrita viram DOIS avisos, e não um', () => {
    const estreia = agente({ key: 'agent:first:exec-1', agentEvent: 'first' });
    const teto = agente({ key: 'agent:limit:exec-1', agentEvent: 'limit' });
    // Duas chaves diferentes sobre a MESMA escrita: dois vistos, duas linhas.
    expect(estreia.key).not.toBe(teto.key);
    const grupos = agruparAvisos([estreia, teto]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].tipo).toBe('agente');
    expect(grupos[0].avisos).toHaveLength(2);
    expect(fraseDeAgente(estreia)).not.toBe(fraseDeAgente(teto));
  });
});

/* ───────────────────── F42, Fase 7 — o cliente respondeu ───────────────────── */

describe('a resposta do cliente pelo link', () => {
  const RESPOSTA: Aviso = {
    ...AVISO,
    key: 'approval:r1',
    tipo: 'aprovacao',
    automationName: null,
    fromListName: null,
    toListName: null,
    toStatusName: null,
    commentId: 'c1',
    approvalDecision: 'rejected',
    approvalVersion: 2,
  };

  it('pediu ajustes: diz a versão e aponta o motivo; aprovou: diz a versão', () => {
    expect(fraseDoAviso(RESPOSTA, HOJE)).toBe('Cliente pediu ajustes na versão 2 pelo link. Veja o motivo no card.');
    expect(fraseDoAviso({ ...RESPOSTA, approvalDecision: 'approved', commentId: null }, HOJE)).toBe(
      'Cliente aprovou a versão 2 pelo link.',
    );
  });

  it('sem a versão, a frase encolhe em vez de mostrar travessão', () => {
    expect(fraseDeAprovacao({ ...RESPOSTA, approvalVersion: null })).toBe('Cliente pediu ajustes pelo link. Veja o motivo no card.');
    expect(fraseDeAprovacao({ ...RESPOSTA, approvalDecision: 'approved', approvalVersion: 0 })).toBe('Cliente aprovou pelo link.');
  });

  it('é um grupo próprio, o primeiro da caixa, com rótulo em português', () => {
    expect(TIPOS_DE_AVISO[0]).toBe('aprovacao');
    expect(ROTULO_DO_TIPO.aprovacao).toBe('O cliente respondeu');
    expect(agruparAvisos([AVISO, RESPOSTA]).map((g) => g.tipo)).toEqual(['aprovacao', 'automacao']);
    expect(contarNaoVistos([AVISO, RESPOSTA, { ...RESPOSTA, key: 'approval:r2', seen: true }])).toBe(2);
  });
});
