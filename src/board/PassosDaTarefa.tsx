import { textoDasMencoes } from '@/board/mencoes';
import { CampoComMencoes, TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * Os passos da tarefa — subtarefa e checklist. Etapa F17.15.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FORMA VEM DA FICHA REAL, que o usuário mandou como referência
 *
 *   A ordem das seções na ficha do ClickUp, de cima para baixo:
 *     📝 Adicione os campos ............ campos personalizados (F17.5, não é esta)
 *     ▼  Adicionar subtarefa ........... ESTA
 *     🔗 Vincular itens / dependências . dependências (uso zero medido, não é esta)
 *     ▼  Checklists .................... ESTA
 *     📎 Anexar arquivo ................ anexos (F17.6, não é esta)
 *
 *   As três que não são desta etapa NÃO SÃO DESENHADAS. Botão morto é pior que
 *   botão ausente — quem clica em "Anexar arquivo" e não acontece nada desiste
 *   do sistema, não da etapa. O que fica registrado é só a ORDEM, para quando
 *   elas chegarem o lugar já estar certo.
 *
 *   SUBTAREFA — a linha de criação, exatamente como na referência:
 *     círculo do status · campo de título · fila de ícones compacta (pessoa,
 *     calendário com +, bandeira, etiqueta) · `Cancelar` · `Salvar ↵`
 *   É a gramática do modal de tarefa nova, condensada numa linha. Os menus são
 *   OS MESMOS de `src/board/menus.tsx` — nenhum foi reescrito.
 *
 *   CHECKLIST — cartões empilhados, cada um com nome em negrito, o contador em
 *   cinza `0 de 0` POR EXTENSO, `+ Adicionar item` dentro do cartão e um ícone
 *   de pessoa no canto. Abaixo de todos, `+ Adicionar checklist`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTA TELA NÃO DECIDE — e nesta etapa é quase tudo
 *   A subtarefa herda a lista da mãe (`tasks_parent_guard`), a mãe de outra
 *   lista é recusada (`tasks_parent_same_list_fk`), o ciclo é recusado, o nome
 *   `{}` é recusado (`is_meaningful_name`), e a contagem sai de
 *   `ideworks.task_progress`. Se alguma dessas aparecer aqui, é defeito.
 *
 * A CAIXA DAQUI NÃO É A CAIXA DO BRIEFING, E A DIFERENÇA ESTÁ ESCRITA NA TELA
 *   O `- [ ]` do briefing é TEXTO: ele clica dentro do editor rico e é gravado
 *   NA DESCRIÇÃO, junto com o resto, quando se aperta `Salvar`. A caixa do
 *   checklist é ENTIDADE: ela vive em `ideworks.checklist_items.resolved_at` e
 *   grava no clique. São duas coisas, e a ficha diz qual é qual — confundi-las
 *   é o defeito que esta etapa poderia introduzir.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { DUE_TOKEN, type Day, PRIORITY_LABEL, PRIORITY_TOKEN, dueState, formatDay } from '@/board/board';
import { rotuloDeDia } from '@/board/calendario';
import type { TaskDetail, TaskPerson } from '@/board/ficha';
import {
  Ajuda,
  Avatar,
  Balao,
  IconeBandeira,
  IconeCalendario,
  IconeEtiqueta,
  IconeFechar,
  IconeMais,
  IconePessoa,
  ItemDeMenu,
  MenuDeData,
  MenuDeEtiquetas,
  MenuDePessoas,
  MenuDePrioridade,
  MenuDeStatus,
} from '@/board/menus';
import {
  type Checklist,
  type ChecklistItem,
  type NewSubtask,
  type Subtask,
  aninharItens,
  conferirNomeComSentido,
  contarItens,
  porExtenso,
  subtarefaVazia,
} from '@/board/passos';
import { ApiError, api } from '@/lib/api';
import '@/ui/passos.css';

/* ───────────────────────────── peças miúdas ───────────────────────────── */

/** A seta ▼ do cabeçalho. Três traços que só estas duas seções usam. */
const Caret = ({ aberto }: { aberto: boolean }) => (
  <span className="p-caret" data-aberto={aberto} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="m6 9 6 6 6-6" />
    </svg>
  </span>
);

/**
 * A cruz do `+`.
 *
 * Desenhada aqui, e não em `menus.tsx`: `IconeMais` daquele arquivo é o `···` da
 * referência (três pontos, "mais opções"), e não um sinal de somar. Usar um pelo
 * outro faria o botão de acrescentar subitem parecer um menu.
 */
const IconeCruz = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** O selo de contagem — o `5`, `3`, `4` da tela real. */
function Selo({ children, cheio, titulo }: { children: React.ReactNode; cheio?: boolean; titulo?: string }) {
  return (
    <span className="p-selo" data-cheio={cheio === true} title={titulo}>
      {children}
    </span>
  );
}

/** O ícone compacto da fila da direita: só ícone, sem rótulo. */
function BotaoDeIcone({
  aberto,
  cheio,
  rotulo,
  desativado,
  aoAlternar,
  children,
  balao,
}: {
  aberto: boolean;
  cheio?: boolean;
  rotulo: string;
  desativado?: boolean;
  aoAlternar: () => void;
  children: React.ReactNode;
  balao?: React.ReactNode;
}) {
  return (
    <span className="cu-ancora">
      <button
        type="button"
        className="p-icone"
        aria-expanded={aberto}
        aria-haspopup="menu"
        aria-label={rotulo}
        title={rotulo}
        data-cheio={cheio === true}
        disabled={desativado}
        onClick={aoAlternar}
      >
        {children}
      </button>
      {aberto && balao}
    </span>
  );
}

function Secao({
  titulo,
  contagem,
  aberto,
  aoAlternar,
  ajuda,
  children,
}: {
  titulo: string;
  contagem?: string;
  aberto: boolean;
  aoAlternar: () => void;
  /**
   * O `?` ao lado do título — F43, Fase 6. Fica FORA do botão de recolher
   * (botão dentro de botão não é HTML válido, e o clique no `?` recolheria a
   * seção), logo depois dele, na mesma linha.
   */
  ajuda?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="p-secao">
      <div className="p-secao-cabeca">
        <button type="button" className="p-secao-topo" aria-expanded={aberto} onClick={aoAlternar}>
          <Caret aberto={aberto} />
          <span>{titulo}</span>
          {contagem !== undefined && <span className="p-conta">{contagem}</span>}
        </button>
        {ajuda}
      </div>
      {aberto && <div className="p-secao-corpo">{children}</div>}
    </section>
  );
}

/* ───────────────────────────── a linha que cria a subtarefa ───────────────────────────── */

/**
 * A LINHA da referência.
 *
 * ENTER SALVA, e o `↵` no botão diz isso. Escapar cancela. É o mesmo par do
 * `+ Adicionar tarefa` da coluna do quadro, e pela mesma razão: quem está
 * quebrando uma tarefa em cinco passos não para para pegar o mouse entre um e
 * outro.
 *
 * A LINHA FICA ABERTA DEPOIS DE CRIAR, com o campo limpo — os cinco passos da
 * `Etapa 1` real foram escritos um atrás do outro.
 */
function LinhaDeSubtarefa({
  tarefa,
  equipe,
  meuId,
  hoje,
  ocupado,
  aoCriar,
  focar = false,
  aoCancelar,
}: {
  tarefa: TaskDetail;
  equipe: readonly TaskPerson[];
  meuId: string | null;
  hoje: Day;
  ocupado: boolean;
  aoCriar: (nova: NewSubtask) => Promise<boolean>;
  /** O campo nasce com o foco — quem clicou em "+ Subtarefa" quer digitar (F43, Fase 6). */
  focar?: boolean;
  /** Cancelar (botão ou Esc) também avisa quem abriu a linha, para ela voltar a recolher. */
  aoCancelar?: () => void;
}) {
  const [nova, setNova] = useState<NewSubtask>(subtarefaVazia);
  const [menu, setMenu] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alternar = (nome: string) => setMenu((m) => (m === nome ? null : nome));
  const mexer = (p: Partial<NewSubtask>) => setNova((n) => ({ ...n, ...p }));

  const status = tarefa.statuses.find((s) => s.id === nova.statusId) ?? null;
  const vazio = nova.title.trim() === '';

  const enviar = async () => {
    if (vazio || salvando) return;
    setSalvando(true);
    const deu = await aoCriar({ ...nova, title: nova.title.trim() });
    setSalvando(false);
    if (deu) setNova(subtarefaVazia());
  };

  const limpar = () => {
    setNova(subtarefaVazia());
    setMenu(null);
    aoCancelar?.();
  };

  /*
    O `/` DO TEXTO DE AJUDA PRECISA FAZER ALGUMA COISA.

    A referência escreve, dentro do campo, *"Nome da Tarefa ou digite '/' para
    inserir comandos"*. Copiar essa frase e deixar o `/` inerte seria a mesma
    coisa que desenhar um botão morto — pior, até, porque a promessa está escrita
    com todas as letras e a pessoa vai tentar.

    Então ele abre um menu com as QUATRO escolhas que esta linha já sabe fazer, e
    nada além delas. Não é o menu de comandos do ClickUp inteiro; é o que existe
    aqui, alcançável sem tirar a mão do teclado. Escolher um comando tira o `/`
    do título — o comando não é parte do nome da subtarefa.
  */
  const COMANDOS: { chave: string; rotulo: string }[] = [
    { chave: 'pessoas', rotulo: 'Responsável' },
    { chave: 'data', rotulo: 'Data de vencimento' },
    { chave: 'prioridade', rotulo: 'Prioridade' },
    { chave: 'etiquetas', rotulo: 'Etiqueta' },
    { chave: 'status', rotulo: 'Status' },
  ];

  const barraAberta = nova.title.startsWith('/');
  const filtroDoComando = barraAberta ? nova.title.slice(1).trim().toLowerCase() : '';
  const comandos = COMANDOS.filter(
    (c) => filtroDoComando === '' || c.rotulo.toLowerCase().includes(filtroDoComando),
  );

  const usarComando = (chave: string) => {
    // O `/` sai do título: ele foi um atalho, e não o nome do passo.
    mexer({ title: '' });
    setMenu(chave);
  };

  return (
    <div className="p-linha-nova">
      {/* O círculo do status, como no modal. Sem escolha, o banco põe o primeiro
          que ABRE da esteira resolvida — `tasks_status_guard`. */}
      <BotaoDeIcone
        aberto={menu === 'status'}
        cheio={status !== null}
        rotulo={status ? `Status: ${status.name}` : 'Status — o banco põe o primeiro que abre'}
        desativado={ocupado || salvando || tarefa.statuses.length === 0}
        aoAlternar={() => alternar('status')}
        balao={
          <MenuDeStatus
            statuses={tarefa.statuses}
            valor={nova.statusId}
            aoEscolher={(id) => mexer({ statusId: id })}
            aoFechar={() => setMenu(null)}
          />
        }
      >
        <span
          className="cu-ponto"
          style={status?.color ? { ['--cor-status' as string]: status.color } : undefined}
        />
      </BotaoDeIcone>

      <span className="cu-ancora p-campo-ancora">
        <CampoComMencoes umaLinha
          className="p-campo"
          value={nova.title}
          disabled={ocupado || salvando}
          aria-label="Nome da subtarefa"
          aria-expanded={barraAberta}
          autoFocus={focar}
          placeholder="Nome da Tarefa ou digite '/' para inserir comandos"
          aoMudar={(title) => mexer({ title })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Com a barra aberta, Enter escolhe o primeiro comando da lista —
              // senão ele tentaria criar uma subtarefa chamada `/pri`.
              if (barraAberta && comandos.length > 0) usarComando(comandos[0].chave);
              else void enviar();
            }
            if (e.key === 'Escape') limpar();
          }}
        />
        {barraAberta && (
          <Balao lado="baixo" aoFechar={() => mexer({ title: '' })} rotulo="Comandos">
            {comandos.length === 0 && (
              /* A segunda frase virou `?` — F17.24. "Nada com esse nome" é o
                 estado e fica; o resto explicava o alcance da linha, e quem
                 está digitando um comando quer a lista, não o manual. */
              <p className="cu-vazio cu-com-ajuda">
                <span>Nada com esse nome.</span>
                <Ajuda sobre="o que esta linha faz" lado="baixo">
                  <p>Ela faz cinco coisas, e são só estas.</p>
                  <p>O resto se põe depois, na ficha da subtarefa.</p>
                </Ajuda>
              </p>
            )}
            {comandos.map((c) => (
              <ItemDeMenu key={c.chave} aoEscolher={() => usarComando(c.chave)}>
                {c.rotulo}
              </ItemDeMenu>
            ))}
          </Balao>
        )}
      </span>

      {/* A FILA DE ÍCONES da referência: pessoa, calendário com +, bandeira,
          etiqueta. Só ícone — os rótulos ficam no `title`, que é o que a
          referência faz e o que mantém a linha em uma linha. */}
      <span className="p-icones">
        <BotaoDeIcone
          aberto={menu === 'pessoas'}
          cheio={nova.assigneeIds.length > 0}
          rotulo={
            nova.assigneeIds.length === 0
              ? 'Responsável'
              : `${nova.assigneeIds.length} responsável(is)`
          }
          desativado={ocupado || salvando}
          aoAlternar={() => alternar('pessoas')}
          balao={
            <MenuDePessoas
              diretorio={equipe}
              escolhidos={nova.assigneeIds}
              meuId={meuId}
              aoMudar={(ids) => mexer({ assigneeIds: ids })}
              aoFechar={() => setMenu(null)}
              lado="cima-direita"
            />
          }
        >
          {nova.assigneeIds.length > 0 ? (
            <span className="cu-pilha">
              {equipe
                .filter((p) => nova.assigneeIds.includes(p.id))
                .slice(0, 2)
                .map((p) => (
                  <Avatar key={p.id} pessoa={p} mini />
                ))}
            </span>
          ) : (
            <IconePessoa />
          )}
        </BotaoDeIcone>

        <BotaoDeIcone
          aberto={menu === 'data'}
          cheio={nova.dueOn !== null || nova.startOn !== null}
          rotulo={nova.dueOn ? `Prazo: ${rotuloDeDia(nova.dueOn) ?? nova.dueOn}` : 'Data'}
          desativado={ocupado || salvando}
          aoAlternar={() => alternar('data')}
          balao={
            <MenuDeData
              /*
                OS DOIS CAMPOS GRAVAM. `MenuDeData` é o mesmo componente do modal
                e sempre desenha `Data inicial` e `Data de vencimento`; gravar só
                um deixaria METADE do menu sem efeito, que é a mesma coisa que um
                botão morto. `tasks.start_on` existe desde a F17.3.
              */
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
              lado="cima-direita"
            />
          }
        >
          <IconeCalendario />
          <span className="mais" aria-hidden="true">
            +
          </span>
        </BotaoDeIcone>

        <BotaoDeIcone
          aberto={menu === 'prioridade'}
          cheio={nova.priority !== null}
          rotulo={nova.priority ? `Prioridade: ${PRIORITY_LABEL[nova.priority]}` : 'Prioridade'}
          desativado={ocupado || salvando}
          aoAlternar={() => alternar('prioridade')}
          balao={
            <MenuDePrioridade
              valor={nova.priority}
              aoEscolher={(p) => mexer({ priority: p })}
              aoFechar={() => setMenu(null)}
              lado="cima-direita"
            />
          }
        >
          <span
            className="cu-bandeira"
            style={
              nova.priority ? { ['--cor-bandeira' as string]: PRIORITY_TOKEN[nova.priority] } : undefined
            }
          >
            <IconeBandeira />
          </span>
        </BotaoDeIcone>

        <BotaoDeIcone
          aberto={menu === 'etiquetas'}
          cheio={nova.tagIds.length > 0}
          rotulo={nova.tagIds.length === 0 ? 'Etiquetas' : `${nova.tagIds.length} etiqueta(s)`}
          desativado={ocupado || salvando || tarefa.availableTags.length === 0}
          aoAlternar={() => alternar('etiquetas')}
          balao={
            <MenuDeEtiquetas
              disponiveis={tarefa.availableTags}
              escolhidas={nova.tagIds}
              aoMudar={(ids) => mexer({ tagIds: ids })}
              aoFechar={() => setMenu(null)}
              lado="cima-direita"
            />
          }
        >
          <IconeEtiqueta />
        </BotaoDeIcone>
      </span>

      <span className="p-acoes">
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm"
          disabled={salvando}
          onClick={limpar}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="o-btn o-btn-primario o-btn-sm"
          disabled={ocupado || salvando || vazio}
          onClick={() => void enviar()}
        >
          {salvando ? 'salvando…' : 'Salvar'}
          <span className="p-atalho" aria-hidden="true">
            ↵
          </span>
        </button>
      </span>
    </div>
  );
}

