/**
 * O foco que volta — a decisão pura de `useDevolverFoco`.
 *
 * O hook mora no DOM (e a suíte roda sem navegador); o que se prova aqui é a
 * regra que ele consulta. As provas no Chrome estão em
 * `scripts/e2e/acessibilidade.mjs` (AC1 a AC3).
 */

import { describe, expect, it } from 'vitest';

import { decidirDevolucaoDoFoco } from '@/ui/foco';

const base = { conectado: true, focoSemDono: true, desabilitado: false, restantes: 5 };

describe('decidirDevolucaoDoFoco', () => {
  it('devolve quando o foco ficou sem dono e o botão aceita foco', () => {
    expect(decidirDevolucaoDoFoco(base)).toBe('devolver');
  });

  it('não mexe quando alguém já tem o foco — a janela que abriu por cima, o campo que a pessoa escolheu', () => {
    expect(decidirDevolucaoDoFoco({ ...base, focoSemDono: false })).toBe('deixar');
  });

  it('não mexe quando o botão saiu da página (a lista recarregou e a linha sumiu)', () => {
    expect(decidirDevolucaoDoFoco({ ...base, conectado: false })).toBe('deixar');
  });

  it('espera o botão destravar: `focus()` num botão `disabled` falha calado, e o chip da ficha fica travado durante a gravação', () => {
    expect(decidirDevolucaoDoFoco({ ...base, desabilitado: true })).toBe('esperar');
  });

  it('desiste quando o botão não destrava a tempo — não fica tentando para sempre', () => {
    expect(decidirDevolucaoDoFoco({ ...base, desabilitado: true, restantes: 0 })).toBe('deixar');
  });

  it('com o botão destravado no meio da espera, devolve', () => {
    expect(decidirDevolucaoDoFoco({ ...base, desabilitado: false, restantes: 3 })).toBe('devolver');
  });
});
