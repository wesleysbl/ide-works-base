/**
 * O TOPO DAS TELAS — F29 (decisão 6 do plano).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   O `‹ Voltar` da F17.33 confundia (Wesley, 23/09): às vezes ele fazia
 *   "anterior" (o histórico), às vezes "acima" (o pai), e o botão não dizia
 *   qual. Quem clicava não sabia para onde ia antes de ir. A escolha dele foi a
 *   opção A: **a trilha substitui o Voltar** — cada saída diz, pelo nome, para
 *   onde leva.
 *
 * O QUE ESTA PEÇA DESENHA, E SÓ ISSO
 *   · a TRILHA (opcional) — onde se está, degrau por degrau, cada degrau com o
 *     nome do lugar a que leva. É a mesma `Trilha` da F17.25; ela chega PRONTA,
 *     montada por quem chama;
 *   · o TÍTULO — o nome da tela, num `<h1>`;
 *   · as AÇÕES — o que é da página (o X da ficha da tarefa, o Novo cliente e o
 *     período do Painel…), à direita; embaixo do título quando não cabem.
 *
 *   Sem Voltar e sem a marca "ide": a marca mora no alto da barra lateral desde
 *   a F29.1, e escrevê-la aqui de novo seria a mesma marca duas vezes na mesma
 *   altura da tela.
 *
 * ⚠️ POR QUE A TRILHA CHEGA MONTADA, E NÃO COMO LISTA DE DEGRAUS
 *   `Trilha` mora em `@/board`, e este arquivo é de `@/ui`. Importá-la aqui
 *   inverteria a dependência — é o mesmo motivo por que o `?` de `Rotulo` chega
 *   pronto em `@/ui/primitivos`. E a trilha do quadro precisa de coisas que só
 *   a página sabe (revelar o nó na árvore ao lado, lembrar que o meio foi
 *   aberto); a peça montada as traz consigo.
 *
 * TRÊS ESTADOS DA TRILHA, E O TERCEIRO EXISTE POR UM SALTO
 *   · `undefined` — tela principal (Chat, Minhas tarefas…): só o título. A
 *     barra é a navegação entre elas, e não há "acima" para dizer.
 *   · um nó — a trilha, desenhada.
 *   · `null` — a trilha AINDA NÃO CHEGOU (a ficha da tarefa antes do banco
 *     responder). A linha fica reservada, vazia: sem isso o título desceria
 *     vinte pixels meio segundo depois de a tela desenhar — o mesmo salto que a
 *     F17.33 tirou do Voltar da ficha.
 *
 * ONDE ELA MORA NA TELA
 *   No topo da COLUNA DE CONTEÚDO, à direita da barra — e não acima da grade,
 *   onde o cabeçalho antigo morava. Com a marca e o botão de recolher no alto
 *   da barra (F29.1), a barra começa no topo da janela como a do Claude que o
 *   Wesley mostrou, e o topo da página começa na mesma linha, ao lado dela. Ver
 *   `PaginaLarga` (`@/ui/primitivos`), que dá a folga de cima.
 *
 * QUEM GUARDA A REGRA
 *   `test/toda-tela-diz-onde-esta.test.ts` (F29, Fase 5a): toda tela com
 *   sessão desenha este topo, e toda tela de detalhe traz trilha.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type ReactNode } from 'react';

import { useTituloDoDocumento } from '@/ui/titulo-do-documento';

export function Topo({
  titulo,
  trilha,
  acoes,
  className = '',
  variante = 'pagina',
  marca,
  junto,
  tituloDaAba,
}: {
  /** O nome da tela. É o `<h1>` da página. */
  titulo: string;
  /**
   * O que a aba diz, quando o `<h1>` sozinho não distingue a tela (a ficha da
   * tarefa, cujo `<h1>` é "Tarefa" para todas). Sem isto vale o `titulo`.
   */
  tituloDaAba?: string;
  /**
   * A `Trilha` montada. `undefined` = tela principal, sem trilha; `null` = ela
   * ainda não chegou, e a linha fica reservada. Ver o cabeçalho.
   */
  trilha?: ReactNode;
  /** O que é desta página, à direita do título. */
  acoes?: ReactNode;
  /** Classe a mais — a ficha da tarefa passa `t-cabeca`, que gruda no topo. */
  className?: string;
  /**
   * F03 do plano UX — duas alturas, uma hierarquia.
   *   `pagina` (padrão): o título com presença (`--iw-t-titulo`, 18→22 px), a
   *     trilha discreta em cima, as ações à direita — e, no celular, numa
   *     linha própria embaixo, sem cortar. O nome QUEBRA em vez de truncar:
   *     é a resposta a "onde estou", e reticências a escondem.
   *   `compacta`: para áreas de ALTURA FIXA (ficha que gruda, chat), onde cada
   *     pixel do cabeçalho é um pixel a menos de trabalho. Título menor
   *     (`--iw-t-secao`), uma linha com reticências, o fio embaixo porque o
   *     conteúdo rola por baixo dele. Continua sendo o `<h1>` e o alvo do
   *     "Pular para o conteúdo" — muda o tamanho, não o papel.
   */
  variante?: 'pagina' | 'compacta';
  /**
   * F06A — o sinal ANTES do nome (a marca do espaço, o ícone da pasta ou do
   * quadro). Fica fora do `<h1>`: a marca do espaço escreve a inicial, e ela
   * não pode virar parte do nome que o leitor de tela ouve.
   */
  marca?: ReactNode;
  /**
   * F06A — o que mora NA LINHA do nome, depois dele: o cliente da lista, o
   * selo de arquivada. É identidade, não ação — as ações ficam em `acoes`.
   */
  junto?: ReactNode;
}) {
  // O título da ABA acompanha o da tela — WCAG 2.4.2. Ver `@/ui/titulo-do-documento`.
  useTituloDoDocumento(tituloDaAba ?? titulo);
  return (
    <header
      className={
        // `o-topo` tem NOME, como `q-conteudo`: é por ele que a suíte e as
        // provas no navegador acham o topo sem depender da ordem do HTML.
        //
        // `flex-wrap` — F29 (Fase 5a). As telas do resto do sistema trazem
        // ações de verdade (o Painel: Novo cliente e o período; a ficha do
        // cliente: urgência, chaves, editar, anterior e próximo). Em 390 px
        // elas não cabem ao lado do título, e sem quebrar de linha empurrariam
        // a página para o lado. Quebrando, descem para a linha de baixo.
        //
        // `items-start` — F29.5b. Com `items-center` o título descia junto com
        // a altura das AÇÕES: o `<h1>` do Painel (Novo cliente e o período)
        // ficava 8 px abaixo do do Chat (sem ação nenhuma), e o nome da tela
        // pulava de altura a cada clique na barra. Agora o título mora sempre
        // no alto da linha; quem se centra são as ações (ver abaixo).
        'o-topo mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2' +
        (className ? ` ${className}` : '')
      }
      /* O ALVO DO "PULAR PARA O CONTEÚDO" — F29 (Fase 5a). O link é o primeiro
         item da barra (`BarraLateral`) e leva o foco para cá: sem o Voltar, a
         primeira saída do topo ficou a ~250 Tabs, porque a árvore vem antes no
         HTML. `-1` porque o topo recebe foco por ESTE caminho, e não pelo Tab —
         ele não é um controle. Um topo por tela, então um `id` por tela. */
      id="conteudo"
      tabIndex={-1}
      data-variante={variante === 'compacta' ? 'compacta' : undefined}
    >
      {/* `min-w-0` porque a trilha mede se cabe (`TrilhaDoLugar`): sem o
          mínimo zero a caixa cresceria com ela, a medição diria sempre "cabe",
          e a trilha longa empurraria a página para o lado em vez de encurtar.

          A base de 12rem é o que decide a QUEBRA de linha: com base zero o
          título nunca empurraria as ações para baixo — ele encolheria até
          sumir ao lado delas. Com 12rem, ações que não cabem ao lado de um
          título legível descem. */}
      <div className="min-w-0 flex-[1_1_12rem]">
        {trilha !== undefined && (
          <div className="o-topo-trilha min-h-[1.4rem]">{trilha}</div>
        )}
        {marca === undefined && junto === undefined ? (
          <h1 className="o-titulo">{titulo}</h1>
        ) : (
          <div className="o-topo-nome">
            {marca}
            <h1 className="o-titulo">{titulo}</h1>
            {junto}
          </div>
        )}
      </div>
      {/* Sem `shrink-0` desde a F29 (Fase 5a): numa linha só dela, uma fila de
          ações mais larga que a tela quebra por dentro em vez de vazar.

          `self-center` — F29.5b: o topo alinha pelo alto, mas as ações
          continuam centradas na linha. Mais altas que o título, elas SÃO a
          linha, e o centro é o alto; mais baixas (o X da ficha, ao lado de
          trilha + título), ficam no meio do bloco, onde sempre estiveram. */}
      {acoes && <div className="o-topo-acoes flex min-w-0 flex-wrap items-center gap-2 self-center">{acoes}</div>}
    </header>
  );
}
