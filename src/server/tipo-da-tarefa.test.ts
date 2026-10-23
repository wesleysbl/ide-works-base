/**
 * O tipo da tarefa nas leituras e na recusa — F40, Fase 2.
 *
 * Sem banco (F0.4): as leituras são provadas pelo mapeamento linha → cartão,
 * que é o que quadro, pasta, Minhas tarefas e espaço compartilham. A criação e
 * a edição têm os testes em `escritas-no-tx.test.ts`; o movimento, em
 * `mudanca-de-lista.test.ts`; a regra no banco, em `tipo-da-tarefa-banco.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { TypeRequired, paraCartao, tipoObrigatorioDoBanco } from '@/server/board';
import { paraWorkRow } from '@/server/board-trabalho';
import {
  FRASE_TIPO_OBRIGATORIO,
  OPCOES_DO_TIPO,
  comoTipoLido,
  ehTipoDaTarefa,
} from '@/server/tipo-da-tarefa';

const linha = { id: 't1', title: 'Reels', demand_type: 'video' };

describe('as leituras devolvem o tipo no campo `type`', () => {
  it('cartão do quadro e da pasta', () => {
    expect(paraCartao(linha).type).toBe('video');
    expect(paraCartao({ ...linha, demand_type: null }).type).toBeNull();
    expect(paraCartao({ id: 't1', title: 'x' }).type).toBeNull();
  });

  it('Minhas tarefas, Todas as tarefas e o espaço (WorkRow)', () => {
    expect(paraWorkRow(linha as never).type).toBe('video');
    expect(paraWorkRow({ ...linha, demand_type: 'outros' } as never).type).toBe('outros');
  });

  it('valor fora dos quatro lido do banco vira nulo, e não texto solto', () => {
    expect(comoTipoLido('banner')).toBeNull();
    expect(comoTipoLido(undefined)).toBeNull();
    expect(comoTipoLido('foto')).toBe('foto');
  });
});

describe('a recusa type_required', () => {
  it('diz código, frase, status 400 e as quatro opções', () => {
    const e = new TypeRequired();
    expect(e.code).toBe('type_required');
    expect(e.message).toBe(FRASE_TIPO_OBRIGATORIO);
    expect(e.status).toBe(400);
    expect(e.options).toEqual(OPCOES_DO_TIPO);
    expect(e.options.map((o) => o.label)).toEqual(['Vídeo', 'Arte', 'Foto', 'Outros']);
  });

  it('o SQLSTATE IW040 (ou o hint) do banco é traduzido; outro erro não', () => {
    expect(tipoObrigatorioDoBanco({ code: 'IW040' })).toBeInstanceOf(TypeRequired);
    expect(tipoObrigatorioDoBanco({ hint: 'type_required' })).toBeInstanceOf(TypeRequired);
    expect(tipoObrigatorioDoBanco({ code: '23514' })).toBeNull();
    expect(tipoObrigatorioDoBanco(null)).toBeNull();
  });

  it('só os quatro valores são tipo', () => {
    expect(['video', 'arte', 'foto', 'outros'].every(ehTipoDaTarefa)).toBe(true);
    expect(ehTipoDaTarefa('Vídeo')).toBe(false);
    expect(ehTipoDaTarefa(null)).toBe(false);
  });
});
