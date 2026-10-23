/**
 * F9 — os relatórios da Meta.
 *
 * O grosso destes testes não é aritmética: é a diferença entre "zero" e "não
 * sei", que é onde relatório costuma mentir sem que ninguém perceba.
 */

import { describe, expect, it } from 'vitest';

import {
  type DiaDeCampanha,
  type DiaOrganico,
  diasDoIntervalo,
  lerVariacao,
  dividir,
  periodoAnterior,
  porCampanha,
  porDia,
  resumirCampanha,
  resumirOrganico,
  resumirPago,
  serie,
  serieDeDistinta,
  somar,
  variacao,
} from '@/meta/relatorio';

const dia = (p: Partial<DiaDeCampanha> & { day: string }): DiaDeCampanha => ({
  campaignId: 'c1',
  campaignName: 'Campanha',
  spend: null,
  reach: null,
  impressions: null,
  clicks: null,
  linkClicks: null,
  conversions: null,
  conversionValue: null,
  ...p,
});

const org = (p: Partial<DiaOrganico> & { day: string }): DiaOrganico => ({
  reach: null,
  views: null,
  accountsEngaged: null,
  totalInteractions: null,
  follows: null,
  unfollows: null,
  profileLinksTaps: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  followersTotal: null,
  mediaCount: null,
  ...p,
});

describe('dividir — divisão por zero não é zero', () => {
  it('divide quando dá', () => {
    expect(dividir(1, 4)).toBe(0.25);
  });

  it('devolve null com denominador zero, e não Infinity', () => {
    // CTR de campanha sem impressão não é 0% nem infinito: não existe.
    expect(dividir(10, 0)).toBeNull();
  });

  it('devolve null quando falta qualquer um dos lados', () => {
    expect(dividir(null, 4)).toBeNull();
    expect(dividir(4, null)).toBeNull();
  });

  it('zero dividido por número é zero de verdade', () => {
    // Aqui zero É a resposta: houve impressão e não houve clique.
    expect(dividir(0, 100)).toBe(0);
  });
});

describe('somar — "nenhum dado" não é "zero"', () => {
  it('soma ignorando os buracos', () => {
    expect(somar([1, null, 2])).toBe(3);
  });

  it('devolve null quando NADA foi coletado', () => {
    // Campanha sem nenhum dia: gasto desconhecido, não gasto zero.
    expect(somar([null, null])).toBeNull();
    expect(somar([])).toBeNull();
  });

  it('devolve zero quando o dado existe e é zero', () => {
    expect(somar([0, null])).toBe(0);
  });
});

describe('porDia — a leitura honesta de métrica de pessoas distintas', () => {
  it('média e pico só sobre os dias que têm dado', () => {
    const r = porDia([
      { day: '2026-08-01', valor: 100 },
      { day: '2026-08-02', valor: null },
      { day: '2026-08-03', valor: 200 },
    ]);
    // A média é 150, não 100: dia não coletado não entra como zero.
    expect(r.media).toBe(150);
    expect(r.pico).toBe(200);
    expect(r.diaDoPico).toBe('2026-08-03');
    expect(r.dias).toBe(2);
  });

  it('sem nenhum dado, tudo é null — nunca zero', () => {
    expect(porDia([{ day: '2026-08-01', valor: null }])).toEqual({
      media: null,
      pico: null,
      diaDoPico: null,
      dias: 0,
    });
  });

  it('empate no pico fica com o dia mais antigo', () => {
    const r = porDia([
      { day: '2026-08-01', valor: 50 },
      { day: '2026-08-02', valor: 50 },
    ]);
    expect(r.diaDoPico).toBe('2026-08-01');
  });
});

