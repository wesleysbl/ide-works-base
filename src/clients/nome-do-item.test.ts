import { describe, expect, it } from 'vitest';

import { type ItemNomeavel, nomeDoItem, nomesDosItens } from '@/clients/nome-do-item';

const item = (p: Partial<ItemNomeavel> = {}): ItemNomeavel => ({
  id: 'i1',
  contentType: 'video',
  scheduledAt: '2026-09-12T12:00:00Z',
  isExtra: false,
  title: 'Bastidores',
  ...p,
});

describe('o nome de um item de conteúdo — F11C (R47)', () => {
  it('diz tipo, título e dia — e não só "marcar Vídeo"', () => {
    expect(nomeDoItem(item())).toBe('Vídeo “Bastidores”, dia 12/09');
  });

  it('sem título e sem data também se diz', () => {
    expect(nomeDoItem(item({ title: null, scheduledAt: null }))).toBe('Vídeo sem título, sem data');
    expect(nomeDoItem(item({ title: '   ' }))).toBe('Vídeo sem título, dia 12/09');
  });

  it('o extra é dito no nome', () => {
    expect(nomeDoItem(item({ contentType: 'arte', isExtra: true }))).toBe('Arte “Bastidores”, dia 12/09, extra');
  });

  it('nomes distintos ficam como estão; os repetidos ganham a posição', () => {
    const lista = [
      item({ id: 'a', title: null, scheduledAt: null }),
      item({ id: 'b' }),
      item({ id: 'c', title: null, scheduledAt: null }),
      item({ id: 'd', title: null, scheduledAt: null }),
    ];
    const nomes = nomesDosItens(lista);
    expect(nomes.get('b')).toBe('Vídeo “Bastidores”, dia 12/09');
    expect(nomes.get('a')).toBe('Vídeo sem título, sem data (1 de 3)');
    expect(nomes.get('c')).toBe('Vídeo sem título, sem data (2 de 3)');
    expect(nomes.get('d')).toBe('Vídeo sem título, sem data (3 de 3)');
    // Todo nome é único: é o que o leitor de tela precisa para escolher.
    expect(new Set(nomes.values()).size).toBe(lista.length);
  });
});
