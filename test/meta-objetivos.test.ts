/**
 * F10a — o objetivo da campanha decide o que é "resultado".
 *
 * Os nomes usados aqui não vieram da documentação: foram medidos na carteira em
 * 2026-08-21, e as duas gerações de vocabulário da Meta convivem lá.
 */

import { describe, expect, it } from 'vitest';

import {
  type Acao,
  RANKINGS_DA_FAMILIA,
  RESULTADO_DA_FAMILIA,
  familiaDoObjetivo,
  resultadoDe,
  valorDaAcao,
} from '@/meta/objetivos';

const a = (tipo: string, valor: number | string): Acao => ({ action_type: tipo, value: valor });

describe('familiaDoObjetivo — duas gerações, uma família', () => {
  it('o nome NOVO e o VELHO caem na mesma família', () => {
    // O mesmo anúncio devolve OUTCOME_TRAFFIC quando se pergunta à campanha e
    // LINK_CLICKS quando se pergunta ao insight. Tratá-los como objetivos
    // diferentes partiria a mesma campanha em duas.
    expect(familiaDoObjetivo('OUTCOME_TRAFFIC')).toBe('trafego');
    expect(familiaDoObjetivo('LINK_CLICKS')).toBe('trafego');

    expect(familiaDoObjetivo('OUTCOME_ENGAGEMENT')).toBe('engajamento');
    expect(familiaDoObjetivo('POST_ENGAGEMENT')).toBe('engajamento');

    expect(familiaDoObjetivo('OUTCOME_SALES')).toBe('vendas');
    expect(familiaDoObjetivo('CONVERSIONS')).toBe('vendas');

    expect(familiaDoObjetivo('OUTCOME_LEADS')).toBe('leads');
    expect(familiaDoObjetivo('LEAD_GENERATION')).toBe('leads');
  });

  it('cobre os dez objetivos que a carteira realmente usa', () => {
    // Medidos em 2026-08-21. Se algum cair em `outro`, a tela passa a cobrar o
    // resultado errado de uma campanha inteira.
    const medidos = [
      'OUTCOME_ENGAGEMENT',
      'OUTCOME_SALES',
      'MESSAGES',
      'LINK_CLICKS',
      'OUTCOME_LEADS',
      'OUTCOME_TRAFFIC',
      'POST_ENGAGEMENT',
      'OUTCOME_AWARENESS',
      'LEAD_GENERATION',
      'CONVERSIONS',
    ];
    const orfas = medidos.filter((o) => familiaDoObjetivo(o) === 'outro');
    expect(orfas).toEqual([]);
  });

  it('objetivo desconhecido cai em `outro`, e não numa família por descuido', () => {
    // Chutar a família faria a tela cobrar o resultado errado sem avisar.
    expect(familiaDoObjetivo('OUTCOME_QUE_A_META_INVENTAR')).toBe('outro');
    expect(familiaDoObjetivo(null)).toBe('outro');
  });

  it('não se importa com caixa', () => {
    expect(familiaDoObjetivo('outcome_sales')).toBe('vendas');
  });
});

describe('valorDaAcao', () => {
  it('soma o tipo pedido', () => {
    expect(valorDaAcao([a('lead', 3), a('link_click', 99), a('lead', 2)], 'lead')).toBe(5);
  });

  it('a Meta manda número como TEXTO, e isso não pode virar concatenação', () => {
    expect(valorDaAcao([a('lead', '3'), a('lead', '2')], 'lead')).toBe(5);
  });

  it('ação ausente é null, e não zero', () => {
    // Zero diria "não houve compra"; null diz "esta campanha nem mede compra".
    expect(valorDaAcao([a('link_click', 10)], 'purchase')).toBeNull();
  });
});

describe('resultadoDe — a primeira que existir ganha', () => {
  it('mensagem usa CONVERSA INICIADA, não a conexão total', () => {
    // As duas vêm juntas em toda campanha de mensagem, e a conexão é maior.
    // Somar as duas contaria a mesma conversa duas vezes.
    const acoes = [
      a('onsite_conversion.total_messaging_connection', 90),
      a('onsite_conversion.messaging_conversation_started_7d', 42),
      a('onsite_conversion.messaging_first_reply', 30),
      a('onsite_conversion.messaging_user_depth_2_message_send', 20),
    ];
    const r = resultadoDe('mensagem', acoes);
    expect(r.valor).toBe(42);
    expect(r.origem).toBe('onsite_conversion.messaging_conversation_started_7d');
  });

  it('cai para a segunda opção quando a primeira não existe', () => {
    const r = resultadoDe('mensagem', [a('onsite_conversion.total_messaging_connection', 90)]);
    expect(r.valor).toBe(90);
    expect(r.origem).toBe('onsite_conversion.total_messaging_connection');
  });

  it('tráfego prefere quem CHEGOU a quem clicou', () => {
    // A diferença entre as duas é a página que não carregou, e é informação.
    const r = resultadoDe('trafego', [a('link_click', 1065), a('landing_page_view', 3)]);
    expect(r.valor).toBe(3);
    expect(r.origem).toBe('landing_page_view');
  });

  it('alcance vem de COLUNA, e não de ação', () => {
    // Alcance é gente alcançada, não evento disparado.
    const r = resultadoDe('alcance', [a('post_engagement', 7331)], { reach: 12_844 });
    expect(r.valor).toBe(12_844);
    expect(r.origem).toBe('reach');
  });

  it('sem a ação nem a coluna, devolve null', () => {
    expect(resultadoDe('vendas', [a('link_click', 10)]).valor).toBeNull();
    expect(resultadoDe('alcance', [], {}).valor).toBeNull();
  });

  it('todo resultado diz de ONDE veio', () => {
    // É o que torna o número auditável: dá para conferir no gerenciador.
    const r = resultadoDe('leads', [a('onsite_conversion.lead_grouped', 7)]);
    expect(r.origem).toBe('onsite_conversion.lead_grouped');
  });
});

describe('as famílias e seus rankings', () => {
  it('toda família tem definição de resultado e lista de rankings', () => {
    const familias = Object.keys(RESULTADO_DA_FAMILIA) as (keyof typeof RESULTADO_DA_FAMILIA)[];
    for (const f of familias) {
      expect(RESULTADO_DA_FAMILIA[f].rotulo).toBeTruthy();
      expect(RESULTADO_DA_FAMILIA[f].unidade).toBeTruthy();
      expect(RANKINGS_DA_FAMILIA[f].length).toBeGreaterThan(0);
    }
  });

  it('engajamento oferece curtida, comentário e salvamento', () => {
    // São as perguntas que essa família responde, e não fazem sentido em vendas.
    expect(RANKINGS_DA_FAMILIA.engajamento).toContain('curtidas');
    expect(RANKINGS_DA_FAMILIA.engajamento).toContain('comentarios');
    expect(RANKINGS_DA_FAMILIA.engajamento).toContain('salvamentos');
  });

  it('vendas NÃO oferece ranking de visualização de vídeo', () => {
    // Aba vazia ensina que a tela está quebrada.
    expect(RANKINGS_DA_FAMILIA.vendas).not.toContain('visualizacoes');
  });

  it('toda família que mede por ação oferece custo por resultado', () => {
    // Sem ele, "42 conversas" não diz se foi caro.
    for (const f of ['mensagem', 'leads', 'vendas', 'trafego'] as const) {
      expect(RANKINGS_DA_FAMILIA[f]).toContain('custo_por_resultado');
    }
  });
});
