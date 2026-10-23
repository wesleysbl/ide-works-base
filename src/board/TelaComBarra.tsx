/**
 * A MOLDURA QUE VESTE A BARRA LATERAL — etapa F17.67.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA EXISTE: DEZ TELAS ESQUECERAM A MESMA PEÇA
 *
 *   Contado antes desta etapa: das dezessete telas com sessão, SETE desenhavam
 *   a barra lateral e DEZ não. E não foram dez descuidos — era a mesma linha de
 *   montagem repetida à mão sete vezes:
 *
 *     import '@/ui/quadro.css';                 ← a grade
 *     import '@/ui/clickup.css';                ← a pintura da barra
 *     const [prefs] = usePreferencias();        ← a forma escolhida
 *     <div className="q-tela" data-barra={prefs.aparencia}>
 *       <BarraLateral atual="…" />
 *       <div className="min-w-0">…</div>
 *     </div>
 *
 *   Cinco decisões para lembrar, em cada tela nova. A F17.62 mediu o preço de
 *   esquecer UMA delas: sem `quadro.css`, a barra apareceu DEITADA na ficha do
 *   cliente — 1.366 px de largura, com o conteúdo empurrado 892 px para baixo.
 *   Ela vinha pintada (o `clickup.css` chegava de carona por outro import) mas
 *   sem grade. Um erro que não dá erro, e que só uma medição no navegador pega.
 *
 *   Aqui as cinco decisões viram UMA linha na tela que chama. A próxima tela
 *   não tem como esquecer metade da receita, porque não há metade para lembrar.
 *
 * ⚠️ POR QUE A BARRA NÃO FOI PARA DENTRO DE `PaginaLarga`, QUE SERIA A RAIZ
 *
 *   Era a saída óbvia — a moldura por onde dezenove telas passam já é dona do
 *   `Voltar` (F17.33), pelo mesmo argumento. Ela foi MEDIDA e recusada:
 *
 *   1. NAS SETE TELAS QUE JÁ TÊM A BARRA, O CABEÇALHO FICA ACIMA DA GRADE, em
 *      largura inteira — `<PaginaLarga>` → `<header>` → `<div class="q-tela">`.
 *      Com a barra dentro da moldura, o cabeçalho passaria a ser irmão da barra
 *      ou filho da coluna de conteúdo: nos dois casos o título de sete telas em
 *      produção muda de lugar. A etapa é sobre a barra, não sobre o cabeçalho.
 *
 *   2. `PaginaLarga` TAMBÉM DESENHA TELA SEM SESSÃO — `NaoEncontrado` passa por
 *      ela, e ali a barra buscaria a árvore para quem não tem crachá.
 *
 *   3. O `data-altura="tela"` da F17.27 é do QUADRO e da PASTA, não da moldura.
 *
 *   Fica a dívida escrita, e ela é pequena agora: as sete telas antigas montam
 *   à mão o que esta peça monta. Migrá-las é mexer em sete telas em produção
 *   para não mudar nada visível — troca ruim nesta etapa, troca boa numa etapa
 *   que já for mexer nelas. `Pasta` e `Quadro` passam `data-altura="tela"`, que
 *   esta peça aceita, então a migração não pede código novo.
 *
 *   ⚠️ F29 (Fase 4): O ITEM 1 DEIXOU DE VALER PARA OITO TELAS. A etapa agora
 *   É sobre o cabeçalho: o `‹ Voltar` saiu (a trilha o substitui), a marca foi
 *   para o alto da barra, e o topo (`@/ui/Topo`) passou para DENTRO da coluna
 *   de conteúdo — a barra começa no alto da janela, com o topo ao lado dela.
 *   Quem usa esta peça passa o `Topo` como primeiro filho; quem monta a grade
 *   à mão faz o mesmo. Na Fase 5a o resto das telas migrou (Painel,
 *   Calendário, Planejamento, Pessoas, Catálogos, Conexões, Convidar e as
 *   três da Meta), e a ficha do cliente trocou a grade à mão por esta peça:
 *   não há mais cabeçalho acima da grade em tela nenhuma.
 *
 *   ⚠️ F04 (plano UX, 28/09/2026): A DÍVIDA FOI PAGA. As seis telas que
 *   ainda montavam a grade à mão — Minhas tarefas, Todas as tarefas,
 *   Notificações, Espaço, Pasta e Quadro — passaram por esta peça. O que era
 *   especial em cada uma virou prop: `arvore` e `listaAtiva` (a árvore pronta
 *   das três telas de quadro), `naoVistos` (o contador das notificações),
 *   `altura` (a cadeia do quadro e da pasta) e `classeDoConteudo` (Minhas
 *   tarefas pinta as linhas por `.iw-trabalho`). Os avisos de erro, que
 *   ficavam ACIMA da grade em largura inteira, desceram para a coluna de
 *   conteúdo, logo abaixo do topo.
 *
 *   O QUE GUARDA A DECISÃO:
 *   `test/toda-tela-tem-barra.test.ts`. Ele lê o fonte de `src/pages` e falha
 *   quando uma tela com sessão nasce sem barra — do jeito que
 *   `toda-tela-diz-onde-esta.test.ts` faz com o topo (até a F29, com o botão
 *   de voltar). É a peça que vale
 *   mais que as dez correções: as correções são de hoje, o teste é da próxima.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type ReactNode } from 'react';

import { BarraLateral } from '@/board/BarraLateral';
import { useComposicaoDoShell } from '@/board/secao-recolhivel';
import { type ContextoDoShell, contextoDoItem } from '@/ui/preferencias';
/*
 * ⚠️ AS DUAS FOLHAS MORAM AQUI, E É O PONTO DA PEÇA.
 *
 * `.q-tela` (a grade de duas colunas) está em `quadro.css`; `.bl-barra` (a
 * pintura) está em `clickup.css`. Nenhuma das duas é global — cada tela as
 * importava. Com a moldura sendo a dona, importar a moldura já traz o que ela
 * precisa para não deitar. Ver o defeito medido no cabeçalho.
 */
