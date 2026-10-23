/**
 * A PÁGINA DO CLIENTE, SEM TELA — F42, Fase 6. O cliente da API pública e as
 * regras puras (datas, selos, separação, troca de chamada).
 */
import { describe, expect, it } from 'vitest';

import {
  type ChamadaPublica,
  ErroPublico,
  FRASE_FALHA,
  FRASE_LIMITE_TELA,
  FRASE_REDE,
  apiDoLink,
  comEnderecoDasArtes,
  comComentario,
  dataEHoraCurta,
  diaEMes,
  fraseDoErro,
  problemaDoTexto,
  seloDaDecisao,
  separar,
  marcarVisto,
  perguntaDosVistos,
  primeiroNaoVisto,
  quantosVistos,
  trocarChamada,
} from '@/aprovacao/cliente';

const chamada = (id: string, estado: ChamadaPublica['estado'], decididaEm: string | null = null): ChamadaPublica => ({
  id,
  titulo: `Card ${id}`,
  versao: 1,
  enviadaEm: '2026-10-07T17:32:00Z',
  legenda: null,
  estado,
  decididaEm,
  itens: [],
  comentarios: [],
});

type Pedido = { url: string; init: RequestInit };

function buscaFalsa(status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) {
  const pedidos: Pedido[] = [];
  const buscar = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response(JSON.stringify(corpo), { status, headers: cabecalhos });
  }) as unknown as typeof fetch;
  return { buscar, pedidos };
}

