/**
 * A grade da aba Semana do Planejamento — F35, Fase 3 (só leitura).
 *
 * O QUE ELA RESPONDE
 *   "Cliente a cliente, onde a produção está atrás neste mês?" — uma linha por
 *   tipo contratado, uma coluna por semana, e o mês inteiro numa tela. Substitui
 *   a aba Outubro da planilha "IDE DEMANDAS" (Resp. · Cliente · Semana).
 *
 * APRESENTAÇÃO PURA
 *   Recebe os clientes crus do servidor, o mês e o HOJE por props, e não tem
 *   efeito nenhum: o teste desenha com `renderToStaticMarkup`, onde `useEffect`
 *   não roda (ver a memória "os testes desenham no servidor"). A rolagem até a
 *   semana atual, que precisa do navegador, é da página.
 *
 * NADA DE CONTA AQUI
 *   Meta, sinal e estado saem de `planejarSemanas` (Fase 1). Esta tela só
 *   agrupa e desenha — uma segunda cópia da regra ficaria para trás na primeira
 *   mudança, como a do ritual na aba Mês.
 *
 * POR RESPONSÁVEL, E O CLIENTE DE DOIS APARECE NOS DOIS
 *   Decisão do Wesley em 01/10/2026: cada líder lê o próprio grupo inteiro, sem
 *   ter de lembrar que o cliente dividido mora "no outro". O total do topo conta
 *   o cliente uma vez só.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Ajuda } from '@/board/menus';

import type { ContentType } from '@/delivery/level';
import { type Semana, intervaloDaSemana, semanasDoMes } from '@/delivery/semanas';
import {
  type CelulaDaSemana,
  type GrupoPorResponsavel,
  type PlanejamentoDoCliente,
  type SinalNaSemana,
  agruparPorResponsavel as agruparPorResponsavelDoPlanejamento,
  planejarSemanas,
  // "Esta semana" mora na regra pura (F43 também a usa); a grade só a chama.
  semanaDeHoje,
} from '@/painel/planejamento-semanal';
import type { PlanningWeeksRow } from '@/server/planning-weeks';
import { type EntradaDoMes, TIPO_ROTULO } from '@/ui/grade-do-mes';

export type ClienteDaSemana = PlanningWeeksRow;

export type LinhaDaGrade = ClienteDaSemana & { planejamento: PlanejamentoDoCliente };

export type GrupoDaGrade = GrupoPorResponsavel<LinhaDaGrade>;

/**
 * O `+` de uma célula pediu para criar — F35, Fase 4. A grade só AVISA: quem
 * abre o seletor de dia e grava é a página. `ancora` é o próprio `+`, para o
 * balão nascer preso a ele (e fora da rolagem lateral, que o cortaria).
 */
export type PedidoDeCriacao = {
  cliente: ClienteDaSemana;
  tipo: ContentType;
  semana: Semana;
  ancora: HTMLElement;
};

/** "Criar arte na semana 2 de Bluesky" — o nome do `+` para o leitor de tela. */
export function rotuloDeCriar(tipo: ContentType, semana: number, cliente: string): string {
  return `Criar ${(TIPO_ROTULO[tipo] ?? tipo).toLowerCase()} na semana ${semana} de ${cliente}`;
}

/**
 * OS `?` DA ABA — F35, Fase 5. Cada função nova explica o que faz e de onde
 * vem o número. Os textos moram aqui, e não espalhados no JSX, para o teste
 * cobrar a frase inteira e para uma revisão de texto achar todos num lugar.
 */
export const EXPLICACAO = {
  aba: 'Uma linha por cliente ativo. Cada sinal é uma entrega agendada naquela semana — a mesma do Calendário e da ficha do cliente. Marcar ✓ aqui ou lá é a mesma coisa.',
  semana:
    'Meta = cota do mês do cliente dividida pelos dias úteis de cada semana. A peça conta na semana em que está agendada, não na que foi concluída.',
  emRisco: 'Falta peça agendada para bater a meta, ou o que falta concluir não cabe nos dias úteis que sobram.',
  mes: 'Concluídas no mês sobre a cota do contrato do mês (ou a cota do cadastro, se o mês não foi aberto).',
  semCota: 'Este cliente não tem cota mensal de conteúdo; não entra na conta de atraso.',
} as const;

