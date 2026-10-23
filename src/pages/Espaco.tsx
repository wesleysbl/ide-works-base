/**
 * A VISÃO GERAL DO ESPAÇO — etapa F17.26.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO, TEXTUAL
 *
 *   *"só de clicar no espaço, deve ficar visível tudo o que há nele (…) quando
 *   clica em movimento aparece as pastas e documentos referentes a esse espaço,
 *   o progresso em cada lista e demais funções."*
 *
 *   Antes desta tela, clicar num espaço só abria e fechava o galho da árvore.
 *   Quem queria saber como um cliente estava abria lista por lista e contava de
 *   cabeça.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ TRÊS COLUNAS DA CAPTURA DE REFERÊNCIA NÃO EXISTEM, E ELAS NÃO FORAM
 *    INVENTADAS AQUI
 *   A referência do ClickUp mostra `Nome · Cor · Progresso · Início · Término`,
 *   e um cartão `Favoritos`. Medido em
 *   `supabase/migrations/20260824160000_ideworks_f17_1_arvore.sql`, a tabela de
 *   listas tem nome, descrição, ordem, o instante de arquivamento, a origem e
 *   os carimbos — **não há cor, não há início, não há término**, e favorito não
 *   existe em lugar nenhum do sistema.
 *
 *   Coluna que nunca preenche ensina a equipe a ignorar a tabela inteira. Então
 *   esta tela mostra o que o sistema SABE, e o que falta ficou escrito no plano
 *   como dívida, com nome e etapa.
 *
 *   O cartão `Documentos` também não entra: documento é a F17.7, e o modelo
 *   ainda não o tem. Ele nasce ali, neste mesmo lugar, quando existir.
 *
 * DE ONDE VÊM OS NÚMEROS
 *   Da MESMA leitura que a barra lateral já fazia — a árvore inteira, com
 *   `liveTasks` e `totalTasks` por lista e a esteira resolvida. Não há rota
 *   nova, não há consulta nova, e não há segunda opinião sobre o mesmo número.
 *
 *   ⚠️ E é por isso que o somatório da pasta NÃO VAZA o que a parede da F17.23
 *   esconde: a lista que a política de linha não devolveu simplesmente não está
 *   na conta. Uma agregação feita no banco somaria o que a pessoa não pode ver.
 *
 * A TELA NÃO FALA SOBRE SI MESMA — F17.20
 *   Sem rodapé explicativo, sem "esta tela mostra…". O estado vazio é uma linha
 *   curta, e ele diz o que fazer, não o que a tela é.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { INHERITED_LABEL } from '@/board/board';
import { type NoDeEspaco, type NoDeLista, buildFullTree } from '@/board/arvore';
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { useSessao } from '@/ui/sessao';
import { ArvoreDoQuadro } from '@/board/ArvoreDoQuadro';
import { usePedidoDeRevelar } from '@/board/secao-recolhivel';
import { TelaComBarra } from '@/board/TelaComBarra';
import { IconeListaMarcada, IconePasta, MarcaDoEspaco } from '@/board/icones-da-arvore';
import { SeletorDeModo } from '@/board/SeletorDeForma';
import { SinalDoClienteDaLista } from '@/board/SinalDoClienteDaLista';
import { TrabalhoDoEscopo } from '@/board/TrabalhoDoEscopo';
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDoEspaco, trilhaEmEspera } from '@/board/trilha';
import { useModoDaTela } from '@/board/usar-modo';
import {
  type Progresso,
  type VisaoDoEspaco,
  acharEspaco,
  montarVisaoDoEspaco,
  progressoDaLista,
  rotuloDoProgresso,
} from '@/board/visao-do-espaco';
import { useLugar } from '@/ui/aparencia';
import { Aviso, Barra, PaginaLarga, Selo } from '@/ui/primitivos';
import { Topo } from '@/ui/Topo';
import '@/ui/quadro.css';
import '@/ui/clickup.css';

/* ───────────────────────────── o progresso desenhado ───────────────────── */

/**
 * `12/20 concluídas` mais a barra. É o `62/63` da referência.
 *
 * ⚠️ `selecionavel` — F17.25. Este número é o que alguém copia para mandar no
 * grupo ("a Focus está 3/4"). O `user-select` do sistema está desligado por
 * padrão desde aquela etapa, e conteúdo precisa ser liberado item por item.
 */
