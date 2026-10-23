/**
 * A grade do mês — etapa F17.40.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA SAIU DE DENTRO DA TELA DO CALENDÁRIO
 *
 *   Ela nasceu dentro de `src/pages/Calendario.tsx`, e era a única do sistema.
 *   Quando o cliente ganhou o mês dele, havia duas saídas: copiar a grade, ou
 *   tirá-la de lá.
 *
 *   Duas grades de mês divergem no primeiro ajuste — alguém mexe na altura da
 *   célula de um lado e o outro fica para trás, e a partir daí "o calendário"
 *   passa a ser duas coisas com o mesmo nome. O projeto já pagou esse preço
 *   duas vezes: os ícones da árvore (F17.25) e a trilha do lugar (F17.26)
 *   tiveram de ser recolhidos para um módulo comum depois de duplicados.
 *
 *   Então a grade mora aqui, e as duas telas a pedem.
 *
 * A ÚNICA DIFERENÇA ENTRE AS DUAS TELAS É A LENTE
 *   De fora do cliente, cada conteúdo precisa dizer DE QUEM é, e clicar nele
 *   leva à ficha. De dentro da ficha, isso já se sabe — então o conteúdo diz
 *   O QUE é, e não leva a lugar nenhum, porque o lugar é onde já se está.
 *
 *   É um botão só, e não três parâmetros de aparência: parâmetro de aparência é
 *   o caminho de volta para duas grades, com passos intermediários.
 *
 * AS CONTAS DE DIA E OS RÓTULOS MORAM EM `grade-do-mes.ts`
 *   Aqui só o desenho. Lá o que dá para provar sem navegador — e é lá que está
 *   escrito por que nada disto passa por `Date`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A GRADE DEIXOU DE SER VISOR — F17.44
 *
 *   *"Sendo que eles não possuem botão de +? Onde são adicionadas essas
 *   entregas? Compromissos?"* — o usuário tem razão, e a grade era só desenho.
 *
 *   As duas alças são opcionais, e é assim que a peça continua servindo a quem
 *   só quer ver: sem `aoMarcarNoDia`, o número do dia volta a ser um número;
 *   sem `aoAbrirEntrada`, a pastilha volta a ser o que era. Nenhuma tela ganha
 *   comportamento por acidente.
 *
 *   ⚠️ NA LENTE `de-todos`, A PASTILHA DEIXA DE SER UM ATALHO PARA A FICHA
 *   quando `aoAbrirEntrada` chega. Não dá para ter o mesmo clique fazendo duas
 *   coisas, e a etapa é sobre marcar e corrigir. A ficha não fica longe: a
 *   janela que abre traz o caminho para ela, e a perda é um clique.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * LEITURA DE DIA CHEIO E AGENDA — F12 do plano UX (R06 da revisão de 28/09)
 *
 *   O calendário geral de setembro tinha 117 conteúdos. A casa crescia com o
 *   dia, a primeira metade do mês empurrava a segunda para fora da tela, e os
 *   nomes saíam truncados a 11 px e RISCADOS quando concluídos — riscar o nome
 *   inteiro tirava justamente o que se queria ler.
 *
 *   Agora:
 *     · a casa tem teto (`TETO_DA_CASA`) e o resto vira "+N", que expande a
 *       casa ali mesmo — toda semana tem a mesma altura até alguém pedir;
 *     · a pastilha tem 12 px e o ÍCONE do tipo, que dá a forma E a cor — duas
 *       pistas, e nenhuma depende só da cor (até a F43 Fase 5 a cor era um
 *       fio de 3px e um fundo tingido; ver `corDoTipo`);
 *     · concluído leva um visto e letra um degrau mais baixa (`--mute`, 7,2:1),
 *       sem risco: o nome continua legível;
 *     · o nome acessível diz cliente, tipo, título ou "sem título", dia e
 *       estado (`nomeAcessivelDaEntrada`, que reusa `nomeDoItem` da F11C);
 *     · HOJE tem marca própria (verde da marca) e `aria-current="date"`;
 *     · a AGENDA é a mesma leitura em lista por dia: as mesmas entradas, a
 *       mesma janela de marcar e o mesmo clique — nenhuma busca nova.
 *
 *   No celular a grade não escreve nomes (sete colunas de 50 px não leem
 *   nada): cada casa mostra quantos itens tem, e tocar leva ao dia na agenda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Check } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { IconeAds, IconeArte, IconeFoto, IconeRelogio, IconeVideo } from '@/ui/Icones';
import {
  DIAS_DA_SEMANA,
  type EntradaDoMes,
  type Janela,
  type Lente,
  casasDoMes,
  corDaEntrada,
  detalheDaEntrada,
  diaCurtoDaSemana,
  diasDaAgenda,
  ehCompromisso,
  hojeNaAgencia,
  nomeAcessivelDaEntrada,
  nomeDoDia,
  nomeDoMes,
  ordenarNoDia,
  porDia,
  recorteDaCasa,
  rotuloDaEntrada,
  tipoDaEntrada,
} from '@/ui/grade-do-mes';

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Rolagem suave só para quem não pediu menos movimento. */
const comoRolar = (): ScrollBehavior => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'auto';
  }
};

