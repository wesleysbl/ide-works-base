/**
 * A barra lateral que se EDITA — etapa F17.14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A GRAMÁTICA VEM DA BARRA LATERAL DO CLICKUP, LIDA DA REFERÊNCIA DO USUÁRIO
 *
 *     ▶ 📁 Agência Alma9                    ···
 *       📁 Bela Enxovais
 *       ▼ 📁 MIMI Enxovais
 *           ✓≡ MIMI (artes)
 *           ✓≡ MIMI (vídeos)      ← selecionada, com fundo
 *       ✓≡ Skills                 ← lista solta, no mesmo nível das pastas
 *
 *   O que se lê dela, e o que esta tela copia:
 *     · ícone DIFERENTE por tipo — é o que distingue pasta de lista de relance;
 *     · seta de expandir à esquerda, `▶` recolhida e `▼` aberta;
 *     · `···` que aparece na linha ao passar o mouse;
 *     · lista solta no espaço existe, e vive no mesmo nível das pastas;
 *     · a linha selecionada tem fundo;
 *     · a indentação marca o nível.
 *
 *   São TRÊS níveis — espaço → pasta → lista. O usuário confirmou em
 *   2026-08-25: o que ele chamou de "subpasta" é a LISTA. Pasta dentro de pasta
 *   não existe no modelo (a F17.1 mediu isso) e não se inventa aqui.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTE COMPONENTE NÃO DECIDE
 *   Quem pode criar espaço, pasta ou lista. Isso está no banco desde a F17.1:
 *   `spaces_write` exige administrador, `folders_write` e `lists_write` exigem
 *   alcance ao espaço.
 *
 *   ⚠️ E POR ISSO O BOTÃO NÃO SOME PARA QUEM NÃO PODE. Esconder o `Novo espaço`
 *   de quem não é administrador seria reimplementar a política em React — a
 *   dívida 8.1 outra vez — e ainda ensinaria errado: a pessoa nunca saberia que
 *   a função existe. O botão aparece, o banco recusa, e a recusa dele aparece
 *   escrita. Mesma decisão que o quadro tomou para o arrasto recusado.
 *
 * A RECUSA DO BANCO PASSA INTEIRA
 *   As dez travas da F17 escrevem frases que NOMEIAM o que está no caminho — a
 *   tarefa, a etiqueta, o espaço dela, quantos vínculos existem. Elas sobem por
 *   `ApiError.message` e são mostradas sem corte. Trocá-las por "erro ao mover"
 *   desperdiçaria o trabalho de três etapas.
 *
 * ⚠️ NENHUM COMPONENTE É DECLARADO DENTRO DESTA FUNÇÃO
 *   As linhas e os menus são FUNÇÕES que devolvem JSX, chamadas com `{...()}`, e
 *   não componentes usados com `<Tag/>`. A diferença é grande: um componente
 *   declarado dentro do corpo tem identidade nova a cada render, e o React
 *   desmonta e remonta a subárvore inteira — o campo de renomear perderia o
 *   foco a cada tecla digitada. O que precisa GUARDAR estado (`CaixaDaEsteira`,
 *   `CampoDaLinha`) vive fora, no escopo do módulo.
 *
 * COR
 *   Nenhuma literal. A do sistema sai de `var(--…)`; a do dado — `spaces.color`,
 *   `statuses.color` — entra como variável no elemento (decisão D10).
 */

import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import {
  DE_ONDE_VEIO,
  ESTEIRA_PADRAO,
  type Empresa,
  type NoDeEspaco,
  type NoDeLista,
  type NoDePasta,
  GRUPOS_DE_STATUS,
  GRUPO_DO_TIPO,
  type GrupoDeStatus,
  type StatusEmEdicao,
  TIPO_DO_GRUPO,
  conferirEsteira,
  contarArquivados,
  destinosDeLista,
  espacosHomonimos,
  listaLevaAFicha,
  listasDoQuadro,
  normalizarEntrada,
  unidadesDoEspacoNovo,
} from '@/board/arvore';
import {
  type Automacao,
  type AutomacaoEmEdicao,
  conferirAutomacao,
  fraseDaAutomacao,
  paraEdicao,
  passosDaAutomacao,
} from '@/board/automacoes';
import { CaixaDeAcesso } from '@/board/CaixaDeAcesso';
import { CaixaDaAprovacao } from '@/board/AprovacaoDaEsteira';
import { CaixaDeClientes } from '@/board/CaixaDeClientes';
import { HERDAR, MOLDES_DE_ESTEIRA, moldePorChave } from '@/board/moldes';
import {
  Ajuda,
  Balao,
  ComAncora,
  IconeArquivo,
  IconeCliente,
  IconeLimpar,
  IconeMais,
  IconePessoa,
  IconeSeta,
  ItemDeMenu,
  Separador,
} from '@/board/menus';
// Os três sinais de nível — F17.25. Compartilhados com a trilha do topo, que
// precisa desenhar exatamente o que a árvore desenha.
import { IconeListaMarcada, IconePasta, MarcaDoEspaco } from '@/board/icones-da-arvore';
import { type EstadoDaLeitura } from '@/board/arvore-compartilhada';
import { ContextoDaColunaDaArvore, ContextoDaSecaoDaArvore } from '@/board/secao-recolhivel';
import { ApiError, api } from '@/lib/api';
import { useLugar } from '@/ui/aparencia';
import { IconeChevron, IconeColuna, IconeLixeira, IconeRecolher } from '@/ui/Icones';
import { alternar as alternarChave } from '@/ui/lugar';

/* ───────────────────────────── peças pequenas ───────────────────────────── */

/**
 * O ESQUELETO DA PRIMEIRA CARGA — F17.CARGA03.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE EXISTE, E POR QUE ELE É ASSIM
 *
 *   Até aqui, o intervalo entre montar a tela e a árvore chegar era desenhado
 *   com a frase `Nenhum espaço ao seu alcance.` — uma afirmação sobre PERMISSÃO
 *   no lugar de "estou carregando". O dono do projeto viu isso numa captura de
 *   tela e leu como falha de acesso. Ver `EstadoDaLeitura`.
 *
 * ⚠️ `ESTÁVEL` QUER DIZER QUE A PÁGINA NÃO PULA QUANDO O DADO CHEGA
 *   Por isso as barras têm a mesma altura de linha dos nós reais (`.cu-no`) e o
 *   número delas é FIXO — seis, na cadência espaço · pasta · lista · lista ·
 *   pasta · lista, que é a forma da árvore da casa. Um esqueleto que sorteia
 *   quantidade a cada desenho, ou que cresce com o tempo de espera, empurra o
 *   conteúdo debaixo do cursor no instante do clique — que é o defeito medido
 *   na F17.62, por outra causa.
 *
 *   Sem texto dentro, e por isso `aria-hidden`: um leitor de tela que anunciasse
 *   seis linhas vazias diria menos do que o `aria-busy` da caixa já diz.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const NIVEIS_DO_ESQUELETO = [0, 1, 2, 2, 1, 2] as const;

const EsqueletoDaArvore = () => (
  <div className="cu-esqueleto" aria-hidden>
    {NIVEIS_DO_ESQUELETO.map((nivel, i) => (
      <div key={i} className="cu-esqueleto-linha" data-nivel={nivel} />
    ))}
  </div>
);

/*
  OS TRÊS SINAIS DE NÍVEL SAÍRAM DAQUI NA F17.25.
  A trilha do topo (`@/board/Trilha`) desenha os MESMOS ícones — é o pedido do
  usuário, e é o que a referência dele mostra. Duas cópias divergiriam na
  primeira etapa que mexesse numa só. Ver `@/board/icones-da-arvore`.
*/

/**
 * O campo que troca de lugar com o nome enquanto se renomeia ou se cria.
 *
 * `Enter` confirma, `Esc` cancela, e SAIR DO CAMPO confirma — que é o que o
 * ClickUp faz. O `Esc` para aqui (`stopPropagation`) para não fechar junto o
 * menu que abriu este campo.
 */
function CampoDaLinha({
  valor,
  convite,
  rotulo,
  salvando,
  aoMudar,
  aoConfirmar,
  aoCancelar,
}: {
  valor: string;
  convite: string;
  rotulo: string;
  salvando: boolean;
  aoMudar: (v: string) => void;
  aoConfirmar: () => void;
  aoCancelar: () => void;
}) {
  return (
    <input
      className="cu-no-campo"
      value={valor}
      autoFocus
      maxLength={120}
      disabled={salvando}
      placeholder={convite}
      aria-label={rotulo}
      onChange={(e) => aoMudar(e.target.value)}
      onBlur={aoConfirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          aoConfirmar();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          aoCancelar();
        }
      }}
    />
  );
}

/* ───────────────────────────── escrever, reler, mostrar a recusa ────────── */

/**
 * O resultado de uma escrita.
 *
 * DISCRIMINADO, e não `boolean` com um `let` capturado do lado de fora: quem
 * cria uma lista precisa do ID dela para abri-la em seguida, e uma variável
 * atribuída dentro de uma função aninhada é justamente o que o TypeScript não
 * consegue estreitar — o código compilaria com um ramo morto no tipo e vivo em
 * execução.
 */
type Feito<T> = { ok: true; valor: T } | { ok: false };

const NEGADO = { ok: false } as const;

/* ───────────────────────────── a unidade, na criação ─────────────────────── */

/**
 * O CAMPO "UNIDADE" DO BALÃO "ESPAÇO NOVO" — F31.
 *
 * Só aparece quando há ESCOLHA: com uma unidade oferecida, o espaço nasce nela
 * e o balão não pergunta ("será apenas Ide", Wesley, 25/09). Quem decide o que
 * é oferecido é `unidadesDoEspacoNovo` — nunca `Sem categoria`, e só o que a
 * pessoa alcança.
 *
 * Peça própria, e exportada, pelo mesmo motivo de `SeletorDeMolde`: o balão só
 * abre com clique, e o teste desenha no servidor, sem clique nenhum.
 */