/**
 * O assunto de cada `?` — vira `aria-label="Explicar: …"` e o título do balão.
 * F43, Fase 2: a aba Semana virou a visão Semanas (`?visao=semanas`); o `?`
 * diz o nome que está escrito na tela.
 */
export const SOBRE = {
  aba: 'a visão Semanas',
  semana: 'a meta de cada semana',
  emRisco: 'em risco',
  mes: 'a coluna Mês',
  semCota: 'sem cota',
} as const;

/**
 * O `?` de sempre (`Ajuda`, F17.24 — botão de verdade, balão em portal, então a
 * rolagem lateral da grade não o corta), dentro de um invólucro PRÓPRIO desta
 * aba: `.pls-ajuda` só aparece com ponteiro fino (ver a folha). No toque não há
 * onde "passar o mouse para entender", e a grade já é apertada a 390px — lá o
 * `?` some. Os ~30 `?` do resto do app não mudam.
 */
function AjudaDaSemana({ sobre, children }: { sobre: string; children: ReactNode }) {
  return (
    <span className="pls-ajuda">
      <Ajuda sobre={sobre}>{children}</Ajuda>
    </span>
  );
}

/**
 * Agrupa por responsável. A regra mora em `planejamento-semanal.ts` (a leitura
 * `get_planning_weeks` das integrações usa a mesma); aqui só ganha o tipo da tela.
 */
export function agruparPorResponsavel(linhas: readonly LinhaDaGrade[]): GrupoDaGrade[] {
  return agruparPorResponsavelDoPlanejamento(linhas);
}

const SIMBOLO: Record<SinalNaSemana['sinal'], string> = { feita: '✓', agendada: '●', atrasada: '✕' };
const ROTULO_DO_SINAL: Record<SinalNaSemana['sinal'], string> = {
  feita: 'concluída',
  agendada: 'agendada',
  atrasada: 'atrasada',
};

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A peça como o Calendário a abre — a mesma janela, `MarcarNoDia`. */
function comoEntrada(cliente: ClienteDaSemana, tipo: ContentType, s: SinalNaSemana): EntradaDoMes {
  return {
    kind: 'delivery',
    id: s.id,
    clientId: cliente.id,
    clientName: cliente.name,
    contentType: tipo,
    day: s.dia,
    time: null,
    title: s.title,
    isExtra: s.isExtra,
    isCompleted: s.sinal === 'feita',
    notes: null,
  };
}

function Sinais({
  cliente,
  tipo,
  sinais,
  vagas,
  aoAbrirPeca,
}: {
  cliente: ClienteDaSemana;
  tipo: ContentType;
  sinais: readonly SinalNaSemana[];
  vagas: number;
  aoAbrirPeca: (entrada: EntradaDoMes) => void;
}) {
  if (sinais.length === 0 && vagas === 0) return null;
  return (
    <span className="pls-sinais">
      {sinais.map((s) => {
        const nome = s.title?.trim() || `${TIPO_ROTULO[tipo] ?? tipo} sem título`;
        const descricao = `${nome} · ${diaCurto(s.dia)} · ${ROTULO_DO_SINAL[s.sinal]}${s.isExtra ? ' · extra' : ''}`;
        return (
          <button
            key={s.id}
            type="button"
            className="pls-sinal"
            data-sinal={s.sinal}
            title={descricao}
            aria-label={`Abrir ${descricao}`}
            onClick={() => aoAbrirPeca(comoEntrada(cliente, tipo, s))}
          >
            {SIMBOLO[s.sinal]}
          </button>
        );
      })}
      {Array.from({ length: vagas }, (_, i) => (
        <span key={`vaga-${i}`} className="pls-sinal" data-sinal="vaga" aria-hidden="true">
          ·
        </span>
      ))}
      {vagas > 0 && <span className="sr-only">{plural(vagas, 'vaga sem peça', 'vagas sem peça')}</span>}
    </span>
  );
}

