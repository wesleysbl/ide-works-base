/**
 * A PRÉVIA DO LINK ONDE AS PESSOAS DE FATO COLAM LINK — etapa F17.21.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO PROVA, E POR QUE CADA COISA IMPORTA
 *
 *   1. **NÃO HÁ `<a>` DENTRO DE `<a>` NO HTML PRODUZIDO.** É a prova central da
 *      etapa, e ela é MEDIDA no texto que sai de `renderToStaticMarkup` — não
 *      deduzida de olhar a tela. Na F17.6 um agente escreveu uma segunda regra
 *      de endereço ao lado da `URL_SOLTA` que já existia, olhou a tela, achou
 *      bonito, e só descobriu o link dentro do link quando alguém mediu o HTML.
 *      Aqui a medição é o teste, e ela varre TODO caso desenhado.
 *
 *      A varredura acusa também `<button>` dentro de `<a>`, que é o mesmo
 *      defeito de estrutura com outro nome: conteúdo interativo dentro de
 *      conteúdo interativo. O cartão tem um botão e um link, e a única coisa
 *      que impede os dois de se aninharem é o desenho — logo, é o desenho que
 *      precisa de prova.
 *
 *   2. **O CARTÃO SE SOMA AO LINK, NÃO O SUBSTITUI.** O `<a class="md-elo">` do
 *      texto continua no HTML depois do cartão existir. Se um dia alguém trocar
 *      o parágrafo pelo cartão, a frase se parte no meio — e o caso real que
 *      motivou a etapa é exatamente uma frase com o link no fim.
 *
 *   3. **A DECISÃO B DO USUÁRIO, NOS DOIS SENTIDOS.** Endereço com teto de
 *      tamanho (capa do YouTube, miniatura do Drive) desenha a `<img>` já no
 *      primeiro quadro; endereço que devolve o arquivo original (o `raw=1` do
 *      Dropbox) NÃO desenha imagem nenhuma e oferece o botão. Sem os dois lados
 *      o teste passaria com a regra invertida.
 *
 *   4. **HOSPEDEIRO DESCONHECIDO NUNCA VIRA `src` DE IMAGEM.** Vale mesmo
 *      quando o endereço termina em `.png`: sem esta trava, todo link colado
 *      numa tarefa viraria pixel de rastreio, e quem mandou o link saberia a
 *      hora em que cada pessoa abriu a tarefa.
 *
 *   5. **`javascript:`, `data:` E `vbscript:` NÃO VIRAM `href` NEM `src`.** O
 *      texto vem de terceiro, e agora ele escolhe o endereço de uma imagem.
 *
 *   6. **A ÚNICA PORTA QUE A F17.22 ABRIU É A DO SERVIDOR DO PRÓPRIO DONO.** O
 *      mesmo texto real do usuário é medido duas vezes — com a lista vazia (sem
 *      imagem, como antes desta etapa) e com o hospedeiro declarado (imagem com
 *      teto, sozinha). E `evil.com/nuvem.exemplo.net/…` continua sem `src` nas
 *      duas, porque quem manda é o hospedeiro e não o formato do caminho.
 *
 * SEM NAVEGADOR, E POR ISSO O PRIMEIRO QUADRO
 *   A suíte roda em ambiente `node`, e `renderToStaticMarkup` não roda efeito
 *   nem estado. O que se prova aqui é o que a pessoa vê ANTES de tocar em nada
 *   — que é justamente onde mora a decisão de carregar ou não a imagem.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e teste que
 *   não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { linksDoConteudo, linksDoTexto, parseInline } from '@/board/markdown';
import { definirHospedeirosConfiaveis, lerLink } from '@/board/previa-de-link';
import { Markdown } from '@/ui/Markdown';

/*
  A LISTA DE SERVIDORES CONFIÁVEIS (F17.22) VOLTA AO VAZIO A CADA TESTE.

  Vazia é o padrão de fábrica, e é o estado em que TODAS as provas anteriores a
  esta etapa foram escritas — inclusive a que varre todo `<img src>` desenhado.
  Se um teste declarasse um hospedeiro confiável e não desfizesse, ela passaria
  a medir outra coisa sem ninguém perceber.
*/
afterEach(() => definirHospedeirosConfiaveis(''));

