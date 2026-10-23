import path from 'node:path';

import react from '@vitejs/plugin-react-swc';
import { type Plugin, defineConfig } from 'vite';

import { REGRAS_DE_PRECARGA, moduloDoCaminho } from './src/rotas-precarga';

/**
 * A PRÉ-CARGA DA TELA PELO ENDEREÇO — perf-front, 08/10/2026.
 *
 * Só na construção (o servidor de desenvolvimento não tem pedaços com hash).
 * Para cada tela da tabela de `src/rotas-precarga.ts` acha o pedaço dela no
 * pacote, junta tudo o que ele importa de forma estática (menos o que a entrada
 * já traz) e as folhas de estilo, e escreve no começo do `<head>` um script
 * pequeno: pelo `location.pathname`, ele pede esses arquivos AGORA, em paralelo
 * com a entrada, em vez de esperar a entrada rodar e desenhar a moldura. É
 * exatamente o conjunto que o `import()` da tela pediria depois — nenhum byte a
 * mais para quem abre a tela; só mais cedo. Para quem cai em outra tela
 * (redirecionamento para o login, por exemplo) são alguns kB baixados à toa.
 *
 * O que o Vite faz quando o `import()` chega continua igual: ele vê o
 * `modulepreload` que já existe no `<head>` e não pede de novo; a folha de
 * estilo ele insere como sempre, e o navegador a pega do `preload`.
 */
function precargaDaTela(): Plugin {
  let base = '/';
  return {
    name: 'ideworks-precarga-da-tela',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const pacote = ctx.bundle;
        if (pacote === undefined) return undefined;
        const chunk = (nome: string) => {
          const c = pacote[nome];
          return c !== undefined && c.type === 'chunk' ? c : undefined;
        };
        const fechamento = (inicio: string, vistos = new Set<string>()): Set<string> => {
          if (vistos.has(inicio)) return vistos;
          vistos.add(inicio);
          for (const dep of chunk(inicio)?.imports ?? []) fechamento(dep, vistos);
          return vistos;
        };
        const entrada = Object.values(pacote).find((c) => c.type === 'chunk' && c.isEntry);
        const daEntrada = entrada === undefined ? new Set<string>() : fechamento(entrada.fileName);
        const estilosDaEntrada = new Set<string>();
        for (const nome of daEntrada) {
          for (const css of chunk(nome)?.viteMetadata?.importedCss ?? []) estilosDaEntrada.add(css);
        }

        // Cada arquivo aparece UMA vez em `arquivos`; as telas apontam por
        // índice. Com os nomes repetidos por tela o script passava de 12 kB, e
        // ele fica no caminho do primeiro byte do HTML.
        const arquivos: string[] = [];
        const indiceDe = (href: string) => {
          const i = arquivos.indexOf(href);
          return i >= 0 ? i : arquivos.push(href) - 1;
        };
        const doModulo = (modulo: string) =>
          Object.values(pacote).find(
            (c) => c.type === 'chunk' && c.facadeModuleId?.replace(/\\/g, '/').endsWith(`/src/${modulo}.tsx`),
          );
        const arquivosDe = (alvo: { fileName: string }) => {
          const js = new Set<number>();
          const css = new Set<number>();
          for (const nome of fechamento(alvo.fileName)) {
            if (daEntrada.has(nome)) continue;
            js.add(indiceDe(base + nome));
            for (const folha of chunk(nome)?.viteMetadata?.importedCss ?? []) {
              if (!estilosDaEntrada.has(folha)) css.add(indiceDe(base + folha));
            }
          }
          return { js: [...js], css: [...css] };
        };

        // A FICHA AO LADO, PARA QUEM ABRE CARTÃO — o primeiro clique num cartão
        // buscava os pedaços da ficha (editor, conversa, anexos): com 60
        // cartões e o cache vazio, 954 ms a 3G (150 ms de ida e volta) contra
        // ~360 ms com os pedaços do JS já buscados. Quem hospeda a ficha é quem
        // tem o `LinkDaTarefa` no pacote da tela — derivado do próprio pacote,
        // sem lista para esquecer. É `modulepreload` e só depois do `load`, em
        // ocioso: não compete com o caminho crítico e não EXECUTA nada antes do
        // clique (o CSS da ficha só entra quando o `import()` roda).
        //
        // ⚠️ SÓ O JS, DE PROPÓSITO. Testado: `rel=prefetch` não é reaproveitado
        // pelo `import()` do Chrome (os mesmos bytes eram baixados de novo no
        // clique); `preload as=style` para as 2 folhas pequenas da ficha
        // reaproveita, mas o Chrome escreve um aviso no console por folha
        // ("preloaded but not used") em toda sessão que não clica num cartão
        // em poucos segundos — ruído que não compensa os ~170 ms restantes a 3G.
        const ficha = doModulo('board/FichaAoLado');
        const daFicha = ficha === undefined ? { js: [], css: [] } : arquivosDe(ficha);
        const hospedaAFicha = (alvo: { fileName: string }) =>
          [...fechamento(alvo.fileName)].some((nome) =>
            Object.keys(chunk(nome)?.modules ?? {}).some((m) => m.replace(/\\/g, '/').endsWith('/src/board/LinkDaTarefa.tsx')),
          );

        const mapa: Record<string, [js: number[], css: number[], ficha: 0 | 1]> = {};
        for (const [, modulo] of REGRAS_DE_PRECARGA) {
          if (mapa[modulo] !== undefined) continue;
          const alvo = doModulo(modulo);
          if (alvo === undefined) continue;
          const { js, css } = arquivosDe(alvo);
          mapa[modulo] = [js, css, daFicha.js.length > 0 && hospedaAFicha(alvo) ? 1 : 0];
        }
        if (Object.keys(mapa).length === 0) return undefined;

        // Texto puro, e não uma função serializada: este arquivo é compilado
        // para Node (sem `document`), e o que vai ao navegador é o texto.
        // O mesmo `crossorigin` que o Vite põe nas suas tags: sem ele o
        // navegador trata como outro pedido e baixa duas vezes.
        const codigo =
          `(function(achar,regras,F,M,K){var c=achar(location.pathname,regras);c=c&&M[c];if(!c)return;` +
          `var d=document,i;function p(rel,i,as){var l=d.createElement('link');l.rel=rel;if(as)l.as=as;` +
          `l.crossOrigin='';l.href=F[i];d.head.appendChild(l)}` +
          `for(i=0;i<c[0].length;i++)p('modulepreload',c[0][i]);` +
          `for(i=0;i<c[1].length;i++)p('preload',c[1][i],'style');` +
          `if(c[2])addEventListener('load',function(){(window.requestIdleCallback||function(f){setTimeout(f,1500)})(function(){` +
          `for(var j=0;j<K.length;j++)if(c[0].indexOf(K[j])<0)p('modulepreload',K[j])})})})` +
          `(${moduloDoCaminho.toString()},${JSON.stringify(REGRAS_DE_PRECARGA)},` +
          `${JSON.stringify(arquivos)},${JSON.stringify(mapa)},${JSON.stringify(daFicha.js)})`;
        return [{ tag: 'script', children: codigo, injectTo: 'head-prepend' }];
      },
    },
  };
}

