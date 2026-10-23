/**
 * A PÁGINA DO CLIENTE — `/aprovar/:token`. F42, Fase 6.
 *
 * O cliente da agência abre o link no celular e resolve tudo ali, sem conta:
 * vê as chamadas abertas ("Para você responder") e as respondidas, assiste ao
 * material na ordem do carrossel, lê a legenda, comenta um material ou a
 * chamada inteira, e aprova ou pede ajustes. Decidiu, acabou: a chamada vira
 * só leitura.
 *
 * FORA DA MOLDURA, DE PROPÓSITO
 *   A moldura do sistema (`@/ui/Moldura`) monta o gerente do chat, que pergunta
 *   a sessão (`/auth/me`) — e um 401 dali leva à renovação do crachá. Esta
 *   página não tem sessão nem deve parecer que tem: ela é uma rota irmã da
 *   moldura em `src/rotas.tsx`, e fala só com `/api/public/aprovacao/…` (ver
 *   `@/aprovacao/cliente`). `src/main.tsx` também pula o `/config` aqui.
 *
 * A MARCA
 *   Agência Ide: base preta, o traço verde da assinatura, "nós vamos com você"
 *   no pé. O tema é sempre o escuro — é a marca, não preferência de quem abre.
 *   Só tokens que existem (`--ink-*`, `--hair*`, `--plat*`, `--mute`, `--ok`,
 *   `--warn`, `--err`, `--iw-*`): token inexistente apaga a cor em silêncio.
 *
 * O ENDEREÇO NÃO VAZA
 *   O token está no caminho. Enquanto a página está aberta, `<meta
 *   name="referrer" content="no-referrer">` e `robots: noindex` ficam no
 *   `<head>`; cada imagem, vídeo e link para o Dropbox repete
 *   `referrerPolicy="no-referrer"`/`rel="noreferrer"`. A API responde com os
 *   mesmos cabeçalhos (Fase 5) e `public/_headers` os põe no documento.
 *
 * TESTES
 *   `pagina-do-cliente.test.ts` desenha cada estado no servidor (nenhum efeito
 *   roda). O clique, a decisão e o 320 px são o e2e `aprovacao-cliente`.
 */

import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  type ApiDoLink,
  type ChamadaPublica,
  type ComentarioPublico,
  type ItemPublico,
  type PaginaPublica,
  FRASE_COMENTARIO_OBRIGATORIO,
  FRASE_MATERIAL_NAO_ABRIU,
  FRASE_MOTIVO_OBRIGATORIO,
  TETO_DO_TEXTO,
  apiDoLink,
  comComentario,
  dataEHoraCurta,
  ehJaRespondida,
  ehLimite,
  ehLinkInvalido,
  estaAberta,
  fraseDoErro,
  problemaDoTexto,
  quantosMateriais,
  seloDaDecisao,
  separar,
  trocarChamada,
  marcarVisto,
  primeiroNaoVisto,
  perguntaDosVistos,
} from '@/aprovacao/cliente';

import { comportamentoDeRolagem } from '@/ui/movimento';
import '@/ui/aprovacao-cliente.css';

/* ─────────────────────────── os estados da página ─────────────────────────── */

export type Carga =
  | { fase: 'carregando' }
  | { fase: 'invalido' }
  | { fase: 'limite' }
  | { fase: 'falha'; frase: string }
  | { fase: 'pronta'; pagina: PaginaPublica };

/** O que a página faz por uma chamada. Lançam `ErroPublico`; quem desenha mostra a frase. */
export type Acoes = {
  comentar: (chamadaId: string, texto: string, itemId: string | null) => Promise<void>;
  decidir: (chamadaId: string, decisao: 'aprovar' | 'reprovar', motivo?: string) => Promise<void>;
};

/* ─────────────────────────── a casca ─────────────────────────── */

export function Casca({ children }: { children: ReactNode }) {
  return (
    <div className="apc">
      <header className="apc-topo">
        <div className="apc-topo-miolo">
          <span className="apc-marca" role="img" aria-label="Agência Ide">
            <span className="apc-marca-traco" aria-hidden="true" />
            <span aria-hidden="true">
              Agência <strong>Ide</strong>
            </span>
          </span>
          <span className="apc-topo-rotulo">Aprovação de materiais</span>
        </div>
      </header>
      <main className="apc-miolo">{children}</main>
      <footer className="apc-pe">
        <p className="apc-pe-slogan">
          Agência Ide · <em>nós vamos com você</em>
        </p>
        <p>Alguma dúvida? Fale com o atendimento da Ide.</p>
      </footer>
    </div>
  );
}

