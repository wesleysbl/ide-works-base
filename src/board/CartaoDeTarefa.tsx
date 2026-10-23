import { textoDasMencoes } from '@/board/mencoes';
import { varsDaEtiqueta } from '@/board/tinta-da-etiqueta';
import { SeloDoTipo } from '@/board/SeletorDoTipo';
import { TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * O CORPO do cartão — extraído do quadro na etapa F17.18.
 *
 * POR QUE ELE SAIU DE `pages/Quadro.tsx`
 *   `Todas as tarefas` (F17.18) também abre em quadro, e o cartão dela é o
 *   MESMO cartão: título, etiquetas, prioridade, prazo, os indicadores de
 *   descrição/anexo/conversa, as contagens de subtarefa e checklist, e os
 *   avatares.
 *
 *   Copiá-lo daria dois cartões parecidos, e eles divergiriam na primeira etapa
 *   que mexesse num só — o quadro da lista ganharia o campo personalizado da
 *   F17.5 e o de `Todas as tarefas` não, sem ninguém perceber.
 *
 * O QUE FICOU DE FORA, E ISSO É O DESENHO
 *   O `<li>` que ARRASTA continua em `pages/Quadro.tsx`. Aqui só há o conteúdo.
 *
 *   A separação não é estética: em `Todas as tarefas` o cartão NÃO se arrasta.
 *   Aquele quadro agrupa por TIPO de status, porque com nove esteiras ao
 *   alcance não existe uma coluna `a fazer` que signifique a mesma coisa em
 *   todas (ver `@/board/meu-trabalho`) — e soltar num tipo não diria em qual
 *   status daquela esteira a tarefa deve cair. Um cartão arrastável que não
 *   pode ser solto é um botão morto com gesto.
 *
 * COR
 *   Nenhuma literal. A do sistema sai de `var(--…)`; a da origem — a cor da
 *   etiqueta — entra como variável no próprio elemento (decisão D10).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import type { ListaNaArvore } from '@/board/arvore';
import {
  AVATARS_VISIVEIS,
  type BoardTask,
  type Day,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  type TreeSpace,
  initials,
} from '@/board/board';
import { LinkDaTarefa } from '@/board/LinkDaTarefa';
import { ComAncora, IconeBandeira, IconeMais, IconePessoa, MenuDeListas, MenuDePessoas } from '@/board/menus';
import { lerPrazo } from '@/board/prazo';
import { IconeRelogio } from '@/ui/Icones';
import { textoDaMiniatura, useMiniatura } from '@/board/miniaturas';
import type { ResponsavelDoCartao } from '@/board/responsavel-do-cartao';

import '@/ui/responsavel-no-cartao.css';
import '@/ui/urgente.css';

/* ───────────────────────────── os indicadores ───────────────────────────── */

const traco = (className?: string) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: className ?? 'h-4 w-4',
  'aria-hidden': true,
});

/** "Tem descrição". */
export const IconeTexto = ({ className }: { className?: string }) => (
  <svg {...traco(className)}>
    <path d="M5 7h14M5 12h14M5 17h8" />
  </svg>
);

/** O clipe de papel — "tem anexo". F17.6. */
export const IconeClipe = ({ className }: { className?: string }) => (
  <svg {...traco(className)}>
    <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.2-9.19a3.67 3.67 0 0 1 5.18 5.18l-9.2 9.2a1.83 1.83 0 0 1-2.59-2.6l8.5-8.49" />
  </svg>
);

