/**
 * Qual token fala com qual conta — F7g.
 *
 * POR QUE ESTA ESCOLHA MERECE TESTE PRÓPRIO
 *   É a única peça do motor cujo erro não aparece como erro. Usar o token da
 *   empresa errada não devolve "sem permissão": devolve "conta não encontrada",
 *   que é exatamente a resposta de uma conta apagada na Meta.
 *
 *   Quem fosse investigar procuraria do lado da Meta — a conta sumiu? o cliente
 *   revogou? — quando o problema estaria aqui. Por isso a regra mais importante
 *   deste arquivo é a que garante que a escolha NÃO tem plano B.
 */

import { describe, expect, it } from 'vitest';

import { credenciaisDoAmbiente } from '@/server/meta-coleta';

describe('credenciaisDoAmbiente', () => {
  const ambiente = {
    IDEWORKS_META_TOKEN: 'token-da-ide',
    IDEWORKS_META_TOKEN_ALMA9: 'token-da-alma-nove',
    IDEWORKS_SERVER_DB_PASSWORD: 'nada a ver',
    IDEWORKS_META_TOKEN_VAZIO: '',
  };

  it('conta sem empresa cai na credencial padrão', () => {
    expect(credenciaisDoAmbiente(ambiente)(null)).not.toBeNull();
  });

  it('conta com empresa usa a credencial DELA', () => {
    const escolher = credenciaisDoAmbiente(ambiente);
    const ide = escolher('IDEWORKS_META_TOKEN');
    const alma = escolher('IDEWORKS_META_TOKEN_ALMA9');

    expect(ide).not.toBeNull();
    expect(alma).not.toBeNull();
    // Duas fontes DIFERENTES. Se a varredura devolvesse a mesma para as duas, a
    // coleta da A9 iria bater na BM da Ide sem reclamar de nada.
    expect(ide).not.toBe(alma);
  });

  it('credencial que não existe devolve nulo, e NÃO cai no padrão', () => {
    // A regra que sustenta todas as outras. Cair no padrão faria a Meta
    // responder "conta não encontrada", e a investigação começaria no lugar
    // errado — do lado da Meta, e não do segredo que falta.
    expect(credenciaisDoAmbiente(ambiente)('IDEWORKS_META_TOKEN_QUE_NAO_EXISTE')).toBeNull();
  });

  it('variável vazia conta como ausente', () => {
    // Segredo apagado deixa a variável definida e vazia. Tratá-la como presente
    // faria a coleta tentar autenticar com string vazia e culpar a Meta.
    expect(credenciaisDoAmbiente(ambiente)('IDEWORKS_META_TOKEN_VAZIO')).toBeNull();
  });

  it('ambiente sem credencial nenhuma não escolhe nada', () => {
    const escolher = credenciaisDoAmbiente({ IDEWORKS_SERVER_DB_PASSWORD: 'x' });
    expect(escolher(null)).toBeNull();
    expect(escolher('IDEWORKS_META_TOKEN')).toBeNull();
  });

  it('não confunde variável de outro assunto que começa parecido', () => {
    // `IDEWORKS_META_TOKEN` é prefixo de vários nomes possíveis. A varredura
    // aceita só o que continua em MAIÚSCULA_COM_SUBLINHADO — e o teste existe
    // porque um nome em minúscula passaria despercebido na leitura.
    const escolher = credenciaisDoAmbiente({
      IDEWORKS_META_TOKEN: 'o certo',
      'IDEWORKS_META_TOKEN-errado': 'traço não é sublinhado',
    });
    expect(escolher('IDEWORKS_META_TOKEN-errado')).toBeNull();
    expect(escolher(null)).not.toBeNull();
  });
});