describe('resumirCampanha', () => {
  const dias = [
    dia({ day: '2026-08-01', spend: 100, impressions: 10_000, clicks: 200, reach: 8_000 }),
    dia({ day: '2026-08-02', spend: 50, impressions: 5_000, clicks: 50, reach: 4_000 }),
  ];

  it('soma o que é evento', () => {
    const r = resumirCampanha(dias);
    expect(r.spend).toBe(150);
    expect(r.impressions).toBe(15_000);
    expect(r.clicks).toBe(250);
  });

  it('NÃO soma alcance — devolve média e pico', () => {
    const r = resumirCampanha(dias);
    // 8.000 + 4.000 = 12.000 seria a mentira. As mesmas pessoas podem ter
    // visto nos dois dias, e do total diário não dá para saber quantas.
    expect(r.alcance).toEqual({
      media: 6_000,
      pico: 8_000,
      diaDoPico: '2026-08-01',
      dias: 2,
    });
    expect(r.alcance).not.toHaveProperty('total');
  });

  it('deriva CTR, CPC e CPM sobre os totais', () => {
    const r = resumirCampanha(dias);
    expect(r.ctr).toBeCloseTo(250 / 15_000);
    expect(r.cpc).toBeCloseTo(150 / 250);
    // CPM é por MIL impressões.
    expect(r.cpm).toBeCloseTo((150 * 1000) / 15_000);
  });

  it('CPA e ROAS ficam null sem conversão', () => {
    const r = resumirCampanha(dias);
    expect(r.cpa).toBeNull();
    expect(r.roas).toBeNull();
  });

  it('calcula ROAS quando há valor de conversão', () => {
    const r = resumirCampanha([
      dia({ day: '2026-08-01', spend: 100, conversions: 4, conversionValue: 500 }),
    ]);
    expect(r.roas).toBe(5);
    expect(r.cpa).toBe(25);
  });

  it('usa o nome mais recente — campanha renomeada aparece como está hoje', () => {
    const r = resumirCampanha([
      dia({ day: '2026-08-01', campaignName: 'Nome velho' }),
      dia({ day: '2026-08-05', campaignName: 'Nome novo' }),
      dia({ day: '2026-08-03', campaignName: null }),
    ]);
    expect(r.campaignName).toBe('Nome novo');
  });

  it('conta dias distintos, não linhas', () => {
    const r = resumirCampanha([dia({ day: '2026-08-01' }), dia({ day: '2026-08-01' })]);
    expect(r.dias).toBe(1);
  });
});

describe('porCampanha', () => {
  const dias = [
    dia({ day: '2026-08-01', campaignId: 'a', campaignName: 'Alfa', spend: 10 }),
    dia({ day: '2026-08-01', campaignId: 'b', campaignName: 'Beta', spend: 90 }),
    dia({ day: '2026-08-02', campaignId: 'a', campaignName: 'Alfa', spend: 5 }),
  ];

  it('separa por campanha e ordena pelo gasto', () => {
    const r = porCampanha(dias);
    expect(r.map((c) => c.campaignId)).toEqual(['b', 'a']);
    expect(r[0].spend).toBe(90);
    expect(r[1].spend).toBe(15);
  });

  it('campanha sem gasto conhecido vai para o fim', () => {
    const r = porCampanha([...dias, dia({ day: '2026-08-01', campaignId: 'z', spend: null })]);
    expect(r[r.length - 1].campaignId).toBe('z');
  });

  it('empate de gasto desempata pelo nome, para a ordem não dançar', () => {
    const r = porCampanha([
      dia({ day: '2026-08-01', campaignId: 'x', campaignName: 'Zulu', spend: 10 }),
      dia({ day: '2026-08-01', campaignId: 'y', campaignName: 'Alfa', spend: 10 }),
    ]);
    expect(r.map((c) => c.campaignName)).toEqual(['Alfa', 'Zulu']);
  });
});

describe('resumirPago — o total da conta', () => {
  it('não soma picos de campanhas diferentes: refaz a conta por dia', () => {
    const dias = [
      // Alfa teve pico no dia 1; Beta teve pico no dia 2.
      dia({ day: '2026-08-01', campaignId: 'a', reach: 1_000 }),
      dia({ day: '2026-08-01', campaignId: 'b', reach: 100 }),
      dia({ day: '2026-08-02', campaignId: 'a', reach: 100 }),
      dia({ day: '2026-08-02', campaignId: 'b', reach: 900 }),
    ];

    // A SOMA INGÊNUA, para o teste comparar com ela em vez de só afirmar o
    // certo. Escrito antes com `c.pico`, que NÃO EXISTE em ResumoDeCampanha —
    // a asserção somava `undefined ?? 0` e dava zero, passando sem testar
    // nada. Só apareceu quando a pasta `test/` passou a ser compilada.
    const somaDosPicos = porCampanha(dias).reduce((s, c) => s + (c.alcance.pico ?? 0), 0);
    const total = resumirPago(dias);

    expect(somaDosPicos).toBe(1_900); // o que a soma por campanha daria
    expect(total.alcance.pico).toBe(1_100);
    // Dia 1 alcançou 1.100 e dia 2 alcançou 1.000 — a média é 1.050. Somar os
    // dois daria 2.100, e somar os picos por campanha daria 1.900. Três
    // números diferentes, e só um responde à pergunta.
    expect(total.alcance.media).toBe(1_050);
  });

  it('soma gasto de todas as campanhas', () => {
    const total = resumirPago([
      dia({ day: '2026-08-01', campaignId: 'a', spend: 10 }),
      dia({ day: '2026-08-01', campaignId: 'b', spend: 20 }),
    ]);
    expect(total.spend).toBe(30);
    expect(total.dias).toBe(1);
  });

  it('período vazio devolve tudo null, e nenhum NaN', () => {
    const total = resumirPago([]);
    expect(total.spend).toBeNull();
    expect(total.ctr).toBeNull();
    expect(total.alcance.media).toBeNull();
    expect(total.dias).toBe(0);
  });
});

