/**
 * TODA TELA DIZ ONDE ESTÁ — F29 (Fase 5a). Era "toda tela tem volta" (F17.33).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A HISTÓRIA DESTE TESTE
 *
 *   F17.33. O pedido foi *"cada tela aberta precisa ter um voltar para
 *   anterior"*. Contado antes da etapa: dezenove telas, DUAS com saída
 *   própria. O conserto foi pôr um `‹ Voltar` nas duas molduras por onde as
 *   telas passam, e este teste (então `toda-tela-tem-volta.test.ts`) guardava
 *   a decisão: tela nova que esquecesse o voltar fazia a prova cair.
 *
 *   F29, 23/09. O Wesley disse que o Voltar CONFUNDIA: com histórico ele fazia
 *   "anterior", sem histórico fazia "acima", e o botão escrito `‹ Voltar` não
 *   dizia qual dos dois — ninguém sabia para onde ia antes de ir. A escolha
 *   dele (opção A): **a trilha substitui o Voltar**. Cada saída diz, pelo
 *   nome, para onde leva. A Fase 4 trocou oito telas; a Fase 5a, o resto, e
 *   tirou o Voltar das molduras.
 *
 *   Então a regra que este teste guarda mudou de "toda tela tem um botão de
 *   voltar" para "toda tela diz onde está" (decisão 7 do plano F29):
 *
 *     · tela COM SESSÃO → passa por `PaginaLarga` e desenha o `Topo`
 *       (`@/ui/Topo`: trilha + título + ações). A barra lateral é a navegação
 *       entre as telas principais; quem cobra a barra é
 *       `toda-tela-tem-barra.test.ts`;
 *     · tela de DETALHE (ficha do cliente, da tarefa, quadro, pasta, espaço,
 *       ranking e relatório da Meta, convite) → o `Topo` traz TRILHA, e o
 *       degrau acima dela tem endereço — é a saída com nome;
 *     · tela SEM SESSÃO → saída nomeada (`‹ Entrada`), ou é a própria entrada.
 *
 * ELE LÊ O FONTE, e não a tela desenhada. É a mesma técnica de
 * `nada-de-sql-na-tela.test.ts`: barato, e pega o esquecimento na origem.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `fileURLToPath`, e não `new URL(...).pathname`: o caminho deste repositório
// tem espaço no nome, e o segundo o devolve com `%20`. É a mesma linha de
// `nada-de-sql-na-tela.test.ts`.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TELAS = join(RAIZ, 'src', 'pages');

const arquivos = readdirSync(TELAS).filter((f) => f.endsWith('.tsx'));
const ler = (f: string) => readFileSync(join(TELAS, f), 'utf8');

/** O fonte sem comentários — eles citam, pelo nome, o que saiu. */
const semComentario = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Cada `<Topo …/>` do arquivo, inteiro. Conta as chaves: o `/>` da `Trilha`
 * que mora DENTRO da prop `trilha={…}` está em profundidade maior que zero, e
 * não fecha o topo.
 */
function topos(fonte: string): string[] {
  const achados: string[] = [];
  let de = fonte.indexOf('<Topo');
  while (de !== -1) {
    let fundo = 0;
    let i = de;
    for (; i < fonte.length; i += 1) {
      const c = fonte[i];
      if (c === '{') fundo += 1;
      else if (c === '}') fundo -= 1;
      else if (fundo === 0 && c === '/' && fonte[i + 1] === '>') break;
    }
    achados.push(fonte.slice(de, i + 2));
    de = fonte.indexOf('<Topo', i);
  }
  return achados;
}

/**
 * As telas que se abrem SEM CRACHÁ — as mesmas quatro de
 * `toda-tela-tem-barra.test.ts`, pela mesma razão: não há sessão, e portanto
 * não há barra nem topo de trabalho.
 */
const SEM_SESSAO = ['Ativar.tsx', 'Entrar.tsx', 'NaoEncontrado.tsx', 'Redefinir.tsx'];

