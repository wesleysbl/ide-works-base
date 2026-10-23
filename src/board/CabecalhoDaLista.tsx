/**
 * AS PEÇAS DO CABEÇALHO DO QUADRO, DA PASTA E DO ESPAÇO — F06A do plano UX.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU, E POR QUÊ
 *
 *   Até a F05 o quadro de uma lista se apresentava três vezes: a trilha dizia
 *   `… › Criação e conteúdo`, o `<h1>` dizia `Quadro`, e um cartão largo logo
 *   abaixo repetia `Criação e conteúdo` com o cliente, a esteira, o
 *   interruptor, o `Nova tarefa`, as contagens, a busca e a descrição inteira —
 *   ~150 px antes da primeira coluna, e o nome real da lista competindo com o
 *   nome da FORMA de vê-la.
 *
 *   Agora: o nome da lista É o título da página (o `Topo`), o cliente mora na
 *   linha do nome, `Nova tarefa` é a ação da página, e busca, responsável,
 *   subtarefas e contagens formam UMA faixa de ferramentas sem moldura. A
 *   esteira — de onde vêm as colunas e se são herdadas — passou a contexto
 *   secundário: um botão discreto que abre a explicação num balão. A descrição
 *   longa aparece numa linha e se abre inteira por um botão.
 *
 * ⚠️ NADA AQUI CONTA DE NOVO. Os números chegam prontos de quem chama (os
 *   mesmos `summarize`/`summarizeBoard` de antes); esta peça só os escreve.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type ReactNode, useId, useState } from 'react';

import { Balao } from '@/board/menus';
// A regra pura fica num `.ts` — o Fast Refresh pede componentes sozinhos aqui.
import { descricaoLonga } from '@/board/cabecalho-da-lista';

/* ───────────────────────────── a descrição ───────────────────────────── */

/**
 * A descrição da lista, recolhível quando longa.
 *
 * O TEXTO INTEIRO ESTÁ SEMPRE NO HTML — recolher é só desenho (`line-clamp`),
 * então buscar na página, copiar e o leitor de tela continuam alcançando tudo.
 * Recolhida por padrão a cada visita: é contexto, e a altura é dos cartões.
 *
 * `selecionavel` — F17.25: foi escrita por alguém da equipe, é conteúdo.
 */
export function DescricaoDaLista({ texto }: { texto: string }) {
  const id = useId();
  const [aberta, setAberta] = useState(false);
  const longa = descricaoLonga(texto);

  if (!longa) {
    return (
      <div className="q-descricao">
        <p className="q-descricao-texto selecionavel">{texto}</p>
      </div>
    );
  }

  return (
    <div className="q-descricao" data-recolhida={!aberta}>
      <p id={id} className="q-descricao-texto selecionavel">
        {texto}
      </p>
      <button
        type="button"
        className="q-descricao-botao"
        aria-expanded={aberta}
        aria-controls={id}
        onClick={() => setAberta((a) => !a)}
      >
        {aberta ? 'Recolher descrição' : 'Ler descrição inteira'}
      </button>
    </div>
  );
}

/* ───────────────────────────── a esteira ───────────────────────────── */

const IconeEsteira = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5 shrink-0"
    aria-hidden
  >
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
    <path d="M7 12h3M14 12h3" />
  </svg>
);

/** De onde a esteira veio, dito por extenso no balão. */
const DE_ONDE: Record<'list' | 'folder' | 'space', string> = {
  list: 'Esta lista tem esteira própria: mudar as etapas aqui não mexe em outras listas.',
  folder:
    'A esteira vem da pasta. Outras listas da mesma pasta que também a herdam mostram as mesmas colunas.',
  space:
    'A esteira vem do espaço. Outras listas do espaço que também a herdam mostram as mesmas colunas.',
};

/**
 * A ESTEIRA EM CONTEXTO SECUNDÁRIO — F06A.
 *
 * Era um selo sempre aceso no cabeçalho (`Fluxo de criação · herdada da
 * pasta`). A informação continua a um clique — e o nome dela continua escrito
 * no próprio botão, sem precisar abrir —, mas não disputa mais a linha com o
 * nome da lista. O balão é `dialog`, não `menu`: ele explica, não oferece
 * escolhas.
 */
export function SobreAEsteira({
  nome,
  heranca,
  rotuloDaHeranca,
}: {
  nome: string;
  heranca: 'list' | 'folder' | 'space';
  /** `própria da lista`, `herdada da pasta`… — o `INHERITED_LABEL` de sempre. */
  rotuloDaHeranca: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  return (
    <span className="cu-ancora">
      <button
        ref={setAncora}
        type="button"
        className="q-esteira"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        title={`Conjunto de status: ${nome} · ${rotuloDaHeranca}`}
        onClick={() => setAberto((v) => !v)}
        /* O `Esc` também do botão: sob carga o foco pode não ter entrado no
           balão ainda (medido no e2e F06A), e o `Esc` do balão não o ouviria. */
        onKeyDown={(e) => {
          if (e.key === 'Escape' && aberto) {
            e.preventDefault();
            setAberto(false);
          }
        }}
      >
        <IconeEsteira />
        <span className="q-esteira-nome">{nome}</span>
      </button>
      {aberto && (
        <Balao
          lado="baixo"
          ancora={ancora}
          papel="dialog"
          /* O `rotulo` desenha o título do balão com o X (F17.33). */
          rotulo="Esteira"
          aoFechar={() => {
            setAberto(false);
            // O foco volta ao botão quando ficaria no nada (Esc, o X). Um
            // clique fora já levou o foco a outro lugar — esse fica onde está.
            setTimeout(() => {
              if (document.activeElement === document.body || document.activeElement === null) ancora?.focus();
            }, 0);
          }}
        >
          <div className="q-esteira-balao">
            <p className="q-esteira-linha">
              <b>{nome}</b> · {rotuloDaHeranca}
            </p>
            <p className="q-esteira-apoio">{DE_ONDE[heranca]}</p>
          </div>
        </Balao>
      )}
    </span>
  );
}

/* ───────────────────────────── as contagens ───────────────────────────── */

/**
 * `18 tarefas · 16 em aberto · 2 concluídas`. Os números vêm contados do
 * banco (F17.50) — aqui só se escreve. O "em aberto" ganha a tinta cheia
 * quando há trabalho, como antes.
 */
export function ContagemDoQuadro({
  total,
  abertas,
  feitas,
  antes,
}: {
  total: number;
  abertas: number;
  feitas: number;
  /** O que vem antes na mesma frase — `2 listas · 5 etapas` na pasta. */
  antes?: ReactNode;
}) {
  return (
    <p className="q-contagem tnum">
      {antes}
      {antes && <span aria-hidden="true"> · </span>}
      {/* Cada número com a palavra dele numa peça que não parte: no celular
          a frase quebra ENTRE as partes, nunca em `4 / concluídas`. */}
      <span className="q-contagem-parte">
        {total} {total === 1 ? 'tarefa' : 'tarefas'}
      </span>
      <span aria-hidden="true"> · </span>
      <span className="q-contagem-parte" data-aberto={abertas > 0}>
        {abertas} em aberto
      </span>
      <span aria-hidden="true"> · </span>
      <span className="q-contagem-parte">
        {feitas} {feitas === 1 ? 'concluída' : 'concluídas'}
      </span>
    </p>
  );
}
