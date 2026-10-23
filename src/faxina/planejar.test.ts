import { describe, expect, it } from 'vitest';

import { montarCsv, lerCsv } from './csv';
import {
  LISTAS_COMPARTILHADAS,
  type LinhaLida,
  type TarefaLida,
  linhasDaPlanilha,
  listaExigeCliente,
  marcouInterna,
  planejarPreenchimento,
  resolverCliente,
  validarPlanilha,
} from './planejar';
import type { ClienteRef } from './sugestao';

const FONSECA: ClienteRef = { id: '11111111-1111-1111-1111-111111111111', name: 'Fonseca Moura Construtora', isActive: true };
const CHARME: ClienteRef = { id: '22222222-2222-2222-2222-222222222222', name: 'Capricho do Detalhe', isActive: false };
const ZECA: ClienteRef = { id: '33333333-3333-3333-3333-333333333333', name: 'Zeca', isActive: true };
const CLIENTES = [FONSECA, CHARME, ZECA];

const LISTA_FONSECA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ATENDIMENTO = [...LISTAS_COMPARTILHADAS][0] as string;
const INTERNA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let n = 0;
const tarefa = (extra: Partial<TarefaLida>): TarefaLida => {
  n += 1;
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
    parentId: null,
    clientId: null,
    listId: LISTA_FONSECA,
    title: 'Tarefa',
    archived: false,
    createdAt: `2026-10-0${(n % 9) + 1}T12:00:00.000Z`,
    completedAt: null,
    status: 'A fazer',
    listName: 'Fonseca',
    folderName: 'Fonseca',
    listClientId: FONSECA.id,
    listRequiresClient: false,
    ...extra,
  };
};
const naAtendimento = (extra: Partial<TarefaLida> = {}) =>
  tarefa({ listId: ATENDIMENTO, listName: 'ATENDIMENTO', listClientId: null, ...extra });

describe('planejarPreenchimento', () => {
  it('grava o cliente da lista só em tarefa não arquivada que só o tem na lista', () => {
    const so = tarefa({ title: '[A] FONSECA MOURA - Post' });
    const semPrefixo = tarefa({ title: 'Post sem prefixo' });
    const jaTem = tarefa({ clientId: FONSECA.id });
    const arquivada = tarefa({ archived: true });
    const semNada = naAtendimento();
    const plano = planejarPreenchimento([so, semPrefixo, jaTem, arquivada, semNada], CLIENTES);
    expect(plano.arvores.map((a) => a.raizId).sort()).toEqual([so.id, semPrefixo.id].sort());
    expect(plano.arvores.every((a) => a.clienteId === FONSECA.id)).toBe(true);
    expect(plano.contagem.aGravar).toBe(2);
    expect(plano.excluidas).toEqual([]);
  });

  it('o título que aponta OUTRO cliente fica de fora e vai para a planilha', () => {
    const charme = tarefa({ title: '[A] CAPRICHO DO DETALHE - Post' });
    const plano = planejarPreenchimento([charme], CLIENTES);
    expect(plano.arvores).toEqual([]);
    expect(plano.excluidas).toHaveLength(1);
    expect(plano.excluidas[0]?.sugestao.cliente?.id).toBe(CHARME.id);
    expect(plano.excluidas[0]?.clienteDaLista?.id).toBe(FONSECA.id);
    const linhas = linhasDaPlanilha([charme], CLIENTES, plano.excluidas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.origem).toBe('outro-cliente');
  });

  it('mãe e filhas saem juntas, com a contagem de mães e filhas', () => {
    const mae = tarefa({ title: '[A] FONSECA - Mãe' });
    const filha = tarefa({ parentId: mae.id, title: 'Passo 1' });
    const arquivada = tarefa({ parentId: mae.id, archived: true, title: 'Passo velho' });
    const plano = planejarPreenchimento([mae, filha, arquivada], CLIENTES);
    expect(plano.arvores).toHaveLength(1);
    expect(plano.arvores[0]?.aGravar.map((t) => t.id).sort()).toEqual([mae.id, filha.id, arquivada.id].sort());
    expect(plano.contagem).toMatchObject({ naoArquivadasAGravar: 2, maes: 1, filhas: 1 });
  });

  it('se a mãe aponta outro cliente, as filhas vão junto para a planilha', () => {
    const mae = tarefa({ title: '[A] CAPRICHO DO DETALHE - Mãe' });
    const filha = tarefa({ parentId: mae.id, title: 'Passo 1' });
    const plano = planejarPreenchimento([mae, filha], CLIENTES);
    expect(plano.arvores).toEqual([]);
    expect(plano.excluidas.map((e) => e.tarefa.id).sort()).toEqual([mae.id, filha.id].sort());
  });
});