/** O balão de fala — "tem conversa". F17.6. */
export const IconeBalao = ({ className }: { className?: string }) => (
  <svg {...traco(className)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
  </svg>
);

/* ───────────────────────────── os avatares ───────────────────────────── */

/* `readonly` porque a capa também desenha o conjunto OTIMISTA da F17.69, que
   nasce de um estado congelado e não pode ser reordenado por quem desenha. */
export function Avatares({ pessoas }: { pessoas: readonly BoardTask['assignees'][number][] }) {
  if (pessoas.length === 0) return null;
  const visiveis = pessoas.slice(0, AVATARS_VISIVEIS);
  const resto = pessoas.length - visiveis.length;

  return (
    /* `role="img"` com o nome: sem ele, quem ouve a tela escutaria "BN RM" —
       iniciais soltas — e quem toca não tem `title` para ler (F06B). */
    <span
      className="q-avatares"
      role="img"
      aria-label={`Responsáveis: ${pessoas.map((p) => p.name).join(', ')}`}
      title={pessoas.map((p) => p.name).join(', ')}
    >
      {visiveis.map((p) => (
        <span key={p.id} className="q-avatar">
          {initials(p.name)}
        </span>
      ))}
      {resto > 0 && (
        <span className="q-avatar" data-mais="true">
          +{resto}
        </span>
      )}
    </span>
  );
}

/* ─────────── definir responsável direto da capa do cartão — F17.69 ─────────── */

/**
 * O SELETOR DE RESPONSÁVEL NA CAPA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ POR QUE O ALVO SÃO AS INICIAIS, E NÃO O `···` NEM UM ÍCONE NOVO
 *
 *   1. As iniciais JÁ SIGNIFICAM "de quem é isto". Clicar no fato para mudar o
 *      fato é o gesto mais curto que existe, e é o do ClickUp. Um ícone novo ao
 *      lado delas seria um segundo lugar dizendo a mesma coisa — e a primeira
 *      pergunta de quem olha passaria a ser qual dos dois é o de clicar.
 *
 *   2. O `···` é `Mover para` (F17.63). Enfiar responsável lá dentro poria o
 *      gesto MAIS pedido a dois cliques de distância, atrás de um menu que fala
 *      de outra coisa.
 *
 *   ⚠️ MAS 1.313 DAS 1.843 TAREFAS NÃO TÊM RESPONSÁVEL — medido em 2026-09-04, e
 *   é o caso MAIS COMUM. Nelas não há iniciais para servir de alvo, e um gesto
 *   que só existe quando a coisa já está feita não serve para fazê-la. Por isso
 *   o cartão sem dono desenha um círculo tracejado com o ícone de pessoa: o
 *   mesmo lugar, o mesmo tamanho, a mesma tecla de `Tab`.
 *
 * ELE APARECE COMO O `···` APARECE
 *   Discreto em repouso, cheio ao passar o mouse, e SEMPRE visível quando está
 *   aberto ou com o foco — um alvo que só existe sob o ponteiro é inalcançável
 *   para quem navega pelo teclado. Mesma regra de `.q-cartao-acao`.
 *
 * O BALÃO PRECISA DE PORTAL, pelo mesmo motivo do `···`: `.q-cartao` ganha
 * `transform` no `:hover`, e `transform` cria contexto de empilhamento — um
 * balão preso aqui dentro abriria por baixo do cartão vizinho. `ComAncora` o
 * põe em `document.body`.
 *
 * ⚠️ O QUE ELE DESENHA É `responsavel.pessoas`, E NÃO `tarefa.assignees`. É a
 * capa otimista: ela mostra a escolha antes de o banco responder, e VOLTA
 * ATRÁS quando a escrita é recusada. Ver `@/board/responsavel-do-cartao`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function ResponsavelNaCapa({
  tarefa,
  responsavel,
}: {
  tarefa: BoardTask;
  responsavel: ResponsavelDoCartao;
}) {
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  const pessoas = responsavel.pessoas;
  const escolhidos = pessoas.map((p) => p.id);

  return (
    <span className="cu-ancora q-responsavel" data-fixo={responsavel.aberto}>
      <button
        ref={setAncora}
        type="button"
        className="q-responsavel-btn"
        data-vazio={pessoas.length === 0}
        /* O nome da tarefa entra no rótulo porque a coluna tem cinquenta
           destes — `Responsável` sozinho seria cinquenta botões com o mesmo
           nome para quem ouve a tela. Mesma razão do rótulo do `···`. */
        aria-label={
          pessoas.length === 0
            ? `Definir responsável por ${textoDasMencoes(tarefa.title)}`
            : `Alterar responsável por ${textoDasMencoes(tarefa.title)}: ${pessoas.map((p) => p.name).join(', ')}`
        }
        aria-haspopup="menu"
        aria-expanded={responsavel.aberto}
        disabled={responsavel.desativado}
        onClick={responsavel.aoAlternar}
      >
        {pessoas.length === 0 ? (
          <span className="q-avatar" data-vazio="true">
            <IconePessoa c="h-3 w-3" />
          </span>
        ) : (
          <Avatares pessoas={pessoas} />
        )}
      </button>

      {responsavel.aberto && (
        <ComAncora ancora={ancora}>
          <MenuDePessoas
            /* A MESMA peça que a ficha usa (F17.10): busca, marcar e desmarcar,
               `Eu` no topo. Um segundo seletor de gente divergiria do primeiro
               na primeira etapa que mexesse num só. */
            diretorio={responsavel.opcoes}
            escolhidos={escolhidos}
            meuId={responsavel.meuId}
            rotulo="Responsável"
            carregando={responsavel.carregando}
            lado="baixo-direita"
            aoMudar={responsavel.aoMudar}
            aoFechar={responsavel.aoFechar}
          />
        </ComAncora>
      )}
    </span>
  );
}

