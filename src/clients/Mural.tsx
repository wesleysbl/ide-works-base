/**
 * O Mural — etapa F4.10.
 *
 * O quadro de cortiça do cliente: post-its que se arrastam, com cor e posição
 * guardadas.
 *
 * O ARRASTO GRAVA SÓ A POSIÇÃO
 *   A escrita é PARCIAL de propósito. Mandar o conteúdo junto numa gravação de
 *   arrasto sobrescreveria o que outra pessoa acabou de escrever na mesma nota
 *   — e ninguém desconfiaria, porque arrastar não parece uma edição de texto.
 *
 * GRAVA AO SOLTAR, NÃO A CADA PIXEL
 *   Arrastar uma nota por 300 pixels dispara centenas de eventos de movimento.
 *   Gravar em cada um deles seria centenas de escritas no banco por arrasto, e
 *   a última a chegar nem sempre é a última que aconteceu — a nota "voltaria"
 *   sozinha. A posição vive no estado da tela enquanto se arrasta e vai ao
 *   banco uma vez, ao soltar.
 *
 * O PONTEIRO É O DO NAVEGADOR
 *   Usa eventos de ponteiro (`pointer`), não de mouse: é o mesmo caminho para
 *   dedo e caneta, e o `setPointerCapture` garante que soltar fora da área
 *   ainda encerre o arrasto — sem ele, a nota gruda no cursor.
 *
 * QUADRO OU LISTA — F11C do plano UX (R53)
 *   O quadro tinha 620 px fixos e `touch-action: none` inteiro: no celular o
 *   dedo que tentava ROLAR a página arrastava nota, e nota posta em x = 600
 *   ficava fora de um quadro de 358 px, cortada sem aviso. Agora:
 *     - a LISTA lê e edita todas as notas por toque e teclado, na ordem de
 *       leitura do quadro (de cima para baixo, da esquerda para a direita). É
 *       a forma padrão abaixo de 640 px; a escolha fica lembrada no navegador.
 *     - o QUADRO rola dentro de si e cresce até a nota mais distante; só a
 *       nota bloqueia o gesto de rolar (quem arrasta é ela), o fundo não.
 *     - cada nota tem uma ALÇA que move pelas setas (Shift = passo largo), e
 *       grava a posição uma vez, quando as setas param.
 *   A lista NUNCA grava posição: trocar de forma não mexe onde a nota mora.
 *
 * NOTA EMBAIXO DE NOTA — R02 da revisão de 28/09
 *   Um mural real tinha duas notas com o MESMO retângulo: o contador dizia 2 e
 *   só uma se via. Abrir o mural continua sem regravar nada (a origem das
 *   coordenadas não é desta tela). Em vez disso:
 *     - o quadro AVISA quando há notas sobrepostas e leva à lista;
 *     - "Organizar notas" arruma todas em grade, na ordem de leitura — e só
 *       grava depois do clique E da confirmação da pessoa (só a posição);
 *     - a nota que recebe o foco pelo teclado vem para a frente, então o Tab
 *       nunca edita uma nota escondida.
 *
 * A NOTA ESCRITA PELA IA LEVA O SELO — F26.9
 *   *"Carla, via ChatGPT"*, no pé da nota. O mural não mostra autor de nota
 *   nenhuma, então o selo nomeia a pessoa junto com a conexão. Nota de gente
 *   não ganha selo nem linha a mais. A nota virou peça própria (`NotaDoMural`)
 *   para o teste desenhá-la: o quadro carrega as notas num efeito, e
 *   `renderToStaticMarkup` não roda efeito.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Ajuda } from '@/board/menus';
import { limitarNoQuadro } from '@/clients/mural-posicao';
import { ApiError, api } from '@/lib/api';
import { AlternadorDeVista } from '@/ui/AlternadorDeVista';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { IconeFechar, IconeMais } from '@/ui/Icones';
import { Aviso } from '@/ui/primitivos';
import { SeloDeOrigem } from '@/ui/SeloDeOrigem';
import { nomeDaConexao } from '@/ui/selo-de-origem';

type Cor = 'yellow' | 'green' | 'blue' | 'red';

export type Nota = {
  id: string;
  title: string | null;
  content: string;
  color: Cor;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  /** A conexão de IA pela qual a nota foi escrita (F26.9). Nula = gente. */
  viaName?: string | null;
  /** Quem pediu à IA. Só vem quando `viaName` vem. */
  viaAuthorName?: string | null;
};