/* ───────────────────────────── as ferramentas de medida ───────────────────────────── */

const html = (fonte: string) => renderToStaticMarkup(createElement(Markdown, { fonte }));

/**
 * A PROFUNDIDADE MÁXIMA DE `<a>` no HTML, contada de verdade.
 *
 * `<a[\s>]` e não `<a` — senão `<article>` contaria como link aberto. E a conta
 * é de PILHA, não de ocorrência: dois links seguidos dão profundidade 1, um
 * dentro do outro dá 2. É a diferença entre o certo e o defeito.
 */
function profundidadeDeLink(marcacao: string): number {
  let nivel = 0;
  let maximo = 0;
  const marca = /<a[\s>]|<\/a>/g;
  let achado: RegExpExecArray | null;
  while ((achado = marca.exec(marcacao)) !== null) {
    if (achado[0] === '</a>') nivel -= 1;
    else {
      nivel += 1;
      if (nivel > maximo) maximo = nivel;
    }
  }
  return maximo;
}

/** Quantos `<button>` nascem enquanto um `<a>` está aberto. Tem que ser zero. */
function botoesDentroDeLink(marcacao: string): number {
  let nivel = 0;
  let dentro = 0;
  const marca = /<a[\s>]|<\/a>|<button[\s>]/g;
  let achado: RegExpExecArray | null;
  while ((achado = marca.exec(marcacao)) !== null) {
    if (achado[0] === '</a>') nivel -= 1;
    else if (achado[0].startsWith('<button')) {
      if (nivel > 0) dentro += 1;
    } else nivel += 1;
  }
  return dentro;
}

const contar = (marcacao: string, pedaco: string) => marcacao.split(pedaco).length - 1;

/**
 * TODO texto que este arquivo desenha passa pela varredura de aninhamento.
 * Juntá-los numa lista é o que impede um caso novo de entrar sem ser medido.
 */
const TEXTOS: Record<string, string> = {
  'a tarefa real do usuário':
    'Subir as imagens na medida exata - [https://nuvem.exemplo.net/index.php/s/Qr7MwyYFwGiLJkH](https://nuvem.exemplo.net/index.php/s/Qr7MwyYFwGiLJkH)',
  'link cru, sem colchete': 'Entrega aqui https://www.dropbox.com/scl/fi/8h2/Arte.png?rlkey=abc',
  'link dentro de link': '[[interno](https://a.exemplo.com/x)](https://b.exemplo.com/y)',
  'link dentro de negrito': 'olha **[a arte](https://www.dropbox.com/scl/fi/1/peca.png)** aí',
  'link sozinho na linha': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'link em item de lista': '- entrega: https://www.dropbox.com/scl/fi/9/story.png?rlkey=k',
  'link em título': '# https://www.dropbox.com/scl/fi/9/capa.png',
  'link em tabela': '| peça | onde |\n| --- | --- |\n| story | https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view |',
  'link em citação': '> combinado: https://docs.google.com/document/d/1AbC/edit',
  'muitos links num parágrafo só':
    'a https://um.exemplo.com/a b https://dois.exemplo.com/b c https://tres.exemplo.com/c d https://quatro.exemplo.com/d e https://cinco.exemplo.com/e',
  'endereço recusado': '[clique](javascript:alert(1)) e [outro](data:image/png;base64,AAAA)',
  'imagem de hospedeiro desconhecido': 'veja https://rastreador.example.com/pixel/abc.png',
  'perfil do Instagram': 'https://www.instagram.com/perfil.exemplo/',
};

/* ───────────────────────────── 1. a prova central ───────────────────────────── */

