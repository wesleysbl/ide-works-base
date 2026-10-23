/**
 * TODA TELA COM SESSÃO TEM BARRA LATERAL — F17.67.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE TESTE EXISTE
 *
 *   A equipe, em produção: *"quando entra na tela do cliente, some a tela
 *   lateral"*. A F17.62 consertou a ficha do cliente e deixou escrito, no
 *   commit, que `/painel`, `/calendario` e `/planejamento` continuavam sem.
 *
 *   ⚠️ CONTADO NA F17.67: NÃO ERAM TRÊS TELAS, ERAM DEZ. Das dezessete telas
 *   com sessão, SETE desenhavam a barra e DEZ não — `Painel`, `Calendário`,
 *   `Planejamento`, `Catálogos`, `Contas`, `Pessoas`, a ficha da tarefa e as
 *   três da Meta. Foi CONTANDO que se descobriu; a estimativa errou por sete.
 *
 *   Dez telas não esquecem a mesma peça por dez descuidos. Esqueciam porque
 *   cada tela montava a moldura à mão — duas folhas de estilo, a leitura da
 *   preferência, a grade e a coluna de conteúdo, cinco decisões por tela. A
 *   etapa juntou as cinco em `@/board/TelaComBarra`, e este teste guarda o
 *   resultado: a PRÓXIMA tela com sessão não nasce sem mapa.
 *
 * ELE LÊ O FONTE, e não a tela desenhada — mesma técnica, e mesmo motivo, de
 * `toda-tela-diz-onde-esta.test.ts` (F17.33, antes `toda-tela-tem-volta`) e
 * `nada-de-sql-na-tela.test.ts`:
 * barato, e pega o esquecimento na origem em vez de meses depois em produção.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// `fileURLToPath`, e não `new URL(...).pathname`: o caminho deste repositório
// tem espaço no nome, e o segundo o devolve com `%20`.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const TELAS = join(RAIZ, 'src', 'pages');

const arquivos = readdirSync(TELAS).filter((f) => f.endsWith('.tsx'));
const ler = (f: string) => readFileSync(join(TELAS, f), 'utf8');

/**
 * As telas que NÃO têm barra, e a razão de cada uma. São todas as que se abrem
 * SEM CRACHÁ — a barra ali buscaria a árvore de quem não tem sessão, e mostraria
 * a moldura do trabalho a quem ainda não entrou nele.
 *
 * ⚠️ ACRESCENTAR NOME AQUI É DECISÃO, NÃO CONSERTO. Uma tela com sessão que
 * caia nesta lista para o teste passar desfaz a etapa inteira em silêncio. Se
 * uma tela nova precisar entrar, a razão vem escrita ao lado, como estas quatro.
 */
const SEM_BARRA: Record<string, string> = {
  'Entrar.tsx': 'a porta — não há sessão, e portanto não há árvore para mostrar',
  'Ativar.tsx': 'ativação por código: a pessoa ainda não é ninguém no sistema',
  'Redefinir.tsx': 'senha nova com o código na mão (F17.31) — também sem crachá',
  'NaoEncontrado.tsx':
    'o 404 responde a qualquer endereço, inclusive para quem não entrou; e ele ' +
    'aponta para a entrada, que é a saída certa de quem chegou a um lugar que não existe',
};

describe('a barra lateral', () => {
  it('as telas são vinte e três — o mesmo número que a régua do topo conta', () => {
    // Se este número mudar, a etapa que acrescentou a tela precisa passar por
    // aqui de propósito, e não por acidente. É a mesma trava de
    // `toda-tela-diz-onde-esta.test.ts` (a régua do voltar até a F29), pelo
    // mesmo motivo.
    //
    // F43 Fase 4: eram vinte e quatro. `Calendario.tsx` saiu — o calendário
    // virou a terceira visão do Planejamento (`@/painel/CalendarioGeral`), e
    // `/calendario` é um desvio para lá (`@/painel/CalendarioAntigo`), que não
    // é tela e mora fora de `src/pages`.
    expect(arquivos.length).toBe(23);
  });

  it('a lista de exceções só contém telas que existem', () => {
    // Sem isto, uma tela renomeada deixaria a exceção órfã — e a tela nova
    // passaria a ser cobrada sem ninguém perceber que a razão ficou para trás.
    for (const nome of Object.keys(SEM_BARRA)) {
      expect(arquivos, `${nome} está na lista de exceções mas não existe`).toContain(nome);
    }
  });

  it.each(arquivos.filter((f) => !(f in SEM_BARRA)))('%s desenha a barra', (arquivo) => {
    const fonte = ler(arquivo);
    // Ou pela moldura da F17.67, que traz grade, folhas e preferência juntas…
    const naMoldura = /<TelaComBarra[\s/>]/.test(fonte);
    // …ou à mão, que é como as sete telas anteriores à etapa a montam.
    const aMao = /<BarraLateral[\s/>]/.test(fonte);
    expect(
      naMoldura || aMao,
      `${arquivo} tem sessão e não desenha a barra lateral — quem entra nela perde o mapa`,
    ).toBe(true);
  });

  /**
   * ⚠️ A REGRA QUE A F17.62 PAGOU PARA APRENDER.
   *
   * `.q-tela` (a grade) mora em `quadro.css` e `.bl-barra` (a pintura) mora em
   * `clickup.css`. NENHUMA das duas é global. Na ficha do cliente, `clickup.css`
   * chegava de carona por outro import e `quadro.css` não chegava: a barra
   * apareceu DEITADA — 1.366px de largura, com o conteúdo empurrado 892px para
   * baixo. Barra pintada sem grade não dá erro nenhum; só fica errada.
   */
  it.each(arquivos.filter((f) => /<BarraLateral[\s/>]/.test(ler(f))))(
    '%s monta a barra à mão e traz as DUAS folhas com ela',
    (arquivo) => {
      const fonte = ler(arquivo);
      expect(fonte, `${arquivo} desenha a barra sem a grade — ela vai deitar`).toMatch(
        /className="q-tela"/,
      );
      for (const folha of ['@/ui/quadro.css', '@/ui/clickup.css']) {
        expect(fonte, `${arquivo} desenha a barra sem importar ${folha}`).toContain(
          `import '${folha}'`,
        );
      }
    },
  );

  /* F04 do plano UX: A DÍVIDA FOI PAGA. As seis telas que montavam a grade à
     mão (Minhas tarefas, Todas, Notificações, Espaço, Pasta e Quadro)
     passaram para a moldura — uma regra de shell que mude nela chega a todas.
     Montar a barra à mão de novo é o caminho de volta ao UX10: falha aqui. */
  it('nenhuma tela monta a barra à mão — todas passam pela moldura (F04)', () => {
    const aMao = arquivos.filter((f) => /<BarraLateral[\s/>]/.test(ler(f)));
    expect(aMao, 'use <TelaComBarra> (props arvore, listaAtiva, naoVistos, altura, classeDoConteudo)').toEqual([]);
  });

  it('a moldura da etapa carrega as duas folhas, para que a tela nova não precise', () => {
    const moldura = readFileSync(join(RAIZ, 'src', 'board', 'TelaComBarra.tsx'), 'utf8');
    for (const folha of ['@/ui/quadro.css', '@/ui/clickup.css']) {
      expect(moldura).toContain(`import '${folha}'`);
    }
    // E a grade, que é o que faltava na F17.62.
    expect(moldura).toMatch(/className="q-tela"/);
  });
});
