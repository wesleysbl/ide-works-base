import { describe, expect, it } from 'vitest';

import { calculateDeliveryLevel } from '@/delivery/level';
import {
  type LinhaDoMes,
  agruparMesPorResponsavel,
  juntarComE,
  juntarLeituras,
  listaDeAtencao,
  planejarMes,
  quantidadeDoTipo,
} from '@/painel/planejamento-do-mes';
import type { PlanningRow } from '@/server/planning';
import type { PlanningWeekItem, PlanningWeeksRow } from '@/server/planning-weeks';

let seq = 0;
const peca = (over: Partial<PlanningWeekItem> = {}): PlanningWeekItem => ({
  id: `p${++seq}`,
  contentType: 'arte',
  scheduledAt: null,
  completedAt: null,
  isExtra: false,
  title: null,
  ...over,
});
/** Agendada ao meio-dia UTC, como a grade grava (`meioDiaDoDia`). */
const em = (dia: string, over: Partial<PlanningWeekItem> = {}) => peca({ scheduledAt: `${dia}T12:00:00Z`, ...over });
const feita = (dia: string, over: Partial<PlanningWeekItem> = {}) =>
  em(dia, { completedAt: `${dia}T15:00:00Z`, ...over });

const dasSemanas = (id: string, name: string, over: Partial<PlanningWeeksRow> = {}): PlanningWeeksRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Agência',
  plan: null,
  owners: [],
  quotaSource: 'contrato',
  quota: { arte: 8 },
  hasContentContract: true,
  items: [],
  ...over,
});
const doRitual = (id: string, name: string, over: Partial<PlanningRow> = {}): PlanningRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Agência',
  plan: null,
  monthOpened: true,
  planningDoneAt: null,
  clientApprovedAt: null,
  ...over,
});

/*
 * Hoje fixo: quarta, 14/10/2026 — semana 3 (12–18). Outubro/2026 começa numa
 * quinta: semanas 01–04 (2 dias úteis), 05–11, 12–18, 19–25, 26–31 (5 cada).
 * Metas: 8 artes → [0, 2, 2, 2, 2]; 4 vídeos → [0, 1, 1, 1, 1].
 */
const HOJE = '2026-10-14';
const MES = '2026-10';

/** Um cliente presente nas duas leituras, contado em outubro. */
const umCliente = (
  semanas: PlanningWeeksRow,
  ritual: Partial<PlanningRow> = {},
  extra: { mes?: string; limiteSemDia?: number } = {},
): LinhaDoMes =>
  planejarMes({
    ritual: [doRitual(semanas.id, semanas.name, ritual)],
    semanas: [semanas],
    mes: extra.mes ?? MES,
    hoje: HOJE,
    limiteSemDia: extra.limiteSemDia,
  })[0];

const chaves = (l: LinhaDoMes) => l.motivos.map((m) => m.chave);
const texto = (l: LinhaDoMes, chave: string) => l.motivos.find((m) => m.chave === chave)?.texto;
/** A semana 2 (05–11) batida em artes: o que não é assunto do teste não vira motivo. */
const semana2Batida = () => [feita('2026-10-06'), feita('2026-10-07')];

