/**
 * Toda migração tem rollback, e todo rollback tem migração.
 *
 * OS DOIS ACHADOS QUE ESTE TESTE EXISTE PARA IMPEDIR
 *
 *   1. MIGRAÇÃO SEM ROLLBACK — a F7h estava assim. Descobre-se na hora de
 *      desfazer, que é a pior hora possível: alguém precisa reverter algo em
 *      produção e o arquivo não existe.
 *
 *   2. ROLLBACK SEM MIGRAÇÃO — e este é MUITO pior, embora pareça inofensivo.
 *      A F13 estava assim: aplicada em produção e nunca versionada. O rollback
 *      sozinho na pasta foi o que denunciou.
 *
 *      Migração aplicada e não versionada significa que reconstruir o banco a
 *      partir dos arquivos daria um banco DIFERENTE do que está no ar — e a
 *      diferença só apareceria quando alguém tentasse reconstruir, num momento
 *      em que já não há tempo para descobrir o que falta.
 *
 * POR QUE ISTO É UM TESTE, E NÃO UM COMBINADO
 *   Foi um combinado por 39 migrações, e falhou em duas. Uma regra que depende
 *   de alguém lembrar é uma regra que mede a memória de quem lembra, não o
 *   estado do projeto.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const so = (pasta: string) =>
  readdirSync(join(RAIZ, 'supabase', pasta)).filter((n) => n.endsWith('.sql'));

describe('migrações e rollbacks andam em par', () => {
  const migracoes = so('migrations');
  const rollbacks = so('rollback');

  it('há migrações para conferir', () => {
    // Sem isto, uma pasta renomeada faria o teste passar sem olhar nada.
    expect(migracoes.length).toBeGreaterThan(30);
  });

  it('toda migração tem rollback', () => {
    const semRollback = migracoes.filter((m) => !rollbacks.includes(m));
    expect(semRollback, `sem rollback: ${semRollback.join(', ')}`).toEqual([]);
  });

  it('todo rollback tem migração — o que denuncia migração não versionada', () => {
    const semMigracao = rollbacks.filter((r) => !migracoes.includes(r));
    expect(
      semMigracao,
      `rollback órfão, provável migração aplicada e não versionada: ${semMigracao.join(', ')}`,
    ).toEqual([]);
  });

  it('o nome diz a fase, para o par ser conferível de olho', () => {
    // `20260824140000_ideworks_f14e_algum_nome.sql`
    const fora = migracoes.filter((m) => !/^\d{14}_ideworks_f\d+[a-z]*_/.test(m));
    expect(fora, `fora do padrão de nome: ${fora.join(', ')}`).toEqual([]);
  });
});