describe('linhasDaPlanilha', () => {
  it('uma linha por tarefa não arquivada sem cliente na tarefa nem na lista, com sugestão', () => {
    const a = naAtendimento({ title: '[A] FONSECA MOURA - Post' });
    const b = naAtendimento({ title: '2 - O TOQUE FINAL' });
    const arq = naAtendimento({ archived: true });
    const comCliente = naAtendimento({ clientId: ZECA.id });
    const linhas = linhasDaPlanilha([a, b, arq, comCliente], CLIENTES, []);
    expect(linhas).toHaveLength(2);
    expect(linhas.find((l) => l.tarefa.id === a.id)?.sugestao).toMatchObject({ grau: 'exato', cliente: { id: FONSECA.id } });
    expect(linhas.find((l) => l.tarefa.id === b.id)?.sugestao.grau).toBe('nenhum');
  });
});

describe('listaExigeCliente', () => {
  it('a marca do banco ou uma das quatro listas compartilhadas, desde que a lista não tenha cliente', () => {
    expect(listaExigeCliente(naAtendimento())).toBe(true);
    expect(listaExigeCliente(tarefa({ listId: INTERNA, listClientId: null, listRequiresClient: true }))).toBe(true);
    expect(listaExigeCliente(tarefa({ listId: INTERNA, listClientId: null }))).toBe(false);
    expect(listaExigeCliente(tarefa({ listId: ATENDIMENTO }))).toBe(false); // tem cliente na lista
  });
});