describe('juntarLeituras', () => {
  it('junta pelo id e põe em ordem de nome (pt-BR), seja qual for a ordem de cada leitura', () => {
    const clientes = juntarLeituras(
      [doRitual('z', 'Zeta'), doRitual('a', 'Árvore', { planningDoneAt: '2026-10-02T10:00:00.000Z' }), doRitual('b', 'Bravo')],
      [dasSemanas('b', 'Bravo'), dasSemanas('z', 'Zeta'), dasSemanas('a', 'Árvore', { owners: [{ id: 'u1', name: 'Carla' }] })],
    );
    expect(clientes.map((c) => c.name)).toEqual(['Árvore', 'Bravo', 'Zeta']);
    expect(clientes.every((c) => c.leitura === 'completa')).toBe(true);
    // O ritual vem do ritual; responsáveis e contrato, das semanas.
    expect(clientes[0].planningDoneAt).toBe('2026-10-02T10:00:00.000Z');
    expect(clientes[0].owners).toEqual([{ id: 'u1', name: 'Carla' }]);
    expect(clientes[0].quota).toEqual({ arte: 8 });
  });

  it('cliente só nas semanas: o mês aberto sai da origem da cota; planejado e aprovado ficam nulos', () => {
    const [aberto, fechado] = juntarLeituras(
      [],
      [dasSemanas('a', 'Alfa'), dasSemanas('b', 'Bravo', { quotaSource: 'cadastro' })],
    );
    expect(aberto).toMatchObject({ leitura: 'so-semanas', monthOpened: true, planningDoneAt: null, clientApprovedAt: null });
    expect(fechado).toMatchObject({ leitura: 'so-semanas', monthOpened: false });
  });

  it('cliente só no ritual: aparece sem responsável, sem contrato e sem peça', () => {
    const [c] = juntarLeituras([doRitual('a', 'Alfa', { monthOpened: false })], []);
    expect(c).toMatchObject({
      leitura: 'so-ritual',
      owners: [],
      quota: {},
      items: [],
      hasContentContract: false,
      quotaSource: 'nenhuma',
    });
  });
});

describe('contrato por tipo', () => {
  it('as peças do contrato caem em seis baldes que somam o contrato', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', {
        items: [
          feita('2026-10-06'),
          peca({ completedAt: '2026-10-02T10:00:00Z' }), // entregue sem dia ainda é entregue
          em('2026-10-15'), // marcada
          em('2026-10-13'), // atrasada
          em('2026-11-03'), // fora do mês, no prazo
          peca(), // sem dia
        ],
      }),
    );
    const arte = l.tipos.find((t) => t.tipo === 'arte')!;
    expect(arte).toMatchObject({
      contrato: 8,
      entregues: 2,
      marcadas: 1,
      atrasadas: 1,
      foraDoMes: 1,
      semDia: 1,
      naoCriadas: 2,
      faltaMarcar: 3,
    });
    const { entregues, marcadas, atrasadas, foraDoMes, semDia, naoCriadas } = arte;
    expect(entregues + marcadas + atrasadas + foraDoMes + semDia + naoCriadas).toBe(arte.contrato);
  });

  it('a peça das 22h do último dia do mês é marcada no mês, e não "fora do mês" (dia de São Paulo, não de UTC)', () => {
    // 22h de 31/10 em São Paulo = 01h de 01/11 em UTC. O Calendário a mostra em outubro.
    const as22hDe31 = peca({ scheduledAt: '2026-11-01T01:00:00.000Z' });
    const arte = umCliente(dasSemanas('a', 'Alfa', { items: [as22hDe31] })).tipos[0];
    expect(arte).toMatchObject({ marcadas: 1, foraDoMes: 0 });
  });

  it('peça vencida fora do mês é atrasada, não "fora do mês"', () => {
    const arte = umCliente(dasSemanas('a', 'Alfa', { items: [em('2026-09-29')] })).tipos[0];
    expect(arte.atrasadas).toBe(1);
    expect(arte.foraDoMes).toBe(0);
  });

  it('extra não infla o entregue do contrato — e bate com o medidor de entrega', () => {
    const items = [
      feita('2026-10-06'),
      feita('2026-10-07'),
      feita('2026-10-08', { isExtra: true }),
      feita('2026-10-09', { isExtra: true }),
      feita('2026-10-12', { isExtra: true }),
      em('2026-10-13', { isExtra: true }), // extra atrasada
      em('2026-10-20', { isExtra: true }), // extra no prazo
    ];
    const arte = umCliente(dasSemanas('a', 'Alfa', { quota: { arte: 4 }, items })).tipos[0];
    expect(arte).toMatchObject({ contrato: 4, entregues: 2, extras: 3, extrasPendentes: 2, extrasAtrasadas: 1 });
    // A extra pendente não ocupa vaga do contrato: as 2 que faltam seguem sem dia.
    expect(arte.marcadas + arte.atrasadas).toBe(0);
    expect(arte.faltaMarcar).toBe(2);

    const medidor = calculateDeliveryLevel(
      [{ contentType: 'arte', quantity: 4 }],
      items.map((p) => ({ contentType: p.contentType, isExtra: p.isExtra, isCompleted: p.completedAt !== null })),
    );
    expect(medidor.measurable && medidor.breakdown[0]).toMatchObject({ contracted: 4, delivered: 2, extras: 3 });
  });

  it('peça de tipo sem contrato é extra', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { quota: { arte: 2 }, items: [feita('2026-10-06', { contentType: 'foto' })] }));
    expect(l.tipos.map((t) => t.tipo)).toEqual(['arte', 'foto']);
    expect(l.tipos[1]).toMatchObject({ contrato: 0, entregues: 0, extras: 1, faltaMarcar: 0 });
  });

  it('a semana de hoje é a célula da F35, sem recontar', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', { items: [...semana2Batida(), feita('2026-10-12'), em('2026-10-13'), em('2026-10-15')] }),
    );
    expect(l.quando).toBe('atual');
    expect(l.semanaAtual).toMatchObject({ numero: 3, de: '2026-10-12', ate: '2026-10-18' });
    expect(l.tipos[0].semana).toEqual({ meta: 2, feitas: 1, marcadas: 1, atrasadas: 1, estado: 'andamento' });
  });
});