// Sem o plugin de marcacao da plataforma de origem, de proposito: o IDE Works
// nasce desamarrado dela. Ver F0.1 do plano.
export default defineConfig({
  server: {
    host: '::',
    port: 8080,
    // O navegador fala SO com a nossa borda (decisao D6). Em desenvolvimento
    // o Worker roda em 8787; em producao o mesmo caminho /api aponta para ele.
    // O prefixo `/api` chega ao Worker INTACTO, porque é ele quem faz o recorte
    // entre API e site — em desenvolvimento e em produção do mesmo jeito.
    //
    // Este proxy já tirou o prefixo antes de repassar, e o resultado foi o
    // login local respondendo 405 enquanto o publicado funcionava. Divergência
    // entre os dois ambientes é a origem clássica do "funciona na minha
    // máquina"; aqui ela apareceu ao contrário, e mesmo assim custou tempo.
    // `ws: true` — F20.4: a conexão ao vivo do chat também passa pelo proxy,
    // para desenvolvimento e produção se comportarem igual (mesmo caminho /api).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, ws: true },
    },
  },
  plugins: [react(), precargaDaTela()],

  // SO o prefixo PUBLIC chega ao navegador. Se isto virar apenas 'IDEWORKS_',
  // a senha do banco vai junto para dentro do pacote — o empacotador exporta
  // TUDO que casa com o prefixo. Ha teste que cobra esta linha.
  envPrefix: 'IDEWORKS_PUBLIC_',

  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },

  build: {
    rollupOptions: {
      output: {
        /**
         * AS BIBLIOTECAS SAEM DO PACOTE DE ENTRADA — perf-front, 08/10/2026.
         *
         * POR QUE
         *   O `index-*.js` misturava duas coisas de ritmo oposto: o código do
         *   sistema (muda a cada publicação) e React, roteador e cache de
         *   consultas (só mudam quando alguém atualiza a dependência). Como o
         *   nome do arquivo leva o hash do CONTEÚDO, qualquer linha mudada no
         *   sistema trocava o nome do pacote inteiro — e a equipe, com a aba
         *   aberta o dia todo, rebaixava ~136 kB (gzip) de React a cada deploy.
         *   Separadas, as bibliotecas ganham nome próprio que sobrevive aos
         *   deploys (e, com `immutable` em `public/_headers`, nem são pedidas).
         *
         * ⚠️ SÓ ESTAS TRÊS, DE PROPÓSITO
         *   Um `vendor` único voltaria a invalidar tudo quando QUALQUER
         *   dependência subisse de versão. Três grupos que se atualizam
         *   separadamente (React, roteador, consultas) invalidam um de cada
         *   vez. `lucide-react` fica de fora: cada tela leva só os ícones que
         *   usa, e juntar tudo num arquivo faria a entrada baixar os de todas.
         *
         * Os três continuam baixando em paralelo com a entrada: o Vite os põe
         * no `<head>` como `modulepreload`.
         */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'bib-react';
          if (/node_modules\/(react-router|react-router-dom)\//.test(id)) return 'bib-roteador';
          if (/node_modules\/@tanstack\//.test(id)) return 'bib-consultas';
          return undefined;
        },
      },
    },
  },
});
