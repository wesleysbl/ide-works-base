/**
 * A conta no pé da barra — F29.
 *
 * O chip nasce FECHADO, e esta suíte desenha no servidor (`renderToStaticMarkup`,
 * nenhum clique): o menu é desenhado direto, aberto, por `MenuDaConta`. O que
 * só o navegador prova — abrir por clique e por teclado, `Esc` devolvendo o
 * foco, `Sair` chamando o servidor — está na verificação da fase.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Area } from '@/auth/areas';
import {
  dominioDoPonto,
  enderecoDoPonto,
  quemEsta,
  rotuloDaConta,
  temaDeDestino,
} from '@/board/conta';
import { MenuDaConta, RostoDaConta } from '@/board/ContaNoPe';
import { INSTALACAO } from '@/config/instalacao';
import { type Sessao } from '@/ui/sessao';
import { type Tema } from '@/ui/tema';

// Os testes do menu desenham o item do ponto ligado; o que o desliga diz isso.
const PONTO_ORIGINAL = INSTALACAO.enderecoDoPonto;
beforeEach(() => {
  INSTALACAO.enderecoDoPonto = 'https://ponto.exemplo.com.br';
});
afterEach(() => {
  INSTALACAO.enderecoDoPonto = PONTO_ORIGINAL;
});

const sessao = (p: Partial<Sessao> = {}): Sessao => ({
  userId: 'u-ana',
  email: 'ana@exemplo.com.br',
  nome: null,
  isSuperadmin: false,
  isSuper: false,
  papel: 'funcionario',
  areas: [],
  ...p,
});

const desenharMenu = (s: Sessao | null, temaAtual: Tema = 'escuro'): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MenuDaConta, {
        sessao: s,
        ancora: null,
        temaAtual,
        saindo: false,
        aoFechar: () => {},
        aoPersonalizar: () => {},
        aoMudarTema: () => {},
        aoSair: () => {},
      }),
    ),
  );

const temLink = (html: string, destino: string) =>
  new RegExp(`<a[^>]*href="${destino}"`).test(html);

describe('o menu da conta', () => {
  it('traz os itens na ordem: Personalizar · Tema · Agentes de IA · Pessoas · Catálogos · Meta · Ponto · Sair', () => {
    const html = desenharMenu(sessao({ isSuperadmin: true }));
    const posicoes = [
      'Personalizar a barra lateral',
      'Mudar para o tema',
      'Agentes de IA',
      '>Pessoas<',
      '>Catálogos<',
      '>Meta<',
      'Já bateu seu ponto hoje?',
      '>Sair<',
    ].map((t) => html.indexOf(t));
    for (const p of posicoes) expect(p).toBeGreaterThan(-1);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('é um menu de verdade: `role="menu"`, e cada item é `menuitem` que as setas alcançam', () => {
    const html = desenharMenu(sessao({ isSuperadmin: true }));
    expect(html).toContain('role="menu"');
    // Oito itens (o do ponto entrou na F30), todos com o `data-item` que o
    // `Balao` percorre com as setas.
    expect(html.match(/role="menuitem"/g)).toHaveLength(8);
    expect(html.match(/data-item="1"/g)).toHaveLength(8);
    // Nenhum é "marcável": `Sair` não pode ser anunciado como "não marcado".
    expect(html).not.toContain('menuitemcheckbox');
  });

  it('sem nenhuma área, Pessoas, Catálogos e Meta NÃO aparecem — e o resto sim', () => {
    const html = desenharMenu(sessao({ areas: [] }));
    for (const destino of ['/pessoas', '/catalogos', '/meta']) {
      expect(temLink(html, destino), destino).toBe(false);
    }
    expect(temLink(html, '/conexoes')).toBe(true);
    expect(html).toContain('Personalizar a barra lateral');
    expect(html).toContain('>Sair<');
  });

  it.each<[Area, string]>([
    ['pessoas', '/pessoas'],
    ['catalogos', '/catalogos'],
    ['meta', '/meta'],
  ])('com só a área `%s`, só %s aparece', (area, destino) => {
    const html = desenharMenu(sessao({ areas: [area] }));
    for (const outro of ['/pessoas', '/catalogos', '/meta']) {
      expect(temLink(html, outro), outro).toBe(outro === destino);
    }
  });

  it('superadmin vê as três, como `podeVer` manda', () => {
    const html = desenharMenu(sessao({ isSuperadmin: true, areas: [] }));
    for (const destino of ['/pessoas', '/catalogos', '/meta']) expect(temLink(html, destino)).toBe(true);
  });

  it('enquanto a sessão carrega (nula), mostra tudo — esconder e revelar faria o menu piscar', () => {
    const html = desenharMenu(null);
    for (const destino of ['/pessoas', '/catalogos', '/meta', '/conexoes']) {
      expect(temLink(html, destino)).toBe(true);
    }
  });

  it('sem as três telas de área, o separador delas também some — nada de dois fios seguidos', () => {
    const html = desenharMenu(sessao({ areas: [] }));
    expect(html.match(/class="cu-sep"/g)).toHaveLength(1);
    expect(desenharMenu(sessao({ isSuperadmin: true })).match(/class="cu-sep"/g)).toHaveLength(2);
  });

  it('sem endereço de ponto configurado, o item do ponto não aparece', () => {
    INSTALACAO.enderecoDoPonto = null;
    expect(enderecoDoPonto()).toBeNull();
    const html = desenharMenu(sessao());
    expect(html).not.toContain('Já bateu seu ponto hoje?');
    expect(html).not.toContain('target="_blank"');
  });

  it('sem nenhuma área, o ponto continua — é de todo mundo, e fica antes do fio do Sair', () => {
    INSTALACAO.enderecoDoPonto = 'https://ponto.exemplo.com.br';
    const html = desenharMenu(sessao({ areas: [] }));
    const ponto = html.indexOf('Já bateu seu ponto hoje?');
    expect(ponto).toBeGreaterThan(html.indexOf('Agentes de IA'));
    expect(ponto).toBeLessThan(html.indexOf('class="cu-sep"'));
  });

  it('o ponto leva ao sistema de ponto em aba nova, sem `opener` nem `referrer` — F30', () => {
    INSTALACAO.enderecoDoPonto = 'https://ponto.exemplo.com.br';
    expect(enderecoDoPonto()).toBe('https://ponto.exemplo.com.br');
    expect(dominioDoPonto('https://ponto.exemplo.com.br')).toBe('ponto.exemplo.com.br');

    const html = desenharMenu(sessao());
    const item = html.match(/<a[^>]*href="https:\/\/ponto\.exemplo\.com\.br"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(item, 'o link do ponto').toBeDefined();
    const abre = item!.match(/<a[^>]*>/)![0];
    expect(abre).toContain('target="_blank"');
    expect(abre).toContain('rel="noopener noreferrer"');
    expect(abre).toContain('role="menuitem"');
    expect(abre).toContain('data-item="1"');
    expect(abre).toContain('aria-label="Já bateu seu ponto hoje? Abre ponto.exemplo.com.br em outra aba"');
    // A pergunta e o domínio, à vista.
    expect(item).toContain('Já bateu seu ponto hoje?');
    expect(item).toContain('<span class="bl-conta-ponto-dominio">ponto.exemplo.com.br</span>');
    // Um só link para fora: nenhum outro item abre aba nova.
    expect(html.match(/target="_blank"/g)).toHaveLength(1);
  });

  it('o item de tema diz o tema de DESTINO, e não o de agora', () => {
    expect(desenharMenu(sessao(), 'escuro')).toContain('Mudar para o tema claro');
    expect(desenharMenu(sessao(), 'claro')).toContain('Mudar para o tema escuro');
    expect(temaDeDestino('escuro')).toBe('claro');
    expect(temaDeDestino('claro')).toBe('escuro');
  });
});

describe('quem está no chip', () => {
  it('sem nome no perfil, o nome é o e-mail, e o papel é o rótulo de `Pessoas`', () => {
    expect(quemEsta(sessao({ papel: 'super_admin' }))).toEqual({
      nome: 'ana@exemplo.com.br',
      papel: 'Super admin',
    });
    expect(quemEsta(sessao({ papel: 'admin' })).papel).toBe('Administrador');
    expect(quemEsta(sessao({ papel: 'funcionario' })).papel).toBe('Funcionário');
  });

  it('papel desconhecido é calado, e não inventado', () => {
    expect(quemEsta(sessao({ papel: null })).papel).toBeNull();
  });

  it('sem sessão ainda, um texto neutro', () => {
    expect(quemEsta(null)).toEqual({ nome: 'Sua conta', papel: null });
  });

  it('com nome no perfil, o nome é o nome — F29', () => {
    expect(quemEsta(sessao({ nome: 'Ana Beatriz Souza', papel: 'admin' }))).toEqual({
      nome: 'Ana Beatriz Souza',
      papel: 'Administrador',
    });
  });
});

/* ─────────────── o chip desenhado, com e sem nome — F29 ─────────────── */