describe('o cliente da API pública', () => {
  it('lê a página sem cookie, sem referência e sem cache, só sob /api/public/aprovacao/', async () => {
    const { buscar, pedidos } = buscaFalsa(200, { ok: true, cliente: { nome: 'Loja' }, chamadas: [] });
    const r = await apiDoLink('tok/en', buscar).pagina();
    expect(r.cliente.nome).toBe('Loja');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe('/api/public/aprovacao/tok%2Fen');
    expect(pedidos[0].init).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it('aprovar, reprovar e comentar são POST em JSON nos caminhos certos', async () => {
    const { buscar, pedidos } = buscaFalsa(200, { ok: true, chamada: chamada('r1', 'aprovada'), comentario: { id: 'c' } });
    const api = apiDoLink('T', buscar);
    await api.aprovar('r1');
    await api.reprovar('r1', 'Trocar a cor');
    await api.comentar('r1', 'Oi', 'i1');
    await api.comentar('r1', 'Geral', null);
    expect(pedidos.map((p) => [p.url, p.init.method, p.init.body])).toEqual([
      ['/api/public/aprovacao/T/chamadas/r1/aprovar', 'POST', '{}'],
      ['/api/public/aprovacao/T/chamadas/r1/reprovar', 'POST', '{"comentario":"Trocar a cor"}'],
      ['/api/public/aprovacao/T/chamadas/r1/comentarios', 'POST', '{"texto":"Oi","itemId":"i1"}'],
      ['/api/public/aprovacao/T/chamadas/r1/comentarios', 'POST', '{"texto":"Geral"}'],
    ]);
    for (const p of pedidos) {
      expect((p.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(p.init.credentials).toBe('omit');
    }
  });

  it('recusa vira ErroPublico com a frase do servidor; 429 traz a espera', async () => {
    const r404 = buscaFalsa(404, { message: 'Link inválido ou desativado.' });
    await expect(apiDoLink('T', r404.buscar).pagina()).rejects.toMatchObject({
      status: 404,
      message: 'Link inválido ou desativado.',
    });
    const r429 = buscaFalsa(429, { message: 'Muitos pedidos' }, { 'Retry-After': '17' });
    const erro = await apiDoLink('T', r429.buscar).pagina().catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroPublico);
    expect((erro as ErroPublico).esperarSegundos).toBe(17);
    expect(fraseDoErro(erro)).toBe(FRASE_LIMITE_TELA);
  });

  /*
    UM 200 QUE NÃO É UM OBJETO JSON NÃO É A PÁGINA — conferência de 09/10/2026.
    O cliente da agência abre o link no aparelho e na rede dele: o portal de
    login de um wi-fi ou o proxy de uma empresa respondem 200 com HTML. O corpo
    ilegível virava `{}`, entregue como a página — e a tela estourava em
    `pagina.cliente.nome` em vez de oferecer "Tentar de novo".
  */
  it('200 com HTML, vazio ou JSON que não é objeto: ErroPublico com a frase de falha, e não dado', async () => {
    for (const corpo of ['<html><body>Entre na rede</body></html>', '', '[]', 'null']) {
      const buscar = (async () => new Response(corpo, { status: 200 })) as unknown as typeof fetch;
      const erro = await apiDoLink('T', buscar).pagina().catch((e: unknown) => e);
      expect(erro, JSON.stringify(corpo)).toBeInstanceOf(ErroPublico);
      expect(erro).toMatchObject({ status: 200, message: FRASE_FALHA });
    }
  });

  it('rede fora: status 0 e frase de conexão', async () => {
    const buscar = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const erro = await apiDoLink('T', buscar).pagina().catch((e: unknown) => e);
    expect(erro).toMatchObject({ status: 0, message: FRASE_REDE });
  });
});

describe('datas e selos', () => {
  it('no horário de Brasília', () => {
    expect(diaEMes('2026-10-08T01:30:00Z')).toBe('07/10');
    expect(dataEHoraCurta('2026-10-07T17:32:00Z')).toBe('07/10/2026 às 14:32');
  });

  it('"Aprovado em dd/mm" e "Ajustes pedidos em dd/mm"; aberta não tem selo', () => {
    expect(seloDaDecisao(chamada('a', 'aprovada', '2026-10-07T18:10:00Z'))).toBe('Aprovado em 07/10');
    expect(seloDaDecisao(chamada('b', 'reprovada', '2026-10-07T18:10:00Z'))).toBe('Ajustes pedidos em 07/10');
    expect(seloDaDecisao(chamada('b', 'reprovada', '2026-10-07T18:10:00Z'), true)).toBe(
      'Ajustes pedidos em 07/10/2026 às 15:10',
    );
    expect(seloDaDecisao(chamada('c', 'aberta'))).toBeNull();
  });
});

describe('a página em memória', () => {
  it('abertas primeiro, respondidas depois', () => {
    const { abertas, respondidas } = separar([chamada('1', 'aprovada'), chamada('2', 'aberta'), chamada('3', 'reprovada')]);
    expect(abertas.map((c) => c.id)).toEqual(['2']);
    expect(respondidas.map((c) => c.id)).toEqual(['1', '3']);
  });

  it('troca a chamada decidida e acrescenta comentário sem duplicar', () => {
    const pagina = { ok: true as const, cliente: { nome: 'L' }, chamadas: [chamada('1', 'aberta'), chamada('2', 'aberta')] };
    const nova = trocarChamada(pagina, chamada('2', 'aprovada'));
    expect(nova.chamadas.map((c) => c.estado)).toEqual(['aberta', 'aprovada']);
    const c = { id: 'x', texto: 'oi', criadoEm: '2026-10-07T17:00:00Z', itemId: null };
    const com = comComentario(comComentario(chamada('1', 'aberta'), c), c);
    expect(com.comentarios).toHaveLength(1);
  });

  it('texto vazio ou só pontuação não vai; longo demais também não', () => {
    expect(problemaDoTexto('  ', 'vazio')).toBe('vazio');
    expect(problemaDoTexto('...', 'vazio')).toBe('vazio');
    expect(problemaDoTexto('ok', 'vazio')).toBeNull();
    expect(problemaDoTexto('a'.repeat(2001), 'vazio')).toMatch(/longo demais/);
  });
});

describe('materiais vistos', () => {
  it('marca sem repetir e conta só o que existe', () => {
    expect(marcarVisto([0], 2)).toEqual([0, 2]);
    expect(marcarVisto([0, 2], 0)).toEqual([0, 2]);
    expect(quantosVistos([0, 2, 9], 4)).toBe(2);
  });
  it('acha o primeiro não visto', () => {
    expect(primeiroNaoVisto([0, 1], 4)).toBe(2);
    expect(primeiroNaoVisto([0, 2, 3], 4)).toBe(1);
    expect(primeiroNaoVisto([0, 1, 2, 3], 4)).toBeNull();
  });
  it('pergunta só quando falta ver algo', () => {
    expect(perguntaDosVistos([0], 4)).toBe('Você viu 1 de 4 materiais. Quer aprovar mesmo assim?');
    expect(perguntaDosVistos([0, 1, 2, 3], 4)).toBeNull();
    expect(perguntaDosVistos([0], 1)).toBeNull();
  });
});

describe('comEnderecoDasArtes (F42, Fase 9)', () => {
  it('a arte anexada ganha o endereço da imagem com a raiz do link; o resto não muda', async () => {
    const chamada = {
      id: 'r1',
      itens: [
        { id: 'i1', ordem: 1, tipo: 'image', nome: 'a.png', forma: 'anexo', exibicao: null, abrirNoDropbox: null },
        { id: 'i2', ordem: 2, tipo: 'video', nome: 'v.mp4', forma: 'arquivo', exibicao: 'https://dl/v.mp4', abrirNoDropbox: null },
      ],
    } as unknown as ChamadaPublica;
    const nova = comEnderecoDasArtes('/api/public/aprovacao/TOK', chamada);
    expect(nova.itens[0].exibicao).toBe('/api/public/aprovacao/TOK/chamadas/r1/itens/i1/imagem');
    expect(nova.itens[1]).toBe(chamada.itens[1]);

    const buscar = (async () =>
      new Response(JSON.stringify({ ok: true, cliente: { nome: 'X' }, chamadas: [chamada] }), { status: 200 })) as typeof fetch;
    const p = await apiDoLink('TOK', buscar).pagina();
    expect(p.chamadas[0].itens[0].exibicao).toBe('/api/public/aprovacao/TOK/chamadas/r1/itens/i1/imagem');
  });
});
