/**
 * O MATERIAL DE UMA CHAMADA, SÓ PELO LINK — F42, Fase 4. Puro, sem rede.
 */
import { describe, expect, it } from 'vitest';

import {
  FRASE_ITENS_DEMAIS,
  FRASE_SEM_ITENS,
  anexoServeDeArte,
  caminhoDaCopia,
  conferirLinks,
  conferirMateriais,
  lerMaterial,
  linksDoDropboxNoTexto,
  nomeSeguro,
  normalizarLinkDoDropbox,
} from '@/server/material-de-aprovacao';

describe('lerMaterial', () => {
  it('arquivo `scl/fi`: nome do caminho, tipo pela extensão, exibição com raw=1 sem dl', () => {
    const m = lerMaterial('https://www.dropbox.com/scl/fi/abc123/Reels%20final.MP4?rlkey=xyz&dl=0');
    expect(m).toEqual({
      url: 'https://www.dropbox.com/scl/fi/abc123/Reels%20final.MP4?rlkey=xyz&dl=0',
      forma: 'arquivo',
      nome: 'Reels final.MP4',
      tipo: 'video',
      exibicao: 'https://www.dropbox.com/scl/fi/abc123/Reels%20final.MP4?rlkey=xyz&raw=1',
    });
  });

  it('link antigo `/s/` de imagem; `www.` sem esquema ganha https', () => {
    const m = lerMaterial('www.dropbox.com/s/k3y/arte.jpeg?dl=0');
    expect(m).toMatchObject({ url: 'https://www.dropbox.com/s/k3y/arte.jpeg?dl=0', forma: 'arquivo', tipo: 'image', nome: 'arte.jpeg' });
  });

  it('pasta: "outro", nome genérico, sem endereço de exibição', () => {
    expect(lerMaterial('https://www.dropbox.com/scl/fo/p4st4/AAchave?rlkey=r&dl=0')).toMatchObject({
      forma: 'pasta',
      tipo: 'other',
      nome: 'Pasta do Dropbox',
      exibicao: null,
    });
  });

  it('arquivo sem extensão conhecida é "outro"; sem nome no caminho, nome genérico', () => {
    expect(lerMaterial('https://www.dropbox.com/scl/fi/abc/roteiro.pdf?rlkey=x')?.tipo).toBe('other');
    expect(lerMaterial('https://www.dropbox.com/scl/fi/abc?rlkey=x')?.nome).toBe('Arquivo do Dropbox');
  });

  it.each([
    'https://drive.google.com/file/d/x/view',
    'http://www.dropbox.com/scl/fi/abc/a.jpg',
    'https://dropbox.com.golpe.example/scl/fi/abc/a.jpg',
    'https://www.dropbox.com/home/Clientes',
    'javascript:alert(1)',
    '',
  ])('não é link de compartilhamento do Dropbox: %s', (link) => {
    expect(lerMaterial(link)).toBeNull();
  });
});

describe('conferirLinks', () => {
  it('mantém a ordem e monta os itens do banco sem identificador nem versão', () => {
    const r = conferirLinks([
      'https://www.dropbox.com/scl/fi/b/2.png',
      'https://www.dropbox.com/scl/fi/a/1.jpg',
    ]);
    expect(r).toMatchObject({
      ok: true,
      itens: [
        { dropbox_url: 'https://www.dropbox.com/scl/fi/b/2.png', kind: 'image', file_name: '2.png' },
        { dropbox_url: 'https://www.dropbox.com/scl/fi/a/1.jpg', kind: 'image', file_name: '1.jpg' },
      ],
    });
    if (r.ok) expect(Object.keys(r.itens[0]).sort()).toEqual(['dropbox_url', 'file_name', 'kind']);
  });

  it('recusa vazio, mais de 20, link de fora (dizendo qual) e repetido', () => {
    expect(conferirLinks([])).toEqual({ ok: false, frase: FRASE_SEM_ITENS });
    expect(conferirLinks(Array.from({ length: 21 }, (_, i) => `https://www.dropbox.com/scl/fi/${i}/a.jpg`))).toEqual({
      ok: false,
      frase: FRASE_ITENS_DEMAIS,
    });
    const fora = conferirLinks(['https://www.dropbox.com/scl/fi/a/1.jpg', 'https://exemplo.com/x.jpg']);
    expect(fora.ok).toBe(false);
    if (!fora.ok) expect(fora.frase).toMatch(/^O 2º link não é .*exemplo\.com/);
    const rep = conferirLinks(['https://www.dropbox.com/scl/fi/a/1.jpg', 'www.dropbox.com/scl/fi/a/1.jpg']);
    expect(rep).toEqual({ ok: false, frase: 'O mesmo link aparece no 1º e no 2º material. Tire a repetição.' });
  });
});