describe('resumirOrganico — o painel do perfil', () => {
  const dias = [
    org({
      day: '2026-08-01',
      reach: 1_000,
      views: 3_000,
      accountsEngaged: 100,
      totalInteractions: 250,
      profileLinksTaps: 7,
    }),
    org({
      day: '2026-08-02',
      reach: 500,
      views: 1_000,
      accountsEngaged: 50,
      totalInteractions: 80,
      profileLinksTaps: 3,
    }),
  ];

  it('soma visualizações e interações, mas não alcance', () => {
    const r = resumirOrganico(dias);
    expect(r.views).toBe(4_000);
    expect(r.totalInteractions).toBe(330);
    expect(r.alcance.media).toBe(750);
    expect(r.alcance.pico).toBe(1_000);
  });

  it('taxa de engajamento é razão entre as duas médias', () => {
    const r = resumirOrganico(dias);
    expect(r.taxaDeEngajamento).toBeCloseTo(75 / 750);
  });

  it('saldo de seguidores fica null enquanto faltar um dos lados', () => {
    // É o estado real hoje: a Meta manda o total e a quebra por tipo, e a
    // coleta ainda não viu movimento suficiente para separar entrada de saída.
    const r = resumirOrganico([org({ day: '2026-08-01', follows: 12 })]);
    expect(r.follows).toBe(12);
    expect(r.unfollows).toBeNull();
    expect(r.saldoDeSeguidores).toBeNull();
  });

  it('calcula o saldo quando os dois lados existem, inclusive negativo', () => {
    const r = resumirOrganico([org({ day: '2026-08-01', follows: 10, unfollows: 14 })]);
    expect(r.saldoDeSeguidores).toBe(-4);
  });
});

describe('serie — buraco não vira zero', () => {
  const dias = [
    dia({ day: '2026-08-01', spend: 10 }),
    dia({ day: '2026-08-03', spend: 30 }),
  ];

  it('devolve um ponto por dia do intervalo, com null onde não houve linha', () => {
    const s = serie(dias, 'spend', '2026-08-01', '2026-08-04');
    expect(s).toEqual([
      { dia: '2026-08-01', valor: 10 },
      { dia: '2026-08-02', valor: null },
      { dia: '2026-08-03', valor: 30 },
      { dia: '2026-08-04', valor: null },
    ]);
  });

  it('soma as campanhas do mesmo dia', () => {
    const s = serie(
      [
        dia({ day: '2026-08-01', campaignId: 'a', spend: 10 }),
        dia({ day: '2026-08-01', campaignId: 'b', spend: 5 }),
      ],
      'spend',
      '2026-08-01',
      '2026-08-01',
    );
    expect(s).toEqual([{ dia: '2026-08-01', valor: 15 }]);
  });

  it('RECUSA métrica de pessoas distintas', () => {
    // A recusa é a proteção: quem quiser a curva do alcance precisa chamar a
    // função de nome comprido, e a tela dela avisa que o total não se soma.
    expect(() => serie(dias, 'reach', '2026-08-01', '2026-08-02')).toThrow(/serieDeDistinta/);
  });

  it('serieDeDistinta desenha a curva do alcance', () => {
    const s = serieDeDistinta(
      [dia({ day: '2026-08-01', reach: 800 })],
      'reach',
      '2026-08-01',
      '2026-08-01',
    );
    expect(s).toEqual([{ dia: '2026-08-01', valor: 800 }]);
  });

  it('zero coletado permanece zero — só a AUSÊNCIA vira null', () => {
    const s = serie([dia({ day: '2026-08-01', spend: 0 })], 'spend', '2026-08-01', '2026-08-02');
    expect(s[0].valor).toBe(0);
    expect(s[1].valor).toBeNull();
  });
});

