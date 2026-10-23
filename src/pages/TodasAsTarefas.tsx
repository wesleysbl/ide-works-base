/**
 * `Todas as tarefas` — o histórico. Etapa F17.18.
 *
 * A DIFERENÇA PARA `Minhas tarefas` É UMA SÓ, E É A QUE IMPORTA
 *   Ali a pergunta é "o que é meu". Aqui é "o que existe ao meu alcance" — o
 *   pedido do usuário foi literal: *"o histórico de todas as tarefas que já
 *   fizeram, em formato de lista, quadro e por aí vai"*.
 *
 *   Quem define "ao meu alcance" é o banco, e não esta tela: `can_see_space`,
 *   `can_see_list` e `can_reach_task` filtram na política de linha. Duas
 *   pessoas abrem esta tela e veem coisas diferentes sem que uma linha daqui
 *   saiba disso.
 *
 * AS DUAS FORMAS SÃO OS COMPONENTES QUE JÁ EXISTEM
 *   A LISTA é a mesma linha de `Minhas tarefas` (`LinhaDeTrabalho`). O QUADRO é
 *   o mesmo cartão do quadro da lista (`CorpoDoCartao`), agrupado por TIPO de
 *   status — ver o cabeçalho de `@/board/QuadroPorTipo` para o porquê de não
 *   ser por esteira, e de o cartão não arrastar.
 *
 * O TETO DIZ QUE EXISTE
 *   A leitura traz no máximo 500 linhas e conta o total à parte. Mostrar 500 e
 *   calar sobre as outras faria a tela do HISTÓRICO mentir sobre o histórico —
 *   que é a única coisa que ela promete.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { type BoardAssigneeOption, today } from '@/board/board';
import { BarraDeFiltro } from '@/board/BarraDeFiltro';
import { type FiltroDeTarefas, SEM_FILTRO, lerFiltro, paraEndereco, temFiltro } from '@/board/filtro';
import { TelaComBarra } from '@/board/TelaComBarra';
import { GruposDeTrabalho } from '@/board/GruposDeTrabalho';
import { type WorkRow } from '@/board/meu-trabalho';
import { QuadroPorTipo } from '@/board/QuadroPorTipo';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { useModoDaTela } from '@/board/usar-modo';
import { ApiError, api, recuperavelAoLer, semSessao } from '@/lib/api';
import { useParametrosNoEndereco } from '@/ui/endereco';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { Aviso, PaginaLarga } from '@/ui/primitivos';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { Topo } from '@/ui/Topo';
// A vez — F17.AUD01. A busca antiga não substitui a nova.
import { useAoFecharAFichaAoLado } from '@/ui/usar-ficha-ao-lado';
import { entregar, useVez } from '@/ui/vez';
import '@/ui/quadro.css';
import '@/ui/tarefa.css';
import '@/ui/clickup.css';
import '@/ui/passos.css';

export default function TodasAsTarefas() {
  const [linhas, setLinhas] = useState<WorkRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [achadas, setAchadas] = useState(0);
  const [opcoes, setOpcoes] = useState<BoardAssigneeOption[]>([]);
  const [semDono, setSemDono] = useState(0);
  const [aplicado, setAplicado] = useState<FiltroDeTarefas | null>(null);
  const [cortado, setCortado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /* O erro é PASSAGEIRO e a busca pode ser refeita — F17.AUD04, achado 5. O
     aviso ganha "Tentar de novo", que relê com o filtro e a forma que já
     estão no endereço. Ver `MeuTrabalho`. */
  const [recuperavel, setRecuperavel] = useState(false);

  /* O FILTRO MORA NO ENDEREÇO — F17.55, pela regra da F17.24. Mesma peça e
     mesma decisão do quadro; ver o cabeçalho de `@/board/BarraDeFiltro`. */
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const busca = parametros.get('busca') ?? '';
  const responsavelPedido = parametros.get('responsavel') ?? '';
  // `useMemo` sobre os dois textos: sem ele, o filtro teria identidade nova a
  // cada desenho e o efeito de leitura entraria em laço.
  const filtro = useMemo(() => lerFiltro(busca, responsavelPedido), [busca, responsavelPedido]);
  const trocarFiltro = useCallback(
    (proximo: FiltroDeTarefas) => {
      const endereco = paraEndereco(proximo);
      definirParametros({ busca: endereco.busca ?? '', responsavel: endereco.responsavel ?? '' });
    },
    [definirParametros],
  );
  /**
   * A FORMA MORA NO ENDEREÇO — F17.24.
   *
   * `Lista` × `Quadro` é "qual visão", e visão é o que outra pessoa precisa ver
   * igual ao abrir o mesmo endereço. `/tarefas?ver=quadro` colado num
   * comentário abre no quadro para quem receber; antes desta etapa, um F5 já
   * devolvia a lista para quem tinha escolhido o quadro.
   */
  /* F18C: `Lista | Kanban`, a peça e a regra das outras telas de trabalho
     (`useModoDaTela`): endereço › escolha desta tela › padrão Lista. O
     endereço antigo `?ver=quadro` continua abrindo no Kanban. */
  const [forma, setForma] = useModoDaTela('global', null, { explicito: true });

  const hoje = useRef(today()).current;

  /**
   * O ALCANCE MUDOU, E A TELA DIZ — F05 do plano UX.
   *
   * Quem chega pela passagem de `Minhas tarefas` ("Buscar em Todas as
   * tarefas") traz o texto em `?busca=` e, no `state` da entrada, de onde veio.
   * A busca de lá olhava só as tarefas CARREGADAS da pessoa, em título e
   * lugar; a daqui vai ao banco, pelo NOME, em tudo o que ela alcança. Mesma
   * palavra, outro universo — e o resultado maior não pode parecer um defeito.
   *
   * Lido UMA vez, na chegada: a barra de filtro grava no endereço e apaga o
   * `state`, e o aviso não deve sumir na primeira letra. Fecha pelo X.
   */
  const location = useLocation();
  const [vindoDeMinhas, setVindoDeMinhas] = useState(
    () => (location.state as { alcanceDe?: unknown } | null)?.alcanceDe === 'minhas',
  );

  /**
   * A VEZ DESTA BUSCA — F17.AUD01, achado 6 da auditoria de 09/09/2026.
   *
   * Buscar "antiga", com resposta lenta, e depois "nova", com resposta
   * imediata: a lista mostrava "nova" e voltava para "antiga", com o campo e o
   * endereço ainda em "nova". O atraso de digitação não resolve pedido que já
   * saiu. Cada leitura pega um bilhete, e só a última entra — dado, erro ou
   * nada. Ver o cabeçalho de `@/ui/vez`.
   */
  const vez = useVez();

  /**
   * `silenciosa` é a releitura de depois de um gesto (fechar o card ao lado):
   * a lista que está na tela é a que a pessoa estava lendo, e uma leitura que
   * tropeça não a esvazia — o aviso fica, com `Tentar de novo`. A leitura de
   * abertura e a de filtro novo, ao falhar, esvaziam: a lista velha seria de
   * outra busca, e mostrá-la como se fosse desta enganaria.
   */
  const ler = useCallback(async (silenciosa = false) => {
    // O recurso é a busca em forma de endereço: é dela que a resposta é.
    const bilhete = vez.abrir(new URLSearchParams(paraEndereco(filtro)).toString());
    setRecuperavel(false);
    await entregar(vez, bilhete, api.todasAsTarefas(filtro), {
      chegou: (r) => {
        setLinhas(r.work.rows as WorkRow[]);
        setTotal(r.work.total);
        setAchadas(r.work.matched);
        setOpcoes(r.work.assigneeOptions);
        setSemDono(r.work.unassignedTasks);
        // O que a tela diz ter filtrado sai daqui, e não da caixa de digitar: ver
        // o cabeçalho de `@/board/BarraDeFiltro`.
        setAplicado(filtro);
        setCortado(r.work.capped);
        setErro(null);
      },
      falhou: (e) => {
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        if (!silenciosa) setLinhas([]);
        setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar as tarefas.');
        // Também o 5xx: é uma leitura. Sem isto, um 500 deixava o aviso sem saída
        // (`Minhas tarefas` já tinha a regra desde a F04 — ver `recuperavelAoLer`).
        setRecuperavel(recuperavelAoLer(e));
      },
    });
  }, [vez, filtro]);

  useEffect(() => {
    void ler();
  }, [ler]);

  /* O CARD AO LADO FECHOU — F43, Fase 7: a lista ficou atrás do painel, e o
     que mudou lá dentro só aparece relendo. `ler` não esvazia a tela (as
     linhas só trocam quando a resposta chega), então a rolagem fica. */
  useAoFecharAFichaAoLado(() => void ler(true));

  return (
    <PaginaLarga>
      {/* A MOLDURA COMUM — F04: a grade à mão virou a peça das outras telas. */}
      {/* F05: `iw-trabalho` na coluna, como em `Minhas tarefas` — os
          mesmos grupos com a mesma régua, a mesma linha. */}
      <TelaComBarra atual="todas" classeDoConteudo="iw-trabalho">
        {/* O TOPO — F29 (Fase 4). Tela principal: só o título. A trilha
            `Meu trabalho › Todas as tarefas` (F17.25) saiu pelo mesmo motivo
            de `Minhas tarefas`: nenhum dos dois degraus levava a lugar
            nenhum, e o título já diz onde se está. */}
        <Topo titulo={ROTULO_DO_ITEM.todas} />

        {/* F04: o erro mora NA COLUNA, abaixo do título — e não acima da
            grade em largura inteira, empurrando a barra para baixo. */}
        {erro && (
          <div className="mb-3">
            <Aviso
              tipo="erro"
              acao={recuperavel ? { rotulo: 'Tentar de novo', aoClicar: () => void ler() } : undefined}
            >
              {erro}
            </Aviso>
          </div>
        )}

        {vindoDeMinhas && (
          <div className="iw-alcance" role="status">
            <p>
              Agora a busca vai ao banco, pelo nome, em <b>todas as tarefas ao seu alcance</b> — não só nas suas.{' '}
              <Link to={busca ? `/meu-trabalho?${new URLSearchParams({ busca }).toString()}` : '/meu-trabalho'}>
                Voltar para Minhas tarefas
              </Link>
            </p>
            <button
              type="button"
              className="iw-alcance-fechar"
              aria-label="Fechar aviso"
              title="Fechar aviso"
              onClick={() => setVindoDeMinhas(false)}
            >
              ×
            </button>
          </div>
        )}

        {/* OS CONTROLES, NUMA FAIXA SÓ — F05. O mesmo ritmo de `Minhas
            tarefas`: buscar (a lupa e o `Responsável`, a MESMA peça do
            quadro — F17.55) → quanto há → como ver, com a forma na ponta.

            A barra é que devolve esta tela: o teto de 500 por prazo
            crescente deixava as 116 tarefas ABERTAS todas fora do corte, e
            não havia como pedir outra coisa. Achado 1 da revisão de
            2026-09-02. */}
        <div className="mt-controles" data-tela="todas">
          <div className="td-filtro">
            <BarraDeFiltro
              filtro={filtro}
              aplicado={aplicado}
              opcoes={opcoes}
              semResponsavel={semDono}
              achadas={achadas}
              total={total}
              ocupado={linhas === null}
              aoMudar={trocarFiltro}
            />
          </div>

          {/* O TOTAL AO ALCANCE, SEMPRE. O que o filtro achou e o que o teto
              cortou têm cada um o seu lugar — a barra ao lado e a faixa logo
              abaixo —, e amontoar os três aqui foi o que fez esta linha dizer
              `500 de 1768` num lugar onde `1768` é a resposta. */}
          {/* ⚠️ ENQUANTO NÃO CHEGOU, NÃO HÁ NÚMERO — achado 2 da revisão de
              2026-09-02: esta tela mostrava `0 tarefas` durante os segundos
              de espera, e zero é uma resposta, não uma ausência. Quem lê
              conclui que não tem nada e vai embora antes de a lista chegar.
              F03 (verificação): com ERRO também não há número — a leitura
              falhou e `total` é o zero inicial, não uma resposta. */}
          {/* F05: com filtro aplicado, a barra ao lado já diz `1 de 1768` —
              repetir `1768 tarefas` na mesma linha seria o total duas vezes. */}
          {linhas !== null && !erro && !(aplicado !== null && temFiltro(aplicado)) && (
            <span className="td-total tnum">
              {total} {total === 1 ? 'tarefa' : 'tarefas'}
            </span>
          )}

          {/* F03: Lista × Quadro redesenha o MESMO conjunto — botões
              pressionáveis, e não abas sem painel. F05: a peça é comum às
              duas telas, com ícone. */}
          <SeletorDeModo contexto="global" valor={forma} aoEscolher={setForma} />
        </div>

        {/* O TETO DITO, E NÃO ESCONDIDO — a faixa FICA, encurtada.
            Ela não descreve a tela: ela avisa que o que está à vista não é
            tudo, que é a única promessa que esta tela faz. Ver o cabeçalho. */}
        {/* ⚠️ O CORTE SE MEDE CONTRA O QUE O FILTRO ACHOU — F17.55. Buscando
            `sonho`, são 48 achadas e as 48 cabem: não há corte, e a faixa não
            aparece. Comparar com o total de 1.768 faria a tela avisar de um
            corte que não houve. */}
        {cortado && (
          <div className="mb-3">
            <Aviso tipo="atencao">
              Esta tela mostra as <b className="text-plat">{(linhas ?? []).length}</b> primeiras
              de <b className="text-plat">{achadas}</b>, por prazo.
            </Aviso>
          </div>
        )}

        {linhas === null && <EstadoDaPagina tipo="carregando" />}

        {/* F03: VAZIO ≠ FILTRO SEM RESULTADO. Com busca ou responsável
            aplicados, "nenhuma tarefa ao seu alcance" mentia — elas estão ao
            alcance, o filtro é que não achou. A saída é limpar o filtro. */}
        {linhas !== null && linhas.length === 0 && !erro && (
          aplicado !== null && temFiltro(aplicado) ? (
            <EstadoDaPagina
              tipo="sem-resultado"
              titulo="Nenhuma tarefa com este filtro"
              acao={{ rotulo: 'Limpar filtro', aoClicar: () => trocarFiltro(SEM_FILTRO) }}
            >
              {aplicado.texto.trim() !== '' && aplicado.responsavel !== null
                ? 'A busca e o responsável escolhidos não acharam nada'
                : aplicado.texto.trim() !== ''
                  ? 'A busca não achou nada'
                  : 'O responsável escolhido não tem nenhuma tarefa'}{' '}
              entre as tarefas ao seu alcance.
            </EstadoDaPagina>
          ) : (
            <EstadoDaPagina tipo="vazio" titulo="Nenhuma tarefa ao seu alcance">
              Quando alguém criar uma tarefa numa lista que você vê, ela aparece aqui.
            </EstadoDaPagina>
          )
        )}

        {linhas !== null && linhas.length > 0 && forma === 'lista' && (
          <GruposDeTrabalho linhas={linhas} hoje={hoje} semVazios={aplicado !== null && temFiltro(aplicado)} />
        )}

        {linhas !== null && linhas.length > 0 && forma === 'kanban' && (
          <QuadroPorTipo linhas={linhas} hoje={hoje} filtrada={aplicado !== null && temFiltro(aplicado)} />
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}
