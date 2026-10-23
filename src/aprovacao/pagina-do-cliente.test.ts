/**
 * A PÁGINA DO CLIENTE, DESENHADA NO SERVIDOR — F42, Fase 6.
 *
 * `renderToStaticMarkup`: nenhum efeito roda, cada estado entra por `props`.
 * O clique, a decisão, o 409 e os 320 px são o e2e `aprovacao-cliente`.
 * Escrito em `createElement` porque a suíte só inclui `*.test.ts`.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { ChamadaPublica, PaginaPublica } from '@/aprovacao/cliente';
import { type Acoes, type Carga, Decisao, Midia, TelaDoLink, VistaDaChamada } from '@/aprovacao/PaginaDoCliente';

const acoes: Acoes = { comentar: async () => {}, decidir: async () => {} };

const DBX = 'https://www.dropbox.com/scl/fi';

const aberta: ChamadaPublica = {
  id: 'r-2',
  titulo: 'Reels — lançamento outubro',
  versao: 2,
  enviadaEm: '2026-10-07T17:32:00Z',
  legenda: 'Chegou a coleção nova!\n<b>Corre</b> que é por tempo limitado.',
  estado: 'aberta',
  decididaEm: null,
  itens: [
    { id: 'i1', ordem: 1, tipo: 'image', nome: 'capa.jpg', forma: 'arquivo', exibicao: `${DBX}/a/capa.jpg?rlkey=k&raw=1`, abrirNoDropbox: null },
    { id: 'i2', ordem: 2, tipo: 'video', nome: 'reels.mp4', forma: 'arquivo', exibicao: `${DBX}/b/reels.mp4?rlkey=k&raw=1`, abrirNoDropbox: null },
    { id: 'i3', ordem: 3, tipo: 'other', nome: 'Pasta do Dropbox', forma: 'pasta', exibicao: null, abrirNoDropbox: 'https://www.dropbox.com/scl/fo/p/q?rlkey=k&dl=0' },
    { id: 'i4', ordem: 4, tipo: 'other', nome: 'roteiro.pdf', forma: 'arquivo', exibicao: `${DBX}/c/roteiro.pdf?rlkey=k&raw=1`, abrirNoDropbox: null },
  ],
  comentarios: [
    { id: 'c1', texto: 'Amei a capa', criadoEm: '2026-10-07T17:40:00Z', itemId: 'i1' },
    { id: 'c2', texto: 'Comentário geral <script>', criadoEm: '2026-10-07T17:41:00Z', itemId: null },
  ],
};

const aprovada: ChamadaPublica = { ...aberta, id: 'r-1', versao: 1, estado: 'aprovada', decididaEm: '2026-10-06T18:10:00Z' };
const reprovada: ChamadaPublica = { ...aberta, id: 'r-0', versao: 1, estado: 'reprovada', decididaEm: '2026-10-05T12:00:00Z' };

const pagina = (chamadas: ChamadaPublica[]): PaginaPublica => ({ ok: true, cliente: { nome: 'Loja Exemplo' }, chamadas });

const tela = (carga: Carga, chamadaId: string | null = null) =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ['/aprovar/tok'] }, createElement(TelaDoLink, { carga, chamadaId, acoes })),
  );

const emRoteador = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/aprovar/tok'] }, el));

describe('a casca', () => {
  it('marca da Agência Ide no topo e o slogan no pé', () => {
    const html = tela({ fase: 'carregando' });
    expect(html).toContain('aria-label="Agência Ide"');
    expect(html).toContain('nós vamos com você');
    expect(html).toContain('<main');
  });
});

describe('os estados', () => {
  it('carregando', () => {
    const html = tela({ fase: 'carregando' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Abrindo seus materiais');
  });

  it('link inválido manda falar com o atendimento da Ide', () => {
    const html = tela({ fase: 'invalido' });
    expect(html).toContain('<h1');
    expect(html).toContain('Link inválido ou desativado');
    expect(html).toContain('Fale com o atendimento da Ide');
  });

  it('muitas tentativas pede para aguardar', () => {
    expect(tela({ fase: 'limite' })).toContain('Aguarde um instante');
  });

  it('falha mostra a frase', () => {
    expect(tela({ fase: 'falha', frase: 'Sem conexão com a Ide agora.' })).toContain('Sem conexão com a Ide agora.');
  });

  it('nada pendente, com as respondidas abaixo', () => {
    const html = tela({ fase: 'pronta', pagina: pagina([aprovada]) });
    expect(html).toContain('Para você responder');
    expect(html).toContain('Nada pendente por aqui.');
    expect(html).toContain('Já respondidas');
    expect(html).toContain('Aprovado em 06/10');
  });
});

describe('a lista', () => {
  it('abertas primeiro em "Para você responder"; respondidas com o selo da decisão', () => {
    const html = tela({ fase: 'pronta', pagina: pagina([aprovada, aberta, reprovada]) });
    const iAbertas = html.indexOf('Para você responder');
    const iRespondidas = html.indexOf('Já respondidas');
    expect(iAbertas).toBeGreaterThan(-1);
    expect(iRespondidas).toBeGreaterThan(iAbertas);
    // A aberta fica entre os dois títulos; as respondidas depois.
    expect(html.indexOf('?chamada=r-2')).toBeGreaterThan(iAbertas);
    expect(html.indexOf('?chamada=r-2')).toBeLessThan(iRespondidas);
    expect(html).toContain('Loja Exemplo');
    expect(html).toContain('Versão 2 · 4 materiais');
    expect(html).toContain('Ver e responder');
    expect(html).toContain('Aprovado em 06/10');
    expect(html).toContain('Ajustes pedidos em 05/10');
    expect(html).toContain('Enviado em 07/10/2026 às 14:32');
  });

  it('id de chamada que não existe cai na lista', () => {
    expect(tela({ fase: 'pronta', pagina: pagina([aberta]) }, 'nao-existe')).toContain('Materiais para aprovação');
  });
});

describe('a chamada aberta', () => {
  const html = tela({ fase: 'pronta', pagina: pagina([aberta]) }, 'r-2');

  it('título, versão, "Enviado em…" e o caminho de volta', () => {
    expect(html).toContain('Reels — lançamento outubro');
    expect(html).toContain('Versão 2');
    expect(html).toContain('Enviado em 07/10/2026 às 14:32');
    expect(html).toContain('Voltar à lista');
  });

  it('carrossel na ordem, com imagem sem referência e vídeo que toca no celular', () => {
    const i1 = html.indexOf('capa.jpg');
    const i2 = html.indexOf('reels.mp4');
    const i3 = html.indexOf('Pasta do Dropbox');
    const i4 = html.indexOf('roteiro.pdf');
    expect(i1).toBeGreaterThan(-1);
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
    expect(i3).toBeLessThan(i4);
    expect(html).toMatch(/<img[^>]*referrerPolicy="no-referrer"/);
    expect(html).toMatch(/<video[^>]*controls=""[^>]*playsinline=""[^>]*preload="metadata"/i);
    expect(html).toContain('Material 1 de 4');
  });

  it('pasta abre no Dropbox em nova aba; arquivo "outro" vira "Abrir arquivo"', () => {
    expect(html).toMatch(
      /<a[^>]*href="https:\/\/www\.dropbox\.com\/scl\/fo\/p\/q\?rlkey=k&amp;dl=0"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Abrir pasta no Dropbox<\/a>/,
    );
    expect(html).toContain('>Abrir arquivo</a>');
  });

  it('legenda e comentários como TEXTO, nunca HTML', () => {
    expect(html).toContain('&lt;b&gt;Corre&lt;/b&gt;');
    expect(html).not.toContain('<b>Corre</b>');
    expect(html).toContain('Comentário geral &lt;script&gt;');
    expect(html).toContain('Amei a capa');
  });

  it('comentar por material e geral; Aprovar e Pedir ajustes à vista', () => {
    expect(html).toContain('Comentar este material');
    expect(html).toContain('Escrever um comentário geral');
    expect(html).toMatch(/<button[^>]*apc-aprovar[^>]*>Aprovar<\/button>/);
    expect(html).toContain('>Pedir ajustes</button>');
  });
});

describe('decidir', () => {
  it('aprovar pede confirmação antes de enviar', () => {
    const html = emRoteador(createElement(Decisao, { chamada: aberta, aoDecidir: async () => {}, modoInicial: 'aprovar' }));
    expect(html).toContain('Aprovar “Reels — lançamento outubro”?');
    expect(html).toContain('Sim, aprovar');
    expect(html).toContain('Voltar');
  });

  it('aprovar sem ter visto tudo pergunta, com "Ver os outros"', () => {
    const html = emRoteador(
      createElement(Decisao, { chamada: aberta, aoDecidir: async () => {}, modoInicial: 'aprovar', vistos: [0], aoVerOutros: () => {} }),
    );
    expect(html).toMatch(/Você viu 1 de \d+ materiais\. Quer aprovar mesmo assim\?/);
    expect(html).toContain('Ver os outros');
    expect(html).toContain('Sim, aprovar');
  });

  it('aprovar tendo visto tudo mantém o texto de sempre', () => {
    const todos = aberta.itens.map((_, i) => i);
    const html = emRoteador(
      createElement(Decisao, { chamada: aberta, aoDecidir: async () => {}, modoInicial: 'aprovar', vistos: todos, aoVerOutros: () => {} }),
    );
    expect(html).not.toContain('Você viu');
    expect(html).not.toContain('Ver os outros');
  });

  it('pedir ajustes tem o campo do motivo obrigatório', () => {
    const html = emRoteador(createElement(Decisao, { chamada: aberta, aoDecidir: async () => {}, modoInicial: 'ajustes' }));
    expect(html).toContain('O que precisa mudar?');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('Enviar pedido de ajustes');
  });
});

describe('a chamada respondida', () => {
  it('aprovada: "Aprovado em…", só leitura, sem botões nem campos', () => {
    const html = emRoteador(createElement(VistaDaChamada, { chamada: aprovada, acoes }));
    expect(html).toContain('Aprovado em 06/10/2026 às 15:10');
    expect(html).toContain('só para ver');
    expect(html).not.toContain('>Aprovar</button>');
    expect(html).not.toContain('Pedir ajustes');
    expect(html).not.toContain('Comentar este material');
    expect(html).not.toContain('<textarea');
  });

  it('reprovada: "Ajustes pedidos em…"', () => {
    const html = emRoteador(createElement(VistaDaChamada, { chamada: reprovada, acoes }));
    expect(html).toContain('Ajustes pedidos em 05/10/2026 às 09:00');
    expect(html).not.toContain('>Aprovar</button>');
  });

  it('o aviso de 409 aparece junto da chamada já respondida', () => {
    const html = emRoteador(
      createElement(VistaDaChamada, {
        chamada: aprovada,
        acoes,
        avisoInicial: { tom: 'warn', texto: 'Você já respondeu este envio em 06/10/2026 às 15:10.' },
      }),
    );
    expect(html).toContain('Você já respondeu este envio em 06/10/2026 às 15:10.');
  });
});

describe('o material', () => {
  it('sem endereço de exibição, nem imagem nem vídeo: abre no Dropbox', () => {
    const html = renderToStaticMarkup(
      createElement(Midia, {
        item: { id: 'x', ordem: 1, tipo: 'video', nome: 'v.mp4', forma: 'arquivo', exibicao: null, abrirNoDropbox: null },
        posicao: 1,
      }),
    );
    expect(html).not.toContain('<video');
    expect(html).toContain('abre no Dropbox');
  });
});