describe('diasDoIntervalo', () => {
  it('inclui as duas pontas', () => {
    expect(diasDoIntervalo('2026-08-01', '2026-08-03')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });

  it('um dia só devolve um dia', () => {
    expect(diasDoIntervalo('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });

  it('intervalo invertido devolve vazio, sem laço infinito', () => {
    expect(diasDoIntervalo('2026-08-03', '2026-08-01')).toEqual([]);
  });

  it('atravessa mês e ano', () => {
    expect(diasDoIntervalo('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
    expect(diasDoIntervalo('2026-01-31', '2026-02-01')).toEqual(['2026-01-31', '2026-02-01']);
  });

  it('não tropeça no horário de verão — a conta é em UTC', () => {
    // No Brasil o relógio já mudou em outubro e fevereiro. Uma conta em hora
    // local pularia ou repetiria um dia.
    const d = diasDoIntervalo('2026-10-17', '2026-10-19');
    expect(d).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
  });

  it('tem teto para intervalo absurdo vindo da barra de endereço', () => {
    expect(diasDoIntervalo('2000-01-01', '2030-01-01').length).toBeLessThanOrEqual(800);
  });
});

describe('variacao e periodoAnterior', () => {
  it('calcula a variação relativa', () => {
    expect(variacao(150, 100)).toBeCloseTo(0.5);
    expect(variacao(50, 100)).toBeCloseTo(-0.5);
  });

  it('sem base não há percentual', () => {
    // Crescer de 0 para 10 não é "+∞%".
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(10, null)).toBeNull();
    expect(variacao(null, 10)).toBeNull();
  });

  it('o período anterior tem o mesmo tamanho e não encosta no atual', () => {
    const a = periodoAnterior('2026-08-08', '2026-08-14'); // 7 dias
    expect(a).toEqual({ de: '2026-08-01', ate: '2026-08-07' });
    expect(diasDoIntervalo(a.de, a.ate).length).toBe(7);
  });

  it('funciona para um dia só', () => {
    expect(periodoAnterior('2026-08-01', '2026-08-01')).toEqual({
      de: '2026-07-31',
      ate: '2026-07-31',
    });
  });
});

describe('lerVariacao — subir não é sempre bom', () => {
  it('custo que sobe é RUIM, mesmo sendo um número maior', () => {
    // CPC dobrado não é conquista: é o mesmo clique custando o dobro.
    expect(lerVariacao('cpc', 1.0)).toBe('ruim');
    expect(lerVariacao('cpa', 0.3)).toBe('ruim');
    expect(lerVariacao('cpm', 0.5)).toBe('ruim');
  });

  it('custo que cai é BOM', () => {
    expect(lerVariacao('cpc', -0.3)).toBe('bom');
  });

  it('retorno segue a direção óbvia', () => {
    expect(lerVariacao('roas', 0.4)).toBe('bom');
    expect(lerVariacao('roas', -0.4)).toBe('ruim');
    expect(lerVariacao('ctr', 0.2)).toBe('bom');
  });

  it('GASTO é neutro — não é bom nem ruim, é decisão', () => {
    // Verde faria a tela parabenizar quem estourou o orçamento; vermelho,
    // quem economizou de propósito.
    expect(lerVariacao('spend', 1.5)).toBe('neutro');
    expect(lerVariacao('spend', -0.8)).toBe('neutro');
  });

  it('alcance e impressões também são neutros', () => {
    // Sobem quando se investe mais. Repetir a cor do investimento seria contar
    // a mesma coisa duas vezes fingindo que são duas.
    expect(lerVariacao('reach', 0.6)).toBe('neutro');
    expect(lerVariacao('impressions', 0.6)).toBe('neutro');
  });

  it('oscilação pequena não vira cor', () => {
    // 0,4% para cima não é melhora, é ruído — e pintar de verde ensina a
    // acreditar em oscilação.
    expect(lerVariacao('roas', 0.004)).toBe('neutro');
    expect(lerVariacao('cpc', -0.004)).toBe('neutro');
  });

  it('sem comparação não há leitura', () => {
    expect(lerVariacao('roas', null)).toBeNull();
  });

  it('métrica desconhecida não inventa direção', () => {
    expect(lerVariacao('metrica_que_nao_existe', 0.9)).toBe('neutro');
  });
});