/* ───────────────────────────── a miniatura ───────────────────────────── */

/**
 * A ARTE DA TAREFA, no próprio cartão — F17.56.
 *
 * ⚠️ ELA SÓ EXISTE QUANDO O ENDEREÇO JÁ CHEGOU, e é isso que cumpre a régua da
 * etapa: cartão sem anexo não muda de altura nem cria buraco. Não há caixa
 * reservada, não há esqueleto cinza e não há espaço guardado — o que não tem
 * arte desenha exatamente o que desenhava antes desta etapa.
 *
 * O `<img>` NÃO ARRASTA (`draggable={false}`), pelo mesmo motivo dos links do
 * cartão: o `<li>` do quadro é que arrasta (F17.25), e imagem nasce arrastável
 * no navegador. Sem isto, puxar o cartão pela arte largaria uma IMAGEM em vez
 * de mover a tarefa de coluna.
 *
 * `loading="lazy"` e `decoding="async"`: a coluna mostra cinquenta cartões e a
 * F17.27 a fez rolar. Baixar e decodificar de uma vez o que ainda está fora da
 * tela é exatamente o que faria a rolagem engasgar.
 */
function Miniatura({ tarefa }: { tarefa: BoardTask }) {
  const { url, aoFalhar } = useMiniatura(tarefa.previewAttachmentId);
  if (tarefa.previewAttachmentId === null || url === undefined) return null;

  return (
    <div className="q-miniatura">
      <img
        src={url}
        alt={textoDaMiniatura(textoDasMencoes(tarefa.title))}
        draggable={false}
        loading="lazy"
        decoding="async"
        onError={aoFalhar}
      />
      {/* `+3` e não `4`: o número que interessa é o que NÃO está à vista. */}
      {tarefa.previewCount > 1 && (
        <span className="q-miniatura-mais" title={`${tarefa.previewCount} artes nesta tarefa`}>
          +{tarefa.previewCount - 1}
        </span>
      )}
    </div>
  );
}

/* ───────────────── mover a tarefa direto do cartão — F17.63 ───────────────── */

/**
 * O que o cartão precisa saber para oferecer `Mover para`.
 *
 * ⚠️ NADA AQUI FALA COM O BANCO, e é a mesma regra do cabeçalho de
 * `@/board/menus`: o cartão avisa o destino escolhido, e quem ESCREVE é a
 * página — por `api.moverTarefaNoQuadro`, que chama `ideworks.move_task`. Um
 * cartão que movesse sozinho seria o segundo caminho de escrita de lista, e a
 * regra 9 existe para não haver segundo.
 *
 * O ESTADO DE ABERTO VEM DE FORA de propósito: a coluna desenha cinquenta
 * cartões, e cada um guardando o próprio `aberto` deixaria dois menus abertos
 * ao mesmo tempo — o que o ClickUp não faz e ninguém quer.
 */