/** As quatro cores do legado, traduzidas para o prisma do OBSIDIAN. */
const COR: Record<Cor, { rotulo: string; luz: string }> = {
  yellow: { rotulo: 'Amarelo', luz: 'var(--warn)' },
  green: { rotulo: 'Verde', luz: 'var(--luz-agencia)' },
  blue: { rotulo: 'Azul', luz: 'var(--luz-ia)' },
  red: { rotulo: 'Vermelho', luz: 'var(--err)' },
};

/** A altura mínima do quadro. Ele cresce até a nota mais baixa. */
const ALTURA_DO_QUADRO = 620;
/** Quanto a alça anda por seta; com Shift, o passo largo. */
const PASSO = 8;
const PASSO_LARGO = 48;

type Vista = 'quadro' | 'lista';
const CHAVE_DA_VISTA = 'ideworks:mural-vista';

function vistaInicial(): Vista {
  try {
    const salva = window.localStorage.getItem(CHAVE_DA_VISTA);
    if (salva === 'quadro' || salva === 'lista') return salva;
  } catch {
    /* sem cofre: decide pela largura */
  }
  try {
    return window.matchMedia('(max-width: 639.98px)').matches ? 'lista' : 'quadro';
  } catch {
    return 'quadro';
  }
}

/** Como a nota se chama para quem ouve: o título, ou o começo do texto. */
function nomeDaNota(n: Pick<Nota, 'title' | 'content'>): string {
  const titulo = n.title?.trim();
  if (titulo) return titulo;
  const texto = n.content.trim().split('\n')[0] ?? '';
  if (texto === '') return 'nota sem título';
  return texto.length > 40 ? `${texto.slice(0, 40)}…` : texto;
}

/** A ordem de leitura do quadro: de cima para baixo, da esquerda para a direita. */
function ordemDeLeitura(notas: readonly Nota[]): Nota[] {
  return [...notas].sort((a, b) => a.positionY - b.positionY || a.positionX - b.positionX);
}

/** Quantas notas encobrem (ou são encobertas por) outra — sobra de 24 px ignorada. */
function notasSobrepostas(notas: readonly Nota[]): number {
  const marcadas = new Set<string>();
  for (let i = 0; i < notas.length; i++) {
    for (let j = i + 1; j < notas.length; j++) {
      const a = notas[i];
      const b = notas[j];
      const largura = Math.min(a.positionX + a.width, b.positionX + b.width) - Math.max(a.positionX, b.positionX);
      const altura = Math.min(a.positionY + a.height, b.positionY + b.height) - Math.max(a.positionY, b.positionY);
      if (largura > 24 && altura > 24) {
        marcadas.add(a.id);
        marcadas.add(b.id);
      }
    }
  }
  return marcadas.size;
}

/**
 * A grade de "Organizar notas": na ordem de leitura, da esquerda para a
 * direita, quebrando a linha quando a próxima não cabe na largura dada.
 * Cada nota mantém o próprio tamanho.
 */
function organizarEmGrade(notas: readonly Nota[], largura: number): Map<string, { positionX: number; positionY: number }> {
  const MARGEM = 16;
  const posicoes = new Map<string, { positionX: number; positionY: number }>();
  let x = MARGEM;
  let y = MARGEM;
  let alturaDaLinha = 0;
  for (const n of ordemDeLeitura(notas)) {
    if (x > MARGEM && x + n.width > largura - MARGEM) {
      x = MARGEM;
      y += alturaDaLinha + MARGEM;
      alturaDaLinha = 0;
    }
    posicoes.set(n.id, { positionX: x, positionY: y });
    x += n.width + MARGEM;
    alturaDaLinha = Math.max(alturaDaLinha, n.height);
  }
  return posicoes;
}