/** O `<h1>` de cada vista recebe o foco quando a vista troca (leitor de tela e teclado). */
function Titulo({ children, focar }: { children: ReactNode; focar: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focar) return;
    ref.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [focar]);
  return (
    <h1 ref={ref} tabIndex={-1} className="apc-titulo">
      {children}
    </h1>
  );
}

/* ─────────────────────────── estados de espera e recusa ─────────────────────────── */

export function Carregando() {
  return (
    <section className="apc-estado" aria-busy="true">
      <h1 className="apc-titulo">Abrindo seus materiais…</h1>
      <p role="status" className="apc-apoio">
        Só um instante.
      </p>
      <div className="apc-esqueleto" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}

export function LinkInvalido() {
  return (
    <section className="apc-estado">
      <h1 className="apc-titulo">Link inválido ou desativado</h1>
      <p className="apc-apoio">
        Este endereço não abre mais nenhuma aprovação. Pode ser que a Ide tenha gerado um link novo para você, ou que
        ele tenha sido copiado pela metade.
      </p>
      <p className="apc-apoio">
        <strong>Fale com o atendimento da Ide</strong> e peça o link de aprovação atualizado.
      </p>
    </section>
  );
}

export function MuitasTentativas({ aoTentar }: { aoTentar?: () => void }) {
  return (
    <section className="apc-estado">
      <h1 className="apc-titulo">Aguarde um instante</h1>
      <p className="apc-apoio" role="alert">
        Muitas tentativas em pouco tempo. Espere um minuto e tente de novo.
      </p>
      {aoTentar && (
        <button type="button" className="o-btn o-btn-vidro apc-btn" onClick={aoTentar}>
          Tentar de novo
        </button>
      )}
    </section>
  );
}

export function FalhaAoAbrir({ frase, aoTentar }: { frase: string; aoTentar?: () => void }) {
  return (
    <section className="apc-estado">
      <h1 className="apc-titulo">Não foi possível abrir</h1>
      <p className="apc-apoio" role="alert">
        {frase}
      </p>
      {aoTentar && (
        <button type="button" className="o-btn o-btn-vidro apc-btn" onClick={aoTentar}>
          Tentar de novo
        </button>
      )}
      <p className="apc-apoio">Se continuar assim, fale com o atendimento da Ide.</p>
    </section>
  );
}

/* ─────────────────────────── a lista ─────────────────────────── */

function CartaoDaChamada({ chamada }: { chamada: ChamadaPublica }) {
  const aberta = estaAberta(chamada);
  const selo = seloDaDecisao(chamada);
  return (
    <li className="apc-cartao" data-estado={chamada.estado}>
      <Link className="apc-cartao-link" to={{ search: `?chamada=${encodeURIComponent(chamada.id)}` }}>
        <span className="apc-eyebrow">
          Versão {chamada.versao} · {quantosMateriais(chamada.itens.length)}
        </span>
        <span className="apc-cartao-titulo">{chamada.titulo}</span>
        <span className="apc-cartao-meta">Enviado em {dataEHoraCurta(chamada.enviadaEm)}</span>
        {aberta ? (
          <span className="apc-cartao-acao">
            Ver e responder <span className="apc-seta" aria-hidden="true">›</span>
          </span>
        ) : (
          <span className="o-selo apc-selo" data-tom={chamada.estado === 'aprovada' ? 'ok' : 'warn'}>
            <span className="ponto" aria-hidden="true" />
            {selo}
          </span>
        )}
      </Link>
    </li>
  );
}

export function ListaDeChamadas({ pagina, focar = false }: { pagina: PaginaPublica; focar?: boolean }) {
  const { abertas, respondidas } = separar(pagina.chamadas);
  return (
    <>
      <div className="apc-cabeca">
        <p className="apc-eyebrow">{pagina.cliente.nome}</p>
        <Titulo focar={focar}>Materiais para aprovação</Titulo>
      </div>

      <section className="apc-secao" aria-labelledby="apc-abertas">
        <h2 id="apc-abertas" className="apc-secao-titulo">
          Para você responder <span className="apc-conta">({abertas.length})</span>
        </h2>
        {abertas.length === 0 ? (
          <div className="apc-vazio">
            <p className="apc-vazio-titulo">Nada pendente por aqui.</p>
            <p className="apc-apoio">Quando a Ide enviar um material novo, ele aparece neste mesmo link.</p>
          </div>
        ) : (
          <ul className="apc-lista">
            {abertas.map((c) => (
              <CartaoDaChamada key={c.id} chamada={c} />
            ))}
          </ul>
        )}
      </section>

      {respondidas.length > 0 && (
        <section className="apc-secao" aria-labelledby="apc-respondidas">
          <h2 id="apc-respondidas" className="apc-secao-titulo">
            Já respondidas <span className="apc-conta">({respondidas.length})</span>
          </h2>
          <ul className="apc-lista">
            {respondidas.map((c) => (
              <CartaoDaChamada key={c.id} chamada={c} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ─────────────────────────── o material ─────────────────────────── */

/** Um material: imagem aparece, vídeo toca, pasta e arquivo "outro" abrem no Dropbox. */
export function Midia({ item, posicao }: { item: ItemPublico; posicao: number }) {
  const [quebrou, setQuebrou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const rotulo = `Material ${posicao}: ${item.nome}`;

  if (item.forma === 'pasta' || !item.exibicao) {
    const destino = item.abrirNoDropbox ?? item.exibicao;
    return (
      <div className="apc-midia-pasta">
        <p className="apc-apoio">
          {item.forma === 'pasta'
            ? 'Este material é uma pasta. Abra no Dropbox para ver os arquivos.'
            : 'Este material abre no Dropbox.'}
        </p>
        {destino && (
          <a
            className="o-btn o-btn-vidro apc-btn"
            href={destino}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {item.forma === 'pasta' ? 'Abrir pasta no Dropbox' : 'Abrir arquivo'}
          </a>
        )}
      </div>
    );
  }

  if (item.tipo === 'other') {
    return (
      <div className="apc-midia-pasta">
        <p className="apc-apoio">Este arquivo não é imagem nem vídeo: abra para ver.</p>
        <a
          className="o-btn o-btn-vidro apc-btn"
          href={item.exibicao}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Abrir arquivo
        </a>
      </div>
    );
  }

  if (quebrou) {
    return (
      <div className="apc-midia-falha" role="alert">
        <p>{FRASE_MATERIAL_NAO_ABRIU}</p>
        <div className="apc-botoes">
          <button
            type="button"
            className="o-btn o-btn-vidro apc-btn"
            onClick={() => {
              setQuebrou(false);
              setTentativa((t) => t + 1);
            }}
          >
            Tentar de novo
          </button>
          <a
            className="o-btn o-btn-fantasma apc-btn"
            href={item.exibicao}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            Abrir em outra aba
          </a>
        </div>
      </div>
    );
  }

  return item.tipo === 'image' ? (
    <img
      key={tentativa}
      className="apc-midia"
      src={item.exibicao}
      alt={rotulo}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setQuebrou(true)}
    />
  ) : (
    // `preload="metadata"`: abrir a página não baixa o vídeo inteiro.
    <video
      key={tentativa}
      className="apc-midia"
      src={item.exibicao}
      controls
      playsInline
      preload="metadata"
      aria-label={rotulo}
      onError={() => setQuebrou(true)}
    >
      <track kind="captions" />
    </video>
  );
}

/* ─────────────────────────── comentar ─────────────────────────── */

function FormDeComentario({
  rotuloDoBotao,
  rotuloDoCampo,
  aoEnviar,
}: {
  rotuloDoBotao: string;
  rotuloDoCampo: string;
  aoEnviar: (texto: string) => Promise<void>;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (aberto) campo.current?.focus();
  }, [aberto]);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    const t = texto.trim();
    const problema = problemaDoTexto(t, FRASE_COMENTARIO_OBRIGATORIO);
    if (problema) {
      setErro(problema);
      campo.current?.focus();
      return;
    }
    setErro(null);
    setEnviando(true);
    try {
      await aoEnviar(t);
      setTexto('');
      setAberto(false);
      setEnviado(true);
    } catch (falha) {
      setErro(fraseDoErro(falha));
    } finally {
      setEnviando(false);
    }
  }

  if (!aberto) {
    return (
      <div className="apc-comentar">
        <button
          type="button"
          className="o-btn o-btn-vidro apc-btn apc-btn-leve"
          aria-expanded="false"
          onClick={() => {
            setAberto(true);
            setEnviado(false);
          }}
        >
          {rotuloDoBotao}
        </button>
        {enviado && (
          <p className="apc-ok" role="status">
            Comentário enviado à Ide.
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="apc-comentar apc-form" onSubmit={enviar} noValidate>
      <label htmlFor={id} className="apc-rotulo">
        {rotuloDoCampo}
      </label>
      <textarea
        ref={campo}
        id={id}
        className="o-campo apc-texto"
        rows={3}
        maxLength={TETO_DO_TEXTO}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          if (erro) setErro(null);
        }}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${id}-erro` : undefined}
        disabled={enviando}
      />
      {erro && (
        <p id={`${id}-erro`} className="apc-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="apc-botoes">
        <button type="submit" className="o-btn o-btn-primario apc-btn" disabled={enviando} aria-busy={enviando}>
          {enviando ? 'Enviando…' : 'Enviar comentário'}
        </button>
        <button
          type="button"
          className="o-btn o-btn-fantasma apc-btn"
          disabled={enviando}
          onClick={() => {
            setAberto(false);
            setErro(null);
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ListaDeComentarios({ comentarios, titulo }: { comentarios: ComentarioPublico[]; titulo: string }) {
  if (comentarios.length === 0) return null;
  return (
    <div className="apc-comentarios">
      <p className="apc-rotulo">{titulo}</p>
      <ul>
        {comentarios.map((c) => (
          <li key={c.id} className="apc-comentario">
            <p className="apc-comentario-texto">{c.texto}</p>
            <p className="apc-comentario-meta">{dataEHoraCurta(c.criadoEm)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────── o carrossel ─────────────────────────── */

export function Carrossel({
  chamada,
  aoComentar,
  aoVer,
  irPara = null,
}: {
  chamada: ChamadaPublica;
  aoComentar: (texto: string, itemId: string) => Promise<void>;
  /** Avisa qual material está à vista (também o primeiro, ao montar). */
  aoVer?: (indice: number) => void;
  /** Pedido de fora: levar o carrossel a este material (`n` muda a cada pedido). */
  irPara?: { indice: number; n: number } | null;
}) {
  const trilho = useRef<HTMLOListElement>(null);
  const [atual, setAtual] = useState(0);
  const total = chamada.itens.length;
  const aberta = estaAberta(chamada);

  // Enquanto a rolagem pedida pelos botões anda, as posições do meio do
  // caminho não mexem no contador — senão dois toques rápidos partiriam do
  // material errado. Some ao chegar, ou em 800 ms (a pessoa arrastou junto).
  const indoPara = useRef<{ alvo: number; ate: number } | null>(null);

  const ir = useCallback((i: number) => {
    const el = trilho.current;
    const alvo = el?.children[i] as HTMLElement | undefined;
    if (!el || !alvo) return;
    const suave = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    indoPara.current = { alvo: i, ate: Date.now() + 800 };
    el.scrollTo({ left: alvo.offsetLeft, behavior: suave ? 'smooth' : 'auto' });
    setAtual(i);
  }, []);

  useEffect(() => {
    aoVer?.(atual);
  }, [atual, aoVer]);

  useEffect(() => {
    if (!irPara) return;
    ir(irPara.indice);
    trilho.current?.scrollIntoView?.({ block: 'center', behavior: comportamentoDeRolagem() });
  }, [irPara, ir]);

  const aoRolar = () => {
    const el = trilho.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth)));
    const pedido = indoPara.current;
    if (pedido) {
      if (i === pedido.alvo || Date.now() > pedido.ate) indoPara.current = null;
      else return;
    }
    if (i !== atual) setAtual(i);
  };

  if (total === 0) return <p className="apc-apoio">Nenhum material neste envio.</p>;

  return (
    <section className="apc-carrossel" aria-roledescription="carrossel" aria-label="Materiais, na ordem do post">
      {total > 1 && (
        <div className="apc-navegar">
          <button
            type="button"
            className="o-btn o-btn-vidro apc-btn-seta"
            aria-label="Material anterior"
            disabled={atual === 0}
            onClick={() => ir(atual - 1)}
          >
            ‹
          </button>
          <p className="apc-posicao" aria-live="polite">
            Material {atual + 1} de {total}
          </p>
          <button
            type="button"
            className="o-btn o-btn-vidro apc-btn-seta"
            aria-label="Próximo material"
            disabled={atual === total - 1}
            onClick={() => ir(atual + 1)}
          >
            ›
          </button>
        </div>
      )}
      <ol ref={trilho} className="apc-trilho" onScroll={aoRolar} data-unico={total === 1 ? '' : undefined}>
        {chamada.itens.map((item, i) => {
          const doItem = chamada.comentarios.filter((c) => c.itemId === item.id);
          return (
            <li
              key={item.id}
              className="apc-slide"
              data-atual={i === atual ? '' : undefined}
              aria-roledescription="material"
              aria-label={`Material ${i + 1} de ${total}`}
              data-tipo={item.forma === 'pasta' ? 'pasta' : item.tipo}
              data-forma={item.forma}
            >
              <figure className="apc-figura">
                <Midia item={item} posicao={i + 1} />
                <figcaption className="apc-legenda-do-item">
                  <span className="apc-n">{i + 1}</span> {item.nome}
                </figcaption>
              </figure>
              <ListaDeComentarios comentarios={doItem} titulo="Seus comentários neste material" />
              {aberta && (
                <FormDeComentario
                  rotuloDoBotao="Comentar este material"
                  rotuloDoCampo={`Comentário sobre o material ${i + 1}`}
                  aoEnviar={(texto) => aoComentar(texto, item.id)}
                />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ─────────────────────────── decidir ─────────────────────────── */

type Modo = 'botoes' | 'aprovar' | 'ajustes';

export function Decisao({
  chamada,
  aoDecidir,
  modoInicial = 'botoes',
  vistos,
  aoVerOutros,
}: {
  chamada: ChamadaPublica;
  aoDecidir: (decisao: 'aprovar' | 'reprovar', motivo?: string) => Promise<void>;
  modoInicial?: Modo;
  /** Índices dos materiais que a pessoa já viu; sem isto, a confirmação é a de sempre. */
  vistos?: readonly number[];
  /** Leva o carrossel ao material de índice dado. */
  aoVerOutros?: (indice: number) => void;
}) {
  const id = useId();
  const [modo, setModo] = useState<Modo>(modoInicial);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const painel = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const primeiraVez = useRef(true);

  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    if (modo === 'ajustes') campo.current?.focus();
    else if (modo === 'aprovar') painel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    if (modo !== 'botoes') painel.current?.scrollIntoView?.({ block: 'nearest' });
  }, [modo]);

  const voltar = () => {
    setModo('botoes');
    setErro(null);
  };

  async function enviar(decisao: 'aprovar' | 'reprovar') {
    if (enviando) return;
    let texto: string | undefined;
    if (decisao === 'reprovar') {
      texto = motivo.trim();
      const problema = problemaDoTexto(texto, FRASE_MOTIVO_OBRIGATORIO);
      if (problema) {
        setErro(problema);
        campo.current?.focus();
        return;
      }
    }
    setErro(null);
    setEnviando(true);
    try {
      await aoDecidir(decisao, texto);
    } catch (falha) {
      // 409: quem chamou já releu a chamada e ela vira só leitura com a frase.
      setErro(fraseDoErro(falha));
      setEnviando(false);
    }
  }

  if (modo === 'botoes') {
    return (
      <div className="apc-decidir" data-modo="botoes">
        <p className="apc-decidir-dica">Conferiu tudo? Responda à Ide:</p>
        <div className="apc-decidir-botoes">
          <button type="button" className="o-btn o-btn-solido apc-btn apc-aprovar" onClick={() => setModo('aprovar')}>
            Aprovar
          </button>
          <button type="button" className="o-btn o-btn-vidro apc-btn apc-ajustes" onClick={() => setModo('ajustes')}>
            Pedir ajustes
          </button>
        </div>
      </div>
    );
  }

  if (modo === 'aprovar') {
    const total = chamada.itens.length;
    const pergunta = vistos ? perguntaDosVistos(vistos, total) : null;
    const faltou = vistos ? primeiroNaoVisto(vistos, total) : null;
    return (
      <div ref={painel} className="apc-decidir" data-modo="aprovar" role="group" aria-labelledby={`${id}-t`}>
        <h2 id={`${id}-t`} className="apc-secao-titulo">
          Aprovar “{chamada.titulo}”?
        </h2>
        {pergunta && (
          <p className="apc-apoio apc-vistos" role="status">
            {pergunta}
          </p>
        )}
        <p className="apc-apoio">
          Você aprova a versão {chamada.versao}, com todos os materiais e a legenda. Depois de aprovar, a resposta não
          muda por aqui — se precisar, fale com o atendimento.
        </p>
        {erro && (
          <p className="apc-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="apc-decidir-botoes">
          <button
            type="button"
            className="o-btn o-btn-solido apc-btn apc-aprovar"
            disabled={enviando}
            aria-busy={enviando}
            onClick={() => void enviar('aprovar')}
          >
            {enviando ? 'Enviando…' : 'Sim, aprovar'}
          </button>
          {pergunta && faltou !== null && aoVerOutros && (
            <button
              type="button"
              className="o-btn o-btn-vidro apc-btn"
              disabled={enviando}
              onClick={() => {
                voltar();
                aoVerOutros(faltou);
              }}
            >
              Ver os outros
            </button>
          )}
          <button type="button" className="o-btn o-btn-fantasma apc-btn" disabled={enviando} onClick={voltar}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={painel} className="apc-decidir" data-modo="ajustes" role="group" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="apc-secao-titulo">
        Pedir ajustes
      </h2>
      <label htmlFor={`${id}-m`} className="apc-rotulo">
        O que precisa mudar? <span className="apc-obrigatorio">(obrigatório)</span>
      </label>
      <textarea
        ref={campo}
        id={`${id}-m`}
        className="o-campo apc-texto"
        rows={4}
        maxLength={TETO_DO_TEXTO}
        value={motivo}
        onChange={(e) => {
          setMotivo(e.target.value);
          if (erro) setErro(null);
        }}
        aria-required="true"
        aria-invalid={erro ? true : undefined}
        aria-describedby={`${id}-d${erro ? ` ${id}-e` : ''}`}
        disabled={enviando}
      />
      <p id={`${id}-d`} className="apc-dica">
        Diga qual material e o que mudar. A equipe recebe o seu pedido e envia uma nova versão neste mesmo link.
      </p>
      {erro && (
        <p id={`${id}-e`} className="apc-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="apc-decidir-botoes">
        <button
          type="button"
          className="o-btn o-btn-primario apc-btn"
          disabled={enviando}
          aria-busy={enviando}
          onClick={() => void enviar('reprovar')}
        >
          {enviando ? 'Enviando…' : 'Enviar pedido de ajustes'}
        </button>
        <button type="button" className="o-btn o-btn-fantasma apc-btn" disabled={enviando} onClick={voltar}>
          Voltar
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── a chamada ─────────────────────────── */

export type Aviso = { tom: 'ok' | 'warn' | 'err'; texto: string };

export function VistaDaChamada({
  chamada,
  acoes,
  focar = false,
  avisoInicial = null,
}: {
  chamada: ChamadaPublica;
  acoes: Acoes;
  focar?: boolean;
  avisoInicial?: Aviso | null;
}) {
  const [aviso, setAviso] = useState<Aviso | null>(avisoInicial);
  const [vistos, setVistos] = useState<number[]>([0]); // o primeiro já está à vista
  const [irPara, setIrPara] = useState<{ indice: number; n: number } | null>(null);
  const verMaterial = useCallback((i: number) => setVistos((v) => (v.includes(i) ? v : marcarVisto(v, i))), []);
  const refDoAviso = useRef<HTMLParagraphElement>(null);
  // Decidiu (ou o 409 chegou): o aviso e o selo estão no alto — leva a pessoa até lá.
  useEffect(() => {
    if (!aviso) return;
    refDoAviso.current?.focus({ preventScroll: true });
    refDoAviso.current?.scrollIntoView?.({ block: 'center' });
  }, [aviso]);
  const aberta = estaAberta(chamada);
  const gerais = chamada.comentarios.filter((c) => c.itemId === null);
  const selo = seloDaDecisao(chamada, true);

  const decidir = async (decisao: 'aprovar' | 'reprovar', motivo?: string) => {
    try {
      await acoes.decidir(chamada.id, decisao, motivo);
      setAviso({
        tom: 'ok',
        texto:
          decisao === 'aprovar'
            ? 'Pronto! Sua aprovação foi registrada. Obrigado.'
            : 'Pronto! Seu pedido de ajustes foi enviado à Ide.',
      });
    } catch (e) {
      if (ehJaRespondida(e)) setAviso({ tom: 'warn', texto: fraseDoErro(e) });
      throw e;
    }
  };

  return (
    <article className="apc-chamada" data-estado={chamada.estado}>
      <Link className="apc-voltar" to={{ search: '' }}>
        <span aria-hidden="true">‹</span> Voltar à lista
      </Link>

      <div className="apc-cabeca">
        <p className="apc-eyebrow">Versão {chamada.versao}</p>
        <Titulo focar={focar}>{chamada.titulo}</Titulo>
        <p className="apc-meta">Enviado em {dataEHoraCurta(chamada.enviadaEm)}</p>
      </div>

      {aviso && (
        <p ref={refDoAviso} tabIndex={-1} className="apc-aviso" data-tom={aviso.tom} role="status">
          {aviso.texto}
        </p>
      )}

      {!aberta && (
        <div className="apc-decidida" data-tom={chamada.estado === 'aprovada' ? 'ok' : 'warn'}>
          <p className="apc-decidida-selo">{selo}</p>
          <p className="apc-apoio">
            Você já respondeu este envio: agora é só para ver. Se precisar mudar algo, fale com o atendimento da Ide.
          </p>
        </div>
      )}

      <Carrossel
        chamada={chamada}
        aoComentar={(texto, itemId) => acoes.comentar(chamada.id, texto, itemId)}
        aoVer={verMaterial}
        irPara={irPara}
      />

      {chamada.legenda && (
        <section className="apc-secao" aria-labelledby="apc-legenda">
          <h2 id="apc-legenda" className="apc-secao-titulo">
            Legenda
          </h2>
          {/* Texto puro: `white-space: pre-wrap` guarda as quebras; nada vira HTML. */}
          <p className="apc-legenda">{chamada.legenda}</p>
        </section>
      )}

      <section className="apc-secao" aria-labelledby="apc-comentarios-gerais">
        <h2 id="apc-comentarios-gerais" className="apc-secao-titulo">
          Comentários
        </h2>
        {gerais.length === 0 && !aberta && <p className="apc-apoio">Nenhum comentário geral.</p>}
        <ListaDeComentarios comentarios={gerais} titulo="Seus comentários gerais" />
        {aberta && (
          <FormDeComentario
            rotuloDoBotao="Escrever um comentário geral"
            rotuloDoCampo="Comentário sobre o envio inteiro"
            aoEnviar={(texto) => acoes.comentar(chamada.id, texto, null)}
          />
        )}
      </section>

      {aberta && (
        <Decisao
          key={chamada.id}
          chamada={chamada}
          aoDecidir={decidir}
          vistos={vistos}
          aoVerOutros={(indice) => setIrPara((p) => ({ indice, n: (p?.n ?? 0) + 1 }))}
        />
      )}
    </article>
  );
}

/* ─────────────────────────── a tela inteira ─────────────────────────── */

export function TelaDoLink({
  carga,
  chamadaId,
  acoes,
  aoTentarDeNovo,
  focar = false,
}: {
  carga: Carga;
  chamadaId: string | null;
  acoes: Acoes;
  aoTentarDeNovo?: () => void;
  focar?: boolean;
}) {
  let conteudo: ReactNode;
  if (carga.fase === 'carregando') conteudo = <Carregando />;
  else if (carga.fase === 'invalido') conteudo = <LinkInvalido />;
  else if (carga.fase === 'limite') conteudo = <MuitasTentativas aoTentar={aoTentarDeNovo} />;
  else if (carga.fase === 'falha') conteudo = <FalhaAoAbrir frase={carga.frase} aoTentar={aoTentarDeNovo} />;
  else {
    const chamada = chamadaId ? carga.pagina.chamadas.find((c) => c.id === chamadaId) : undefined;
    conteudo = chamada ? (
      <VistaDaChamada key={chamada.id} chamada={chamada} acoes={acoes} focar={focar} />
    ) : (
      <ListaDeChamadas pagina={carga.pagina} focar={focar} />
    );
  }
  return <Casca>{conteudo}</Casca>;
}

/* ─────────────────────────── a rota ─────────────────────────── */

/** Metas de privacidade, título e tema enquanto a página está aberta; tudo volta ao sair. */
function useCabecaDaPagina() {
  useEffect(() => {
    const metas = [
      ['referrer', 'no-referrer'],
      ['robots', 'noindex, nofollow'],
    ].map(([nome, conteudo]) => {
      const m = document.createElement('meta');
      m.name = nome;
      m.content = conteudo;
      m.dataset.aprovacao = '';
      document.head.insertBefore(m, document.head.firstChild);
      return m;
    });
    const raiz = document.documentElement;
    const antes = { titulo: document.title, tema: raiz.dataset.tema, cor: raiz.dataset.cor };
    document.title = 'Aprovação · Agência Ide';
    raiz.dataset.tema = 'escuro';
    delete raiz.dataset.cor;
    return () => {
      for (const m of metas) m.remove();
      document.title = antes.titulo;
      if (antes.tema === undefined) delete raiz.dataset.tema;
      else raiz.dataset.tema = antes.tema;
      if (antes.cor !== undefined) raiz.dataset.cor = antes.cor;
    };
  }, []);
}

export default function PaginaDoCliente() {
  const { token = '' } = useParams();
  const [busca] = useSearchParams();
  const chamadaId = busca.get('chamada');
  const api: ApiDoLink = useMemo(() => apiDoLink(token), [token]);
  const [carga, setCarga] = useState<Carga>({ fase: 'carregando' });
  const [rodada, setRodada] = useState(0);

  useCabecaDaPagina();

  useEffect(() => {
    let vale = true;
    api
      .pagina()
      .then((pagina) => {
        if (vale) setCarga({ fase: 'pronta', pagina });
      })
      .catch((e: unknown) => {
        if (!vale) return;
        if (ehLinkInvalido(e)) setCarga({ fase: 'invalido' });
        else if (ehLimite(e)) setCarga({ fase: 'limite' });
        else setCarga({ fase: 'falha', frase: fraseDoErro(e) });
      });
    return () => {
      vale = false;
    };
  }, [api, rodada]);

  // O foco vai ao título quando a vista troca (lista ↔ chamada), não na abertura.
  const vistaAnterior = useRef<string | null | undefined>(undefined);
  const vista = carga.fase === 'pronta' ? (chamadaId ?? '') : null;
  const focar = vistaAnterior.current !== undefined && vistaAnterior.current !== null && vista !== vistaAnterior.current;
  useEffect(() => {
    if (vista !== null) vistaAnterior.current = vista;
  }, [vista]);

  const trocar = useCallback((nova: ChamadaPublica) => {
    setCarga((c) => (c.fase === 'pronta' ? { fase: 'pronta', pagina: trocarChamada(c.pagina, nova) } : c));
  }, []);

  const acoes: Acoes = useMemo(
    () => ({
      comentar: async (id, texto, itemId) => {
        try {
          const comentario = await api.comentar(id, texto, itemId);
          setCarga((c) => {
            if (c.fase !== 'pronta') return c;
            const atual = c.pagina.chamadas.find((x) => x.id === id);
            return atual ? { fase: 'pronta', pagina: trocarChamada(c.pagina, comComentario(atual, comentario)) } : c;
          });
        } catch (e) {
          if (ehLinkInvalido(e)) setCarga({ fase: 'invalido' });
          else if (ehJaRespondida(e)) await api.chamada(id).then(trocar).catch(() => {});
          throw e;
        }
      },
      decidir: async (id, decisao, motivo) => {
        try {
          const nova = decisao === 'aprovar' ? await api.aprovar(id) : await api.reprovar(id, motivo ?? '');
          trocar(nova);
        } catch (e) {
          if (ehLinkInvalido(e)) setCarga({ fase: 'invalido' });
          // Outra aba ou outro clique decidiu antes: relê e a chamada vira só leitura.
          else if (ehJaRespondida(e)) await api.chamada(id).then(trocar).catch(() => {});
          throw e;
        }
      },
    }),
    [api, trocar],
  );

  return (
    <TelaDoLink
      carga={carga}
      chamadaId={chamadaId}
      acoes={acoes}
      focar={focar}
      aoTentarDeNovo={() => {
        setCarga({ fase: 'carregando' });
        setRodada((r) => r + 1);
      }}
    />
  );
}