export type MoverDoCartao = {
  /** A árvore VIVA, já recortada pela política de linha. Ver `acharListas`. */
  arvore: readonly TreeSpace[];
  /** Os últimos destinos, já achados na mesma árvore. */
  recentes: readonly ListaNaArvore[];
  /** Onde a tarefa está agora — some dos `Recentes` e fica marcada na árvore. */
  listaAtual: string | null;
  aberto: boolean;
  /** Enquanto a escrita não voltou. Um segundo pedido em cima do primeiro não. */
  desativado: boolean;
  aoAlternar: () => void;
  aoFechar: () => void;
  aoEscolher: (listId: string) => void;
};

/**
 * O `···` DO CARTÃO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ TRÊS ARMADILHAS, TODAS JÁ PAGAS NESTE PROJETO, E ESTA PEÇA MORA NO MEIO
 * DAS TRÊS
 *
 *   1. **O CARTÃO ARRASTA.** `podePuxar` (F17.25) recusa o gesto de rolagem
 *      sobre `button`, e este é um `button` — a rolagem do fundo continua sem
 *      briga, de graça. O arrasto HTML5 do `<li>` é outra história e se resolve
 *      em `pages/Quadro.tsx`, onde o `<li>` mora: o `dragstart` nasce NELE, e
 *      não neste botão, então não há nada que este arquivo possa impedir.
 *
 *   2. **O BALÃO PRECISA DE PORTAL.** `.q-cartao` ganha
 *      `transform: translateY(-1px)` no `:hover` (medido na F17.50), e
 *      `transform` cria contexto de empilhamento: um balão preso aqui dentro
 *      abriria por baixo do cartão vizinho, ou cortado pelo `overflow` da
 *      coluna. `ComAncora` põe todo balão nascido daqui em `document.body`.
 *
 *   3. **ELE NÃO PODE ROUBAR O ESPAÇO DO TÍTULO.** Fica em `absolute` no canto,
 *      e a folha reserva a faixa no título — sem isso ele apareceria em cima da
 *      primeira palavra ao passar o mouse.
 *
 * `ref={setAncora}` E NÃO `useRef`: guardar num `ref` não redesenha, e o balão
 * nasceria sem saber onde se prender. Mesmo padrão de `AcaoDaLinha` na árvore.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function AcaoDoCartao({ tarefa, mover }: { tarefa: BoardTask; mover: MoverDoCartao }) {
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  return (
    <span className="cu-ancora q-cartao-acao" data-fixo={mover.aberto}>
      <button
        ref={setAncora}
        type="button"
        className="cu-icone-btn"
        /* O nome da tarefa entra no rótulo porque a coluna tem cinquenta
           destes: `Ações` sozinho seria cinquenta botões com o mesmo nome
           para quem ouve a tela. */
        aria-label={`Mover ${textoDasMencoes(tarefa.title)} para outra lista`}
        aria-haspopup="menu"
        aria-expanded={mover.aberto}
        disabled={mover.desativado}
        onClick={mover.aoAlternar}
      >
        <IconeMais />
      </button>
      {mover.aberto && (
        <ComAncora ancora={ancora}>
          <MenuDeListas
            arvore={mover.arvore}
            listaAtual={mover.listaAtual}
            recentes={mover.recentes}
            rotulo="Mover para"
            lado="baixo-direita"
            aoEscolher={mover.aoEscolher}
            aoFechar={mover.aoFechar}
          />
        </ComAncora>
      )}
    </span>
  );
}

/* ─────────────── o selo de urgente ─────────────── */

/**
 * `URGENTE`, escrito e em vermelho cheio. Vale para o cartão, a linha da lista e
 * a de Minhas tarefas — o mesmo selo, para o olho aprender uma coisa só.
 */
