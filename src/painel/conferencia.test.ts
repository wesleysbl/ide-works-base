import { describe, expect, it } from 'vitest';

import {
  type ClienteParaConferir,
  type ListaParaConferir,
  FRASE_DA_CONFERENCIA,
  conferirVinculos,
  ehListaDeTrabalho,
} from '@/painel/conferencia';

const cliente = (over: Partial<ClienteParaConferir> = {}): ClienteParaConferir => ({
  id: 'c-1',
  name: 'Jatobá',
  isActive: true,
  ...over,
});

const lista = (over: Partial<ListaParaConferir> = {}): ListaParaConferir => ({
  id: 'l-1',
  name: 'Demandas',
  spaceName: 'TIME HELENA',
  clientId: null,
  archived: false,
  spaceArchived: false,
  taskCount: 0,
  ...over,
});

describe('ehListaDeTrabalho', () => {
  it('pede lista viva, espaço vivo e ao menos uma tarefa', () => {
    expect(ehListaDeTrabalho(lista({ taskCount: 1 }))).toBe(true);
  });

  it('lista recém-criada e vazia ainda não é ausência', () => {
    expect(ehListaDeTrabalho(lista({ taskCount: 0 }))).toBe(false);
  });
});

describe('conferirVinculos', () => {
  it('cliente ativo sem lista entra na conferência', () => {
    const r = conferirVinculos([cliente()], []);
    expect(r.clientesSemLista).toEqual([{ id: 'c-1', name: 'Jatobá' }]);
    expect(r.listasSemCliente).toEqual([]);
  });

  it('cliente inativo sem lista não entra — não tem trabalho corrente', () => {
    const r = conferirVinculos(
      [cliente({ isActive: false, name: 'Antigo' })],
      [],
    );
    expect(r.clientesSemLista).toEqual([]);
    expect(r.listasSemCliente).toEqual([]);
  });

  it('lista vazia sem cliente não entra — acabou de nascer', () => {
    const r = conferirVinculos([], [lista({ taskCount: 0, clientId: null })]);
    expect(r.clientesSemLista).toEqual([]);
    expect(r.listasSemCliente).toEqual([]);
  });

  it('lista com tarefas sem cliente entra na conferência', () => {
    const r = conferirVinculos(
      [],
      [lista({ taskCount: 3, clientId: null, name: 'Skills' })],
    );
    expect(r.clientesSemLista).toEqual([]);
    expect(r.listasSemCliente).toEqual([
      { id: 'l-1', name: 'Skills', spaceName: 'TIME HELENA' },
    ]);
  });

  it('lista arquivada sem cliente não entra, mesmo com tarefas', () => {
    const r = conferirVinculos(
      [],
      [lista({ archived: true, taskCount: 4, clientId: null })],
    );
    expect(r.clientesSemLista).toEqual([]);
    expect(r.listasSemCliente).toEqual([]);
  });

  it('lista em espaço arquivado não é lista de trabalho', () => {
    const r = conferirVinculos(
      [],
      [lista({ spaceArchived: true, taskCount: 2, clientId: null })],
    );
    expect(r.listasSemCliente).toEqual([]);
  });

  it('cliente ativo com lista ligada — inclusive arquivada — não é ausência', () => {
    const r = conferirVinculos(
      [cliente()],
      [lista({ clientId: 'c-1', archived: true, taskCount: 0 })],
    );
    expect(r.clientesSemLista).toEqual([]);
  });

  it('a frase diz trabalho pendente, não erro', () => {
    expect(FRASE_DA_CONFERENCIA).toMatch(/trabalho pendente/i);
    expect(FRASE_DA_CONFERENCIA).toMatch(/não erro/i);
  });
});
