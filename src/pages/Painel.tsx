/**
 * O cockpit — etapas F4.1 e F4.4.
 *
 * O QUE ESTA TELA RESPONDE
 *   "Quem está no vermelho este mês?" — a pergunta única que o Sistema IDE
 *   existe para responder.
 *
 * O INTERVALO NÃO CORTA O CONTRATO — etapa F4.11
 *   O seletor do topo é de intervalo livre: um dia, uma semana, três meses. Mas
 *   o medidor cobra contra o **contrato do mês**, e contrato não se corta ao
 *   meio: "01 a 15 de agosto" não significa meio contrato.
 *
 *   Então o intervalo é lido em duas camadas, e a tela diz isso em voz alta:
 *
 *     os MESES que ele toca  → somados inteiros, e é o que o medidor mostra
 *     os DIAS que ele marca  → a linha "no intervalo", só produção com data
 *
 *   É a mesma separação que a tela do cliente já usava entre medidor e período.
 *   Fundir as duas faria encolher a janela parecer queda de entrega — o erro de
 *   leitura mais caro que este painel pode induzir.
 *
 * O MEDIDOR TEM TRÊS ESTADOS, NÃO DOIS
 *   Um mês sem contrato aberto **não tem 0%**. Mostrar zero seria indistinguível
 *   de "nada foi entregue", que é uma acusação em vez de uma informação. O
 *   cálculo devolve uma união discriminada justamente para obrigar esta tela a
 *   distinguir os dois — e o compilador cobra.
 *
 * OS NÚMEROS DO TOPO SÃO A SOMA DO QUE ESTÁ À VISTA
 *   Não há endpoint de agregado. Filtrar a lista muda os totais junto, e é
 *   assim que se quer: um cabeçalho que fala de 91 clientes sobre uma lista de
 *   3 é um número que não descreve nada. Ver `painel/carteira.ts`.
 *
 * O QUE AINDA NÃO ESTÁ AQUI
 *   O "captados/mês" no cartão. A tabela existe desde a F4.10 e a conta está
 *   pronta na aba Captação; trazê-la para cá é mais uma soma na leitura do
 *   painel, e fica para quando alguém sentir falta dela aqui.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { MESES } from '@/board/calendario';
import { Ajuda } from '@/board/menus';
import { TelaComBarra } from '@/board/TelaComBarra';
import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { ApiError, api, semSessao } from '@/lib/api';
import {
  type ClienteDoPainel,
  type Filtro,
  ORDENS,
  type Ordem,
  type Situacao,
  type Urgencia,
  contarAtalhos,
  filtrarCarteira,
  filtroEstaLimpo,
  motivoSemMedida,
  ordenarCarteira,
  proximasRenovacoes,
  resumirCarteira,
  situacoesDoCliente,
  textoDaUltimaEntrega,
} from '@/painel/carteira';
import { BlocoDaConferencia } from '@/painel/BlocoDaConferencia';
import { type Conferencia, CONFERENCIA_VAZIA } from '@/painel/conferencia';
import {
  type Recorte,
  filtroConhecido,
  filtroDoRecorte,
  lerRecorte,
  mesInteiro,
  recorteParaEndereco,
} from '@/painel/recorte';
import { URGENCIA, URGENCIAS } from '@/painel/urgencia';
import {
  IconeAds,
  IconeAlerta,
  IconeArquivo,
  IconeArte,
  IconeCalendario,
  IconeChevron,
  IconeDinheiro,
  IconeFoto,
  IconeLapis,
  IconeMais,
  IconeRelogio,
  IconeVideo,
} from '@/ui/Icones';
import { FichaDeCliente } from '@/clients/FichaDeCliente';
import { useParametrosNoEndereco, useTextoNoEndereco } from '@/ui/endereco';
import { type Periodo, SeletorDePeriodo } from '@/ui/SeletorDePeriodo';
import { Gaveta } from '@/ui/Gaveta';
import { diaDoInstante, mesDeHoje } from '@/ui/grade-do-mes';
import { Aviso, CampoDeBusca, Contagem, PaginaLarga, Pilula, Selo } from '@/ui/primitivos';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { Topo } from '@/ui/Topo';
import { podeVer, useSessao } from '@/ui/sessao';

/* ─────────────────────────── vocabulário da tela ─────────────────────────── */

const TIPO = {
  video: { rotulo: 'Vídeos', Icone: IconeVideo, cor: 'var(--luz-ia)' },
  // A arte tem cor própria desde a F43 Fase 5 — era o verde da marca.
  arte: { rotulo: 'Artes', Icone: IconeArte, cor: 'var(--tipo-arte)' },
  foto: { rotulo: 'Fotos', Icone: IconeFoto, cor: 'var(--luz-estudio)' },
  ads: { rotulo: 'ADS', Icone: IconeAds, cor: 'var(--luz-lives)' },
} as const satisfies Record<ContentType, unknown>;

/* A urgência — rótulo, ícone, tom e cor — mora em `painel/urgencia.ts`, a
   mesma que a tela do cliente usa (F30). */

/* O mês de São Paulo, e não o de UTC: no último dia do mês, a partir das 21h, a carteira abria no
   mês seguinte. */
const mesCorrente = () => mesDeHoje();

/* `mesInteiro` mora em `painel/recorte.ts` desde a F11A: o endereço
   precisa da mesma conta para saber quando o período é o padrão. */

