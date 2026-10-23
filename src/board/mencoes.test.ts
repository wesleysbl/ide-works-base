import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mencao, partesDeMencoes, textoDasMencoes, filtrarMencionaveis } from '@/board/mencoes';
import { markdownParaNos, nosParaMarkdown } from '@/board/editor-rico';
import { parseInline } from '@/board/markdown';
import { Markdown } from '@/ui/Markdown';
import { agruparAvisos, fraseDoAviso, type Aviso } from '@/board/avisos';
const pessoa = { id: '00000000-0000-0000-0000-000000000002', name: 'Hélia Assis' };
describe('menções persistentes', () => {
  it('preserva pessoa e posição ao salvar e reabrir o editor', () => {
    const texto = `Antes ${mencao(pessoa)} depois.`;
    expect(nosParaMarkdown(markdownParaNos(texto))).toBe(texto);
    expect(textoDasMencoes(texto)).toBe('Antes @Hélia Assis depois.');
    expect(partesDeMencoes(texto)).toEqual(['Antes ', pessoa, ' depois.']);
  });
  it('desenha destaque sem link nem HTML recebido do nome', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { fonte: mencao({ ...pessoa, name: '<img src=x onerror=alert(1)>' }) }));
    expect(html).toContain('class="mencao"'); expect(html).toContain('&lt;img');
    expect(html).not.toContain('<a '); expect(html).not.toContain('<img ');
  });
  it('email e @ sem seleção continuam texto comum', () => {
    expect(parseInline('contato@example.test @Helena')).toEqual([{ kind: 'text', text: 'contato@example.test @Helena' }]);
  });
  it('o nome pode ser encontrado sem acento, por nome ou sobrenome', () => {
    expect(filtrarMencionaveis([pessoa], 'heli')).toEqual([pessoa]);
    expect(filtrarMencionaveis([pessoa], 'Assis')).toEqual([pessoa]);
    expect(filtrarMencionaveis([pessoa], 'fora')).toEqual([]);
  });
  it('a caixa identifica quem mencionou e agrupa as menções', () => {
    const a = { tipo: 'mencao', actorName: 'Wesley' } as Aviso;
    expect(fraseDoAviso(a, { year: 2026, month: 9, day: 11 })).toBe('Wesley mencionou você neste card.');
    expect(agruparAvisos([a]).map((g) => g.tipo)).toEqual(['mencao']);
  });
});
