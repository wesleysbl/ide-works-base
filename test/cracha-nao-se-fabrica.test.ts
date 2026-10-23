/**
 * CRACHÁ NÃO SE FABRICA — F17.38.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTE TESTE EXISTE PARA IMPEDIR
 *
 *   Até 2026-08-31, `resetPorts` montava o ator na mão:
 *
 *       const comoAdministrador = { kind: 'user', userId: actorId, isSuperadmin: true }
 *
 *   Faltava `isSuper`, e o tipo o aceitava faltando (`isSuper?`). Foi inofensivo
 *   enquanto `profiles_select` não olhava empresa. A F17.34 fez ela olhar — e o
 *   crachá inventado passou a valer como ADMINISTRADOR COMUM. O dono do
 *   sistema, que tem ZERO empresas marcadas, deixou de enxergar as próprias
 *   pessoas: `Redefinir` respondia "não há conta do IDE Works para esta pessoa"
 *   para gente visível na tela ao lado.
 *
 *   Nenhum dos 1841 testes viu. Eles provam a REGRA — quem enxerga quem —, e a
 *   regra estava certa. Errado era o crachá apresentado a ela.
 *
 * A TRAVA DE VERDADE É O COMPILADOR, E ELA VEIO JUNTO
 *   `Actor.isSuper` deixou de ser opcional em `server/db.ts`. Crachá incompleto
 *   agora não compila, e isso pega mais do que qualquer varredura de texto.
 *
 *   Este teste guarda o degrau anterior: montar `{ kind: 'user', … }` à mão em
 *   vez de repassar o crachá que veio da sessão. Um objeto completo mas
 *   INVENTADO compila — e envelhece sozinho quando a regra muda de lugar, que é
 *   exatamente como este defeito nasceu.
 *
 * ⚠️ POR QUE ELE NÃO PROCURA `isSuperadmin:` SOLTO
 *   A primeira versão procurava, e acusou cinco arquivos inocentes: `areas.ts`,
 *   `api.ts`, `sessao.ts` e outros apenas DECLARAM o campo num tipo. Verificação
 *   que acusa inocente ensina a ignorar verificação — o projeto já pagou por
 *   isso em `proibido.mjs`, que existe justamente para não bater em comentário.
 *
 * ELE LÊ O FONTE, como `nada-de-sql-na-tela.test.ts` e `toda-tela-diz-onde-esta`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(import.meta.dirname, '..', 'src');

function arquivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return arquivos(caminho);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [caminho] : [];
  });
}

/** Sem comentários: a explicação da ausência não pode acusar a presença. */
function semComentario(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('crachá não se fabrica', () => {
  const fontes = arquivos(RAIZ).map((caminho) => ({
    caminho: caminho.slice(RAIZ.length + 1).replace(/\\/g, '/'),
    codigo: semComentario(readFileSync(caminho, 'utf8')),
  }));

  it('ninguém monta `{ kind: "user", … }` à mão — o crachá vem da sessão', () => {
    // `db.ts` DECLARA a forma; `session.ts` é o único que a MONTA, lendo do
    // banco. Declarar e montar são coisas diferentes, e só o segundo é o risco.
    //
    // `{ kind: 'preauth' }` fica de fora de propósito: não tem pessoa e não tem
    // permissão a copiar, então não há o que envelhecer.
    const permitidos = new Set(['server/session.ts', 'server/db.ts']);

    const culpados = fontes
      .filter((f) => !permitidos.has(f.caminho))
      .filter((f) => /kind\s*:\s*'user'/.test(f.codigo))
      .map((f) => f.caminho);

    expect(culpados).toEqual([]);
  });

  it('e o tipo do crachá exige `isSuper` — a trava que o compilador aplica', () => {
    // Se alguém voltar a `isSuper?`, o defeito de 31/08 volta a compilar.
    const db = fontes.find((f) => f.caminho === 'server/db.ts');
    expect(db).toBeDefined();
    expect(db!.codigo).toContain('isSuper: boolean');
    expect(db!.codigo).not.toContain('isSuper?:');
  });
});
