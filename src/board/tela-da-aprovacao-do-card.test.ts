/**
 * "SOLICITAR APROVAÇÃO" NO CARD — desenhado no servidor. F42, Fase 4.
 *
 * `renderToStaticMarkup`: nenhum efeito roda, cada estado entra por `props`. O
 * clique de verdade (incluir, ordenar, enviar) é o e2e `aprovacao-envio`.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { JanelaDeAprovacao, SecaoDaAprovacao } from '@/board/AprovacaoDoCard';
import type { AprovacaoDoCard, RodadaDoCard } from '@/server/aprovacao-envio';

const nada = () => {};

const base: AprovacaoDoCard = {
  taskId: 't',
  listId: '00000000-0000-0000-0000-0000000001a1',
  clientId: 'c',
  clientName: 'Cliente Um',
  enabled: true,
  configured: true,
  missing: [],
  awaitingStatusName: 'aguardando cliente',
  canConfigure: false,
  canCopyLink: false,
  rounds: [],
};

const rodada = (version: number, state: RodadaDoCard['state']): RodadaDoCard => ({
  id: `r${version}`,
  version,
  state,
  sentAt: '2026-10-07T19:20:00Z',
  sentBy: 'Helena',
  decidedAt: null,
  decidedVia: null,
  decisionComment: null,
  closedAt: null,
  items: [
    { position: 1, url: 'https://www.dropbox.com/scl/fi/a/1.jpg', kind: 'image', fileName: '1.jpg', source: 'dropbox' },
    { position: 2, url: 'https://www.dropbox.com/scl/fi/b/2.mp4', kind: 'video', fileName: '2.mp4', source: 'dropbox' },
  ],
});

const secao = (a: Partial<AprovacaoDoCard>, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(SecaoDaAprovacao, {
      aprovacao: { ...base, ...a },
      aoSolicitar: nada,
      aoConfigurar: nada,
      aoFecharConfiguracao: nada,
      aoCopiar: nada,
      ...extra,
    }),
  );

describe('a seção da ficha', () => {
  it('cliente sem a chave ligada: nada aparece (nem o botão)', () => {
    expect(secao({ enabled: false })).toBe('');
    expect(secao({ clientId: null })).toBe('');
  });

  it('cliente desligado mas com rodadas antigas: mostra as rodadas, sem botão', () => {
    const html = secao({ enabled: false, rounds: [rodada(1, 'approved')] });
    expect(html).toContain('data-rodada="1"');
    expect(html).not.toContain('Solicitar aprovação');
  });

  it('pronto: "Solicitar aprovação"; copiar o link só para quem pode', () => {
    const html = secao({});
    expect(html).toContain('>Solicitar aprovação</button>');
    expect(html).not.toContain('Copiar link do cliente');
    expect(secao({ canCopyLink: true })).toContain('Copiar link do cliente');
  });

  it('com rodada aberta: o botão vira "Enviar nova versão"; as rodadas aparecem com versão, data e estado em português', () => {
    const html = secao({ rounds: [rodada(2, 'open'), rodada(1, 'superseded')] });
    expect(html).toContain('>Enviar nova versão</button>');
    expect(html).toContain('v2');
    expect(html).toContain('aguardando o cliente');
    expect(html).toContain('substituída');
    expect(html).toContain('07/10 16:20');
    expect(html).toContain('por Helena');
    expect(html).toContain('2 materiais');
  });

  it('F42.7 — rodada decidida: estado, data e "pelo cliente, pelo link"; o motivo do pedido de ajustes à vista', () => {
    const reprovada: RodadaDoCard = {
      ...rodada(1, 'rejected'),
      decidedAt: '2026-10-08T13:05:00Z',
      decidedVia: 'client_link',
      decisionComment: 'A logo está pequena no segundo card. <b>Aumentem.</b>',
    };
    const aprovada: RodadaDoCard = {
      ...rodada(2, 'approved'),
      decidedAt: '2026-10-09T14:30:00Z',
      decidedVia: 'client_link',
    };
    const html = secao({ rounds: [aprovada, reprovada] });
    expect(html).toContain('ajustes pedidos em 08/10 10:05 · pelo cliente, pelo link');
    expect(html).toContain('aprovada em 09/10 11:30 · pelo cliente, pelo link');
    expect(html).toContain('Motivo do cliente:');
    // Texto do cliente sai como texto, nunca como marcação.
    expect(html).toContain('A logo está pequena no segundo card. &lt;b&gt;Aumentem.&lt;/b&gt;');
    expect(html).not.toContain('<b>Aumentem.</b>');
    // Aprovada sem comentário: sem bloco de motivo.
    expect(html.match(/data-motivo/g)).toHaveLength(1);
    // Rodada aberta não diz quem decidiu.
    expect(secao({ rounds: [rodada(3, 'open')] })).not.toContain('data-decisao');
  });

  it('esteira sem destinos: diz o que falta; admin tem "Configurar as etapas", os demais leem onde pedir', () => {
    // F43, Fase 6: o botão dizia "Configurar a esteira"; "esteira" saiu da
    // ficha. O que se protege é o mesmo: só quem administra vê o atalho.
    const falta = { configured: false, missing: ['aprovado', 'reprovado'] };
    const equipe = secao(falta);
    expect(equipe).toContain('Falta escolher: &quot;aprovado&quot;, &quot;reprovado&quot;');
    expect(equipe).toContain('Aprovação do cliente…');
    expect(equipe).not.toContain('Solicitar aprovação');
    expect(equipe).not.toContain('Configurar as etapas');
    expect(equipe).not.toContain('esteira');
    expect(secao({ ...falta, canConfigure: true })).toContain('Configurar as etapas');
  });
});

const janela = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(JanelaDeAprovacao, {
      clienteNome: 'Cliente Um',
      etapaDeAguardando: 'aguardando cliente',
      legenda: 'Legenda do post\nsegunda linha',
      sugestoes: [
        { url: 'https://www.dropbox.com/scl/fi/a/arte-1.jpg', origem: 'anexo "Arte"' },
        { url: 'https://www.dropbox.com/scl/fo/p/k', origem: 'descrição' },
      ],
      aoEnviar: nada,
      aoFechar: nada,
      ...extra,
    }),
  );

describe('a janela', () => {
  it('pré-lista os links do card com a origem, sem escolher por conta própria; enviar fica parado', () => {
    const html = janela();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Links do Dropbox neste card');
    expect(html).toContain('arte-1.jpg');
    expect(html).toContain('· anexo &quot;Arte&quot;');
    expect(html).toContain('Pasta do Dropbox');
    expect(html).toContain('Incluir todos');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-enviar-aprovacao/);
  });

  it('com material escolhido: ordem numerada, ↑ ↓ ✕ com nome para o teclado, legenda à vista', () => {
    const html = janela({
      inicial: ['https://www.dropbox.com/scl/fi/a/arte-1.jpg', 'https://www.dropbox.com/scl/fi/v/reels.mp4'],
    });
    expect(html).toContain('aria-label="Subir reels.mp4"');
    expect(html).toContain('aria-label="Descer arte-1.jpg"');
    expect(html).toContain('aria-label="Tirar arte-1.jpg"');
    expect(html).toMatch(/aria-label="Subir arte-1.jpg"[^>]*disabled=""|disabled=""[^>]*aria-label="Subir arte-1.jpg"/);
    expect(html).toContain('Legenda do post\nsegunda linha');
    expect(html).toContain('Enviar ao cliente (2 materiais)');
    expect(html).toContain('2/20');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-enviar-aprovacao/);
  });

  it('a prévia "como o cliente verá": imagem e vídeo pelo endereço raw=1 sem referer; pasta abre no Dropbox', () => {
    const html = janela({
      previaInicial: true,
      inicial: [
        'https://www.dropbox.com/scl/fi/a/arte-1.jpg?rlkey=x&dl=0',
        'https://www.dropbox.com/scl/fi/v/reels.mp4?rlkey=y&dl=0',
        'https://www.dropbox.com/scl/fo/p/k',
      ],
    });
    expect(html).toContain('src="https://www.dropbox.com/scl/fi/a/arte-1.jpg?rlkey=x&amp;raw=1"');
    expect(html).toMatch(/<img[^>]*referrerPolicy="no-referrer"|<img[^>]*referrerpolicy="no-referrer"/i);
    expect(html).toMatch(/<video[^>]*src="https:\/\/www\.dropbox\.com\/scl\/fi\/v\/reels\.mp4\?rlkey=y&amp;raw=1"/);
    expect(html).toContain('Abrir pasta no Dropbox');
  });

  it('avisa a substituição, a legenda vazia, a mudança não salva e a falha do envio', () => {
    const html = janela({ aberta: 1, legenda: null, legendaMudou: true, falha: 'O 1º link não é…' });
    expect(html).toContain('A versão 1, ainda aberta, será substituída.');
    expect(html).toContain('a descrição do card está vazia');
    expect(html).toContain('mudança ainda não salva');
    expect(html).toContain('O 1º link não é…');
  });
});

describe('a janela — artes anexadas (F42, Fase 9)', () => {
  const A1 = '00000000-0000-0000-0000-0000000a0001';
  const A2 = '00000000-0000-0000-0000-0000000a0002';
  const anexos = [
    { id: A1, nome: 'capa.png', origem: 'anexo do card' },
    { id: A2, nome: 'miolo.jpg', origem: 'comentário de Helena' },
  ];

  it('as artes aparecem como sugestão com miniatura e origem, ao lado dos links', () => {
    const html = janela({ anexos, miniaturas: { [A1]: 'https://assinado.invalid/capa?token=t' } });
    expect(html).toContain('Artes anexadas a este card');
    expect(html).toContain(`data-sugestao-anexo="${A1}"`);
    expect(html).toMatch(/<img[^>]*class="ap-miniatura"[^>]*src="https:\/\/assinado\.invalid\/capa\?token=t"/);
    expect(html).toContain('· comentário de Helena');
    expect(html).toContain('Incluir todas as artes');
    expect(html).toContain('Links do Dropbox neste card');
  });

  it('sem arte: diz que vídeo vai pelo Dropbox', () => {
    expect(janela()).toContain('Nenhuma imagem anexada');
  });

  it('o carrossel mistura arte e link na ordem; a prévia mostra a arte', () => {
    const html = janela({
      anexos,
      miniaturas: { [A1]: 'https://assinado.invalid/capa' },
      previaInicial: true,
      inicial: [`anexo:${A1}`, 'https://www.dropbox.com/scl/fi/v/reels.mp4?rlkey=y&dl=0'],
    });
    expect(html).toMatch(/data-material="anexo:[^"]+"[\s\S]*data-material="https:\/\/www\.dropbox\.com/);
    expect(html).toContain('aria-label="Tirar capa.png"');
    expect(html).toContain('data-previa-tipo="anexo"');
    expect(html).toContain('Enviar ao cliente (2 materiais)');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*data-enviar-aprovacao/);
    // Só a arte que falta segue como sugestão.
    expect(html).not.toContain(`data-sugestao-anexo="${A1}"`);
    expect(html).toContain(`data-sugestao-anexo="${A2}"`);
  });
});
