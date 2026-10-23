import { describe, expect, it } from 'vitest';

import { calculateDeliveryLevel } from '@/delivery/level';
import {
  type ClienteDoPainel,
  FILTRO_VAZIO,
  contarAtalhos,
  diasAteRenovar,
  filtrarCarteira,
  filtroEstaLimpo,
  ordenarCarteira,
  proximasRenovacoes,
  resumirCarteira,
  ROTULO_DO_MOTIVO,
  motivoSemMedida,
  situacoesDoCliente,
  textoDaUltimaEntrega,
} from '@/painel/carteira';
import type { DeliveryStatus } from '@/delivery/ultima-entrega';
import {
  TETO_DE_IDS,
  destinoDoPainel,
  filtroConhecido,
  filtroDoRecorte,
  lerRecorte,
  periodoValido,
  recorteParaEndereco,
} from '@/painel/recorte';

/** Entrega de verdade: passa pela mesma fórmula que o servidor usa. */
const entrega = (contratado: Record<string, number>, feito: Record<string, number>, extras = 0) =>
  calculateDeliveryLevel(
    Object.entries(contratado).map(([contentType, quantity]) => ({ contentType, quantity })),
    [
      ...Object.entries(feito).flatMap(([contentType, n]) =>
        Array.from({ length: n }, () => ({ contentType, isExtra: false, isCompleted: true })),
      ),
      ...Array.from({ length: extras }, () => ({
        contentType: 'arte',
        isExtra: true,
        isCompleted: true,
      })),
    ],
  );

const cliente = (over: Partial<ClienteDoPainel> = {}): ClienteDoPainel => ({
  id: 'c1',
  name: 'Cliente',
  categoryId: 'cat-ide',
  categoryName: 'IDE',
  categorySortOrder: 0,
  plan: null,
  urgency: 'paz',
  isActive: true,
  inactiveAt: null,
  financeOk: true,
  startedOn: '2026-01-01',
  renewsOn: null,
  tags: [],
  inPeriod: { scheduled: 0, completed: 0 },
  delivery: entrega({ arte: 4 }, { arte: 2 }),
  deliveryStatus: null,
  ...over,
});

describe('resumirCarteira', () => {
  it('soma o contratado e o entregue de todos os visiveis', () => {
    const r = resumirCarteira([
      cliente({ id: 'a', delivery: entrega({ video: 4, arte: 8 }, { video: 3, arte: 8 }) }),
      cliente({ id: 'b', delivery: entrega({ video: 2 }, { video: 0 }) }),
    ]);

    expect(r.porTipo.video).toEqual({ contracted: 6, delivered: 3, extras: 0 });
    expect(r.porTipo.arte).toEqual({ contracted: 8, delivered: 8, extras: 0 });
    expect(r.total).toBe(2);
  });

  it('conta os extras separados do entregue', () => {
    const r = resumirCarteira([cliente({ delivery: entrega({ arte: 2 }, { arte: 2 }, 3) })]);
    expect(r.porTipo.arte.delivered).toBe(2);
    expect(r.porTipo.arte.extras).toBe(3);
  });

  it('deixa fora da media quem nao tem contrato aberto', () => {
    const r = resumirCarteira([
      cliente({ id: 'a', delivery: entrega({ arte: 4 }, { arte: 4 }) }), // 100
      cliente({ id: 'b', delivery: entrega({ arte: 4 }, { arte: 2 }) }), // 50
      cliente({ id: 'c', delivery: calculateDeliveryLevel([], []) }), // sem contrato
    ]);

    // Se o sem-contrato entrasse como zero, a media cairia para 50.
    expect(r.nivelMedio).toBe(75);
    expect(r.mensuraveis).toBe(2);
    expect(r.total).toBe(3);
  });

  it('devolve media nula quando ninguem tem contrato', () => {
    const r = resumirCarteira([cliente({ delivery: calculateDeliveryLevel([], []) })]);
    expect(r.nivelMedio).toBeNull();
  });

  it('conta urgencia e financeiro pendente', () => {
    const r = resumirCarteira([
      cliente({ id: 'a', urgency: 'perigo', financeOk: false }),
      cliente({ id: 'b', urgency: 'perigo', financeOk: true }),
      cliente({ id: 'c', urgency: 'alerta', financeOk: false }),
    ]);
    expect(r.urgencia).toEqual({ paz: 0, alerta: 1, perigo: 2 });
    expect(r.financeiroPendente).toBe(2);
  });

  it('carteira vazia nao quebra', () => {
    const r = resumirCarteira([]);
    expect(r.total).toBe(0);
    expect(r.nivelMedio).toBeNull();
    expect(r.porTipo.foto).toEqual({ contracted: 0, delivered: 0, extras: 0 });
  });
});