const desenharRosto = (s: Sessao | null, soIcones = false, carregando = false): string =>
  renderToStaticMarkup(createElement(RostoDaConta, { sessao: s, carregando, soIcones }));

/** O texto de dentro do avatar (`cu-avatar`), isto é, as iniciais. */
const iniciais = (html: string) => html.match(/class="cu-avatar"[^>]*>([^<]*)</)?.[1];

describe('o chip mostra o nome, e sem nome o e-mail', () => {
  it('com nome: o nome no chip, e as iniciais vêm do nome', () => {
    const html = desenharRosto(sessao({ nome: 'Ana Beatriz Souza', papel: 'admin' }));
    expect(html).toContain('<span class="bl-conta-nome">Ana Beatriz Souza</span>');
    expect(html).toContain('<span class="bl-conta-papel">Administrador</span>');
    expect(html).not.toContain('ana@exemplo.com.br');
    expect(iniciais(html)).toBe('AS');
  });

  it('sem nome: o e-mail no chip, e as iniciais vêm do e-mail, como hoje', () => {
    const html = desenharRosto(sessao({ nome: null }));
    expect(html).toContain('<span class="bl-conta-nome">ana@exemplo.com.br</span>');
    expect(iniciais(html)).toBe('AN');
  });

  it('em `Somente ícones`, só o rosto — e ele continua vindo do nome', () => {
    const html = desenharRosto(sessao({ nome: 'Ana Beatriz Souza' }), true);
    expect(html).not.toContain('bl-conta-nome');
    expect(iniciais(html)).toBe('AS');
  });

  it('enquanto carrega, um círculo sem letra e o texto neutro', () => {
    const html = desenharRosto(null, false, true);
    expect(iniciais(html)).toBe('');
    expect(html).toContain('<span class="bl-conta-nome">Sua conta</span>');
  });
});