describe('NÃO existe `<a>` dentro de `<a>` — medido no HTML produzido', () => {
  for (const [nome, fonte] of Object.entries(TEXTOS)) {
    it(`${nome}: profundidade de link nunca passa de 1`, () => {
      const marcacao = html(fonte);
      expect(profundidadeDeLink(marcacao)).toBeLessThanOrEqual(1);
      // E os `<a>` fecham todos: contagem de abre igual à de fecha. Sem isto a
      // varredura acima poderia dar 1 num HTML torto.
      const abre = (marcacao.match(/<a[\s>]/g) ?? []).length;
      const fecha = (marcacao.match(/<\/a>/g) ?? []).length;
      expect(abre).toBe(fecha);
    });

    it(`${nome}: nenhum \`<button>\` nasce dentro de um \`<a>\``, () => {
      expect(botoesDentroDeLink(html(fonte))).toBe(0);
    });
  }

  it('o caso que morde: `[[a](b)](c)` já não produz dois links aninhados', () => {
    // ⚠️ ESTE ERA UM DEFEITO DE VERDADE, e não uma precaução. `acharFecho`
    // respeita aninhamento de colchete de propósito, então o rótulo `[a](b)`
    // voltava para `parseInline` e virava um nó `link` dentro de outro.
    const nos = parseInline('[[interno](https://a.exemplo.com/x)](https://b.exemplo.com/y)');
    expect(nos).toHaveLength(1);
    expect(nos[0].kind).toBe('link');
    const dentro = nos[0].kind === 'link' ? nos[0].children : [];
    expect(dentro.some((n) => n.kind === 'link')).toBe(false);
    // O texto do link de dentro sobrevive: some o clique, não some a palavra.
    expect(JSON.stringify(dentro)).toContain('interno');
  });
});

/* ───────────────────────────── 2. o cartão SE SOMA ───────────────────────────── */

describe('o cartão nasce ABAIXO do parágrafo, e o link do texto continua lá', () => {
  const marcacao = html(TEXTOS['a tarefa real do usuário']);

  it('a frase continua inteira, com o link ainda clicável dentro dela', () => {
    expect(marcacao).toContain('Subir as imagens na medida exata');
    expect(marcacao).toContain('class="md-elo"');
  });

  it('e ganha um cartão, com o destino legível', () => {
    expect(marcacao).toContain('class="pv-alvo"');
    expect(marcacao).toContain('nuvem.exemplo.net');
  });

  it('o `<p>` FECHA antes de o cartão abrir — é o que impede o aninhamento', () => {
    const fimDoParagrafo = marcacao.indexOf('</p>');
    const inicioDoCartao = marcacao.indexOf('class="pv-pilha"');
    expect(fimDoParagrafo).toBeGreaterThan(-1);
    expect(inicioDoCartao).toBeGreaterThan(fimDoParagrafo);
  });

  it('e não desenha imagem nenhuma: o hospedeiro é desconhecido', () => {
    expect(marcacao).not.toContain('<img');
  });

  it('o link CRU, sem colchete, ganha cartão pelo mesmo caminho', () => {
    // É a regra `URL_SOLTA`, que já existia. A prévia colhe o que ela achou —
    // não procura endereço de novo.
    expect(html(TEXTOS['link cru, sem colchete'])).toContain('class="pv-alvo"');
  });
});

describe('onde o cartão NÃO entra, e é decisão', () => {
  it('item de lista não vira cartão — dez entregas virariam dez cartões', () => {
    expect(html(TEXTOS['link em item de lista'])).not.toContain('pv-pilha');
  });

  it('título não vira cartão — ele é linha de hierarquia', () => {
    expect(html(TEXTOS['link em título'])).not.toContain('pv-pilha');
  });

  it('célula de tabela não vira cartão — ela tem largura de coluna', () => {
    expect(html(TEXTOS['link em tabela'])).not.toContain('pv-pilha');
  });

  it('mas o parágrafo DENTRO de uma citação vira, porque continua um parágrafo', () => {
    expect(html(TEXTOS['link em citação'])).toContain('pv-pilha');
  });
});

describe('o teto e a repetição', () => {
  it('cinco links num parágrafo dão TRÊS cartões', () => {
    expect(contar(html(TEXTOS['muitos links num parágrafo só']), 'class="pv-alvo"')).toBe(3);
  });

  it('o mesmo endereço colado duas vezes dá UM cartão', () => {
    const fonte = 'olha https://um.exemplo.com/a e de novo https://um.exemplo.com/a';
    expect(contar(html(fonte), 'class="pv-alvo"')).toBe(1);
  });
});