describe('ordenarCarteira', () => {
  const cheio = cliente({ id: 'cheio', name: 'B', delivery: entrega({ arte: 4 }, { arte: 4 }) });
  const meio = cliente({ id: 'meio', name: 'A', delivery: entrega({ arte: 4 }, { arte: 2 }) });
  const semMes = cliente({ id: 'sem', name: 'C', delivery: calculateDeliveryLevel([], []) });

  it('nao altera a lista recebida', () => {
    const lista = [cheio, meio];
    ordenarCarteira(lista, 'entrega', true);
    expect(lista[0]).toBe(cheio);
  });

  it('poe quem nao tem contrato no fim, na crescente', () => {
    const r = ordenarCarteira([semMes, cheio, meio], 'entrega', true);
    expect(r.map((c) => c.id)).toEqual(['meio', 'cheio', 'sem']);
  });

  it('poe quem nao tem contrato no fim TAMBEM na decrescente', () => {
    // O ponto do teste: inverter o sentido nao pode trazer o `null` para o topo.
    const r = ordenarCarteira([semMes, meio, cheio], 'entrega', false);
    expect(r.map((c) => c.id)).toEqual(['cheio', 'meio', 'sem']);
  });

  it('ordena por urgencia com perigo primeiro', () => {
    const r = ordenarCarteira(
      [
        cliente({ id: 'p', urgency: 'paz' }),
        cliente({ id: 'x', urgency: 'perigo' }),
        cliente({ id: 'a', urgency: 'alerta' }),
      ],
      'urgencia',
      true,
    );
    expect(r.map((c) => c.id)).toEqual(['x', 'a', 'p']);
  });

  it('ordena por renovacao mais proxima e joga sem-data para o fim', () => {
    const r = ordenarCarteira(
      [
        cliente({ id: 'sem', renewsOn: null }),
        cliente({ id: 'dez', renewsOn: '2026-12-01' }),
        cliente({ id: 'set', renewsOn: '2026-09-01' }),
      ],
      'renovacao',
      true,
    );
    expect(r.map((c) => c.id)).toEqual(['set', 'dez', 'sem']);
  });

  it('ordena por nome respeitando acento do portugues', () => {
    const r = ordenarCarteira(
      [cliente({ id: '3', name: 'Zeta' }), cliente({ id: '1', name: 'Ática' }), cliente({ id: '2', name: 'Otica' })],
      'nome',
      true,
    );
    expect(r.map((c) => c.name)).toEqual(['Ática', 'Otica', 'Zeta']);
  });

  it('desempata por nome quando o criterio empata', () => {
    const r = ordenarCarteira(
      [
        cliente({ id: 'z', name: 'Zeta', urgency: 'paz' }),
        cliente({ id: 'a', name: 'Alfa', urgency: 'paz' }),
      ],
      'urgencia',
      true,
    );
    expect(r.map((c) => c.name)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('filtrarCarteira', () => {
  const base = [
    cliente({
      id: 'a',
      name: 'Ótica Rubi',
      categoryId: 'ide',
      plan: { id: 'p-basico', name: 'Básico', colorBg: '', colorText: '', colorBorder: '' },
      tags: [{ id: 't-otica', name: 'Ótica', color: '#fff' }],
      urgency: 'perigo',
      financeOk: false,
    }),
    cliente({
      id: 'b',
      name: 'SAAEV',
      categoryId: 'ide',
      plan: { id: 'p-full', name: 'Full', colorBg: '', colorText: '', colorBorder: '' },
      tags: [],
      urgency: 'alerta',
    }),
    cliente({ id: 'c', name: 'Antigo', categoryId: 'hub', isActive: false, inactiveAt: '2026-07-29T00:00:00Z' }),
  ];

  const ids = (f: Partial<typeof FILTRO_VAZIO>) =>
    filtrarCarteira(base, { ...FILTRO_VAZIO, ...f }).map((c) => c.id);

  it('mostra so os ativos por padrao', () => {
    expect(ids({})).toEqual(['a', 'b']);
  });

  it('mostra so os inativos quando pedido', () => {
    expect(ids({ ativo: false })).toEqual(['c']);
  });

  it('ignora o estado quando ativo e nulo', () => {
    expect(ids({ ativo: null })).toEqual(['a', 'b', 'c']);
  });

  it('F31: a unidade não é recorte da tela — o filtro nem tem esse campo', () => {
    // As abas `Todas · Ide · Ide Hub · Alma9` saíram; a carteira é uma só. A
    // unidade de `c` (`hub`) não esconde nem destaca ninguém aqui.
    expect(Object.keys(FILTRO_VAZIO)).not.toContain('categoriaId');
    expect(ids({ ativo: null })).toContain('c');
  });

  it('filtra por plano, e sem-plano nunca casa', () => {
    expect(ids({ planoIds: ['p-full'] })).toEqual(['b']);
    expect(ids({ planoIds: ['p-basico', 'p-full'] })).toEqual(['a', 'b']);
  });

  it('filtra por etiqueta', () => {
    expect(ids({ etiquetaIds: ['t-otica'] })).toEqual(['a']);
  });

  it('filtra por urgencia, aceitando varias', () => {
    expect(ids({ urgencias: ['perigo', 'alerta'] })).toEqual(['a', 'b']);
  });

  it('a busca alcanca nome, plano e etiqueta', () => {
    expect(ids({ busca: 'rubi' })).toEqual(['a']);
    expect(ids({ busca: 'full' })).toEqual(['b']);
    expect(ids({ busca: 'ótica' })).toEqual(['a']);
  });

  it('F31: a busca NÃO casa com o nome da unidade', () => {
    // Todo cliente é da Ide ou da Ide Hub: com a unidade no alcance, buscar
    // "ide" devolvia a carteira inteira e a busca parecia não filtrar.
    const daIde = [
      cliente({ id: 'x', name: 'Padaria Central', categoryName: 'Ide' }),
      cliente({ id: 'y', name: 'Ideal Móveis', categoryName: 'Ide Hub' }),
    ];
    const achados = (busca: string) =>
      filtrarCarteira(daIde, { ...FILTRO_VAZIO, busca }).map((c) => c.id);
    expect(achados('ide')).toEqual(['y']);
    expect(achados('hub')).toEqual([]);
  });

  it('a busca ignora espaco em volta', () => {
    expect(ids({ busca: '  saaev  ' })).toEqual(['b']);
  });

  it('financeiro pendente deixa so quem deve', () => {
    expect(ids({ soFinanceiroPendente: true })).toEqual(['a']);
  });

  it('criterios se somam, nao se substituem', () => {
    expect(ids({ urgencias: ['perigo'], planoIds: ['p-full'] })).toEqual([]);
  });

  it('filtroEstaLimpo ignora o recorte de ativos', () => {
    // "Só ativos" é o estado normal da tela, não um filtro que o usuário pôs.
    expect(filtroEstaLimpo(FILTRO_VAZIO)).toBe(true);
    expect(filtroEstaLimpo({ ...FILTRO_VAZIO, busca: 'x' })).toBe(false);
  });
});

describe('diasAteRenovar', () => {
  const hoje = new Date('2026-08-20T12:00:00Z');

  it('conta os dias que faltam', () => {
    expect(diasAteRenovar('2026-08-30', hoje)).toBe(10);
  });

  it('e zero no proprio dia', () => {
    expect(diasAteRenovar('2026-08-20', hoje)).toBe(0);
  });

  it('fica negativo depois de vencer', () => {
    expect(diasAteRenovar('2026-08-10', hoje)).toBe(-10);
  });

  it('nao se confunde com a hora do dia', () => {
    // Perto da meia-noite, uma conta por instante erraria em um dia.
    expect(diasAteRenovar('2026-08-21', new Date('2026-08-20T23:59:00Z'))).toBe(1);
  });

  it('sem data devolve nulo, nunca zero', () => {
    expect(diasAteRenovar(null, hoje)).toBeNull();
  });

  it('conta a partir do dia de São Paulo: às 22h de Brasília ainda é o mesmo dia', () => {
    // 22h de 20/08 em Brasília = 01h de 21/08 em UTC. Pelo dia UTC, "renova
    // amanhã" já dizia "renova hoje" a partir das 21h, e o contrato que vence
    // hoje virava "vence em 0 dias" um dia antes.
    const noite = new Date('2026-08-21T01:00:00Z');
    expect(diasAteRenovar('2026-08-21', noite)).toBe(1);
    expect(diasAteRenovar('2026-08-20', noite)).toBe(0);
    expect(diasAteRenovar('2026-08-19', noite)).toBe(-1);
  });
});

describe('proximasRenovacoes', () => {
  const hoje = new Date('2026-08-20T00:00:00Z');

  it('traz os vencidos primeiro e depois os mais proximos', () => {
    const r = proximasRenovacoes(
      [
        cliente({ id: 'longe', renewsOn: '2026-09-25' }),
        cliente({ id: 'vencido', renewsOn: '2026-02-01' }),
        cliente({ id: 'perto', renewsOn: '2026-08-25' }),
      ],
      45,
      hoje,
    );
    expect(r.map((x) => x.cliente.id)).toEqual(['vencido', 'perto', 'longe']);
    expect(r[0].dias).toBeLessThan(0);
  });

  it('deixa de fora o que esta alem da janela', () => {
    const r = proximasRenovacoes([cliente({ id: 'x', renewsOn: '2027-01-01' })], 45, hoje);
    expect(r).toEqual([]);
  });

  it('ignora inativo e sem data', () => {
    const r = proximasRenovacoes(
      [
        cliente({ id: 'inativo', renewsOn: '2026-08-21', isActive: false, inactiveAt: '2026-07-01T00:00:00Z' }),
        cliente({ id: 'semdata', renewsOn: null }),
      ],
      45,
      hoje,
    );
    expect(r).toEqual([]);
  });
});

/* ─────────────────────────── F11A do plano UX ─────────────────────────── */

describe('F11A: o atalho do resumo e o filtro correspondente', () => {
  const carteira = [
    cliente({ id: 'a', name: 'A', urgency: 'perigo', financeOk: false }),
    cliente({ id: 'b', name: 'B', urgency: 'perigo' }),
    cliente({ id: 'c', name: 'C', urgency: 'alerta', financeOk: false }),
    cliente({ id: 'd', name: 'D', urgency: 'paz' }),
    cliente({ id: 'x', name: 'X', urgency: 'perigo', isActive: false, inactiveAt: '2026-01-01T00:00:00Z' }),
  ];

  it('o número do atalho é o tamanho da carteira depois de aplicar o mesmo filtro', () => {
    const n = contarAtalhos(carteira, FILTRO_VAZIO);
    for (const u of ['perigo', 'alerta', 'paz'] as const) {
      const depois = filtrarCarteira(carteira, { ...FILTRO_VAZIO, urgencias: [u] });
      expect(n.urgencia[u]).toBe(depois.length);
    }
    expect(n.financeiroPendente).toBe(filtrarCarteira(carteira, { ...FILTRO_VAZIO, soFinanceiroPendente: true }).length);
    // O inativo (X, crítico) não conta: a carteira do painel é a ativa.
    expect(n.urgencia.perigo).toBe(2);
  });

  it('com um atalho ligado, os outros dizem quanto acrescentariam — e não zero', () => {
    const n = contarAtalhos(carteira, { ...FILTRO_VAZIO, urgencias: ['perigo'] });
    expect(n.urgencia).toEqual({ perigo: 2, alerta: 1, paz: 1 });
    // Financeiro respeita a urgência ligada: um crítico com financeiro pendente.
    expect(n.financeiroPendente).toBe(1);
  });

  it('o resumo da carteira filtrada é o mesmo, venha o filtro do atalho ou da gaveta', () => {
    // Os dois caminhos gravam o mesmo `urgencias` — o que se prova é que a
    // conta não depende de por onde se chegou.
    const pelaGaveta = resumirCarteira(filtrarCarteira(carteira, { ...FILTRO_VAZIO, urgencias: ['perigo'] }));
    const peloAtalho = resumirCarteira(
      filtrarCarteira(carteira, filtroDoRecorte(lerRecorte(new URLSearchParams('urgencia=perigo'), '2026-09'), '')),
    );
    expect(peloAtalho).toEqual(pelaGaveta);
  });
});

describe('F11A: a situação verificável do cartão', () => {
  const hoje = new Date('2026-09-10T12:00:00Z');

  it('só diz o que a resposta traz, o mais grave primeiro', () => {
    const s = situacoesDoCliente(
      cliente({ financeOk: false, renewsOn: '2026-09-07', delivery: calculateDeliveryLevel([], []) }),
      hoje,
    );
    // O motivo de não medir não é situação (F11A2): mora no lugar da entrega.
    expect(s.map((x) => x.texto)).toEqual(['Contrato vencido há 3d', 'Financeiro pendente']);
  });

  it('renovação só entra até 30 dias; hoje é "vence hoje"', () => {
    expect(situacoesDoCliente(cliente({ renewsOn: '2026-10-10' }), hoje)).toEqual([
      { chave: 'renovacao', tom: 'warn', texto: 'Renovação em 30d' },
    ]);
    expect(situacoesDoCliente(cliente({ renewsOn: '2026-10-11' }), hoje)).toEqual([]);
    expect(situacoesDoCliente(cliente({ renewsOn: '2026-09-10' }), hoje)[0].texto).toBe('Renovação vence hoje');
  });

  it('entrega baixa NÃO vira situação — não se inventa "atrasado"', () => {
    const baixa = cliente({ delivery: entrega({ arte: 8 }, { arte: 0 }) });
    expect(situacoesDoCliente(baixa, hoje)).toEqual([]);
  });
});

describe('F11A2: o motivo de não medir, pelo que a resposta diz (R01)', () => {
  // Os três motivos saem da MESMA fórmula do servidor, com o contexto que ele
  // passa (`server/panel.ts`): o cartão lê o motivo, não adivinha.
  const naoAberto = calculateDeliveryLevel([], [], { monthOpened: false, hasContentContract: true });
  const semCota = calculateDeliveryLevel([], [], { monthOpened: true, hasContentContract: true });
  const semContrato = calculateDeliveryLevel([], [], { monthOpened: true, hasContentContract: false });

  it('mês não aberto', () => {
    expect(motivoSemMedida(naoAberto)).toEqual({
      motivo: 'no_contract',
      rotulo: 'Mês não aberto',
      texto: 'Este mês ainda não foi aberto para este cliente.',
    });
  });

  it('mês aberto sem cota NÃO diz "mês não aberto"', () => {
    const m = motivoSemMedida(semCota);
    expect(m).toEqual({
      motivo: 'empty_contract',
      rotulo: 'Sem cota para medir',
      texto: 'O mês foi aberto sem cota — não há base para medir.',
    });
    expect(m?.rotulo).not.toMatch(/mês/i);
  });

  it('cliente sem contrato de conteúdo mensal', () => {
    expect(motivoSemMedida(semContrato)).toEqual({
      motivo: 'no_content_contract',
      rotulo: 'Sem contrato mensal',
      texto: 'Este cliente não tem contrato de conteúdo mensal.',
    });
  });

  it('mensurável não tem motivo; motivo desconhecido não vira "mês não aberto"', () => {
    expect(motivoSemMedida(entrega({ arte: 8 }, { arte: 4 }))).toBeNull();
    const futuro = { measurable: false, reason: 'outro', message: 'Frase nova.', formulaVersion: 'x' } as never;
    expect(motivoSemMedida(futuro)).toEqual({ motivo: 'outro', rotulo: 'Sem medida', texto: 'Frase nova.' });
  });

  it('um rótulo por motivo, todos distintos', () => {
    expect(new Set(Object.values(ROTULO_DO_MOTIVO)).size).toBe(3);
  });

  it('os três motivos ficam fora da média e das peças — o mesmo número de antes', () => {
    const base = [cliente({ id: 'a', delivery: entrega({ arte: 8 }, { arte: 4 }) })];
    const com = [
      ...base,
      cliente({ id: 'b', delivery: naoAberto }),
      cliente({ id: 'c', delivery: semCota }),
      cliente({ id: 'd', delivery: semContrato }),
    ];
    const r = resumirCarteira(com);
    expect(r.nivelMedio).toBe(resumirCarteira(base).nivelMedio);
    expect(r.mensuraveis).toBe(1);
    expect(r.porTipo).toEqual(resumirCarteira(base).porTipo);
    expect(com.flatMap((c) => situacoesDoCliente(c))).toEqual([]);
  });
});

describe('F11A: o recorte do painel no endereço', () => {
  const MES = '2026-09';
  const ler = (q: string) => lerRecorte(new URLSearchParams(q), MES);

  it('endereço limpo = mês corrente inteiro, sem filtro, entrega crescente', () => {
    expect(ler('')).toEqual({
      periodo: { de: '2026-09-01', ate: '2026-09-30' },
      filtro: { urgencias: [], planoIds: [], etiquetaIds: [], soFinanceiroPendente: false },
      ordem: 'entrega',
      crescente: true,
    });
  });

  it('ida e volta: o que se grava é o que se lê', () => {
    const r = ler('de=2026-08-01&ate=2026-08-15&urgencia=alerta,perigo&plano=pl-1&etiqueta=t-1,t-2&financeiro=pendente&ordem=nome&sentido=desc');
    const mudancas = recorteParaEndereco(r, MES);
    const volta = new URLSearchParams(Object.entries(mudancas).filter(([, v]) => v !== ''));
    expect(ler(volta.toString())).toEqual(r);
    // Urgência na ordem de gravidade, não na digitada.
    expect(mudancas.urgencia).toBe('perigo,alerta');
  });

  it('o padrão não é escrito: o painel sem recorte volta a `/painel` limpo', () => {
    const mudancas = recorteParaEndereco(ler(''), MES);
    expect(Object.values(mudancas).every((v) => v === '')).toBe(true);
  });

  it('peças inválidas viram o padrão sem derrubar as válidas', () => {
    const r = ler('urgencia=banana,PERIGO&ordem=xyz&sentido=up&de=2026-02-31&ate=2026-03-05&plano=ok-1,<script>,ok-1');
    expect(r.filtro.urgencias).toEqual(['perigo']);
    expect(r.ordem).toBe('entrega');
    expect(r.crescente).toBe(true);
    expect(r.periodo).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
    expect(r.filtro.planoIds).toEqual(['ok-1']);
  });

  it('intervalo invertido ou longo demais vira o mês de referência', () => {
    expect(periodoValido('2026-09-10', '2026-09-01', MES)).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
    expect(periodoValido('2020-01-01', '2026-09-01', MES).de).toBe('2026-09-01');
    expect(periodoValido('2026-09-03', '2026-09-03', MES)).toEqual({ de: '2026-09-03', ate: '2026-09-03' });
  });

  it('lista de ids tem teto', () => {
    const muitos = Array.from({ length: TETO_DE_IDS + 10 }, (_, i) => `id-${i}`).join(',');
    expect(ler(`etiqueta=${muitos}`).filtro.etiquetaIds).toHaveLength(TETO_DE_IDS);
  });

  it('id que a carteira não conhece não filtra (e não esvazia a lista)', () => {
    const carteira = [cliente({ id: 'a', plan: { id: 'pl-1', name: 'Básico', colorBg: '', colorText: '', colorBorder: '' } })];
    const f = filtroConhecido({ ...FILTRO_VAZIO, planoIds: ['pl-1', 'morto'], etiquetaIds: ['morta'] }, carteira);
    expect(f.planoIds).toEqual(['pl-1']);
    expect(f.etiquetaIds).toEqual([]);
    expect(filtrarCarteira(carteira, filtroConhecido({ ...FILTRO_VAZIO, planoIds: ['morto'] }, carteira))).toHaveLength(1);
  });

  it('o degrau Painel da ficha só aceita uma consulta do próprio painel', () => {
    expect(destinoDoPainel({ painel: '?urgencia=perigo&busca=caf%C3%A9' })).toBe('/painel?urgencia=perigo&busca=caf%C3%A9');
    expect(destinoDoPainel(null)).toBe('/painel');
    expect(destinoDoPainel({ painel: '//evil.example' })).toBe('/painel');
    expect(destinoDoPainel({ painel: '?a=1#x' })).toBe('/painel');
    expect(destinoDoPainel({ painel: 42 })).toBe('/painel');
  });
});

/* ─────────────────────────── F38 — última entrega ─────────────────────────── */

/** A situação de entrega como o servidor a devolve (`deliveryStatusOf`). */
const situacao = (over: Partial<DeliveryStatus> = {}): DeliveryStatus => ({
  today: '2026-10-06',
  lastDeliveryOn: null,
  daysSinceLastDelivery: null,
  overdue: [],
  dueToday: 0,
  unscheduled: 0,
  nextScheduledOn: null,
  ...over,
});

const entregou = (dia: string, dias: number) => situacao({ lastDeliveryOn: dia, daysSinceLastDelivery: dias });

describe('F38: as peças da Semanal em "Pede ação"', () => {
  const hoje = new Date('2026-10-06T15:00:00Z');

  it('vencidas sem ✓ com tom de erro, no singular e no plural', () => {
    expect(situacoesDoCliente(cliente({ deliveryStatus: situacao({ overdue: ['2026-09-21'] }) }), hoje)).toEqual([
      { chave: 'vencidas', tom: 'err', texto: '1 peça vencida sem ✓' },
    ]);
    const duas = situacoesDoCliente(
      cliente({ deliveryStatus: situacao({ overdue: ['2026-08-01', '2026-10-01'] }) }),
      hoje,
    );
    expect(duas).toEqual([{ chave: 'vencidas', tom: 'err', texto: '2 peças vencidas sem ✓' }]);
  });

  it('vence hoje é alerta, não erro — ainda não é atraso', () => {
    expect(situacoesDoCliente(cliente({ deliveryStatus: situacao({ dueToday: 1 }) }), hoje)).toEqual([
      { chave: 'venceHoje', tom: 'warn', texto: '1 peça vence hoje' },
    ]);
    expect(situacoesDoCliente(cliente({ deliveryStatus: situacao({ dueToday: 3 }) }), hoje)[0].texto).toBe(
      '3 peças vencem hoje',
    );
  });

  it('a ordem: contrato vencido → vencidas → vence hoje → financeiro → renovação', () => {
    const s = situacoesDoCliente(
      cliente({
        renewsOn: '2026-10-01',
        financeOk: false,
        deliveryStatus: situacao({ overdue: ['2026-09-21', '2026-09-28'], dueToday: 1 }),
      }),
      hoje,
    );
    expect(s.map((x) => x.chave)).toEqual(['renovacao', 'vencidas', 'venceHoje', 'financeiro']);
    expect(s[0].texto).toBe('Contrato vencido há 5d');

    const renovando = situacoesDoCliente(
      cliente({ renewsOn: '2026-10-20', financeOk: false, deliveryStatus: situacao({ overdue: ['2026-09-21'] }) }),
      hoje,
    );
    expect(renovando.map((x) => x.texto)).toEqual(['1 peça vencida sem ✓', 'Financeiro pendente', 'Renovação em 14d']);
  });

  it('sem peça em aberto, ou sem situação (cancelado), nada entra', () => {
    expect(situacoesDoCliente(cliente({ deliveryStatus: entregou('2026-10-05', 1) }), hoje)).toEqual([]);
    expect(situacoesDoCliente(cliente({ deliveryStatus: null }), hoje)).toEqual([]);
  });
});

describe('F38: o texto da última entrega', () => {
  it('"hoje", "há 1 dia" e "há N dias"', () => {
    expect(textoDaUltimaEntrega(entregou('2026-10-06', 0))).toBe('06/10 · hoje');
    expect(textoDaUltimaEntrega(entregou('2026-10-05', 1))).toBe('05/10 · há 1 dia');
    expect(textoDaUltimaEntrega(entregou('2026-09-23', 13))).toBe('23/09 · há 13 dias');
  });

  it('o ano aparece só quando não é o de hoje', () => {
    expect(textoDaUltimaEntrega(entregou('2025-12-30', 280))).toBe('30/12/2025 · há 280 dias');
  });

  it('sem entrega devolve nulo — o cartão diz "Sem entrega registrada"', () => {
    expect(textoDaUltimaEntrega(situacao())).toBeNull();
  });
});

describe('F38: ordenar por última entrega', () => {
  const agencia = cliente({ id: 'agencia', name: 'Agência Ide', deliveryStatus: entregou('2026-01-27', 252) });
  const contfix = cliente({ id: 'contfix', name: 'CONTFIX', deliveryStatus: entregou('2026-10-06', 0) });
  const fonseca = cliente({ id: 'fonseca', name: 'Fonseca Moura', deliveryStatus: entregou('2026-10-05', 1) });
  const gardenia = cliente({ id: 'gardenia', name: 'Gardênia', deliveryStatus: entregou('2026-10-05', 1) });
  const nunca = cliente({ id: 'nunca', name: 'Abigail', deliveryStatus: situacao() });
  const semSituacao = cliente({ id: 'sem', name: 'Bravo', deliveryStatus: null });
  const lista = [contfix, nunca, gardenia, agencia, semSituacao, fonseca];

  it('crescente: há mais tempo sem entregar no topo; quem nunca entregou no fim', () => {
    expect(ordenarCarteira(lista, 'ultimaEntrega', true).map((c) => c.id)).toEqual([
      'agencia',
      'fonseca',
      'gardenia',
      'contfix',
      'nunca',
      'sem',
    ]);
  });

  it('decrescente: a mais recente no topo, e quem nunca entregou CONTINUA no fim', () => {
    expect(ordenarCarteira(lista, 'ultimaEntrega', false).map((c) => c.id)).toEqual([
      'contfix',
      'fonseca',
      'gardenia',
      'agencia',
      'nunca',
      'sem',
    ]);
  });

  it('o recorte no endereço aceita a ordem nova (e a antiga continua valendo)', () => {
    const ler = (q: string) => lerRecorte(new URLSearchParams(q), '2026-10');
    expect(ler('ordem=ultimaEntrega').ordem).toBe('ultimaEntrega');
    expect(ler('ordem=ultimaentrega').ordem).toBe('ultimaEntrega');
    expect(ler('ordem=nome').ordem).toBe('nome');
    expect(ler('ordem=renovacao').ordem).toBe('renovacao');
    expect(ler('ordem=ultima').ordem).toBe('entrega');
    const r = ler('ordem=ultimaEntrega&sentido=desc');
    const mudancas = recorteParaEndereco(r, '2026-10');
    expect(mudancas.ordem).toBe('ultimaEntrega');
    const volta = new URLSearchParams(Object.entries(mudancas).filter(([, v]) => v !== ''));
    expect(ler(volta.toString())).toEqual(r);
  });
});
