/**
 * O CONTORNO DO SELO DO PLANO — F43, 08/10.
 *
 * A Fase 5 tirou o contorno de todo selo e, junto, o campo "Borda" do
 * Catálogo. O selo do SISTEMA perder o contorno era o objetivo (ruído); o do
 * PLANO não: a cor dele é escolha da agência, e o Wesley pediu no mesmo dia
 * "não esconder nenhum botão ou função sem querer". Este teste segura as duas
 * metades: o selo comum continua sem contorno, o do plano volta a ter.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { Selo } from '@/ui/primitivos';

const desenhar = (props: Parameters<typeof Selo>[0]) => renderToStaticMarkup(createElement(Selo, props));

describe('selo do plano', () => {
  it('o selo comum não ganha contorno', () => {
    const html = desenhar({ tom: 'warn', children: 'atenção' });
    expect(html).not.toContain('box-shadow');
  });

  it('a cor de borda do plano vira um contorno de 1px, sem mudar o tamanho', () => {
    const html = desenhar({
      estilo: { background: '#eef2ee', color: '#3b5a41', borderColor: '#cfdcd1' },
      children: 'Conteúdo',
    });
    expect(html).toContain('background:#eef2ee');
    expect(html).toContain('color:#3b5a41');
    expect(html).toContain('box-shadow:inset 0 0 0 1px #cfdcd1');
  });

  it('plano sem cor de borda não ganha contorno', () => {
    const html = desenhar({ estilo: { background: '#eef2ee', color: '#3b5a41' }, children: 'Conteúdo' });
    expect(html).not.toContain('box-shadow');
  });

  it('o Catálogo continua oferecendo o campo "Borda" do plano', () => {
    const fonte = readFileSync('src/pages/Catalogos.tsx', 'utf8');
    expect(fonte).toContain('rotulo="Borda"');
    expect(fonte).toContain('colorBorder: v');
  });
});