/* ───────────────────────────── a linha de uma subtarefa ───────────────────────────── */

function LinhaDaSubtarefa({
  sub,
  statuses,
  hoje,
  ocupado,
  aoTrocarStatus,
  aoSoltar,
}: {
  sub: Subtask;
  statuses: TaskDetail['statuses'];
  hoje: Day;
  ocupado: boolean;
  aoTrocarStatus: (statusId: string) => void;
  aoSoltar: () => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const prazo = dueState(sub, hoje);
  const data = formatDay(sub.dueOn);

  return (
    <div
      className="p-sub"
      data-concluida={sub.completedAt !== null}
      data-arquivada={sub.archivedAt !== null}
    >
      <BotaoDeIcone
        aberto={menu === 'status'}
        cheio
        rotulo={sub.statusName ? `Status: ${sub.statusName}` : 'Status'}
        desativado={ocupado || statuses.length === 0}
        aoAlternar={() => setMenu((m) => (m === 'status' ? null : 'status'))}
        balao={
          <MenuDeStatus
            statuses={statuses}
            valor={sub.statusId}
            aoEscolher={aoTrocarStatus}
            aoFechar={() => setMenu(null)}
          />
        }
      >
        <span
          className="cu-ponto"
          style={sub.statusColor ? { ['--cor-status' as string]: sub.statusColor } : undefined}
        />
      </BotaoDeIcone>

      <Link to={`/tarefa/${sub.id}`} className="p-sub-titulo" title={textoDasMencoes(sub.title)}>
        <TextoComMencoes texto={sub.title} />
      </Link>

      {/* A CONTAGEM DELA. É assim que a profundidade livre aparece na tela:
          navegando, e não somando — ver a decisão 2 da migration. */}
      {sub.subtaskCount > 0 && (
        <Selo cheio titulo={`${sub.subtaskCount} subtarefa(s) dentro desta`}>
          ⑂ {sub.subtaskCount}
        </Selo>
      )}

      {sub.archivedAt !== null && <Selo titulo="Arquivada — não aparece no quadro">arquivada</Selo>}

      {sub.priority && (
        <span
          className="text-[0.66rem]"
          style={{ color: PRIORITY_TOKEN[sub.priority] }}
          title={`Prioridade ${PRIORITY_LABEL[sub.priority]}`}
        >
          ▲
        </span>
      )}

      {data && (
        <span className="tnum text-[0.68rem]" style={{ color: DUE_TOKEN[prazo] }}>
          {data}
        </span>
      )}
      {sub.dueOn !== null && data === null && (
        <span className="text-[0.66rem]" style={{ color: 'var(--mute)' }} title={`Valor no banco: ${sub.dueOn}`}>
          prazo ilegível
        </span>
      )}

      {sub.assignees.length > 0 && (
        <span className="cu-pilha">
          {sub.assignees.slice(0, 3).map((p) => (
            <Avatar key={p.id} pessoa={p} mini />
          ))}
        </span>
      )}

      <BotaoDeIcone
        aberto={menu === 'mais'}
        rotulo="Mais"
        desativado={ocupado}
        aoAlternar={() => setMenu((m) => (m === 'mais' ? null : 'mais'))}
        balao={
          <Balao lado="cima-direita" aoFechar={() => setMenu(null)} rotulo="Subtarefa">
            <ItemDeMenu
              aoEscolher={() => {
                setMenu(null);
                aoSoltar();
              }}
            >
              Soltar da mãe
            </ItemDeMenu>
          </Balao>
        }
      >
        <IconeMais />
      </BotaoDeIcone>
    </div>
  );
}

/* ───────────────────────────── o item de checklist ───────────────────────────── */

function LinhaDoItem({
  item,
  equipe,
  meuId,
  ocupado,
  aoResolver,
  aoRenomear,
  aoAtribuir,
  aoApagar,
  aoAcrescentarFilho,
}: {
  item: ChecklistItem;
  equipe: readonly TaskPerson[];
  meuId: string | null;
  ocupado: boolean;
  aoResolver: (id: string, resolvido: boolean) => void;
  aoRenomear: (id: string, nome: string) => void;
  aoAtribuir: (id: string, userId: string | null) => void;
  aoApagar: (id: string) => void;
  aoAcrescentarFilho: ((paiId: string) => void) | null;
}) {
  const [nome, setNome] = useState(item.name);
  const [menu, setMenu] = useState(false);
  const resolvido = item.resolvedAt !== null;

  return (
    <>
      <div className="p-item" data-resolvido={resolvido}>
        <button
          type="button"
          role="checkbox"
          aria-checked={resolvido}
          aria-label={resolvido ? `Desmarcar ${textoDasMencoes(item.name)}` : `Marcar ${textoDasMencoes(item.name)}`}
          className="p-caixa"
          disabled={ocupado}
          title={
            resolvido && item.resolvedAt !== null
              ? `Resolvido desde ${new Date(item.resolvedAt).toLocaleString('pt-BR')}`
              : 'Marcar como resolvido'
          }
          onClick={() => aoResolver(item.id, !resolvido)}
        >
          {resolvido ? '✓' : ''}
        </button>

        {/* Renomear é digitar e sair do campo — não é menu. O banco recusa nome
            só com pontuação (`is_meaningful_name`), e `conferirNomeComSentido`
            diz isso antes de gastar a ida. */}
        <CampoComMencoes umaLinha
          className="p-item-nome"
          value={nome}
          disabled={ocupado}
          aria-label="Nome do item"
          aoMudar={setNome}
          onBlur={() => {
            if (nome.trim() !== item.name && conferirNomeComSentido(nome) === null) {
              aoRenomear(item.id, nome.trim());
            } else if (conferirNomeComSentido(nome) !== null) {
              setNome(item.name);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setNome(item.name);
          }}
        />

        <BotaoDeIcone
          aberto={menu}
          cheio={item.assignee !== null}
          rotulo={item.assignee ? `Responsável: ${item.assignee.name}` : 'Atribuir este item'}
          desativado={ocupado}
          aoAlternar={() => setMenu((m) => !m)}
          balao={
            <MenuDePessoas
              diretorio={equipe}
              /* UM responsável por item — é o `assignee` do ClickUp, que é um
                 campo e não uma lista. O menu é o mesmo, e a última escolha
                 vence. */
              escolhidos={item.assignee ? [item.assignee.id] : []}
              meuId={meuId}
              rotulo="Responsável do item"
              aoMudar={(ids) => {
                const novo = ids.find((x) => x !== item.assignee?.id) ?? null;
                aoAtribuir(item.id, novo);
                setMenu(false);
              }}
              aoFechar={() => setMenu(false)}
              lado="cima-direita"
            />
          }
        >
          {item.assignee ? <Avatar pessoa={item.assignee} mini /> : <IconePessoa />}
        </BotaoDeIcone>

        {/* O `+` só aparece em item de nível 0: o banco aceita UM nível de
            aninhamento (`checklist_items_parent_fk`), e desenhar o botão no
            filho seria desenhar uma recusa. */}
        {aoAcrescentarFilho !== null && (
          <button
            type="button"
            className="p-icone"
            aria-label="Acrescentar subitem"
            title="Acrescentar subitem"
            disabled={ocupado}
            onClick={() => aoAcrescentarFilho(item.id)}
          >
            <IconeCruz />
          </button>
        )}

        <button
          type="button"
          className="p-icone"
          aria-label={`Apagar ${textoDasMencoes(item.name)}`}
          title="Apagar o item — os subitens dele vão junto"
          disabled={ocupado}
          onClick={() => aoApagar(item.id)}
        >
          <IconeFechar />
        </button>
      </div>

      {item.children.length > 0 && (
        <div className="p-filhos">
          {item.children.map((f) => (
            <LinhaDoItem
              key={f.id}
              item={f}
              equipe={equipe}
              meuId={meuId}
              ocupado={ocupado}
              aoResolver={aoResolver}
              aoRenomear={aoRenomear}
              aoAtribuir={aoAtribuir}
              aoApagar={aoApagar}
              /* Nulo: o filho não pode ter filho. */
              aoAcrescentarFilho={null}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ───────────────────────────── o cartão de checklist ───────────────────────────── */

function CartaoDeChecklist({
  lista,
  equipe,
  meuId,
  ocupado,
  aoRenomear,
  aoApagar,
  aoAcrescentar,
  aoResolverItem,
  aoRenomearItem,
  aoAtribuirItem,
  aoApagarItem,
  aoAtribuirTodos,
}: {
  lista: Checklist;
  equipe: readonly TaskPerson[];
  meuId: string | null;
  ocupado: boolean;
  aoRenomear: (id: string, nome: string) => void;
  aoApagar: (id: string) => void;
  aoAcrescentar: (checklistId: string, paiId: string | null) => void;
  aoResolverItem: (id: string, resolvido: boolean) => void;
  aoRenomearItem: (id: string, nome: string) => void;
  aoAtribuirItem: (id: string, userId: string | null) => void;
  aoApagarItem: (id: string) => void;
  aoAtribuirTodos: (checklistId: string, userId: string | null) => void;
}) {
  const [nome, setNome] = useState(lista.name);
  const [menu, setMenu] = useState(false);

  const { resolvidos, total } = contarItens(lista.items);
  const arvore = aninharItens(lista.items);

  return (
    <div className="p-cartao">
      <div className="p-cartao-topo">
        <CampoComMencoes umaLinha
          className="p-cartao-nome"
          value={nome}
          disabled={ocupado}
          aria-label="Nome do checklist"
          aoMudar={setNome}
          onBlur={() => {
            if (nome.trim() !== lista.name && conferirNomeComSentido(nome) === null) {
              aoRenomear(lista.id, nome.trim());
            } else if (conferirNomeComSentido(nome) !== null) {
              setNome(lista.name);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setNome(lista.name);
          }}
        />

        {/* O contador POR EXTENSO — `0 de 0` —, que é a forma da referência. */}
        <span className="p-conta">{porExtenso(resolvidos, total)}</span>

        {/* O ícone de pessoa do canto do cartão. Ele atribui TODOS os itens, que
            é o que ele faz no ClickUp — o responsável, no nosso modelo como no
            dele, é do ITEM. Com o checklist vazio ele fica desativado e o
            `title` diz por quê: botão que não faz nada é pior que botão
            desativado que se explica. */}
        <BotaoDeIcone
          aberto={menu}
          rotulo={
            total === 0
              ? 'Acrescente um item primeiro — o responsável é do item, não do checklist'
              : 'Atribuir todos os itens deste checklist'
          }
          desativado={ocupado || total === 0}
          aoAlternar={() => setMenu((m) => !m)}
          balao={
            <MenuDePessoas
              diretorio={equipe}
              escolhidos={[]}
              meuId={meuId}
              rotulo="Atribuir todos os itens"
              aoMudar={(ids) => {
                aoAtribuirTodos(lista.id, ids[0] ?? null);
                setMenu(false);
              }}
              aoFechar={() => setMenu(false)}
              lado="cima-direita"
            />
          }
        >
          <IconePessoa />
        </BotaoDeIcone>

        <button
          type="button"
          className="p-icone"
          aria-label={`Apagar o checklist ${lista.name}`}
          title="Apagar o checklist — os itens dele vão junto"
          disabled={ocupado}
          onClick={() => aoApagar(lista.id)}
        >
          <IconeFechar />
        </button>
      </div>

      <div className="p-cartao-corpo">
        {arvore.map((i) => (
          <LinhaDoItem
            key={i.id}
            item={i}
            equipe={equipe}
            meuId={meuId}
            ocupado={ocupado}
            aoResolver={aoResolverItem}
            aoRenomear={aoRenomearItem}
            aoAtribuir={aoAtribuirItem}
            aoApagar={aoApagarItem}
            aoAcrescentarFilho={(paiId) => aoAcrescentar(lista.id, paiId)}
          />
        ))}

        <button
          type="button"
          className="p-adicionar"
          disabled={ocupado}
          onClick={() => aoAcrescentar(lista.id, null)}
        >
          + Adicionar item
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────────── as duas seções ───────────────────────────── */

/**
 * OS `?` DAS DUAS SEÇÕES — F43, Fase 6.
 *
 * As duas notas de rodapé ("A subtarefa nasce na mesma lista da mãe." e "A
 * caixa daqui grava no clique…") explicavam a tela, e pela regra da F17.24 —
 * *"explica a tela" vira `?`; "avisa de uma consequência" fica escrito* — foram
 * para o `?` ao lado do título de cada seção. As frases são as MESMAS, sem uma
 * palavra a menos; moram aqui para o teste cobrar o texto inteiro e uma revisão
 * de texto achar as duas num lugar (o desenho de `EXPLICACAO` na grade da
 * semana).
 */
export const SOBRE_DOS_PASSOS = {
  subtarefa: 'onde a subtarefa nasce',
  checklist: 'a caixa do checklist e a do briefing',
} as const;

export const EXPLICACAO_DOS_PASSOS = {
  subtarefa: 'A subtarefa nasce na mesma lista da mãe.',
  checklist: 'A caixa daqui grava no clique. A caixa - [ ] do briefing só vai junto com Salvar.',
} as const;

export function PassosDaTarefa({
  tarefa,
  equipe,
  meuId,
  hoje,
  ocupado,
  aoAssentar,
  aoErro,
  mostrarSubtarefas = true,
  mostrarChecklists = true,
  focarSubtarefa = false,
  aoFecharSubtarefa,
}: {
  tarefa: TaskDetail;
  equipe: readonly TaskPerson[];
  meuId: string | null;
  hoje: Day;
  ocupado: boolean;
  /** A ficha RELIDA que toda escrita devolve. Ver `server/board-passos.ts`. */
  aoAssentar: (t: TaskDetail) => void;
  aoErro: (mensagem: string) => void;
  /**
   * AS SEÇÕES PODEM FICAR DE FORA — F43, Fase 6.
   *
   * A ficha recolhe a seção vazia na linha "+ Subtarefa · + Checklist · +
   * Anexo" (`secoesVazias`, em `@/board/ficha`) e só a desenha quando há o que
   * mostrar ou quando a pessoa pede. Quem decide é a ficha; aqui só se obedece.
   * Ausentes, as duas valem `true`: as duas seções à vista e a linha de criação
   * aberta, como sempre foi.
   */
  mostrarSubtarefas?: boolean;
  mostrarChecklists?: boolean;
  /** A linha de criação nasce com o foco — a seção acabou de ser pedida pelo "+". */
  focarSubtarefa?: boolean;
  /** Cancelar a linha de criação (botão ou Esc) — a ficha recolhe a seção se ela estiver vazia. */
  aoFecharSubtarefa?: () => void;
}) {
  const [abertoSub, setAbertoSub] = useState(true);
  const [abertoChk, setAbertoChk] = useState(true);
  const [trabalhando, setTrabalhando] = useState(false);

  const ocupadoAgora = ocupado || trabalhando;

  /**
   * Uma porta só para toda escrita desta seção.
   *
   * A frase do banco sai INTEIRA quando ele recusa: as onze travas da F17
   * nomeiam o que está no caminho e o que fazer, e trocá-las por "algo deu
   * errado" jogaria fora o trabalho delas.
   */
  const fazer = async (acao: () => Promise<{ task: unknown }>) => {
    setTrabalhando(true);
    try {
      const r = await acao();
      aoAssentar(r.task as TaskDetail);
    } catch (e) {
      aoErro(e instanceof ApiError ? e.message : 'O banco recusou a operação.');
    } finally {
      setTrabalhando(false);
    }
  };

  /**
   * Trocar o status de uma FILHA, da ficha da mãe.
   *
   * DUAS IDAS, E ELAS SÃO DIFERENTES. A primeira escreve na filha e devolve a
   * ficha DELA; a segunda relê a MÃE, que é a que está na tela. Assentar a
   * resposta da primeira trocaria a ficha aberta pela da subtarefa — a tela
   * inteira mudaria de tarefa por causa de um clique num pontinho.
   */
  const trocarStatusDaFilha = (subId: string, statusId: string) => {
    void (async () => {
      setTrabalhando(true);
      try {
        await api.salvarTarefaDoQuadro(subId, { statusId });
        const r = await api.tarefaDoQuadro(tarefa.id);
        aoAssentar(r.task as TaskDetail);
      } catch (e) {
        aoErro(e instanceof ApiError ? e.message : 'O banco recusou a troca de status.');
      } finally {
        setTrabalhando(false);
      }
    })();
  };

  /**
   * Soltar uma FILHA da mãe, da ficha da mãe — F17.AUD01, tarefa 6.
   *
   * Mesmas duas idas de `trocarStatusDaFilha`, pelo mesmo motivo: `DELETE
   * /board/tasks/<filha>/parent` devolve a ficha DA FILHA (`setTaskParent`
   * relê `taskId`), e a que está na tela é a mãe. Antes da vez, assentar essa
   * resposta trocava a ficha da mãe pela da filha; com a vez, `assentar` a
   * descarta — e a mãe ficava parada, com a subtarefa solta ainda listada.
   * Relê-se a mãe, que é o que a tela precisa.
   */
  const soltarFilha = (subId: string) => {
    void (async () => {
      setTrabalhando(true);
      try {
        await api.definirMaeDaTarefa(subId, null);
        const r = await api.tarefaDoQuadro(tarefa.id);
        aoAssentar(r.task as TaskDetail);
      } catch (e) {
        aoErro(e instanceof ApiError ? e.message : 'O banco recusou soltar a subtarefa.');
      } finally {
        setTrabalhando(false);
      }
    })();
  };

  const criarSubtarefa = async (nova: NewSubtask): Promise<boolean> => {
    setTrabalhando(true);
    try {
      const r = await api.criarSubtarefa(tarefa.id, nova);
      aoAssentar(r.task as TaskDetail);
      return true;
    } catch (e) {
      aoErro(e instanceof ApiError ? e.message : 'Não foi possível criar a subtarefa.');
      return false;
    } finally {
      setTrabalhando(false);
    }
  };

  const acrescentarItem = (checklistId: string, paiId: string | null) =>
    void fazer(() =>
      // O nome nasce genérico e editável na hora — o banco recusa nome vazio
      // (`is_meaningful_name`), então "" não é opção. Quem acabou de clicar em
      // `+ Adicionar item` quer digitar, não escolher um nome antes.
      api.criarItemDeChecklist(checklistId, { name: 'Novo item', parentItemId: paiId }),
    );

  const atribuirTodos = (checklistId: string, userId: string | null) => {
    const lista = tarefa.checklists.find((k) => k.id === checklistId);
    if (!lista) return;
    void (async () => {
      setTrabalhando(true);
      try {
        let ultimo: TaskDetail | null = null;
        for (const i of lista.items) {
          const r = await api.salvarItemDeChecklist(i.id, { assigneeId: userId });
          ultimo = r.task as TaskDetail;
        }
        if (ultimo) aoAssentar(ultimo);
      } catch (e) {
        aoErro(e instanceof ApiError ? e.message : 'Não foi possível atribuir os itens.');
      } finally {
        setTrabalhando(false);
      }
    })();
  };

  const vivas = tarefa.subtasks.filter((s) => s.archivedAt === null);
  const arquivadas = tarefa.subtasks.length - vivas.length;

  return (
    <>
      {/* ── Subtarefa ────────────────────────────────────────────────────── */}
      {mostrarSubtarefas && (
        <Secao
          titulo={tarefa.subtasks.length === 0 ? 'Adicionar subtarefa' : 'Subtarefas'}
          contagem={
            tarefa.progress.subtaskCount === 0
              ? undefined
              : porExtenso(tarefa.progress.subtaskDone, tarefa.progress.subtaskCount) + ' concluídas'
          }
          aberto={abertoSub}
          aoAlternar={() => setAbertoSub((a) => !a)}
          ajuda={
            <Ajuda sobre={SOBRE_DOS_PASSOS.subtarefa} lado="baixo">
              <p>{EXPLICACAO_DOS_PASSOS.subtarefa}</p>
            </Ajuda>
          }
        >
          {vivas.map((s) => (
            <LinhaDaSubtarefa
              key={s.id}
              sub={s}
              statuses={tarefa.statuses}
              hoje={hoje}
              ocupado={ocupadoAgora}
              aoTrocarStatus={(statusId) => trocarStatusDaFilha(s.id, statusId)}
              aoSoltar={() => soltarFilha(s.id)}
            />
          ))}

          {/* Arquivada NÃO some, e não conta. `task_progress` a exclui de
              propósito (o cartão do quadro diria 5 e abriria com 3), mas
              escondê-la aqui também faria trabalho arquivado sumir sem rastro. */}
          {arquivadas > 0 && (
            <p className="p-nota">
              {arquivadas} subtarefa(s) arquivada(s) não aparecem acima nem entram na contagem.
              Abra-as pelo endereço delas para desarquivar.
            </p>
          )}

          <LinhaDeSubtarefa
            tarefa={tarefa}
            equipe={equipe}
            meuId={meuId}
            hoje={hoje}
            ocupado={ocupadoAgora}
            aoCriar={criarSubtarefa}
            focar={focarSubtarefa}
            aoCancelar={aoFecharSubtarefa}
          />

          {/* F17.20: de três frases sobrou uma — "a subtarefa nasce na mesma
              lista da mãe". F43, Fase 6: ela explica a tela, e foi para o `?` ao
              lado do título (`SOBRE_DOS_PASSOS.subtarefa`), sem mudar de texto. */}
        </Secao>
      )}

      {/* ── Checklist ────────────────────────────────────────────────────── */}
      {mostrarChecklists && (
        <Secao
          titulo="Checklists"
          contagem={
            tarefa.progress.checklistTotal === 0
              ? undefined
              : porExtenso(tarefa.progress.checklistDone, tarefa.progress.checklistTotal)
          }
          aberto={abertoChk}
          aoAlternar={() => setAbertoChk((a) => !a)}
          ajuda={
            <Ajuda sobre={SOBRE_DOS_PASSOS.checklist} lado="baixo">
              <p>{EXPLICACAO_DOS_PASSOS.checklist}</p>
            </Ajuda>
          }
        >
          {tarefa.checklists.map((k) => (
            <CartaoDeChecklist
              key={k.id}
              lista={k}
              equipe={equipe}
              meuId={meuId}
              ocupado={ocupadoAgora}
              aoRenomear={(id, n) => void fazer(() => api.renomearChecklist(id, n))}
              aoApagar={(id) => void fazer(() => api.apagarChecklist(id))}
              aoAcrescentar={acrescentarItem}
              aoResolverItem={(id, r) => void fazer(() => api.salvarItemDeChecklist(id, { resolved: r }))}
              aoRenomearItem={(id, n) => void fazer(() => api.salvarItemDeChecklist(id, { name: n }))}
              aoAtribuirItem={(id, u) => void fazer(() => api.salvarItemDeChecklist(id, { assigneeId: u }))}
              aoApagarItem={(id) => void fazer(() => api.apagarItemDeChecklist(id))}
              aoAtribuirTodos={atribuirTodos}
            />
          ))}

          <button
            type="button"
            className="p-adicionar"
            disabled={ocupadoAgora}
            onClick={() => void fazer(() => api.criarChecklist(tarefa.id))}
          >
            + Adicionar checklist
          </button>

          {/* ⚠️ ESTA NOTA CITAVA `ideworks.checklist_items` NA TELA — F17.20.
              Nome de tabela do banco, escrito para designer e videomaker lerem.
              É a mesma falha que a F17.19 registrou nas mensagens de recusa
              ("nenhuma mensagem visível ao usuário cita `ideworks.`"), e ela
              estava aqui também, numa nota de rodapé.

              O que sobrou é a única metade acionável: a caixa daqui grava
              sozinha, a do briefing só grava com o Salvar. F43, Fase 6: a frase
              explica a tela, e mora no `?` do título (`SOBRE_DOS_PASSOS.checklist`). */}
        </Secao>
      )}
    </>
  );
}

/* ───────────────────────────── a mãe, no cabeçalho ───────────────────────────── */

/**
 * "Subtarefa de …" — o caminho de volta.
 *
 * Sem isto, abrir uma subtarefa pelo endereço dela seria abrir uma tarefa solta:
 * nada na ficha diria que ela é parte de outra coisa.
 */
export function SeloDaMae({ tarefa }: { tarefa: TaskDetail }) {
  if (tarefa.parentId === null) return null;
  return (
    <Link to={`/tarefa/${tarefa.parentId}`} className="cu-chip" data-cheio="true" style={{ textDecoration: 'none' }}>
      <span aria-hidden="true">↳</span>
      <span className="rotulo">
        subtarefa de {tarefa.parentTitle ?? 'uma tarefa fora do seu alcance'}
      </span>
    </Link>
  );
}
