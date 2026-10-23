/**
 * A COLETA DA META NÃO OMITE NADA — F31, Fase 3b.
 *
 * A decisão de 25/09: omitir é reversível; parar a coleta não é. Um dia sem
 * coletar é um buraco para sempre na série da conta, e a Alma Nove continua
 * com 61 contas sendo coletadas pelo `IDEWORKS_META_TOKEN_ALMA9`.
 *
 * Por isso a coleta (`coletar`, chamada pelo cron e por `POST /meta/collect`)
 * nem LÊ `IDEWORKS_EMPRESAS_OMITIDAS`: a fila vem de
 * `meta_assets_para_coleta`, sem recorte de empresa, e a credencial de cada
 * conta sai de `credenciaisDoAmbiente`. Estes testes travam isso: com a
 * variável ligada no ambiente, a conta da Alma9 continua sendo enfileirada,
 * tentada e coletada com a credencial dela.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { type FonteDaMeta, coletar, credenciaisDoAmbiente } from '@/server/meta-coleta';

const AQUI = dirname(fileURLToPath(import.meta.url));

const CONTA_IDE = '00000000-0000-0000-0000-000000000100';
const CONTA_ALMA = '00000000-0000-0000-0000-000000000101';

/** O ambiente de produção, com a omissão LIGADA. */
const AMBIENTE = {
  IDEWORKS_META_TOKEN: 'token-da-ide',
  IDEWORKS_META_TOKEN_ALMA9: 'token-da-alma-nove',
  IDEWORKS_EMPRESAS_OMITIDAS: 'Alma9',
};

/** Um banco de mentira: a fila tem uma conta de cada empresa. */
function banco() {
  const chamadas: Array<{ texto: string; valores: unknown[] }> = [];
  const tx = ((strings: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = strings.join('?');
    chamadas.push({ texto, valores });
    if (texto.includes('meta_assets_para_coleta')) {
      return Promise.resolve([
        { id: CONTA_IDE, kind: 'instagram_account', external_id: 'ig_ide', secret_name: null },
        {
          id: CONTA_ALMA,
          kind: 'instagram_account',
          external_id: 'ig_alma',
          secret_name: 'IDEWORKS_META_TOKEN_ALMA9',
        },
      ]);
    }
    if (texto.includes('start_collection_run')) return Promise.resolve([{ id: 'execucao-1' }]);
    return Promise.resolve([]);
  }) as unknown as Tx;
  const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;
  return { sql, chamadas };
}

/** Uma fonte que responde vazio e anota quem ela coletou. */
function fonteQueAnota(nome: string, coletadas: string[]): FonteDaMeta {
  return {
    async organico(conta) {
      coletadas.push(`${nome}:${conta}`);
      return { dias: [], usoBruto: null };
    },
    async campanhas(conta) {
      coletadas.push(`${nome}:${conta}`);
      return { dias: [], usoBruto: null };
    },
    async demografia() {
      return [];
    },
    async quebrasDiarias() {
      return [];
    },
    async publicacoes() {
      return [];
    },
    async campanhasDetalhe() {
      return [];
    },
    async anuncios() {
      return [];
    },
    async diarioPorAnuncio() {
      return [];
    },
  };
}

describe('F31.3b — a coleta continua coletando a empresa omitida', () => {
  it('com a variável ligada, a conta da Alma9 é tentada e coletada com o token DELA', async () => {
    const { sql, chamadas } = banco();
    const coletadas: string[] = [];
    const pedidas: Array<string | null> = [];
    const fontes = { ide: fonteQueAnota('ide', coletadas), alma: fonteQueAnota('alma', coletadas) };

    const r = await coletar(sql, (segredo) => {
      pedidas.push(segredo);
      return segredo === 'IDEWORKS_META_TOKEN_ALMA9' ? fontes.alma : fontes.ide;
    });

    expect(r.ativosTotal).toBe(2);
    expect(r.ativosOk).toBe(2);
    expect(r.ativosComFalha).toBe(0);
    // A tentativa das duas foi marcada na fila (o avanço da vez)…
    const tentativas = chamadas.filter((c) => c.texto.includes('mark_asset_attempt'));
    expect(tentativas.map((c) => c.valores[0])).toEqual([CONTA_IDE, CONTA_ALMA]);
    // …e cada uma pediu a SUA credencial, e foi coletada por ela.
    expect(pedidas).toEqual([null, 'IDEWORKS_META_TOKEN_ALMA9']);
    expect(coletadas).toEqual(['ide:ig_ide', 'alma:ig_alma']);
  });

  it('a fila não tem recorte de empresa: a consulta é só a função de dono', () => {
    const fonte = readFileSync(join(AQUI, 'meta-coleta.ts'), 'utf8');
    expect(fonte).toContain('from ideworks.meta_assets_para_coleta(');
    // Nem a variável, nem o módulo da omissão chegam aqui.
    expect(fonte).not.toContain('IDEWORKS_EMPRESAS_OMITIDAS');
    expect(fonte).not.toContain('@/server/omitidas');
  });

  it('com a variável ligada, a credencial da Alma9 continua sendo achada no ambiente', () => {
    const escolher = credenciaisDoAmbiente(AMBIENTE);
    expect(escolher('IDEWORKS_META_TOKEN_ALMA9')).not.toBeNull();
    expect(escolher(null)).not.toBeNull();
    expect(escolher('IDEWORKS_META_TOKEN_ALMA9')).not.toBe(escolher(null));
  });

  it('o cron e a coleta manual do Worker chamam a coleta sem passar a variável', () => {
    const worker = readFileSync(join(AQUI, '..', '..', 'worker', 'index.ts'), 'utf8');
    const chamadas = [...worker.matchAll(/coletar\(([\s\S]*?)\)\s*[;,]/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
    for (const argumentos of chamadas) {
      expect(argumentos).toContain('credenciaisDoAmbiente(');
      expect(argumentos).not.toContain('OMITIDAS');
      expect(argumentos).not.toContain('categoriasOmitidas');
    }
  });
});