/* ───────────────────────────── 3. a decisão B, nos dois sentidos ───────────────────────────── */

describe('a imagem sobe sozinha quando o endereço tem TETO, e espera clique quando não tem', () => {
  it('capa do YouTube: `hqdefault` é 480×360 sempre — desenha já no primeiro quadro', () => {
    const marcacao = html(TEXTOS['link sozinho na linha']);
    expect(marcacao).toContain('<img');
    expect(marcacao).toContain('i.ytimg.com');
    // E sem botão: pedir o que já está na tela seria botão morto.
    expect(marcacao).not.toContain('ver imagem');
  });

  it('miniatura do Drive: `sz=w640` é o teto, e ele também sobe sozinho', () => {
    const marcacao = html('a peça: https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view');
    expect(marcacao).toContain('<img');
    expect(marcacao).toContain('sz=w640');
  });

  it('Dropbox: `raw=1` devolve o arquivo INTEIRO — nenhuma imagem, e um botão', () => {
    const marcacao = html(TEXTOS['link cru, sem colchete']);
    expect(marcacao).not.toContain('<img');
    expect(marcacao).toContain('ver imagem');
  });

  it('a que sobe sozinha sai com `no-referrer` e `lazy`', () => {
    const marcacao = html(TEXTOS['link sozinho na linha']);
    // A caixa do atributo é do React, não nossa: o 18 escreve `referrerPolicy`
    // e o 19 escreve `referrerpolicy`. O que este teste guarda é o VALOR — que
    // o hospedeiro receba o pedido do arquivo e não o endereço da tela interna.
    expect(marcacao).toMatch(/referrerpolicy="no-referrer"/i);
    expect(marcacao).toContain('loading="lazy"');
  });

  it('e `carga` diz isso na fonte, para a tela não ter que adivinhar', () => {
    expect(lerLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.carga).toBe('leve');
    expect(lerLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view')?.carga).toBe('leve');
    expect(lerLink('https://www.dropbox.com/scl/fi/1/a.png?rlkey=k')?.carga).toBe('original');
    // Sem miniatura possível, não há carga nenhuma — nem imagem, nem botão.
    expect(lerLink('https://www.dropbox.com/scl/fi/1/a.mp4?rlkey=k')?.carga).toBeNull();
    expect(lerLink('https://exemplo.com/pagina')?.carga).toBeNull();
    expect(lerLink('https://docs.google.com/document/d/1AbC/edit')?.carga).toBeNull();
  });
});

/* ───────────────────────────── 4. o que não pode afrouxar ───────────────────────────── */

describe('domínio desconhecido NUNCA vira `src` de imagem', () => {
  it('nem quando o endereço termina em `.png`', () => {
    const marcacao = html(TEXTOS['imagem de hospedeiro desconhecido']);
    // O cartão existe e diz que é imagem — o que ele não faz é BUSCÁ-LA.
    expect(marcacao).toContain('class="pv-alvo"');
    expect(marcacao).not.toContain('<img');
    expect(marcacao).not.toContain('ver imagem');
    expect(lerLink('https://rastreador.example.com/pixel/abc.png')?.miniatura).toBeNull();
    expect(lerLink('https://rastreador.example.com/pixel/abc.png')?.carga).toBeNull();
  });

  it('o único `src` de imagem que sai daqui é de hospedeiro conhecido', () => {
    for (const fonte of Object.values(TEXTOS)) {
      for (const achado of html(fonte).matchAll(/<img[^>]*\ssrc="([^"]*)"/g)) {
        expect(achado[1]).toMatch(/^https:\/\/(i\.ytimg\.com|drive\.google\.com|www\.dropbox\.com)\//);
      }
    }
  });
});

describe('`javascript:`, `data:` e `vbscript:` continuam recusados nos dois sentidos', () => {
  const marcacao = html(TEXTOS['endereço recusado']);

  it('não viram `href`', () => {
    expect(marcacao).not.toContain('href="javascript:');
    expect(marcacao).not.toContain('href="data:');
    expect(marcacao).not.toContain('href="vbscript:');
  });

  it('não viram `src`, e não viram cartão', () => {
    expect(marcacao).not.toContain('<img');
    expect(marcacao).not.toContain('pv-pilha');
  });

  it('e o TEXTO do link sobrevive: some o clique, não some a informação', () => {
    expect(marcacao).toContain('clique');
  });

  it('`lerLink` recusa os três, mesmo chamada direto', () => {
    expect(lerLink('javascript:alert(1)')).toBeNull();
    expect(lerLink('data:image/png;base64,AAAA')).toBeNull();
    expect(lerLink('vbscript:msgbox(1)')).toBeNull();
  });

  it('e a colheita de links só entrega `http`/`https`', () => {
    const nos = parseInline('[a](mailto:x@y.com) [b](/interno) [c](#ancora) [d](https://ok.com/z)');
    expect(linksDoConteudo(nos)).toEqual(['https://ok.com/z']);
  });
});

/* ───────────────────────────── 5. a colheita, que não procura nada ───────────────────────────── */

describe('`linksDoConteudo` COLHE da árvore — não procura endereço de novo', () => {
  it('acha o que o colchete, o `<…>` e a `URL_SOLTA` já tinham achado', () => {
    const nos = parseInline(
      'um [rótulo](https://a.com/1), um cru https://b.com/2 e um <https://c.com/3>',
    );
    expect(linksDoConteudo(nos)).toEqual(['https://a.com/1', 'https://b.com/2', 'https://c.com/3']);
  });

  it('entra em negrito, itálico e riscado', () => {
    expect(linksDoConteudo(parseInline('**[x](https://a.com/1)**'))).toEqual(['https://a.com/1']);
  });

  it('repete uma vez só, na ordem em que apareceu', () => {
    const nos = parseInline('https://b.com/2 https://a.com/1 https://b.com/2');
    expect(linksDoConteudo(nos)).toEqual(['https://b.com/2', 'https://a.com/1']);
  });
});

describe('`linksDoTexto` — é o que a DESCRIÇÃO usa, e ela é o documento inteiro', () => {
  it('junta parágrafo, título, lista, citação e tabela, sem repetir', () => {
    const fonte = [
      '# https://a.com/1',
      '',
      'no texto https://b.com/2',
      '',
      '- na lista https://c.com/3',
      '',
      '> na citação https://a.com/1',
      '',
      '| onde |',
      '| --- |',
      '| https://d.com/4 |',
    ].join('\n');
    expect(linksDoTexto(fonte)).toEqual([
      'https://a.com/1',
      'https://b.com/2',
      'https://c.com/3',
      'https://d.com/4',
    ]);
  });

  it('texto sem link nenhum devolve lista vazia, e não desenha pilha', () => {
    expect(linksDoTexto('só uma frase comum')).toEqual([]);
    expect(html('só uma frase comum')).not.toContain('pv-pilha');
  });

  it('texto vazio não quebra', () => {
    expect(linksDoTexto('')).toEqual([]);
  });
});

/* ───────────────────────────── 6. o que a agência de fato cola ───────────────────────────── */

describe('o Instagram — quatro dos seis endereços colados hoje são dele', () => {
  it('o perfil vira `@nome`, que é a única coisa que alguém quer saber ali', () => {
    const marcacao = html(TEXTOS['perfil do Instagram']);
    expect(marcacao).toContain('@perfil.exemplo');
    expect(marcacao).toContain('Perfil · Instagram');
  });

  it('publicação e reel são reconhecidos', () => {
    expect(lerLink('https://www.instagram.com/p/CxYz123/')?.tipo).toBe('Publicação');
    expect(lerLink('https://www.instagram.com/reel/CxYz123/')?.tipo).toBe('Reel');
  });

  it('e NENHUM deles vira imagem — o Instagram recusa pedido de fora do site dele', () => {
    expect(lerLink('https://www.instagram.com/p/CxYz123/')?.miniatura).toBeNull();
    expect(lerLink('https://www.instagram.com/perfil.exemplo/')?.miniatura).toBeNull();
    expect(html(TEXTOS['perfil do Instagram'])).not.toContain('<img');
  });
});

/* ───────────────────────────── 7. nada quebra a tela ───────────────────────────── */

describe('link morto, torto ou esquisito não derruba o desenho', () => {
  const tortos = [
    'https://',
    'https://exemplo.com',
    'https://exemplo.com/',
    'https://exemplo.com/%E9%A9%AC.png',
    'https://xn--80ak6aa92e.com/a.png',
    'https://exemplo.com:99999/a',
    'https://exemplo.com/a?b=' + 'x'.repeat(500),
  ];

  for (const alvo of tortos) {
    it(`desenha sem lançar: ${alvo.slice(0, 48)}`, () => {
      const marcacao = html(`veja ${alvo}`);
      expect(marcacao).toContain('md-p');
      expect(profundidadeDeLink(marcacao)).toBeLessThanOrEqual(1);
    });
  }

  it('e a descrição vazia continua dizendo o que dizia', () => {
    expect(html('')).toContain('Sem descrição.');
  });
});

/* ───────────────────── 8. os servidores confiáveis, F17.22 ───────────────────── */

/**
 * O CASO REAL DO USUÁRIO, DESENHADO — e a trava que continua fechada.
 *
 * O texto é o mesmo de `a tarefa real do usuário` lá em cima: quatro dos
 * endereços colados até hoje são deste Nextcloud. Ali ele é medido com a lista
 * VAZIA (sem imagem, como antes); aqui, com o hospedeiro declarado.
 *
 * As duas medições juntas são a prova: o que mudou foi a lista, e nada mais.
 */
describe('o servidor que o dono declarou seu desenha a imagem — e só ele', () => {
  const NC = 'nuvem.exemplo.net';
  const REAL = `Subir as imagens na medida exata - https://${NC}/index.php/s/Qr7MwyYFwGiLJkH`;
  const FALSO = `veja https://evil.com/${NC}/index.php/s/Qr7MwyYFwGiLJkH`;

  it('com a lista vazia — o padrão — ele continua sem `<img>`', () => {
    const marcacao = html(REAL);
    expect(marcacao).toContain('class="pv-alvo"');
    expect(marcacao).not.toContain('<img');
  });

  it('declarado confiável, a miniatura COM TETO sobe sozinha no primeiro quadro', () => {
    definirHospedeirosConfiaveis(NC);
    const marcacao = html(REAL);
    expect(marcacao).toContain('<img');
    expect(marcacao).toContain('publicpreview');
    expect(marcacao).toContain('x=640');
    // `leve` sobe sozinha: não há botão de pedir.
    expect(marcacao).not.toContain('ver imagem');
    // E continua valendo o que a etapa anterior garantiu.
    expect(marcacao).toMatch(/referrerpolicy="no-referrer"/i);
    expect(profundidadeDeLink(marcacao)).toBeLessThanOrEqual(1);
    expect(botoesDentroDeLink(marcacao)).toBe(0);
  });

  it('⚠️ e o mesmo nome no CAMINHO de outro servidor não desenha nada', () => {
    definirHospedeirosConfiaveis(NC);
    const marcacao = html(FALSO);
    expect(marcacao).toContain('class="pv-alvo"');
    expect(marcacao).not.toContain('<img');
    expect(lerLink(`https://evil.com/${NC}/index.php/s/Qr7MwyYFwGiLJkH`)?.miniatura).toBeNull();
  });

  it('o `src` desenhado sai do hospedeiro da lista, e de mais nenhum', () => {
    definirHospedeirosConfiaveis(NC);
    for (const fonte of [REAL, FALSO, ...Object.values(TEXTOS)]) {
      for (const achado of html(fonte).matchAll(/<img[^>]*\ssrc="([^"]*)"/g)) {
        expect(achado[1]).toMatch(
          /^https:\/\/(i\.ytimg\.com|drive\.google\.com|www\.dropbox\.com|nuvem\.exemplo\.net)\//,
        );
      }
    }
  });
});