/** Pedido de levar o olho a um dia — `n` muda a cada clique, para repetir. */
export type FocoNoDia = { dia: string; n: number };

type Alcas = {
  /** Sem isto o dia é só um número — a grade continua sendo um visor. */
  aoMarcarNoDia?: (dia: string) => void;
  /** Sem isto a pastilha não abre nada (na lente `de-todos`, leva à ficha). */
  aoAbrirEntrada?: (entrada: EntradaDoMes) => void;
};

/**
 * O ícone de um tipo de conteúdo — ou o relógio, para `compromisso`.
 *
 * Exportado desde a F43 Fase 5: a cor do tipo passou a morar NO ÍCONE, e a
 * legenda do calendário e a escolha de tipo da janela de marcar precisam do
 * mesmo desenho que a pastilha. Três cópias do `switch` seriam três chances de
 * a arte ter um ícone num lugar e outro no vizinho.
 */
export function IconeDoTipoDeConteudo({ tipo, className = 'cal-icone' }: { tipo: string; className?: string }) {
  switch (tipo) {
    case 'compromisso':
      return <IconeRelogio className={className} />;
    case 'video':
      return <IconeVideo className={className} />;
    case 'arte':
      return <IconeArte className={className} />;
    case 'foto':
      return <IconeFoto className={className} />;
    case 'ads':
      return <IconeAds className={className} />;
    default:
      return <span className={className} aria-hidden="true" />;
  }
}

function IconeDoTipo({ e, className }: { e: EntradaDoMes; className?: string }) {
  return <IconeDoTipoDeConteudo tipo={ehCompromisso(e) ? 'compromisso' : e.contentType} className={className} />;
}

/**
 * Uma entrada clicável — o MESMO gesto na grade e na agenda. Abre a janela de
 * marcar quando a tela deixa; senão, na lente de todos, leva à ficha.
 */
function Entrada({
  e,
  lente,
  classe,
  aoAbrirEntrada,
  children,
}: {
  e: EntradaDoMes;
  lente: Lente;
  classe: string;
  aoAbrirEntrada?: (entrada: EntradaDoMes) => void;
  children: ReactNode;
}) {
  const comum = {
    className: classe,
    style: { '--cal-cor': corDaEntrada(e) } as CSSProperties,
    title: detalheDaEntrada(e, lente),
    'aria-label': nomeAcessivelDaEntrada(e, lente),
    'data-estado': e.isCompleted ? 'concluido' : 'pendente',
    'data-natureza': ehCompromisso(e) ? 'compromisso' : 'entrega',
    'data-entrada': `${e.kind}:${e.id}`,
  };
  if (aoAbrirEntrada)
    return (
      <button type="button" aria-haspopup="dialog" onClick={() => aoAbrirEntrada(e)} {...comum}>
        {children}
      </button>
    );
  if (lente === 'de-todos')
    return (
      <Link to={`/cliente/${e.clientId}`} {...comum}>
        {children}
      </Link>
    );
  return <span {...comum}>{children}</span>;
}

/** O visto do concluído — desenho; o nome acessível já diz "concluído". */
const Visto = () => <Check className="cal-visto" size={13} strokeWidth={2.4} aria-hidden="true" />;

/* ─────────────────────────────── a grade ─────────────────────────────── */