function Celula({
  cliente,
  tipo,
  celula,
  extra,
  atual,
  aoAbrirPeca,
  aoCriar,
  ocupado,
}: {
  cliente: ClienteDaSemana;
  tipo: ContentType;
  celula: CelulaDaSemana;
  extra: boolean;
  atual: boolean;
  aoAbrirPeca: (entrada: EntradaDoMes) => void;
  aoCriar?: (pedido: PedidoDeCriacao) => void;
  ocupado: boolean;
}) {
  const vagas = extra ? 0 : Math.max(0, celula.meta - celula.sinais.length);
  const rotulo = rotuloDeCriar(tipo, celula.semana.numero, cliente.name);
  return (
    <td className="pls-celula" data-estado={extra ? 'neutra' : celula.estado} data-atual={atual || undefined}>
      <span className="pls-celula-dentro">
        <Sinais cliente={cliente} tipo={tipo} sinais={celula.sinais} vagas={vagas} aoAbrirPeca={aoAbrirPeca} />
        {!extra && celula.meta + celula.feito > 0 && (
          <span className="pls-placar tnum">
            {celula.feito}/{celula.meta}
          </span>
        )}
        {/* O `+` — F35, Fase 4. Só aparece com o ponteiro sobre a célula; no
            toque fica sempre à vista (a regra é da folha). O tipo é o da
            sublinha, inclusive a "(extra)": quem decide se a peça nasce extra
            é o servidor, com a cota do mês. */}
        {aoCriar && (
          <button
            type="button"
            className="pls-mais"
            aria-label={rotulo}
            title={rotulo}
            aria-haspopup="dialog"
            disabled={ocupado}
            onClick={(e) => aoCriar({ cliente, tipo, semana: celula.semana, ancora: e.currentTarget })}
          >
            +
          </button>
        )}
      </span>
    </td>
  );
}

