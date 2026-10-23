import { describe, expect, it } from 'vitest';

import {
  RITUAL_LABEL,
  type RitualState,
  decideRitualChange,
  ritualStage,
} from '@/delivery/month-ritual';

const fechado: RitualState = {
  monthOpened: false,
  planningDoneAt: null,
  clientApprovedAt: null,
};
const aberto: RitualState = { ...fechado, monthOpened: true };
const planejado: RitualState = { ...aberto, planningDoneAt: '2026-08-01T10:00:00Z' };
const aprovado: RitualState = { ...planejado, clientApprovedAt: '2026-08-02T10:00:00Z' };

describe('nada acontece antes de abrir o mês', () => {
  it.each([
    ['planejar', { step: 'planning' as const, done: true }],
    ['aprovar', { step: 'approval' as const, done: true }],
  ])('recusa %s num mês fechado', (_n, mudanca) => {
    const d = decideRitualChange(fechado, mudanca);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('month_not_opened');
  });

  it('explica que abrir congela o contrato', () => {
    const d = decideRitualChange(fechado, { step: 'planning', done: true });
    if (!d.ok) expect(d.message).toContain('congela o contrato');
  });
});

describe('aprovação é aprovação de um plano', () => {
  it('recusa aprovar um mês que ninguém planejou', () => {
    const d = decideRitualChange(aberto, { step: 'approval', done: true });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('planning_required_first');
  });

  it('explica que ninguém saberia depois com o que o cliente concordou', () => {
    const d = decideRitualChange(aberto, { step: 'approval', done: true });
    if (!d.ok) expect(d.message).toContain('com o que o cliente concordou');
  });

  it('aceita aprovar depois de planejado', () => {
    expect(decideRitualChange(planejado, { step: 'approval', done: true }).ok).toBe(true);
  });

  it('retirar a aprovação é sempre permitido', () => {
    expect(decideRitualChange(aprovado, { step: 'approval', done: false }).ok).toBe(true);
  });
});

describe('não se apaga o objeto de uma aprovação', () => {
  it('recusa reabrir o planejamento de um mês já aprovado', () => {
    const d = decideRitualChange(aprovado, { step: 'planning', done: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('approval_must_be_undone_first');
  });

  it('diz o que fazer: retirar a aprovação primeiro', () => {
    const d = decideRitualChange(aprovado, { step: 'planning', done: false });
    if (!d.ok) expect(d.message).toContain('Retire a aprovação antes');
  });

  it('depois de retirada a aprovação, reabrir o planejamento é permitido', () => {
    const semAprovacao = { ...aprovado, clientApprovedAt: null };
    const d = decideRitualChange(semAprovacao, { step: 'planning', done: false });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.note).toContain('fica registrado');
  });
});

describe('em que ponto do ciclo o mês está', () => {
  it.each([
    [fechado, 'fechado'],
    [aberto, 'aberto'],
    [planejado, 'planejado'],
    [aprovado, 'aprovado'],
  ] as const)('reconhece %#', (estado, esperado) => {
    expect(ritualStage(estado)).toBe(esperado);
  });

  it('todo estágio tem rótulo em português', () => {
    for (const estado of [fechado, aberto, planejado, aprovado]) {
      expect(RITUAL_LABEL[ritualStage(estado)]).toBeTruthy();
    }
  });

  it('aprovado vence planejado — mostra onde o ciclo chegou, não por onde passou', () => {
    expect(ritualStage(aprovado)).toBe('aprovado');
  });
});
