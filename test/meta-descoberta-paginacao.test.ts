/**
 * A descoberta segue a paginação da Meta — F19g.
 *
 * O QUE ESTE TESTE PROTEGE
 *   A descoberta pedia `limit=200` e lia UMA página, apostando que 200 cobre
 *   qualquer portfólio nosso. A aposta está certa hoje e o raciocínio está
 *   errado: a Meta pagina pelo tamanho da RESPOSTA, não pelo que se pediu.
 *
 *   Medido contra a API de verdade em 25/08/2026, com o portfólio da Alma
 *   Nove: `limit=25` devolveu 25 itens e um `paging.next`; seguindo o `next`,
 *   43. O cursor existe e nós o jogávamos fora.
 *
 *   Enquanto a resposta couber, não dá diferença. No dia em que não couber, a
 *   lista encolhe SEM ERRO NENHUM — e conta que some sem erro é a falha mais
 *   cara desta área: foi assim que 20 contas de anúncio sumiram na F7d, com a
 *   tela verde e os testes passando.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { descobrirContas } from '@/server/meta-descoberta';

const ME: [string, unknown] = ['me?fields=id,name', { id: '1', name: 'IDE WORK' }];

/**
 * Uma coleção partida em páginas, como a Meta faz de verdade: cada resposta
 * traz `paging.next` com a URL da seguinte.
 */
function paginar(base: string, itens: unknown[], porPagina: number) {
  const paginas: unknown[] = [];
  for (let i = 0; i < itens.length; i += porPagina) {
    const resto = i + porPagina < itens.length;
    paginas.push({
      data: itens.slice(i, i + porPagina),
      paging: resto ? { next: `${base}&depois=${i + porPagina}` } : {},
    });
  }
  return paginas;
}

function fingirMeta(rotas: Array<[string, unknown]>, colecoes: Record<string, unknown[]>) {
  const cursor: Record<string, number> = {};
  vi.stubGlobal('fetch', async (url: string) => {
    for (const [trecho, corpo] of rotas) {
      if (url.includes(trecho)) return new Response(JSON.stringify(corpo), { status: 200 });
    }
    for (const [trecho, paginas] of Object.entries(colecoes)) {
      if (url.includes(trecho)) {
        const i = cursor[trecho] ?? 0;
        cursor[trecho] = i + 1;
        return new Response(JSON.stringify(paginas[i] ?? { data: [], paging: {} }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ error: { message: 'não combinado' } }), { status: 400 });
  });
}

const conta = (n: number) => ({ id: `act_${n}`, name: `Conta ${n}` });
const pagina = (n: number) => ({
  id: `p${n}`,
  name: `Página ${n}`,
  instagram_business_account: { id: `ig${n}`, username: `perfil${n}` },
});

afterEach(() => vi.unstubAllGlobals());

describe('contas de anúncio', () => {
  it('segue o cursor até o fim, e não para na primeira página', async () => {
    const contas = Array.from({ length: 43 }, (_, i) => conta(i));
    fingirMeta([ME], {
      'me/adaccounts': paginar('me/adaccounts?x=1', contas, 25),
      'me/accounts': [{ data: [], paging: {} }],
    });
    const r = await descobrirContas('tok');
    expect(r.contas.filter((c) => c.kind === 'ad_account')).toHaveLength(43);
  });

  it('sem cursor, lê uma página só — não fica pedindo à toa', async () => {
    fingirMeta([ME], {
      'me/adaccounts': [{ data: [conta(1), conta(2)], paging: {} }, { data: [conta(3)] }],
      'me/accounts': [{ data: [], paging: {} }],
    });
    const r = await descobrirContas('tok');
    expect(r.contas.filter((c) => c.kind === 'ad_account')).toHaveLength(2);
  });
});

describe('páginas e Instagram', () => {
  it('também seguem o cursor', async () => {
    const paginas = Array.from({ length: 30 }, (_, i) => pagina(i));
    fingirMeta([ME], {
      'me/adaccounts': [{ data: [], paging: {} }],
      'me/accounts': paginar('me/accounts?x=1', paginas, 10),
    });
    const r = await descobrirContas('tok');
    expect(r.contas.filter((c) => c.kind === 'instagram_account')).toHaveLength(30);
  });
});

describe('um cursor que nunca acaba não trava o sistema', () => {
  it('para no teto e AVISA que cortou — nunca em silêncio', async () => {
    // Parar caladinho seria repetir exatamente o defeito que isto conserta.
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('me?fields=id,name')) {
        return new Response(JSON.stringify({ id: '1', name: 'IDE WORK' }), { status: 200 });
      }
      if (url.includes('me/adaccounts')) {
        return new Response(
          JSON.stringify({ data: [conta(1)], paging: { next: 'https://x/me/adaccounts?p=∞' } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ data: [], paging: {} }), { status: 200 });
    });

    const r = await descobrirContas('tok');
    expect(r.avisos.join(' ')).toMatch(/passou de \d+ páginas e foi cortada/);
    // e o que veio continua valendo: cortar não é zerar.
    expect(r.contas.filter((c) => c.kind === 'ad_account').length).toBeGreaterThan(0);
  });
});
