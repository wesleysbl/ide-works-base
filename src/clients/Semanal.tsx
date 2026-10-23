/**
 * A grade semanal — etapa F4.7.
 *
 * O QUE ELA É NO MODELO NOVO
 *   No Sistema IDE a grade é uma tabela de contadores por semana, separada do
 *   calendário. Os dois guardam o mesmo conteúdo, e por isso divergem: 88
 *   divergências de alvo e 153 linhas órfãs, medidas antes de começar.
 *
 *   Aqui não há contador. Cada quadradinho **é um item de conteúdo**, e a
 *   semana é a data dele. Marcar produção aqui e ver o post no calendário são
 *   a mesma escrita — não há o que reconciliar.
 *
 * A TELA MUDOU DE FUNÇÃO, E ISSO É DE PROPÓSITO
 *   Como a semana passou a sair da data, esta deixou de ser "onde se anota o
 *   que foi feito na semana" e virou **onde o mês contratado é distribuído nas
 *   semanas** — e depois marcado. Por isso o topo mostra contratado, agendado e
 *   sem data: a pergunta que ela responde primeiro é "o que ainda não tem dia?".
 *
 * O QUE O `−` APAGA, E O QUE ELE NUNCA APAGA
 *   Só item **não concluído**. Um `−` que apagasse produção já marcada
 *   destruiria o registro de trabalho feito com um clique, e sem confirmação.
 *   Quando só restam concluídos, o botão desliga e diz por quê.
 *
 * O DIA NÃO É MAIS ADIVINHADO — F17.42
 *   Havia aqui um `diaSugerido(s)`: hoje, quando hoje caía dentro da semana
 *   clicada. O comentário dizia que era "o que a pessoa quer dizer". Não era —
 *   quem opera esta tela está lançando o que JÁ ACONTECEU, muitas vezes com
 *   atraso, e hoje é o dia que quase nunca é o certo. A função morreu; os três
 *   caminhos que precisam de um dia (criar, datar o que não tem data, trocar o
 *   dia do que tem) passam pelo mesmo calendário, e nenhum deles grava nada
 *   antes de alguém clicar num dia. Ver `@/ui/SeletorDeDia`.
 */

import { useMemo, useState } from 'react';

import { Ajuda } from '@/board/menus';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { intervaloDaSemana, semanasDoMes } from '@/delivery/semanas';
import { nomesDosItens } from '@/clients/nome-do-item';
import { ApiError, api } from '@/lib/api';
import { IconeAds, IconeArte, IconeCalendario, IconeFoto, IconeVideo } from '@/ui/Icones';
import { diaDoInstante, meioDiaDoDia } from '@/ui/grade-do-mes';
import { type Faixa, SeletorDeDia } from '@/ui/SeletorDeDia';
import { Aviso, Barra, Selo } from '@/ui/primitivos';

export type ItemDaGrade = {
  id: string;
  contentType: string;
  scheduledAt: string | null;
  completedAt: string | null;
  isExtra: boolean;
  title: string | null;
};

const TIPO = {
  video: { plural: 'Vídeos', Icone: IconeVideo, cor: 'var(--luz-ia)' },
  arte: { plural: 'Artes', Icone: IconeArte, cor: 'var(--tipo-arte)' }, // F43 Fase 5: não é mais o verde da marca
  foto: { plural: 'Fotos', Icone: IconeFoto, cor: 'var(--luz-estudio)' },
  ads: { plural: 'ADS', Icone: IconeAds, cor: 'var(--luz-lives)' },
} as const satisfies Record<ContentType, unknown>;

const diaDoMes = (iso: string) => iso.slice(8, 10);

/**
 * Meio-dia de propósito: com hora cheia o dia vira conforme o fuso de quem lê.
 *
 * A convenção mudou de casa na F17.44 — mora em `@/ui/grade-do-mes`, porque
 * agora o calendário também agenda conteúdo, e duas cópias dela seriam duas
 * chances de uma delas virar `T00:00:00Z` sem ninguém notar.
 */
const noDia = meioDiaDoDia;

/**
 * O que o calendário está resolvendo agora — F17.42.
 *
 * Um estado só para os três caminhos: criar com dia, datar o que não tem dia e
 * trocar o dia do que já tem. `gravar` é a escrita de cada um, e por isso a
 * tela não precisa de um `if` para saber em qual deles está.
 */
