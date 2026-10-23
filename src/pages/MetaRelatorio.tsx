/**
 * Meta · o relatório de uma conta — etapa F9.
 *
 * É o que o usuário descreveu como sendo a área Meta: "relatórios, seja de
 * campanhas com as KPIs e gráficos das campanhas que forem puxados dos
 * gerenciadores de anúncios específicos de cada BM, como também os IGs com as
 * informações KPIs e gráficos que aparecem no painel profissional".
 *
 * São dois relatórios diferentes, e não um com um interruptor: uma conta de
 * anúncio responde "para onde foi o dinheiro e o que voltou", e um perfil
 * responde "quanta gente chegou e quanta reagiu". Compartilham o intervalo e o
 * jeito de desenhar — nada mais.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ÚNICA REGRA DE TELA QUE VALE DISCUTIR: O QUE ESTA TELA SE RECUSA A SOMAR
 *
 *   Alcance conta PESSOAS DISTINTAS. Somar o alcance de trinta dias não dá o
 *   alcance do mês — dá um número inflado, porque quem viu em dois dias é
 *   contado duas vezes. Do total diário não há como recuperar a interseção.
 *
 *   Então onde o dado é de pessoas, esta tela mostra **média por dia** e
 *   **melhor dia**, e diz isso na cara: "não se soma". A curva do alcance
 *   aparece com o aviso de que serve para ver a forma, não para somar.
 *
 *   É a diferença entre um relatório que a agência pode mandar para o cliente e
 *   um que ela vai ter que desmentir depois.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * "—" NÃO É ZERO
 *   CTR de campanha sem impressão, ROAS sem conversão, variação sem base: tudo
 *   isso é `null`, e `null` desenha travessão. Um zero ali seria lido como
 *   "performou mal", que é afirmação diferente de "não rodou".
 */

import { dinheiro } from '@/meta/formato';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Ajuda } from '@/board/menus';
import { TelaComBarra } from '@/board/TelaComBarra';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDeDetalhe } from '@/board/trilha';
import { ApiError, api, semSessao } from '@/lib/api';
import {
  type DiaDeCampanha,
  type DiaOrganico,
  type PorDia,
  resumirOrganico,
  lerVariacao,
  periodoAnterior,
  resumirPago,
  variacao,
  serie,
  serieDeDistinta,
} from '@/meta/relatorio';
import {
  AbaConteudo,
  AbaPublico,
  type LinhaDeDemografia,
  type LinhaDeQuebra,
  QuebraDoPeriodo,
} from '@/meta/PainelDoPerfil';
import {
  type CampanhaComObjetivo,
  CampanhasPorObjetivo,
} from '@/meta/CampanhasPorObjetivo';
import {
  type Periodo,
  coberturaDoPeriodo,
  dias as emDias,
  janelaPadrao,
  periodoDoEndereco,
  quando,
  rotuloDoPeriodo,
  tamanhoDoPeriodo,
} from '@/meta/contexto';
import { ChaveDeLeitura, FaixaDeContexto, GrupoDeMetricas, type ItemDeContexto, Numero } from '@/meta/Leitura';
import type { Publicacao } from '@/meta/publicacoes';
import { Abas } from '@/ui/AlternadorDeVista';
import { useIdDasAbas } from '@/ui/abas';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { LinhaDoTempo } from '@/ui/Graficos';
import { Aviso, PaginaLarga, Variacao } from '@/ui/primitivos';
import { SeletorDePeriodo } from '@/ui/SeletorDePeriodo';
import { Topo } from '@/ui/Topo';

type Conta = {
  id: string;
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  businessName: string | null;
  pageName: string | null;
  client: { id: string; name: string } | null;
  empresa?: { id: string; name: string } | null;
  isActive?: boolean;
  lastSeenAt?: string | null;
  lastError?: string | null;
  diasColetados: number;
};

/* ─── como o número aparece ────────────────────────────────────────────────── */

const TRACO = '—';

const inteiro = (v: number | null) =>
  v === null ? TRACO : Math.round(v).toLocaleString('pt-BR');