export function GradeDoMes({
  mes,
  janela,
  entradas,
  lente,
  aoMarcarNoDia,
  aoAbrirEntrada,
  aoVerDia,
  hoje = hojeNaAgencia(),
  foco,
}: Alcas & {
  /** `AAAA-MM`. */
  mes: string;
  janela: Janela;
  entradas: EntradaDoMes[];
  lente: Lente;
  /**
   * No celular a casa vira um resumo que leva ao dia na agenda. Sem isto a
   * grade escreve os nomes em qualquer largura.
   */
  aoVerDia?: (dia: string) => void;
  /** `AAAA-MM-DD` no fuso da agência. */
  hoje?: string;
  foco?: FocoNoDia | null;
}) {
  const casas = useMemo(() => casasDoMes(mes), [mes]);
  const doDia = useMemo(() => porDia(entradas), [entradas]);
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());
  const raiz = useRef<HTMLDivElement>(null);

  const noPeriodo = (dia: string) => dia >= janela.from && dia < janela.to;

  // "Hoje" leva o olho à casa de hoje (rolagem da página, sem roubar o foco).
  useEffect(() => {
    if (!foco) return;
    const casa = raiz.current?.querySelector<HTMLElement>(`[data-dia="${foco.dia}"]`);
    casa?.scrollIntoView({ block: 'nearest', behavior: comoRolar() });
  }, [foco]);

  const alternar = (dia: string) =>
    setAbertas((atual) => {
      const nova = new Set(atual);
      if (nova.has(dia)) nova.delete(dia);
      else nova.add(dia);
      return nova;
    });

  return (
    <div className="cal-mes" ref={raiz} data-resumo-no-celular={aoVerDia ? 'sim' : undefined}>
      <div className="cal-semana" aria-hidden="true">
        {DIAS_DA_SEMANA.map((d, i) => (
          <div key={i} className="cal-semana-dia">
            <span className="cal-semana-longo">{DIAS_CURTOS[i]}</span>
            <span className="cal-semana-curto">{d}</span>
          </div>
        ))}
      </div>

      <div className="cal-grade">
        {casas.map((dia, i) => {
          if (dia === null) return <div key={`vazio-${i}`} className="cal-casa" data-vazia="sim" />;
          const lista = ordenarNoDia(doDia.get(dia) ?? []);
          const aberta = abertas.has(dia);
          const { mostrar, escondidos } = recorteDaCasa(lista, aberta);
          const ehHoje = dia === hoje;
          const numero = Number(dia.slice(8, 10));
          return (
            <div
              key={dia}
              className="cal-casa"
              data-dia={dia}
              data-fora={noPeriodo(dia) ? undefined : 'sim'}
              data-hoje={ehHoje ? 'sim' : undefined}
              data-aberta={aberta ? 'sim' : undefined}
              aria-current={ehHoje ? 'date' : undefined}
            >
              <div className="cal-casa-topo">
                <span className="cal-numero tnum">{numero}</span>
                {ehHoje && <span className="cal-hoje-rotulo">Hoje</span>}
                {aoMarcarNoDia && (
                  <button
                    type="button"
                    className="cal-marcar"
                    aria-label={`Marcar no dia ${numero}`}
                    aria-haspopup="dialog"
                    onClick={() => aoMarcarNoDia(dia)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
              </div>

              {lista.length > 0 && (
                <ul className="cal-lista">
                  {mostrar.map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <Entrada e={e} lente={lente} classe="cal-pastilha" aoAbrirEntrada={aoAbrirEntrada}>
                        <IconeDoTipo e={e} />
                        {e.time && <span className="cal-hora tnum">{e.time}</span>}
                        <span className="cal-pastilha-nome">{rotuloDaEntrada(e, lente)}</span>
                        {e.isExtra && (
                          <span className="cal-extra" aria-hidden="true">
                            +
                          </span>
                        )}
                        {e.isCompleted && <Visto />}
                      </Entrada>
                    </li>
                  ))}
                </ul>
              )}

              {(escondidos > 0 || aberta) && (
                <button
                  type="button"
                  className="cal-mais"
                  aria-expanded={aberta}
                  aria-label={
                    aberta
                      ? `Mostrar menos no dia ${numero}`
                      : /* O texto visível ("+4 mais") entra no nome, inteiro — WCAG 2.5.3. */
                        `+${escondidos} mais: mostrar tudo no dia ${numero}`
                  }
                  onClick={() => alternar(dia)}
                >
                  {aberta ? 'Mostrar menos' : `+${escondidos} mais`}
                </button>
              )}

              {aoVerDia && lista.length > 0 && (
                <button
                  type="button"
                  className="cal-resumo"
                  aria-label={`Ver ${lista.length === 1 ? 'o item' : `os ${lista.length} itens`} do dia ${numero} na agenda`}
                  onClick={() => aoVerDia(dia)}
                >
                  <span className="cal-resumo-pontos" aria-hidden="true">
                    {lista.slice(0, 3).map((e) => (
                      <span
                        key={`${e.kind}-${e.id}`}
                        className="cal-ponto"
                        data-estado={e.isCompleted ? 'concluido' : 'pendente'}
                        style={{ '--cal-cor': corDaEntrada(e) } as CSSProperties}
                      />
                    ))}
                  </span>
                  <span className="cal-resumo-n tnum" aria-hidden="true">
                    {lista.length}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────── a agenda ─────────────────────────────── */

/**
 * A agenda do mês — os dias que têm alguma coisa, um embaixo do outro, e hoje
 * sempre. Cada linha diz o tipo por extenso, o nome inteiro (sem truncar) e o
 * estado por escrito. É a forma padrão no celular e a alternativa no desktop.
 */
export function AgendaDoMes({
  mes,
  janela,
  entradas,
  lente,
  aoMarcarNoDia,
  aoAbrirEntrada,
  hoje = hojeNaAgencia(),
  foco,
  carregando = false,
}: Alcas & {
  mes: string;
  janela: Janela;
  entradas: EntradaDoMes[];
  lente: Lente;
  hoje?: string;
  foco?: FocoNoDia | null;
  carregando?: boolean;
}) {
  const dias = useMemo(() => diasDaAgenda(entradas, janela, hoje), [entradas, janela, hoje]);
  const raiz = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!foco) return;
    const alvo = raiz.current?.querySelector<HTMLElement>(`[data-dia="${foco.dia}"] .cal-agenda-titulo`);
    if (!alvo) return;
    alvo.scrollIntoView({ block: 'start', behavior: comoRolar() });
    alvo.focus({ preventScroll: true });
  }, [foco, dias]);

  const temAlgo = dias.some((d) => d.entradas.length > 0);
  if (!temAlgo && !carregando) {
    return (
      <EstadoDaPagina tipo="vazio" titulo={`Nada marcado em ${nomeDoMes(mes)}.`}>
        {aoMarcarNoDia
          ? 'Use “+ Marcar” para agendar um conteúdo ou um compromisso.'
          : 'Quando houver conteúdo com data, ele aparece aqui, dia a dia.'}
      </EstadoDaPagina>
    );
  }

  return (
    <ol className="cal-agenda" ref={raiz}>
      {dias.map(({ dia, entradas: doDiaNaOrdemDoServidor }) => {
        const doDia = ordenarNoDia(doDiaNaOrdemDoServidor);
        const ehHoje = dia === hoje;
        const numero = Number(dia.slice(8, 10));
        return (
          <li
            key={dia}
            className="cal-agenda-dia"
            data-dia={dia}
            data-hoje={ehHoje ? 'sim' : undefined}
            aria-current={ehHoje ? 'date' : undefined}
          >
            <div className="cal-agenda-data" aria-hidden="true">
              <span className="cal-agenda-dow">{diaCurtoDaSemana(dia)}</span>
              <span className="cal-agenda-num tnum">{numero}</span>
            </div>
            <div className="cal-agenda-corpo">
              <div className="cal-agenda-cabeca">
                <h3 className="cal-agenda-titulo" tabIndex={-1}>
                  {nomeDoDia(dia)}
                  {ehHoje && <span className="cal-hoje-rotulo">Hoje</span>}
                </h3>
                {doDia.length > 0 && (
                  <span className="cal-agenda-conta tnum">
                    {doDia.length} {doDia.length === 1 ? 'item' : 'itens'}
                  </span>
                )}
                {aoMarcarNoDia && (
                  <button
                    type="button"
                    className="cal-marcar"
                    aria-label={`Marcar no dia ${numero}`}
                    aria-haspopup="dialog"
                    onClick={() => aoMarcarNoDia(dia)}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                )}
              </div>
              {doDia.length === 0 ? (
                <p className="cal-agenda-nada">Nada marcado para hoje.</p>
              ) : (
                <ul className="cal-agenda-lista">
                  {doDia.map((e) => (
                    <li key={`${e.kind}-${e.id}`}>
                      <Entrada e={e} lente={lente} classe="cal-linha" aoAbrirEntrada={aoAbrirEntrada}>
                        <span className="cal-linha-tipo">
                          <IconeDoTipo e={e} />
                          {tipoDaEntrada(e)}
                        </span>
                        <span className="cal-linha-texto">
                          <span className="cal-linha-nome">
                            {lente === 'de-todos'
                              ? e.clientName
                              : e.title?.trim() || (ehCompromisso(e) ? 'Compromisso' : 'Sem título')}
                          </span>
                          {lente === 'de-todos' && (
                            <span className="cal-linha-titulo">
                              {e.title?.trim() || (ehCompromisso(e) ? '' : 'Sem título')}
                            </span>
                          )}
                        </span>
                        <span className="cal-linha-meta">
                          {e.time ? <span className="tnum">{e.time}</span> : ehCompromisso(e) ? 'Dia inteiro' : null}
                          {e.isExtra && <span className="cal-linha-extra">Extra</span>}
                          <span className="cal-linha-estado">
                            {e.isCompleted ? (
                              <>
                                <Visto /> Concluído
                              </>
                            ) : ehCompromisso(e) ? null : (
                              'Pendente'
                            )}
                          </span>
                        </span>
                      </Entrada>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