function ProgressoNaTela({ p, largo = false }: { p: Progresso; largo?: boolean }) {
  return (
    <div className="ve-progresso" data-largo={largo}>
      <span className="ve-fracao selecionavel tnum" title={rotuloDoProgresso(p)}>
        {p.total === 0 ? (
          <span className="ve-sem-tarefa">sem tarefas</span>
        ) : (
          <>
            {p.feitas}
            <span className="ve-de">/{p.total}</span>
          </>
        )}
      </span>
      <Barra pct={p.pct} />
      <span className="ve-pct tnum">{p.total === 0 ? '—' : `${p.pct}%`}</span>
    </div>
  );
}

/* ───────────────────────────── a linha de lista ───────────────────────── */

/**
 * Uma lista: nome, de que cliente ela é, progresso, a esteira, e o atalho.
 *
 * O NOME ABRE O QUADRO. O sinal do cliente — o mesmo da linha da árvore, com
 * o nome escrito — abre a ficha. Os dois não podem ser o mesmo alvo: link
 * dentro de link não é HTML válido, e o clique de dentro nunca chega. A
 * árvore já resolveu isso pondo o ícone FORA do botão da lista; aqui é a
 * mesma separação.
 */
function LinhaDeLista({ lista }: { lista: NoDeLista }) {
  const p = progressoDaLista(lista);

  return (
    <div className="ve-lista">
      <Link
        to={`/quadro/${lista.id}`}
        className="ve-lista-nome"
        title={`Abrir o quadro de ${lista.name}`}
      >
        <IconeListaMarcada c="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="ve-nome">{lista.name}</span>
        {lista.archivedAt !== null && <span className="cu-selo-morto">arquivada</span>}
      </Link>

      <SinalDoClienteDaLista clientId={lista.clientId} clientName={lista.clientName} />

      {/* De onde a esteira veio. Vem pronta da leitura da árvore, e é o que
          explica por que duas listas diferentes mostram as mesmas colunas. */}
      {lista.workflowName !== null && (
        <Selo
          titulo={
            lista.inheritedFrom === null
              ? lista.workflowName
              : `${lista.workflowName} — ${INHERITED_LABEL[lista.inheritedFrom]}`
          }
        >
          {lista.workflowName}
          {lista.inheritedFrom !== null && lista.inheritedFrom !== 'list' && (
            <span className="ve-heranca"> · {INHERITED_LABEL[lista.inheritedFrom]}</span>
          )}
        </Selo>
      )}

      <ProgressoNaTela p={p} />
    </div>
  );
}

/* ───────────────────────────── o corpo ───────────────────────────── */

/**
 * ⚠️ EXPORTADO PARA O TESTE DE DESENHO, e não por acaso.
 *
 * `src/board/tela-do-espaco.test.ts` monta este corpo com `renderToStaticMarkup`
 * e confere item por item o que o usuário vai comparar com o ClickUp dele — a
 * pasta com as listas dentro, a LISTA SOLTA ao lado, o `feitas/total`, e a
 * ausência de `Cor`, `Início`, `Término` e `Favoritos`. A tela inteira não
 * serve para isso: ela busca a árvore num efeito, e efeito não roda em desenho
 * estático.
 */
