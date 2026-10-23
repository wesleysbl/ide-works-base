/**
 * O TOKEN VENCIDO DE UMA EMPRESA NÃO PARA A COLETA DAS OUTRAS — F7g, rodada de fundo.
 *
 * O DEFEITO
 *   `classificarFalha` marca o código 190 (token inválido/vencido) com
 *   `deveParar`, e o motor traduzia isso em `interrompida = true` para a
 *   EXECUÇÃO INTEIRA. Com um token só, está certo: sem ele nada mais funciona.
 *   Desde a Alma Nove há um token POR EMPRESA (cada BM tem o seu System User), e
 *   o token vencido de uma não diz nada sobre o da outra.
 *
 *   Resultado: com o token da Alma9 vencido (61 contas) e a fila ordenada pela
 *   conta vista há mais tempo, toda batida parava na primeira conta da Alma9
 *   que aparecesse. As contas da Ide, que estavam boas, só eram visitadas nos
 *   intervalos entre duas da Alma9 — a volta ia de ~2 h para ~15 h, passando
 *   das 12 horas em que a tela chama a conta de atrasada.
 *
 * O QUE VALE AGORA
 *   · Token vencido: as contas DA MESMA CREDENCIAL ficam sem visita nesta
 *     execução (falham com a frase do token, sem chamar a Meta); as de outra
 *     credencial seguem.
 *   · Limite de uso (4/17/613) continua parando tudo: é do aplicativo, e insistir
 *     queima a cota de todas as empresas.
 */

import { describe, expect, it } from 'vitest';

import type { Sql, Tx } from '@/server/db';
import { type FonteDaMeta, coletar } from '@/server/meta-coleta';

const ALMA = 'IDEWORKS_META_TOKEN_ALMA9';

type Conta = { id: string; external_id: string; secret_name: string | null };

const alma1: Conta = { id: 'a1', external_id: 'ig_alma1', secret_name: ALMA };
const ide1: Conta = { id: 'i1', external_id: 'ig_ide1', secret_name: null };
const alma2: Conta = { id: 'a2', external_id: 'ig_alma2', secret_name: ALMA };
const ide2: Conta = { id: 'i2', external_id: 'ig_ide2', secret_name: null };

/** Um banco de mentira: devolve a fila dada e anota o que foi chamado. */
function banco(fila: Conta[]) {
  const chamadas: Array<{ texto: string; valores: unknown[] }> = [];
  const tx = ((strings: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = strings.join('?');
    chamadas.push({ texto, valores });
    if (texto.includes('meta_assets_para_coleta')) {
      return Promise.resolve(fila.map((c) => ({ ...c, kind: 'instagram_account' })));
    }
    if (texto.includes('start_collection_run')) return Promise.resolve([{ id: 'execucao-1' }]);
    return Promise.resolve([]);
  }) as unknown as Tx;
  const sql = { begin: (trabalho: (t: Tx) => Promise<unknown>) => trabalho(tx) } as unknown as Sql;
  return {
    sql,
    chamadas,
    marcadas: () =>
      chamadas.filter((c) => c.texto.includes('mark_asset_attempt')).map((c) => c.valores[0]),
    tocadas: () =>
      chamadas
        .filter((c) => c.texto.includes('touch_asset'))
        .map((c) => ({ id: c.valores[0], erro: c.valores[1] })),
  };
}

/** Uma fonte que anota as contas visitadas e falha com o erro dado, se houver. */
function fonte(visitadas: string[], falhaCom?: { code: number; message: string }): FonteDaMeta {
  return {
    async organico(conta) {
      visitadas.push(conta);
      if (falhaCom) throw Object.assign(new Error(falhaCom.message), { code: falhaCom.code });
      return { dias: [], usoBruto: null };
    },
    async campanhas() {
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

describe('token vencido é da credencial, não da execução', () => {
  it('o token da Alma9 vence: as contas da Ide continuam sendo coletadas', async () => {
    const { sql, marcadas, tocadas } = banco([alma1, ide1, alma2, ide2]);
    const visitadas: string[] = [];
    const daAlma = fonte(visitadas, { code: 190, message: 'Error validating access token' });
    const daIde = fonte(visitadas);

    const r = await coletar(sql, (segredo) => (segredo === ALMA ? daAlma : daIde));

    // A Alma9 é tentada UMA vez (a que descobre o token vencido); a segunda
    // conta dela nem chega à Meta.
    expect(visitadas).toEqual(['ig_alma1', 'ig_ide1', 'ig_ide2']);
    expect(r.interrompida).toBe(false);
    expect(r.ativosTotal).toBe(4);
    expect(r.ativosOk).toBe(2);
    expect(r.ativosComFalha).toBe(2);
    expect(r.desfecho).toBe('partial');
    expect(r.primeiraFalha).toMatch(/token/i);

    // Todas as quatro andam na fila — é o que impede as contas sem visita de
    // ficarem na frente da fila para sempre, ocupando o lote da Ide.
    expect(marcadas()).toEqual(['a1', 'i1', 'a2', 'i2']);

    // E a conta pulada diz POR QUÊ na tela de conexões.
    const puladas = tocadas().filter((t) => t.id === 'a2');
    expect(puladas).toHaveLength(1);
    expect(String(puladas[0].erro)).toMatch(/token/i);
  });

  it('o token padrão vence: só as contas sem credencial própria ficam de fora', async () => {
    const { sql } = banco([ide1, alma1, ide2, alma2]);
    const visitadas: string[] = [];
    const daIde = fonte(visitadas, { code: 190, message: 'expired' });
    const daAlma = fonte(visitadas);

    const r = await coletar(sql, (segredo) => (segredo === ALMA ? daAlma : daIde));

    expect(visitadas).toEqual(['ig_ide1', 'ig_alma1', 'ig_alma2']);
    expect(r.ativosOk).toBe(2);
    expect(r.ativosComFalha).toBe(2);
    expect(r.interrompida).toBe(false);
  });

  it('limite de uso continua parando a execução inteira', async () => {
    const { sql } = banco([ide1, alma1, ide2]);
    const visitadas: string[] = [];
    const daIde = fonte(visitadas, { code: 17, message: 'User request limit reached' });
    const daAlma = fonte(visitadas);

    const r = await coletar(sql, (segredo) => (segredo === ALMA ? daAlma : daIde));

    expect(visitadas).toEqual(['ig_ide1']);
    expect(r.interrompida).toBe(true);
    expect(r.ativosComFalha).toBe(1);
  });

  it('todas as contas com o token vencido: a execução fecha como falha e não pendura', async () => {
    const { sql } = banco([ide1, ide2]);
    const visitadas: string[] = [];

    const r = await coletar(sql, () => fonte(visitadas, { code: 190, message: 'expired' }));

    expect(visitadas).toEqual(['ig_ide1']);
    expect(r.desfecho).toBe('failed');
    expect(r.ativosComFalha).toBe(2);
    expect(r.ativosOk).toBe(0);
  });
});