/** Verdadeiro quando o intervalo é exatamente um mês civil, do dia 1 ao último. */
function ehMesInteiro(p: Periodo): boolean {
  const doMes = mesInteiro(p.de.slice(0, 7));
  return p.de === doMes.de && p.ate === doMes.ate;
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const diaCurto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Os meses ('YYYY-MM') que o intervalo toca, do primeiro ao último.
 *
 * SÓ PARA A PRIMEIRA CARGA — F27. Quem decide o que o medidor somou é o
 * servidor (`months` na resposta). Esta conta existe para o rótulo da
 * competência não sair vazio enquanto a primeira resposta não chega; assim
 * que ela chega, a lista do servidor manda.
 */
function mesesDoPeriodo(p: Periodo): string[] {
  const [a0, m0] = p.de.split('-').map(Number);
  const [a1, m1] = p.ate.split('-').map(Number);
  const saida: string[] = [];
  for (let t = a0 * 12 + m0 - 1; t <= a1 * 12 + m1 - 1; t++) {
    saida.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }
  return saida.length > 0 ? saida : [p.de.slice(0, 7)];
}

/**
 * A competência escrita — F27: "setembro", "set–out", ou "14 meses".
 *
 * O medidor cobra contra o contrato do MÊS, e o rótulo tem de dizer qual. Sem
 * isso, "82%" num intervalo de 01 a 07 parece a entrega da semana. Passando de
 * doze meses, "set–set" seria ambíguo, e a contagem diz mais que as pontas.
 */
function competencia(meses: readonly string[]): string {
  const nome = (m: string) => MESES[Number(m.slice(5, 7)) - 1];
  if (meses.length === 0) return '';
  if (meses.length === 1) return nome(meses[0]);
  if (meses.length > 12) return `${meses.length} meses`;
  return `${nome(meses[0]).slice(0, 3)}–${nome(meses[meses.length - 1]).slice(0, 3)}`;
}

/**
 * O período que a tela está mostrando, por extenso — F27, para o aviso de
 * falha dizer DE QUANDO são os números que ficaram: "setembro", "01/09 a
 * 07/09", "o dia 12/09".
 */
const descreverPeriodo = (p: Periodo) =>
  ehMesInteiro(p)
    ? MESES[Number(p.de.slice(5, 7)) - 1]
    : p.de === p.ate
      ? `o dia ${diaCurto(p.de)}`
      : `${diaCurto(p.de)} a ${diaCurto(p.ate)}`;

/**
 * O prazo da renovação em PALAVRAS, e não só em cor — F27.
 *
 * "12d" em amarelo só dizia "perto" para quem distingue o amarelo do cinza ao
 * lado. "vence em 12d" diz a mesma coisa para todo mundo.
 */
const prazoDaRenovacao = (dias: number) =>
  dias < 0 ? `${Math.abs(dias)}d vencido` : dias === 0 ? 'vence hoje' : `vence em ${dias}d`;


/** Texto da busca no endereço: mais que isto não é busca, é colagem. */
const TETO_DA_BUSCA = 120;

/* ─────────────────────────── peças ─────────────────────────── */

/**
 * O lugar de um número que ainda não chegou — F27.
 *
 * Na primeira carga a tela não sabe nada, e "0" seria mentira: "Crítico 0"
 * é uma afirmação sobre a carteira, e ela ainda não foi lida. A barra ocupa a
 * altura da linha do número, para a métrica não crescer quando ele chega.
 */
function Esboco({ largura, altura = '1em' }: { largura: string; altura?: string }) {
  return (
    <span
      aria-hidden
      className="o-esqueleto inline-block align-middle"
      style={{ width: largura, height: altura }}
    />
  );
}

/**
 * Um atalho do resumo — F11A do plano UX.
 *
 * O número É um filtro: clicar em "Crítico 3" faz exatamente o que marcar
 * Crítico na gaveta Urgência faz (o mesmo `alternar`), e a carteira passa a
 * ter os 3. `aria-pressed` diz se o recorte está ligado; clicar de novo tira.
 * A contagem vem de `contarAtalhos`, e não do resumo da lista visível, para
 * continuar dizendo quantos o atalho mostraria depois de outro ser ligado.
 */
function Atalho({
  rotulo,
  Icone,
  tom,
  n,
  ativo,
  aoClicar,
  semDados,
}: {
  rotulo: string;
  Icone: (p: { className?: string }) => React.ReactNode;
  tom: 'err' | 'warn' | 'ok';
  n: number;
  ativo: boolean;
  aoClicar: () => void;
  semDados: boolean;
}) {
  return (
    <button
      type="button"
      className="pn-atalho"
      data-tom={tom}
      data-zero={!semDados && n === 0 ? '' : undefined}
      aria-pressed={ativo}
      disabled={semDados}
      onClick={aoClicar}
      title={ativo ? 'Tirar este filtro' : `Mostrar só estes clientes`}
    >
      <span className="pn-atalho-rotulo">
        <Icone className="pn-atalho-icone" />
        <span className="pn-atalho-texto">{rotulo}</span>
      </span>
      <span className="pn-atalho-n tnum">{semDados ? <Esboco largura="1.5rem" /> : n}</span>
    </button>
  );
}

/**
 * A linha da carteira enquanto a carteira não chegou — F27, linha desde a F43
 * Fase 10.
 *
 * Mesma forma da linha de verdade (as mesmas áreas da grade): quem espera
 * reconhece o que está vindo, e a lista não pula quando as linhas reais tomam
 * o lugar destas.
 */
function CartaoEsboco() {
  return (
    <div className="pn-cartao pn-cartao-esboco" aria-hidden>
      <div className="pn-linha-cliente">
        <span className="o-esqueleto h-4 w-3/4" />
        <span className="o-esqueleto mt-2 h-3 w-1/3" />
      </div>
      <div className="pn-linha-situacao">
        <span className="o-esqueleto h-4 w-1/2" />
      </div>
      <div className="pn-linha-entrega">
        <span className="o-esqueleto h-4 w-2/3" />
        <span className="o-esqueleto mt-2 h-3 w-full" />
      </div>
    </div>
  );
}

const ICONE_DA_SITUACAO: Record<Situacao['chave'], typeof IconeAlerta> = {
  financeiro: IconeDinheiro,
  renovacao: IconeRelogio,
  // F38 — peças da Semanal: o alerta para o que já passou, o calendário para o dia.
  vencidas: IconeAlerta,
  venceHoje: IconeCalendario,
};

/**
 * A urgência é MARCADA À MÃO; a entrega é CALCULADA — F11A2 (revisão, R03).
 *
 * "Em dia" ao lado de 0% e "Crítico" ao lado de 100% pareciam contradição,
 * porque o cartão não dizia que são duas medidas de natureza diferente. Uma
 * frase só, a mesma no atalho do topo e na linha.
 */
const AJUDA_DA_URGENCIA =
  'A urgência é marcada à mão, na ficha do cliente, por quem cuida dele. Ela não vem da entrega do mês: ' +
  'um cliente pode estar Em dia com 0% entregue, ou Crítico com tudo entregue.';

/**
 * O cabeçalho das colunas da carteira — F43 Fase 10.
 *
 * Só na tela larga (as colunas existem): no celular a linha empilha e cada
 * medida leva o próprio nome escrito ("Urgência", "Entrega do mês", "Última
 * entrega"). É `aria-hidden` porque o leitor de tela já ouve esses nomes
 * DENTRO de cada linha — na tela larga eles saem da vista, não da leitura.
 * Repetir o cabeçalho para ele seria ler a dimensão duas vezes.
 */
function CabecaDaCarteira({ rotuloDaEntrega, comUltima }: { rotuloDaEntrega: string; comUltima: boolean }) {
  return (
    <div className="pn-lista-cabeca" aria-hidden="true">
      <span className="pn-linha-cliente">Cliente</span>
      <span className="pn-linha-situacao">Urgência · pede ação</span>
      <span className="pn-linha-entrega">{rotuloDaEntrega}</span>
      {/* Servidor anterior à F38 não manda a última entrega: a coluna fica
          sem nome, em vez de prometer um dado que nenhuma linha tem. */}
      {comUltima && <span className="pn-linha-ultima">Última entrega</span>}
    </div>
  );
}

/**
 * UMA LINHA DA CARTEIRA — era o cartão até a F43 Fase 10.
 *
 * POR QUE LINHA, E NÃO CARTÃO
 *   A proposta da camada calma (08/10): "O Painel vira lista: Cliente,
 *   situação com o motivo, contrato do mês e próxima ação, em linhas. Os anéis
 *   e as quatro barras coloridas por cartão saem." Doze cartões emoldurados,
 *   cada um com um anel colorido e quatro barras de quatro cores, eram
 *   sessenta pontos de cor na primeira dobra — e a pergunta da tela ("quem
 *   pede ação?") se perdia entre eles. Em linha, os olhos descem por uma
 *   coluna só (a da situação), e a cor sobra para o que pede ação.
 *
 * NADA DO CARTÃO SUMIU — regra do Wesley em 08/10 ("não esconder nenhum botão
 * ou função sem querer"). A linha tem, na mesma ordem de leitura: o nome
 * (link para o cliente, a linha inteira é clicável), a urgência com o nome da
 * dimensão, o que pede ação, a entrega do mês em PORCENTAGEM (o número do
 * anel) com uma barra fina de uma cor só, as peças por tipo em texto
 * ("Vídeos 2/4", com o "+N" do extra), o motivo quando não há medida, a
 * última entrega, plano, etiquetas (com a cor que a agência escolheu),
 * renovação, "no intervalo" e o lápis de editar. O bônus acima de 100%, que
 * era um segundo anel laranja, continua no número ("110%") e nos "+N" dos
 * tipos.
 *
 * O NOME `CartaoDeCliente` FICOU: os testes de tela o importam, e o nome da
 * peça não aparece para ninguém. As classes também (`pn-cartao`,
 * `pn-cartao-nome`, `pn-urgencia`, `pn-ultima`, `pn-situacoes`, `pn-entrega`):
 * é por elas que os testes e o e2e acham a informação, e a informação é a
 * mesma.
 *
 * A linha inteira é clicável e mesmo assim tem um botão dentro. Botão dentro
 * de `<a>` é HTML inválido e o navegador desfaz a aninhação de um jeito
 * imprevisível. A saída (F27) continua: o link é uma camada que cobre a linha,
 * com o lápis por cima dela.
 */
export function CartaoDeCliente({
  c,
  aoEditar,
  origem,
  rotuloDaEntrega,
}: {
  c: ClienteDoPainel;
  aoEditar: () => void;
  origem: string;
  /** "Entrega do mês", ou "Entrega de set–out" quando o intervalo toca mais de um mês. */
  rotuloDaEntrega: string;
}) {
  const { Icone: IconeUrgencia, tom, rotulo: rotuloUrgencia } = URGENCIA[c.urgency];
  const situacoes = situacoesDoCliente(c);
  const semMedida = motivoSemMedida(c.delivery);
  const tipos = c.delivery.measurable
    ? CONTENT_TYPES.flatMap((t) => {
        const linha = c.delivery.measurable ? c.delivery.breakdown.find((b) => b.contentType === t) : undefined;
        const contratado = linha?.contracted ?? 0;
        const entregue = linha?.delivered ?? 0;
        const extras = linha?.extras ?? 0;
        // Um tipo que o cliente não contrata e do qual nada foi feito é ruído.
        return contratado === 0 && entregue === 0 && extras === 0 ? [] : [{ t, contratado, entregue, extras }];
      })
    : [];
  const entregaEmPalavras = c.delivery.measurable ? `${c.delivery.level}%` : (semMedida?.rotulo ?? 'sem medida');
  /* A barra mede a BASE (0 a 100). O que passa de 100 é bônus, e o número ao
     lado já diz ("110%"): uma barra que transborda não diz quanto. */
  const base = c.delivery.measurable ? Math.max(0, Math.min(100, c.delivery.level)) : 0;
  /* F38 — a última entrega pela Semanal. Nula só para cancelado, que não
     chega à carteira; a linha então não diz nada (não é "sem entrega").
     Ausente (resposta de um servidor anterior à F38, aba aberta durante a
     publicação) vale o mesmo que nula: a linha desenha sem a coluna. */
  const status = c.deliveryStatus ?? null;
  const ultimaEntrega = status === null ? undefined : textoDaUltimaEntrega(status);
  const ultimaEmPalavras =
    ultimaEntrega === undefined
      ? ''
      : ultimaEntrega === null
        ? ', sem entrega registrada'
        : `, última entrega ${ultimaEntrega.replace(' · ', ', ')}`;

  /* Os secundários numa linha só, em letra de apoio, sob o nome: plano e
     etiquetas (o que o cliente É), renovação e produção no intervalo (datas).
     F11A2/R07: antes eram três selos do mesmo peso da urgência. */
  const temRodape = c.plan !== null || c.tags.length > 0 || c.renewsOn !== null || c.inPeriod.scheduled > 0;

  return (
    <article className="pn-cartao" data-urgencia={c.urgency}>
      <Link
        to={`/cliente/${c.id}`}
        state={{ painel: origem }}
        className="pn-cartao-link"
        aria-label={`Abrir ${c.name} — urgência ${rotuloUrgencia}, ${rotuloDaEntrega.toLowerCase()} ${entregaEmPalavras}${ultimaEmPalavras}`}
      />

      {/* O LÁPIS — F27, e a F43 Fase 10 o deixou mais fácil de achar. No
          computador ele aparece no hover da linha e também quando o foco
          chega na linha (o `Tab` sai do link e cai nele); em aparelho de
          toque fica sempre à vista, com alvo de 44px (`.o-editar-cartao`,
          obsidian.css). Vem logo depois do link no documento: a ordem do
          `Tab` é "Abrir X", "Editar X", próximo cliente. */}
      <button
        type="button"
        onClick={aoEditar}
        title={`Editar ${c.name}`}
        aria-label={`Editar ${c.name}`}
        className="o-btn o-btn-fantasma o-btn-icone o-editar-cartao pn-editar"
      >
        <IconeLapis />
      </button>

      <div className="pn-linha-cliente">
        <h3 className="pn-cartao-nome">{c.name}</h3>
        {temRodape && (
          <p className="pn-cartao-rodape">
            {c.plan && (
              // O plano pelo nome, sem a cor do selo: as cores do plano foram
              // escolhidas para fundo claro, e como ponto somem no tema escuro.
              <span className="pn-cartao-plano">{c.plan.name}</span>
            )}
            {c.tags.map((t) => (
              <span key={t.id} className="pn-cartao-etiqueta">
                {/* A cor da etiqueta é escolha da agência (dado), e fica. */}
                <i style={{ background: t.color }} aria-hidden />
                {t.name}
              </span>
            ))}
            {/* As datas, em letra de dado. "No intervalo" só com produção
                datada na janela: linha zerada em todo cliente seria ruído. */}
            {c.renewsOn && <span className="pn-cartao-datas tnum">Renova {dataCurta(c.renewsOn)}</span>}
            {c.inPeriod.scheduled > 0 && (
              <span className="pn-cartao-datas tnum">
                no intervalo{' '}
                <b>
                  {c.inPeriod.completed}/{c.inPeriod.scheduled}
                </b>
              </span>
            )}
          </p>
        )}
      </div>

      {/* A SITUAÇÃO — a coluna que se lê de cima a baixo. A urgência leva o
          nome da dimensão (F11A2: ela é marcada à mão, a entrega é calculada,
          e nenhuma se deduz da outra); na tela larga o nome sobe para o
          cabeçalho da coluna e aqui fica só para o leitor de tela. */}
      <div className="pn-linha-situacao">
        <p className="pn-urgencia" data-tom={tom} title={AJUDA_DA_URGENCIA}>
          <span className="pn-urgencia-dim pn-dim">Urgência</span>
          <span className="pn-urgencia-valor">
            <IconeUrgencia className="h-3.5 w-3.5 shrink-0" />
            {rotuloUrgencia}
          </span>
          <span className="sr-only"> (marcada à mão)</span>
        </p>
        {situacoes.length > 0 && (
          <ul className="pn-situacoes" aria-label="Pede ação">
            {situacoes.map((s) => {
              const Icone = ICONE_DA_SITUACAO[s.chave];
              return (
                <li key={s.chave + s.texto} data-tom={s.tom}>
                  <Icone className="h-3.5 w-3.5 shrink-0" />
                  {s.texto}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* O CONTRATO DO MÊS — a porcentagem (o número que o anel mostrava) com
          uma barra fina de uma cor só, e embaixo as peças por tipo em texto.
          A barra é neutra, como a do Planejamento: ela mede, não acusa — quem
          acusa é a situação ao lado. Sem medida, o MOTIVO no lugar dos tipos. */}
      <div className="pn-linha-entrega">
        <p className="pn-entrega" data-motivo={semMedida?.motivo}>
          <span className="pn-entrega-valor tnum">
            {c.delivery.measurable ? `${c.delivery.level}%` : '—'}
          </span>
          <span className="pn-entrega-rotulo pn-dim">{rotuloDaEntrega}</span>
          {c.delivery.measurable && (
            <span className="pn-entrega-barra" aria-hidden>
              <i style={{ width: `${base}%` }} />
            </span>
          )}
        </p>
        {semMedida ? (
          <p className="pn-cartao-motivo" data-motivo={semMedida.motivo}>
            <IconeCalendario className="h-3.5 w-3.5 shrink-0" />
            <span>
              <b>{semMedida.rotulo}.</b> {semMedida.texto}
            </span>
          </p>
        ) : (
          tipos.length > 0 && (
            /* Só os tipos que o cliente contrata (ou fez): um cliente só de
               vídeo não ganha "Artes 0/0" — F11A2/R07, que agora vale para o
               texto. O nome inteiro, nunca "Víde…". */
            <p className="pn-cartao-tipos" data-n={tipos.length}>
              {tipos.map(({ t, contratado, entregue, extras }) => (
                <span key={t} className="pn-tipo">
                  <span className="pn-tipo-nome">{TIPO[t].rotulo}</span>{' '}
                  <span className="tnum pn-tipo-conta">
                    {entregue}/{contratado}
                    {extras > 0 && <span className="pn-tipo-extra">+{extras}</span>}
                  </span>
                </span>
              ))}
            </p>
          )
        )}
      </div>

      {/* F38 — pela Semanal: o dia marcado da peça com ✓ mais recente. */}
      {ultimaEntrega !== undefined && (
        <div className="pn-linha-ultima">
          <p className="pn-ultima" data-sem={ultimaEntrega === null ? '' : undefined}>
            {ultimaEntrega === null ? (
              'Sem entrega registrada'
            ) : (
              <>
                <span className="pn-ultima-dim pn-dim">Última entrega</span>{' '}
                <span className="pn-ultima-valor tnum">{ultimaEntrega}</span>
              </>
            )}
          </p>
        </div>
      )}
    </article>
  );
}

/* ─────────────────────────── a tela ─────────────────────────── */

export default function Painel() {
  // Quem esta olhando, para a navegacao nao oferecer porta que responde 403.
  const { sessao } = useSessao();
  const local = useLocation();

  /* --- o recorte mora no endereço — F11A -----------------------------------
     Período, urgência, plano, etiqueta, financeiro, ordem e sentido saem de
     `?de=…&urgencia=…`; a busca, de `?busca=` (gravada depois que a
     digitação assenta). Voltar de um cliente encontra tudo como estava. Ver
     `painel/recorte.ts` para o contrato e a normalização. */
  const mesPadrao = mesCorrente();
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const busca = useTextoNoEndereco('busca', { teto: TETO_DA_BUSCA });
  const recorte = useMemo(() => lerRecorte(parametros, mesPadrao), [parametros, mesPadrao]);
  const periodo = recorte.periodo;
  const { ordem, crescente } = recorte;

  const [meses, setMeses] = useState<string[]>([]);
  const [clientes, setClientes] = useState<ClienteDoPainel[]>([]);
  const [conferencia, setConferencia] = useState<Conferencia>(CONFERENCIA_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  /**
   * O período da última leitura que DEU CERTO — `null` antes da primeira.
   *
   * F27. É ele que separa a primeira carga da recarga: sem dado nenhum, a tela
   * mostra esboço em vez de zero; com dado de antes, mantém os números e só os
   * esmaece. E quando a leitura seguinte falha, é daqui que o aviso tira de
   * quando são os números que ficaram na tela.
   */
  const [periodoDosDados, setPeriodoDosDados] = useState<Periodo | null>(null);
  const semDados = periodoDosDados === null;
  const [verArquivo, setVerArquivo] = useState(false);
  /** Celular: "Peças e filtros" recolhidos atrás de um botão — F11A2 (R07). */
  const [maisAberto, setMaisAberto] = useState(false);

  /**
   * `undefined` = fechada · `null` = criando · id = editando aquele cliente.
   *
   * Três estados, e não um booleano com um id ao lado: aquela combinação
   * permitiria "fechada, editando o cliente X", que não significa nada.
   */
  const [ficha, setFicha] = useState<string | null | undefined>(undefined);

  /** Muda para forçar a releitura do painel depois de uma escrita. */
  const [recarga, setRecarga] = useState(0);

  /** O mês onde o calendário do seletor abre: o do início do intervalo. */
  const mesDoPeriodo = periodo.de.slice(0, 7);

  /**
   * O filtro que a carteira usa: o do endereço, sem ids que ela não conhece
   * (`filtroConhecido`). Antes da primeira leitura não há como saber quais
   * existem, e os ids ficam como vieram.
   */
  const filtro: Filtro = useMemo(() => {
    const bruto = filtroDoRecorte(recorte, busca.texto);
    return semDados ? bruto : filtroConhecido(bruto, clientes);
  }, [recorte, busca.texto, semDados, clientes]);

  /**
   * Grava um recorte novo, com a busca pendente junto — uma gravação só.
   *
   * ⚠️ PARTE DO ENDEREÇO VIVO, E NÃO DO ÚLTIMO DESENHO. O React Router troca o
   * endereço na hora e redesenha numa transição: dois gestos seguidos (ligar
   * Atenção e logo escolher a ordem) fariam o segundo partir do filtro de
   * antes do primeiro e apagar a Atenção. Medido no e2e PX8 sob carga. A
   * gravação reescreve TODAS as chaves do recorte, então o que ela lê é o que
   * vale.
   */
  type Mudanca = Partial<Omit<Recorte, 'filtro'>> & { filtro?: Partial<Recorte['filtro']> };
  const gravar = useCallback(
    (mudar: Mudanca | ((atual: Recorte) => Mudanca), extras: Record<string, string> = {}) => {
      const vivo = lerRecorte(new URLSearchParams(window.location.search), mesPadrao);
      // Parte do filtro EFETIVO: interagir limpa do endereço o id morto.
      const efetivo = semDados ? filtroDoRecorte(vivo, '') : filtroConhecido(filtroDoRecorte(vivo, ''), clientes);
      const atual: Recorte = {
        ...vivo,
        filtro: {
          urgencias: efetivo.urgencias,
          planoIds: efetivo.planoIds,
          etiquetaIds: efetivo.etiquetaIds,
          soFinanceiroPendente: efetivo.soFinanceiroPendente,
        },
      };
      const novo = typeof mudar === 'function' ? mudar(atual) : mudar;
      const proximo: Recorte = { ...atual, ...novo, filtro: { ...atual.filtro, ...novo.filtro } };
      definirParametros({ ...busca.comOTexto(recorteParaEndereco(proximo, mesPadrao)), ...extras });
    },
    [semDados, clientes, definirParametros, busca, mesPadrao],
  );

  /** Liga/desliga um item numa lista de filtro — a gaveta e o atalho usam o mesmo. */
  const alternarNaLista = <K extends 'planoIds' | 'etiquetaIds' | 'urgencias'>(
    chave: K,
    valor: Filtro[K][number],
  ) =>
    gravar((r) => {
      const atual = r.filtro[chave] as readonly string[];
      const proximo = atual.includes(valor as string)
        ? atual.filter((v) => v !== valor)
        : [...atual, valor as string];
      return { filtro: { [chave]: proximo } as Partial<Recorte['filtro']> };
    });

  const alternarFinanceiro = () =>
    gravar((r) => ({ filtro: { soFinanceiroPendente: !r.filtro.soFinanceiroPendente } }));

  /** Limpa os FILTROS e a busca; período e ordenação não são filtro e ficam. */
  const limparFiltros = () =>
    gravar(
      { filtro: { urgencias: [], planoIds: [], etiquetaIds: [], soFinanceiroPendente: false } },
      { busca: '' },
    );

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    const pedido = { de: periodo.de, ate: periodo.ate };

    api
      .painel(pedido.de, pedido.ate)
      .then((r) => {
        if (cancelado) return;
        setClientes(r.clients as ClienteDoPainel[]);
        setConferencia(r.conferencia);
        // Quantos meses de competência o intervalo tocou. Vem do servidor, e
        // não recalculado aqui, porque é ele quem decidiu o que somou.
        setMeses(r.months);
        setPeriodoDosDados(pedido);
      })
      .catch((e) => {
        if (cancelado) return;
        // Sem sessão a tela não tem o que mostrar. Mandar para o login é mais
        // útil que exibir lista vazia com "faltou o crachá".
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        // A falha NÃO apaga a carteira de antes — F27. Os números que estavam
        // na tela continuam lá, e o aviso diz de quando eles são.
        setErro(e instanceof ApiError ? e.message : 'A leitura falhou antes de o servidor responder.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    // Trocar de mês durante uma carga lenta deixaria a resposta antiga chegar
    // por último e sobrescrever a nova, mostrando o mês errado sem erro nenhum.
    return () => {
      cancelado = true;
    };
  }, [periodo.de, periodo.ate, recarga]);

  /* --- vocabulário disponível: sai da carteira, não de uma tabela à parte --- */

  const planos = useMemo(() => {
    const mapa = new Map(clientes.flatMap((c) => (c.plan ? [[c.plan.id, c.plan] as const] : [])));
    return [...mapa.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [clientes]);

  const etiquetas = useMemo(() => {
    const mapa = new Map(clientes.flatMap((c) => c.tags.map((t) => [t.id, t] as const)));
    return [...mapa.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [clientes]);

  /* --- a lista visível, e tudo que se deriva dela --- */

  const visiveis = useMemo(
    () => ordenarCarteira(filtrarCarteira(clientes, filtro), ordem, crescente),
    [clientes, filtro, ordem, crescente],
  );

  const resumo = useMemo(() => resumirCarteira(visiveis), [visiveis]);
  const atalhos = useMemo(() => contarAtalhos(clientes, filtro), [clientes, filtro]);
  const ativos = useMemo(() => clientes.filter((c) => c.isActive).length, [clientes]);

  /* O que o medidor somou, por escrito. Enquanto a primeira resposta não chega
     `meses` está vazio — o período já diz quais meses serão pedidos. */
  const mesesDaTela = meses.length > 0 ? meses : mesesDoPeriodo(periodo);
  const nomeDaCompetencia = competencia(mesesDaTela);
  /* O nome da dimensão na linha — F11A2 (R03). Um mês: "Entrega do mês";
     mais de um, a competência somada: "Entrega de set–out". */
  const rotuloDaEntrega = mesesDaTela.length === 1 ? 'Entrega do mês' : `Entrega de ${nomeDaCompetencia}`;
  const renovacoes = useMemo(() => proximasRenovacoes(clientes), [clientes]);
  const inativos = useMemo(
    () => ordenarCarteira(filtrarCarteira(clientes, { ...filtro, ativo: false }), 'nome', true),
    [clientes, filtro],
  );

  const filtrando = !filtroEstaLimpo(filtro);
  /** Quantos filtros ligados moram na área recolhível do celular. */
  const secundarios = filtro.planoIds.length + filtro.etiquetaIds.length;

  /** O recorte ativo, em palavras — a linha acima da carteira. */
  const pecasDoRecorte = [
    ...filtro.urgencias.map((u) => URGENCIA[u].rotulo),
    ...(filtro.soFinanceiroPendente ? ['Financeiro pendente'] : []),
    ...filtro.planoIds.map((id) => planos.find((p) => p.id === id)?.name ?? ''),
    ...filtro.etiquetaIds.map((id) => etiquetas.find((t) => t.id === id)?.name ?? ''),
    ...(filtro.busca.trim() !== '' ? [`“${filtro.busca.trim()}”`] : []),
  ].filter(Boolean);

  /** O endereço do painel com o recorte, para a ficha do cliente voltar a ele. */
  const origem = local.search;

  const tomDaMedia =
    resumo.nivelMedio === null
      ? undefined
      : resumo.nivelMedio >= 100
        ? 'ok'
        : resumo.nivelMedio >= 70
          ? 'warn'
          : 'err';

  return (
    <PaginaLarga>
      {/* ⚠️ A BARRA CHEGA AO PAINEL — F17.67. Ver `TelaComBarra`. */}
      <TelaComBarra atual="painel">
        {/* O topo — F29: título, cadastrar e escolher o período. */}
        <Topo
          titulo={ROTULO_DO_ITEM.painel}
          acoes={
            <>
              <button
                type="button"
                className="o-btn o-btn-solido"
                onClick={() => setFicha(null)}
                title="Cadastrar um cliente"
              >
                <IconeMais />
                Novo cliente
              </button>

              {/* O intervalo vai para o endereço (`de`/`ate`); o mês corrente
                  inteiro é o padrão e não é escrito. */}
              <SeletorDePeriodo
                valor={periodo}
                mesDeReferencia={`${mesDoPeriodo}-01`}
                aoMudar={(p) => gravar({ periodo: p ?? mesInteiro(mesPadrao) })}
              />
            </>
          }
        />

        {/* --- o que o intervalo muda, e o que ele não muda (F4.11/F27) -------
            FICA ESCRITO, E NÃO VIRA "?" — F43 Fase 10. As frases fixas que só
            explicavam a tela foram para trás de um "?"; esta não explica a
            tela, ela avisa sobre os NÚMEROS: com um intervalo parcial, a
            porcentagem continua sendo do mês inteiro. Escondida, encolher a
            janela pareceria queda de entrega (o erro de leitura mais caro do
            painel, ver o cabeçalho). E ela só aparece quando o intervalo não é
            o mês inteiro. Desde a F43 Fase 10 não há anel: fala da porcentagem. */}
        {!ehMesInteiro(periodo) && (
          <div className="mb-3">
            <Aviso tipo="info">
              <span className="block">
                <b className="text-plat">
                  {mesesDaTela.length === 1
                    ? `Contrato de ${nomeDaCompetencia} inteiro`
                    : `Contratos de ${nomeDaCompetencia} inteiros`}
                </b>{' '}
                na porcentagem de entrega — contrato não se corta ao meio.
              </span>
              <span className="block">
                <b className="text-plat">
                  {periodo.de === periodo.ate
                    ? `Produção do dia ${diaCurto(periodo.de)}`
                    : `Produção de ${diaCurto(periodo.de)} a ${diaCurto(periodo.ate)}`}
                </b>{' '}
                na linha “no intervalo” de cada cliente, só o que tem data marcada.
              </span>
            </Aviso>
          </div>
        )}

        {/* --- o resumo — F11A ------------------------------------------------
            UMA FAIXA, E NÃO TRÊS CARTÕES. Antes: urgência numa lista dentro de
            um cartão, "Clientes" noutro e a entrega no terceiro, com a faixa de
            tipos embaixo — ~190 px antes da busca. Agora os estados que pedem
            ação são botões com o número grande (e cada um é o filtro da
            gaveta correspondente), e a média diz de quem ela é média.

            CARREGANDO — F27. `aria-busy` enquanto a leitura corre; o esmaecer
            só vale quando há números de antes (`data-com-dados`). */}
        <div className="o-recarregavel" aria-busy={carregando} data-com-dados={semDados ? undefined : ''}>
          <section className="pn-resumo" aria-label="Resumo da carteira">
            {/* A URGÊNCIA DIZ QUE É URGÊNCIA — F11A2 (R03). Os três estados
                formam UM grupo com o nome da dimensão e a nota de que ela é
                marcada à mão; Financeiro é outra pergunta e fica ao lado. */}
            <div className="pn-atalhos">
              <div className="pn-urgencias" role="group" aria-labelledby="pn-urgencias-rotulo">
                <div className="pn-urgencias-rotulo">
                  <span id="pn-urgencias-rotulo">Urgência</span>
                  <span className="pn-urgencias-nota">
                    marcada à mão
                    <Ajuda sobre="a urgência" lado="baixo-direita">
                      {AJUDA_DA_URGENCIA}
                    </Ajuda>
                  </span>
                </div>
                {(['perigo', 'alerta', 'paz'] as const).map((u) => (
                  <Atalho
                    key={u}
                    rotulo={URGENCIA[u].rotulo}
                    Icone={URGENCIA[u].Icone}
                    tom={URGENCIA[u].tom}
                    n={atalhos.urgencia[u]}
                    ativo={filtro.urgencias.includes(u)}
                    aoClicar={() => alternarNaLista('urgencias', u)}
                    semDados={semDados}
                  />
                ))}
              </div>
              <Atalho
                rotulo="Financeiro pendente"
                Icone={IconeDinheiro}
                tom="warn"
                n={atalhos.financeiroPendente}
                ativo={filtro.soFinanceiroPendente}
                aoClicar={alternarFinanceiro}
                semDados={semDados}
              />
            </div>

            {/* A MÉDIA E O SEU UNIVERSO — F11A (UX19). O número é a média
                simples do nível de entrega de CADA cliente com entrega medida
                (`resumirCarteira`) — não é peças entregues sobre contratadas,
                que é a faixa de peças. O rótulo e o detalhe dizem isso. */}
            <div className="pn-media" data-tom={semDados ? undefined : tomDaMedia}>
              <span className="pn-media-rotulo" id="pn-media-rotulo">
                Média do nível de entrega · {nomeDaCompetencia}
              </span>
              <span className="pn-media-linha">
                <span className="pn-media-valor tnum" aria-describedby="pn-media-universo">
                  {semDados ? (
                    <Esboco largura="3rem" />
                  ) : resumo.nivelMedio === null ? (
                    '—'
                  ) : (
                    `${resumo.nivelMedio}%`
                  )}
                </span>
                <span className="pn-media-universo" id="pn-media-universo">
                  {semDados
                    ? null
                    : resumo.mensuraveis === 0
                      ? 'nenhum cliente deste recorte tem medida'
                      : [
                          // "com medida", e não "com mês aberto" — F11A2:
                          // quem fica de fora pode ter o mês aberto sem cota,
                          // ou nem contratar conteúdo mensal.
                          `média por cliente, entre ${resumo.mensuraveis}${
                            resumo.mensuraveis === resumo.total ? '' : ` de ${resumo.total}`
                          } com medida`,
                          mesesDaTela.length > 1 ? `${mesesDaTela.length} meses somados` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                </span>
              </span>
            </div>
          </section>
        </div>

        {/* --- barra de trabalho: buscar, recortar, ordenar -------------------
            CELULAR — F11A2 (R07): peças e filtros secundários (Plano,
            Etiqueta) recolhem atrás de "Peças e filtros", ao lado da busca.
            A busca e os atalhos de prioridade continuam à vista, e o que está
            filtrando continua escrito na linha do recorte. No computador o
            botão some e a área se abre em linha (`display: contents`). */}
        <section className="pn-ferramentas" aria-label="Buscar e filtrar a carteira" onBlur={busca.gravarJa}>
          <CampoDeBusca
            rotulo="Buscar cliente por nome, plano ou etiqueta"
            exemplo="Buscar cliente…"
            valor={busca.texto}
            aoMudar={busca.definir}
          />

          <button
            type="button"
            className="o-btn o-btn-vidro pn-mais-botao"
            aria-expanded={maisAberto}
            aria-controls="pn-mais"
            onClick={() => setMaisAberto((v) => !v)}
            data-filtrando={secundarios > 0 ? '' : undefined}
          >
            Peças e filtros
            {secundarios > 0 && <span className="pn-mais-n tnum">{secundarios}</span>}
            <IconeChevron className="pn-mais-seta" />
          </button>

          <div className="pn-mais" id="pn-mais" data-aberto={maisAberto ? '' : undefined}>
            {/* A FAIXA DOS TIPOS — peças, e não média: entregue/contratado do
                recorte, com o que falta. Uma linha só no computador, ACIMA da
                busca (`order` no CSS); no celular ela mora na área recolhível. */}
            <section
              className="pn-tipos o-recarregavel"
              aria-label={`Peças do contrato de ${nomeDaCompetencia}, por tipo`}
              aria-busy={carregando}
              data-com-dados={semDados ? undefined : ''}
            >
              <span className="pn-tipos-rotulo">Peças · contrato</span>
              {CONTENT_TYPES.map((t) => {
                const { contracted, delivered, extras } = resumo.porTipo[t];
                const falta = Math.max(0, contracted - delivered);
                const { rotulo, Icone, cor } = TIPO[t];
                return (
                  <div key={t} className="pn-tipos-item">
                    <span className="pn-tipos-nome">
                      <span style={{ color: cor }}>
                        <Icone className="h-3.5 w-3.5" />
                      </span>
                      {rotulo}
                    </span>
                    <span className="pn-tipos-conta tnum">
                      {semDados ? (
                        <Esboco largura="2.5rem" />
                      ) : (
                        <>
                          <b>{delivered}</b>/{contracted}
                        </>
                      )}
                    </span>
                    <span className="pn-tipos-falta">
                      {semDados
                        ? null
                        : contracted === 0 && extras === 0
                          ? 'nada contratado'
                          : `${falta > 0 ? `faltam ${falta}` : 'completo'}${extras > 0 ? ` · +${extras} extra` : ''}`}
                    </span>
                  </div>
                );
              })}
            </section>

            {/* Os filtros, em gavetas (F17.37): trinta e três pílulas abertas
                empurravam a carteira para fora da tela. A borda acesa é o aviso
                de que a gaveta fechada está filtrando. */}
            <div className="pn-filtros">
              {/* No celular a gaveta Urgência e a pílula Financeiro saem: são
                  os MESMOS filtros dos atalhos logo acima (mesmo estado, mesmo
                  número), e sem elas Plano e Etiqueta cabem numa linha. */}
              <span className="pn-filtro-repetido">
                <Gaveta
                  rotulo="Urgência"
                  itens={URGENCIAS.map((u) => ({
                    valor: u,
                    rotulo: URGENCIA[u].rotulo,
                    // O mesmo número do atalho do resumo — F11A.
                    contagem: atalhos.urgencia[u],
                  }))}
                  escolhidos={filtro.urgencias}
                  aoAlternar={(v) => alternarNaLista('urgencias', v as Urgencia)}
                  aoLimpar={() => gravar({ filtro: { urgencias: [] } })}
                  larguraDoBalao="w-56"
                />
              </span>

              <Gaveta
                rotulo="Plano"
                itens={planos.map((p) => ({
                  valor: p.id,
                  rotulo: p.name,
                  contagem: clientes.filter((c) => c.plan?.id === p.id).length,
                }))}
                escolhidos={filtro.planoIds}
                aoAlternar={(v) => alternarNaLista('planoIds', v)}
                aoLimpar={() => gravar({ filtro: { planoIds: [] } })}
                larguraDoBalao="w-64"
              />

              {etiquetas.length > 0 && (
                <Gaveta
                  rotulo="Etiqueta"
                  itens={etiquetas.map((t) => ({
                    valor: t.id,
                    rotulo: t.name,
                    contagem: clientes.filter((c) => c.tags.some((x) => x.id === t.id)).length,
                  }))}
                  escolhidos={filtro.etiquetaIds}
                  aoAlternar={(v) => alternarNaLista('etiquetaIds', v)}
                  aoLimpar={() => gravar({ filtro: { etiquetaIds: [] } })}
                  larguraDoBalao="w-72"
                />
              )}

              {/* Ligado/desligado, e não lista: continua pílula. É o mesmo
                  filtro do atalho "Financeiro pendente" do resumo. */}
              <span className="pn-filtro-repetido">
                <Pilula ativo={filtro.soFinanceiroPendente} aoClicar={alternarFinanceiro}>
                  Financeiro pendente
                  {!semDados && <Contagem>{atalhos.financeiroPendente}</Contagem>}
                </Pilula>
              </span>
            </div>
          </div>
        </section>

        {/* A FALHA OFERECE O PRÓXIMO PASSO — F27. E quando há números de antes
            na tela, o aviso diz de quando eles são. */}
        {erro && (
          <div className="mb-3">
            <Aviso
              tipo="erro"
              acao={{ rotulo: 'Tentar novamente', aoClicar: () => setRecarga((n) => n + 1) }}
            >
              <span className="block">
                <b className="text-plat">
                  {semDados ? 'Não foi possível carregar o painel.' : 'Não foi possível atualizar.'}
                </b>{' '}
                {erro}
              </span>
              {periodoDosDados && (
                <span className="block">
                  {periodoDosDados.de === periodo.de && periodoDosDados.ate === periodo.ate
                    ? 'Os números abaixo são da última leitura que deu certo.'
                    : `Os números abaixo ainda são de ${descreverPeriodo(periodoDosDados)}, o período anterior — não do que está escolhido.`}
                </span>
              )}
            </Aviso>
          </div>
        )}

        {/* --- a carteira ------------------------------------------------------ */}
        <section
          className="o-recarregavel"
          aria-busy={carregando}
          data-com-dados={semDados ? undefined : ''}
          aria-labelledby="pn-recorte"
        >
          {/* O RECORTE ATIVO — F11A. Quantos de quantos, e o quê: uma lista
              curta que não diz por que é curta faz procurar o cliente que
              "sumiu". Sem leitura nenhuma, um número seria inventado (F27). */}
          <div className="pn-recorte">
            <h2 id="pn-recorte" className="pn-recorte-texto" aria-live="polite">
              {semDados ? (
                carregando ? 'Carregando a carteira…' : 'Clientes ativos'
              ) : filtrando ? (
                <>
                  <b className="tnum">{visiveis.length}</b> de {ativos} clientes ativos
                  <span className="pn-recorte-pecas"> · {pecasDoRecorte.join(' · ')}</span>
                </>
              ) : (
                <>
                  <b className="tnum">{visiveis.length}</b>{' '}
                  {visiveis.length === 1 ? 'cliente ativo' : 'clientes ativos'}
                </>
              )}
            </h2>
            {!semDados && carregando && <span className="pn-recorte-nota">atualizando…</span>}
            {filtrando && (
              <button type="button" className="o-btn o-btn-fantasma o-btn-sm" onClick={limparFiltros}>
                Limpar filtros
              </button>
            )}
            {!semDados && renovacoes.length > 0 && (
              // Botão que rola, e não link com `#`: um âncora empilharia uma
              // entrada no histórico, e o VOLTAR viraria "subir a página".
              <button
                type="button"
                className="pn-recorte-atalho"
                onClick={() =>
                  document.getElementById('pn-renovacoes')?.scrollIntoView({ block: 'start' })
                }
              >
                {renovacoes.length} {renovacoes.length === 1 ? 'renovação' : 'renovações'} em 45 dias ↓
              </button>
            )}
            {/* ORDENAR — F11A: um critério e um sentido, ditos por extenso, no
                lugar de quatro pílulas que competiam com os filtros. Mora na linha
                da carteira porque é dela que fala. */}
            <div className="pn-ordem">
              <label className="pn-ordem-rotulo" htmlFor="pn-ordem">
                Ordenar
              </label>
              <select
                id="pn-ordem"
                className="o-campo o-select pn-ordem-campo"
                value={ordem}
                onChange={(e) => gravar({ ordem: e.target.value as Ordem })}
              >
                {(Object.keys(ORDENS) as Ordem[]).map((o) => (
                  <option key={o} value={o}>
                    {ORDENS[o]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="o-btn o-btn-vidro o-btn-sm pn-sentido"
                onClick={() => gravar((r) => ({ crescente: !r.crescente }))}
                aria-label={`Sentido: ${crescente ? 'crescente' : 'decrescente'}. Inverter`}
                title="Inverter o sentido"
              >
                <span aria-hidden>{crescente ? '↑' : '↓'}</span>
                <span className="pn-sentido-texto">{crescente ? 'Crescente' : 'Decrescente'}</span>
              </button>
            </div>
          </div>

          {/* A CARTEIRA EM LINHAS — F43 Fase 10. `pn-lista` é o contêiner que
              mede a largura (a coluna do conteúdo muda com a barra, não com a
              janela): larga, as colunas com cabeçalho; estreita, cada linha
              empilha com os nomes das medidas escritos nela. */}
          <div className="pn-lista">
            {(visiveis.length > 0 || (semDados && carregando)) && (
              <CabecaDaCarteira
                rotuloDaEntrega={rotuloDaEntrega}
                comUltima={visiveis.some((c) => (c.deliveryStatus ?? null) !== null)}
              />
            )}
            <div className="pn-carteira">
              {semDados && carregando
                ? [0, 1, 2].map((i) => <CartaoEsboco key={i} />)
                : visiveis.map((c) => (
                    <CartaoDeCliente
                      key={c.id}
                      c={c}
                      aoEditar={() => setFicha(c.id)}
                      origem={origem}
                      rotuloDaEntrega={rotuloDaEntrega}
                    />
                  ))}
            </div>

            {/* O vazio mora DENTRO da lista, logo depois dela: é a lista que
                ficou vazia (e o e2e PX4 acha o "Limpar filtros" dele como
                vizinho da carteira, não o da linha do recorte). */}
            {!carregando && !semDados && visiveis.length === 0 && !erro && (
              // O VAZIO DIZ O QUE FAZER — F27. Filtro sem resultado desfaz o
              // filtro; carteira vazia de verdade oferece cadastrar.
              filtrando ? (
                <Aviso tipo="info" acao={{ rotulo: 'Limpar filtros', aoClicar: limparFiltros }}>
                  Nenhum cliente ativo casa com {pecasDoRecorte.join(' · ')}.
                </Aviso>
              ) : (
                <Aviso
                  tipo="info"
                  acao={{ rotulo: 'Cadastrar cliente', aoClicar: () => setFicha(null) }}
                >
                  Nenhum cliente aqui. Se você esperava ver algum, pode ser que ele não esteja
                  atribuído a você.
                </Aviso>
              )
            )}
          </div>
        </section>

        {/* --- renovações ------------------------------------------------------ */}
        {renovacoes.length > 0 && (
          <section className="mt-8" id="pn-renovacoes">
            {/* "toda a carteira" por escrito — F27. A lista vem de `clientes`,
                não de `visiveis`: filtrar a carteira não esconde um contrato
                que vence. */}
            <h2 className="eyebrow mb-2">Renovações · toda a carteira · próximos 45 dias</h2>
            {/* Em linhas, como a carteira — F43 Fase 10: eram blocos de fundo
                tingido numa grade, e embaixo de uma lista calma pareciam outra
                tela. O selo do prazo fica (é a exceção: vencido, perto). */}
            <ul className="pn-mini-lista">
              {renovacoes.map(({ cliente: c, dias }) => (
                <li key={c.id}>
                  <Link to={`/cliente/${c.id}`} state={{ painel: origem }} className="pn-mini">
                    <span className="pn-mini-texto">
                      <span className="pn-mini-nome">{c.name}</span>
                      <span className="pn-mini-dado tnum">{c.renewsOn && dataCurta(c.renewsOn)}</span>
                    </span>
                    <Selo tom={dias < 0 ? 'err' : dias <= 15 ? 'warn' : 'neutro'}>
                      {dias < 0 && <IconeAlerta className="h-3 w-3" />}
                      {prazoDaRenovacao(dias)}
                    </Selo>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --- conferência da junção (F27: depois da carteira, recolhida) ----- */}
        <BlocoDaConferencia conferencia={conferencia} alcancaQuadro={podeVer(sessao, 'quadro')} />

        {/* --- arquivo --------------------------------------------------------- */}
        {inativos.length > 0 && (
          <section className="mt-8 pb-10">
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-sm mb-2 px-0"
              aria-expanded={verArquivo}
              onClick={() => setVerArquivo((v) => !v)}
            >
              <IconeArquivo />
              <span className="eyebrow">
                Arquivo · {inativos.length} clientes antigos {verArquivo ? '▾' : '▸'}
              </span>
            </button>

            {verArquivo && (
              <ul className="pn-mini-lista" data-arquivo="">
                {inativos.map((c) => (
                  <li key={c.id}>
                    <Link to={`/cliente/${c.id}`} state={{ painel: origem }} className="pn-mini">
                      <span className="pn-mini-texto">
                        <span className="pn-mini-nome">{c.name}</span>
                        <span className="pn-mini-dado">
                          {c.plan && <span>{c.plan.name}</span>}
                          {c.inactiveAt && <span className="tnum">desde {dataCurta(diaDoInstante(c.inactiveAt))}</span>}
                        </span>
                      </span>
                      <Selo>Inativo</Selo>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </TelaComBarra>
      {ficha !== undefined && (
        <FichaDeCliente
          clienteId={ficha}
          aoFechar={() => setFicha(undefined)}
          aoSalvar={() => {
            setFicha(undefined);
            // Relê o painel em vez de remendar a lista em memória: o medidor,
            // a contagem e os números do topo dependem do que mudou.
            setRecarga((n) => n + 1);
          }}
        />
      )}
    </PaginaLarga>
  );
}