export function SeloUrgente({ prioridade }: { prioridade: BoardTask['priority'] }) {
  if (prioridade !== 'urgent') return null;
  return (
    <span className="q-selo-urgente" title="Prioridade urgente">
      <svg {...traco()}>
        <path d="M12 3 2.5 20h19L12 3zM12 10v4.5M12 17.2v.1" />
      </svg>
      URGENTE
    </span>
  );
}

/* ─────────────── concluir direto do cartão ─────────────── */

/**
 * O ATALHO DE CONCLUIR.
 *
 * É a MESMA coisa que arrastar o cartão para a coluna que fecha: quem escreve é
 * a página (`mover` do quadro), e o banco carimba a conclusão. Aparece como o
 * `···` aparece — ao passar o mouse, com o foco, e sempre no toque.
 */
export type ConcluirDoCartao = {
  /** Enquanto a escrita não voltou. */
  desativado: boolean;
  aoConcluir: () => void;
};

function ConcluirNoCartao({ tarefa, concluir }: { tarefa: BoardTask; concluir: ConcluirDoCartao }) {
  return (
    <span className="q-cartao-concluir">
      <button
        type="button"
        className="cu-icone-btn"
        aria-label={`Concluir ${textoDasMencoes(tarefa.title)}`}
        title="Concluir"
        disabled={concluir.desativado}
        onClick={concluir.aoConcluir}
      >
        <svg {...traco('h-3.5 w-3.5')}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </button>
    </span>
  );
}

/* ───────────────────────────── o prazo ───────────────────────────── */

/**
 * O PRAZO, NA FORMA CURTA — F06B.
 *
 * Uma peça para o cartão e para a linha: a leitura sai de `lerPrazo`, então
 * `Atrasada · 25/09` se escreve igual nas duas telas. O que se vê é o curto;
 * o que se ouve é o completo, com a data inteira (`Prazo vencido em
 * 25/09/2026`). O `title` repete o completo para quem passa o ponteiro.
 *
 * O TOM MORA NA FOLHA, por `data-estado`: nada de cor em `style`. E o estado
 * nunca depende só dele — a palavra (`Atrasada`, `Hoje`, `Amanhã`) está no
 * texto.
 */
export function PrazoCurto({
  tarefa,
  hoje,
  className,
}: {
  tarefa: { dueOn: string | null; completedAt: string | null };
  hoje: Day;
  className: string;
}) {
  const leitura = lerPrazo(tarefa, hoje);
  if (leitura === null) return null;
  return (
    <span className={className} data-estado={leitura.estado} title={leitura.completo}>
      {leitura.estado !== 'ilegivel' && <IconeRelogio className="q-prazo-icone" />}
      <span className="q-prazo-curto tnum" aria-hidden="true">
        {leitura.curto}
      </span>
      <span className="sr-only">{leitura.completo}</span>
    </span>
  );
}

/* ───────────────────────────── o corpo ───────────────────────────── */

/**
 * A HIERARQUIA DO CARTÃO — F06B do plano UX.
 *
 *   1. de onde veio (só em visão mista: pasta, Todas) e a mãe da subtarefa;
 *   2. o TÍTULO — a coisa mais forte, 14px e peso acima do resto;
 *   3. o que a tarefa é: tipo (texto leve) e etiquetas (cor de dado);
 *   4. a arte, quando há;
 *   5. o rodapé: PRAZO primeiro (com palavra), prioridade, os indicadores
 *      leves (descrição, anexo, conversa, subtarefas, checklist), o cliente
 *      quando ele diz algo, e o responsável como avatar no canto.
 *
 * Os indicadores ficaram mais leves, não sumiram: cada um é um `role="img"`
 * com nome (`3 comentários`), e o número continua à vista.
 */