describe('o nome acessível do chip continua com e-mail e papel', () => {
  it('com nome: nome, e-mail e papel', () => {
    expect(rotuloDaConta(sessao({ nome: 'Ana Beatriz Souza', papel: 'admin' }), false)).toBe(
      'Sua conta e configurações — Ana Beatriz Souza (ana@exemplo.com.br), Administrador',
    );
  });

  it('sem nome: o e-mail uma vez só, e o papel', () => {
    expect(rotuloDaConta(sessao({ nome: null, papel: 'funcionario' }), false)).toBe(
      'Sua conta e configurações — ana@exemplo.com.br, Funcionário',
    );
  });

  it('papel desconhecido calado; carregando, o rótulo neutro', () => {
    expect(rotuloDaConta(sessao({ papel: null }), false)).toBe(
      'Sua conta e configurações — ana@exemplo.com.br',
    );
    expect(rotuloDaConta(sessao(), true)).toBe('Sua conta e configurações');
    expect(rotuloDaConta(null, false)).toBe('Sua conta e configurações');
  });
});

/* ─────────────── o que saiu do Painel, e o `Sair` que ficou um só ─────────────── */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');

describe('o cabeçalho do Painel fica só com o que é da página', () => {
  const painel = ler('pages', 'Painel.tsx');

  it('não tem mais Catálogos, Pessoas, Meta nem Sair', () => {
    for (const destino of ['/catalogos', '/pessoas', '/meta']) {
      expect(painel, destino).not.toContain(`to="${destino}"`);
    }
    expect(painel).not.toContain('title="Sair"');
    expect(painel).not.toContain('api.sair');
    expect(painel).not.toContain('limparAoSair');
  });

  it('Novo cliente e o seletor de período continuam', () => {
    expect(painel).toContain('Novo cliente');
    expect(painel).toContain('<SeletorDePeriodo');
  });
});

describe('um `Sair` só', () => {
  /** Todo `.ts`/`.tsx` de `src`, menos os testes. */
  const fontes = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const caminho = join(dir, e.name);
      if (e.isDirectory()) return fontes(caminho);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [caminho] : [];
    });

  it('`api.sair()` é chamado num lugar só — `sairDaConta`, em `ui/sessao.ts`', () => {
    const chamam = fontes(RAIZ)
      .filter((f) => /\bapi\.sair\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(RAIZ.length + 1));
    expect(chamam).toEqual(['ui/sessao.ts']);
  });
});
