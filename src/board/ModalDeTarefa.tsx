import { CampoComMencoes, ProvedorDeMencoes, TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * O modal de tarefa nova — etapa F17.10b.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO SUBSTITUIU `NovaTarefa.tsx`
 *
 *   A F17.10 entregou um FORMULÁRIO: rótulo em cima, campo embaixo, `<select>`
 *   para prioridade, coluna de metadados à direita, botão no rodapé. O usuário
 *   abriu, comparou com o ClickUp dele e reprovou —
 *   *"não se parece em nada com o que vc fez"*.
 *
 *   O ClickUp não tem formulário de tarefa. Tem um MODAL com:
 *     · abas no topo e minimizar/fechar no canto;
 *     · dois seletores em linha — a lista e o tipo;
 *     · um título grande, sem borda;
 *     · a descrição ocupando o corpo, em editor rico;
 *     · uma FILA DE CHIPS no pé — status · responsável · prazo · prioridade · ···;
 *     · rodapé com `Criar Tarefa` e uma seta que abre o menu do botão.
 *
 *   Cada chip abre um menu flutuante ancorado NELE. É outra gramática, e é ela
 *   que esta etapa replica. Cor, tipografia e superfície continuam sendo do
 *   OBSIDIAN (decisão D10) — as referências são escuras, os dois combinam.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ELE NÃO DECIDE
 *   Quem alcança a lista, qual status a tarefa pode ter, quem entra como
 *   responsável. Tudo isso está no banco desde a F17.1..F17.4b. Aqui se junta o
 *   que a pessoa disse e se entrega — `createBoardTask` insere e chama
 *   `set_task_assignees` e `set_task_tags` no MESMO bloco (regra 9).
 *
 * MINIMIZAR GUARDA O RASCUNHO, E É PARA ISSO QUE ELE EXISTE
 *   O componente continua montado; só o desenho muda. Fechar com briefing
 *   escrito pede confirmação — perder trinta linhas por um clique no lugar
 *   errado é o defeito mais caro que um modal pode ter.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import {
  type Board,
  type BoardTag,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  type TreeSpace,
  emFrase,
  today,
} from '@/board/board';
import { rotuloDeDia } from '@/board/calendario';
import { ChipDoClienteNaCriacao } from '@/board/ClienteDaTarefa';
import { faltaCliente } from '@/board/cliente-no-cartao';
import { EditorRico } from '@/board/EditorRico';
import { SeletorDoTipo } from '@/board/SeletorDoTipo';
import { ehListaDeProducao, faltaTipo, fraseDaRecusa } from '@/board/tipo-no-cartao';
import { type NewTask, type TaskType, conferirNova, tarefaVazia } from '@/board/ficha';
import { useEquipe } from '@/board/equipe-compartilhada';
import {
  Avatar,
  Balao,
  IconeBandeira,
  IconeCalendario,
  IconeCirculo,
  IconeEtiqueta,
  IconeFechar,
  IconeLista,
  IconeMais,
  IconeMinimizar,
  IconePessoa,
  IconeSeta,
  ItemDeMenu,
  MenuDeData,
  MenuDeEtiquetas,
  MenuDeListas,
  MenuDePessoas,
  MenuDePrioridade,
  MenuDeStatus,
  MenuDeTipos,
} from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';
import { prenderOTab, useDevolverFoco } from '@/ui/foco';
import '@/ui/clickup.css';

/* ───────────────────────────── o chip ───────────────────────────── */

function Chip({
  aberto,
  aoAlternar,
  cheio,
  corStatus,
  rotulo,
  nome,
  icone,
  desativado,
  balao,
}: {
  aberto: boolean;
  aoAlternar: () => void;
  cheio?: boolean;
  corStatus?: string | null;
  rotulo: string;
  /** O nome para o leitor de tela quando o chip é só ícone (`rotulo` vazio) — WCAG 4.1.2. */
  nome?: string;
  icone: React.ReactNode;
  desativado?: boolean;
  balao?: React.ReactNode;
}) {
  return (
    <span className="cu-ancora">
      <button
        type="button"
        className="cu-chip"
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label={nome}
        data-cheio={cheio === true}
        data-status={corStatus !== undefined}
        disabled={desativado}
        style={corStatus ? { ['--cor-status' as string]: corStatus } : undefined}
        onClick={aoAlternar}
      >
        {icone}
        {rotulo !== '' && <span className="rotulo">{rotulo}</span>}
      </button>
      {aberto && balao}
    </span>
  );
}

/* ───────────────────────────── o modal ───────────────────────────── */

type Modo = 'abrir' | 'outra';

export function ModalDeTarefa({
  quadro,
  arvore,
  aoFechar,
  aoCriar,
}: {
  /** O quadro da lista em que o modal abriu — já lido pela tela do quadro. */
  quadro: Board;
  arvore: readonly TreeSpace[];
  aoFechar: () => void;
  /** Chamada com o id da tarefa criada quando o modo é "criar e abrir". */
  aoCriar: (taskId: string) => void;
}) {
  // O foco volta ao botão `Nova tarefa` (ou ao `+ Adicionar tarefa` da coluna)
  // quando o modal fecha — antes caía no `<body>`.
  useDevolverFoco(true);
  const [destino, setDestino] = useState<Board>(quadro);
  const [nova, setNova] = useState<NewTask>(tarefaVazia);
  /* O DIRETÓRIO VEM DA CONSULTA COMPARTILHADA — F17.CARGA03. Esta caixa e a
     ficha da tarefa liam `/team` cada uma por conta própria, com o mesmo
     `try/catch` letra por letra; criar uma tarefa logo depois de abrir outra
     pagava a mesma lista de nomes duas vezes. Ver `@/board/equipe-compartilhada`
     — inclusive para o silêncio da falha, que continua sendo o comportamento. */
  const { pessoas: equipe, meuId } = useEquipe();
  const [catalogo, setCatalogo] = useState<BoardTag[]>([...(quadro.availableTags ?? [])]);

  const [menu, setMenu] = useState<string | null>(null);
  const [minimizado, setMinimizado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  /** O nome do cliente escolhido — F38, Fase 7. O id mora em `nova.clientId`. */
  const [nomeDoCliente, setNomeDoCliente] = useState<string | null>(null);
  /** A pessoa tentou criar numa lista compartilhada sem cliente: o chip fica em erro. */
  const [faltouCliente, setFaltouCliente] = useState(false);
  const [modo, setModo] = useState<Modo>('abrir');
  const [semente, setSemente] = useState(0);

  const hoje = useRef(today()).current;
  const erros = conferirNova(nova);
  /* F40, Fase 4: em lista de produção o tipo é obrigatório — o botão de criar
     fica parado e a frase fica à vista até a pessoa escolher. */
  const producao = ehListaDeProducao(destino.header);
  const semTipo = faltaTipo(destino.header, nova.type);

  /**
   * O catálogo de tipos do espaço.
   *
   * ⚠️ VAZIO HOJE, E POR ISSO O SELETOR NÃO APARECE. `ideworks.task_types` tem
   * zero linhas no schema inteiro (medido em 2026-08-25). O seletor de tipo da
   * referência existe no código e desenha assim que houver catálogo; desenhá-lo
   * agora seria um botão com uma opção fixa, que é botão morto.
   */
  const tipos: TaskType[] = useMemo(() => [], []);

  const paraLogin = (e: unknown) => {
    if (semSessao(e)) {
      window.location.replace('/');
      return true;
    }
    return false;
  };

  const mexer = (m: Partial<NewTask>) => setNova((n) => ({ ...n, ...m }));

  const vazio =
    nova.title.trim() === '' &&
    (nova.description ?? '').trim() === '' &&
    nova.assigneeIds.length === 0 &&
    nova.tagIds.length === 0 &&
    nova.dueOn === null &&
    nova.startOn === null &&
    nova.priority === null;

  /* --- trocar a lista de destino ---------------------------------------- */

  const trocarLista = useCallback(
    async (listId: string) => {
      if (listId === destino.header.listId) return;
      setErro(null);
      try {
        const r = await api.quadroDaLista(listId);
        const b = r.board as Board;
        setDestino(b);
        setCatalogo([...(b.availableTags ?? [])]);
        // A esteira é outra: um status escolhido na lista antiga não existe
        // aqui, e mandá-lo faria `tasks_status_guard` recusar a criação.
        // O cliente também volta ao vazio (F38, Fase 7): a lista nova pode
        // ser de cliente (herda) ou de outra empresa.
        mexer({ statusId: null, tagIds: [], clientId: null });
        setNomeDoCliente(null);
        setFaltouCliente(false);
      } catch (e) {
        if (paraLogin(e)) return;
        setErro(e instanceof ApiError ? e.message : 'Não foi possível abrir essa lista.');
      }
    },
    [destino.header.listId],
  );

  /* --- criar ------------------------------------------------------------- */

  const criar = useCallback(
    async (comoFazer: Modo) => {
      if (Object.keys(erros).length > 0 || salvando || semTipo !== null) return;
      // F38, Fase 7: lista compartilhada sem cliente — a frase aparece aqui,
      // antes de ir ao servidor, e o título digitado fica.
      const falta = faltaCliente(destino.header, nova.clientId);
      if (falta) {
        setErro(falta);
        setFaltouCliente(true);
        setRecado(null);
        return;
      }
      setSalvando(true);
      setErro(null);
      setRecado(null);
      try {
        const r = await api.criarTarefaNoQuadro(destino.header.listId, nova);
        if (comoFazer === 'abrir') {
          aoCriar(r.id);
          return;
        }
        // "Criar outra em seguida": limpa o rascunho e mantém a lista. Quem
        // está despejando o que combinou numa reunião tem a próxima na ponta
        // da língua. O CLIENTE FICA (F38, Fase 7): numa lista compartilhada,
        // a reunião costuma ser de um cliente só.
        setNova({ ...tarefaVazia(), clientId: nova.clientId ?? null, type: nova.type ?? null });
        setSemente((s) => s + 1);
        setRecado(`"${nova.title.trim()}" criada. A próxima nasce na mesma lista.`);
      } catch (x) {
        if (paraLogin(x)) return;
        // A frase do banco, inteira. As travas da F17 dizem o que está no
        // caminho — trocá-las por "não foi possível" jogaria o trabalho fora.
        setErro(x instanceof ApiError ? fraseDaRecusa(x) : 'Não foi possível criar a tarefa.');
      } finally {
        setSalvando(false);
      }
    },
    [erros, salvando, semTipo, destino.header, nova, aoCriar],
  );

  const criarEtiqueta = async (nome: string, cor: string) => {
    try {
      const r = await api.criarEtiquetaDoEspaco(destino.header.spaceId, {
        name: nome,
        bgColor: cor,
        fgColor: null,
      });
      const t = r.tag as BoardTag;
      setCatalogo((c) => [...c, t]);
      mexer({ tagIds: [...nova.tagIds, t.id] });
    } catch (e) {
      if (paraLogin(e)) return;
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar a etiqueta.');
    }
  };

  /* --- sair --------------------------------------------------------------- */

  /** Sair sem perder: com rascunho, minimiza; vazio, fecha. Ver o cabeçalho. */
  const sair = useCallback(() => {
    if (vazio) aoFechar();
    else setMinimizado(true);
  }, [vazio, aoFechar]);

  const teclado = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // `aria-modal`: o `Tab` não sai do modal para o quadro coberto (só as pontas).
    if (e.key === 'Tab') {
      prenderOTab(e, e.currentTarget);
      return;
    }
    if (e.key !== 'Escape') return;
    // O balão aberto já tratou o `Esc` e parou a propagação — se chegou aqui,
    // não havia menu aberto.
    e.preventDefault();
    sair();
  };

  /* --- desenho ------------------------------------------------------------ */

  const statusEscolhido =
    destino.statuses.find((s) => s.id === nova.statusId) ??
    destino.statuses.find((s) => s.type === 'open') ??
    destino.statuses[0] ??
    null;

  const escolhidos = equipe.filter((p) => nova.assigneeIds.includes(p.id));
  const etiquetasEscolhidas = catalogo.filter((g) => nova.tagIds.includes(g.id));

  const alternar = (nome: string) => setMenu((m) => (m === nome ? null : nome));

  if (minimizado) {
    return (
      <div className="cu-minimizado" role="dialog" aria-label="Tarefa minimizada">
        <span className="texto">{nova.title.trim() === '' ? 'Tarefa sem título' : <TextoComMencoes texto={nova.title} />}</span>
        <button
          type="button"
          className="cu-icone-btn"
          aria-label="Voltar ao rascunho"
          onClick={() => setMinimizado(false)}
        >
          <IconeSeta />
        </button>
        <button type="button" className="cu-icone-btn" aria-label="Descartar" onClick={aoFechar}>
          <IconeFechar />
        </button>
      </div>
    );
  }

  return (
    <ProvedorDeMencoes listId={destino.header.listId}><div
      className="cu-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) sair();
      }}
    >
      <div
        className="cu-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Nova tarefa"
        onKeyDown={teclado}
      >
        {/* --- abas e canto ------------------------------------------------ */}
        <div className="cu-topo">
          <div className="cu-abas" role="tablist">
            {/* A aba `Lembrete` da referência NÃO está aqui: lembrete é outra
                entidade, com notificação própria, e não existe no modelo. Botão
                morto é pior que botão ausente. */}
            <button type="button" role="tab" aria-selected="true" className="cu-aba">
              Tarefa
            </button>
          </div>
          <div className="cu-canto">
            <button
              type="button"
              className="cu-icone-btn"
              aria-label="Minimizar"
              title="Minimizar — o rascunho fica guardado"
              onClick={() => setMinimizado(true)}
            >
              <IconeMinimizar />
            </button>
            <button
              type="button"
              className="cu-icone-btn"
              aria-label="Fechar"
              onClick={() => (vazio ? aoFechar() : setConfirmando(true))}
            >
              <IconeFechar />
            </button>
          </div>
        </div>

        {/* --- os dois seletores em linha ---------------------------------- */}
        <div className="cu-seletores">
          <span className="cu-ancora">
            <button
              type="button"
              className="cu-seletor"
              aria-expanded={menu === 'lista'}
              onClick={() => alternar('lista')}
            >
              <IconeLista />
              <span className="nome">{destino.header.listName}</span>
              <span className="seta">
                <IconeSeta />
              </span>
            </button>
            {menu === 'lista' && (
              <MenuDeListas
                arvore={arvore}
                listaAtual={destino.header.listId}
                aoEscolher={(id) => void trocarLista(id)}
                aoFechar={() => setMenu(null)}
              />
            )}
          </span>

          {/* O CLIENTE, AO LADO DA LISTA — F38, Fase 7. É a lista que decide se
              ele vem dela, se é obrigatório ou se pode ficar vazio. */}
          <ChipDoClienteNaCriacao
            listId={destino.header.listId}
            lista={destino.header}
            valor={nova.clientId ?? null}
            valorNome={nomeDoCliente}
            aoMudar={(id, nome) => {
              mexer({ clientId: id });
              setNomeDoCliente(nome);
              if (id !== null) {
                setFaltouCliente(false);
                setErro(null);
              }
            }}
            aberto={menu === 'cliente'}
            aoAlternar={() => alternar('cliente')}
            faltando={faltouCliente}
            desativado={salvando}
            lado="baixo"
          />

          {/* O seletor de tipo só existe quando o espaço tem catálogo. Ver
              `tipos`, acima: hoje `task_types` está vazia no schema inteiro. */}
          {tipos.length > 0 && (
            <span className="cu-ancora">
              <button
                type="button"
                className="cu-seletor"
                aria-expanded={menu === 'tipo'}
                onClick={() => alternar('tipo')}
              >
                <IconeCirculo />
                <span className="nome">
                  {tipos.find((t) => t.customItemId === nova.customItemId)?.name ?? 'Tarefa'}
                </span>
                <span className="seta">
                  <IconeSeta />
                </span>
              </button>
              {menu === 'tipo' && (
                <MenuDeTipos
                  tipos={tipos}
                  valor={nova.customItemId}
                  aoEscolher={(v) => mexer({ customItemId: v })}
                  aoFechar={() => setMenu(null)}
                />
              )}
            </span>
          )}
        </div>

        {/* O TIPO DA DEMANDA — F40, Fase 4. Quatro botões; obrigatório em lista
            de produção (a frase fica à vista e o botão de criar espera). */}
        <div className="cu-seletores" data-linha-tipo="1" style={{ flexWrap: 'wrap' }}>
          <SeletorDoTipo
            valor={nova.type ?? null}
            aoMudar={(type) => {
              mexer({ type });
              if (type !== null) setErro(null);
            }}
            obrigatorio={producao}
            podeLimpar={!producao}
            faltando={semTipo !== null && nova.title.trim() !== ''}
            desativado={salvando}
          />
          {semTipo !== null && (
            <span role="status" data-falta-tipo="1" style={{ color: 'var(--err)', fontSize: '0.74rem' }}>
              {semTipo}
            </span>
          )}
        </div>

        {/* --- título ------------------------------------------------------ */}
        {/*
          `textarea` e não `input`: título de tarefa real tem 90 caracteres
          (`24/08 - [Reels] Oferta VIP 4 — versão do cliente`) e cortar num
          campo de uma linha esconde o fim do que se está escrevendo.

          O placeholder NÃO cita a barra `/`: o menu de comandos não existe
          nesta etapa, e prometer um atalho que não responde é pior do que não
          mencioná-lo.
        */}
        <CampoComMencoes
          className="cu-titulo"
          rows={1}
          autoFocus
          maxLength={400}
          value={nova.title}
          disabled={salvando}
          data-erro={erros.title !== undefined && nova.title !== ''}
          aria-label="Nome da tarefa"
          placeholder="Nome da Tarefa"
          aoMudar={(title) => mexer({ title })} umaLinha
          onKeyDown={(e) => {
            // Enter cria, como no ClickUp. Shift+Enter não faz nada aqui: o
            // título é uma linha só.
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void criar(modo);
          }}
        />

        {/* --- descrição --------------------------------------------------- */}
        <div className="cu-corpo">
          <EditorRico
            valorInicial=""
            semente={semente}
            desativado={salvando}
            minAltura="9rem"
            aoMudar={(md) => mexer({ description: md === '' ? null : md })}
          />
        </div>

        {/* --- a fila de chips --------------------------------------------- */}
        <div className="cu-chips">
          <Chip
            aberto={menu === 'status'}
            aoAlternar={() => alternar('status')}
            cheio
            corStatus={statusEscolhido?.color ?? null}
            icone={<span className="cu-ponto" />}
            rotulo={emFrase(statusEscolhido?.name ?? 'sem etapas')}
            balao={
              <MenuDeStatus
                statuses={destino.statuses}
                valor={statusEscolhido?.id ?? null}
                aoEscolher={(id) => mexer({ statusId: id })}
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            }
          />

          <Chip
            aberto={menu === 'pessoas'}
            aoAlternar={() => alternar('pessoas')}
            cheio={escolhidos.length > 0}
            icone={
              escolhidos.length > 0 ? (
                <span className="cu-pilha">
                  {escolhidos.slice(0, 3).map((p) => (
                    <Avatar key={p.id} pessoa={p} mini />
                  ))}
                </span>
              ) : (
                <IconePessoa />
              )
            }
            rotulo={
              escolhidos.length === 0
                ? 'Responsável'
                : escolhidos.length === 1
                  ? escolhidos[0].name
                  : `${escolhidos.length} responsáveis`
            }
            balao={
              <MenuDePessoas
                diretorio={equipe}
                escolhidos={nova.assigneeIds}
                meuId={meuId}
                aoMudar={(ids) => mexer({ assigneeIds: ids })}
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            }
          />

          <Chip
            aberto={menu === 'data'}
            aoAlternar={() => alternar('data')}
            cheio={nova.dueOn !== null || nova.startOn !== null}
            icone={<IconeCalendario />}
            rotulo={rotuloDeDia(nova.dueOn) ?? rotuloDeDia(nova.startOn) ?? 'Data de vencimento'}
            balao={
              <MenuDeData
                inicio={nova.startOn ?? ''}
                vencimento={nova.dueOn ?? ''}
                hoje={hoje}
                aoMudar={(campo, valor) =>
                  mexer(
                    campo === 'inicio'
                      ? { startOn: valor === '' ? null : valor }
                      : { dueOn: valor === '' ? null : valor },
                  )
                }
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            }
          />

          <Chip
            aberto={menu === 'prioridade'}
            aoAlternar={() => alternar('prioridade')}
            cheio={nova.priority !== null}
            icone={
              <span
                className="cu-bandeira"
                style={
                  nova.priority ? { ['--cor-bandeira' as string]: PRIORITY_TOKEN[nova.priority] } : undefined
                }
              >
                <IconeBandeira />
              </span>
            }
            rotulo={nova.priority ? PRIORITY_LABEL[nova.priority] : 'Prioridade'}
            balao={
              <MenuDePrioridade
                valor={nova.priority}
                aoEscolher={(p) => mexer({ priority: p })}
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            }
          />

          <Chip
            aberto={menu === 'mais'}
            aoAlternar={() => alternar('mais')}
            icone={<IconeMais />}
            rotulo=""
            nome="Mais opções da tarefa"
            balao={
              <Balao lado="cima" aoFechar={() => setMenu(null)} rotulo="Mais">
                <ItemDeMenu aoEscolher={() => setMenu('etiquetas')}>
                  <IconeEtiqueta />
                  Etiquetas
                  {nova.tagIds.length > 0 && <span className="fim">{nova.tagIds.length}</span>}
                </ItemDeMenu>
                <ItemDeMenu aoEscolher={() => setMenu('data-inicial')}>
                  <IconeCalendario />
                  Data inicial
                  {nova.startOn && <span className="fim">{rotuloDeDia(nova.startOn)}</span>}
                </ItemDeMenu>
              </Balao>
            }
          />

          {/* Os dois que saem do `···` abrem no lugar dele. */}
          {menu === 'etiquetas' && (
            <span className="cu-ancora">
              <MenuDeEtiquetas
                disponiveis={catalogo}
                escolhidas={nova.tagIds}
                aoMudar={(ids) => mexer({ tagIds: ids })}
                aoCriar={criarEtiqueta}
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            </span>
          )}
          {menu === 'data-inicial' && (
            <span className="cu-ancora">
              <MenuDeData
                inicio={nova.startOn ?? ''}
                vencimento={nova.dueOn ?? ''}
                hoje={hoje}
                focoInicial="inicio"
                aoMudar={(campo, valor) =>
                  mexer(
                    campo === 'inicio'
                      ? { startOn: valor === '' ? null : valor }
                      : { dueOn: valor === '' ? null : valor },
                  )
                }
                aoFechar={() => setMenu(null)}
                lado="cima"
              />
            </span>
          )}

          {etiquetasEscolhidas.map((g) => (
            <span
              key={g.id}
              className="cu-etiqueta"
              /* SÓ O FUNDO: aqui o chip pinta o fundo a 30% sobre a superfície
                 (`.cu-etiqueta`), e a tinta da origem — quase sempre branca —
                 ficava quase invisível no tema claro. Sem `--cor-etiqueta-tinta`
                 vale a do tema (`--plat`), legível sobre qualquer tom a 30%. */
              style={g.bgColor ? { ['--cor-etiqueta-fundo' as string]: g.bgColor } : undefined}
            >
              {g.name}
            </span>
          ))}
        </div>

        {/* --- rodapé ------------------------------------------------------ */}
        <div className="cu-rodape">
          {/* ANUNCIADOS — WCAG 4.1.3. O erro de criar ("o banco recusou…") e o
              "criada, a próxima nasce na mesma lista" apareciam só como texto
              colorido no rodapé, com o foco no botão. */}
          {erro && (
            <span role="alert" style={{ color: 'var(--err)', fontSize: '0.74rem', lineHeight: 1.35 }}>{erro}</span>
          )}
          {!erro && recado && (
            <span role="status" style={{ color: 'var(--ok)', fontSize: '0.74rem' }}>{recado}</span>
          )}
          {!erro && !recado && confirmando && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.74rem' }}>
              Descartar esta tarefa?
              <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={aoFechar}>
                Descartar
              </button>
              <button
                type="button"
                className="o-btn o-btn-fantasma o-btn-sm"
                onClick={() => setConfirmando(false)}
              >
                Voltar
              </button>
            </span>
          )}

          <span className="cu-ancora" style={{ marginLeft: 'auto' }}>
            <span className="cu-partido">
              <button
                type="button"
                className="principal"
                disabled={salvando || Object.keys(erros).length > 0 || semTipo !== null}
                title={semTipo ?? undefined}
                onClick={() => void criar(modo)}
              >
                {salvando ? 'criando…' : modo === 'abrir' ? 'Criar Tarefa' : 'Criar e continuar'}
              </button>
              <button
                type="button"
                className="seta"
                aria-label="Opções de criação"
                aria-expanded={menu === 'criar'}
                onClick={() => alternar('criar')}
              >
                <IconeSeta />
              </button>
            </span>
            {menu === 'criar' && (
              <Balao lado="cima-direita" aoFechar={() => setMenu(null)} rotulo="Ao criar">
                <ItemDeMenu
                  marcado={modo === 'abrir'}
                  aoEscolher={() => {
                    setModo('abrir');
                    setMenu(null);
                  }}
                >
                  Criar e abrir a ficha
                </ItemDeMenu>
                <ItemDeMenu
                  marcado={modo === 'outra'}
                  aoEscolher={() => {
                    setModo('outra');
                    setMenu(null);
                  }}
                >
                  Criar e começar outra
                </ItemDeMenu>
              </Balao>
            )}
          </span>
        </div>
      </div>
    </div></ProvedorDeMencoes>
  );
}