export function CorpoDoCartao({
  tarefa,
  hoje,
  mover,
  concluir,
  responsavel,
  lista,
  clienteDaVisao = null,
}: {
  tarefa: BoardTask;
  hoje: Day;
  /**
   * DEFINIR RESPONSÁVEL PELA CAPA — F17.69.
   *
   * Ausente, as iniciais são só iniciais: é assim que o cartão desenha em
   * `Todas as tarefas` (F17.18) e na `MiniaturaDoCartao`, onde não há de onde
   * reler o quadro depois da escrita. Mesma dívida do `···`, e o mesmo motivo.
   */
  responsavel?: ResponsavelDoCartao;
  /**
   * Ausente, o cartão não tem `···` — e é assim que ele desenha em
   * `Todas as tarefas` (F17.18) e na `MiniaturaDoCartao`. Ver a dívida no
   * relatório da F17.63.
   */
  mover?: MoverDoCartao;
  /** O ✓ de concluir. Ausente, não há ícone (tarefa já concluída, sem coluna que feche, ou tela sem escrita). */
  concluir?: ConcluirDoCartao;
  /**
   * DE QUE LISTA ESTE CARTÃO É — F17.64.
   *
   * ⚠️ SEM ISTO, O QUADRO DA PASTA VIRA SOPA. Lá a coluna `a fazer arte` junta
   * as tarefas de vinte e cinco clientes, e um cartão sem procedência é um
   * pedido de trabalho sem cliente — quem pega não sabe para quem está fazendo.
   *
   * Ausente no quadro da LISTA, e de propósito: ali a lista é o título da tela,
   * e repeti-la em cada cartão seria escrever o mesmo nome cinquenta vezes.
   */
  lista?: { id: string; name: string };
  /**
   * O CLIENTE QUE A TELA JÁ MOSTRA NO TOPO — F06B.
   *
   * O quadro da lista passa o cliente da lista SÓ quando o chip dele está
   * à vista (`listaLevaAFicha`: vínculo E nome ao alcance). Aí, e só aí, o
   * cartão do MESMO cliente não repete o nome — é comprovadamente redundante.
   * Tarefa de outro cliente continua dizendo o dela; na pasta, em Todas e em
   * Minhas (visões mistas) isto chega nulo e todo cartão diz o seu. Nada aqui
   * DEDUZ cliente: o nome só aparece quando o dado já veio na tarefa.
   */
  clienteDaVisao?: string | null;
}) {
  const mostraCliente =
    tarefa.clientName !== null && !(clienteDaVisao !== null && tarefa.clientId === clienteDaVisao);

  return (
    <>
      {/* PRIMEIRO NA ORDEM DE LEITURA, e no canto de cima na tela — F17.63. Ele
          é `absolute`, então a posição não depende de onde está escrito; estar
          antes do título é o que faz o `Tab` chegar nele junto com o cartão, e
          não depois de percorrer etiquetas, prazo e avatares. */}
      {mover && <AcaoDoCartao tarefa={tarefa} mover={mover} />}
      <SeloUrgente prioridade={tarefa.priority} />
      {concluir && <ConcluirNoCartao tarefa={tarefa} concluir={concluir} />}

      {/* A LISTA DE ONDE ESTE CARTÃO VEIO — F17.64. Primeiro, porque é a
          primeira pergunta de quem olha uma coluna com seis clientes dentro.
          É um LINK para o quadro dela: quem quer ver só aquele cliente está a
          um clique. F06B: o nome acessível diz o que o clique faz — `Abrir a
          lista X` —, para não soar como um segundo título de tarefa.

          `draggable={false}` pela mesma razão dos outros links do cartão: o
          `<li>` é que arrasta (F17.25), e link nasce arrastável no navegador. */}
      {lista && (
        <Link
          to={`/quadro/${lista.id}`}
          className="q-lista-do-cartao"
          draggable={false}
          title={`Abrir só o quadro de ${lista.name}`}
          aria-label={`Abrir a lista ${lista.name}`}
        >
          {lista.name}
        </Link>
      )}

      {/* O cartão da SUBTAREFA diz de quem ele é — F17.15. F43, Fase 7: a mãe
          também abre ao lado, pelo mesmo link de tarefa do título. */}
      {tarefa.parentId !== null && (
        <LinkDaTarefa
          id={tarefa.parentId}
          className="q-mae"
          draggable={false}
          title={`Subtarefa de ${tarefa.parentTitle ?? 'outra tarefa'}`}
          rotulo={`Abrir a tarefa mãe: ${tarefa.parentTitle ?? 'outra tarefa'}`}
        >
          ↳ {tarefa.parentTitle ?? 'subtarefa'}
        </LinkDaTarefa>
      )}

      {/*
        O TÍTULO É UM LINK, e não um `onClick` no cartão inteiro — F17.10.
        No quadro da lista o cartão é arrastável: um clique no corpo dele é o
        começo de um arrasto, e transformá-lo em navegação faria todo arrasto
        curto abrir a ficha por engano. O nome acessível é o próprio título.

        F43, Fase 7: o link é `LinkDaTarefa` — o clique simples abre a ficha
        ao lado, com o quadro atrás; o `href` continua `/tarefa/:id`.
      */}
      <LinkDaTarefa id={tarefa.id} className="q-titulo-cartao q-abre" draggable={false}>
        <TextoComMencoes texto={tarefa.title} />
      </LinkDaTarefa>

      {/* O QUE A TAREFA É — F06B. O tipo virou texto leve (não mais uma caixa
          igual às etiquetas): ele classifica, não chama atenção. As etiquetas
          seguem com a cor que vem da origem. */}
      {(tarefa.tags.length > 0 || tarefa.taskTypeName || tarefa.type) && (
        <div className="q-cartao-tipo">
          {/* O TIPO DA DEMANDA — F40, Fase 4: o mesmo selo do Controle da semana. */}
          <SeloDoTipo tipo={tarefa.type} />
          {tarefa.taskTypeName && (
            <span className="q-tipo" title="Tipo de tarefa">
              {tarefa.taskTypeName}
            </span>
          )}
          {tarefa.tags.map((g) => (
            <span
              key={g.id}
              className="q-etiqueta"
              /* Cor de dado, por variável. Ver o cabeçalho e a D10. A tinta da
                 origem vale quando passa de 4,5:1 sobre o fundo dela; senão a
                 que o fundo pede — ver `@/board/tinta-da-etiqueta`. */
              style={varsDaEtiqueta(g.bgColor, g.fgColor)}
            >
              {g.name}
            </span>
          ))}
        </div>
      )}

      {/* A ARTE FICA ENTRE O QUE A TAREFA É E O ANDAMENTO DELA — F17.56. */}
      <Miniatura tarefa={tarefa} />

      <div className="q-linha-cartao">
        <PrazoCurto tarefa={tarefa} hoje={hoje} className="q-prazo" />

        {tarefa.priority && (
          <span
            className="q-prioridade"
            data-prioridade={tarefa.priority}
            style={{ color: PRIORITY_TOKEN[tarefa.priority] }}
            title={`Prioridade ${PRIORITY_LABEL[tarefa.priority].toLowerCase()}`}
          >
            <IconeBandeira c="q-prioridade-icone" />
            {PRIORITY_LABEL[tarefa.priority]}
          </span>
        )}

        {/* Os indicadores, num grupo leve. Cada um tem nome; o número fica. */}
        {(tarefa.hasDescription ||
          tarefa.hasAttachment ||
          tarefa.commentCount > 0 ||
          tarefa.subtaskCount > 0 ||
          tarefa.checklistTotal > 0) && (
          <span className="q-indicadores">
            {tarefa.hasDescription && (
              <span className="q-indicador" role="img" aria-label="Tem descrição" title="Tem descrição">
                <IconeTexto className="q-indicador-icone" />
              </span>
            )}

            {/* "Tem anexo" — F17.6. Vem de `task_progress.attachment_count > 0`. */}
            {tarefa.hasAttachment && (
              <span className="q-indicador" role="img" aria-label="Tem anexo" title="Tem anexo">
                <IconeClipe className="q-indicador-icone" />
              </span>
            )}

            {/* A conversa contada: na Agência Ide o comentário com o link do
                Dropbox É a entrega — "tem conversa" é andamento, não enfeite. */}
            {tarefa.commentCount > 0 && (
              <span
                className="q-indicador"
                role="img"
                aria-label={tarefa.commentCount === 1 ? '1 comentário' : `${tarefa.commentCount} comentários`}
                title={`${tarefa.commentCount} comentário(s), respostas incluídas`}
              >
                <IconeBalao className="q-indicador-icone" />
                <span className="tnum">{tarefa.commentCount}</span>
              </span>
            )}

            {/* Filhas DIRETAS e não arquivadas, de `ideworks.task_progress`. */}
            {tarefa.subtaskCount > 0 && (
              <span
                className="q-indicador"
                role="img"
                aria-label={tarefa.subtaskCount === 1 ? '1 subtarefa' : `${tarefa.subtaskCount} subtarefas`}
                title={`${tarefa.subtaskCount} subtarefa(s) — use o interruptor "Subtarefas" para vê-las como cartão`}
              >
                <span aria-hidden="true">⑂</span>
                <span className="tnum">{tarefa.subtaskCount}</span>
              </span>
            )}

            {/* `resolvidos/total` do checklist, na forma CURTA. */}
            {tarefa.checklistTotal > 0 && (
              <span
                className="q-indicador"
                role="img"
                data-cheio={tarefa.checklistDone === tarefa.checklistTotal}
                aria-label={`${tarefa.checklistDone} de ${tarefa.checklistTotal} ${tarefa.checklistTotal === 1 ? 'item' : 'itens'} do checklist`}
                title={`${tarefa.checklistDone} de ${tarefa.checklistTotal} item(ns) de checklist resolvidos`}
              >
                <span aria-hidden="true">☑</span>
                <span className="tnum">
                  {tarefa.checklistDone}/{tarefa.checklistTotal}
                </span>
              </span>
            )}
          </span>
        )}

        {mostraCliente && (
          <span className="q-cartao-cliente" title={`Cliente: ${tarefa.clientName}`}>
            {tarefa.clientName}
          </span>
        )}

        {/* ⚠️ O ALVO DO GESTO, quando a página sabe reler o quadro — F17.69. Sem
            `responsavel` as iniciais continuam sendo só iniciais. */}
        <span className="q-cartao-quem">
          {responsavel ? (
            <ResponsavelNaCapa tarefa={tarefa} responsavel={responsavel} />
          ) : (
            <Avatares pessoas={tarefa.assignees} />
          )}
        </span>
      </div>
    </>
  );
}