export function Mural({ clienteId }: { clienteId: string }) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  /** A leitura falhou — separada da recusa de um gesto (F11C). */
  const [erroDaLeitura, setErroDaLeitura] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>(vistaInicial);
  /** A nota com o foco do teclado vem para a frente (R02). */
  const [naFrente, setNaFrente] = useState<string | null>(null);
  const [organizando, setOrganizando] = useState(false);

  const quadro = useRef<HTMLDivElement | null>(null);
  const moldura = useRef<HTMLDivElement | null>(null);
  /** O que está sendo arrastado agora, e de onde o dedo pegou a nota. */
  const arrasto = useRef<{ id: string; dx: number; dy: number } | null>(null);
  /** A gravação da posição movida pelas setas, adiada até as setas pararem. */
  const adiada = useRef<{ id: string; timer: number } | null>(null);
  /** As notas de agora, para quem grava depois (a alça, o soltar). */
  const notasAgora = useRef<Nota[]>([]);
  notasAgora.current = notas;

  const carregar = useCallback(async () => {
    try {
      const r = await api.mural(clienteId);
      setNotas(r.notes as Nota[]);
      setErroDaLeitura(null);
    } catch (e) {
      setErroDaLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar o mural.');
    } finally {
      setCarregando(false);
    }
  }, [clienteId]);

  useEffect(() => {
    setCarregando(true);
    void carregar();
  }, [carregar]);

  /** O tamanho do quadro: nunca menor que a nota mais distante. */
  const tamanho = useMemo(() => {
    let largura = 0;
    let altura = ALTURA_DO_QUADRO;
    for (const n of notas) {
      largura = Math.max(largura, n.positionX + n.width + 16);
      altura = Math.max(altura, n.positionY + n.height + 16);
    }
    return { largura, altura };
  }, [notas]);

  function trocarVista(v: Vista) {
    // O texto em edição grava no `blur`. Tirar o foco ANTES de desmontar a
    // forma de agora: sem isso a edição pendente sumiria com ela.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setVista(v);
    try {
      window.localStorage.setItem(CHAVE_DA_VISTA, v);
    } catch {
      /* sem cofre: vale até sair da tela */
    }
  }

  /* --- posição ---------------------------------------------------------- */

  async function gravarPosicao(id: string) {
    const nota = notasAgora.current.find((n) => n.id === id);
    if (!nota) return;
    try {
      // Só a posição. Ver a nota no topo do arquivo.
      await api.salvarNota(nota.id, { positionX: nota.positionX, positionY: nota.positionY });
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível mover a nota.');
      await carregar();
    }
  }

  function limitar(n: Nota, x: number, y: number) {
    const largura = quadro.current?.getBoundingClientRect().width ?? tamanho.largura;
    // Posição INTEIRA e presa dentro do quadro — ver `limitarNoQuadro`.
    return limitarNoQuadro(n, x, y, largura, tamanho.largura, tamanho.altura);
  }

  function pegar(e: React.PointerEvent, nota: Nota) {
    // Não arrasta a nota que está sendo editada: o gesto de selecionar texto
    // dentro dela viraria arrasto do post-it inteiro.
    if (editando === nota.id) return;
    const area = quadro.current?.getBoundingClientRect();
    if (!area) return;

    arrasto.current = {
      id: nota.id,
      dx: e.clientX - area.left - nota.positionX,
      dy: e.clientY - area.top - nota.positionY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function mover(e: React.PointerEvent) {
    const a = arrasto.current;
    const area = quadro.current?.getBoundingClientRect();
    if (!a || !area) return;
    setNotas((atuais) =>
      atuais.map((n) =>
        n.id !== a.id ? n : { ...n, ...limitar(n, e.clientX - area.left - a.dx, e.clientY - area.top - a.dy) },
      ),
    );
  }

  function soltar() {
    const a = arrasto.current;
    arrasto.current = null;
    if (a) void gravarPosicao(a.id);
  }

  /** As setas na alça: move na tela na hora, grava quando param. */
  function moverPorTeclado(nota: Nota, dx: number, dy: number) {
    setNotas((atuais) =>
      atuais.map((n) => (n.id !== nota.id ? n : { ...n, ...limitar(n, n.positionX + dx, n.positionY + dy) })),
    );
    if (adiada.current) window.clearTimeout(adiada.current.timer);
    adiada.current = {
      id: nota.id,
      timer: window.setTimeout(() => {
        adiada.current = null;
        void gravarPosicao(nota.id);
      }, 500),
    };
  }

  // Sair da tela com uma posição por gravar: grava agora.
  useEffect(
    () => () => {
      const a = adiada.current;
      if (a) {
        window.clearTimeout(a.timer);
        void gravarPosicao(a.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* --- organizar (R02) ------------------------------------------------- */

  const sobrepostas = useMemo(() => notasSobrepostas(notas), [notas]);

  async function organizar() {
    const largura = moldura.current?.clientWidth ?? 900;
    const posicoes = organizarEmGrade(notas, largura);
    const mudam = notas.filter((n) => {
      const p = posicoes.get(n.id);
      return p && (p.positionX !== n.positionX || p.positionY !== n.positionY);
    });
    if (mudam.length === 0) return;
    // Só com o sim da pessoa: é a única gravação de posição em lote da tela.
    if (
      !window.confirm(
        `Organizar as ${notas.length} notas em grade, na ordem de leitura? ` +
          `${mudam.length === 1 ? 'Uma nota muda' : `${mudam.length} notas mudam`} de lugar para todos que abrem este mural.`,
      )
    )
      return;
    setErro(null);
    setOrganizando(true);
    setNotas((atuais) => atuais.map((n) => ({ ...n, ...(posicoes.get(n.id) ?? {}) })));
    try {
      // Só a posição, como no arrasto. Ver a nota no topo do arquivo.
      await Promise.all(
        mudam.map((n) => {
          const p = posicoes.get(n.id) as { positionX: number; positionY: number };
          return api.salvarNota(n.id, { positionX: p.positionX, positionY: p.positionY });
        }),
      );
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível organizar as notas.');
      await carregar();
    } finally {
      setOrganizando(false);
    }
  }

  /* --- escrita --------------------------------------------------------- */

  async function acrescentar() {
    setErro(null);
    try {
      // Nasce em escada, para a segunda não cair exatamente em cima da primeira.
      const passo = (notas.length % 6) * 28;
      await api.criarNota(clienteId, {
        content: 'Nova nota',
        color: 'yellow',
        positionX: 16 + passo,
        positionY: 16 + passo,
      });
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.');
    }
  }

  async function gravarCampo(nota: Nota, campos: Partial<Pick<Nota, 'title' | 'content' | 'color'>>) {
    setErro(null);
    // O estado da tela acompanha o que foi escrito: trocar de forma (quadro ↔
    // lista) desenha as notas de novo a partir dele, e sem isto o texto
    // voltaria ao de antes da edição.
    setNotas((atuais) => atuais.map((x) => (x.id === nota.id ? { ...x, ...campos } : x)));
    try {
      await api.salvarNota(nota.id, campos);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
      await carregar();
    }
  }

  async function apagar(nota: Nota) {
    if (!window.confirm(`Apagar a nota “${nomeDaNota(nota)}”? Não há como desfazer.`)) return;
    setErro(null);
    try {
      await api.excluirNota(nota.id);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível apagar.');
    }
    await carregar();
  }

  const acoesDaNota = (n: Nota) => ({
    aoFocar: () => setEditando(n.id),
    aoSoltarFoco: () => setEditando(null),
    aoGravar: (campos: Partial<Pick<Nota, 'title' | 'content' | 'color'>>) => void gravarCampo(n, campos),
    aoTrocarCor: (c: Cor) => void gravarCampo(n, { color: c }),
    aoApagar: () => void apagar(n),
  });

  return (
    <div className="pb-10">
      <div className="cl-cabeca">
        <h2 className="cl-area-titulo">Mural</h2>
        {!carregando && erroDaLeitura === null && notas.length > 0 && (
          <p className="cl-resumo-area">
            <span>
              <b>{notas.length}</b>{' '}
              {notas.length === 1 ? 'nota' : 'notas'}
            </span>
            {/* A DICA FIXA VIROU "?" — F43 Fase 10. Ela ensinava o gesto
                (arrastar, a alça com as setas, clicar no texto) e ficava
                escrita ao lado do número de notas toda vez que o mural
                abria. Agora mora no "?" ao lado do número, a mesma frase,
                ainda conforme a forma de ver. */}
            <Ajuda sobre="como mexer nas notas" lado="baixo-direita">
              {vista === 'quadro'
                ? 'Arraste a nota, ou use a alça com as setas, para mudar o lugar dela. Clique no texto para editar.'
                : 'As notas aparecem na ordem do quadro. Toque no texto para editar.'}
            </Ajuda>
          </p>
        )}
        <div className="cl-cabeca-acoes">
          {vista === 'quadro' && !carregando && erroDaLeitura === null && notas.length > 1 && (
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-sm"
              disabled={organizando}
              onClick={() => void organizar()}
            >
              {organizando ? 'Organizando…' : 'Organizar notas'}
            </button>
          )}
          <AlternadorDeVista
            rotulo="Forma de ver o mural"
            opcoes={[
              { valor: 'quadro', rotulo: 'Quadro' },
              { valor: 'lista', rotulo: 'Lista' },
            ]}
            valor={vista}
            aoEscolher={trocarVista}
          />
          <button type="button" className="o-btn o-btn-solido o-btn-sm" onClick={acrescentar}>
            <IconeMais />
            Nova nota
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-3">
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      )}

      {carregando ? (
        <EstadoDaPagina tipo="carregando" titulo="Carregando o mural…" />
      ) : erroDaLeitura !== null ? (
        <EstadoDaPagina
          tipo="erro"
          titulo={erroDaLeitura}
          acao={{ rotulo: 'Tentar de novo', aoClicar: () => void carregar() }}
        />
      ) : notas.length === 0 ? (
        <EstadoDaPagina tipo="vazio" titulo="Mural vazio" acao={{ rotulo: 'Nova nota', aoClicar: () => void acrescentar() }}>
          É onde ficam os lembretes que não são tarefa nem histórico — orientações de marca,
          referências, o jeito de falar com o cliente, o que nunca pode faltar no post.
        </EstadoDaPagina>
      ) : vista === 'lista' ? (
        <ul className="cl-mural-lista" aria-label="Notas do mural">
          {ordemDeLeitura(notas).map((n) => (
            <NotaNaLista key={n.id} nota={n} {...acoesDaNota(n)} />
          ))}
        </ul>
      ) : (
        <>
        {sobrepostas > 0 && (
          <p className="cl-mural-aviso" role="status">
            <span>
              <b>{sobrepostas}</b> notas estão umas sobre as outras no quadro.
            </span>
            <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={() => trocarVista('lista')}>
              Ver todas em lista
            </button>
          </p>
        )}
        <div className="cl-mural-quadro" ref={moldura}>
          <div
            ref={quadro}
            className="cl-mural-plano"
            style={{ minWidth: tamanho.largura, height: tamanho.altura }}
            onPointerMove={mover}
            onPointerUp={soltar}
            onPointerCancel={soltar}
          >
            {notas.map((n) => (
              <NotaDoMural
                key={n.id}
                nota={n}
                editando={editando === n.id}
                naFrente={naFrente === n.id}
                aoTrazerParaFrente={() => setNaFrente(n.id)}
                aoPegar={(e) => pegar(e, n)}
                aoMoverPorTeclado={(dx, dy) => moverPorTeclado(n, dx, dy)}
                {...acoesDaNota(n)}
              />
            ))}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

/** As quatro cores, como botões pressionáveis com nome. */
function CoresDaNota({ nota: n, aoTrocarCor }: { nota: Nota; aoTrocarCor: (c: Cor) => void }) {
  return (
    <div className="cl-nota-cores" role="group" aria-label={`Cor da nota “${nomeDaNota(n)}”`}>
      {(Object.keys(COR) as Cor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="cl-nota-cor"
          title={COR[c].rotulo}
          aria-label={COR[c].rotulo}
          aria-pressed={n.color === c}
          onClick={() => aoTrocarCor(c)}
        >
          <span style={{ background: COR[c].luz }} />
        </button>
      ))}
    </div>
  );
}

type AcoesDaNota = {
  aoFocar: () => void;
  aoSoltarFoco: () => void;
  aoGravar: (campos: Partial<Pick<Nota, 'title' | 'content' | 'color'>>) => void;
  aoTrocarCor: (c: Cor) => void;
  aoApagar: () => void;
};

/**
 * A nota na LISTA — F11C. Os mesmos campos da nota do quadro, na largura
 * toda, sem posição: aqui nada se arrasta e nada grava onde a nota mora.
 */
function NotaNaLista({ nota: n, aoFocar, aoSoltarFoco, aoGravar, aoTrocarCor, aoApagar }: { nota: Nota } & AcoesDaNota) {
  const luz = COR[n.color].luz;
  const nome = nomeDaNota(n);
  return (
    <li
      className="cl-nota-cartao"
      style={{ borderLeftColor: luz, background: `color-mix(in srgb, ${luz} 8%, var(--iw-fundo))` }}
    >
      <div className="flex items-center gap-2">
        <input
          className="cl-nota-campo cl-nota-titulo min-w-0 flex-1"
          style={{ color: 'var(--iw-texto)' }}
          placeholder="título"
          aria-label={`Título da nota “${nome}”`}
          defaultValue={n.title ?? ''}
          onFocus={aoFocar}
          onBlur={(e) => {
            aoSoltarFoco();
            if (e.target.value !== (n.title ?? '')) aoGravar({ title: e.target.value });
          }}
        />
        <CoresDaNota nota={n} aoTrocarCor={aoTrocarCor} />
        <button
          type="button"
          className="cl-nota-apagar"
          title="Apagar nota"
          aria-label={`Apagar a nota “${nome}”`}
          onClick={aoApagar}
        >
          <IconeFechar className="h-3 w-3" />
        </button>
      </div>
      <textarea
        className="cl-nota-campo cl-nota-texto"
        aria-label={`Texto da nota “${nome}”`}
        defaultValue={n.content}
        rows={4}
        onFocus={aoFocar}
        onBlur={(e) => {
          aoSoltarFoco();
          if (e.target.value.trim() !== n.content) aoGravar({ content: e.target.value });
        }}
      />
      {nomeDaConexao(n.viaName) !== null && (
        <div className="flex max-w-full overflow-hidden">
          <SeloDeOrigem via={n.viaName} pessoa={n.viaAuthorName} />
        </div>
      )}
    </li>
  );
}

/**
 * Um post-it do mural. Recebe tudo por propriedade — o teste o desenha sem
 * efeito, e o que ele desenha é o que a pessoa vê.
 */
export function NotaDoMural({
  nota: n,
  editando,
  naFrente = false,
  aoTrazerParaFrente = () => {},
  aoPegar,
  aoMoverPorTeclado = () => {},
  aoFocar,
  aoSoltarFoco,
  aoGravar,
  aoTrocarCor,
  aoApagar,
}: {
  nota: Nota;
  editando: boolean;
  /** Recebeu o foco: desenha por cima das outras (R02). */
  naFrente?: boolean;
  aoTrazerParaFrente?: () => void;
  aoPegar: (e: React.PointerEvent) => void;
  aoMoverPorTeclado?: (dx: number, dy: number) => void;
} & AcoesDaNota) {
  const luz = COR[n.color].luz;
  const nome = nomeDaNota(n);
  // O pé com o selo come uma linha do texto — só na nota de IA. A de gente
  // continua com a mesma altura de antes.
  const daIa = nomeDaConexao(n.viaName) !== null;
  return (
    <div
      className="absolute rounded-md border p-2"
      style={{
        left: n.positionX,
        top: n.positionY,
        width: n.width,
        height: n.height,
        borderColor: luz,
        background: `color-mix(in srgb, ${luz} 12%, var(--ink-2))`,
        boxShadow: 'var(--e-2)',
        cursor: editando ? 'auto' : 'grab',
        // Só a nota segura o gesto: é ela que se arrasta. O fundo do quadro
        // deixa o dedo rolar a página (F11C).
        touchAction: 'none',
        zIndex: naFrente ? 1 : undefined,
      }}
      onFocus={aoTrazerParaFrente}
      onPointerDown={aoPegar}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="cl-nota-alca"
          aria-label={`Mover a nota “${nome}” — use as setas; Shift anda mais`}
          title="Mover: arraste, ou use as setas do teclado"
          onKeyDown={(e) => {
            const passo = e.shiftKey ? PASSO_LARGO : PASSO;
            const setas: Record<string, [number, number]> = {
              ArrowLeft: [-passo, 0],
              ArrowRight: [passo, 0],
              ArrowUp: [0, -passo],
              ArrowDown: [0, passo],
            };
            const d = setas[e.key];
            if (!d) return;
            e.preventDefault();
            aoMoverPorTeclado(d[0], d[1]);
          }}
        >
          <svg viewBox="0 0 10 14" width="8" height="12" aria-hidden="true" fill="currentColor">
            <circle cx="2" cy="2" r="1.3" />
            <circle cx="8" cy="2" r="1.3" />
            <circle cx="2" cy="7" r="1.3" />
            <circle cx="8" cy="7" r="1.3" />
            <circle cx="2" cy="12" r="1.3" />
            <circle cx="8" cy="12" r="1.3" />
          </svg>
        </button>
        <input
          className="min-w-0 flex-1 bg-transparent text-[0.72rem] font-semibold outline-none"
          style={{ color: 'var(--iw-texto)' }}
          placeholder="título"
          aria-label={`Título da nota “${nome}”`}
          defaultValue={n.title ?? ''}
          onPointerDown={(e) => e.stopPropagation()}
          onFocus={aoFocar}
          onBlur={(e) => {
            aoSoltarFoco();
            if (e.target.value !== (n.title ?? '')) {
              aoGravar({ title: e.target.value });
            }
          }}
        />

        <div className="flex shrink-0 items-center" onPointerDown={(e) => e.stopPropagation()}>
          <CoresDaNota nota={n} aoTrocarCor={aoTrocarCor} />
          <button
            type="button"
            className="cl-nota-apagar"
            title="Apagar nota"
            aria-label={`Apagar a nota “${nome}”`}
            onClick={aoApagar}
          >
            <IconeFechar className="h-3 w-3" />
          </button>
        </div>
      </div>

      <textarea
        className={`mt-1 w-full resize-none bg-transparent text-[0.78rem] leading-snug text-plat
                    outline-none ${daIa ? 'h-[calc(100%-3.4rem)]' : 'h-[calc(100%-1.75rem)]'}`}
        aria-label={`Texto da nota “${nome}”`}
        defaultValue={n.content}
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={aoFocar}
        onBlur={(e) => {
          aoSoltarFoco();
          if (e.target.value.trim() !== n.content) {
            aoGravar({ content: e.target.value });
          }
        }}
      />

      {daIa && (
        <div className="mt-1 flex max-w-full overflow-hidden">
          <SeloDeOrigem via={n.viaName} pessoa={n.viaAuthorName} />
        </div>
      )}
    </div>
  );
}