describe('validarPlanilha', () => {
  const linha = (t: TarefaLida, confirmado = '', interna = '', numero = 2): LinhaLida => ({
    numero,
    tarefa: t.id,
    confirmado,
    interna,
  });

  it('com "cliente confirmado" e "interna" vazios não faz nada', () => {
    const t = naAtendimento();
    const { resultados, arvores } = validarPlanilha([linha(t)], [t], CLIENTES);
    expect(resultados[0]?.acao).toBe('nada');
    expect(arvores).toEqual([]);
  });

  it('nome com acento e maiúscula diferentes casa; o sinal "(cancelado)" copiado da sugestão é tolerado', () => {
    const t = naAtendimento();
    const u = naAtendimento();
    const v = validarPlanilha(
      [linha(t, 'FONSECA MOURA CONSTRUTORA', '', 2), linha(u, 'capricho do detalhe (cancelado)', '', 3)],
      [t, u],
      CLIENTES,
    );
    expect(v.resultados[0]).toMatchObject({ acao: 'gravar', clienteId: FONSECA.id });
    expect(v.resultados[1]).toMatchObject({ acao: 'gravar', clienteId: CHARME.id, cancelado: true });
    expect(resolverCliente('FONSECA MOURA CONSTRUTORA', CLIENTES).ok).toBe(true);
    expect(resolverCliente(FONSECA.id, CLIENTES).ok).toBe(true);
  });

  it('cliente desconhecido é recusado, com o motivo', () => {
    const t = naAtendimento();
    const { resultados } = validarPlanilha([linha(t, 'Fonseca')], [t], CLIENTES);
    expect(resultados[0]).toMatchObject({ acao: 'recusada' });
    expect(resultados[0]?.motivo).toMatch(/desconhecido/);
  });

  it('nome que é de dois clientes é ambíguo e recusado', () => {
    const dup: ClienteRef = { id: '44444444-4444-4444-4444-444444444444', name: 'zeca', isActive: false };
    const t = naAtendimento();
    const { resultados } = validarPlanilha([linha(t, 'Zeca')], [t], [...CLIENTES, dup]);
    expect(resultados[0]?.acao).toBe('recusada');
    expect(resultados[0]?.motivo).toMatch(/ambíguo/);
  });

  it('"interna" em lista que exige cliente é recusada; em lista interna, passa', () => {
    const exige = naAtendimento();
    const livre = tarefa({ listId: INTERNA, listName: 'Rotina', listClientId: null });
    const { resultados } = validarPlanilha([linha(exige, '', 'sim', 2), linha(livre, '', 'x', 3)], [exige, livre], CLIENTES);
    expect(resultados[0]?.acao).toBe('recusada');
    expect(resultados[0]?.motivo).toMatch(/exige cliente/);
    expect(resultados[1]?.acao).toBe('interna');
    expect(marcouInterna('Sim')).toBe(true);
    expect(marcouInterna('não')).toBe(false);
  });

  it('recusa tarefa arquivada, já com cliente, repetida e inexistente', () => {
    const arq = naAtendimento({ archived: true });
    const tem = naAtendimento({ clientId: ZECA.id });
    const rep = naAtendimento();
    const { resultados } = validarPlanilha(
      [
        linha(arq, 'Zeca', '', 2),
        linha(tem, 'Zeca', '', 3),
        linha(rep, 'Zeca', '', 4),
        linha(rep, 'Zeca', '', 5),
        { numero: 6, tarefa: '99999999-9999-9999-9999-999999999999', confirmado: 'Zeca', interna: '' },
      ],
      [arq, tem, rep],
      CLIENTES,
    );
    expect(resultados.map((r) => r.acao)).toEqual(['recusada', 'recusada', 'gravar', 'recusada', 'recusada']);
  });

  it('mãe e filhas: a confirmação de uma arrasta a árvore; clientes diferentes na árvore são recusados', () => {
    const mae = naAtendimento();
    const f1 = naAtendimento({ parentId: mae.id });
    const f2 = naAtendimento({ parentId: mae.id });
    const ok = validarPlanilha([linha(mae, 'Zeca', '', 2)], [mae, f1, f2], CLIENTES);
    expect(ok.arvores).toHaveLength(1);
    expect(ok.arvores[0]?.aGravar.map((t) => t.id).sort()).toEqual([mae.id, f1.id, f2.id].sort());

    const conflito = validarPlanilha([linha(mae, 'Zeca', '', 2), linha(f1, 'Fonseca Moura Construtora', '', 3)], [mae, f1, f2], CLIENTES);
    expect(conflito.arvores).toEqual([]);
    expect(conflito.resultados.every((r) => r.acao === 'recusada')).toBe(true);
  });
});

describe('csv', () => {
  it('vai e volta com acento, separador, aspas e quebra de linha', () => {
    const csv = montarCsv(['a', 'b'], [['Ação; com ponto-e-vírgula', 'diz "oi"\nlinha 2'], ['=SOMA(1)', '']]);
    expect(csv.startsWith('﻿')).toBe(true);
    const volta = lerCsv(csv);
    expect(volta[0]).toEqual(['a', 'b']);
    expect(volta[1]).toEqual(['Ação; com ponto-e-vírgula', 'diz "oi"\nlinha 2']);
    expect(volta[2]?.[0]).toBe("'=SOMA(1)");
  });

  it('detecta a vírgula do Google Sheets', () => {
    expect(lerCsv('tarefa,cliente confirmado\nabc,"Zeca, o"\n')).toEqual([
      ['tarefa', 'cliente confirmado'],
      ['abc', 'Zeca, o'],
    ]);
  });
});