/* ───────────────────────────── a coluna vazia ───────────────────────────── */

/**
 * O QUE A COLUNA SEM CARTÃO DIZ — F06B.
 *
 * Era `Nada aqui.` nos dois casos, e eles não são o mesmo: com uma busca
 * aplicada, o topo dizia `0 de 5` e o corpo dizia `Nada aqui.` — como se a
 * etapa estivesse vazia. Agora:
 *   · vazia de verdade (`total` 0, ou sem filtro): `Nenhuma tarefa nesta etapa.`
 *   · vazia pelo filtro, com o total conhecido: `Nenhuma das 5 bate com o filtro.`
 *   · vazia pelo filtro sem total por coluna (Minhas/Todas em quadro, que
 *     filtram o lote carregado): `Nenhuma bate com a busca.`
 * `data-motivo` separa os dois para a folha e para os testes.
 */
export function ColunaVazia({ filtrada, total }: { filtrada: boolean; total?: number }) {
  const porFiltro = filtrada && (total === undefined || total > 0);
  const frase = !porFiltro
    ? 'Nenhuma tarefa nesta etapa.'
    : total === undefined
      ? 'Nenhuma bate com a busca.'
      : total === 1
        ? 'A única tarefa daqui não bate com o filtro.'
        : `Nenhuma das ${total} bate com o filtro.`;
  return (
    <li className="q-coluna-vazia" data-motivo={porFiltro ? 'filtro' : 'vazia'}>
      {frase}
    </li>
  );
}