import '@/ui/quadro.css';
import '@/ui/clickup.css';

export function TelaComBarra({
  atual,
  contexto,
  altura,
  arvore,
  listaAtiva = null,
  naoVistos,
  classeDoConteudo,
  children,
}: {
  /**
   * Qual item da barra está aberto agora — o que ganha o fundo.
   *
   * OPCIONAL, e a ausência é uma resposta — F17.67. Telas como `Catálogos`,
   * `Pessoas` e a ficha da tarefa não SÃO nenhum dos sete itens da barra.
   * Marcar um deles ali seria a barra dizendo que a pessoa está num lugar onde
   * ela não está — e o mapa que mente é pior que o mapa ausente, que é o
   * defeito desta etapa. Sem `atual`, nenhum item fica aceso.
   */
  atual?: Parameters<typeof BarraLateral>[0]['atual'];
  /**
   * O tipo de tela — F02: trabalho, entrega, chat ou administração. Decide o
   * mínimo de largura do conteúdo antes de a navegação ceder. Ausente, vem do
   * item aceso (`contextoDoItem`): chat → chat, painel/calendário/planejamento
   * → entrega, o resto → trabalho — o comportamento de antes.
   */
  contexto?: ContextoDoShell;
  /** `tela` abre a cadeia de altura da F17.27 — hoje só o quadro e a pasta. */
  altura?: 'tela';
  /** A árvore já montada, quando a página a carregou para si. Ver `BarraLateral`. */
  arvore?: ReactNode;
  listaAtiva?: string | null;
  naoVistos?: number;
  /**
   * Classe a mais na coluna de conteúdo — F04. `Minhas tarefas` pinta as
   * linhas por `.iw-trabalho`; ela vai NA coluna, e não num embrulho dentro
   * dela, para a migração não acrescentar um nível que a cadeia de altura
   * (`.q-conteudo > *`) e as medidas dos testes enxergariam.
   */
  classeDoConteudo?: string;
  children: ReactNode;
}) {
  /* A forma da barra é escolha da pessoa e vale em TODA tela que a desenha —
     ver `data-barra` em `ui/clickup.css`. F02: o que se desenha é a escolha
     ADAPTADA ao espaço da grade (`useComposicaoDoShell`); a escolha guardada
     não muda. */
  const shell = useComposicaoDoShell(contexto ?? contextoDoItem(atual));
  return (
    <div className="q-tela" ref={shell.ref} {...shell.atributos} data-altura={altura}>
      <BarraLateral
        atual={atual}
        arvore={arvore}
        listaAtiva={listaAtiva}
        naoVistos={naoVistos}
        composicao={shell.composicao}
      />
      {/* `q-conteudo` tem NOME porque a cadeia de altura da F17.27 precisa
          apontar para a coluna de conteúdo; `min-w-0` porque sem o mínimo zero
          uma tabela larga empurra a grade e a rolagem vaza para a página. */}
      <div className={'q-conteudo min-w-0' + (classeDoConteudo ? ` ${classeDoConteudo}` : '')}>
        {children}
      </div>
    </div>
  );
}