export function CampoDaUnidade({
  unidades,
  valor,
  aoMudar,
}: {
  unidades: readonly Empresa[];
  valor: string;
  aoMudar: (id: string) => void;
}) {
  if (unidades.length < 2) return null;
  return (
    <label className="cu-campo">
      <span>Unidade</span>
      <select className="cu-mini-select" value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {unidades.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ───────────────────────────── as etapas, na criação ─────────────────────── */

/**
 * As ETAPAS escolhidas no momento em que a lista (ou o espaço) nasce. F17.16.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * *"dentro da lista deve ser personalizável as etapas, e não ser apenas a fazer
 * e concluídas, na criação desse processo deve ser organizado."*
 *
 *   A capacidade já existia inteira — `status_sets` desde a F17.2, o editor no
 *   `···` desde a F17.14. O que faltava era o MOMENTO: a lista nascia com dois
 *   estados e alguém tinha que lembrar de voltar lá. Isto é o momento.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ TODO BOTÃO DAQUI SEGURA O `mousedown`, E NÃO É DETALHE.
 *   O campo de nome ao lado CONFIRMA AO PERDER O FOCO — é o gesto do ClickUp, e
 *   estava aqui antes. Um botão que deixasse o `mousedown` seguir tiraria o foco
 *   do campo, e escolher a esteira CRIARIA a lista no mesmo clique, com o molde
 *   ainda não escolhido. Com `preventDefault` o foco não sai e o gesto se
 *   completa.
 *
 * A PRÉVIA MOSTRA AS ETAPAS DE VERDADE
 *   Escolher `Vídeo` sem ver as dez colunas seria escolher no escuro. A cor sai
 *   do dado, por variável no elemento — decisão D10.
 */
export function SeletorDeMolde({
  valor,
  comHerdar,
  desativado,
  aoEscolher,
}: {
  valor: string;
  /** A lista pode herdar; o espaço, não — espaço sem esteira nasce morto. */
  comHerdar: boolean;
  desativado: boolean;
  aoEscolher: (chave: string) => void;
}) {
  const molde = moldePorChave(valor);

  const opcao = (chave: string, rotulo: string, titulo: string) => (
    <button
      key={chave}
      type="button"
      role="radio"
      aria-checked={valor === chave}
      className="cu-molde"
      title={titulo}
      disabled={desativado}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => aoEscolher(chave)}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="cu-moldes">
      <div className="cu-moldes-fila" role="radiogroup" aria-label="Etapas da esteira">
        <span className="cu-moldes-rotulo">Etapas</span>
        {comHerdar &&
          opcao(
            HERDAR,
            'Herdar',
            'A lista usa a esteira da pasta ou do espaço. É o padrão, e dá para trocar depois no ··· → Esteira…',
          )}
        {MOLDES_DE_ESTEIRA.map((m) => opcao(m.chave, m.nome, m.resumo))}
      </div>

      {molde === null ? (
        /* A SEGUNDA FRASE VIROU `?` — F17.24. Ela ensinava o caminho para
           trocar a esteira depois, e essa é a terceira cópia da mesma
           instrução: ela já está no `title` da opção `Herdar` e no menu da
           lista. O que ficou é o estado: esta lista herda. */
        <p className="cu-vazio cu-com-ajuda">
          <span>Herda a esteira da pasta ou do espaço.</span>
          <Ajuda sobre="a esteira herdada" lado="cima">
            <p>A lista fica com as mesmas etapas da pasta ou do espaço em que ela nasce.</p>
            <p>
              Para dar uma própria depois: <b>···</b> da lista → <i>Esteira…</i>.
            </p>
          </Ajuda>
        </p>
      ) : (
        <div className="cu-molde-previa" aria-label={`Etapas de ${molde.nome}`}>
          {molde.statuses.map((st) => (
            <span
              key={st.name}
              className="cu-molde-etapa"
              data-fim={st.type === 'closed'}
              style={{ ['--cor-status' as string]: st.color }}
            >
              <span className="cu-ponto" aria-hidden="true" />
              {st.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── a caixa da esteira ───────────────────────── */

/**
 * Escolher a esteira da lista, ou voltar a herdar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE MUDOU NA F17.19, E POR QUE
 *
 *   *"só queria criar uma etapa a mais mesmo tendo a tarefa criada antes, é
 *   normal ter que alterar no meio do caminho."*
 *
 *   Era impossível. A tela mandava a esteira nova como se a lista estivesse
 *   vazia, o banco apagava e recriava, e o `status_tree_guard` recusava porque
 *   as tarefas apontavam para as etapas do conjunto velho.
 *
 *   Três coisas passam a existir aqui:
 *
 *   1. CADA ETAPA CARREGA O `id` QUE ELA JÁ TEM. É o que faz renomear ser
 *      renomear em vez de "some uma, nasce outra" — e o que faz as tarefas irem
 *      junto sem ninguém perguntar nada.
 *   2. AS SETAS DE ORDEM. A ordem da esteira é a ordem das colunas do quadro, e
 *      até aqui só dava para escolhê-la digitando tudo de novo.
 *   3. A PERGUNTA. Quando uma etapa que tem tarefa dentro some, o banco recusa
 *      com o nome dela, e a caixa mostra um seletor de destino em vez de uma
 *      recusa. Recusar seria trancar a porta com a chave do lado de dentro.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O BANCO É QUEM DECIDE, E ELE DECIDE DUAS VEZES.
 *   `ideworks.set_list_workflow` recusa esteira sem exatamente uma etapa que
 *   fecha, e grupo fora dos cinco tipos. Depois dela, `status_tree_guard`
 *   confere que nenhuma tarefa ficou apontando para fora da esteira resolvida.
 *
 *   `conferirEsteira` aqui é só para o botão saber quando desabilitar. Se as
 *   duas discordarem, a do banco ganha e a frase dela aparece.
 */
function CaixaDaEsteira({
  lista,
  pasta,
  salvando,
  aoFechar,
  aoAgir,
}: {
  lista?: NoDeLista;
  pasta?: NoDePasta;
  salvando: boolean;
  aoFechar: () => void;
  aoAgir: <T,>(fn: () => Promise<T>) => Promise<Feito<T>>;
}) {
  const [editando, setEditando] = useState(false);
  const [previa, setPrevia] = useState<{revision: string; lists: number; archived: number; tasks: number} | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  const [nome, setNome] = useState(lista?.workflowName ?? 'Esteira');
  const [linhas, setLinhas] = useState<StatusEmEdicao[]>(() => [...ESTEIRA_PADRAO]);

  /**
   * As etapas COMO ELAS ESTÃO NO BANCO AGORA. Guardadas à parte porque a recusa
   * de destino chega por NOME, e quem sabe traduzir nome em `id` é esta lista —
   * não a que está sendo editada, onde o nome pode já ter mudado.
   */
  const [originais, setOriginais] = useState<StatusEmEdicao[]>([]);

  /** As etapas que vão sumir levando tarefa junto, e para onde cada uma vai. */
  const [semDestino, setSemDestino] = useState<readonly string[]>([]);
  const [destinos, setDestinos] = useState<Record<string, string>>({});

  const problema = conferirEsteira(nome, linhas);
  const propria = lista?.inheritedFrom === 'list';

  /**
   * O editor começa com A ESTEIRA QUE A LISTA TEM HOJE, e não com o padrão.
   *
   * "Personalizar status" no ClickUp abre as colunas que já existem, para se
   * mexer numa delas — abrir um formulário em branco obrigaria a redigitar a
   * esteira inteira para trocar uma cor. A árvore não carrega os status (seriam
   * dezenas de linhas por lista, e a barra lateral não os desenha), então eles
   * vêm numa leitura sob demanda, só quando o editor abre.
   *
   * ⚠️ O `id` VEM JUNTO, e é o que a F17.19 acrescentou. Sem ele o banco não
   * teria como saber que a etapa renomeada é a mesma etapa.
   *
   * Se a leitura falhar, fica o padrão: o editor continua utilizável, que é
   * melhor do que uma caixa que não abre.
   */
  const abrirEditor = async () => {
    setEditando(true);
    setLendo(true);
    setErroLeitura(null);
    try {
      if (pasta) {
        const r = await api.lerEsteiraDaPasta(pasta.id);
        setNome(r.name);
        setLinhas(r.statuses.length ? r.statuses.map((s) => ({ ...s, color: s.color ?? '#8a8f98' })) : [...ESTEIRA_PADRAO]);
        setOriginais(r.originals);
        setPrevia(r);
        return;
      }
      if (!lista) return;
      const r = await api.quadroDaLista(lista.id);
      const b = r.board as {
        statuses?: { id: string; name: string; type: StatusEmEdicao['type']; color: string | null }[];
      };
      const atuais = (b.statuses ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        color: s.color ?? '#8a8f98',
      }));
      if (atuais.length > 0) {
        setLinhas(atuais);
        setOriginais(atuais);
      }
    } catch (e) {
      if (pasta) setErroLeitura(e instanceof ApiError ? e.message : 'Não foi possível ler a esteira da pasta.');
    } finally {
      setLendo(false);
    }
  };

  const mudar = (i: number, mudou: Partial<StatusEmEdicao>) =>
    setLinhas((l) => l.map((s, j) => (j === i ? { ...s, ...mudou } : s)));

  /** Sobe ou desce uma etapa. A ordem daqui é a ordem das colunas do quadro. */
  const mover = (i: number, passo: -1 | 1) =>
    setLinhas((l) => {
      const j = i + passo;
      if (j < 0 || j >= l.length) return l;
      const novo = [...l];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
    });

  const aplicar = () => {
    void aoAgir(async () => {
      try {
        const entrada = {
          name: nome.trim(),
          // A ENTRADA DA ESTEIRA É NORMALIZADA AQUI: o seletor mostra quatro
          // grupos, e `Não iniciado` cobre dois tipos. Ver `normalizarEntrada`.
          statuses: normalizarEntrada(linhas),
          destinos: Object.entries(destinos)
            .flatMap(([nomeVelho, paraOnde]) => originais.filter((o) => o.name === nomeVelho)
              .map((o) => ({ de: o.id ?? '', para: paraOnde })))
            .filter((d) => d.de !== '' && d.para !== ''),
        };
        if (pasta && previa) return await api.aplicarEsteiraDaPasta(pasta.id, { ...entrada, revision: previa.revision });
        if (!lista) throw new Error('Leia a esteira antes de aplicar.');
        return await api.esteiraDaLista(lista.id, entrada);
      } catch (e) {
        // A ÚNICA RECUSA QUE NÃO É RECUSA: o banco não sabe para onde mandar as
        // tarefas de uma etapa que some. Ele diz quais são, e a caixa pergunta.
        if (e instanceof ApiError && (e.semDestino?.length ?? 0) > 0) {
          setSemDestino(e.semDestino ?? []);
          setDestinos((d) => {
            const cheio = { ...d };
            for (const n of e.semDestino ?? []) {
              if (cheio[n] === undefined) cheio[n] = linhas[0]?.name ?? '';
            }
            return cheio;
          });
        }
        throw e;
      }
    }).then((feito) => {
      if (feito.ok) aoFechar();
    });
  };

  return (
    <Balao lado="baixo-direita" aoFechar={aoFechar} rotulo={pasta ? "Esteira da pasta" : "Esteira da lista"}>
      {pasta ? <p className="cu-vazio">Configure as etapas compartilhadas pelas listas de <b>{pasta.name}</b>.</p> : (
        <p className="cu-vazio">
          Hoje: <b style={{ color: 'var(--plat)' }}>{lista?.workflowName ?? 'nenhuma'}</b>
          {lista?.inheritedFrom && ` · ${DE_ONDE_VEIO[lista.inheritedFrom]}`}
        </p>
      )}

      {!editando && (
        <>
          <ItemDeMenu aoEscolher={() => void abrirEditor()} desativado={salvando}>
            <IconeListaMarcada />
            {pasta ? 'Mudar a esteira de todas as listas' : propria ? 'Mudar as etapas desta lista' : 'Dar uma esteira própria a esta lista'}
          </ItemDeMenu>

          {lista && <ItemDeMenu
            desativado={!propria || salvando}
            aoEscolher={() => {
              void aoAgir(() => api.herdarEsteiraDaLista(lista.id)).then((feito) => {
                if (feito.ok) aoFechar();
              });
            }}
          >
            <IconeLimpar />
            Voltar a herdar
          </ItemDeMenu>}

          {!propria && !pasta && (
            <p className="cu-vazio">
              A esteira já vem da pasta ou do espaço — não há o que devolver.
            </p>
          )}
        </>
      )}

      {editando && (
        <div className="cu-esteira">
          {lendo && <p className="cu-vazio">Lendo a esteira de hoje…</p>}

          {erroLeitura && <p role="alert" className="cu-vazio">{erroLeitura} <button type="button" onClick={() => void abrirEditor()}>Tentar novamente</button></p>}
          {pasta && previa && <p className="cu-vazio">
            Aplicar em <b>{previa.lists} listas</b> de {pasta.name}, com {previa.tasks} tarefas.
            {previa.archived > 0 && ` Inclui ${previa.archived} listas arquivadas.`}
            {' As esteiras próprias serão substituídas pela esteira da pasta. Novas listas também a herdarão.'}
          </p>}
          <input
            className="cu-busca"
            value={nome}
            maxLength={80}
            aria-label="Nome da esteira"
            placeholder="Nome da esteira"
            onChange={(e) => setNome(e.target.value)}
          />

          {linhas.map((s, i) => (
            <div key={s.id ?? `nova-${i}`} className="cu-esteira-linha">
              <span
                className="cu-ponto"
                style={{ ['--cor-status' as string]: s.color }}
                aria-hidden="true"
              />
              <input
                className="cu-esteira-nome"
                value={s.name}
                maxLength={60}
                aria-label={`Nome da etapa ${i + 1}`}
                onChange={(e) => mudar(i, { name: e.target.value })}
              />
              <span className="cu-esteira-acoes">
              <select
                className="cu-mini-select"
                value={GRUPO_DO_TIPO[s.type]}
                aria-label={`Grupo da etapa ${i + 1}`}
                onChange={(e) =>
                  mudar(i, { type: TIPO_DO_GRUPO[e.target.value as GrupoDeStatus] })
                }
              >
                {GRUPOS_DE_STATUS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <input
                type="color"
                className="cu-esteira-cor"
                value={s.color}
                aria-label={`Cor da etapa ${i + 1}`}
                onChange={(e) => mudar(i, { color: e.target.value })}
              />
              <button
                type="button"
                className="cu-icone-btn"
                aria-label={`Subir a etapa ${i + 1}`}
                disabled={i === 0}
                onClick={() => mover(i, -1)}
              >
                <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                  <IconeSeta c="h-3 w-3" />
                </span>
              </button>
              <button
                type="button"
                className="cu-icone-btn"
                aria-label={`Descer a etapa ${i + 1}`}
                disabled={i === linhas.length - 1}
                onClick={() => mover(i, 1)}
              >
                <IconeSeta c="h-3 w-3" />
              </button>
              <button
                type="button"
                className="cu-icone-btn"
                aria-label={`Tirar a etapa ${i + 1}`}
                disabled={linhas.length <= 1}
                onClick={() => setLinhas((l) => l.filter((_, j) => j !== i))}
              >
                <IconeLimpar c="h-3.5 w-3.5" />
              </button>
              </span>
            </div>
          ))}

          {/*
            A PERGUNTA, e não a recusa. Ela só aparece depois de o banco dizer
            que há tarefa parada numa etapa que sumiu — antes disso não há o que
            perguntar, e etapa vazia que some não pergunta nada a ninguém.
          */}
          {semDestino.length > 0 && (
            <div className="cu-destinos">
              {semDestino.map((nomeVelho) => (
                <label key={nomeVelho} className="cu-destino">
                  <span>{pasta ? 'Tarefas e automações' : 'As tarefas'} de “{nomeVelho}” vão para</span>
                  <select
                    className="cu-mini-select"
                    value={destinos[nomeVelho] ?? ''}
                    aria-label={`Destino das tarefas de ${nomeVelho}`}
                    onChange={(e) =>
                      setDestinos((d) => ({ ...d, [nomeVelho]: e.target.value }))
                    }
                  >
                    {linhas.map((s, i) => (
                      <option key={s.id ?? `nova-${i}`} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          <div className="cu-esteira-pe">
            {/* A etapa nova entra ANTES da última: a última é normalmente a que
                fecha, e empurrá-la para o meio faria a esteira nascer com a
                ordem errada. Daqui em diante as setas resolvem. */}
            <button
              type="button"
              className="cu-ferramenta"
              onClick={() =>
                setLinhas((l) => [
                  ...l.slice(0, -1),
                  { name: '', type: 'custom', color: '#8a8f98' },
                  ...l.slice(-1),
                ])
              }
            >
              + etapa
            </button>

            <button
              type="button"
              className="o-btn o-btn-primario o-btn-sm"
              disabled={problema !== null || salvando || lendo || (Boolean(pasta) && previa === null)}
              onClick={aplicar}
            >
              {salvando ? 'salvando…' : pasta ? 'Aplicar a todas as listas' : 'Aplicar'}
            </button>
          </div>

          {problema !== null && <p className="cu-vazio">{problema}</p>}
        </div>
      )}
    </Balao>
  );
}

/* ─────────────────────── as automações da lista (F17.41) ─────────────────── */

/**
 * *"dentro dos status das listas, é necessário a possibilidade de automações...
 * após determinada etapa troca o responsável e encaminha para outro, de forma
 * que não fique mais responsável para o anterior."*
 *
 * ELA MORA AO LADO DA ESTEIRA, e não numa tela própria: a regra é da ETAPA, e a
 * etapa se edita aqui, no `···` da lista. Uma tela separada obrigaria a pessoa a
 * lembrar o nome da etapa que acabou de criar noutro lugar.
 *
 * O BANCO É QUEM DECIDE, E ELE DECIDE TRÊS COISAS QUE ESTA CAIXA NÃO SABE:
 *   · se quem está mexendo pode configurar automação nesta lista;
 *   · se a pessoa escolhida alcança a lista para onde a tarefa vai;
 *   · se a regra fecharia um círculo com outra que já existe.
 *
 * `conferirAutomacao` aqui é só para o botão saber quando se desabilitar, e é
 * SEMPRE menos severa que o banco. Quando as duas discordam, a do banco ganha e
 * a frase dela aparece.
 *
 * OS DESTINOS SAEM DA ÁRVORE QUE JÁ ESTÁ NA TELA. Ela é o que a pessoa alcança
 * — a política de linha já filtrou. Uma consulta de "listas que eu alcanço"
 * seria uma segunda versão da regra de alcance.
 */
function CaixaDasAutomacoes({
  lista,
  arvore,
  salvando,
  aoFechar,
  aoAgir,
}: {
  lista: NoDeLista;
  arvore: readonly NoDeEspaco[];
  salvando: boolean;
  aoFechar: () => void;
  aoAgir: <T,>(fn: () => Promise<T>) => Promise<Feito<T>>;
}) {
  const [lendo, setLendo] = useState(true);
  const [regras, setRegras] = useState<Automacao[]>([]);
  const [etapas, setEtapas] = useState<StatusEmEdicao[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [etapasDoDestino, setEtapasDoDestino] = useState<{ id: string; name: string }[]>([]);
  /**
   * O FORMULÁRIO ABERTO, OU `null` QUANDO A CAIXA SÓ MOSTRA AS REGRAS.
   *
   * Era um par `editando: boolean` + `rascunho`, e o par mentia: dava para
   * estar "editando" com um rascunho vazio e vice-versa. Um estado só não tem
   * essa combinação — e é ele que carrega o `id` da regra que se está mudando.
   */
  const [rascunho, setRascunho] = useState<AutomacaoEmEdicao | null>(null);

  const destinos = useMemo(() => listasDoQuadro(arvore, lista.id), [arvore, lista.id]);
  const problema = rascunho === null ? null : conferirAutomacao(rascunho);

  /**
   * O DESTINO DO JEITO QUE A PESSOA O ESCOLHEU: com o caminho na frente.
   *
   * ⚠️ Medido na regra de exemplo do usuário: ela sai de `Todas as demandas` e
   * vai para `Todas as demandas` — duas listas diferentes, com o mesmo nome, em
   * espaços diferentes. Só o nome faria a frase dizer que a tarefa vai para
   * onde ela já está. O seletor mostra `Espaço / Pasta / Lista`, e a frase
   * passa a nomear a lista com o mesmo texto.
   */
  const caminhoDoDestino = (id: string | null) => {
    const d = destinos.find((x) => x.id === id);
    return d === undefined ? null : `${d.caminho} / ${d.name}`;
  };

  const recarregar = () =>
    api.automacoesDaLista(lista.id).then((r) => setRegras(r.automations));

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [r, q, e] = await Promise.all([
          api.automacoesDaLista(lista.id),
          api.quadroDaLista(lista.id),
          api.equipe(),
        ]);
        if (!vivo) return;
        setRegras(r.automations);
        setEquipe(e.team);
        const b = q.board as { statuses?: StatusEmEdicao[] };
        setEtapas(b.statuses ?? []);
      } catch {
        /* A caixa continua abrindo. A recusa de verdade aparece ao gravar. */
      } finally {
        if (vivo) setLendo(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [lista.id]);

  /**
   * As etapas do destino vêm sob demanda, quando alguém escolhe a lista.
   *
   * Trazer as etapas de TODAS as listas de uma vez seriam dezenas de consultas
   * para desenhar um seletor que quase nunca abre.
   *
   * `escolherAPrimeira` separa os dois usos: escolhendo a lista agora, a
   * primeira etapa já vem marcada — é onde a tarefa cairia de qualquer jeito, e
   * um seletor vazio deixaria o botão apagado sem dizer por quê. ABRINDO UMA
   * REGRA QUE JÁ EXISTE, não: ali a etapa escolhida é a que está gravada, e
   * trocá-la por baixo mudaria a regra só de olhar para ela.
   */
  const carregarEtapasDoDestino = (id: string, escolherAPrimeira: boolean) =>
    api
      .quadroDaLista(id)
      .then((q) => {
        const b = q.board as { statuses?: { id: string; name: string }[] };
        const lá = b.statuses ?? [];
        setEtapasDoDestino(lá);
        if (escolherAPrimeira) {
          setRascunho((a) => (a === null ? a : { ...a, targetStatusId: lá[0]?.id ?? null }));
        }
      })
      .catch(() => setEtapasDoDestino([]));

  const escolherDestino = (id: string) => {
    if (id === '') {
      setRascunho((a) => (a === null ? a : { ...a, targetListId: null, targetStatusId: null }));
      setEtapasDoDestino([]);
      return;
    }
    setRascunho((a) => (a === null ? a : { ...a, targetListId: id, targetStatusId: null }));
    void carregarEtapasDoDestino(id, true);
  };

  const nova = () => {
    setEtapasDoDestino([]);
    setRascunho({
      id: null,
      name: '',
      triggerStatusId: '',
      targetListId: null,
      targetStatusId: null,
      assigneeId: null,
      active: true,
    });
  };

  /**
   * MUDAR A REGRA QUE JÁ EXISTE — a dívida registrada da F17.41.
   *
   * `ideworks.set_task_automation` já aceitava `id`, e o servidor já o
   * repassava: a TELA é que mandava `null` sempre, e por isso mexer numa regra
   * era apagar e criar outra. O preço disso não era digitação — era o registro
   * da tarefa passando a apontar para uma regra que não existe mais, e a pausa
   * se perdendo no caminho.
   */
  const mudar = (a: Automacao) => {
    setEtapasDoDestino([]);
    setRascunho(paraEdicao(a));
    if (a.targetListId !== null) void carregarEtapasDoDestino(a.targetListId, false);
  };

  const gravar = () => {
    if (rascunho === null) return;
    void aoAgir(() => api.salvarAutomacao(lista.id, rascunho)).then((feito) => {
      if (!feito.ok) return;
      void recarregar();
      setRascunho(null);
      setEtapasDoDestino([]);
    });
  };

  /**
   * O INTERRUPTOR DE PAUSA — F17.45.
   *
   * `is_active` existe no banco desde a F17.41 e `move_task` já a respeita
   * (`and a.is_active`): faltava o botão. Até aqui, pausar era APAGAR — e
   * apagar leva junto a configuração inteira, para quem só queria segurar a
   * regra por um dia.
   */
  const alternarPausa = (a: Automacao) => {
    void aoAgir(() =>
      api.salvarAutomacao(lista.id, { ...paraEdicao(a), active: !a.active }),
    ).then((feito) => {
      if (feito.ok) void recarregar();
    });
  };

  const apagar = (id: string) => {
    void aoAgir(() => api.apagarAutomacao(id)).then((feito) => {
      if (feito.ok) setRegras((r) => r.filter((a) => a.id !== id));
    });
  };

  /**
   * A REGRA POR EXTENSO, EM PASSOS — o que esta etapa veio entregar.
   *
   * A frase inteira vai para quem usa leitor de tela, e os passos ficam para o
   * olho: em voz alta não há colunas, e na tela uma frase corrida de quatro
   * linhas esconde onde o gatilho termina e o efeito começa. As duas saem da
   * MESMA função pura, então não têm como divergir.
   */
  const emPassos = (a: Automacao) => {
    const caminho = caminhoDoDestino(a.targetListId);
    return (
      <span className="cu-regra-passos">
        <span className="sr-only">{fraseDaAutomacao(a, lista.name, caminho)}</span>
        <span aria-hidden="true">
          {passosDaAutomacao(a, lista.name, caminho).map((p) => (
            <span className="cu-passo" key={p.rotulo}>
              <span className="cu-passo-rotulo">{p.rotulo}</span>
              <span className="cu-passo-frase">
                {p.pedacos.map((pedaço, i) =>
                  pedaço.nome === true ? (
                    <b className="cu-passo-nome" key={i}>
                      {pedaço.texto}
                    </b>
                  ) : (
                    <span key={i}>{pedaço.texto}</span>
                  ),
                )}
              </span>
            </span>
          ))}
        </span>
      </span>
    );
  };

  /**
   * O rascunho visto como regra, para a prévia sair da MESMA frase da lista.
   *
   * Sem isto a prévia seria uma segunda montagem da mesma sentença — e a
   * segunda versão é sempre a que envelhece. Ela só aparece quando não há
   * problema: antes disso faltaria etapa, e a frase diria bobagem.
   */
  const comoRegra = (r: AutomacaoEmEdicao): Automacao => ({
    id: r.id ?? '',
    name: r.name,
    triggerStatusId: r.triggerStatusId,
    triggerStatusName: etapas.find((s) => (s.id ?? '') === r.triggerStatusId)?.name ?? null,
    targetListId: r.targetListId,
    targetListName: destinos.find((d) => d.id === r.targetListId)?.name ?? null,
    targetStatusId: r.targetStatusId,
    targetStatusName: etapasDoDestino.find((s) => s.id === r.targetStatusId)?.name ?? null,
    assigneeId: r.assigneeId,
    assigneeName: equipe.find((p) => p.id === r.assigneeId)?.name ?? null,
    active: r.active,
  });

  return (
    <Balao lado="baixo-direita" aoFechar={aoFechar} rotulo="Automações da lista">
      {lendo && <p className="cu-vazio">Lendo as automações…</p>}

      {!lendo && regras.length === 0 && rascunho === null && (
        <p className="cu-vazio">Nenhuma automação nesta lista.</p>
      )}

      {rascunho === null &&
        regras.map((a) => (
          <div key={a.id} className="cu-regra" data-pausada={a.active ? undefined : 'sim'}>
            <p className="cu-regra-nome">
              <b>{a.name}</b>
              {!a.active && <span className="cu-regra-selo">pausada</span>}
            </p>

            {emPassos(a)}

            <div className="cu-regra-acoes">
              <button
                type="button"
                className="cu-ferramenta"
                disabled={salvando}
                aria-label={`Mudar a automação ${a.name}`}
                onClick={() => mudar(a)}
              >
                mudar
              </button>
              {/* PAUSAR NÃO É APAGAR. Ver `alternarPausa` acima. */}
              <button
                type="button"
                className="cu-ferramenta"
                disabled={salvando}
                aria-pressed={!a.active}
                aria-label={`${a.active ? 'Pausar' : 'Retomar'} a automação ${a.name}`}
                onClick={() => alternarPausa(a)}
              >
                {a.active ? 'pausar' : 'retomar'}
              </button>
              <button
                type="button"
                className="cu-icone-btn"
                aria-label={`Tirar a automação ${a.name}`}
                disabled={salvando}
                onClick={() => apagar(a.id)}
              >
                <IconeLimpar c="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

      {rascunho === null && (
        <ItemDeMenu aoEscolher={nova} desativado={salvando || etapas.length === 0}>
          <span className="cu-ponto" aria-hidden="true" />
          Nova automação
        </ItemDeMenu>
      )}

      {rascunho !== null && (
        /* ⚠️ `cu-rolagem` E O PÉ DO LADO DE FORA — a régua da F17.35.
           Medido a 1280×720: o formulário quer 393px e o teto do balão ali é
           340. Com o pé DENTRO da caixa que rola, o botão `Criar` nascia
           abaixo da dobra — a pessoa preenchia tudo e não via como gravar.
           `.cu-balao` é coluna flexível justamente para isto: só a
           `.cu-rolagem` encolhe, e o pé fica onde a mão o procura. */
        <>
          <div className="cu-rolagem cu-regra-forma">
            <label className="cu-regra-campo">
              <span>Nome desta automação</span>
              <input
                className="cu-busca"
                value={rascunho.name}
                maxLength={80}
                placeholder="ex.: passa para o atendimento"
                onChange={(e) =>
                  setRascunho((a) => (a === null ? a : { ...a, name: e.target.value }))
                }
              />
            </label>

            {/* ─── QUANDO ─────────────────────────────────────────────────────
                A pergunta é uma só, e o `?` ao lado dela responde a única coisa
                que quem nunca criou uma automação não tem como saber: o que
                "chegar numa etapa" quer dizer. UMA FRASE — a F17.37 cortou treze
                parágrafos explicativos desta interface, e nenhum volta. */}
            <div className="cu-regra-bloco">
              <p className="cu-regra-titulo">
                <span>Quando</span>
                <Ajuda sobre="chegar numa etapa">
                  <p>
                    Uma tarefa chega numa etapa no instante em que alguém a arrasta para aquela
                    coluna do quadro — e é aí que a automação acontece.
                  </p>
                </Ajuda>
              </p>

              {/* DE ONDE, DENTRO DA FRASE. O nome da lista ficava só no título
                  da caixa, solto do texto — e era o *"não entendi a lógica"* do
                  usuário em uma linha. */}
              <label className="cu-regra-campo">
                <span>
                  uma tarefa chegar na lista <b className="cu-passo-nome">{lista.name}</b>, na etapa
                </span>
                <select
                  className="cu-mini-select"
                  value={rascunho.triggerStatusId}
                  aria-label="Etapa em que a tarefa chega"
                  onChange={(e) =>
                    setRascunho((a) => (a === null ? a : { ...a, triggerStatusId: e.target.value }))
                  }
                >
                  <option value="">escolha a etapa</option>
                  {etapas.map((s) => (
                    <option key={s.id ?? s.name} value={s.id ?? ''}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

            </div>

            {/* ─── ENTÃO ──────────────────────────────────────────────────── */}
            <div className="cu-regra-bloco">
              <p className="cu-regra-titulo">
                <span>Então</span>
              </p>

              <label className="cu-regra-campo">
                <span>a tarefa vai para a lista</span>
                <select
                  className="cu-mini-select"
                  value={rascunho.targetListId ?? ''}
                  aria-label="Lista para onde a tarefa vai"
                  onChange={(e) => escolherDestino(e.target.value)}
                >
                  <option value="">continua nesta lista</option>
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.caminho} / {d.name}
                    </option>
                  ))}
                </select>
              </label>

              {rascunho.targetListId !== null && (
                <label className="cu-regra-campo">
                  <span>e para na etapa</span>
                  <select
                    className="cu-mini-select"
                    value={rascunho.targetStatusId ?? ''}
                    aria-label="Etapa em que a tarefa para, na outra lista"
                    onChange={(e) =>
                      setRascunho((a) =>
                        a === null ? a : { ...a, targetStatusId: e.target.value || null },
                      )
                    }
                  >
                    <option value="">escolha a etapa</option>
                    {etapasDoDestino.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="cu-regra-campo">
                <span>e quem passa a cuidar dela é</span>
                <select
                  className="cu-mini-select"
                  value={rascunho.assigneeId ?? ''}
                  aria-label="Quem passa a cuidar da tarefa"
                  onChange={(e) =>
                    setRascunho((a) =>
                      a === null ? a : { ...a, assigneeId: e.target.value || null },
                    )
                  }
                >
                  <option value="">continua com quem já cuida</option>
                  {equipe.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* A REGRA PRONTA, ANTES DE GRAVAR — e no mesmo formato em que ela
                vai aparecer na lista depois. Quando ainda falta alguma coisa, no
                lugar dela aparece o que falta: as duas ocupam a mesma linha, e a
                caixa não pula de altura a cada escolha. */}
            {problema === null ? (
              <div className="cu-regra-previa">
                <p className="cu-regra-titulo">
                  <span>Vai ficar assim</span>
                </p>
                {emPassos(comoRegra(rascunho))}
              </div>
            ) : (
              <p className="cu-vazio">{problema}</p>
            )}

          </div>

          <div className="cu-esteira-pe">
            <button
              type="button"
              className="cu-ferramenta"
              onClick={() => {
                setRascunho(null);
                setEtapasDoDestino([]);
              }}
            >
              cancelar
            </button>
            <button
              type="button"
              className="o-btn o-btn-primario o-btn-sm"
              disabled={problema !== null || salvando}
              onClick={gravar}
            >
              {salvando ? 'salvando…' : rascunho.id === null ? 'Criar' : 'Guardar'}
            </button>
          </div>
        </>
      )}
    </Balao>
  );
}

/* ───────────────────────────── a barra ───────────────────────────── */

/**
 * O `···` DA LINHA, E A ÂNCORA QUE ELE DECLARA — F17.50.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO VIROU COMPONENTE, E POR QUE NO ESCOPO DO MÓDULO
 *
 *   Era uma função `acao()` dentro de `ArvoreDoQuadro`. Ela não podia guardar
 *   estado, e agora precisa: o botão tem de se dar a conhecer como ÂNCORA para
 *   os balões que nascem dele. Quem guarda estado mora fora, no módulo — é a
 *   regra do cabeçalho deste arquivo, e ela vale inteira aqui.
 *
 * O QUE A ÂNCORA PAGA
 *   Com ela, todo balão da árvore é desenhado em `document.body` (o modo
 *   flutuante da F17.24) em vez de dentro da linha. É o que permite à barra
 *   VOLTAR A ROLAR: balão dentro de caixa que rola sai decapitado, e era por
 *   isso que a barra tinha `overflow: visible` e crescia sem fim.
 *
 * ⚠️ `ref={setAncora}` E NÃO `useRef`: guardar num `ref` não redesenha, e o
 * balão nasceria sem saber onde se prender. É o mesmo padrão de `Ajuda`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function AcaoDaLinha({
  rotulo,
  aberto,
  aoAlternar,
  children,
}: {
  rotulo: string;
  aberto: boolean;
  aoAlternar: () => void;
  /** O balão. Só é desenhado quando `aberto`. */
  children: ReactNode;
}) {
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  return (
    <span className="cu-ancora cu-no-acao" data-fixo={aberto}>
      <button
        ref={setAncora}
        type="button"
        className="cu-icone-btn"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={aoAlternar}
      >
        <IconeMais />
      </button>
      {aberto && <ComAncora ancora={ancora}>{children}</ComAncora>}
    </span>
  );
}

type Aba = 'menu' | 'mover' | 'esteira' | 'automacoes' | 'aprovacao' | 'acesso' | 'clientes';
type Aberto = { chave: string; aba: Aba };
type Criando = { tipo: 'folder' | 'list'; spaceId: string; folderId: string | null };

export function ArvoreDoQuadro({
  arvore,
  companies,
  listaAtiva,
  espacoAtivo = null,
  pastaAtiva = null,
  mostrarArquivados,
  aoAlternarArquivados,
  aoEscolher,
  aoAbrirEspaco,
  aoAbrirPasta,
  aoAbrirCliente,
  aoRecarregar,
  aoRecusar,
  revelar = null,
  titulo = 'Espaços',
  leitura = 'pronta',
  podeMarcarCompartilhada = false,
}: {
  /**
   * Quem está na sessão ADMINISTRA — F38, Fase 7. Só então o menu da lista
   * sem cliente oferece ligar ou desligar a marca "exige cliente". O Worker
   * confere o papel de novo; esconder aqui é para não oferecer gesto que volta
   * 403. Ausente = não oferece.
   */
  podeMarcarCompartilhada?: boolean;
  /**
   * O nome da seção — F17.18.
   *
   * Ele passou a ser propriedade porque a árvore virou UMA seção da barra
   * lateral, e a barra chama essa seção de `Compartilhado comigo`, como a
   * referência do usuário. O padrão continua `Espaços` para quem usar a árvore
   * fora da barra.
   */
  titulo?: string;
  /** A árvore INTEIRA — inclusive o arquivado. Quem esconde é o interruptor. */
  arvore: readonly NoDeEspaco[];
  companies: readonly Empresa[];
  listaAtiva: string | null;
  /**
   * O espaço cuja VISÃO GERAL está aberta — F17.26.
   *
   * Sem isto, abrir a tela do espaço não acenderia linha nenhuma na árvore, e a
   * barra lateral ficaria dizendo que nada está aberto enquanto uma tela está.
   * É o mesmo `data-atual` da lista, no nível de cima.
   */
  espacoAtivo?: string | null;
  /**
   * A pasta cujo QUADRO está aberto — F17.64.
   *
   * O irmão de `espacoAtivo`, um nível abaixo. Sem ele, abrir o quadro da
   * pasta não acenderia linha nenhuma na árvore, e a barra lateral ficaria
   * dizendo que nada está aberto enquanto uma tela está.
   */
  pastaAtiva?: string | null;
  mostrarArquivados: boolean;
  aoAlternarArquivados: (mostrar: boolean) => void;
  aoEscolher: (listId: string) => void;
  /**
   * ABRIR A VISÃO GERAL DO ESPAÇO — F17.26.
   *
   * ⚠️ ATÉ AQUI, CLICAR NO NOME DO ESPAÇO SÓ SANFONAVA O GALHO. O usuário pediu
   * a tela: *"só de clicar no espaço, deve ficar visível tudo o que há nele"*.
   * Agora o NOME abre a tela e a SETINHA sanfona — que é a divisão do
   * explorador de arquivos, e a mesma que o ClickUp usa.
   *
   * É opcional porque a árvore precisa continuar montando fora do roteador: o
   * teste de desenho (`tela-da-arvore.test.ts`) a renderiza sem `BrowserRouter`,
   * e um `useNavigate` aqui dentro derrubaria a suíte inteira. Sem ela, o clique
   * no nome volta a sanfonar — o comportamento de antes, e não um botão morto.
   */
  aoAbrirEspaco?: (spaceId: string) => void;
  /**
   * ABRIR O QUADRO DA PASTA — F17.64.
   *
   * ⚠️ A MESMA SEPARAÇÃO QUE A F17.26 FEZ NO ESPAÇO, um nível abaixo: o NOME
   * abre o quadro da pasta, a SETINHA continua sanfonando o galho. O usuário
   * pediu com a captura do ClickUp: *"quando aperta em TIME HELENA não
   * aparece a tela geral (todos os clientes juntos, sabe?)"*.
   *
   * Opcional pela MESMA razão de `aoAbrirEspaco`: a árvore precisa continuar
   * montando fora do roteador — `tela-da-arvore.test.ts` a desenha sem
   * `BrowserRouter`, e um `useNavigate` aqui dentro derrubaria a suíte. Sem
   * ela, o clique no nome volta a sanfonar, que é o comportamento de antes e
   * não um botão morto.
   */
  aoAbrirPasta?: (folderId: string) => void;
  /**
   * ABRIR A FICHA DO CLIENTE DE UMA LISTA — F17.43.
   *
   * A lista trazida É a lista daquele cliente, e o caminho de volta para o
   * contrato, a cota e o nível de entrega é a ficha dele. Sem isto o vínculo
   * seria só um enfeite: a pessoa saberia de quem é a lista e continuaria
   * tendo que procurar o cliente pelo nome no painel.
   *
   * Opcional pela MESMA razão de `aoAbrirEspaco`: a árvore precisa continuar
   * montando fora do roteador — `tela-da-arvore.test.ts` a desenha sem
   * `BrowserRouter`, e um `useNavigate` aqui dentro derrubaria a suíte. Sem
   * ela, o vínculo continua aparecendo e nenhum botão morto nasce.
   */
  aoAbrirCliente?: (clientId: string) => void;
  /** Reler a árvore depois de escrever. A tela é a dona do estado. */
  aoRecarregar: () => Promise<unknown>;
  /** A frase do banco, inteira. Nulo limpa. */
  aoRecusar: (mensagem: string | null) => void;
  /**
   * O nó que a TRILHA acabou de pedir para mostrar — F17.25.
   *
   * Espaço e pasta não têm tela própria: o lugar deles é aqui. Quando alguém
   * clica num deles na trilha do topo, este pedido chega, o nó é trazido para a
   * vista e ganha um anel curto.
   *
   * ⚠️ O `n` NÃO É ENFEITE. Clicar duas vezes no MESMO degrau precisa mostrar o
   * nó duas vezes; com só a chave, o segundo clique não mudaria a propriedade e
   * o efeito não rodaria — o degrau pareceria morto na segunda vez.
   */
  revelar?: { chave: string; n: number } | null;
  /**
   * EM QUE PÉ ESTÁ A LEITURA DA ÁRVORE — F17.CARGA03.
   *
   * ⚠️ ELA DECIDE O QUE APARECE NO LUGAR DE UMA ÁRVORE VAZIA, e a distinção é o
   *   critério da fase: espera, falha e ausência de espaços não podem ser a
   *   mesma coisa na tela.
   *
   *     `carregando` → esqueleto. Nenhuma frase sobre alcance: ninguém
   *                    respondeu ainda, e afirmar falta de acesso antes de o
   *                    servidor falar foi o defeito que esta fase conserta.
   *     `recusada`   → nada aqui. A mensagem do servidor e o `Tentar de novo`
   *                    são de quem CHAMA — a barra e as três telas do quadro já
   *                    desenham a faixa de recusa, cada uma no seu lugar, e uma
   *                    segunda frase dentro da árvore diria a mesma coisa duas
   *                    vezes.
   *     `pronta`     → o comportamento de sempre. Vazio aqui é vazio de
   *                    verdade, e a frase de alcance é a resposta certa.
   *
   * ⚠️ O PADRÃO É `pronta`, E O PADRÃO IMPORTA. Quem monta esta peça sem dizer
   *   nada — a suíte de desenho, e qualquer tela que ainda não pense em estado
   *   de carga — continua vendo exatamente o que via. Um padrão `carregando`
   *   esconderia a frase de alcance de quem realmente não alcança nada.
   */
  leitura?: EstadoDaLeitura;
}) {
  /**
   * O QUE ESTÁ RECOLHIDO SOBREVIVE AO F5 — F17.24.
   *
   * Era `useState(new Set())`, e um F5 reabria a árvore inteira. Medido no
   * Chrome: recolher `Demandas`, apertar F5, `Demandas` volta aberto.
   *
   * Foi para o ARMAZENAMENTO DO NAVEGADOR, e não para o endereço, pela regra
   * da etapa: "quais pastas eu deixo abertas" é arrumação minha — colar isso
   * para outra pessoa não significaria nada, e ainda emporcalharia todo
   * endereço de lista com meia dúzia de identificadores.
   *
   * Guarda-se o RECOLHIDO, e não o aberto, para o padrão continuar sendo "tudo
   * aberto": espaço novo — criado por mim ou por outra pessoa — nasce à vista.
   */
  const [lugar, definirLugar] = useLugar();
  const recolhido = useMemo(() => new Set(lugar.arvore), [lugar.arvore]);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [criando, setCriando] = useState<Criando | null>(null);
  const [criandoEspaco, setCriandoEspaco] = useState(false);
  /* O `+` do cabeçalho, para o balão dele fugir do recorte da árvore — F17.50. */
  const [ancoraDoMais, setAncoraDoMais] = useState<HTMLElement | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [empresa, setEmpresa] = useState<string>('');
  /**
   * O molde de esteira escolhido na criação. F17.16.
   *
   * Um só estado para a lista e para o espaço porque nunca há dois em criação
   * ao mesmo tempo — `abrirCriacao` e o `+` do topo fecham um ao outro. Dois
   * estados dariam duas verdades sobre a mesma pergunta.
   */
  const [molde, setMolde] = useState<string>(HERDAR);
  /**
   * "Só quem eu escolher", marcado NA CRIAÇÃO — F17.23.
   *
   * O nó nasce aberto à empresa, como sempre nasceu e como o ClickUp faz. Este
   * interruptor não muda isso: ele diz que, assim que a pasta ou a lista
   * existir, ela é fechada pela MESMA escrita que a fecharia depois, e a caixa
   * de quem alcança abre em cima dela.
   *
   * Um caminho só, e não dois: fechar na criação por uma porta própria seria uma
   * segunda forma de escrever a mesma coisa — e a segunda é sempre a que fica
   * para trás.
   */
  const [fecharAoCriar, setFecharAoCriar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const arquivados = useMemo(() => contarArquivados(arvore), [arvore]);

  /**
   * As unidades que o "espaço novo" oferece — F31. Sem `Sem categoria`, e só
   * as que a pessoa alcança; ver `unidadesDoEspacoNovo`. Com uma só, o campo
   * nem aparece e o espaço nasce nela.
   */
  const unidades = useMemo(() => unidadesDoEspacoNovo(companies, arvore), [companies, arvore]);

  /**
   * A unidade que o seletor de "espaço novo" já vem marcando.
   *
   * A do primeiro espaço que a pessoa alcança é o palpite certo em quase todos
   * os casos — desde que ela esteja entre as oferecidas (F31: a linha técnica
   * `Sem categoria` nunca está).
   */
  const empresaPadrao = useMemo(() => {
    const oferecidas = new Set(unidades.map((u) => u.id));
    const primeira = arvore.find((e) => e.categoryId !== null && oferecidas.has(e.categoryId));
    return primeira?.categoryId ?? unidades[0]?.id ?? '';
  }, [arvore, unidades]);

  const visivel = (no: { live: boolean }) => mostrarArquivados || no.live;

  const alternar = (chave: string) =>
    definirLugar((l) => ({ ...l, arvore: alternarChave(l.arvore, chave) }));

  /**
   * TRAZER PARA A VISTA O NÓ QUE A TRILHA PEDIU — F17.25.
   *
   * Quem ABRE o nó é a trilha, escrevendo em `@/ui/lugar` antes de pedir; aqui
   * só se rola até ele e se acende o anel. A ordem importa: com a pasta ainda
   * recolhida, a linha dela existe, mas as listas de dentro não — e rolar até
   * uma linha que vai crescer no quadro seguinte deixa o nó fora da vista.
   * Por isso a busca acontece DEPOIS do redesenho, que é o que `useEffect`
   * garante.
   */
  const raizDaArvore = useRef<HTMLElement>(null);

  /**
   * A SEÇÃO DA BARRA, QUANDO A ÁRVORE MORA NELA — F29. Nula fora da barra (e
   * em `Somente ícones`): aí o título é só título e nada se recolhe. Ver
   * `@/board/secao-recolhivel`.
   */
  const secao = useContext(ContextoDaSecaoDaArvore);
  const secaoRecolhida = secao?.recolhida ?? false;
  /* A COLUNA PRÓPRIA — F29. Nula fora da barra e na gaveta: aí não há botão.
     Ver `@/board/secao-recolhivel`. */
  const coluna = useContext(ContextoDaColunaDaArvore);
  /* O último pedido da trilha já atendido — F29. Sem ele, recolher e reabrir a
     seção à mão reacenderia o nó que a trilha pediu minutos antes. */
  const jaRevelado = useRef<{ chave: string; n: number } | null>(null);
  /* O anel aceso agora, e o relógio que o apaga — F29 (Fase 4). Ver abaixo por
     que ele mora num `ref`, e não na limpeza do efeito. */
  const anelAceso = useRef<{ no: HTMLElement; relogio: number } | null>(null);

  useEffect(() => {
    if (revelar === null || revelar === jaRevelado.current) return;
    /* ⚠️ SEÇÃO RECOLHIDA NÃO PODE FAZER O DEGRAU DA TRILHA PARECER MORTO — F29.
       Com os itens guardados, o nó pedido não existe na página. Abre-se a
       seção, e este mesmo efeito roda de novo quando ela abrir
       (`secaoRecolhida` está nas dependências), agora achando o nó. */
    if (secaoRecolhida) {
      secao?.alternar();
      return;
    }
    const no = raizDaArvore.current?.querySelector<HTMLElement>(
      `[data-no="${CSS.escape(revelar.chave)}"]`,
    );
    if (!no) return;
    jaRevelado.current = revelar;
    no.scrollIntoView({ block: 'nearest' });
    /* ⚠️ O ANEL NÃO É APAGADO NA LIMPEZA DO EFEITO — F29 (Fase 4), MEDIDO.
       Era: `return () => { clearTimeout; delete revelado }`. Com a barra em
       `Somente ícones`, o degrau da trilha expande a barra e a árvore MONTA já
       com o pedido (ver `usePedidoDeRevelar`). Em StrictMode a montagem roda o
       efeito, a limpeza e o efeito de novo: a limpeza apagava o anel, e a
       segunda rodada via o pedido como já atendido (`jaRevelado`) e não o
       reacendia — no Chrome, a barra expandia e nenhum nó acendia. Então o
       anel anterior é apagado aqui, por quem acende o próximo, e o relógio
       apaga o último; a limpeza não mexe nele. Depois de desmontar, o
       relógio só tira um atributo de um nó fora da página. */
    if (anelAceso.current) {
      window.clearTimeout(anelAceso.current.relogio);
      delete anelAceso.current.no.dataset.revelado;
    }
    no.dataset.revelado = 'true';
    // O anel some sozinho. O tempo é o da animação em `interacao.css` — se
    // ficasse, a árvore acumularia nós acesos a cada clique na trilha.
    const relogio = window.setTimeout(() => {
      delete no.dataset.revelado;
      if (anelAceso.current?.no === no) anelAceso.current = null;
    }, 1700);
    anelAceso.current = { no, relogio };
    // `secao` fica de fora de propósito: o objeto é refeito a cada desenho da
    // barra, e só a mudança de `secaoRecolhida` pede uma nova tentativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revelar, secaoRecolhida]);

  const fechar = () => {
    setAberto(null);
    setRenomeando(null);
    setCriando(null);
    setCriandoEspaco(false);
    setRascunho('');
    setMolde(HERDAR);
  };

  /**
   * Escrever, reler e mostrar a recusa.
   *
   * RELER SEMPRE, mesmo no sucesso: mover uma lista muda a esteira resolvida
   * dela, arquivar um espaço tira listas da árvore inteira, e criar espaço cria
   * junto a esteira padrão. A tela não tem como saber nada disso sem perguntar
   * — e refazer a conta aqui seria a segunda verdade.
   */
  const agir = async <T,>(fn: () => Promise<T>): Promise<Feito<T>> => {
    if (salvando) return NEGADO;
    setSalvando(true);
    aoRecusar(null);
    try {
      const valor = await fn();
      await aoRecarregar();
      return { ok: true, valor };
    } catch (e) {
      // ⚠️ UMA RECUSA NÃO VIRA FAIXA: a que a caixa da esteira transforma em
      // PERGUNTA (F17.19). Ela chega com a lista de etapas sem destino, e a
      // caixa já desenhou o seletor — repetir a frase em vermelho no topo faria
      // parecer que algo quebrou no exato momento em que a tela está esperando
      // uma resposta.
      const virouPergunta = e instanceof ApiError && (e.semDestino?.length ?? 0) > 0;
      // A frase do banco, INTEIRA. Ver o cabeçalho.
      aoRecusar(
        virouPergunta
          ? null
          : e instanceof ApiError
            ? e.message
            : 'Não foi possível concluir.',
      );
      return NEGADO;
    } finally {
      setSalvando(false);
    }
  };

  const renomear = (chave: string, nomeAtual: string) => {
    setAberto(null);
    setRenomeando(chave);
    setRascunho(nomeAtual);
  };

  const confirmarRenome = (executar: (nome: string) => Promise<unknown>) => {
    const nome = rascunho.trim();
    if (nome === '' || renomeando === null) {
      fechar();
      return;
    }
    setRenomeando(null);
    void agir(() => executar(nome)).then(() => fechar());
  };

  const abrirCriacao = (c: Criando) => {
    setAberto(null);
    setCriando(c);
    setRascunho('');
    // Herdar é o padrão de hoje, e continua sendo. Só quem escolhe um molde
    // ganha esteira própria — ver `server/tree.ts`.
    setMolde(HERDAR);
    // Aberto é o padrão, e cada criação recomeça nele.
    setFecharAoCriar(false);
    // Criar dentro de um nó recolhido esconderia o campo que acabou de nascer.
    // Abrir o pai é o mínimo para o gesto fazer sentido.
    definirLugar((l) => {
      const fora = new Set([`space:${c.spaceId}`, ...(c.folderId ? [`folder:${c.folderId}`] : [])]);
      const proxima = l.arvore.filter((chave) => !fora.has(chave));
      return proxima.length === l.arvore.length ? l : { ...l, arvore: proxima };
    });
  };

  const confirmarCriacao = () => {
    const nome = rascunho.trim();
    if (criando === null || nome === '') {
      fechar();
      return;
    }
    const { tipo, spaceId, folderId } = criando;
    const fechando = fecharAoCriar;
    setCriando(null);

    /**
     * Fechar o nó recém-criado e abrir a caixa de quem alcança.
     *
     * A escrita é a MESMA de "Quem alcança…" no menu — `set_node_access` com a
     * lista vazia —, e é ela que põe quem fechou na lista com o nível de
     * administrar. Por isso a tela não precisa saber disso: ela relê.
     */
    const fecharNoNovo = async (nivel: 'folder' | 'list', id: string) => {
      const feito = await agir(() =>
        api.salvarAcessoDoNo(nivel, id, { restricted: true, grants: [] }),
      );
      if (feito.ok) setAberto({ chave: `${nivel}:${id}`, aba: 'acesso' });
    };

    void (async () => {
      if (tipo === 'folder') {
        const criada = await agir(() => api.criarPasta(spaceId, nome));
        fechar();
        if (criada.ok && fechando) await fecharNoNovo('folder', criada.valor.folder.id);
        return;
      }
      // O molde vira ESTEIRA PRÓPRIA da lista, criada na mesma transação do
      // `insert`. Sem molde, `esteira` vai nula e a lista herda — que é o que
      // acontecia antes desta etapa.
      const escolhido = moldePorChave(molde);
      const feito = await agir(() =>
        api.criarLista(spaceId, {
          name: nome,
          folderId,
          esteira: escolhido && { name: escolhido.nome, statuses: escolhido.statuses },
        }),
      );
      fechar();
      // A LISTA NOVA ABRE. É o que o ClickUp faz, e é o que dá sentido ao gesto:
      // quem cria uma lista criou-a para pôr algo nela. Pasta não abre nada —
      // pasta não tem quadro.
      if (feito.ok) aoEscolher(feito.valor.list.id);
      if (feito.ok && fechando) await fecharNoNovo('list', feito.valor.list.id);
    })();
  };

  const criarEspaco = () => {
    if (rascunho.trim() === '' || empresa === '') return;
    // ⚠️ ESPAÇO SEM ESTEIRA NASCE MORTO: a primeira lista dentro dele abriria um
    // quadro sem coluna nenhuma. Por isso não há `Herdar` aqui — o espaço é a
    // raiz da herança, não tem de quem herdar — e a falta de escolha cai na
    // esteira simples, que é a de hoje. O Worker confere isso de novo.
    const escolhido = moldePorChave(molde) ?? moldePorChave('simples');
    void agir(() =>
      api.criarEspaco(
        empresa,
        rascunho.trim(),
        escolhido ? { name: escolhido.nome, statuses: escolhido.statuses } : undefined,
      ),
    ).then((feito) => {
      if (feito.ok) fechar();
    });
  };

  /* --- os menus (funções, nunca componentes: ver o cabeçalho) -------------- */

  const menuDoEspaco = (espaco: NoDeEspaco): ReactNode => (
    <Balao lado="baixo-direita" aoFechar={() => setAberto(null)} rotulo="Espaço">
      <ItemDeMenu aoEscolher={() => renomear(`space:${espaco.id}`, espaco.name)}>
        <IconeListaMarcada />
        Renomear
      </ItemDeMenu>
      <ItemDeMenu
        aoEscolher={() => abrirCriacao({ tipo: 'folder', spaceId: espaco.id, folderId: null })}
      >
        <IconePasta />
        Nova pasta
      </ItemDeMenu>
      <ItemDeMenu
        aoEscolher={() => abrirCriacao({ tipo: 'list', spaceId: espaco.id, folderId: null })}
      >
        <IconeListaMarcada />
        Nova lista
      </ItemDeMenu>
      {/* AO LADO DE `Nova lista`, E NÃO NUMA TELA PRÓPRIA — F17.43. É a mesma
          coisa que `Nova lista` faz, vezes o número de clientes escolhidos, e
          com o vínculo junto. O lugar de um atalho é ao lado do gesto longo
          que ele encurta. */}
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `space:${espaco.id}`, aba: 'clientes' })}>
        <IconeCliente />
        Trazer clientes…
      </ItemDeMenu>
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `space:${espaco.id}`, aba: 'acesso' })}>
        <IconePessoa />
        Quem alcança…
      </ItemDeMenu>
      <Separador />
      <ItemDeMenu
        desativado={salvando}
        aoEscolher={() => {
          setAberto(null);
          void agir(() => api.editarEspaco(espaco.id, { archived: espaco.archivedAt === null }));
        }}
      >
        <IconeArquivo />
        {espaco.archivedAt === null ? 'Arquivar' : 'Desarquivar'}
      </ItemDeMenu>
    </Balao>
  );

  const menuDaPasta = (pasta: NoDePasta): ReactNode => (
    <Balao lado="baixo-direita" aoFechar={() => setAberto(null)} rotulo="Pasta">
      <ItemDeMenu aoEscolher={() => renomear(`folder:${pasta.id}`, pasta.name)}>
        <IconePasta />
        Renomear
      </ItemDeMenu>
      <ItemDeMenu
        aoEscolher={() =>
          abrirCriacao({ tipo: 'list', spaceId: pasta.spaceId, folderId: pasta.id })
        }
      >
        <IconeListaMarcada />
        Nova lista
      </ItemDeMenu>
      {/* Na PASTA também: é ali que a barra da Helena põe os clientes dela —
          `TIME HELENA` é uma pasta, e as listas de dentro são os clientes. */}
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `folder:${pasta.id}`, aba: 'clientes' })}>
        <IconeCliente />
        Trazer clientes…
      </ItemDeMenu>
      <ItemDeMenu desativado={salvando} aoEscolher={() => setAberto({ chave: `folder:${pasta.id}`, aba: 'esteira' })}>
        <IconeListaMarcada />
        Esteira da pasta…
      </ItemDeMenu>
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `folder:${pasta.id}`, aba: 'acesso' })}>
        <IconePessoa />
        Quem alcança…
      </ItemDeMenu>
      <Separador />
      <ItemDeMenu
        desativado={salvando}
        aoEscolher={() => {
          setAberto(null);
          void agir(() => api.editarPasta(pasta.id, { archived: pasta.archivedAt === null }));
        }}
      >
        <IconeArquivo />
        {pasta.archivedAt === null ? 'Arquivar' : 'Desarquivar'}
      </ItemDeMenu>
    </Balao>
  );

  const menuDaLista = (lista: NoDeLista): ReactNode => (
    <Balao lado="baixo-direita" aoFechar={() => setAberto(null)} rotulo="Lista">
      <ItemDeMenu aoEscolher={() => renomear(`list:${lista.id}`, lista.name)}>
        <IconeListaMarcada />
        Renomear
      </ItemDeMenu>
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `list:${lista.id}`, aba: 'mover' })}>
        <IconePasta />
        Mover para…
      </ItemDeMenu>
      {lista.folderId !== null && lista.live && (
        <>
          <Separador />
          {([
            ['up', 'Mover para cima'],
            ['down', 'Mover para baixo'],
            ['first', 'Mover para o início'],
            ['last', 'Mover para o final'],
          ] as const).map(([direction, label]) => {
            const irmas = arvore.find((e) => e.id === lista.spaceId)?.folders
              .find((p) => p.id === lista.folderId)?.lists.filter((l) => l.archivedAt === null) ?? [];
            const index = irmas.findIndex((l) => l.id === lista.id);
            const limite = direction === 'up' || direction === 'first' ? index <= 0 : index === irmas.length - 1;
            return (
              <ItemDeMenu key={direction} desativado={salvando || limite}
                aoEscolher={() => {
                  setAberto(null);
                  void agir(() => api.reordenarLista(lista.id, direction));
                }}>
                <span aria-hidden="true">{direction === 'up' || direction === 'first' ? '↑' : '↓'}</span>
                {label}
              </ItemDeMenu>
            );
          })}
          <Separador />
        </>
      )}
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `list:${lista.id}`, aba: 'esteira' })}>
        <span className="cu-ponto" aria-hidden="true" />
        Esteira…
      </ItemDeMenu>
      {/* AO LADO DA ESTEIRA, E NÃO NUMA TELA PRÓPRIA — F17.41. A regra é da
          ETAPA, e a etapa se edita aqui: uma tela separada obrigaria a pessoa a
          lembrar o nome da etapa que acabou de criar noutro lugar. */}
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `list:${lista.id}`, aba: 'automacoes' })}>
        <span className="cu-ponto" aria-hidden="true" />
        Automações…
      </ItemDeMenu>
      {/* A APROVAÇÃO DO CLIENTE — F42, Fase 3. Também da esteira: para onde o
          card vai quando a equipe solicita e quando o cliente responde. */}
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `list:${lista.id}`, aba: 'aprovacao' })}>
        <span className="cu-ponto" aria-hidden="true" />
        Aprovação do cliente…
      </ItemDeMenu>
      <ItemDeMenu aoEscolher={() => setAberto({ chave: `list:${lista.id}`, aba: 'acesso' })}>
        <IconePessoa />
        Quem alcança…
      </ItemDeMenu>
      {/*
        A MARCA "EXIGE CLIENTE" — F38, Fase 7. Só em lista SEM cliente (a de
        cliente já dá o cliente à tarefa) e só para quem administra. Marcada,
        a lista é COMPARTILHADA: toda tarefa nova dela escolhe o cliente. O
        `✓` do item mostra o estado; o clique alterna.
      */}
      {podeMarcarCompartilhada && lista.clientId === null && (
        <ItemDeMenu
          marcado={lista.requiresClient}
          desativado={salvando}
          aoEscolher={() => {
            setAberto(null);
            void agir(() => api.editarLista(lista.id, { requiresClient: !lista.requiresClient }));
          }}
        >
          <IconeCliente />
          Exige cliente em toda tarefa
        </ItemDeMenu>
      )}
      {/*
        DE QUE CLIENTE É ESTA LISTA, E O CAMINHO ATÉ ELE — F17.43.

        Só aparece quando há vínculo E quando há para onde ir. `clientName` vem
        nulo para quem alcança a lista mas não alcança o cliente: nesse caso não
        há nome para escrever nem ficha para abrir, e um item que dissesse
        "Ficha do cliente" levando a um 404 seria pior do que item nenhum.
      */}
      {listaLevaAFicha(lista) && aoAbrirCliente && (
        <ItemDeMenu
          aoEscolher={() => {
            setAberto(null);
            aoAbrirCliente(lista.clientId);
          }}
        >
          <IconeCliente />
          Ficha de {lista.clientName}
        </ItemDeMenu>
      )}
      <Separador />
      <ItemDeMenu
        desativado={salvando}
        aoEscolher={() => {
          setAberto(null);
          void agir(() => api.editarLista(lista.id, { archived: lista.archivedAt === null }));
        }}
      >
        <IconeArquivo />
        {lista.archivedAt === null ? 'Arquivar' : 'Desarquivar'}
      </ItemDeMenu>
      {/* EXCLUIR SÓ APARECE NA ARQUIVADA: arquivar é o passo que se desfaz, e
          excluir é o depois — quando a lista ficou parada e ninguém a quer. */}
      {lista.archivedAt !== null && (
        <ItemDeMenu
          desativado={salvando}
          aoEscolher={() => {
            setAberto(null);
            const tarefas = lista.totalTasks;
            const aviso =
              tarefas > 0
                ? `Excluir a lista "${lista.name}" e as ${tarefas} tarefa(s) dela? Isso não pode ser desfeito.`
                : `Excluir a lista "${lista.name}"? Isso não pode ser desfeito.`;
            if (!window.confirm(aviso)) return;
            void agir(() => api.excluirLista(lista.id));
          }}
        >
          <IconeLixeira className="h-3.5 w-3.5" />
          Excluir lista
        </ItemDeMenu>
      )}
    </Balao>
  );

  /**
   * Mover a lista.
   *
   * ⚠️ AS DUAS COLUNAS VÃO JUNTAS. `lists_folder_same_space_fk` é chave composta
   * `(folder_id, space_id)`: o destino manda o par inteiro, sempre. Com pasta
   * nula a chave fica satisfeita por definição, e a lista fica solta no espaço.
   *
   * Mover entre ESPAÇOS pode ser recusado por dois gatilhos — o de etiqueta
   * (F17.4b) e o de esteira (F17.3c). As frases deles nomeiam o que está no
   * caminho, e é isso que aparece na tela.
   */
  const menuDeMover = (lista: NoDeLista): ReactNode => {
    const destinos = destinosDeLista(arvore, lista);
    return (
      <Balao lado="baixo-direita" aoFechar={() => setAberto(null)} rotulo="Mover a lista para">
        <div className="cu-rolagem">
          {destinos.length === 0 && <p className="cu-vazio">Nenhum destino ao seu alcance.</p>}
          {destinos.map((d) => (
            <ItemDeMenu
              key={d.chave}
              marcado={d.atual}
              desativado={d.atual || salvando}
              aoEscolher={() => {
                setAberto(null);
                void agir(() =>
                  api.editarLista(lista.id, { spaceId: d.spaceId, folderId: d.folderId }),
                );
              }}
            >
              {d.pasta === null ? <MarcaDoEspaco nome={d.espaco} cor={null} /> : <IconePasta />}
              <span className="rotulo" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.pasta === null ? `${d.espaco} · solta no espaço` : `${d.espaco} / ${d.pasta}`}
              </span>
            </ItemDeMenu>
          ))}
        </div>
        {/* TRÊS LINHAS VIRARAM UMA E UM `?` — F17.24.
            O aviso é de CONSEQUÊNCIA e por isso não sumiu; mas dentro de um
            balão de 13rem ele quebrava em quatro linhas de cinco palavras, e
            quem só queria mover uma lista lia um parágrafo sobre etiquetas. */}
        <p className="cu-vazio cu-com-ajuda">
          <span>Mudar de espaço pode ser recusado.</span>
          <Ajuda sobre="a recusa ao mudar de espaço" lado="cima-direita">
            <p>Acontece em dois casos:</p>
            <ul className="cu-lista-simples">
              <li>alguma tarefa da lista carrega etiqueta de outro espaço;</li>
              <li>a esteira do destino não tem o status de alguma tarefa.</li>
            </ul>
            <p>Nos dois, a recusa diz qual tarefa está no caminho.</p>
          </Ajuda>
        </p>
      </Balao>
    );
  };

  /* --- as linhas ---------------------------------------------------------- */

  /** A seta de expandir. `▶` recolhida, `▼` aberta — como na referência. */
  const seta = (chave: string, rotulo: string, abertoNo: boolean): ReactNode => (
    <button
      type="button"
      className="cu-caret"
      aria-expanded={abertoNo}
      aria-label={`${abertoNo ? 'Recolher' : 'Expandir'} ${rotulo}`}
      data-aberto={abertoNo}
      onClick={() => alternar(chave)}
      // As setas do teclado abrem e fecham o galho — o mesmo gesto do arquivo de
      // pastas de qualquer sistema. Não conflita com as setas ← → do quadro:
      // elas só valem com um CARTÃO em foco, e cartão não vive aqui.
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' && !abertoNo) {
          e.preventDefault();
          alternar(chave);
        }
        if (e.key === 'ArrowLeft' && abertoNo) {
          e.preventDefault();
          alternar(chave);
        }
      }}
    >
      <IconeSeta c="h-3 w-3" />
    </button>
  );

  /** O `···` da linha. Aparece ao passar o mouse — e fica quando o menu abre. */
  const acao = (chave: string, rotulo: string, balao: ReactNode): ReactNode => (
    <AcaoDaLinha
      /* ⚠️ A CHAVE É A DA LINHA, e não `undefined`. Sem ela, o React reaproveita
         o `AcaoDaLinha` de uma linha para outra quando a árvore se reordena — e
         a âncora guardada apontaria para o `···` de outra lista. */
      key={`acao:${chave}`}
      rotulo={rotulo}
      aberto={aberto?.chave === chave}
      aoAlternar={() => setAberto((a) => (a?.chave === chave ? null : { chave, aba: 'menu' }))}
    >
      {balao}
    </AcaoDaLinha>
  );

  const linhaDeLista = (lista: NoDeLista, nivel: 1 | 2): ReactNode => {
    const chave = `list:${lista.id}`;
    const balao =
      aberto?.chave === chave && aberto.aba === 'acesso' ? (
        <CaixaDeAcesso
          no={{ nivel: 'list', id: lista.id }}
          salvando={salvando}
          aoFechar={() => setAberto(null)}
          aoAgir={agir}
        />
      ) : aberto?.chave === chave && aberto.aba === 'mover'
        ? menuDeMover(lista)
        : aberto?.chave === chave && aberto.aba === 'esteira'
          ? (
              <CaixaDaEsteira
                lista={lista}
                salvando={salvando}
                aoFechar={() => setAberto(null)}
                aoAgir={agir}
              />
            )
          : aberto?.chave === chave && aberto.aba === 'aprovacao'
            ? <CaixaDaAprovacao listId={lista.id} aoFechar={() => setAberto(null)} />
          : aberto?.chave === chave && aberto.aba === 'automacoes'
            ? (
                <CaixaDasAutomacoes
                  lista={lista}
                  arvore={arvore}
                  salvando={salvando}
                  aoFechar={() => setAberto(null)}
                  aoAgir={agir}
                />
              )
            : menuDaLista(lista);

    return (
      <div
        key={lista.id}
        className="cu-no"
        data-nivel={nivel}
        data-atual={lista.id === listaAtiva}
        data-morto={!lista.live}
      >
        <span className="cu-caret" aria-hidden="true" />
        {renomeando === chave ? (
          <CampoDaLinha
            valor={rascunho}
            convite="Nome da lista"
            rotulo="Renomear a lista"
            salvando={salvando}
            aoMudar={setRascunho}
            aoCancelar={fechar}
            aoConfirmar={() =>
              confirmarRenome((nome) => api.editarLista(lista.id, { name: nome }))
            }
          />
        ) : (
          <button type="button" className="cu-no-alvo" onClick={() => aoEscolher(lista.id)}>
            <IconeListaMarcada c="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="cu-no-nome">{lista.name}</span>
            {lista.archivedAt !== null && <span className="cu-selo-morto">arquivada</span>}
            {/*
              UM NÚMERO, E ELE É O QUE ESTÁ EM ABERTO — F28.

              Era `1/1144`: em aberto e total na mesma coluna em que a pasta
              escreve quantas LISTAS tem. Três sentidos para um número só, e
              nenhum dito sem passar o mouse. O que a pessoa procura na barra é
              onde há trabalho, então fica o `liveTasks`, e ZERO NÃO SE ESCREVE:
              a coluna só acende onde há o que fazer, e o olho acha isso sem ler.

              O total não sumiu: está no `title` e no nome acessível, por
              extenso. O número visível é `aria-hidden` porque a frase abaixo
              já o diz — sem isso, o leitor de tela leria "1" e depois "1 em
              aberto".

              ⚠️ O `span` FICA MESMO VAZIO. `.cu-no-contagem` é como as provas
              de navegador reconhecem a linha de LISTA (ver
              `scripts/provar-a-barra-que-rola.mjs`); some o número, não a peça.

              (F17.37: nada de `opacity` aqui — `--mute` já é o tom mais
              discreto que passa na régua de contraste.)
            */}
            <span
              className="cu-no-contagem"
              title={`${lista.liveTasks} em aberto · ${lista.totalTasks} no total`}
              aria-hidden="true"
            >
              {lista.liveTasks > 0 ? lista.liveTasks : null}
            </span>
            <span className="sr-only">
              {`${lista.liveTasks} em aberto · ${lista.totalTasks} no total`}
            </span>
          </button>
        )}
        {/*
          O SINAL DO VÍNCULO, E ELE É O PRÓPRIO CAMINHO — F17.43.

          Fica FORA do `cu-no-alvo` porque `cu-no-alvo` já é um botão, e botão
          dentro de botão não é HTML válido — o navegador desfaz o aninhamento
          e o clique de dentro nunca chega.

          O nome do cliente não é repetido ao lado do nome da lista: a lista
          trazida NASCE com o nome dele, e escrever `Jatobá  Jatobá` numa
          barra de 15rem gastaria a largura para não dizer nada. Quem quer o
          nome escrito tem o `···`, que abre `Ficha de Jatobá`.

          O sinal é POR LISTA. Duas do mesmo cliente mostram nas duas —
          unicidade nunca esteve neste desenho, e `listaLevaAFicha` não a
          inventa.

          "DO CLIENTE" NO RÓTULO — F28. Aqui a maleta é só ícone, e a lista
          trazida tem o NOME do cliente: `Ficha de Jatobá` sobre a linha
          `Jatobá` podia ser lida como a ficha da própria lista. No
          cabeçalho da lista e na visão do espaço o nome vem escrito ao lado
          do ícone (`SinalDoClienteDaLista`), e lá a frase curta basta.
        */}
        {listaLevaAFicha(lista) && aoAbrirCliente && (
          <button
            type="button"
            className="cu-icone-btn"
            title={`Abrir a ficha do cliente ${lista.clientName}`}
            aria-label={`Abrir a ficha do cliente ${lista.clientName}`}
            onClick={() => aoAbrirCliente(lista.clientId)}
          >
            <IconeCliente c="h-3.5 w-3.5" />
          </button>
        )}
        {acao(chave, `Ações de ${lista.name}`, balao)}
      </div>
    );
  };

  const campoNovo = (nivel: 1 | 2, tipo: 'folder' | 'list'): ReactNode => (
    <>
      <div className="cu-no" data-nivel={nivel}>
        <span className="cu-caret" aria-hidden="true" />
        <span className="cu-no-alvo" data-campo="1">
          {tipo === 'folder' ? (
            <IconePasta c="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <IconeListaMarcada c="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
          <CampoDaLinha
            valor={rascunho}
            convite={tipo === 'folder' ? 'Nome da pasta' : 'Nome da lista'}
            rotulo={tipo === 'folder' ? 'Nome da pasta nova' : 'Nome da lista nova'}
            salvando={salvando}
            aoMudar={setRascunho}
            aoCancelar={fechar}
            aoConfirmar={confirmarCriacao}
          />
        </span>
      </div>

      {/*
        AS ETAPAS, PERGUNTADAS AQUI — F17.16.

        Só para LISTA. A pasta não tem quadro e nunca resolveu esteira nenhuma
        pela tela; oferecer molde nela seria oferecer uma escolha sem efeito
        visível, que é a definição de botão morto.
      */}
      {tipo === 'list' && (
        <div className={nivel === 2 ? 'cu-recuo-2' : 'cu-recuo-1'}>
          <SeletorDeMolde
            valor={molde}
            comHerdar
            desativado={salvando}
            aoEscolher={setMolde}
          />
        </div>
      )}

      {/*
        QUEM ALCANÇA, PERGUNTADO NA CRIAÇÃO — F17.23.

        Vale para pasta e para lista. Desmarcado é o comportamento de sempre:
        nasce aberto à empresa. Marcado, o nó é fechado pela mesma escrita do
        menu, e a caixa de quem alcança abre logo em cima dele.
      */}
      <div className={nivel === 2 ? 'cu-recuo-2' : 'cu-recuo-1'}>
        <label className="cu-destino">
          <input
            type="checkbox"
            checked={fecharAoCriar}
            disabled={salvando}
            onChange={(e) => setFecharAoCriar(e.target.checked)}
          />
          <span>Só quem eu escolher</span>
        </label>
      </div>
    </>
  );

  /* --- desenho ------------------------------------------------------------ */

  const espacos = arvore.filter(visivel);
  /* Os homônimos se contam entre os espaços À VISTA: um `Demandas` arquivado
     e escondido não confunde ninguém. Ver `espacosHomonimos`. */
  const homonimos = espacosHomonimos(espacos);

  /* `aria-busy` só na PRIMEIRA carga: numa revalidação a árvore de antes
     continua ali, legível e navegável, e marcar a caixa como ocupada faria um
     leitor de tela silenciar o que a pessoa está lendo. */
  const esperandoAPrimeira = espacos.length === 0 && leitura === 'carregando';

  return (
    <aside
      ref={raizDaArvore}
      className="o-card q-barra cu-arvore p-2"
      aria-busy={esperandoAPrimeira}
      data-recolhida={secaoRecolhida || undefined}
    >
      <header className="cu-arvore-topo">
        {/* O TÍTULO RECOLHE A SEÇÃO — F29, o mesmo botão das outras seções da
            barra (`.bl-secao-alternar`). O `+` ao lado continua sendo outro
            botão, irmão deste, e não filho: um botão dentro do outro não é
            HTML válido, e o clique no `+` recolheria a árvore junto. */}
        {secao ? (
          <h2 className="eyebrow">
            <button
              type="button"
              className="bl-secao-alternar"
              aria-expanded={!secaoRecolhida}
              aria-controls={secao.idDosItens}
              onClick={secao.alternar}
            >
              {/* F29: a seta é desenho, e quem a gira é a folha, lendo o
                  `aria-expanded` deste botão — um estado só, dito uma vez. */}
              <IconeChevron className="bl-seta" />
              {titulo}
            </button>
          </h2>
        ) : (
          /* `tabIndex={-1}` — F29: na coluna própria o título não é botão, e é
             para ele que o foco vai quando o ícone único de `Somente ícones`
             expande a barra (ver `focarOTituloDaArvore` em `BarraLateral`).
             Menos um, e não zero: ele recebe o foco pelo código, e a
             tabulação continua passando só pelo que se aperta. */
          <h2 className="eyebrow" tabIndex={-1}>{titulo}</h2>
        )}
        {/* SOLTAR A ÁRVORE NUMA COLUNA — F29. Irmão do título e do `+`, pelo
            mesmo motivo do `+`: botão dentro de botão não é HTML válido, e o
            clique aqui recolheria a seção junto. O nome diz o que o clique FAZ
            (abrir ou devolver), e o `aria-pressed` diz o estado. */}
        {coluna && (
          <button
            type="button"
            className="cu-icone-btn bl-soltar-arvore"
            aria-pressed={coluna.ligada}
            aria-label={coluna.ligada ? 'Devolver a árvore para a barra' : 'Abrir a árvore numa coluna'}
            title={coluna.ligada ? 'Devolver a árvore para a barra' : 'Abrir a árvore numa coluna'}
            onClick={coluna.alternar}
          >
            <IconeColuna className="h-3.5 w-3.5" />
          </button>
        )}
        {/* O `+` do topo declara a própria âncora pelo mesmo motivo do `···`:
            a árvore rola, e balão dentro de caixa que rola sai decapitado. */}
        <span className="cu-ancora">
          <button
            ref={setAncoraDoMais}
            type="button"
            className="cu-icone-btn cu-mais"
            aria-label="Novo espaço"
            title="Novo espaço"
            aria-haspopup="menu"
            aria-expanded={criandoEspaco}
            onClick={() => {
              setCriandoEspaco((v) => !v);
              setRascunho('');
              setEmpresa(empresaPadrao);
            }}
          >
            +
          </button>

          {criandoEspaco && (
            <Balao
              lado="baixo-direita"
              ancora={ancoraDoMais}
              aoFechar={() => setCriandoEspaco(false)}
              rotulo="Espaço novo"
            >
              {unidades.length === 0 && (
                <p className="cu-vazio">Nenhuma unidade cadastrada para o espaço nascer nela.</p>
              )}

              {/* A UNIDADE SÓ É PERGUNTADA QUANDO HÁ ESCOLHA — F31. Ver
                  `CampoDaUnidade`. */}
              <CampoDaUnidade unidades={unidades} valor={empresa} aoMudar={setEmpresa} />

              <input
                className="cu-busca"
                data-foco="1"
                value={rascunho}
                maxLength={120}
                placeholder="Nome do espaço"
                aria-label="Nome do espaço novo"
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  criarEspaco();
                }}
              />

              {/*
                AS ETAPAS DO ESPAÇO — F17.16. Sem `Herdar`: o espaço é a raiz da
                herança, não tem de quem herdar, e sem esteira ele nasce morto.
              */}
              <SeletorDeMolde
                valor={molde === HERDAR ? 'simples' : molde}
                comHerdar={false}
                desativado={salvando}
                aoEscolher={setMolde}
              />

              <div className="cu-esteira-pe">
                <button
                  type="button"
                  className="o-btn o-btn-primario o-btn-sm"
                  disabled={salvando || rascunho.trim() === '' || empresa === ''}
                  onClick={criarEspaco}
                >
                  {salvando ? 'criando…' : 'Criar espaço'}
                </button>
              </div>

              {/* A política continua DITA, e não escondida num botão que some
                  (ver o cabeçalho) — mas agora em uma linha e um `?`. F17.24:
                  as três frases descreviam quem-pode-o-quê num balão estreito,
                  e quem só queria criar um espaço lia o regulamento. */}
              <p className="cu-vazio cu-com-ajuda">
                <span>Só administrador cria espaço.</span>
                <Ajuda sobre="quem cria o quê" lado="cima-direita">
                  <p>
                    Espaço é estrutural, e por isso só quem administra o sistema cria. Pasta e
                    lista são de quem alcança o espaço.
                  </p>
                  <p>
                    Toda lista dentro dele herda estas etapas — e cada uma pode trocar as suas
                    depois, no <b>···</b> → <i>Esteira…</i>.
                  </p>
                </Ajuda>
              </p>
            </Balao>
          )}
        </span>
        {/* RECOLHER AS LISTAS — F02B (R08). Só na coluna: o `«` dela, o mesmo
            desenho do `«` do menu no alto da barra, cada coluna com o seu.
            Não é o botão de encaixar (ícone de três faixas, ao lado): aquele
            muda onde a árvore mora; este a tira da tela, e a barra mostra o
            caminho de volta. Por último no cabeçalho, como o do menu. */}
        {coluna?.recolher && (
          <button
            type="button"
            className="cu-icone-btn bl-recolher-listas"
            aria-label="Recolher listas"
            title="Recolher listas"
            aria-expanded
            aria-controls="bl-coluna-listas"
            onClick={coluna.recolher}
          >
            <IconeRecolher className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      {/* A CAIXA DOS ITENS — F29. Sempre desenhada, para o `aria-controls` do
          título ter para onde apontar; com a seção recolhida ela fica vazia.
          Um `div` comum dentro de um `aside` comum: nenhuma regra de altura
          da barra olha os filhos diretos da árvore. */}
      <div id={secao?.idDosItens} className="cu-arvore-corpo">
      {!secaoRecolhida && (
      <>
      {/* ⚠️ AS TRÊS SAÍDAS DE UMA ÁRVORE VAZIA — F17.CARGA03, e elas são
          mutuamente exclusivas de propósito. Ver a propriedade `leitura`: a
          frase de alcance SÓ sai depois de uma leitura que foi bem e voltou
          vazia. Enquanto se espera, esqueleto; quando o servidor recusa, quem
          fala é a faixa de recusa de quem chama, e aqui não vai nada. */}
      {esperandoAPrimeira && <EsqueletoDaArvore />}

      {espacos.length === 0 && leitura === 'pronta' && (
        <p className="cu-vazio cu-com-ajuda">
          <span>Nenhum espaço ao seu alcance ainda.</span>
          <Ajuda sobre="por que a árvore está vazia" lado="baixo">
            <p>
              Você vê os espaços a que recebeu acesso. Se falta algum, peça a quem administra o
              sistema.
            </p>
          </Ajuda>
        </p>
      )}

      {espacos.map((espaco) => {
        const chave = `space:${espaco.id}`;
        const abertoEspaco = !recolhido.has(chave);
        const pastas = espaco.folders.filter(visivel);
        const soltas = espaco.lists.filter(visivel);
        /* A EMPRESA SÓ ENTRA PARA DESFAZER HOMÔNIMO — F31. `Ide · AGÊNCIA
           IDE` virou `AGÊNCIA IDE`, e os dois `Demandas` (Ide e Ide Hub)
           continuam distintos. A regra mora em `espacosHomonimos`. */
        const empresa = homonimos.has(espaco.id) ? espaco.categoryName : null;

        return (
          <section key={espaco.id} className="cu-espaco">
            {/* `data-no` — F17.25. É por ele que a trilha do topo acha esta
                linha para trazê-la para a vista. A chave é a MESMA que
                `@/ui/lugar` guarda como recolhida: uma chave só para as duas
                perguntas. */}
            <div
              className="cu-no"
              data-no={chave}
              data-nivel={0}
              data-atual={espacoAtivo === espaco.id}
              data-morto={!espaco.live}
            >
              {seta(chave, espaco.name, abertoEspaco)}
              {renomeando === chave ? (
                <CampoDaLinha
                  valor={rascunho}
                  convite="Nome do espaço"
                  rotulo="Renomear o espaço"
                  salvando={salvando}
                  aoMudar={setRascunho}
                  aoCancelar={fechar}
                  aoConfirmar={() =>
                    confirmarRenome((nome) => api.editarEspaco(espaco.id, { name: nome }))
                  }
                />
              ) : (
                <button
                  type="button"
                  className="cu-no-alvo"
                  /* O NOME ABRE A TELA DO ESPAÇO — F17.26. A setinha ao lado
                     continua sanfonando, e é ela que carrega o `aria-expanded`:
                     anunciar "expandido" num botão que agora NAVEGA seria
                     prometer uma coisa e fazer outra. */
                  title={aoAbrirEspaco ? `Ver tudo o que há em ${espaco.name}` : undefined}
                  onClick={() =>
                    aoAbrirEspaco ? aoAbrirEspaco(espaco.id) : alternar(chave)
                  }
                  aria-expanded={aoAbrirEspaco ? undefined : abertoEspaco}
                >
                  <MarcaDoEspaco nome={espaco.name} cor={espaco.color} />
                  <span className="cu-no-nome">
                    {empresa && <span className="cu-no-empresa">{empresa} · </span>}
                    {espaco.name}
                  </span>
                  {espaco.archivedAt !== null && <span className="cu-selo-morto">arquivado</span>}
                </button>
              )}
              {acao(
                chave,
                `Ações de ${espaco.name}`,
                aberto?.chave === chave && aberto.aba === 'acesso' ? (
                  <CaixaDeAcesso
                    no={{ nivel: 'space', id: espaco.id }}
                    salvando={salvando}
                    aoFechar={() => setAberto(null)}
                    aoAgir={agir}
                  />
                ) : aberto?.chave === chave && aberto.aba === 'clientes' ? (
                  <CaixaDeClientes
                    spaceId={espaco.id}
                    /* Nulo: a lista do cliente nasce SOLTA no espaço, no mesmo
                       nível das pastas — o `Skills` da referência. */
                    folderId={null}
                    onde={espaco.name}
                    salvando={salvando}
                    aoFechar={() => setAberto(null)}
                    aoAgir={agir}
                  />
                ) : (
                  menuDoEspaco(espaco)
                ),
              )}
            </div>

            {abertoEspaco && (
              <>
                {pastas.map((pasta) => {
                  const chaveP = `folder:${pasta.id}`;
                  const abertaPasta = !recolhido.has(chaveP);
                  const listas = pasta.lists.filter(visivel);
                  /* PASTA VAZIA OCUPA UMA LINHA — F28. Antes eram duas: a
                     pasta e um `Pasta sem lista.` embaixo, com uma seta que
                     abria para mostrar essa frase e mais nada. Agora não há o
                     que abrir, então não há seta (o `span` guarda o lugar dela
                     para o nome não sair do alinhamento), e o vazio é dito pelo
                     tom apagado do nome e pelo `title`. Quem quer criar a
                     primeira lista tem o `···` da linha, que continua ali —
                     `Nova lista` e `Trazer clientes…` moram nele. */
                  const vazia = listas.length === 0;

                  return (
                    <div key={pasta.id}>
                      <div
                        className="cu-no"
                        data-no={chaveP}
                        data-nivel={1}
                        data-atual={pastaAtiva === pasta.id}
                        data-morto={!pasta.live}
                        data-vazia={vazia}
                      >
                        {vazia ? (
                          <span className="cu-caret" aria-hidden="true" />
                        ) : (
                          seta(chaveP, pasta.name, abertaPasta)
                        )}
                        {renomeando === chaveP ? (
                          <CampoDaLinha
                            valor={rascunho}
                            convite="Nome da pasta"
                            rotulo="Renomear a pasta"
                            salvando={salvando}
                            aoMudar={setRascunho}
                            aoCancelar={fechar}
                            aoConfirmar={() =>
                              confirmarRenome((nome) => api.editarPasta(pasta.id, { name: nome }))
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="cu-no-alvo"
                            /* O NOME ABRE O QUADRO DA PASTA — F17.64. A
                               setinha ao lado continua sanfonando, e é ela
                               que carrega o `aria-expanded`: anunciar
                               "expandido" num botão que agora NAVEGA seria
                               prometer uma coisa e fazer outra. É a mesma
                               divisão que a F17.26 fez no espaço. */
                            title={
                              vazia
                                ? 'Pasta sem lista. O ··· da linha cria a primeira.'
                                : aoAbrirPasta
                                  ? `Ver as tarefas de todas as listas de ${pasta.name} num quadro só`
                                  : undefined
                            }
                            onClick={() =>
                              aoAbrirPasta ? aoAbrirPasta(pasta.id) : alternar(chaveP)
                            }
                            aria-expanded={aoAbrirPasta || vazia ? undefined : abertaPasta}
                          >
                            <IconePasta c="h-3.5 w-3.5 shrink-0 opacity-70" />
                            <span className="cu-no-nome">{pasta.name}</span>
                            {vazia && <span className="sr-only">(sem lista)</span>}
                            {pasta.archivedAt !== null && (
                              <span className="cu-selo-morto">arquivada</span>
                            )}
                            {/* O NÚMERO DE LISTAS SÓ COM A PASTA FECHADA — F28.
                                Aberta, as listas estão logo abaixo e o número
                                repetia o que se vê; pior, ficava na mesma coluna
                                em que a lista escreve tarefas em aberto, e dois
                                sentidos numa coluna é o que esta etapa tira.
                                Fechada, ele é a única pista do que há dentro. */}
                            {!vazia && !abertaPasta && (
                              <span
                                className="cu-no-contagem"
                                title={`${listas.length} ${listas.length === 1 ? 'lista' : 'listas'}`}
                              >
                                {listas.length}
                              </span>
                            )}
                          </button>
                        )}
                        {acao(
                          chaveP,
                          `Ações de ${pasta.name}`,
                          aberto?.chave === chaveP && aberto.aba === 'acesso' ? (
                            <CaixaDeAcesso
                              no={{ nivel: 'folder', id: pasta.id }}
                              salvando={salvando}
                              aoFechar={() => setAberto(null)}
                              aoAgir={agir}
                            />
                          ) : aberto?.chave === chaveP && aberto.aba === 'esteira' ? (
                            <CaixaDaEsteira pasta={pasta} salvando={salvando}
                              aoFechar={() => setAberto(null)} aoAgir={agir} />
                          ) : aberto?.chave === chaveP && aberto.aba === 'clientes' ? (
                            <CaixaDeClientes
                              spaceId={pasta.spaceId}
                              folderId={pasta.id}
                              onde={pasta.name}
                              salvando={salvando}
                              aoFechar={() => setAberto(null)}
                              aoAgir={agir}
                            />
                          ) : (
                            menuDaPasta(pasta)
                          ),
                        )}
                      </div>

                      {abertaPasta && (
                        <>
                          {listas.map((l) => linhaDeLista(l, 2))}
                          {criando?.tipo === 'list' &&
                            criando.folderId === pasta.id &&
                            campoNovo(2, 'list')}
                        </>
                      )}
                    </div>
                  );
                })}

                {criando?.tipo === 'folder' &&
                  criando.spaceId === espaco.id &&
                  campoNovo(1, 'folder')}

                {/* A LISTA SOLTA NO ESPAÇO — o `Skills` da referência. Ela vive
                    no mesmo nível das pastas, e o modelo a permite porque
                    `folder_id` é opcional. */}
                {soltas.map((l) => linhaDeLista(l, 1))}

                {criando?.tipo === 'list' &&
                  criando.spaceId === espaco.id &&
                  criando.folderId === null &&
                  campoNovo(1, 'list')}

                {pastas.length === 0 && soltas.length === 0 && criando?.spaceId !== espaco.id && (
                  <p className="cu-vazio cu-recuo-1">
                    Espaço vazio. Use o <b>···</b> da linha para criar a primeira pasta ou lista.
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}

      {/* ARQUIVAR NÃO APAGA — e por isso precisa haver como ver o arquivado.
          Sem este interruptor, arquivar seria uma porta sem volta disfarçada de
          organização. */}
      {(arquivados.total > 0 || mostrarArquivados) && (
        <button
          type="button"
          className="cu-arvore-pe"
          aria-pressed={mostrarArquivados}
          onClick={() => aoAlternarArquivados(!mostrarArquivados)}
        >
          <IconeArquivo c="h-3.5 w-3.5" />
          {mostrarArquivados ? 'Esconder arquivados' : `Mostrar arquivados (${arquivados.total})`}
        </button>
      )}
      </>
      )}
      </div>
    </aside>
  );
}