describe('linksDoDropboxNoTexto', () => {
  it('acha link solto, sem esquema e dentro de markdown, sem a pontuação do fim, sem repetir', () => {
    const texto = [
      'Arte final: https://www.dropbox.com/scl/fi/a1/arte.png?rlkey=x&dl=0.',
      'Vídeo [aqui](https://www.dropbox.com/scl/fi/v1/video.mp4?rlkey=y&dl=0)',
      'pasta www.dropbox.com/scl/fo/p1/AAk?rlkey=z, e o mesmo https://www.dropbox.com/scl/fi/a1/arte.png?rlkey=x&dl=0',
      'outro https://drive.google.com/x',
    ].join('\n');
    expect(linksDoDropboxNoTexto(texto)).toEqual([
      'https://www.dropbox.com/scl/fi/a1/arte.png?rlkey=x&dl=0',
      'https://www.dropbox.com/scl/fi/v1/video.mp4?rlkey=y&dl=0',
      'https://www.dropbox.com/scl/fo/p1/AAk?rlkey=z',
    ]);
    expect(linksDoDropboxNoTexto(null)).toEqual([]);
  });

  it('normalizarLinkDoDropbox recusa o que não é arquivo nem pasta', () => {
    expect(normalizarLinkDoDropbox('https://www.dropbox.com/home')).toBeNull();
    expect(normalizarLinkDoDropbox('dropbox.com/s/a/b.jpg')).toBe('https://dropbox.com/s/a/b.jpg');
  });

  it('normalizarLinkDoDropbox recusa formas que o banco recusaria', () => {
    for (const ruim of [
      'https://u:p@www.dropbox.com/scl/fi/abc/x.mp4?rlkey=k',
      'https://www.dropbox.com:443/scl/fi/abc/x.mp4?rlkey=k',
      'https:\\\\www.dropbox.com\\scl\\fi\\abc\\x.mp4',
      'https:www.dropbox.com/scl/fi/abc/x.mp4',
    ]) {
      expect(normalizarLinkDoDropbox(ruim), ruim).toBeNull();
    }
    const bom = 'https://www.dropbox.com/scl/fi/abc/x.mp4?rlkey=k';
    expect(normalizarLinkDoDropbox(bom)).toBe(bom);
  });
});

describe('artes anexadas (F42, Fase 9)', () => {
  const ID = '00000000-0000-0000-0000-0000000a0001';

  it('conferirMateriais: mistura anexo e link na ordem; recusa anexo repetido e id torto', () => {
    const r = conferirMateriais([{ anexo: ID.toUpperCase() }, { link: 'www.dropbox.com/scl/fi/v/reels.mp4' }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pedidos[0]).toEqual({ tipo: 'anexo', anexoId: ID });
      expect(r.pedidos[1]).toMatchObject({ tipo: 'link', item: { dropbox_url: 'https://www.dropbox.com/scl/fi/v/reels.mp4', kind: 'video' } });
    }
    expect(conferirMateriais([{ anexo: ID }, { anexo: ID }])).toEqual({ ok: false, frase: expect.stringContaining('mesmo anexo') });
    expect(conferirMateriais([{ anexo: 'x' }])).toEqual({ ok: false, frase: expect.stringContaining('não é um anexo deste card') });
    expect(conferirMateriais([])).toEqual({ ok: false, frase: FRASE_SEM_ITENS });
  });

  it('anexoServeDeArte: imagem pelo tipo e pela extensão, e permanente', () => {
    expect(anexoServeDeArte({ contentType: 'image/png', fileName: 'a.png' })).toBe(true);
    expect(anexoServeDeArte({ contentType: 'image/jpeg', fileName: 'a.JPEG' })).toBe(true);
    expect(anexoServeDeArte({ contentType: 'image/svg+xml', fileName: 'a.svg' })).toBe(false);
    expect(anexoServeDeArte({ contentType: 'image/png', fileName: 'a.pdf' })).toBe(false);
    expect(anexoServeDeArte({ contentType: 'image/png', fileName: 'a.png', expiresAt: '2026-10-17' })).toBe(false);
  });

  it('nomeSeguro e caminhoDaCopia: sem acento, espaço, barra ou ..; extensão preservada', () => {
    expect(nomeSeguro('Capa Promoção Março.PNG')).toBe('capa-promocao-marco.png');
    expect(nomeSeguro('../../segredo/x.png')).toBe('segredo-x.png');
    expect(nomeSeguro('🎉.jpg')).toBe('arte.jpg');
    expect(nomeSeguro(`${'a'.repeat(200)}.webp`)).toBe(`${'a'.repeat(70)}.webp`);
    expect(caminhoDaCopia('r1', 3, 'Arte 1.png')).toBe('aprovacoes/r1/3-arte-1.png');
  });
});
