import { describe, expect, it } from 'vitest';

import {
  type ContaParaParear,
  contasOrfas,
  normalizar,
  semelhanca,
  sugerirPares,
} from '@/meta/pareamento';

const conta = (over: Partial<ContaParaParear> = {}): ContaParaParear => ({
  kind: 'instagram_account',
  externalId: '178414000',
  displayName: null,
  via: null,
  ...over,
});

describe('normalizar', () => {
  it('tira acento, caixa e pontuacao', () => {
    expect(normalizar('Canguru Print & Decor')).toEqual(['canguru', 'print', 'decor']);
  });

  it('tira as palavras que so aparecem no nome da conta', () => {
    // Medidas no dado real: "... Anúncios", "CA - ...", "RAIZ ADS",
    // "@valentini.oficial".
    expect(normalizar('Canguru Print e Decor Anúncios')).toEqual([
      'canguru',
      'print',
      'decor',
    ]);
    expect(normalizar('CA - Ana Prado Odontologia')).toEqual([
      'ana',
      'prado',
      'odontologia',
    ]);
    expect(normalizar('RAIZ ADS')).toEqual(['raiz']);
    expect(normalizar('@valentini.oficial')).toEqual(['valentini']);
  });

  it('tira numero solto, que separa contas do MESMO cliente', () => {
    expect(normalizar('Conta 01 - Bairro Decora')).toEqual(['bairro', 'decora']);
  });

  it('nome que vira nada devolve lista vazia, sem quebrar', () => {
    expect(normalizar('ADS - Conta 02')).toEqual([]);
    expect(normalizar('   ')).toEqual([]);
  });
});

describe('semelhanca', () => {
  it('nome igual da nota cheia', () => {
    expect(semelhanca('Valentini', 'Valentini')).toBe(100);
  });

  it('ignora o ruido dos dois lados', () => {
    expect(semelhanca('@valentini.oficial', 'Valentini')).toBe(100);
    expect(semelhanca('RAIZ ADS', 'Raiz')).toBe(100);
  });

  it('nome do cliente contido no da conta da nota cheia', () => {
    // Dividir pelo maior puniria o nome mais descritivo da conta.
    expect(semelhanca('Canguru Print e Decor Anúncios', 'Canguru Print')).toBe(100);
  });

  it('reconhece palavra grudada', () => {
    expect(semelhanca('@saae_itaverde', 'SAAEV')).toBeGreaterThan(0);
    expect(semelhanca('@nova.imoveis', 'Nova Imóveis')).toBe(100);
  });

  it('nomes diferentes dao nota baixa', () => {
    expect(semelhanca('Padaria da Praça', 'Clinica Sorrir')).toBe(0);
    expect(semelhanca('Bairro Decora', 'Vila Home Decor')).toBeLessThan(60);
  });

  it('nao casa por palavra curta', () => {
    // Sem a trava de 4 letras, "sp" caberia dentro de qualquer coisa.
    expect(semelhanca('SP Modas', 'SP Alimentos')).toBeLessThan(100);
  });

  it('nome vazio nao casa com nada', () => {
    expect(semelhanca('', 'Valentini')).toBe(0);
    expect(semelhanca('ADS', 'Valentini')).toBe(0);
  });
});

describe('sugerirPares', () => {
  const clientes = [
    { id: 'c1', name: 'Valentini' },
    { id: 'c2', name: 'Canguru Print' },
    { id: 'c3', name: 'Nova Imóveis' },
    { id: 'c4', name: 'Padaria da Praça' },
  ];

  it('propoe o par obvio', () => {
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: '@valentini.oficial' })],
      clientes,
      new Set(),
    );
    expect(r).toHaveLength(1);
    expect(r[0].cliente.id).toBe('c1');
    expect(r[0].confianca).toBe(100);
  });

  it('usa a pagina de origem quando o @ nao ajuda', () => {
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: '@nv_imob', via: 'Nova Imóveis' })],
      clientes,
      new Set(),
    );
    expect(r[0]?.cliente.id).toBe('c3');
  });

  it('NAO propoe quando ha empate', () => {
    // Quando o sistema nao sabe, quem decide e a pessoa: proposta ambigua custa
    // mais atencao do que campo vazio.
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: 'Padaria' })],
      [
        { id: 'x', name: 'Padaria da Praça' },
        { id: 'y', name: 'Padaria Central' },
      ],
      new Set(),
    );
    expect(r).toEqual([]);
  });

  it('NAO propoe abaixo da confianca minima', () => {
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: 'Alguma Coisa Muito Outra' })],
      clientes,
      new Set(),
    );
    expect(r).toEqual([]);
  });

  it('ignora conta ja conectada', () => {
    // Repetir o que ja foi feito e ruido que esconde o trabalho restante.
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: '@valentini.oficial' })],
      clientes,
      new Set(['a']),
    );
    expect(r).toEqual([]);
  });

  it('ignora conta sem nome nenhum', () => {
    const r = sugerirPares([conta({ externalId: 'a' })], clientes, new Set());
    expect(r).toEqual([]);
  });

  it('poe as mais confiaveis primeiro', () => {
    const r = sugerirPares(
      [
        conta({ externalId: 'meio', displayName: 'Canguru Print e Decor Anúncios' }),
        conta({ externalId: 'certo', displayName: 'Valentini' }),
      ],
      clientes,
      new Set(),
    );
    expect(r[0].confianca).toBeGreaterThanOrEqual(r[1]?.confianca ?? 0);
  });

  it('uma conta gera no maximo uma sugestao', () => {
    const r = sugerirPares(
      [conta({ externalId: 'a', displayName: 'Valentini' })],
      [...clientes, { id: 'c9', name: 'Outro' }],
      new Set(),
    );
    expect(r.filter((s) => s.conta.externalId === 'a')).toHaveLength(1);
  });
});

describe('contasOrfas', () => {
  it('sobram as que nao foram conectadas nem propostas', () => {
    const contas = [
      conta({ externalId: 'ligada' }),
      conta({ externalId: 'proposta', displayName: 'Valentini' }),
      conta({ externalId: 'orfa', displayName: 'Nada A Ver' }),
    ];
    const sugestoes = sugerirPares(contas, [{ id: 'c1', name: 'Valentini' }], new Set(['ligada']));
    const orfas = contasOrfas(contas, sugestoes, new Set(['ligada']));
    expect(orfas.map((c) => c.externalId)).toEqual(['orfa']);
  });

  it('sem conta nenhuma nao inventa orfa', () => {
    expect(contasOrfas([], [], new Set())).toEqual([]);
  });
});
