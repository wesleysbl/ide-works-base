/**
 * O DESENHO DO CONTROLE DA SEMANA — F40 (Fase 7) e F41 (Fase 1).
 *
 * F41: em vez de três blocos em lista corrida, a semana vira uma FAIXA de cinco
 * números e um GRUPO POR CLIENTE que recolhe e expande. O cabeçalho do grupo
 * diz o estado (atrasado, em falta, em dia) e mostra a barra de cada tipo; o
 * corpo guarda o andamento por tipo e os atrasados. F41 Fase 2: os cards para
 * atribuir (com o OK) saíram dos grupos e ficam num bloco próprio, na frente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESENHO PURO, E É DE PROPÓSITO
 *
 *   Os blocos recebem o dado PRONTO e devolvem o que fazer por callback. Quem
 *   busca, recarrega e navega é a página (`pages/ControleDaSemana.tsx`).
 *   A suíte de tela desenha no servidor (`renderToStaticMarkup`, nenhum
 *   `useEffect` roda), então só uma peça que não busca nada pode ser provada com
 *   dados fixos — e as três respostas da tela ("o que atribuir", "como anda",
 *   "o que falta") são exatamente o que precisa ser conferido.
 *
 * O ÚNICO ESTADO AQUI É O DA LINHA DE "PARA ATRIBUIR"
 *   A pessoa, o prazo e (no card sem tipo) o tipo que o admin está escolhendo
 *   moram na linha: são rascunho de um clique, e não dado da semana.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  type BarraDoTipo,
  type ClienteParaAtribuir,
  type CardAtrasado,
  type CardParaAtribuir,
  type EscolhaDaLinha,
  type GrupoDoCliente,
  type TotaisDaFaixa,
  OPCOES_DO_TIPO,
  type TipoDoGrupo,
  cartoesDaFaixa,
  porQueOOkEstaParado,
  prazoCurto,
  rotuloDoTipo,
  seloDoEstado,
} from '@/painel/controle-da-semana';
import { Selo } from '@/ui/primitivos';
import '@/ui/controle-da-semana.css';

export type Pessoa = { id: string; name: string };

/** Devolve a frase da recusa, ou `null` quando deu certo. */
export type AoLiberar = (card: CardParaAtribuir, tipoDoGrupo: TipoDoGrupo, escolha: EscolhaDaLinha) => Promise<string | null>;

/* ───────────────────────────── A faixa de números ───────────────────────────── */

