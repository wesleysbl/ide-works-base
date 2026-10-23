/**
 * Meta · Ranking de criativos — etapa F10c.
 *
 * A PERGUNTA QUE ESTA TELA RESPONDE
 *   "Qual criativo entregou mais?" — e a resposta depende de o que a campanha
 *   foi buscar. Um criativo numa campanha de mensagem é bom quando abre
 *   conversa; o mesmo criativo numa de tráfego é bom quando leva gente ao site.
 *
 * TRÊS RECORTES, E OS TRÊS SÃO NECESSÁRIOS
 *   1. O GERENCIADOR, porque é a unidade que a agência usa para falar de um
 *      cliente — e um gerenciador pode ter mais de uma conta de anúncio.
 *   2. O OBJETIVO, porque comparar um criativo de vendas com um de alcance é
 *      comparar coisas que não se comparam.
 *   3. A PERGUNTA — resultado, custo, curtidas, comentários, salvamentos,
 *      alcance —, porque "melhor" muda conforme o que se quer saber.
 *
 * O QUE A TELA DIZ SOBRE OS PRÓPRIOS NÚMEROS
 *   Alcance somado entre dias é aproximação: alcance conta pessoas distintas, e
 *   somar infla. Para ORDENAR a distorção é parecida em todos e a ordem se
 *   sustenta; o número absoluto é que não. A tela escreve "aprox." em vez de
 *   fingir precisão.
 */

import { dinheiro } from '@/meta/formato';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TelaComBarra } from '@/board/TelaComBarra';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDeDetalhe } from '@/board/trilha';
import { ApiError, api, semSessao } from '@/lib/api';
import { FaixaDeContexto, type ItemDeContexto, SemDado } from '@/meta/Leitura';
import { type Periodo, dias, janelaPadrao, periodoDoEndereco, rotuloDoPeriodo, tamanhoDoPeriodo } from '@/meta/contexto';
import {
  type ChaveDeRanking,
  type Familia,
  RANKINGS,
  RANKINGS_DA_FAMILIA,
  RESULTADO_DA_FAMILIA,
  ROTULO_DA_FAMILIA,
} from '@/meta/objetivos';
import {
  type Criativo,
  contarPorFamilia,
  familiaDoCriativo,
  filtrarPorFamilia,
  ordenarRanking,
} from '@/meta/ranking';
import { somar } from '@/meta/relatorio';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { SeletorDePeriodo } from '@/ui/SeletorDePeriodo';
import { Menu, type Opcao } from '@/ui/Menu';
import { Aviso, PaginaLarga, Selo } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';

/** O nome da tela: o título e o último degrau da trilha. */
const TITULO = 'Ranking de criativos';

const TRACO = '—';
const inteiro = (v: number | null) =>
  v === null ? TRACO : Math.round(v).toLocaleString('pt-BR');

/** Custo se lê em dinheiro; o resto, em contagem. */
const formatar = (chave: ChaveDeRanking, v: number | null) =>
  chave === 'custo_por_resultado' ? dinheiro(v) : inteiro(v);

const ehFamilia = (v: string | null): v is Familia => v !== null && v in ROTULO_DA_FAMILIA;
const ehChave = (v: string | null): v is ChaveDeRanking => v !== null && v in RANKINGS;

/**
 * O NOME DO NÚMERO DE CADA LINHA — F14.
 *
 * A linha dizia "resultado 18.000" ao lado de "resultado 50": um era alcance
 * (pessoas), o outro conversas iniciadas. A ORDEM continua a mesma — cada
 * criativo medido pelo que a própria campanha foi buscar —, mas a linha
 * escreve a UNIDADE, e a comparação entre unidades diferentes fica à vista.
 */
function nomeDoValor(chave: ChaveDeRanking, familia: Familia): string {
  const def = RESULTADO_DA_FAMILIA[familia];
  if (chave === 'resultado') return def.rotulo;
  if (chave === 'custo_por_resultado') return `Custo por ${def.unidade}`;
  return RANKINGS[chave].rotulo;
}