const percentual = (v: number | null) =>
  v === null ? TRACO : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const decimal = (v: number | null, casas = 2) =>
  v === null ? TRACO : v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

const publicacoes_ = (n: number | null) =>
  n === null ? `${TRACO} publicações` : `${n.toLocaleString('pt-BR')} ${n === 1 ? 'publicação' : 'publicações'}`;

/**
 * O cartão de uma métrica de pessoas distintas.
 *
 * Existe separado justamente para não ter onde escrever um total. O rótulo diz
 * "por dia" e o detalhe mostra o melhor dia — as duas verdades que sobram
 * quando a soma é proibida.
 */
function CartaoPorDia({ rotulo, dados }: { rotulo: string; dados: PorDia }) {
  return (
    <Numero
      rotulo={`${rotulo} · média/dia`}
      valor={inteiro(dados.media)}
      detalhe={
        dados.pico === null
          ? 'sem dado no período'
          : `melhor dia ${inteiro(dados.pico)} em ${diaCurto(dados.diaDoPico as string)} · ${emDias(dados.dias)}`
      }
    />
  );
}

const AVISO_DE_ALCANCE =
  'Alcance conta pessoas distintas: a curva mostra a forma do período, mas os dias não se somam — as mesmas pessoas aparecem em vários.';

/* ─── a tela ───────────────────────────────────────────────────────────────── */