describe('motivos de atenção (hoje fixo: quarta, 14/10/2026)', () => {
  it('cliente sem contrato fica fora da atenção, mesmo com peça atrasada e mês fechado', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', { quotaSource: 'nenhuma', quota: {}, hasContentContract: false, items: [em('2026-10-05')] }),
      { monthOpened: false },
    );
    expect(l.temContrato).toBe(false);
    expect(l.motivos).toEqual([]);
    expect(l.peso).toBe(0);
    expect(listaDeAtencao([l])).toEqual([]);
  });

  it('o contrato congelado do mês vale mesmo com o cadastro zerado depois', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { hasContentContract: false, items: semana2Batida() }));
    expect(l.temContrato).toBe(true);
    expect(chaves(l)).toContain('semana-sem-peca');
  });

  it('mês não aberto: diz isso e não repete "nada marcado" nem "sem dia"', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { quotaSource: 'cadastro' }), { monthOpened: false });
    expect(l.estagio).toBe('fechado');
    expect(l.rotuloDoEstagio).toBe('mês não aberto');
    expect(l.motivos).toEqual([{ chave: 'mes-nao-aberto', texto: 'O mês de outubro ainda não foi aberto.', peso: 60 }]);
  });

  it('mês não aberto com peça vencida: a atrasada é fato à parte e aparece também', () => {
    // Sem mês aberto o servidor cria tudo como extra (cota zero).
    const l = umCliente(dasSemanas('a', 'Alfa', { quotaSource: 'cadastro', items: [em('2026-10-09', { isExtra: true })] }), {
      monthOpened: false,
    });
    expect(chaves(l)).toEqual(['mes-nao-aberto', 'atrasadas']);
  });

  it('semana sem nada marcado, com meta: diz o que o contrato pede, e não repete "em risco"', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', {
        quota: { arte: 8, video: 4 },
        items: [...semana2Batida(), feita('2026-10-08', { contentType: 'video' })],
      }),
    );
    expect(texto(l, 'semana-sem-peca')).toBe('Nada marcado esta semana. O contrato pede 1 vídeo e 2 artes.');
    expect(chaves(l)).not.toContain('semana-em-risco');
    expect(texto(l, 'sem-dia')).toBe('3 dos 4 vídeos e 6 das 8 artes do mês ainda estão sem dia.');
    expect(l.peso).toBe(50);
  });

  it('qualquer peça na semana tira o "nada marcado" — e o que falta vira "em risco"', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', {
        quota: { arte: 8, video: 4 },
        items: [
          ...semana2Batida(),
          feita('2026-10-08', { contentType: 'video' }),
          em('2026-10-15', { contentType: 'foto', isExtra: true }),
        ],
      }),
    );
    expect(chaves(l)).not.toContain('semana-sem-peca');
    expect(texto(l, 'semana-em-risco')).toBe('Esta semana está em risco: falta marcar 1 vídeo e 2 artes.');
  });

  it('semana em risco por vaga sem peça', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { items: [...semana2Batida(), em('2026-10-15')] }));
    expect(texto(l, 'semana-em-risco')).toBe('Esta semana está em risco: falta marcar 1 arte.');
  });

  it('semana em risco porque o que falta não cabe nos dias úteis', () => {
    // 30 artes → meta 7 na semana 3; sobram 3 dias úteis (14, 15, 16).
    const semana2 = Array.from({ length: 7 }, (_, i) => feita(`2026-10-0${5 + (i % 5)}`));
    const semana3 = Array.from({ length: 7 }, (_, i) => em(i < 4 ? '2026-10-15' : '2026-10-16'));
    const l = umCliente(dasSemanas('a', 'Alfa', { quota: { arte: 30 }, items: [...semana2, ...semana3] }));
    expect(texto(l, 'semana-em-risco')).toBe('Esta semana está em risco: falta entregar 7 artes em 3 dias úteis.');
  });

  it('semana em risco só por peça atrasada: quem fala é "atrasadas"', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { items: [...semana2Batida(), em('2026-10-13'), em('2026-10-15')] }));
    expect(l.planejamento.emRisco).toBe(true);
    expect(chaves(l)).not.toContain('semana-em-risco');
    expect(texto(l, 'atrasadas')).toBe('1 peça passou do dia sem entrega.');
  });

  it('peças atrasadas contam o contrato e a extra; a semana que elas derrubaram não repete', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', {
        items: [em('2026-10-06'), em('2026-10-07'), em('2026-10-09', { isExtra: true }), em('2026-10-15'), em('2026-10-16')],
      }),
    );
    expect(texto(l, 'atrasadas')).toBe('3 peças passaram do dia sem entrega.');
    expect(l.planejamento.abaixo).toBe(true);
    expect(chaves(l)).not.toContain('semana-anterior-abaixo');
  });

  it('semana passada abaixo da meta, com vaga que nenhuma peça ocupou', () => {
    const l = umCliente(dasSemanas('a', 'Alfa', { items: [feita('2026-10-06'), em('2026-10-15'), em('2026-10-16')] }));
    expect(texto(l, 'semana-anterior-abaixo')).toBe('A semana passada fechou abaixo da meta (1 de 2 artes).');
  });

  it('muitas peças do contrato sem dia — o limite é configurável', () => {
    const items = [...semana2Batida(), em('2026-10-15'), em('2026-10-16'), peca(), peca(), peca(), peca()];
    const l = umCliente(dasSemanas('a', 'Alfa', { items }));
    expect(l.motivos).toEqual([{ chave: 'sem-dia', texto: '4 das 8 artes do mês ainda estão sem dia.', peso: 10 }]);
    expect(umCliente(dasSemanas('a', 'Alfa', { items }), {}, { limiteSemDia: 5 }).motivos).toEqual([]);
  });

  it('na última semana do mês, o contrato pequeno sem dia também pede atenção', () => {
    // 2 vídeos: metas [0, 1, 1, 0, 0]. Da semana 4 em diante a meta é 0 e a
    // semana passada não "fechou abaixo"; com só 2 peças sem dia (< 3), nenhum
    // motivo sobrava — e o cliente com o mês inteiro por entregar sumia da faixa.
    const cliente = dasSemanas('a', 'Alfa', { quota: { video: 2 } });
    const em = (hoje: string) =>
      planejarMes({ ritual: [doRitual('a', 'Alfa')], semanas: [cliente], mes: MES, hoje })[0];

    const ultima = em('2026-10-28'); // quarta da semana 5 (26–31), a última
    expect(ultima.semanaAtual?.numero).toBe(5);
    expect(texto(ultima, 'sem-dia')).toBe('Os 2 vídeos do mês ainda estão sem dia.');

    // Antes da última semana ainda dá tempo, e dois sem dia não são ruído para a faixa.
    expect(chaves(em('2026-10-21'))).not.toContain('sem-dia'); // semana 4
    expect(chaves(em('2026-10-07'))).not.toContain('sem-dia'); // semana 2
  });

  it('na última semana, contrato todo marcado não acusa sem dia', () => {
    const cliente = dasSemanas('a', 'Alfa', { quota: { video: 2 }, items: [feita('2026-10-06', { contentType: 'video' }), em('2026-10-29', { contentType: 'video' })] });
    const l = planejarMes({ ritual: [doRitual('a', 'Alfa')], semanas: [cliente], mes: MES, hoje: '2026-10-28' })[0];
    expect(chaves(l)).not.toContain('sem-dia');
  });

  it('peça que nem existe conta como sem dia', () => {
    // Novembro aberto e vazio: as 8 artes ainda não nasceram.
    const l = umCliente(dasSemanas('a', 'Alfa'), {}, { mes: '2026-11' });
    expect(l.tipos[0]).toMatchObject({ semDia: 0, naoCriadas: 8, faltaMarcar: 8 });
    expect(texto(l, 'sem-dia')).toBe('As 8 artes do mês ainda estão sem dia.');
  });

  it('mês que não é o atual não tem motivo de semana', () => {
    // Setembro: toda semana já passou e ficou abaixo — mas "esta semana" não é de setembro.
    const setembro = umCliente(dasSemanas('a', 'Alfa', { quota: { arte: 4 } }), {}, { mes: '2026-09' });
    expect(setembro.quando).toBe('passado');
    expect(setembro.semanaAtual).toBeNull();
    expect(setembro.tipos[0].semana).toBeNull();
    expect(setembro.planejamento.abaixo).toBe(true);
    expect(setembro.motivos).toEqual([{ chave: 'sem-dia', texto: 'As 4 artes do mês ficaram sem dia.', peso: 10 }]);

    const novembro = umCliente(dasSemanas('a', 'Alfa', { quota: { arte: 1 } }), {}, { mes: '2026-11', limiteSemDia: 1 });
    expect(novembro.quando).toBe('futuro');
    expect(novembro.motivos.map((m) => m.texto)).toEqual(['A arte do mês ainda está sem dia.']);
  });

  it('cliente que só existe numa das leituras', () => {
    const [soRitual, soSemanas] = planejarMes({
      ritual: [doRitual('a', 'Alfa', { monthOpened: false })],
      semanas: [dasSemanas('b', 'Bravo', { quotaSource: 'cadastro' })],
      mes: MES,
      hoje: HOJE,
    });
    // Sem a leitura das peças não há prova de contrato: aparece, não é acusado.
    expect(soRitual).toMatchObject({ leitura: 'so-ritual', temContrato: false, tipos: [], motivos: [] });
    // Sem o ritual, o mês fechado sai de `quotaSource` — e o motivo aparece.
    expect(soSemanas.leitura).toBe('so-semanas');
    expect(chaves(soSemanas)).toEqual(['mes-nao-aberto']);
  });
});