type Escolha = {
  /** O botão que abriu — o balão se prende nele e mede o teto por ali. */
  ancora: HTMLElement | null;
  rotulo: string;
  /** O dia que o item JÁ TEM. `null` ao criar: nada nasce marcado. */
  valor: string | null;
  /** A semana clicada, como orientação. */
  faixa: Faixa | null;
  gravar: (dia: string) => Promise<unknown>;
};

export function Semanal({
  clienteId,
  mes,
  itens,
  contratado,
  mesAberto,
  semContratoDeConteudo = false,
  hoje = null,
  titulo = 'Semanal',
  nivelDoTitulo = 2,
  aoMudar,
}: {
  clienteId: string;
  /** `YYYY-MM`. */
  mes: string;
  /** Todos os itens do mês, sem recorte de período. */
  itens: ItemDaGrade[];
  contratado: Record<ContentType, number>;
  mesAberto: boolean;
  /**
   * O cliente não compra conteúdo por mês — F17.57.
   *
   * Vem do cadastro de hoje, não do mês congelado, e é o que separa as duas
   * grades vazias que existem: a de quem não tem nada a distribuir e a de quem
   * tem contrato e viu o mês congelar sem cota.
   */
  semContratoDeConteudo?: boolean;
  /**
   * `AAAA-MM-DD` de hoje, vindo de quem desenha a ficha — F11C. Só ACENDE a
   * semana corrente; nunca decide data de nada (a tela não lê o relógio).
   */
  hoje?: string | null;
  /**
   * O nome da seção — F43, Fase 3. Na ficha ela é a área "Semanal" (um `h2`);
   * no painel do cliente do Planejamento é "Peças do mês", um `h3` abaixo do
   * nome do cliente. A grade é a mesma.
   */
  titulo?: string;
  nivelDoTitulo?: 2 | 3;
  aoMudar: () => Promise<unknown> | void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [escolha, setEscolha] = useState<Escolha | null>(null);

  const semanas = useMemo(() => semanasDoMes(mes), [mes]);

  /** Índice: semana → tipo → itens, na ordem do dia. */
  const porSemana = useMemo(() => {
    const mapa = new Map<number, Map<string, ItemDaGrade[]>>();
    for (const s of semanas) mapa.set(s.numero, new Map());

    for (const item of itens) {
      if (item.scheduledAt === null) continue;
      const dia = diaDoInstante(item.scheduledAt);
      const s = semanas.find((x) => dia >= x.de && dia <= x.ate);
      // Item agendado fora do mês de competência existe: alguém marcou o mês
      // de agosto e agendou para 2 de setembro. Ele não some — aparece na lista
      // de "fora do mês", em vez de ser empurrado para a semana mais próxima.
      if (!s) continue;
      const doTipo = mapa.get(s.numero)!;
      doTipo.set(item.contentType, [...(doTipo.get(item.contentType) ?? []), item]);
    }

    for (const doTipo of mapa.values()) {
      for (const lista of doTipo.values()) {
        lista.sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
      }
    }
    return mapa;
  }, [itens, semanas]);

  const semData = useMemo(() => itens.filter((i) => i.scheduledAt === null), [itens]);

  /** O nome de cada item — o mesmo de Conteúdos (tipo, título e dia). */
  const nomes = useMemo(() => nomesDosItens(itens), [itens]);

  /** A semana em que hoje cai, quando cai neste mês. */
  const semanaAtual = hoje ? (semanas.find((x) => hoje >= x.de && hoje <= x.ate)?.numero ?? null) : null;

  const foraDoMes = useMemo(
    () =>
      itens.filter((i) => {
        if (i.scheduledAt === null) return false;
        const dia = diaDoInstante(i.scheduledAt);
        return dia < semanas[0].de || dia > semanas[semanas.length - 1].ate;
      }),
    [itens, semanas],
  );

  const agendados = itens.length - semData.length - foraDoMes.length;
  const totalContratado = CONTENT_TYPES.reduce((n, t) => n + contratado[t], 0);

  /**
   * Quantos itens do mês ocupam a BASE de cada tipo — os que não são extra,
   * com data ou sem. É o que decide se o próximo nasce extra.
   *
   * Conta o mês inteiro de propósito: item sem data também é contratado, e
   * ignorá-lo faria o próximo nascer extra enquanto ainda há cota a cumprir.
   */
  const naBase = useMemo(() => {
    const contagem = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0])) as Record<
      ContentType,
      number
    >;
    for (const i of itens) {
      if (i.isExtra) continue;
      if (i.contentType in contagem) contagem[i.contentType as ContentType] += 1;
    }
    return contagem;
  }, [itens]);

  /** Roda a escrita, recarrega, e nunca deixa dois cliques correrem juntos. */
  async function executar(acao: () => Promise<unknown>) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    } finally {
      setOcupado(false);
    }
  }

  /**
   * O próximo passo, em UMA frase — F17.57.
   *
   * Na captura do usuário esta tela dizia `Contratado no mês 0 · Com dia
   * marcado 0 · Ainda sem dia 0` e quatro semanas `vazia`, e nada dizia o que
   * fazer com isso. Três números em zero são um estado, não uma instrução.
   *
   * É uma frase só, e ela muda com o estado — nunca duas ao mesmo tempo, e
   * `null` quando a tela já se explica sozinha.
   */
  const proximoPasso =
    totalContratado === 0
      ? 'O mês congelou sem cota: o que você acrescentar aqui nasce extra.'
      : itens.length === 0
        ? `Nada distribuído ainda. Use o + de cada semana para dar dia aos ${totalContratado} contratados.`
        : semData.length > 0
          ? `${semData.length} ${semData.length === 1 ? 'conteúdo ainda espera' : 'conteúdos ainda esperam'} dia — a lista está logo abaixo das semanas.`
          : null;

  /** Leva à seção e põe o foco nela — quem usa teclado continua dali. */
  function irPara(id: string) {
    const alvo = document.getElementById(id);
    if (!alvo) return;
    const calmo = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    alvo.scrollIntoView({ block: 'start', behavior: calmo ? 'auto' : 'smooth' });
    alvo.focus({ preventScroll: true });
  }

  if (!mesAberto) {
    return (
      <Aviso tipo="info">
        O mês ainda não foi aberto. Abrir congela o contrato — e é ele que diz quantos
        conteúdos distribuir pelas semanas.
      </Aviso>
    );
  }

  // Cliente que não compra conteúdo mensal e não tem nada lançado: as cinco
  // semanas vazias eram uma acusação de mês parado. Não há o que distribuir, e
  // dizer isso é a informação inteira.
  if (semContratoDeConteudo && itens.length === 0) {
    return (
      <Aviso tipo="info">
        Este cliente não contrata conteúdo mensal — não há cota para distribuir pelas
        semanas.
      </Aviso>
    );
  }

  return (
    <div className="pb-10">
      {/* --- o que a tela responde primeiro — F11C: uma linha, não um cartão --- */}
      <div className="cl-cabeca">
        <div className="flex items-center gap-1">
          {nivelDoTitulo === 3 ? (
            <h3 className="cl-area-titulo">{titulo}</h3>
          ) : (
            <h2 className="cl-area-titulo">{titulo}</h2>
          )}
          <Ajuda sobre="de onde sai a semana" lado="baixo-direita">
            A semana sai da data do conteúdo. Não há gaveta de semana para
            divergir do calendário — os dois leem o mesmo item.
          </Ajuda>
        </div>
        <p className="cl-resumo-area">
          <span>
            <b>{totalContratado}</b> contratados no mês
          </span>
          <span>
            <b>{agendados}</b> com dia marcado
          </span>
          <span data-tom={semData.length > 0 ? 'warn' : undefined}>
            <b>{semData.length}</b> ainda sem dia
          </span>
          {foraDoMes.length > 0 && (
            <span>
              <b>{foraDoMes.length}</b> com dia em outro mês
            </span>
          )}
        </p>
      </div>
      {proximoPasso && <p className="-mt-1 text-[0.75rem] leading-snug text-mute">{proximoPasso}</p>}

      {/* --- ACHAR A SEMANA — F11C ----------------------------------------------
          Um atalho por semana, com o que ainda falta nela, e um para o que não
          tem dia. Não é outro dado: cada número sai dos mesmos itens das
          seções abaixo, e o atalho só leva até lá. */}
      <nav aria-label="Ir para a semana">
        <ul className="cl-semanas">
          {semanas.map((s) => {
            const todos = [...(porSemana.get(s.numero)?.values() ?? [])].flat();
            const faltam = todos.filter((i) => i.completedAt === null).length;
            const atual = s.numero === semanaAtual;
            return (
              <li key={s.numero}>
                <button
                  type="button"
                  className="cl-semana-atalho"
                  data-atual={atual || undefined}
                  aria-current={atual ? 'date' : undefined}
                  onClick={() => irPara(`cl-semana-${s.numero}`)}
                >
                  <b>Semana {s.numero}</b>{' '}
                  <span className="tnum">{intervaloDaSemana(s)}</span>{' '}
                  {todos.length === 0 ? (
                    <span>nada marcado</span>
                  ) : faltam > 0 ? (
                    <span data-tom="warn">{faltam} a fazer</span>
                  ) : (
                    <span data-tom="ok">feita</span>
                  )}
                  {atual && <> <span className="cl-agora">agora</span></>}
                </button>
              </li>
            );
          })}
          {semData.length > 0 && (
            <li>
              <button type="button" className="cl-semana-atalho" onClick={() => irPara('cl-sem-dia')}>
                <b>Sem dia</b>{' '}
                <span data-tom="warn">{semData.length}</span>
              </button>
            </li>
          )}
          {foraDoMes.length > 0 && (
            <li>
              <button type="button" className="cl-semana-atalho" onClick={() => irPara('cl-fora-do-mes')}>
                <b>Fora do mês</b>{' '}
                <span className="tnum">{foraDoMes.length}</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      {erro && (
        <div className="mt-3">
          <Aviso tipo="erro">{erro}</Aviso>
        </div>
      )}

      {/* --- as semanas ---------------------------------------------------- */}
      <div className="mt-4 space-y-3">
        {semanas.map((s) => {
          const doTipo = porSemana.get(s.numero)!;
          const todos = [...doTipo.values()].flat();
          const concluidos = todos.filter((i) => i.completedAt !== null).length;
          const cheia = todos.length > 0 && concluidos === todos.length;

          return (
            <section
              key={s.numero}
              id={`cl-semana-${s.numero}`}
              tabIndex={-1}
              aria-labelledby={`cl-semana-${s.numero}-titulo`}
              className="o-card cl-semana p-3"
              data-tom={cheia ? 'ok' : undefined}
              data-atual={s.numero === semanaAtual || undefined}
            >
              <header className="flex flex-wrap items-center gap-2">
                <h3 className="o-titulo text-sm" id={`cl-semana-${s.numero}-titulo`}>
                  Semana {String(s.numero).padStart(2, '0')}
                </h3>
                {s.numero === semanaAtual && <span className="cl-agora">agora</span>}
                <span className="o-mono text-[0.66rem] text-mute">{intervaloDaSemana(s)}</span>
                {/* Semana de ponta tem mais de sete dias por causa da regra de
                    absorção. Dizer isso evita a leitura de que faltou dia. */}
                {s.dias !== 7 && (
                  <span className="o-mono text-[0.70rem] text-mute">{s.dias} dias</span>
                )}
                <span className="ml-auto">
                  {/* `vazia` dizia da SEMANA, e a semana existe. O que está
                      vazio é o que foi marcado nela — F17.57. */}
                  {todos.length === 0 ? (
                    <Selo>nada marcado</Selo>
                  ) : cheia ? (
                    <Selo tom="ok" ponto>
                      concluída
                    </Selo>
                  ) : (
                    <Selo tom="warn">
                      {concluidos}/{todos.length}
                    </Selo>
                  )}
                </span>
              </header>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CONTENT_TYPES.map((t) => {
                  const lista = doTipo.get(t) ?? [];
                  const feitos = lista.filter((i) => i.completedAt !== null).length;
                  const { Icone, cor, plural } = TIPO[t];

                  // Um tipo que o cliente não contrata e que não tem nada nesta
                  // semana é linha morta: ocupa espaço e não diz nada.
                  //
                  // MAS SÓ QUANDO HÁ CONTRATO — F17.57. Com a cota do mês
                  // inteira em zero, esta regra escondia os quatro tipos, e a
                  // semana virava uma caixa vazia com o crachá `vazia` e nenhum
                  // botão: nada a fazer, nem caminho para fazer. É justamente o
                  // mês em que a equipe precisa lançar — como extra.
                  if (totalContratado > 0 && contratado[t] === 0 && lista.length === 0) return null;

                  const removivel = [...lista].reverse().find((i) => i.completedAt === null);

                  return (
                    <div key={t}>
                      <div className="flex items-center gap-2">
                        {/* A cor do tipo mora no ícone (e na barra) — F43 Fase 5. */}
                        <span className="inline-flex shrink-0" style={{ color: cor }}>
                          <Icone className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-xs text-plat-dim">{plural}</span>
                        <span className="tnum o-mono ml-auto text-[0.66rem] text-plat">
                          {feitos}/{lista.length}
                        </span>
                        <button
                          type="button"
                          className="o-btn o-btn-vidro o-btn-icone h-6 w-6"
                          disabled={ocupado || removivel === undefined}
                          title={
                            lista.length === 0
                              ? 'Nada para remover nesta semana'
                              : removivel === undefined
                                ? 'Só há conteúdo já concluído aqui — remover apagaria trabalho registrado'
                                : 'Remover um conteúdo planejado'
                          }
                          onClick={() =>
                            removivel && executar(() => api.excluirItem(removivel.id))
                          }
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="o-btn o-btn-vidro o-btn-icone h-6 w-6"
                          disabled={ocupado}
                          aria-haspopup="dialog"
                          title={`Acrescentar ${plural.toLowerCase()} — escolher o dia em ${intervaloDaSemana(s)}`}
                          onClick={(e) =>
                            setEscolha({
                              ancora: e.currentTarget,
                              rotulo: 'Escolher o dia',
                              valor: null,
                              faixa: { de: s.de, ate: s.ate },
                              gravar: (dia) =>
                                api.criarItem(
                                  clienteId,
                                  `${mes}-01`,
                                  t,
                                  // Extra é o que passa da cota DO MÊS, não da
                                  // semana. Comparar com a semana marcaria como
                                  // extra o quarto vídeo de uma semana cheia
                                  // enquanto o mês inteiro ainda deve produção —
                                  // e extra entra como bônus, nunca na base.
                                  naBase[t] >= contratado[t],
                                  noDia(dia),
                                ),
                            })
                          }
                        >
                          +
                        </button>
                      </div>

                      <div className="mt-1.5">
                        <Barra
                          pct={lista.length === 0 ? 0 : Math.round((feitos / lista.length) * 100)}
                          cor={cor}
                        />
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {lista.map((i) => {
                          const feito = i.completedAt !== null;
                          const nome = nomes.get(i.id) ?? i.id;
                          const dia = diaDoInstante(i.scheduledAt as string);
                          return (
                            /* DUAS AÇÕES NUMA PASTILHA SÓ — F17.42.
                               O dia marca e desmarca produção, que é o gesto de
                               sempre e não mudou de lugar. O calendário ao lado
                               troca a data, que antes não tinha caminho nenhum:
                               errar o dia obrigava a apagar e refazer.

                               SEM CONTORNO, E FEITO É "OK" — F43 Fase 5. A feita
                               levava contorno e fundo na luz do tipo: uma semana
                               cheia era um muro de pastilhas coloridas, e a cor
                               do tipo já está no ícone e na barra logo acima.
                               Agora a pendente é um tom neutro e a feita é o
                               verde calmo do "ok" — a mesma resposta do visto do
                               calendário. O estado também vai em `aria-pressed`. */
                            <span
                              key={i.id}
                              className="inline-flex items-center overflow-hidden rounded"
                              style={{
                                background: feito
                                  ? 'var(--ok-soft)'
                                  : 'color-mix(in srgb, var(--plat) 7%, transparent)',
                              }}
                            >
                              <button
                                type="button"
                                disabled={ocupado}
                                onClick={() => executar(() => api.alternarConclusao(i.id, !feito))}
                                // O nome é o do ITEM (tipo, título e dia) e o
                                // estado vai em `aria-pressed` — F11C. Antes o
                                // nome era o número do dia: "12".
                                aria-label={nome}
                                aria-pressed={feito}
                                title={`${nome} — ${
                                  feito ? 'clique para desmarcar' : 'clique para marcar como feito'
                                }`}
                                className="cl-pastilha-dia tnum o-mono min-h-[1.5rem] px-1.5 py-1 text-[0.66rem] transition"
                                /* A letra fica na platina — a régua da F17.37. A
                                   10,6px a luz do tipo como tinta mede 2,43 no
                                   pior caso, e a régua pede 7:1. */
                                style={{ color: feito ? 'var(--plat)' : 'var(--plat-dim)' }}
                              >
                                {diaDoMes(dia)}
                                {i.isExtra && <span className="ml-0.5">+</span>}
                              </button>
                              <button
                                type="button"
                                disabled={ocupado}
                                aria-haspopup="dialog"
                                aria-label={`Trocar o dia — ${nome}`}
                                title={`Trocar o dia — ${nome}`}
                                className="inline-flex min-h-[1.5rem] min-w-[1.5rem] items-center justify-center border-l px-1 py-1 transition"
                                style={{
                                  borderColor: 'var(--hair-2)',
                                  color: 'var(--plat-dim)',
                                }}
                                onClick={(e) =>
                                  setEscolha({
                                    ancora: e.currentTarget,
                                    rotulo: 'Trocar o dia',
                                    valor: dia,
                                    faixa: { de: s.de, ate: s.ate },
                                    gravar: (novo) => api.agendar(i.id, noDia(novo)),
                                  })
                                }
                              >
                                <IconeCalendario className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* --- o que ainda não tem dia ---------------------------------------- */}
      {semData.length > 0 && (
        <section className="mt-5 cl-semana" id="cl-sem-dia" tabIndex={-1} aria-labelledby="cl-sem-dia-titulo">
          <h3 className="eyebrow" id="cl-sem-dia-titulo">
            Sem dia marcado · {semData.length}
            <span className="ml-2 normal-case tracking-normal text-mute">
              não pertencem a semana nenhuma até ganharem uma data
            </span>
          </h3>
          <ul className="o-card mt-2 divide-y" style={{ borderColor: 'var(--hair)' }}>
            {semData.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="text-sm text-plat">
                  {TIPO[i.contentType as ContentType]?.plural ?? i.contentType}
                  {i.title && <span className="text-plat-dim"> · {i.title}</span>}
                </span>
                {i.isExtra && <Selo tom="ok">extra</Selo>}
                {/* AQUI HAVIA `S1 S2 S3 S4` — F17.42.
                    Cada um jogava o item num dia escolhido pelo sistema: hoje,
                    ou a segunda-feira daquela semana. Um clique, e o dia errado
                    em silêncio. Esta é a fila principal desta tela — 14 itens
                    esperando data numa captura real —, e por isso ela é o
                    caminho que mais precisava do dia de verdade. */}
                <span className="ml-auto">
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-haspopup="dialog"
                    aria-label={`Escolher o dia — ${nomes.get(i.id) ?? i.id}`}
                    className="o-btn o-btn-vidro o-btn-sm inline-flex items-center gap-1.5"
                    onClick={(e) =>
                      setEscolha({
                        ancora: e.currentTarget,
                        rotulo: 'Escolher o dia',
                        valor: null,
                        faixa: null,
                        gravar: (dia) => api.agendar(i.id, noDia(dia)),
                      })
                    }
                  >
                    <IconeCalendario className="h-3.5 w-3.5" />
                    Escolher o dia
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- agendado fora do mês de competência ----------------------------- */}
      {foraDoMes.length > 0 && (
        <section className="mt-5 cl-semana" id="cl-fora-do-mes" tabIndex={-1} aria-labelledby="cl-fora-do-mes-titulo">
          <h3 className="eyebrow" id="cl-fora-do-mes-titulo">
            Agendado fora deste mês · {foraDoMes.length}
          </h3>
          <div className="mt-2">
            <Aviso tipo="atencao">
              Estes conteúdos são cobrados neste mês, mas têm data em outro. Continuam
              contando no medidor — o que cobra é o mês de competência, não o dia do post.
            </Aviso>
          </div>
          <ul className="o-card mt-2">
            {foraDoMes.map((i) => (
              <li
                key={i.id}
                className="flex items-center gap-2 px-3 py-2 text-sm"
                style={{ borderBottom: '1px solid var(--hair)' }}
              >
                <span className="text-plat">
                  {TIPO[i.contentType as ContentType]?.plural ?? i.contentType}
                  {i.title && <span className="text-plat-dim"> · {i.title}</span>}
                </span>
                <span className="o-mono ml-auto text-[0.70rem] text-mute">
                  {diaDoInstante(i.scheduledAt as string).split('-').reverse().join('/')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* O CALENDÁRIO É UM SÓ NA TELA, e o botão que o abriu diz onde ele
          aparece. Um por linha seria o mesmo balão montado dezenas de vezes
          para que no máximo um esteja aberto. */}
      {escolha && (
        <SeletorDeDia
          rotulo={escolha.rotulo}
          /* Abre no mês de competência — é onde está o trabalho que se lança,
             inclusive o atrasado. Item que já tem dia abre no dia dele. */
          mesInicial={mes}
          valor={escolha.valor}
          faixa={escolha.faixa}
          ancora={escolha.ancora}
          aoFechar={() => setEscolha(null)}
          aoEscolher={(dia) => {
            setEscolha(null);
            void executar(() => escolha.gravar(dia));
          }}
        />
      )}
    </div>
  );
}