export default function MetaRanking() {
  /**
   * OS RECORTES MORAM NO ENDEREÇO — F14. Período, empresa, gerenciador,
   * objetivo e ordem: recarregar, voltar do navegador ou mandar o link
   * devolve o mesmo ranking. O relatório de uma conta aponta para cá já com o
   * gerenciador e o período dele.
   */
  const [params, setParams] = useSearchParams();
  const pedido = periodoDoEndereco(params);
  const dePedido = pedido?.de ?? null;
  const atePedido = pedido?.ate ?? null;
  const periodo = useMemo<Periodo>(
    () => (dePedido !== null && atePedido !== null ? { de: dePedido, ate: atePedido } : janelaPadrao()),
    [dePedido, atePedido],
  );
  const gerenciador = params.get('bm');
  /**
   * A empresa vem ANTES do gerenciador, e trocá-la LIMPA o gerenciador.
   *
   * Sem limpar, escolher Alma Nove com uma BM da Ide selecionada devolveria
   * ranking vazio — e a tela pareceria quebrada quando na verdade os dois
   * filtros estariam se contradizendo.
   */
  const empresa = params.get('empresa');
  const objetivoPedido = params.get('objetivo');
  const familia: Familia | null = ehFamilia(objetivoPedido) ? objetivoPedido : null;
  const ordemPedida = params.get('ordem');

  const mudar = useCallback(
    (mudancas: Record<string, string | null>) => {
      setParams(
        (atual) => {
          const n = new URLSearchParams(atual);
          for (const [k, v] of Object.entries(mudancas)) {
            if (v === null || v === '') n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const [empresas, setEmpresas] = useState<Array<{ id: string; nome: string }>>([]);
  const [gerenciadores, setGerenciadores] = useState<string[]>([]);
  const [criativos, setCriativos] = useState<Criativo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  /** A leitura mais recente é a que vale — ver `MetaRelatorio`. */
  const leitura = useRef(0);

  const buscar = useCallback(async () => {
    const minha = ++leitura.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await api.rankingDeCriativos(periodo.de, periodo.ate, gerenciador, empresa);
      if (minha !== leitura.current) return;
      setGerenciadores(r.gerenciadores);
      setEmpresas(r.empresas);
      setCriativos(r.criativos as Criativo[]);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      if (minha !== leitura.current) return;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar o ranking.');
    } finally {
      if (minha === leitura.current) setCarregando(false);
    }
  }, [periodo, gerenciador, empresa]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const porFamilia = useMemo(() => contarPorFamilia(criativos), [criativos]);

  /**
   * As perguntas disponíveis dependem da família escolhida.
   *
   * Com "todas", oferecem-se as que fazem sentido em qualquer objetivo —
   * oferecer "salvamentos" numa lista cheia de campanha de venda encheria a
   * tela de travessões.
   */
  const perguntas = useMemo<ChaveDeRanking[]>(
    () =>
      familia === null
        ? ['resultado', 'custo_por_resultado', 'alcance', 'cliques']
        : [...RANKINGS_DA_FAMILIA[familia]],
    [familia],
  );

  // A pergunta escolhida pode não existir na família nova: vale a primeira.
  const chave: ChaveDeRanking =
    ehChave(ordemPedida) && perguntas.includes(ordemPedida) ? ordemPedida : perguntas[0];

  /** As opções de cada menu. A contagem some quando não há o que contar. */
  const opcoesDeGerenciador = useMemo<Opcao[]>(
    () => [
      { valor: null, rotulo: "Todos os gerenciadores", contagem: gerenciadores.length },
      ...gerenciadores.map((g) => ({ valor: g, rotulo: g })),
    ],
    [gerenciadores],
  );

  const opcoesDeObjetivo = useMemo<Opcao[]>(
    () => [
      { valor: null, rotulo: "Todos os objetivos", contagem: criativos.length },
      ...([...porFamilia.entries()] as [Familia, number][])
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => ({ valor: f, rotulo: ROTULO_DA_FAMILIA[f], contagem: n })),
    ],
    [porFamilia, criativos.length],
  );

  const opcoesDeOrdem = useMemo<Opcao[]>(
    () => perguntas.map((k) => ({ valor: k, rotulo: RANKINGS[k].rotulo })),
    [perguntas],
  );

  const ordenados = useMemo(
    () => ordenarRanking(filtrarPorFamilia(criativos, familia), chave),
    [criativos, familia, chave],
  );

  const comValor = ordenados.filter((x) => x.valor !== null);
  /* `somar` — F14: o gasto desconhecido de TODOS é travessão; o zero medido é
     R$ 0,00. Antes `investido || null` escrevia travessão também no zero. */
  const investido = somar(ordenados.map((x) => x.criativo.spend));
  const familiasNaLista = new Set(ordenados.map((x) => familiaDoCriativo(x.criativo)));
  const unidadesMisturadas =
    (chave === 'resultado' || chave === 'custo_por_resultado') && familiasNaLista.size > 1;
  const menorMelhor = RANKINGS[chave].menorMelhor === true;
  const nomeDaEmpresa = empresas.find((e) => e.id === empresa)?.nome ?? null;

  const contexto: ItemDeContexto[] = [
    ...(nomeDaEmpresa ? [{ rotulo: 'Empresa', valor: nomeDaEmpresa }] : []),
    { rotulo: 'Gerenciador', valor: gerenciador ?? 'todos' },
    { rotulo: 'Objetivo', valor: familia === null ? 'todos' : ROTULO_DA_FAMILIA[familia] },
    { rotulo: 'Período', valor: `${rotuloDoPeriodo(periodo)} · ${dias(tamanhoDoPeriodo(periodo))}` },
  ];

  return (
    <PaginaLarga>
      {/* A BARRA CHEGA AO RANKING — F17.67. Mesma decisão, e mesmas duas
          medições, de `MetaContas`: ver o comentário lá. */}
      <TelaComBarra>
        {/* O TOPO — F29 (Fase 5a). O ranking é DETALHE da Meta: a trilha
            `Meta › Ranking de criativos` substitui o `‹ Contas` à mão e o
            `Meta · análise de resultado` de cima do título — o primeiro degrau
            diz o nome do lugar a que leva, que é a tela chamada Meta. A ação
            da página é o período. */}
        <Topo
          titulo={TITULO}
          trilha={<Trilha degraus={trilhaDeDetalhe({ nome: 'Meta', destino: '/meta' }, TITULO)} />}
          acoes={
            <SeletorDePeriodo
              valor={periodo}
              mesDeReferencia={`${periodo.ate.slice(0, 7)}-01`}
              aoMudar={(p) => p && mudar({ de: p.de, ate: p.ate })}
            />
          }
        />

        <FaixaDeContexto itens={contexto} rotulo="Recorte deste ranking" />

        {/* --- OS RECORTES, NUMA LINHA SÓ ----------------------------------
            Eram três blocos de pílulas: dezoito gerenciadores quebravam em cinco
            linhas e empurravam os números para fora da tela. Agora são menus
            que abrem, com busca quando a lista passa de oito. */}
        <div className="mm-filtros" role="group" aria-label="Recortes do ranking">
          {/* Só aparece com mais de uma empresa: com uma, seria um menu que não
              escolhe nada. E a lista sai das contas que a pessoa ENXERGA. */}
          {empresas.length > 1 && (
            <Menu
              rotulo="Empresa"
              opcoes={[
                { valor: null, rotulo: "Todas", contagem: empresas.length },
                ...empresas.map((e) => ({ valor: e.id, rotulo: e.nome })),
              ]}
              valor={empresa}
              aoEscolher={(v) => mudar({ empresa: v, bm: null })}
            />
          )}
          <Menu
            rotulo="Gerenciador"
            opcoes={opcoesDeGerenciador}
            valor={gerenciador}
            aoEscolher={(v) => mudar({ bm: v })}
            larguraDoBalao="w-80"
          />
          <Menu
            rotulo="Objetivo"
            opcoes={opcoesDeObjetivo}
            valor={familia}
            aoEscolher={(v) => mudar({ objetivo: v })}
          />
          <Menu
            rotulo="Ordenar por"
            opcoes={opcoesDeOrdem}
            valor={chave}
            aoEscolher={(v) => v !== null && mudar({ ordem: v === perguntas[0] ? null : v })}
          />
        </div>

        {/* O CRITÉRIO, ESCRITO — F14. Era uma frase de 11 px na ponta da faixa
            de filtros, que a 390 px caía para uma linha solta. Agora diz a
            pergunta, a direção da ordem, o que acontece com quem não tem
            resposta e — quando a lista mistura objetivos — que as unidades
            diferem. Não muda o critério: só o diz. */}
        <div className="mm-criterio" aria-live="polite">
          <p>
            <b>Ordenado por {RANKINGS[chave].rotulo.toLowerCase()}</b> — {RANKINGS[chave].pergunta}.{' '}
            {menorMelhor ? 'Menor primeiro.' : 'Maior primeiro.'} Quem não tem resposta para esta pergunta fica no
            fim, com travessão — não é zero.
          </p>
          {unidadesMisturadas && (
            <p>
              Com objetivos misturados, cada criativo é medido pelo resultado da própria campanha — conversas,
              compras, alcance —, e o nome ao lado do número diz qual. Para comparar na mesma unidade, escolha um
              objetivo.
            </p>
          )}
          {chave === 'alcance' && (
            <p>
              O alcance aqui é <b>aproximado</b>: ele conta pessoas distintas, e somar os dias infla. Serve para
              ordenar — a distorção é parecida em todos os criativos —, não como número absoluto.
            </p>
          )}
        </div>

        {erro && (
          <div className="mt-3">
            <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: () => void buscar() }}>
              {erro}
            </Aviso>
          </div>
        )}

        {carregando && erro === null && <EstadoDaPagina tipo="carregando" titulo="Carregando o ranking…" linhas={5} />}

        {!carregando && erro === null && ordenados.length === 0 && (
          <EstadoDaPagina
            tipo="vazio"
            titulo="Nenhum criativo com veiculação neste recorte"
            acao={
              pedido !== null
                ? { rotulo: 'Ver os últimos 28 dias', aoClicar: () => mudar({ de: null, ate: null }) }
                : gerenciador !== null
                  ? { rotulo: 'Ver todos os gerenciadores', aoClicar: () => mudar({ bm: null }) }
                  : undefined
            }
          >
            {`Entre ${rotuloDoPeriodo(periodo)}${gerenciador !== null ? `, no gerenciador ${gerenciador},` : ''} nenhum anúncio veiculou. A coleta guarda os últimos 28 dias — fora disso, a Meta não devolve.`}
          </EstadoDaPagina>
        )}

        {!carregando && erro === null && ordenados.length > 0 && (
          <>
            <dl className="ad-numeros mm-numeros">
              <div className="ad-numero">
                <dt>Criativos</dt>
                <dd className="ad-numero-valor tnum">{ordenados.length}</dd>
              </div>
              <div className="ad-numero">
                <dt>Com resposta</dt>
                <dd className="ad-numero-valor tnum">{comValor.length}</dd>
                {comValor.length < ordenados.length && (
                  <dd className="ad-numero-nota">
                    {ordenados.length - comValor.length} sem dado para esta pergunta
                  </dd>
                )}
              </div>
              <div className="ad-numero">
                <dt>Investido no período</dt>
                <dd className="ad-numero-valor tnum">{investido === null ? <SemDado /> : dinheiro(investido)}</dd>
              </div>
            </dl>

            <ol className="mm-ranking" aria-label={`Criativos ordenados por ${RANKINGS[chave].rotulo.toLowerCase()}`}>
              {ordenados.map(({ criativo, valor }, i) => (
                <LinhaDoCriativo key={criativo.adId} posicao={i + 1} c={criativo} valor={valor} chave={chave} />
              ))}
            </ol>
          </>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}

function LinhaDoCriativo({
  posicao,
  c,
  valor,
  chave,
}: {
  posicao: number;
  c: Criativo;
  valor: number | null;
  chave: ChaveDeRanking;
}) {
  const [semImagem, setSemImagem] = useState(false);
  const familia = familiaDoCriativo(c);
  const pausado = c.situacao !== null && c.situacao !== 'ACTIVE';
  const nome = nomeDoValor(chave, familia);

  return (
    <li className="mm-criativo" data-podio={posicao <= 3 || undefined}>
      {/* A posição vem antes do nome: o ranking é a informação. */}
      <span className="mm-criativo-posicao tnum" aria-label={`${posicao}º`}>
        {posicao}
      </span>

      <div className="mm-criativo-miniatura">
        {c.miniatura !== null && !semImagem && (
          <img
            src={c.miniatura}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            // O endereço do CDN da Meta expira. Quadro vazio é melhor que ícone
            // de imagem partida.
            onError={() => setSemImagem(true)}
          />
        )}
      </div>

      <div className="mm-criativo-quem">
        <p className="mm-criativo-titulo">
          <span className="mm-criativo-nome">{c.nome ?? c.adId}</span>
          {pausado && <Selo tom="neutro">pausado</Selo>}
        </p>
        <p className="mm-criativo-origem">
          {ROTULO_DA_FAMILIA[familia]}
          {c.campanha !== null && ` · ${c.campanha}`}
          {c.conta !== null && ` · ${c.conta}`}
        </p>
      </div>

      <dl className="mm-criativo-numeros tnum">
        <div>
          <dt>Gasto</dt>
          <dd>{c.spend === null ? <SemDado /> : dinheiro(c.spend)}</dd>
        </div>
        <div title="Alcance somado entre os dias — aproximado">
          <dt>Alcance aprox.</dt>
          <dd>{c.alcanceAprox === null ? <SemDado /> : inteiro(c.alcanceAprox)}</dd>
        </div>
        <div className="mm-criativo-valor" title={`${RESULTADO_DA_FAMILIA[familia].rotulo} — o que esta campanha foi buscar`}>
          <dt>{nome}</dt>
          <dd>{valor === null ? <SemDado motivo="sem dado para esta pergunta" /> : formatar(chave, valor)}</dd>
        </div>
      </dl>
    </li>
  );
}
