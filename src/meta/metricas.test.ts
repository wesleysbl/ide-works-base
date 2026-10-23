/**
 * O catálogo de métricas — F10j.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   A regra que sustenta o seletor inteiro: **só se oferece o que tem dado**.
 *   Sem ela, escolher entre 73 métricas produz 60 colunas vazias — e coluna
 *   vazia é lida como zero, que é uma afirmação. "Esta campanha não gerou
 *   nenhuma compra" quando a verdade é "esta conta nunca mediu compra".
 *
 *   E a distinção entre `null` e `0`, que é a mesma ideia aplicada a uma
 *   célula: travessão diz "não dá para calcular", zero diz "aconteceu zero
 *   vez". Trocar um pelo outro é o erro de leitura mais caro destas tabelas.
 */

import { describe, expect, it } from 'vitest';

import {
  type LinhaComMetricas,
  METRICAS_BASE,
  PADRAO,
  catalogoDe,
  rotuloDaAcao,
  valorDaMetrica,
} from '@/meta/metricas';

const linha = (p: Partial<LinhaComMetricas> = {}): LinhaComMetricas => ({
  spend: 100,
  impressions: 10_000,
  clicks: 200,
  linkClicks: 150,
  alcanceAprox: 5_000,
  acoes: [],
  ...p,
});

describe('o catálogo só oferece o que tem dado', () => {
  it('sem ação nenhuma, sobram só as métricas de coluna', () => {
    expect(catalogoDe([linha()])).toHaveLength(METRICAS_BASE.length);
  });

  it('uma ação com valor vira DUAS colunas: a contagem e o custo', () => {
    const c = catalogoDe([linha({ acoes: [{ action_type: 'lead', value: 12 }] })]);
    expect(c.map((m) => m.chave)).toContain('acao:lead');
    expect(c.map((m) => m.chave)).toContain('custo:lead');
  });

  it('ação presente e ZERADA não entra', () => {
    // A Meta devolve tipos de ação por completude, com zero. Oferecê-los faria
    // a lista crescer com colunas que só sabem mostrar travessão.
    const c = catalogoDe([linha({ acoes: [{ action_type: 'purchase', value: 0 }] })]);
    expect(c.map((m) => m.chave)).not.toContain('acao:purchase');
  });

  it('basta UMA linha ter valor para a métrica ser oferecida', () => {
    // Se uma campanha do grupo gerou leads e as outras não, a coluna precisa
    // existir — senão a que gerou fica sem como mostrar.
    const c = catalogoDe([
      linha({ acoes: [{ action_type: 'lead', value: 0 }] }),
      linha({ acoes: [{ action_type: 'lead', value: 3 }] }),
    ]);
    expect(c.map((m) => m.chave)).toContain('acao:lead');
  });

  it('o nome cru fica acessível, para conferir contra a Meta', () => {
    const c = catalogoDe([linha({ acoes: [{ action_type: 'lead', value: 1 }] })]);
    expect(c.find((m) => m.chave === 'acao:lead')?.origem).toBe('lead');
  });
});

describe('o nome em português', () => {
  it('traduz o que a Meta chama por dentro', () => {
    expect(rotuloDaAcao('onsite_conversion.messaging_conversation_started_7d')).toBe(
      'Conversas iniciadas',
    );
  });

  it('e devolve o nome CRU quando não conhece', () => {
    // Feio e honesto. Um nome inventado descreveria outra coisa, e alguém
    // colocaria isso num relatório de cliente.
    expect(rotuloDaAcao('alguma_acao_nova_da_meta')).toBe('alguma_acao_nova_da_meta');
  });
});

describe('o valor de cada métrica', () => {
  it('as de coluna saem direto', () => {
    expect(valorDaMetrica('spend', linha())).toBe(100);
    expect(valorDaMetrica('reach', linha())).toBe(5_000);
  });

  it('CTR é cliques sobre impressões', () => {
    expect(valorDaMetrica('ctr', linha())).toBeCloseTo(0.02);
  });

  it('CPM é por MIL impressões', () => {
    expect(valorDaMetrica('cpm', linha())).toBeCloseTo(10);
  });

  it('frequência é impressões sobre alcance', () => {
    expect(valorDaMetrica('frequencia', linha())).toBeCloseTo(2);
  });

  it('a ação soma todas as ocorrências do tipo', () => {
    const l = linha({
      acoes: [
        { action_type: 'lead', value: 3 },
        { action_type: 'lead', value: 4 },
        { action_type: 'comment', value: 9 },
      ],
    });
    expect(valorDaMetrica('acao:lead', l)).toBe(7);
  });

  it('o custo por ação é o investido dividido pela ação', () => {
    const l = linha({ spend: 120, acoes: [{ action_type: 'lead', value: 4 }] });
    expect(valorDaMetrica('custo:lead', l)).toBe(30);
  });
});

describe('travessão e zero dizem coisas diferentes', () => {
  it('custo sem a ação é NULO, e não zero', () => {
    // Zero afirmaria "custou zero por lead". Nulo vira travessão, que é a
    // leitura certa de "não dá para dizer".
    expect(valorDaMetrica('custo:lead', linha({ acoes: [] }))).toBeNull();
  });

  it('custo com a ação zerada também é nulo', () => {
    const l = linha({ acoes: [{ action_type: 'lead', value: 0 }] });
    expect(valorDaMetrica('custo:lead', l)).toBeNull();
  });

  it('mas a CONTAGEM de uma ação ausente é zero, e isso é certo', () => {
    // "Aconteceu zero vez" é uma afirmação verdadeira e útil aqui.
    expect(valorDaMetrica('acao:lead', linha({ acoes: [] }))).toBe(0);
  });

  it('CTR sem impressão é nulo — não há como dividir', () => {
    expect(valorDaMetrica('ctr', linha({ impressions: 0 }))).toBeNull();
    expect(valorDaMetrica('ctr', linha({ impressions: null }))).toBeNull();
  });

  it('métrica desconhecida devolve nulo em vez de quebrar', () => {
    // Uma coluna guardada por alguém e depois removida do catálogo não pode
    // derrubar a tela inteira.
    expect(valorDaMetrica('inventada', linha())).toBeNull();
  });
});

describe('as colunas de abertura', () => {
  it('são poucas, e existem no catálogo base', () => {
    // Abrir com quinze colunas é a mesma parede que o seletor veio resolver.
    expect(PADRAO.length).toBeLessThanOrEqual(4);
    for (const c of PADRAO) {
      expect(METRICAS_BASE.map((m) => m.chave)).toContain(c);
    }
  });
});