export function CorpoDoEspaco({ visao }: { visao: VisaoDoEspaco }) {
  if (visao.vazio) {
    // ESTADO VAZIO É UMA LINHA CURTA — F17.20. Ele diz o próximo passo, e não
    // o que a tela é.
    return (
      <p className="ve-vazio">
        Este espaço ainda não tem pasta nem lista. Use o <b className="text-plat">···</b> dele na
        barra lateral para criar a primeira.
      </p>
    );
  }

  return (
    <>
      {visao.pastas.map(({ pasta, listas, progresso }) => (
        <section key={pasta.id} className="o-card ve-bloco" data-morto={!pasta.live}>
          <header className="ve-cabeca">
            <IconePasta c="h-4 w-4 shrink-0 opacity-70" />
            {/* O NOME DA PASTA ABRE O QUADRO DELA — F17.64. Sem isto, esta tela
                seria o único lugar do sistema que MOSTRA a pasta e não deixa
                abri-la: a árvore ao lado passou a abrir, e aqui o nome ficaria
                sendo texto morto ao lado de um progresso que convida a clicar. */}
            <h2 className="o-titulo ve-titulo">
              <Link
                to={`/quadro/pasta/${pasta.id}`}
                className="ve-abre"
                title={`Ver as tarefas de todas as listas de ${pasta.name} num quadro só`}
              >
                {pasta.name}
              </Link>
            </h2>
            {pasta.archivedAt !== null && <span className="cu-selo-morto">arquivada</span>}
            <span className="ve-quantas">
              {listas.length} {listas.length === 1 ? 'lista' : 'listas'}
            </span>
            <ProgressoNaTela p={progresso} largo />
          </header>

          {listas.length === 0 ? (
            <p className="ve-vazio">Pasta sem lista.</p>
          ) : (
            <div className="ve-listas">
              {listas.map((l) => (
                <LinhaDeLista key={l.id} lista={l} />
              ))}
            </div>
          )}
        </section>
      ))}

      {/* ⚠️ AS LISTAS SOLTAS. Elas existem — medido em 2026-08-28: duas das
          cinco listas do banco não têm pasta — e somem de qualquer desenho que
          assuma que toda lista mora numa. */}
      {visao.soltas.length > 0 && (
        <section className="o-card ve-bloco">
          <header className="ve-cabeca">
            <IconeListaMarcada c="h-4 w-4 shrink-0 opacity-70" />
            <h2 className="o-titulo ve-titulo">Listas sem pasta</h2>
            <span className="ve-quantas">
              {visao.soltas.length} {visao.soltas.length === 1 ? 'lista' : 'listas'}
            </span>
          </header>

          <div className="ve-listas">
            {visao.soltas.map((l) => (
              <LinhaDeLista key={l.id} lista={l} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ───────────────────────────── a tela ───────────────────────────── */

export default function Espaco() {
  const { espacoId } = useParams<{ espacoId?: string }>();
  const navigate = useNavigate();
  const [lugar, definirLugar] = useLugar();

  const [avisoDaArvore, setAvisoDaArvore] = useState<string | null>(null);
  /* F29: em `Somente ícones` o pedido expande a barra antes — ver o gancho. */
  const [revelar, pedirRevelar] = usePedidoDeRevelar();
  const [trilhaAberta, setTrilhaAberta] = useState(false);

  /**
   * PANORAMA | LISTA | KANBAN — F18B (R09). O modo mora no endereço (`?ver=`,
   * só quando não é o panorama) e na preferência DESTA tela (`@/ui/lugar`,
   * `modos`). Trocar aqui não mexe na pasta, na lista nem nas telas da
   * pessoa. Ver `resolverModo`.
   */
  const [modo, escolherModo] = useModoDaTela('espaco', espacoId ?? null);

  /* A ÁRVORE VEM DA CONSULTA COMPARTILHADA — F17.CARGA02. Esta tela e a barra
     lateral que ela desenha dividem a mesma leitura, e vir do quadro para cá
     dentro da validade não pede nada. Ver `@/board/arvore-compartilhada`. */
  const {
    linhas,
    empresas,
    recusa: erro,
    recuperavel: arvoreRecuperavel,
    estado: leituraDaArvore,
    recarregar: lerArvore,
  } = useArvoreCompleta();
  /* Quem administra liga e desliga a marca "exige cliente" na árvore — F38, Fase 7. */
  const { sessao: sessaoDaArvore } = useSessao();

  const arvore: NoDeEspaco[] = useMemo(
    () => (linhas === null ? [] : buildFullTree(linhas)),
    [linhas],
  );

  const espaco = useMemo(() => acharEspaco(arvore, espacoId), [arvore, espacoId]);

  /**
   * O MESMO interruptor da árvore ao lado — F17.24. Um arquivado que some de um
   * lado e fica do outro parece defeito das duas vezes.
   */
  const visao = useMemo(
    () => (espaco === null ? null : montarVisaoDoEspaco(espaco, lugar.arquivados)),
    [espaco, lugar.arquivados],
  );

  return (
    /* SEM VOLTAR — F29 (Fase 4). A moldura desenhava `‹ Voltar` (para a árvore,
       ou para o passo anterior, sem dizer qual). A saída é a trilha do topo. */
    <PaginaLarga>
      {/* A MOLDURA COMUM — F04. A grade à mão (barra + composição medida +
          coluna) virou a peça das outras telas; a árvore pronta, a lista ativa
          e a cadeia de altura seguem pelas props dela. */}
      <TelaComBarra
        atual="quadro"
        listaAtiva={null}
        arvore={
          <ArvoreDoQuadro
            podeMarcarCompartilhada={sessaoDaArvore?.isSuperadmin === true}
            titulo="Compartilhado comigo"
            arvore={arvore}
            companies={empresas}
            /* Espera, falha e ausência de espaços são três coisas — F17.CARGA03. */
            leitura={leituraDaArvore}
            listaAtiva={null}
            espacoAtivo={espacoId ?? null}
            mostrarArquivados={lugar.arquivados}
            aoAlternarArquivados={(m) => definirLugar((l) => ({ ...l, arquivados: m }))}
            aoEscolher={(id) => navigate(`/quadro/${id}`)}
            aoAbrirEspaco={(id) => navigate(`/quadro/espaco/${id}`)}
            /* O nome da pasta abre o quadro dela — F17.64. */
            aoAbrirPasta={(id) => navigate(`/quadro/pasta/${id}`)}
            /* A lista trazida leva à ficha do cliente dela — F17.43. */
            aoAbrirCliente={(id) => navigate(`/cliente/${id}`)}
            aoRecarregar={lerArvore}
            aoRecusar={setAvisoDaArvore}
            revelar={revelar}
          />
        }
      >
        {/* O TOPO — F29: trilha + título, no alto da coluna de conteúdo.
            A TRILHA é a MESMA peça da F17.25, no mesmo lugar das outras telas
            do Pilar B. */}
        {/* O NOME DO ESPAÇO É O TÍTULO — F06A, a mesma regra do quadro e da
            pasta: `Espaço` só enquanto a árvore não chegou. */}
        <Topo
          titulo={espaco ? espaco.name : 'Espaço'}
          acoes={espaco ? <SeletorDeModo contexto="espaco" valor={modo} aoEscolher={escolherModo} /> : undefined}
          marca={espaco ? <MarcaDoEspaco nome={espaco.name} cor={espaco.color} /> : undefined}
          junto={
            /* O SELO DA EMPRESA SAIU — F31 ("será apenas Ide", Wesley, 25/09). */
            espaco && espaco.archivedAt !== null ? (
              <span className="cu-selo-morto">arquivado</span>
            ) : undefined
          }
          trilha={
            <Trilha
              degraus={
                espaco
                  ? trilhaDoEspaco({
                      spaceId: espaco.id,
                      spaceName: espaco.name,
                      spaceColor: espaco.color,
                    })
                  : trilhaEmEspera('Espaço')
              }
              aoRevelar={pedirRevelar}
              expandida={trilhaAberta}
              aoExpandir={() => setTrilhaAberta(true)}
            />
          }
        />

        {/* F04: os avisos moram NA COLUNA, abaixo do título — e não acima da
            grade em largura inteira, empurrando a barra para baixo. */}
        {/* A falha da leitura ganha TENTATIVA PRÓPRIA — F17.CARGA03. Esta tela
            mostrava a frase e mais nada; `Quadro` e `Pasta` já ofereciam o botão,
            e uma recuperação que existe em duas telas e some na terceira ensina
            que ela é instável. Só quando é passageira: contra uma conta desativada
            (403) não há o que tentar de novo. */}
        {erro && (
          <div className="mb-3">
            <Aviso
              tipo="erro"
              acao={
                arvoreRecuperavel
                  ? { rotulo: 'Tentar de novo', aoClicar: () => void lerArvore() }
                  : undefined
              }
            >
              {erro}
            </Aviso>
          </div>
        )}

        {avisoDaArvore && (
          <div className="mb-3">
            <Aviso tipo="erro">{avisoDaArvore}</Aviso>
          </div>
        )}

        {linhas !== null && espaco === null && !erro && (
          <Aviso tipo="info">Este espaço não está ao seu alcance, ou não existe mais.</Aviso>
        )}

        {espaco && modo !== 'panorama' && (
          /* LISTA E KANBAN DO ESPAÇO INTEIRO — F18B. As tarefas de todas as
             pastas e listas soltas que a pessoa alcança, pela consulta
             paginada da F18A; a árvore não entra aqui (ela só resume). */
          <TrabalhoDoEscopo escopo="espaco" id={espaco.id} modo={modo} nomeDoEscopo="neste espaço" />
        )}

        {espaco && visao && modo === 'panorama' && (
          <>
            {/* O RESUMO DO ESPAÇO — F06A. Era um cartão que repetia o nome
                (já no título) ao lado das contagens; ficou a linha do que há
                nele e o progresso, sem moldura. */}
            <div className="ve-resumo">
              <span className="ve-quantas">
                {visao.progresso.listas} {visao.progresso.listas === 1 ? 'lista' : 'listas'}
                {visao.pastas.length > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    {visao.pastas.length} {visao.pastas.length === 1 ? 'pasta' : 'pastas'}
                  </>
                )}
              </span>
              <ProgressoNaTela p={visao.progresso} largo />
            </div>

            <CorpoDoEspaco visao={visao} />
          </>
        )}
      </TelaComBarra>
    </PaginaLarga>
  );
}
