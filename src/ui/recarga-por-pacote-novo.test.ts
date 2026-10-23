import { describe, expect, it } from 'vitest';

import { INTERVALO_ENTRE_RECARGAS_MS, deveRecarregarPorPacoteNovo } from '@/ui/recarga-por-pacote-novo';

describe('recarga da aba aberta durante uma publicação — conferência de 08/10', () => {
  const agora = 1_000_000_000;

  it('primeira falha da sessão: recarrega', () => {
    expect(deveRecarregarPorPacoteNovo(agora, null)).toBe(true);
  });

  it('acabou de recarregar e falhou de novo: NÃO recarrega (sem laço; mostra a tela de erro)', () => {
    expect(deveRecarregarPorPacoteNovo(agora, agora - 5_000)).toBe(false);
  });

  it('a última recarga foi há mais que o intervalo (outra publicação no mesmo dia): recarrega', () => {
    expect(deveRecarregarPorPacoteNovo(agora, agora - INTERVALO_ENTRE_RECARGAS_MS - 1)).toBe(true);
  });

  it('marca ilegível no armazenamento vale como nenhuma', () => {
    expect(deveRecarregarPorPacoteNovo(agora, Number.NaN)).toBe(true);
  });
});