describe('listaDeAtencao', () => {
  it('só quem tem motivo, do mais pesado ao mais leve, e o nome (pt-BR) no empate', () => {
    const nadaNaSemana = { items: semana2Batida() };
    const linhas = planejarMes({
      ritual: [doRitual('z', 'Zeta', { monthOpened: false })],
      semanas: [
        dasSemanas('z', 'Zeta', { quotaSource: 'cadastro' }), // mês não aberto (60)
        dasSemanas('al', 'Alfa', {
          items: [...semana2Batida(), em('2026-10-15'), em('2026-10-16'), peca(), peca(), peca(), peca()],
        }), // só sem dia (10)
        dasSemanas('b', 'Bravo', nadaNaSemana), // nada marcado (50)
        dasSemanas('ar', 'Árvore', nadaNaSemana), // nada marcado (50)
        dasSemanas('c', 'Cedro', { quotaSource: 'nenhuma', quota: {}, hasContentContract: false }), // sem contrato
        dasSemanas('d', 'Delta', { quota: { arte: 2 }, items: [feita('2026-10-06'), em('2026-10-15')] }), // em dia
      ],
      mes: MES,
      hoje: HOJE,
    });
    expect(linhas.map((l) => l.name)).toEqual(['Alfa', 'Árvore', 'Bravo', 'Cedro', 'Delta', 'Zeta']);
    const lista = listaDeAtencao(linhas);
    expect(lista.map((l) => l.name)).toEqual(['Zeta', 'Árvore', 'Bravo', 'Alfa']);
    expect(lista.map((l) => l.peso)).toEqual([60, 50, 50, 10]);
    // Dentro do cliente, também do mais pesado ao mais leve.
    expect(chaves(lista[1])).toEqual(['semana-sem-peca', 'sem-dia']);
  });
});

