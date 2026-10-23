/**
 * "SOLICITAR APROVAÇÃO" NO CARD — as contas da tela. F42, Fase 4.
 */
import { describe, expect, it } from 'vitest';

import {
  anexosDoCard,
  chaveDoAnexo,
  dataEHora,
  entradasDasChaves,
  fraseDaDecisao,
  linksDoCard,
  moverNaOrdem,
  situacaoDoCard,
} from '@/board/aprovacao-do-card';
import type { AprovacaoDoCard } from '@/server/aprovacao-envio';

const base: AprovacaoDoCard = {
  taskId: 't',
  listId: 'l',
  clientId: 'c',
  clientName: 'Cliente',
  enabled: true,
  configured: true,
  missing: [],
  awaitingStatusName: 'aguardando cliente',
  canConfigure: false,
  canCopyLink: false,
  rounds: [],
};

describe('linksDoCard', () => {
  it('anexos primeiro, depois descrição, depois comentários; sem repetir e só Dropbox', () => {
    const r = linksDoCard({
      links: [
        { id: '1', label: 'Arte', url: 'https://www.dropbox.com/scl/fi/a/arte.png', sortOrder: 0, createdBy: null, createdAt: '' },
        { id: '2', label: 'Doc', url: 'https://docs.google.com/document/d/x', sortOrder: 1, createdBy: null, createdAt: '' },
      ],
      description: 'Vídeo: https://www.dropbox.com/scl/fi/v/video.mp4 e de novo https://www.dropbox.com/scl/fi/a/arte.png',
      comments: [
        {
          id: 'c',
          parentId: null,
          body: 'pasta www.dropbox.com/scl/fo/p/k',
          author: { id: 'u', name: 'Helena' },
          createdAt: '',
          editedAt: null,
          replyCount: 0,
          mine: false,
          replies: [],
        },
      ],
    });
    expect(r).toEqual([
      { url: 'https://www.dropbox.com/scl/fi/a/arte.png', origem: 'anexo "Arte"' },
      { url: 'https://www.dropbox.com/scl/fi/v/video.mp4', origem: 'descrição' },
      { url: 'https://www.dropbox.com/scl/fo/p/k', origem: 'comentário de Helena' },
    ]);
  });
});

describe('moverNaOrdem', () => {
  it('sobe e desce; fora dos limites não muda', () => {
    expect(moverNaOrdem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(moverNaOrdem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moverNaOrdem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moverNaOrdem(['a', 'b'], 1, 2)).toEqual(['a', 'b']);
  });
});

describe('situacaoDoCard', () => {
  it('sem cliente ou desligado: oculto; sem destinos: diz o que falta; senão pronto', () => {
    expect(situacaoDoCard({ ...base, clientId: null }).tipo).toBe('oculto');
    expect(situacaoDoCard({ ...base, enabled: false }).tipo).toBe('oculto');
    const falta = situacaoDoCard({ ...base, configured: false, missing: ['aprovado', 'reprovado'] });
    expect(falta).toEqual({
      tipo: 'sem-destinos',
      // F43, Fase 6: "etapas" no lugar de "esteira" — o vocabulário da ficha.
      frase: 'As etapas deste card ainda não dizem para onde ele vai na aprovação do cliente. Falta escolher: "aprovado", "reprovado".',
    });
    expect(situacaoDoCard(base).tipo).toBe('pronto');
  });
});

describe('dataEHora', () => {
  it('no fuso da agência', () => {
    expect(dataEHora('2026-10-07T19:20:00Z')).toBe('07/10 16:20');
  });
});

describe('F42.7 — fraseDaDecisao e o comentário do cliente nas sugestões', () => {
  it('aprovada/reprovada pelo link dizem quem e quando; aberta e substituída não dizem nada', () => {
    expect(fraseDaDecisao({ state: 'approved', decidedAt: '2026-10-07T19:20:00Z', decidedVia: 'client_link' })).toBe(
      'aprovada em 07/10 16:20 · pelo cliente, pelo link',
    );
    expect(fraseDaDecisao({ state: 'rejected', decidedAt: '2026-10-07T19:20:00Z', decidedVia: null })).toBe(
      'ajustes pedidos em 07/10 16:20',
    );
    expect(fraseDaDecisao({ state: 'open', decidedAt: null, decidedVia: null })).toBeNull();
    expect(fraseDaDecisao({ state: 'superseded', decidedAt: null, decidedVia: null })).toBeNull();
  });

  it('link do Dropbox num comentário do cliente vem como "comentário do cliente", não "comentário"', () => {
    const r = linksDoCard({
      links: [],
      description: null,
      comments: [
        {
          id: 'c',
          parentId: null,
          body: 'usem este: https://www.dropbox.com/scl/fi/z/nova.jpg',
          author: null,
          fromClient: true,
          createdAt: '',
          editedAt: null,
          replyCount: 0,
          mine: false,
          replies: [],
        },
      ],
    });
    expect(r).toEqual([{ url: 'https://www.dropbox.com/scl/fi/z/nova.jpg', origem: 'comentário do cliente' }]);
  });
});

describe('anexosDoCard (F42, Fase 9)', () => {
  const anexo = (id: string, fileName: string, contentType: string, expiresAt: string | null = null) => ({
    id,
    fileName,
    extension: fileName.split('.').pop() ?? null,
    contentType,
    byteSize: 1000,
    uploadedBy: null,
    createdAt: '',
    expiresAt,
  });
  const comentario = (body: string) => ({
    id: 'c',
    parentId: null,
    body,
    author: { id: 'u', name: 'Helena' },
    createdAt: '',
    editedAt: null,
    replyCount: 0,
    mine: false,
    replies: [],
  });

  it('só imagem permanente; a origem é o comentário que a cita, a descrição, ou o card', () => {
    const r = anexosDoCard({
      attachments: [
        anexo('a1', 'capa.png', 'image/png'),
        anexo('a2', 'roteiro.pdf', 'application/pdf'),
        anexo('a3', 'print.png', 'image/png', '2026-10-17T00:00:00Z'),
        anexo('a4', 'miolo.JPG', 'image/jpeg'),
        anexo('a5', 'fim.webp', 'image/webp'),
      ],
      description: 'Referência ![x](attachment:a5)',
      comments: [comentario('Segue a arte ![Imagem anexada](attachment:a4)')] as never,
    });
    expect(r).toEqual([
      { id: 'a1', nome: 'capa.png', origem: 'anexo do card' },
      { id: 'a4', nome: 'miolo.JPG', origem: 'comentário de Helena' },
      { id: 'a5', nome: 'fim.webp', origem: 'descrição' },
    ]);
  });

  it('chaves da janela viram a entrada do envio', () => {
    expect(entradasDasChaves([chaveDoAnexo('x1'), 'https://www.dropbox.com/scl/fi/a/b.mp4'])).toEqual([
      { anexo: 'x1' },
      { link: 'https://www.dropbox.com/scl/fi/a/b.mp4' },
    ]);
  });
});