/**
 * As telas que são DETALHE de outra — as que têm um "acima" com nome. O resto
 * das telas com sessão é tela PRINCIPAL: só o título, e a barra leva entre
 * elas (Fase 4: uma trilha `Meu trabalho › Minhas tarefas` só repetia o
 * título, e nenhum degrau levava a lugar nenhum).
 *
 * ⚠️ `Contas.tsx` (a tela `Convidar`) entrou aqui na Fase 5a sem estar na
 * lista do plano: chega-se a ela pelo `Convidar alguém` de Pessoas, as duas
 * são da mesma área, e sem trilha a única saída seria o menu da conta.
 */
const DETALHE: Record<string, string> = {
  'Cliente.tsx': '/painel',
  'Contas.tsx': '/pessoas',
  'Espaco.tsx': '/quadro',
  'MetaRanking.tsx': '/meta',
  'MetaRelatorio.tsx': '/meta',
  'Pasta.tsx': '/quadro',
  'Quadro.tsx': '/quadro',
  'Tarefa.tsx': '/quadro',
};

const comSessao = arquivos.filter((f) => !SEM_SESSAO.includes(f));

describe('as telas', () => {
  it('são vinte e três — uma a menos desde a F43 (Fase 4)', () => {
    // Se este número mudar, a etapa que acrescentou a tela precisa passar por
    // aqui de propósito, e não por acidente.
    //
    // Foram dezenove até a F17.45. A vigésima é a `Caixa de entrada` da F17.46;
    // a vigésima primeira, o QUADRO DA PASTA da F17.64; a vigésima segunda,
    // `/conexoes` da F16.9b; a vigésima terceira, `/chat` da F20.5; a
    // vigésima quarta, o Controle da semana da F40. F43 Fase 4: `Calendario.tsx` saiu — o
    // calendário é a visão Calendário do Planejamento, e `/calendario` só
    // desvia para lá (não é tela: não tem barra nem topo, e mora fora daqui).
    expect(arquivos.length).toBe(23);
  });

  it('as listas desta prova só contêm telas que existem', () => {
    // Sem isto, uma tela renomeada deixaria a regra órfã — e a tela nova
    // passaria a não ser cobrada sem ninguém perceber.
    for (const nome of [...SEM_SESSAO, ...Object.keys(DETALHE)]) {
      expect(arquivos, `${nome} está numa lista mas não existe`).toContain(nome);
    }
  });
});