describe('agruparMesPorResponsavel', () => {
  it('o cliente de dois responsáveis aparece nos dois grupos (decisão da F35)', () => {
    const carla = { id: 'u1', name: 'Carla' };
    const helena = { id: 'u2', name: 'Helena' };
    const linhas = planejarMes({
      ritual: [],
      semanas: [
        dasSemanas('a', 'Alfa', { owners: [carla] }),
        dasSemanas('b', 'Bravo', { owners: [carla, helena] }),
        dasSemanas('c', 'Cedro'),
      ],
      mes: MES,
      hoje: HOJE,
    });
    const grupos = agruparMesPorResponsavel(linhas);
    expect(grupos.map((g) => [g.nome, g.linhas.map((l) => l.name)])).toEqual([
      ['Carla', ['Alfa', 'Bravo']],
      ['Helena', ['Bravo']],
      ['Sem responsável', ['Cedro']],
    ]);
    // A linha agrupada é a mesma, com motivos e contrato.
    expect(grupos[1].linhas[0]).toBe(linhas[1]);
  });
});

describe('nomes dos tipos', () => {
  it('plural e o "ads" invariável', () => {
    expect(
      [
        [1, 'video'],
        [2, 'video'],
        [1, 'arte'],
        [2, 'arte'],
        [1, 'foto'],
        [3, 'foto'],
        [1, 'ads'],
        [2, 'ads'],
      ].map(([n, t]) => quantidadeDoTipo(n as number, t as 'video' | 'arte' | 'foto' | 'ads')),
    ).toEqual(['1 vídeo', '2 vídeos', '1 arte', '2 artes', '1 foto', '3 fotos', '1 ads', '2 ads']);
  });

  it('junta com vírgula e "e"', () => {
    expect(juntarComE([])).toBe('');
    expect(juntarComE(['a'])).toBe('a');
    expect(juntarComE(['a', 'b'])).toBe('a e b');
    expect(juntarComE(['a', 'b', 'c'])).toBe('a, b e c');
  });

  it('masculino e feminino na frase do "sem dia"', () => {
    const l = umCliente(
      dasSemanas('a', 'Alfa', { quota: { video: 4, ads: 3 }, items: [em('2026-10-15', { contentType: 'video' })] }),
      {},
      { mes: '2026-11' },
    );
    // Em novembro a peça de 15/10 é "fora do mês" — tem dia, então não falta marcar.
    expect(texto(l, 'sem-dia')).toBe('3 dos 4 vídeos e os 3 ads do mês ainda estão sem dia.');
  });
});