/** Cinco cartões com rótulo, número e o estado em palavras (a cor não é a única pista). */
export function FaixaDeNumeros({ totais }: { totais: TotaisDaFaixa }) {
  return (
    <div className="cs-faixa" role="group" aria-label="Resumo da semana" data-bloco="faixa">
      {cartoesDaFaixa(totais).map((c) => (
        <div key={c.id} className="cs-cartao" data-tom={c.tom} data-numero={c.id}>
          <span className="cs-cartao-rotulo">{c.rotulo}</span>
          <strong className="cs-cartao-valor tnum">{c.valor}</strong>
          <span className="cs-cartao-estado">{c.estado}</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── O bloco "Para atribuir" ───────────────────────────── */

export const ID_DO_PARA_ATRIBUIR = 'cs-para-atribuir';

/**
 * Tudo o que espera atribuição, na frente da lista de clientes: um subtítulo
 * por cliente (na ordem de urgência da lista) e as linhas com o OK. Nasce
 * RECOLHIDO (a faixa de cima já diz quantos são); o título abre e fecha, e quem
 * guarda o estado é a página, para trocar de semana não recolher de novo.
 */
export function BlocoParaAtribuir({
  clientes,
  pessoas,
  aoLiberar,
  aberto = false,
  aoAlternar,
  clientesAbertos,
  aoAlternarCliente,
}: {
  clientes: readonly ClienteParaAtribuir[];
  pessoas: readonly Pessoa[];
  aoLiberar: AoLiberar;
  aberto?: boolean;
  aoAlternar?: () => void;
  /** Clientes com os cards à mostra; quem não está aqui começa recolhido. */
  clientesAbertos?: ReadonlySet<string>;
  aoAlternarCliente?: (clientId: string) => void;
}) {
  const total = clientes.reduce((n, c) => n + c.total, 0);
  return (
    <section
      className="cs-bloco"
      aria-labelledby="cs-t-atribuir"
      id={ID_DO_PARA_ATRIBUIR}
      data-bloco="para-atribuir"
      data-aberto={aberto ? 'true' : 'false'}
    >
      <div className="cs-bloco-cabeca">
        <h2 id="cs-t-atribuir" className="cs-bloco-titulo">
          <button type="button" className="cs-bloco-botao" aria-expanded={aberto} aria-controls="cs-corpo-atribuir" onClick={aoAlternar}>
            <span className="cs-seta" aria-hidden="true" />
            Para atribuir
            <span className="cs-bloco-contagem tnum">{total}</span>
          </button>
        </h2>
      </div>
      <div id="cs-corpo-atribuir" hidden={!aberto}>
      {clientes.length === 0 ? (
        <p className="cs-vazio" data-vazio="para-atribuir">
          Nada para atribuir nesta semana
        </p>
      ) : (
        <div className="cs-atribuir">
          {clientes.map((c) => {
            const aberto = clientesAbertos?.has(c.clientId) ?? false;
            return (
              <div key={c.clientId} className="cs-atribuir-cliente" data-cliente={c.clientId} data-aberto={aberto ? 'true' : 'false'}>
                <h3 className="cs-sub">
                  <button
                    type="button"
                    className="cs-bloco-botao cs-cliente-botao"
                    aria-expanded={aberto}
                    aria-controls={`cs-atribuir-corpo-${c.clientId}`}
                    onClick={() => aoAlternarCliente?.(c.clientId)}
                  >
                    <span className="cs-seta" aria-hidden="true" />
                    {c.clientName}
                    <span className="cs-bloco-contagem tnum">{c.total}</span>
                  </button>
                </h3>
                <div id={`cs-atribuir-corpo-${c.clientId}`} hidden={!aberto}>
                  {c.grupos.map((g) => (
                    <ul key={`${c.clientId}-${g.type ?? 'sem'}`} className="cs-cards" data-tipo={g.type ?? 'sem-tipo'}>
                      {g.cards.map((card) => (
                        <LinhaParaAtribuir key={card.id} card={card} tipo={g.type} pessoas={pessoas} aoLiberar={aoLiberar} />
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </section>
  );
}

/* ───────────────────────────── Um grupo por cliente ───────────────────────────── */

export const idDoCorpo = (clientId: string) => `cs-corpo-${clientId}`;

function BarraDeProgresso({ b }: { b: BarraDoTipo }) {
  const tom = b.missing === 0 ? 'ok' : b.cards === 0 ? 'err' : 'warn';
  return (
    <span
      className="cs-barra"
      data-tipo={b.type}
      data-tom={tom}
      role="img"
      aria-label={`${rotuloDoTipo(b.type)}: ${b.cards} de ${b.target}${b.excedente > 0 ? `, ${b.excedente} acima da meta` : ''}`}
    >
      <span className="cs-barra-rotulo">{rotuloDoTipo(b.type)}</span>
      <span className="cs-trilho" aria-hidden="true">
        <span className="cs-preenchido" style={{ width: `${b.pct}%` }} />
      </span>
      <span className="cs-barra-num tnum" data-excedente={b.excedente > 0 ? 'true' : undefined}>
        {b.texto}
      </span>
    </span>
  );
}

export function GrupoDoClienteBloco({
  grupo,
  aberto,
  aoAlternar,
  aoAbrirCliente,
}: {
  grupo: GrupoDoCliente;
  aberto: boolean;
  aoAlternar: (clientId: string) => void;
  aoAbrirCliente: (clientId: string) => void;
}) {
  const selo = seloDoEstado(grupo.estado, grupo.atrasados.length, grupo.faltam);
  const totalAtribuir = grupo.paraAtribuir.reduce((n, g) => n + g.cards.length, 0);
  const vazio = grupo.andamento.length === 0 && grupo.atrasados.length === 0;
  return (
    <section
      className="cs-grupo"
      data-cliente={grupo.clientId}
      data-estado={grupo.estado}
      data-aberto={aberto ? 'true' : 'false'}
      aria-label={`Semana de ${grupo.clientName}`}
    >
      <h3 className="cs-grupo-titulo">
        <button
          type="button"
          className="cs-grupo-botao"
          aria-expanded={aberto}
          aria-controls={idDoCorpo(grupo.clientId)}
          onClick={() => aoAlternar(grupo.clientId)}
        >
          <span className="cs-seta" aria-hidden="true" />
          <span className="cs-grupo-nome">{grupo.clientName}</span>
          <Selo tom={selo.tom}>{selo.texto}</Selo>
          {totalAtribuir > 0 && (
            <span className="cs-grupo-atribuir tnum" title="Cards esperando atribuição">
              {totalAtribuir} p/ atribuir
            </span>
          )}
          <span className="cs-barras">
            {grupo.barras.map((b) => (
              <BarraDeProgresso key={b.type} b={b} />
            ))}
          </span>
        </button>
      </h3>

      <div id={idDoCorpo(grupo.clientId)} className="cs-grupo-corpo" hidden={!aberto}>
        {grupo.andamento.length > 0 && (
          <div className="cs-parte" data-parte="andamento">
            <h4 className="cs-sub">Andamento</h4>
            <ul className="cs-andamento">
              {grupo.andamento.map((l) => (
                <li key={`${l.clientId}-${l.type ?? 'sem'}`} data-tipo={l.type ?? 'sem-tipo'}>
                  <span className="cs-andamento-tipo">{rotuloDoTipo(l.type)}</span>
                  <span className="cs-etapa"><span className="cs-etapa-nome">Aguardando</span> <b className="tnum" data-coluna="aguardando">{l.awaiting}</b></span>
                  <span className="cs-etapa"><span className="cs-etapa-nome">Por fazer</span> <b className="tnum" data-coluna="por-fazer">{l.todo}</b></span>
                  <span className="cs-etapa"><span className="cs-etapa-nome">Em andamento</span> <b className="tnum" data-coluna="em-andamento">{l.doing}</b></span>
                  <span className="cs-etapa"><span className="cs-etapa-nome">Feito</span> <b className="tnum" data-coluna="feito">{l.done}</b></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {grupo.atrasados.length > 0 && (
          <div className="cs-parte" data-parte="atrasados">
            <h4 className="cs-sub">Atrasados</h4>
            <ul className="cs-lista">
              {grupo.atrasados.map((a: CardAtrasado) => (
                <li key={a.id} data-atrasado={a.id}>
                  <span>
                    <Link to={`/tarefa/${a.id}`} className="cs-card-titulo">
                      {a.title}
                    </Link>
                    <span className="cs-card-origem">
                      {' '}
                      {rotuloDoTipo(a.type)} · venceu em {prazoCurto(a.dueOn)}
                    </span>
                  </span>
                  <span className="cs-responsavel">
                    {a.assignees.length === 0 ? 'Sem responsável' : a.assignees.map((p) => p.name).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {vazio && (
          <p className="cs-vazio" data-vazio="grupo">
            {totalAtribuir > 0 ? 'Os cards deste cliente esperam atribuição no bloco “Para atribuir”.' : 'Nada em produção para este cliente nesta semana.'}
          </p>
        )}

        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm cs-abrir-lista"
          aria-label={`Abrir a lista de ${grupo.clientName} no quadro`}
          onClick={() => aoAbrirCliente(grupo.clientId)}
        >
          Abrir no quadro
        </button>
      </div>
    </section>
  );
}

function LinhaParaAtribuir({
  card,
  tipo,
  pessoas,
  aoLiberar,
}: {
  card: CardParaAtribuir;
  tipo: TipoDoGrupo;
  pessoas: readonly Pessoa[];
  aoLiberar: AoLiberar;
}) {
  const [escolha, setEscolha] = useState<EscolhaDaLinha>({ pessoaId: '', prazo: card.suggestedDueOn ?? '', tipo: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const parado = porQueOOkEstaParado(tipo, escolha);

  async function ok() {
    if (parado !== null || ocupado) return;
    setOcupado(true);
    setErro(null);
    const recusa = await aoLiberar(card, tipo, escolha);
    // Deu certo: a leitura recarrega e a linha sai — este componente desmonta.
    if (recusa !== null) setErro(recusa);
    setOcupado(false);
  }

  return (
    <li className="cs-card" data-card={card.id} data-sem-tipo={tipo === null ? 'true' : undefined}>
      <div className="cs-card-texto">
        <Selo tom={tipo === null ? 'warn' : 'neutro'}>{rotuloDoTipo(tipo)}</Selo>
        <Link to={`/tarefa/${card.id}`} className="cs-card-titulo">
          {card.title}
        </Link>
        <span className="cs-card-prazo tnum" data-sem-data={card.suggestedDueOn === null ? 'true' : undefined}>
          {card.suggestedDueOn === null ? 'Sem data' : `Sugerido: ${prazoCurto(card.suggestedDueOn)}`}
        </span>
        <span className="cs-card-origem">
          {card.createdBy ? `por ${card.createdBy.name} · ` : ''}
          {card.list.name}
        </span>
      </div>

      <div className="cs-card-acoes">
        {tipo === null && (
          <select
            className="o-campo o-select cs-campo"
            aria-label={`Tipo de ${card.title}`}
            value={escolha.tipo}
            disabled={ocupado}
            onChange={(e) => setEscolha({ ...escolha, tipo: e.target.value })}
          >
            <option value="">Escolha o tipo</option>
            {OPCOES_DO_TIPO.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <select
          className="o-campo o-select cs-campo"
          aria-label={`Pessoa para ${card.title}`}
          value={escolha.pessoaId}
          disabled={ocupado}
          onChange={(e) => setEscolha({ ...escolha, pessoaId: e.target.value })}
        >
          <option value="">Escolha a pessoa</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="o-campo cs-campo cs-campo-data"
          aria-label={`Prazo de ${card.title}`}
          value={escolha.prazo}
          disabled={ocupado}
          onChange={(e) => setEscolha({ ...escolha, prazo: e.target.value })}
        />
        <button
          type="button"
          className="o-btn o-btn-solido o-btn-sm"
          disabled={parado !== null || ocupado}
          title={parado ?? undefined}
          aria-label={`OK, liberar ${card.title}`}
          onClick={() => void ok()}
        >
          OK
        </button>
      </div>

      {tipo === null && escolha.tipo === '' && <p className="cs-dica">{parado}</p>}
      {erro !== null && (
        <p className="cs-erro" role="alert">
          {erro}
        </p>
      )}
    </li>
  );
}
