/**
 * A APROVAÇÃO EXTERNA NA FICHA DO CLIENTE — F42, Fase 3 — desenhada no servidor.
 *
 * `renderToStaticMarkup`: nenhum efeito roda, então cada estado entra por
 * `props`. O clique de verdade (ligar, gerar, confirmar, copiar) é o e2e
 * `aprovacao-configuracao`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { type EstadoDoPainel, PainelDaAprovacao } from '@/clients/AprovacaoExterna';

const nada = () => {};
const tela = (estado: EstadoDoPainel, extra: Partial<Parameters<typeof PainelDaAprovacao>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PainelDaAprovacao, {
      estado,
      aoLigar: nada,
      aoCopiar: nada,
      aoPedirNovo: nada,
      aoConfirmarNovo: nada,
      aoCancelarNovo: nada,
      aoTentarDeNovo: nada,
      ...extra,
    }),
  );

const pronto = (o: Partial<{ enabled: boolean; active: boolean; link: { createdAt: string } | null }> = {}): EstadoDoPainel => ({
  tipo: 'pronto',
  aprovacao: { clientId: 'c1', enabled: true, active: true, link: null, ...o },
});

const botoes = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('a ficha do cliente — aprovação externa', () => {
  it('desligada: a chave aparece desligada e não há botão de link', () => {
    const html = tela(pronto({ enabled: false }));
    expect(html).toContain('Aprovação externa');
    expect(html).toMatch(/<input type="checkbox"(?![^>]*checked)/);
    expect(html).toContain('desligada');
    expect(botoes(html)).toEqual([]);
  });

  it('ligada sem link: só "Gerar link" (sem confirmação: não há link antigo)', () => {
    const html = tela(pronto());
    expect(html).toMatch(/<input type="checkbox"[^>]*checked/);
    expect(html).toContain('Ainda não há link para este cliente.');
    expect(botoes(html)).toEqual(['Gerar link']);
  });

  it('ligada com link: "Copiar link" e "Gerar novo link", com a data do link', () => {
    const html = tela(pronto({ link: { createdAt: '2026-10-07T18:30:00Z' } }));
    expect(botoes(html)).toEqual(['Copiar link', 'Gerar novo link']);
    expect(html).toContain('Link criado em 07/10/2026');
  });

  it('pedindo novo link: a frase do que acontece e os dois botões da confirmação', () => {
    const html = tela(pronto({ link: { createdAt: '2026-10-07T18:30:00Z' } }), { confirmando: true });
    expect(html).toContain('O link antigo para de funcionar agora.');
    expect(botoes(html)).toEqual(['Sim, gerar novo link', 'Cancelar']);
  });

  it('o endereço em mãos aparece num campo só de leitura, com nome', () => {
    const html = tela(pronto({ link: { createdAt: '2026-10-07T18:30:00Z' } }), {
      endereco: 'https://app.example/aprovar/abc',
      aviso: 'Link copiado.',
    });
    expect(html).toMatch(/<input[^>]*readOnly[^>]*value="https:\/\/app.example\/aprovar\/abc"/i);
    expect(html).toContain('aria-label="Link de aprovação do cliente"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Link copiado.');
  });

  it('cliente inativo e ligado: avisa que o link não abre', () => {
    expect(tela(pronto({ active: false }))).toContain('Cliente inativo: o link não abre');
  });

  it('desligada com link guardado: diz que religar devolve o mesmo link', () => {
    expect(tela(pronto({ enabled: false, link: { createdAt: '2026-10-07T18:30:00Z' } }))).toContain(
      'Ligar de novo devolve o mesmo link.',
    );
  });

  it('ocupado: a chave e os botões ficam desabilitados', () => {
    const html = tela(pronto({ link: { createdAt: '2026-10-07T18:30:00Z' } }), { ocupado: true });
    expect(html).toMatch(/<input type="checkbox"[^>]*disabled/);
    expect((html.match(/<button[^>]*disabled/g) ?? []).length).toBe(2);
  });

  it('a recusa do servidor aparece inteira, como alerta', () => {
    const html = tela(pronto(), { falha: 'Só administrador configura a aprovação do cliente.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Só administrador configura a aprovação do cliente.');
  });

  it('erro de leitura: a frase e "Tentar de novo"', () => {
    const html = tela({ tipo: 'erro', mensagem: 'Não foi possível ler a aprovação deste cliente.' });
    expect(html).toContain('Não foi possível ler a aprovação deste cliente.');
    expect(botoes(html)).toEqual(['Tentar de novo']);
  });

  it('carregando: diz que está lendo', () => {
    expect(tela({ tipo: 'carregando' })).toContain('Lendo a aprovação deste cliente');
  });
});