export default function MetaRelatorio() {
  const { id = '' } = useParams();

  /* O PERÍODO MORA NO ENDEREÇO — F14. Recarregar, voltar do navegador e mandar
     o link mantêm o período que a pessoa estava lendo. Sem `de`/`ate` válidos,
     vale a janela padrão da coleta. As duas pontas entram na memória como
     texto: um objeto novo a cada desenho pediria o relatório de novo em laço. */
  const [params, setParams] = useSearchParams();
  const pedido = periodoDoEndereco(params);
  const dePedido = pedido?.de ?? null;
  const atePedido = pedido?.ate ?? null;
  const periodo = useMemo<Periodo>(
    () => (dePedido !== null && atePedido !== null ? { de: dePedido, ate: atePedido } : janelaPadrao()),
    [dePedido, atePedido],
  );
  const mudarPeriodo = useCallback(
    (p: Periodo | null) => {
      setParams(
        (atual) => {
          const n = new URLSearchParams(atual);
          if (p === null) {
            n.delete('de');
            n.delete('ate');
          } else {
            n.set('de', p.de);
            n.set('ate', p.ate);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [conta, setConta] = useState<Conta | null>(null);
  const [pago, setPago] = useState<DiaDeCampanha[] | null>(null);
  const [pagoAntes, setPagoAntes] = useState<DiaDeCampanha[] | null>(null);
  const [comObjetivo, setComObjetivo] = useState<CampanhaComObjetivo[]>([]);
  const [organico, setOrganico] = useState<DiaOrganico[] | null>(null);
  const [demografia, setDemografia] = useState<LinhaDeDemografia[]>([]);
  const [quebras, setQuebras] = useState<LinhaDeQuebra[]>([]);
  const [publicacoesDaConta, setPublicacoes] = useState<Publicacao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  /**
   * QUAL LEITURA FALHOU, para o `Tentar de novo` repetir a certa — F29.5b.
   * `conta`: a lista de contas (sem ela não se sabe nem o tipo do relatório);
   * `relatorio`: os números da conta já conhecida. `null`: nada a repetir —
   * inclusive "conta não encontrada", que não é falha passageira.
   */
  const [falhou, setFalhou] = useState<'conta' | 'relatorio' | null>(null);
  /** Cada `Tentar de novo` da lista de contas soma um, e o efeito relê. */
  const [tentativa, setTentativa] = useState(0);
  /**
   * A LEITURA MAIS RECENTE É A QUE VALE — F14. Trocar o período duas vezes
   * seguidas punha duas leituras no ar; a mais lenta chegava por último e
   * desenhava o período ERRADO embaixo do rótulo certo.
   */
  const leitura = useRef(0);

  // A lista de contas é a fonte de `kind`, e é ela que decide qual dos dois
  // relatórios pedir. Adivinhar chamando um e caindo no erro do outro
  // funcionaria — e transformaria uma recusa legítima em rotina.
  //
  // ⚠️ SEM CONTA, O `Carregando…` TAMBÉM PRECISA ACABAR — F29.5b. Só `buscar`
  // desligava a espera, e `buscar` não faz nada sem conta: com a lista de
  // contas falhando (ou sem a conta nela), a tela dizia `Carregando…` para
  // sempre embaixo do erro. Agora a falha e a ausência desligam aqui mesmo.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    setFalhou(null);
    void (async () => {
      try {
        const r = await api.contasDaMeta();
        if (!vivo) return;
        const achada = (r.accounts as Conta[]).find((c) => c.id === id) ?? null;
        setConta(achada);
        if (!achada) {
          setErro('Conta não encontrada ou fora do seu alcance.');
          setCarregando(false);
        }
      } catch (e) {
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        if (!vivo) return;
        setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar.');
        setFalhou('conta');
        setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [id, tentativa]);

  const buscar = useCallback(async () => {
    if (!conta) return;
    const minha = ++leitura.current;
    const valendo = () => minha === leitura.current;
    setCarregando(true);
    setErro(null);
    setFalhou(null);
    try {
      if (conta.kind === 'ad_account') {
        const r = await api.relatorioPago(conta.id, periodo.de, periodo.ate);

        // O MESMO PERÍODO, IMEDIATAMENTE ANTES.
        //
        // Sem ele, "R$ 4.202 investidos" não responde à pergunta que a pessoa
        // veio fazer, que é se está melhorando. A régua é o tamanho do
        // intervalo escolhido: sete dias comparam com os sete anteriores, e não
        // com "a semana passada do calendário".
        const antes = periodoAnterior(periodo.de, periodo.ate);
        const ra = await api.relatorioPago(conta.id, antes.de, antes.ate);
        const rc = await api.campanhasDaConta(conta.id, periodo.de, periodo.ate);
        if (!valendo()) return;
        setPago(r.dias as DiaDeCampanha[]);
        setPagoAntes(ra.dias as DiaDeCampanha[]);
        setComObjetivo(rc.campanhas as CampanhaComObjetivo[]);
      } else {
        const r = await api.relatorioOrganico(conta.id, periodo.de, periodo.ate);

        // As publicações vêm em chamada separada porque NÃO dependem do
        // intervalo: a métrica delas é acumulada desde que foram ao ar. Juntar
        // as duas obrigaria a recarregar a lista inteira a cada mudança de
        // período, sem que uma linha sequer mudasse.
        const m = await api.publicacoesDaConta(conta.id);
        if (!valendo()) return;
        setOrganico(r.dias as DiaOrganico[]);
        setDemografia(r.demografia as LinhaDeDemografia[]);
        setQuebras(r.quebras as LinhaDeQuebra[]);
        setPublicacoes(m.publicacoes as Publicacao[]);
      }
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      if (!valendo()) return;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar o relatório.');
      setFalhou('relatorio');
    } finally {
      if (valendo()) setCarregando(false);
    }
  }, [conta, periodo]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const eAds = conta?.kind === 'ad_account';
  const nomeDaConta = conta?.displayName ?? conta?.externalId ?? '…';
  const tentarDeNovo =
    falhou === 'conta'
      ? { rotulo: 'Tentar de novo', aoClicar: () => setTentativa((n) => n + 1) }
      : falhou === 'relatorio'
        ? { rotulo: 'Tentar de novo', aoClicar: () => void buscar() }
        : undefined;

  /* O CONTEXTO DOS NÚMEROS — F14. O que ficava espalhado (um `eyebrow`, uma
     etiqueta do cliente, o gerenciador em mono, o período só no botão) vira
     uma faixa só, lida antes de qualquer número: de quem, de onde, de quando,
     comparado com quando, e o estado da coleta. */
  const contexto = useMemo<ItemDeContexto[]>(() => {
    if (conta === null) return [];
    const itens: ItemDeContexto[] = [
      { rotulo: 'Relatório', valor: conta.kind === 'ad_account' ? 'Campanhas' : 'Perfil do Instagram' },
      {
        rotulo: 'Cliente',
        valor: conta.client ? (
          <Link to={`/cliente/${conta.client.id}`} className="mm-contexto-link" title="Abrir a ficha do cliente">
            {conta.client.name}
          </Link>
        ) : (
          <span className="mm-contexto-fraco">sem cliente atribuído</span>
        ),
      },
    ];
    if (conta.kind === 'ad_account') {
      itens.push({
        rotulo: 'Gerenciador',
        valor: conta.businessName ? (
          <>
            {conta.businessName}{' '}
            <Link
              to={`/meta/ranking?bm=${encodeURIComponent(conta.businessName)}&de=${periodo.de}&ate=${periodo.ate}`}
              className="mm-contexto-link mm-contexto-acao"
              title="Os criativos deste gerenciador, no mesmo período"
            >
              ver no ranking
            </Link>
          </>
        ) : (
          <span className="mm-contexto-fraco">não informado</span>
        ),
      });
    } else {
      itens.push({
        rotulo: 'Página',
        valor: conta.pageName ?? <span className="mm-contexto-fraco">não informada</span>,
      });
    }
    if (conta.empresa) itens.push({ rotulo: 'Empresa', valor: conta.empresa.name });
    itens.push({ rotulo: 'ID na Meta', valor: <span className="o-mono">{conta.externalId}</span> });
    itens.push({
      rotulo: 'Período',
      valor: `${rotuloDoPeriodo(periodo)} · ${emDias(tamanhoDoPeriodo(periodo))}`,
    });
    if (conta.kind === 'ad_account') {
      itens.push({ rotulo: 'Comparado com', valor: rotuloDoPeriodo(periodoAnterior(periodo.de, periodo.ate)) });
    }
    itens.push({
      rotulo: 'Coleta',
      valor:
        conta.lastError ? (
          <span className="mm-contexto-falha">última coleta falhou: {conta.lastError}</span>
        ) : conta.diasColetados > 0 ? (
          `${emDias(conta.diasColetados)} de série${conta.lastSeenAt ? ` · última ${quando(conta.lastSeenAt)}` : ''}`
        ) : (
          <span className="mm-contexto-fraco">nunca coletada</span>
        ),
    });
    return itens;
  }, [conta, periodo]);

  const dadosDoPeriodo = conta === null ? null : eAds ? pago : organico;
  const periodoEhPadrao = pedido === null;
  const pronto = !carregando && erro === null && conta !== null && dadosDoPeriodo !== null;
  const semNenhumDia = pronto && dadosDoPeriodo.length === 0;

  return (
    <PaginaLarga>
      {/* A BARRA CHEGA AO RELATÓRIO — F17.67. Mesma decisão de `MetaContas`.

          As tabelas largas rolam DENTRO da caixa (`.o-tab-rola`) e os gráficos
          são SVG com `viewBox`, então a coluna mais estreita não corta nada —
          conferido na prova da etapa, nas duas larguras. */}
      <TelaComBarra>
        {/* O TOPO — F29 (Fase 5a). O relatório é DETALHE da Meta: a trilha
            `Meta › <conta>` substitui o `‹ Contas` à mão, e o primeiro degrau
            diz o nome do lugar a que leva — a tela chamada Meta. O título é a
            conta, como era (`…` enquanto ela não chega). A trilha NÃO espera
            a conta, e é de propósito: o degrau `Meta` não depende dela, e se
            a leitura falhar ele é a saída com nome da tela de erro. A ação da
            página é o período. */}
        <Topo
          titulo={nomeDaConta}
          trilha={<Trilha degraus={trilhaDeDetalhe({ nome: 'Meta', destino: '/meta' }, nomeDaConta)} />}
          acoes={
            <SeletorDePeriodo
              valor={periodo}
              mesDeReferencia={`${periodo.ate.slice(0, 7)}-01`}
              aoMudar={(p) => p && mudarPeriodo(p)}
            />
          }
        />

        {conta !== null && <FaixaDeContexto itens={contexto} />}

        {erro && (
          <div className="mt-4">
            <Aviso tipo="erro" acao={tentarDeNovo}>
              {erro}
            </Aviso>
          </div>
        )}

        {carregando && erro === null && <EstadoDaPagina tipo="carregando" titulo="Carregando o relatório…" linhas={4} />}

        {/* SEM COLETA ≠ PERÍODO SEM DADO ≠ ZERO — F14. Antes, a conta sem
            coleta mostrava o aviso E embaixo uma parede de cartões com
            travessão; o período fora da janela mostrava os mesmos travessões
            sem dizer por quê. Agora cada ausência tem nome e saída. */}
        {semNenhumDia && conta !== null && conta.diasColetados === 0 && (
          <EstadoDaPagina tipo="vazio" titulo="Esta conta ainda não tem coleta">
            O relatório aparece depois da primeira coleta, que guarda os últimos 28 dias. Até lá
            nenhum número aqui seria verdadeiro — nem zero.
          </EstadoDaPagina>
        )}
        {semNenhumDia && conta !== null && conta.diasColetados > 0 && (
          <EstadoDaPagina
            tipo="vazio"
            titulo="Nada coletado neste período"
            acao={periodoEhPadrao ? undefined : { rotulo: 'Ver os últimos 28 dias', aoClicar: () => mudarPeriodo(null) }}
          >
            {`Entre ${rotuloDoPeriodo(periodo)} esta conta não tem nenhum dia coletado. A coleta guarda os últimos 28 dias — o que ficou fora deles a Meta não devolve.`}
          </EstadoDaPagina>
        )}

        {pronto && !semNenhumDia && conta && eAds && pago && (
          <Campanhas
            dias={pago}
            antes={pagoAntes}
            periodo={periodo}
            comObjetivo={comObjetivo}
            assetId={id}
          />
        )}
        {/* O CONTEXTO muda o dicionario de cor para esta subarvore inteira.
            Nenhum componente aqui dentro sabe: todos continuam pedindo
            `var(--luz)`, e o que muda e o que ela significa. */}
        {pronto && !semNenhumDia && conta && !eAds && organico && (
          <div data-contexto="instagram">
            <Perfil
              dias={organico}
              periodo={periodo}
              demografia={demografia}
              quebras={quebras}
              publicacoes={publicacoesDaConta}
            />
          </div>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}

/** A cobertura do período e a chave dos sinais, numa linha antes dos números. */
function LinhaDeLeitura({ linhas, periodo }: { linhas: readonly { day: string }[]; periodo: Periodo }) {
  const { comDado, total } = coberturaDoPeriodo(linhas, periodo);
  return (
    <div className="mm-leitura">
      <p className="mm-cobertura" data-incompleto={comDado < total || undefined}>
        {comDado < total
          ? `Há dado em ${comDado} dos ${total} dias do período.`
          : `Há dado em todos os ${emDias(total)} do período.`}
      </p>
      <ChaveDeLeitura />
    </div>
  );
}

/* ─── conta de anúncio ─────────────────────────────────────────────────────── */

function Campanhas({
  dias,
  antes,
  periodo,
  comObjetivo,
  assetId,
}: {
  dias: DiaDeCampanha[];
  antes: DiaDeCampanha[] | null;
  periodo: Periodo;
  comObjetivo: CampanhaComObjetivo[];
  /** Para a campanha poder abrir os anuncios dela — F10i. */
  assetId: string;
}) {
  const total = useMemo(() => resumirPago(dias), [dias]);
  const totalAntes = useMemo(() => (antes === null ? null : resumirPago(antes)), [antes]);

  /**
   * A variação de uma métrica e como lê-la.
   *
   * Sem período anterior, devolve nada — e nada é o certo. Zero diria "não
   * mudou", que é afirmação diferente de "não há com o que comparar".
   */
  const vs = (chave: string) => {
    if (totalAntes === null) return { valor: null, leitura: null };
    const atual = (total as unknown as Record<string, unknown>)[chave];
    const anterior = (totalAntes as unknown as Record<string, unknown>)[chave];
    const n = (v: unknown) => (typeof v === "number" ? v : null);
    const v = variacao(n(atual), n(anterior));
    return { valor: v, leitura: lerVariacao(chave, v) };
  };
  const serieGasto = useMemo(
    () => serie(dias, 'spend', periodo.de, periodo.ate),
    [dias, periodo],
  );
  const serieAlcance = useMemo(
    () => serieDeDistinta(dias, 'reach', periodo.de, periodo.ate),
    [dias, periodo],
  );

  return (
    <>
      <LinhaDeLeitura linhas={dias} periodo={periodo} />

      <GrupoDeMetricas
        titulo="Investimento e entrega"
        descricao="Para onde foi o dinheiro e quantas vezes o anúncio apareceu. A seta compara com o período anterior do mesmo tamanho."
        colunas={3}
      >
        <Numero
          rotulo="Investido"
          nulo={total.spend === null}
          valor={
            <>
              {dinheiro(total.spend)}
              <Variacao {...vs("spend")} />
            </>
          }
          detalhe={`${emDias(total.dias)} com movimento`}
        />
        <Numero
          rotulo="Impressões"
          nulo={total.impressions === null}
          valor={
            <>
              {inteiro(total.impressions)}
              <Variacao {...vs("impressions")} />
            </>
          }
          detalhe={
            <>
              CPM {dinheiro(total.cpm)}
              <Variacao {...vs("cpm")} />
            </>
          }
        />
        {/* Alcance fica em cartão próprio, sem total — ver o cabeçalho. */}
        <CartaoPorDia rotulo="Alcance" dados={total.alcance} />
      </GrupoDeMetricas>

      <GrupoDeMetricas titulo="Resposta" descricao="O que as pessoas fizeram depois de ver o anúncio." colunas={2}>
        <Numero
          rotulo="Cliques"
          nulo={total.clicks === null}
          valor={
            <>
              {inteiro(total.clicks)}
              <Variacao {...vs("clicks")} />
            </>
          }
          detalhe={
            <>
              CTR {percentual(total.ctr)}
              <Variacao {...vs("ctr")} /> · CPC {dinheiro(total.cpc)}
              <Variacao {...vs("cpc")} />
            </>
          }
        />
        <Numero
          rotulo="Resultados"
          nulo={total.conversions === null}
          valor={
            <>
              {inteiro(total.conversions)}
              <Variacao {...vs("conversions")} />
            </>
          }
          detalhe={
            <>
              CPA {dinheiro(total.cpa)}
              <Variacao {...vs("cpa")} /> · ROAS{" "}
              {total.roas === null ? TRACO : `${decimal(total.roas)}×`}
              <Variacao {...vs("roas")} />
            </>
          }
        />
      </GrupoDeMetricas>

      <section className="mm-grupo" aria-label="Dia a dia">
        <div className="mm-graficos" data-colunas={2}>
          <div className="o-card mm-grafico">
            <h3 className="eyebrow mb-2">Investimento por dia</h3>
            <LinhaDoTempo titulo="Investimento por dia" pontos={serieGasto} formatar={(v) => dinheiro(v)} />
          </div>
          <div className="o-card mm-grafico">
            <h3 className="eyebrow mb-2">Alcance por dia</h3>
            <LinhaDoTempo
              titulo="Alcance por dia"
              pontos={serieAlcance}
              cor="var(--luz-lives)"
              rodape={AVISO_DE_ALCANCE}
            />
          </div>
        </div>
      </section>

      <section className="mm-grupo" aria-labelledby="mm-campanhas-titulo">
        <div className="mm-grupo-cabeca">
          <h2 id="mm-campanhas-titulo" className="mm-grupo-titulo">
            Campanhas por objetivo
            <span className="tnum mm-grupo-conta">{comObjetivo.length}</span>
          </h2>
          {/* A NOTA DO FIM DA TABELA VIROU "?" — F43 Fase 10. Ela explicava a
              leitura (de onde sai o resultado, por que o alcance é
              aproximado), e frase fixa de instrução vai para o "?" ao lado do
              que explica. O aviso do DADO continua à vista onde o número
              mora: a coluna se chama "Alcance (aprox.)". */}
          <Ajuda sobre="os números das campanhas" lado="baixo-direita">
            <p>
              O alcance é somado entre os dias, e por isso aproximado — ele conta pessoas distintas.
            </p>
            <p>
              Embaixo do nome de cada campanha aparece de qual ação da Meta o resultado saiu, para o
              número poder ser conferido no gerenciador.
            </p>
          </Ajuda>
          <p className="mm-grupo-descricao">
            Cada objetivo tem a sua coluna de resultado: conversas não se comparam com compras. A tabela
            rola de lado dentro da própria caixa; o nome da campanha fica preso à esquerda.
          </p>
        </div>

        {/* CADA GRUPO TEM A SUA COLUNA DE RESULTADO.
            A tabela anterior tinha uma coluna "Result." que valia coisas
            diferentes em cada linha — 11 compras e 11 conversas apareciam
            idênticas, e campanha de alcance mostrava travessão como se tivesse
            fracassado. */}
        <CampanhasPorObjetivo
          campanhas={comObjetivo}
          assetId={assetId}
          de={periodo.de}
          ate={periodo.ate}
        />
      </section>
    </>
  );
}

/* ─── perfil do Instagram ──────────────────────────────────────────────────── */

type Aba = 'geral' | 'conteudo' | 'publico';

/**
 * As três abas do app do Instagram, na mesma ordem.
 *
 * Cópia deliberada: quem cuida da conta já lê aquele painel todo dia, e trocar
 * a arrumação obrigaria a reaprender onde as coisas estão em troca de nada.
 */
function Perfil({
  dias,
  periodo,
  demografia,
  quebras,
  publicacoes,
}: {
  dias: DiaOrganico[];
  periodo: Periodo;
  demografia: LinhaDeDemografia[];
  quebras: LinhaDeQuebra[];
  publicacoes: Publicacao[];
}) {
  const [aba, setAba] = useState<Aba>('geral');
  const base = useIdDasAbas('mm-perfil');
  const r = useMemo(() => resumirOrganico(dias), [dias]);

  const serieAlcance = useMemo(
    () => serieDeDistinta(dias, 'reach', periodo.de, periodo.ate),
    [dias, periodo],
  );
  const serieInteracoes = useMemo(
    () => serie(dias, 'totalInteractions', periodo.de, periodo.ate),
    [dias, periodo],
  );
  const serieVisualizacoes = useMemo(
    () => serie(dias, 'views', periodo.de, periodo.ate),
    [dias, periodo],
  );

  const saldo =
    r.saldoDeSeguidores === null
      ? TRACO
      : `${r.saldoDeSeguidores > 0 ? '+' : ''}${inteiro(r.saldoDeSeguidores)}`;

  return (
    <>
      {/* As três abas do app, agora abas DE VERDADE (tablist, setas, Home/End):
          eram três pílulas que o leitor de tela lia como botões soltos. */}
      <div className="mm-abas">
        <Abas
          rotulo="Partes do relatório do perfil"
          base={base}
          idDoPainel={`${base}-painel`}
          valor={aba}
          aoEscolher={setAba}
          opcoes={[
            { valor: 'geral', rotulo: 'Visão geral' },
            { valor: 'conteudo', rotulo: 'Conteúdo', contagem: publicacoes.length },
            { valor: 'publico', rotulo: 'Público' },
          ]}
        />
      </div>

      <div id={`${base}-painel`} role="tabpanel" aria-labelledby={`${base}-aba-${aba}`}>
      {aba === 'conteudo' && <AbaConteudo publicacoes={publicacoes} />}
      {aba === 'publico' && <AbaPublico demografia={demografia} />}

      {aba === 'geral' && (
        <>
          <LinhaDeLeitura linhas={dias} periodo={periodo} />

          {/* O ESTADO DO PERFIL vem primeiro: é o número que a pessoa procura
              quando abre a tela, e é o único que não depende do intervalo. */}
          <GrupoDeMetricas
            titulo="Estado do perfil"
            descricao="Seguidores é o último total que a coleta trouxe; o saldo é quem entrou menos quem saiu no período."
            colunas={2}
          >
            <Numero
              rotulo="Seguidores"
              valor={inteiro(r.seguidores)}
              detalhe={
                r.saldoDeSeguidores === null
                  ? publicacoes_(r.publicacoes)
                  : `${r.saldoDeSeguidores >= 0 ? "+" : ""}${inteiro(r.saldoDeSeguidores)} no período · ${publicacoes_(r.publicacoes)}`
              }
              tom={r.saldoDeSeguidores !== null && r.saldoDeSeguidores < 0 ? "warn" : undefined}
            />
            <Numero
              rotulo="Seguidores no período"
              valor={saldo}
              tom={
                r.saldoDeSeguidores === null
                  ? undefined
                  : r.saldoDeSeguidores < 0
                    ? 'warn'
                    : 'ok'
              }
              detalhe={
                r.saldoDeSeguidores === null ? (
                  <span>
                    a Meta manda o total e a quebra por tipo; enquanto não houver um dia com entrada
                    e saída de verdade, o saldo não é afirmável
                  </span>
                ) : (
                  `${inteiro(r.follows)} entraram · ${inteiro(r.unfollows)} saíram`
                )
              }
            />
          </GrupoDeMetricas>

          <GrupoDeMetricas
            titulo="Alcance e visualizações"
            descricao="Quem viu. Alcance e contas engajadas contam pessoas distintas: aparecem como média por dia, nunca somadas."
          >
            <Numero
              rotulo="Visualizações"
              valor={inteiro(r.views)}
              detalhe={`soma de ${emDias(r.dias)} coletados`}
            />
            <CartaoPorDia rotulo="Alcance" dados={r.alcance} />
            <CartaoPorDia rotulo="Contas engajadas" dados={r.contasEngajadas} />
            <Numero
              rotulo="Engajamento"
              valor={percentual(r.taxaDeEngajamento)}
              detalhe="das contas alcançadas, quantas reagiram (média dos dias)"
            />
          </GrupoDeMetricas>

          <GrupoDeMetricas titulo="Ações" descricao="O que as pessoas fizeram — contagem de eventos, somada nos dias." colunas={2}>
            <Numero rotulo="Interações" valor={inteiro(r.totalInteractions)} />
            <Numero rotulo="Toques no link do perfil" valor={inteiro(r.profileLinksTaps)} />
          </GrupoDeMetricas>

          <section className="mm-grupo" aria-label="Dia a dia">
            <div className="mm-graficos" data-colunas={3}>
              <div className="o-card mm-grafico">
                <h3 className="eyebrow mb-2">Alcance por dia</h3>
                <LinhaDoTempo titulo="Alcance por dia" pontos={serieAlcance} rodape={AVISO_DE_ALCANCE} />
              </div>
              <div className="o-card mm-grafico">
                <h3 className="eyebrow mb-2">Visualizações por dia</h3>
                <LinhaDoTempo titulo="Visualizações por dia" pontos={serieVisualizacoes} cor="var(--luz-ia)" />
              </div>
              <div className="o-card mm-grafico">
                <h3 className="eyebrow mb-2">Interações por dia</h3>
                <LinhaDoTempo titulo="Interações por dia" pontos={serieInteracoes} cor="var(--luz-estudio)" />
              </div>
            </div>
          </section>

          {/* As duas quebras que o app mostra na Visão geral. Somam os dias do
              período porque são contagem de EVENTOS — diferente de alcance, que
              conta pessoas e por isso nunca aparece somado nesta tela. */}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <QuebraDoPeriodo
              titulo="Quem viu — seguidores ou não"
              linhas={quebras}
              metric="views"
              dimension="follow_type"
            />
            <QuebraDoPeriodo
              titulo="Visualizações por tipo de conteúdo"
              linhas={quebras}
              metric="views"
              dimension="media_product_type"
              cor="var(--luz-ia)"
            />
            <QuebraDoPeriodo
              titulo="Quem foi alcançado — seguidores ou não"
              linhas={quebras}
              metric="reach"
              dimension="follow_type"
              cor="var(--luz-lives)"
            />
            <QuebraDoPeriodo
              titulo="Interações por tipo de conteúdo"
              linhas={quebras}
              metric="total_interactions"
              dimension="media_product_type"
              cor="var(--luz-estudio)"
            />
          </div>
        </>
      )}
      </div>
    </>
  );
}