function LinhasDoCliente({
  linha,
  grupo,
  atual,
  aoAbrirPeca,
  aoCriar,
  ocupado,
}: {
  linha: LinhaDaGrade;
  grupo: string;
  atual: number | null;
  aoAbrirPeca: (entrada: EntradaDoMes) => void;
  aoCriar?: (pedido: PedidoDeCriacao) => void;
  ocupado: boolean;
}) {
  const { planejamento: p } = linha;
  const nome = (
    <Link to={`/cliente/${linha.id}`} className="pls-nome">
      {linha.name}
    </Link>
  );
  const marca = p.emRisco ? 'risco' : p.abaixo ? 'abaixo' : undefined;

  /* SEM COTA: UMA LINHA SÓ, SEM COR. As peças que existirem continuam
     clicáveis (todas as sublinhas juntas na mesma célula), mas sem meta nem
     placar — não há contrato para medir atraso.

     E SEM `+` (F35, Fase 4): a linha única não tem tipo, e o `+` cria "uma
     arte" ou "um vídeo". Criar para cliente sem contrato é a ficha dele. */
  if (p.semCota) {
    return (
      <tr className="pls-linha" data-cliente={linha.id} data-grupo={grupo} data-sem-cota="">
        <th scope="row" className="pls-quem">
          {nome}
          <span className="pls-tipo pls-sem-cota">sem cota</span>
        </th>
        {p.semanas.map((s, i) => (
          <td key={s.numero} className="pls-celula" data-estado="neutra" data-atual={s.numero === atual || undefined}>
            <span className="pls-celula-dentro">
              {p.tipos.map((t) => (
                <Sinais
                  key={t.tipo}
                  cliente={linha}
                  tipo={t.tipo}
                  sinais={t.celulas[i].sinais}
                  vagas={0}
                  aoAbrirPeca={aoAbrirPeca}
                />
              ))}
            </span>
          </td>
        ))}
        <td className="pls-mes">
          {(() => {
            const semDia = p.tipos.reduce((n, t) => n + t.mes.semDia, 0);
            return semDia > 0 ? <span className="pls-sem-dia">+{semDia} sem dia</span> : null;
          })()}
        </td>
      </tr>
    );
  }

  // Os tipos com cota primeiro; as sublinhas "(extra)" depois — o que se mede
  // vem antes do que só aparece porque existe.
  const tipos = [...p.tipos].sort((a, b) => Number(a.semCotaDoTipo) - Number(b.semCotaDoTipo));

  return (
    <>
      {tipos.map((t, i) => {
        const rotulo = `${TIPO_ROTULO[t.tipo] ?? t.tipo}${t.semCotaDoTipo ? ' (extra)' : ''}`;
        return (
          <tr
            key={t.tipo}
            className="pls-linha"
            data-cliente={linha.id}
            data-grupo={grupo}
            data-primeira={i === 0 || undefined}
            data-marca={i === 0 ? marca : undefined}
          >
            <th scope="row" className="pls-quem">
              {/* O selo é do CLIENTE, não do tipo: mora na linha do nome. */}
              {i === 0 ? (
                <span className="pls-quem-linha">
                  {nome}
                  {p.emRisco && <span className="pls-selo" data-tom="warn">em risco</span>}
                  {!p.emRisco && p.abaixo && <span className="pls-selo" data-tom="err">abaixo</span>}
                </span>
              ) : (
                <span className="sr-only">{linha.name}</span>
              )}
              <span className="pls-tipo">{rotulo}</span>
            </th>
            {t.celulas.map((c) => (
              <Celula
                key={c.semana.numero}
                cliente={linha}
                tipo={t.tipo}
                celula={c}
                extra={t.semCotaDoTipo}
                atual={c.semana.numero === atual}
                aoAbrirPeca={aoAbrirPeca}
                aoCriar={aoCriar}
                ocupado={ocupado}
              />
            ))}
            <td className="pls-mes">
              <span className="pls-placar tnum">
                {t.semCotaDoTipo ? plural(t.mes.feito, 'feita', 'feitas') : `${t.mes.feito}/${t.mes.cota}`}
              </span>
              {t.mes.semDia > 0 && <span className="pls-sem-dia">+{t.mes.semDia} sem dia</span>}
              {t.mes.foraDoMes > 0 && <span className="pls-sem-dia">+{t.mes.foraDoMes} fora do mês</span>}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function GradeDaSemana({
  mes,
  hoje,
  clientes,
  aoAbrirPeca,
  aoCriar,
  ocupado = false,
}: {
  /** `YYYY-MM`. */
  mes: string;
  /** `YYYY-MM-DD`, no fuso da agência. */
  hoje: string;
  clientes: readonly ClienteDaSemana[];
  aoAbrirPeca: (entrada: EntradaDoMes) => void;
  /** Ausente, a grade não desenha `+` nenhum (só leitura). */
  aoCriar?: (pedido: PedidoDeCriacao) => void;
  /** Uma criação em curso: os `+` ficam desabilitados até ela voltar. */
  ocupado?: boolean;
}) {
  const linhas: LinhaDaGrade[] = clientes.map((c) => ({
    ...c,
    planejamento: planejarSemanas({ mes, cota: c.quota, pecas: c.items, hoje }),
  }));
  const grupos = agruparPorResponsavel(linhas);
  // As semanas são as do mês, iguais para todo cliente.
  const semanas = semanasDoMes(mes);
  const atual = semanaDeHoje({ semanas }, hoje);

  // O TOTAL DO TOPO CONTA CADA CLIENTE UMA VEZ — mesmo o que aparece em dois grupos.
  const emRisco = linhas.filter((l) => l.planejamento.emRisco).length;
  const abaixo = linhas.filter((l) => l.planejamento.abaixo).length;
  const colunas = semanas.length + 2;
  // Quantos ainda medem pela cota do cadastro (mês do contrato não aberto) —
  // a origem vem do servidor (`quotaSource`, Fase 2); o `?` do Mês diz isso.
  const doCadastro = linhas.filter((l) => l.quotaSource === 'cadastro').length;

  return (
    <div className="pls">
      {/* O `?` da aba fica FORA do `role="status"`: um botão dentro da região
          viva seria relido a cada recarga. */}
      <div className="pls-topo">
        <p className="pls-total" role="status">
          <span className="tnum">{plural(linhas.length, 'cliente', 'clientes')}</span>
          {' · '}
          <span className="tnum" data-tom={emRisco > 0 ? 'warn' : undefined}>
            {emRisco} em risco
          </span>
          {' · '}
          <span className="tnum" data-tom={abaixo > 0 ? 'err' : undefined}>
            {abaixo} abaixo da meta
          </span>
        </p>
        <AjudaDaSemana sobre={SOBRE.aba}>{EXPLICACAO.aba}</AjudaDaSemana>
      </div>

      {/* "EM RISCO" E "SEM COTA" SE EXPLICAM NA LEGENDA, UMA VEZ — decisão da
          Fase 5. Um `?` em cada selo e em cada linha sem cota repetiria a
          mesma frase dez vezes numa grade já cheia; a legenda é onde se lê o
          vocabulário da tela, e é lá que os dois aparecem com a mesma cara
          que têm nas linhas. */}
      <ul className="pls-legenda" aria-label="Legenda">
        <li><span className="pls-sinal" data-sinal="feita" aria-hidden="true">✓</span> concluída</li>
        <li><span className="pls-sinal" data-sinal="agendada" aria-hidden="true">●</span> agendada</li>
        <li><span className="pls-sinal" data-sinal="atrasada" aria-hidden="true">✕</span> atrasada</li>
        <li><span className="pls-sinal" data-sinal="vaga" aria-hidden="true">·</span> vaga sem peça</li>
        <li>
          <span className="pls-selo" data-tom="warn">em risco</span>
          <AjudaDaSemana sobre={SOBRE.emRisco}>{EXPLICACAO.emRisco}</AjudaDaSemana>
        </li>
        <li>
          <span className="pls-sem-cota">sem cota</span>
          <AjudaDaSemana sobre={SOBRE.semCota}>{EXPLICACAO.semCota}</AjudaDaSemana>
        </li>
      </ul>

      <div className="pls-rolagem" data-pls-rolagem="">
        <table className="pls-tabela">
          <thead>
            <tr>
              <th scope="col" className="pls-quem pls-cabeca">Cliente</th>
              {semanas.map((s) => (
                <th
                  key={s.numero}
                  scope="col"
                  className="pls-cabeca pls-semana"
                  data-atual={s.numero === atual || undefined}
                  aria-current={s.numero === atual ? 'date' : undefined}
                >
                  {/* O `?` da meta só na primeira semana: a regra é a mesma nas
                      cinco, e cinco `?` iguais seriam ruído no cabeçalho. */}
                  {s.numero === 1 ? (
                    <span className="pls-semana-n">
                      Semana {s.numero}
                      <AjudaDaSemana sobre={SOBRE.semana}>{EXPLICACAO.semana}</AjudaDaSemana>
                    </span>
                  ) : (
                    <span className="pls-semana-n">Semana {s.numero}</span>
                  )}
                  <span className="pls-semana-dias tnum">{intervaloDaSemana(s)}</span>
                  {s.numero === atual && <span className="cl-agora">agora</span>}
                </th>
              ))}
              <th scope="col" className="pls-cabeca pls-mes">
                Mês
                <AjudaDaSemana sobre={SOBRE.mes}>
                  <p>{EXPLICACAO.mes}</p>
                  {doCadastro > 0 && (
                    <p>
                      Neste mês, {plural(doCadastro, 'cliente usa', 'clientes usam')} a cota do cadastro.
                    </p>
                  )}
                </AjudaDaSemana>
              </th>
            </tr>
          </thead>
          {grupos.map((g) => (
            <tbody key={g.id ?? 'sem-responsavel'} className="pls-grupo" data-grupo={g.id ?? 'sem-responsavel'}>
              <tr className="pls-grupo-cabeca">
                <th scope="colgroup" colSpan={colunas}>
                  <span className="pls-grupo-titulo">
                    {g.nome} ({plural(g.linhas.length, 'cliente', 'clientes')})
                    {' · '}
                    <span data-tom={g.emRisco > 0 ? 'warn' : undefined}>{g.emRisco} em risco</span>
                  </span>
                </th>
              </tr>
              {g.linhas.map((l) => (
                <LinhasDoCliente
                  key={l.id}
                  linha={l}
                  grupo={g.id ?? 'sem-responsavel'}
                  atual={atual}
                  aoAbrirPeca={aoAbrirPeca}
                  aoCriar={aoCriar}
                  ocupado={ocupado}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