describe('toda tela com sessão diz onde está', () => {
  it.each(comSessao)('%s passa por `PaginaLarga` e desenha o `Topo`', (arquivo) => {
    const fonte = semComentario(ler(arquivo));
    expect(fonte, `${arquivo} não passa pela moldura larga`).toMatch(/<PaginaLarga[\s>]/);
    // A moldura estreita é das telas sem sessão (entrar, ativar, redefinir).
    expect(fonte, `${arquivo} usa a moldura das telas sem sessão`).not.toMatch(/<Pagina[\s>]/);
    // O topo, e com título: é ele que diz "onde estou".
    const ts = topos(fonte);
    expect(ts.length, `${arquivo} não desenha o \`Topo\``).toBeGreaterThan(0);
    for (const t of ts) expect(t, `${arquivo}: \`Topo\` sem título`).toMatch(/\btitulo=/);
    // CADA moldura desenha o topo — inclusive a de "carregando" e a de erro.
    // Sem isto bastava UM `<Topo` no arquivo: um retorno cedo com a moldura e
    // uma frase (o que a ficha do cliente era até a F29) passava na prova e
    // deixava a tela sem saída justamente quando a leitura falha.
    const molduras = fonte
      .split('<PaginaLarga')
      .slice(1)
      .map((resto) => resto.slice(0, resto.indexOf('</PaginaLarga>')));
    for (const m of molduras) {
      expect(m, `${arquivo}: uma \`PaginaLarga\` sem o \`Topo\` dentro`).toMatch(/<Topo[\s/>]/);
    }
  });

  it.each(Object.entries(DETALHE))(
    '%s é detalhe: o topo traz trilha, e ela sobe para %s',
    (arquivo, acima) => {
      const fonte = semComentario(ler(arquivo));
      for (const t of topos(fonte)) {
        expect(t, `${arquivo}: \`Topo\` sem trilha`).toMatch(/\btrilha=/);
        // `null` é permitido: é a linha RESERVADA enquanto a ficha não chega
        // (Topo, "três estados da trilha"). Mas então a tela tem de desenhar
        // a trilha de verdade em algum lugar — cobrado abaixo.
      }
      expect(fonte, `${arquivo} não desenha a \`Trilha\``).toMatch(/<Trilha[\s/>]/);
      // O degrau acima tem endereço — é a saída com NOME que substitui o
      // Voltar. As telas da árvore o têm pela raiz (`Compartilhado comigo` →
      // `/quadro`, em `@/board/trilha`); as outras, por `trilhaDeDetalhe`.
      if (acima === '/quadro') {
        expect(fonte).toMatch(/\btrilha(DoQuadro|DaPasta|DoEspaco|DaTarefa)\(/);
      } else {
        expect(fonte).toMatch(/\btrilhaDeDetalhe\(/);
        expect(fonte).toContain(`destino: '${acima}'`);
      }
    },
  );
});

describe('as telas sem sessão têm saída com nome — ou são a entrada', () => {
  it('Ativar e Redefinir saem para a Entrada, pelo nome, em todos os estados', () => {
    for (const arquivo of ['Ativar.tsx', 'Redefinir.tsx']) {
      const fonte = semComentario(ler(arquivo));
      const paginas = fonte.match(/<Pagina\b[^>]*>/g) ?? [];
      expect(paginas.length, arquivo).toBeGreaterThan(0);
      for (const p of paginas) expect(p, `${arquivo}: \`Pagina\` sem saída`).toMatch(/\bsaida=/);
      expect(fonte).toMatch(/rotulo: 'Entrada', para: '\/'/);
    }
  });

  it('o 404 aponta para a entrada com o nome dela no texto do link', () => {
    // `Voltar para a entrada` NÃO é o Voltar que confundia: ele diz o lugar.
    const fonte = semComentario(ler('NaoEncontrado.tsx'));
    expect(fonte).toMatch(/<Link to="\/"[^>]*>\s*Voltar para a entrada\s*<\/Link>/);
    // F15: com sessão, a saída é o Painel — o destino de quem acabou de entrar
    // —, também pelo nome. Nada redireciona sozinho.
    expect(fonte).toMatch(/<Link to="\/painel"[^>]*>\s*Ir para o Painel\s*<\/Link>/);
    expect(fonte).not.toMatch(/\bnavigate\(|<Navigate\b/);
  });

  it('a entrada não tem saída: ela É o começo', () => {
    expect(semComentario(ler('Entrar.tsx'))).not.toMatch(/\bsaida=/);
  });
});

describe('o Voltar saiu — e não volta por outra porta', () => {
  it('as molduras não desenham o Voltar', () => {
    const primitivos = readFileSync(join(RAIZ, 'src', 'ui', 'primitivos.tsx'), 'utf8');
    expect(primitivos).not.toMatch(/import \{ Voltar \}/);
    expect(semComentario(primitivos)).not.toMatch(/<Voltar[\s/>]/);
  });

  it('só a ficha da tarefa usa a peça — e é o X', () => {
    const usam = arquivos.filter((f) => /<Voltar[\s/>]/.test(semComentario(ler(f))));
    expect(usam).toEqual(['Tarefa.tsx']);
  });

  it('nenhuma tela guarda um voltar à mão', () => {
    // As três formas de antes da F17.33: `← Voltar ao painel` (Cliente),
    // `← painel` (Calendario) e `← Quadro` (Tarefa). E as da F17.x que a F29
    // tirou: o `‹ Painel`, `‹ Contas` e `‹ Sistema IDE` montados com a seta
    // `IconeEsquerda` num `Link` do cabeçalho.
    for (const arquivo of arquivos) {
      const fonte = semComentario(ler(arquivo));
      expect(fonte, `${arquivo} ainda tem uma seta de voltar à mão`).not.toMatch(
        /←\s*(Voltar|painel|Quadro)/,
      );
      expect(fonte, `${arquivo} ainda tem um \`‹ lugar\` à mão`).not.toMatch(
        /<Link[^>]*>\s*<IconeEsquerda\s*\/>/,
      );
    }
  });
});
