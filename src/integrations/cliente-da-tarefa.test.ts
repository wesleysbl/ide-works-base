/**
 * O cliente da tarefa — F38, Fase 6.
 *
 * A regra de LEITURA (o da tarefa vence; na falta dele, o da lista) e a de
 * CRIAÇÃO (herda da lista; compartilhada exige; interna aceita sem), em
 * TypeScript e nos dublês em memória do MCP. A mesma regra em SQL, contra um
 * Postgres de verdade, é `src/server/cliente-da-tarefa-banco.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { IntegrationCapability } from '@/integrations/grants';
import { MemoryWorkCatalog, type MemoryBoard, type MemoryTask, type WorkScope } from '@/integrations/reads';
import {
  FRASE_CLIENTE_FORA_DO_ALCANCE,
  FRASE_LISTA_COMPARTILHADA,
  clienteDaTarefa,
  decidirClienteDaNovaTarefa,
} from '@/server/cliente-da-tarefa';
import { emPortugues } from '@/server/recusas';

describe('clienteDaTarefa — a regra de leitura em TypeScript', () => {
  it('o da tarefa vence o da lista; na falta dele vale o da lista; sem os dois, nulo', () => {
    expect(clienteDaTarefa('da-tarefa', 'da-lista')).toBe('da-tarefa');
    expect(clienteDaTarefa(null, 'da-lista')).toBe('da-lista');
    expect(clienteDaTarefa(undefined, 'da-lista')).toBe('da-lista');
    expect(clienteDaTarefa(null, null)).toBeNull();
    expect(clienteDaTarefa('da-tarefa', null)).toBe('da-tarefa');
  });
});

describe('decidirClienteDaNovaTarefa — a regra de criação', () => {
  const daFonseca = { clientId: 'fonseca', requiresClient: false, companyId: 'ide' };
  const compartilhada = { clientId: null, requiresClient: true, companyId: 'ide' };
  const interna = { clientId: null, requiresClient: false, companyId: 'ide' };
  const ativo = (id: string, companyId = 'ide') => ({ id, name: id, companyId, isActive: true, cancelledOn: null });

  it('lista de cliente sem escolha herda o cliente da lista', () => {
    expect(decidirClienteDaNovaTarefa(daFonseca, undefined, undefined)).toEqual({ ok: true, clientId: 'fonseca' });
  });

  it('a frase do gatilho (23514) passa intacta pela tradução do quadro', () => {
    // Com a migration aplicada e o Worker antigo, quem recusa é o gatilho, e a
    // frase dele chega à tela por `emPortugues`.
    expect(emPortugues(FRASE_LISTA_COMPARTILHADA)).toBe(FRASE_LISTA_COMPARTILHADA);
  });

  it('lista compartilhada sem escolha é recusada com a frase do quadro', () => {
    expect(decidirClienteDaNovaTarefa(compartilhada, null, undefined)).toEqual({
      ok: false,
      motivo: 'lista_compartilhada',
      mensagem: FRASE_LISTA_COMPARTILHADA,
    });
  });

  it('lista interna aceita sem cliente e com cliente', () => {
    expect(decidirClienteDaNovaTarefa(interna, undefined, undefined)).toEqual({ ok: true, clientId: null });
    expect(decidirClienteDaNovaTarefa(interna, 'help', ativo('help'))).toEqual({ ok: true, clientId: 'help' });
  });

  it('compartilhada com cliente ativo e visível cria com ele', () => {
    expect(decidirClienteDaNovaTarefa(compartilhada, 'help', ativo('help'))).toEqual({ ok: true, clientId: 'help' });
  });

  it('cliente que não volta da leitura (fora do alcance) é recusado', () => {
    expect(decidirClienteDaNovaTarefa(compartilhada, 'sumido', null)).toEqual({
      ok: false,
      motivo: 'fora_do_alcance',
      mensagem: FRASE_CLIENTE_FORA_DO_ALCANCE,
    });
  });

  it('cliente cancelado é recusado com o nome e a data', () => {
    const r = decidirClienteDaNovaTarefa(compartilhada, 'zeca', {
      id: 'zeca',
      name: 'Zeca',
      companyId: 'ide',
      isActive: false,
      cancelledOn: '2025-12-30',
    });
    expect(r).toMatchObject({ ok: false, motivo: 'cancelado' });
    if (!r.ok) expect(r.mensagem).toContain('O cliente Zeca foi cancelado em 30/12/2025');
  });

  it('outro cliente em lista de cliente e cliente de outra empresa são recusados', () => {
    expect(decidirClienteDaNovaTarefa(daFonseca, 'help', ativo('help'))).toMatchObject({ ok: false, motivo: 'outro_cliente' });
    expect(decidirClienteDaNovaTarefa(daFonseca, 'fonseca', ativo('fonseca'))).toEqual({ ok: true, clientId: 'fonseca' });
    expect(decidirClienteDaNovaTarefa(compartilhada, 'filmes', ativo('filmes', 'ide-filmes'))).toMatchObject({
      ok: false,
      motivo: 'outra_empresa',
    });
  });
});

describe('MemoryWorkCatalog segue a regra única do SQL', () => {
  const CAPS = new Set<IntegrationCapability>(['boards:read', 'tasks:read', 'clients:read', 'people:read']);
  const tudo: WorkScope = { companies: { kind: 'all' }, clients: 'all', capabilities: CAPS };
  const soHelp: WorkScope = { companies: { kind: 'all' }, clients: new Set(['help']), capabilities: CAPS };

  const quadro = (id: string, clientId: string | null, clientName: string | null): MemoryBoard => ({
    id,
    name: id,
    companyId: 'ide',
    companyName: 'Ide',
    spaceId: 'espaco',
    spaceName: 'AGÊNCIA IDE',
    folderId: null,
    folderName: null,
    clientId,
    clientName,
    canSeeSpace: true,
    statuses: [{ id: 'aberta', name: 'A fazer', sortOrder: 0, type: 'open' }],
  });
  const tarefa = (id: string, boardId: string, clientId: string | null, clientName: string | null): MemoryTask => ({
    id,
    title: `Peça ${id}`,
    description: null,
    companyId: 'ide',
    companyName: 'Ide',
    boardId,
    clientId,
    clientName,
    statusId: 'aberta',
    dueOn: null,
    people: [{ id: 'helena', name: 'Helena' }],
  });
  const catalogo = new MemoryWorkCatalog({
    boards: [quadro('lista-fonseca', 'fonseca', 'Fonseca Moura'), quadro('atendimento', null, null)],
    tasks: [
      // Só a lista tem cliente: vale o da lista.
      tarefa('herdada', 'lista-fonseca', null, null),
      // A tarefa tem o dela: vence o da lista.
      tarefa('escolhida', 'lista-fonseca', 'help', 'Hiper Center'),
      // Lista sem cliente e tarefa com cliente.
      tarefa('atendimento-help', 'atendimento', 'help', 'Hiper Center'),
      // Nem lista nem tarefa: sem cliente.
      tarefa('interna', 'atendimento', null, null),
    ],
    people: [{ id: 'helena', name: 'Helena', companyId: 'ide', companyName: 'Ide', detail: null }],
  });

  it('get_task, get_board, search e get_person_work dizem o mesmo cliente', async () => {
    const esperado: Record<string, string | null> = {
      herdada: 'fonseca',
      escolhida: 'help',
      'atendimento-help': 'help',
      interna: null,
    };
    for (const [id, cliente] of Object.entries(esperado)) {
      expect((await catalogo.getTask(tudo, id))?.client?.id ?? null).toBe(cliente);
    }
    const board = await catalogo.getBoard(tudo, 'lista-fonseca');
    expect(Object.fromEntries(board!.tasks.map((t) => [t.id, t.client?.id ?? null]))).toEqual({
      herdada: 'fonseca',
      escolhida: 'help',
    });
    expect(board!.tasks.find((t) => t.id === 'herdada')?.client?.name).toBe('Fonseca Moura');
    const achados = await catalogo.search(tudo, 'peça', ['task']);
    expect(Object.fromEntries(achados.map((h) => [h.id, h.client?.id ?? null]))).toEqual(esperado);
    const trabalho = await catalogo.getPersonWork(tudo, 'helena');
    expect(Object.fromEntries(trabalho!.tasks.map((t) => [t.id, t.client?.id ?? null]))).toEqual(esperado);
  });

  it('o recorte de cliente da conexão confere o cliente pela mesma regra', async () => {
    // Conexão só com o Hiper Center: a tarefa herdada da Fonseca fica fora; a
    // escolhida (Help na lista da Fonseca) e a interna ficam dentro.
    expect(await catalogo.getTask(soHelp, 'herdada')).toBeNull();
    expect(await catalogo.getTask(soHelp, 'escolhida')).not.toBeNull();
    expect(await catalogo.getTask(soHelp, 'interna')).not.toBeNull();
    const achados = await catalogo.search(soHelp, 'peça', ['task']);
    expect(achados.map((h) => h.id).sort()).toEqual(['atendimento-help', 'escolhida', 'interna']);
  });
});
