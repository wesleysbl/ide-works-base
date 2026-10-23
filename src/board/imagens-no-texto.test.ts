import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { imagemNoTexto, imagensDoTexto, juntarTextoEImagens, textoSemImagens } from '@/board/imagens-no-texto';
import { parseInline } from '@/board/markdown';
import { markdownParaNos, nosParaMarkdown } from '@/board/editor-rico';
import { ImagemNoTexto } from '@/board/ImagemNoTexto';
import { MiniaturasDeMentira } from '@/board/MiniaturaDoCartao';

const id = '12345678-1234-1234-1234-123456789abc';
const marker = imagemNoTexto(id);

describe('imagens junto do texto', () => {
  it('o comentário pode conter texto, imagem ou apenas imagem', () => {
    const body = juntarTextoEImagens('Ajustar esta parte', [id]);
    expect(textoSemImagens(body)).toBe('Ajustar esta parte');
    expect(imagensDoTexto(body)).toEqual([id]);
    expect(juntarTextoEImagens('', [id])).toBe(marker);
  });

  it('digitar com imagem mantém espaços e quebras de linha do rascunho', () => {
    for (const text of ['Ajustar ', 'Ajustar\n', 'Ajustar\n\n', '']) {
      expect(textoSemImagens(juntarTextoEImagens(text, [id]))).toBe(text);
      expect(textoSemImagens(text)).toBe(text);
    }
  });

  it('o editor salva identificadores e conserva a posição entre textos', () => {
    const md = `Antes ${marker} depois`;
    expect(nosParaMarkdown(markdownParaNos(md))).toBe(md);
    expect(parseInline(marker)).toEqual([{ kind: 'attachment', id, alt: 'Imagem anexada' }]);
  });

  it('não interpreta imagem dentro de código nem aceita URL executável como anexo', () => {
    expect(parseInline('`' + marker + '`')).toEqual([{ kind: 'code', text: marker }]);
    expect(() => imagemNoTexto('javascript:alert(1)')).toThrow();
    expect(imagensDoTexto('![x](attachment:javascript:alert(1))')).toEqual([]);
    expect(parseInline('[' + marker + '](https://example.invalid)')).toEqual([{
      kind: 'link', href: 'https://example.invalid', children: [{ kind: 'text', text: 'Imagem anexada' }],
    }]);
  });

  it('desenha img automaticamente com a URL privada, sem precisar baixar ou pedir prévia', () => {
    const html = renderToStaticMarkup(createElement(MiniaturasDeMentira,
      { assinaturas: { [id]: { url: 'https://storage.invalid/signed-image', expiresAt: '2099-01-01' } } },
      createElement(ImagemNoTexto, { id, alt: 'Correção de layout' })));
    expect(html).toContain('<img');
    expect(html).toContain('src="https://storage.invalid/signed-image"');
    expect(html).toContain('Ampliar imagem');
    expect(html).not.toContain('Baixar');
  });
});
