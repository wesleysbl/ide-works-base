import { describe, expect, it } from 'vitest';

import {
  horaDaMensagem,
  montarPainel,
  statusVisualDaMensagem,
  textoNaJanelinha,
} from '@/chat/mensagens';

describe('statusVisualDaMensagem (WhatsApp checks)', () => {
  it('retorna pendente se o estado for pendente', () => {
    const s = statusVisualDaMensagem(
      { estado: 'pendente', createdAt: '2026-10-01T20:00:00.000Z' },
      '2026-10-01T20:05:00.000Z',
    );
    expect(s).toBe('pendente');
  });

  it('retorna falha se o estado for falha', () => {
    const s = statusVisualDaMensagem(
      { estado: 'falha', createdAt: '2026-10-01T20:00:00.000Z' },
      null,
    );
    expect(s).toBe('falha');
  });

  it('retorna entregue se confirmada e sem leitura do peer', () => {
    const s = statusVisualDaMensagem(
      { estado: 'confirmada', createdAt: '2026-10-01T20:00:00.000Z' },
      null,
    );
    expect(s).toBe('entregue');
  });

  it('retorna entregue se confirmada e leitura do peer for anterior à mensagem', () => {
    const s = statusVisualDaMensagem(
      { estado: 'confirmada', createdAt: '2026-10-01T20:00:00.000Z' },
      '2026-10-01T19:50:00.000Z',
    );
    expect(s).toBe('entregue');
  });

  it('retorna lida (duplo check azul) se leitura do peer for posterior ou igual à mensagem', () => {
    const s = statusVisualDaMensagem(
      { estado: 'confirmada', createdAt: '2026-10-01T20:00:00.000Z' },
      '2026-10-01T20:00:00.000Z',
    );
    expect(s).toBe('lida');

    const sPosterior = statusVisualDaMensagem(
      { estado: 'confirmada', createdAt: '2026-10-01T20:00:00.000Z' },
      '2026-10-01T20:05:00.000Z',
    );
    expect(sPosterior).toBe('lida');
  });
});

describe('montarPainel e rotuloDoDia', () => {
  it('agrupa mensagens por dia e autor', () => {
    const msgs = [
      {
        id: '1',
        authorId: 'u1',
        body: 'Primeira',
        kind: 'person' as const,
        createdAt: '2026-10-01T10:00:00.000Z',
        editedAt: null,
        deletedAt: null,
        clientKey: null,
      },
      {
        id: '2',
        authorId: 'u1',
        body: 'Segunda seguida',
        kind: 'person' as const,
        createdAt: '2026-10-01T10:01:00.000Z',
        editedAt: null,
        deletedAt: null,
        clientKey: null,
      },
    ];

    const painel = montarPainel(msgs);
    expect(painel.length).toBe(3); // 1 separador de dia + 2 falas
    expect(painel[0].tipo).toBe('dia');
    expect(painel[1].tipo).toBe('fala');
    if (painel[1].tipo === 'fala') {
      expect(painel[1].primeiraDoAutor).toBe(true);
    }
    if (painel[2].tipo === 'fala') {
      expect(painel[2].primeiraDoAutor).toBe(false);
    }
  });

  it('formata hora da mensagem corretamente', () => {
    const hora = horaDaMensagem('2026-10-01T15:30:00.000Z');
    expect(hora).toBeTruthy();
  });
});

describe('textoNaJanelinha (a bolha da janelinha, que não desenha markdown)', () => {
  const IMG = '![Imagem anexada](attachment:11111111-1111-4111-8111-111111111111)';
  const IMG2 = '![Imagem anexada](attachment:22222222-2222-4222-8222-222222222222)';

  it('texto comum passa como veio', () => {
    expect(textoNaJanelinha({ body: 'bom dia', deletedAt: null })).toBe('bom dia');
  });

  it('a mensagem apagada diz que foi apagada — o corpo dela é vazio', () => {
    expect(textoNaJanelinha({ body: '', deletedAt: '2026-10-08T12:00:00.000Z' })).toBe('Mensagem apagada');
  });

  it('apagada vale mesmo que o corpo ainda esteja no estado local', () => {
    expect(textoNaJanelinha({ body: 'segredo', deletedAt: '2026-10-08T12:00:00.000Z' })).toBe('Mensagem apagada');
  });

  it('só imagem vira "Imagem", e não o markdown cru', () => {
    expect(textoNaJanelinha({ body: IMG, deletedAt: null })).toBe('Imagem');
    expect(textoNaJanelinha({ body: `${IMG}\n\n${IMG2}`, deletedAt: null })).toBe('2 imagens');
  });

  it('texto com imagem mostra o texto e diz que há imagem', () => {
    expect(textoNaJanelinha({ body: `veja isto\n\n${IMG}`, deletedAt: null })).toBe('veja isto\n[Imagem]');
  });
});
