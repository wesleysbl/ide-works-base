/**
 * QUEM SÓ VÊ A TAREFA NÃO OUVE "OK" AO MEXER NO CHECKLIST E NO LINK.
 *
 * O DEFEITO
 *   A leitura de `task_checklists`, `checklist_items` e `task_links` vale para
 *   quem alcança a tarefa — inclusive o nível "ver". A escrita pede `execute`
 *   (F17.75). Para quem só vê, o `update`/`delete` não falha: só não acha linha
 *   para mudar. As seis escritas abaixo achavam a linha na leitura, escreviam
 *   zero linhas e devolviam a ficha com 200 — a tela assentava como se tivesse
 *   gravado.
 *
 * O QUE SE PROVA
 *   O mesmo desenho de `deleteAttachment` (F17.6): a linha existe (senão 404),
 *   a escrita volta vazia → `BoardRefused` 403 com a frase. O banco dublê imita
 *   a política: a leitura acha a linha para todos; a escrita só devolve linha
 *   para quem executa. `lerFicha` é dublê: a ficha não é o assunto.
 *
 * NENHUMA REDE
 *   A suíte não fala com o banco (F0.4).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskDetail } from '@/board/ficha';
import { BoardRefused } from '@/server/board';
import { deleteLink, patchLink } from '@/server/board-anexos';
import {
  deleteChecklist,
  deleteChecklistItem,
  patchChecklistItem,
  renameChecklist,
} from '@/server/board-passos';
import type { Sql } from '@/server/db';
import type { AuthenticatedActor } from '@/server/session';

vi.mock('@/server/board-task', () => ({
  lerFicha: vi.fn(async (_tx: unknown, taskId: string) => ({ id: taskId, title: 'Tarefa' }) as TaskDetail),
}));

const actor: AuthenticatedActor = {
  userId: '00000000-0000-0000-0000-0000000000b2',
  email: 'equipe@example.invalid',
  papel: 'funcionario',
  isSuperadmin: false,
  isSuper: false,
  areas: ['quadro'],
  hasAllClientsAccess: false,
};

const TAREFA = '00000000-0000-0000-0000-00000000aaa1';
const ALVO = '00000000-0000-0000-0000-00000000bbb1';

/** O nível de quem pede: "ver" lê e não escreve; "executar" faz os dois. */
let nivel: 'ver' | 'executar';
const escritas: string[] = [];

/** O resultado de um `update`/`delete` do `postgres.js`: lista com `count`. */
const linhas = (rows: unknown[]) => Object.assign([...rows], { count: rows.length });

const sql = {
  begin: async (work: (tx: unknown) => Promise<unknown>) =>
    work(async (partes: TemplateStringsArray) => {
      const texto = partes.join('?');
      if (texto.includes('set_config')) return [];
      // A leitura que acha a tarefa dona: a política de leitura deixa os dois níveis.
      if (/^\s*select\b/.test(texto) && texto.includes('task_id')) return [{ task_id: TAREFA }];
      if (/^\s*(update|delete)\b/.test(texto)) {
        escritas.push(texto);
        // A política de escrita: só `execute` acha a linha para mudar.
        return nivel === 'executar' ? linhas([{ id: ALVO }]) : linhas([]);
      }
      throw new Error(`Consulta não prevista na prova: ${texto}`);
    }),
} as unknown as Sql;

/** As seis escritas que o defeito alcançava, com o mesmo alvo. */
const ESCRITAS: [string, () => Promise<TaskDetail>][] = [
  ['renomear o checklist', () => renameChecklist(sql, actor, ALVO, 'Roteiro')],
  ['apagar o checklist', () => deleteChecklist(sql, actor, ALVO)],
  ['renomear o item', () => patchChecklistItem(sql, actor, ALVO, { name: 'Gravar' })],
  ['atribuir o item', () => patchChecklistItem(sql, actor, ALVO, { assigneeId: actor.userId })],
  ['apagar o item', () => deleteChecklistItem(sql, actor, ALVO)],
  ['editar o link', () => patchLink(sql, actor, ALVO, { label: 'Dropbox' })],
  ['apagar o link', () => deleteLink(sql, actor, ALVO)],
];

beforeEach(() => {
  escritas.length = 0;
});

describe('quem só vê: 403 com frase, e não a ficha de volta', () => {
  beforeEach(() => {
    nivel = 'ver';
  });

  it.each(ESCRITAS)('%s', async (_nome, escrever) => {
    const erro = await escrever().then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(BoardRefused);
    expect((erro as BoardRefused).status).toBe(403);
    expect((erro as BoardRefused).message).toMatch(/^Você não pode (mexer|apagar)/);
    // A recusa é a do banco (a escrita foi tentada), e não um palpite.
    expect(escritas).toHaveLength(1);
  });
});

describe('quem executa: a escrita passa e a ficha volta, como antes', () => {
  beforeEach(() => {
    nivel = 'executar';
  });

  it.each(ESCRITAS)('%s', async (_nome, escrever) => {
    await expect(escrever()).resolves.toEqual({ id: TAREFA, title: 'Tarefa' });
    expect(escritas).toHaveLength(1);
  });
});
