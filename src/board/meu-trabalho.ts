/**
 * `Meu trabalho` — a camada pura. Etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDA COM ESTA ETAPA
 *   Até aqui o Pilar B tinha UMA tela: o quadro. Quadro é a visão de quem
 *   ORGANIZA — ele começa na lista e pergunta "o que há nesta esteira".
 *
 *   A pessoa que executa faz a pergunta ao contrário: "o que é meu, e para
 *   quando". Nenhuma tela respondia isso. É o que este arquivo modela.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AS TRÊS ABAS, E O QUE `DELEGADO` SIGNIFICA AQUI
 *   `Pendente` e `Feito` são a mesma pergunta partida em duas: o que está
 *   atribuído a mim, em aberto e concluído.
 *
 *   `Delegado` é outro eixo. No ClickUp ele quer dizer "eu criei e outra pessoa
 *   faz". O modelo tem as duas colunas necessárias — `tasks.created_by` e
 *   `task_assignees` — então a regra escolhida é:
 *
 *       criei a tarefa · ela tem responsável · e eu NÃO sou um deles
 *
 *   As três condições são necessárias, e cada uma responde a um erro:
 *
 *     · "eu criei"           — sem isso, `Delegado` viraria "tarefa dos outros",
 *                              que não é delegação, é bisbilhotice;
 *     · "tem responsável"    — tarefa que criei e ninguém pegou não foi
 *                              delegada, foi ESQUECIDA. Chamá-la de delegada
 *                              diria que alguém está cuidando — e não está;
 *     · "eu não sou um deles" — é o que mantém as três abas SEM sobreposição.
 *                              Tarefa que criei e faço já aparece em `Pendente`;
 *                              contá-la duas vezes faria a soma das abas mentir
 *                              sobre quanto trabalho existe.
 *
 *   Concluída CONTINUA em `Delegado`. `Feito` é o par de `Pendente`; se
 *   `Delegado` largasse a concluída, ela sumiria das três abas e o que foi
 *   entregue viraria trabalho invisível. O selo de prazo aparece apagado — é o
 *   `dueState` da F17.9a fazendo o que já fazia: tarefa concluída não atrasa.
 *
 *   A REGRA CONTINUA MORANDO AQUI, E O SERVIDOR PASSOU A CONSUMI-LA — F17.AUD05.
 *   Ela é a tabela `ESPECIFICACAO_DAS_ABAS`: `abaDaLinha` deriva dela no
 *   navegador, e `server/board-trabalho.ts` gera o `where` de cada aba a partir
 *   da mesma tabela, para filtrar a aba ANTES do teto e contar cada aba inteira.
 *   Não há segunda cópia da regra em SQL.
 *
 * OS QUATRO GRUPOS DIZEM *QUANDO ERA*, E A COR DIZ SE É ALARME
 *   `Hoje` · `Em atraso` · `Próximo` · `Não programado` saem da DATA, e só
 *   dela. A cor do selo sai de `dueState`, que nunca pinta de vermelho o prazo
 *   de trabalho já entregue.
 *
 *   São duas perguntas diferentes e por isso duas contas diferentes. O efeito
 *   colateral é bom: em `Feito`, o grupo `Em atraso` é exatamente "o que foi
 *   entregue depois do prazo" — informação que some se o grupo for calculado
 *   pela conclusão.
 *
 * ⚠️ NENHUM `new Date()` LÊ DATA AQUI
 *   Existe tarefa real com `due_on` no ano 82025. `new Date('82025-08-07')`
 *   devolve `+082025-08-07` no `toISOString()`, e todo `.slice(0, 10)` do
 *   projeto sairia errado. A leitura é a de `@/board/board` (texto por pedaços)
 *   e a aritmética é a de `@/board/calendario` (inteiro, sem `Date`). `Date`
 *   aparece uma vez só no projeto, para responder "que dia é hoje".
 */

import {
  type BoardTask,
  type Day,
  type StatusType,
  compareDay,
  parseDay,
} from '@/board/board';
// A aritmética de dia SEM `Date`, que a F17.10b escreveu para o seletor de
// data. Reusada, e não recriada: "quantos dias faltam" é a mesma conta, e uma
// segunda versão dela seria a segunda verdade sobre o ano 82025.
import { diasDesdeEpoca } from '@/board/calendario';

/* ───────────────────────────── a linha ───────────────────────────── */

/**
 * Uma tarefa vista de fora da lista dela.
 *
 * ELA ESTENDE `BoardTask`, e isso não é economia de digitação: é o que permite
 * o MESMO cartão desenhar no quadro da lista e no quadro de `Todas as tarefas`.
 * Dois tipos parecidos dariam dois cartões parecidos, e eles divergiriam na
 * primeira etapa que mexesse num só.
 *
 * O que se acrescenta é o que o quadro da lista não precisa saber porque já
 * sabe: de que lista a tarefa é, e qual é a trilha até ela.
 */
export type WorkRow = BoardTask & {
  /* --- a trilha `empresa / espaço / lista` --- */
  categoryName: string | null;
  spaceName: string | null;
  folderName: string | null;
  listId: string | null;
  listName: string | null;
  /**
   * Se a corrente inteira até esta lista está viva — `ideworks.tree.is_live`.
   *
   * Tarefa em lista arquivada continua sendo minha. Escondê-la esconderia
   * trabalho; mostrá-la sem dizer que a lista saiu de circulação faria a pessoa
   * procurar um quadro que não abre mais.
   */
  listLive: boolean;

  /* --- o status, com a cor da esteira --- */
  statusName: string | null;
  statusType: StatusType | null;
  statusColor: string | null;
  /**
   * A posição da etapa dentro da esteira dela. Opcional: só as leituras que
   * desenham colunas por ETAPA precisam dela (ver `colunasPorEtapa`).
   */
  statusSortOrder?: number | null;

  /* --- quem --- */
  assignedToMe: boolean;
  createdByMe: boolean;
  /** Quantos responsáveis que NÃO sou eu. É o que sustenta a regra do `Delegado`. */
  otherAssignees: number;
};

/* ───────────────────────────── as abas ───────────────────────────── */

export type Aba = 'pendente' | 'feito' | 'delegado';

export const ABAS: readonly Aba[] = ['pendente', 'feito', 'delegado'] as const;

export const ROTULO_DA_ABA: Record<Aba, string> = {
  pendente: 'Pendente',
  feito: 'Feito',
  delegado: 'Delegado',
};

/*
  ⚠️ AQUI HAVIA `EXPLICACAO_DA_ABA`, E ELA SAIU NA F17.20.

  Eram três frases descrevendo o que cada aba faz, desenhadas sob a fila de
  abas — a nota que o briefing desta etapa chama de "diz o que a aba faz". Uma
  aba chamada `Pendente` com a contagem ao lado não precisa de um parágrafo
  dizendo que é o que está pendente.

  O que a regra do `Delegado` significa continua escrito no cabeçalho deste
  arquivo, que é onde ela mora e tem teste. O que saiu foi a cópia dela na tela.
*/

/**
 * OS QUATRO FATOS DE QUE AS ABAS DEPENDEM — e só eles. F17.AUD05.
 *
 * `abaDaLinha` olhava quatro campos da linha e mais nada. Nomeá-los é o que
 * permite escrever a regra como TABELA (logo abaixo) em vez de como `if`: cada
 * fato tem um nome aqui e uma expressão SQL no servidor, e a tabela é a mesma
 * dos dois lados.
 */
export type FatosDaLinha = {
  assignedToMe: boolean;
  /** `completedAt !== null`. */
  completed: boolean;
  createdByMe: boolean;
  /** `otherAssignees > 0`. */
  hasOthers: boolean;
};

export const FATOS: readonly (keyof FatosDaLinha)[] = [
  'assignedToMe',
  'completed',
  'createdByMe',
  'hasOthers',
] as const;

/**
 * O que uma aba EXIGE de cada fato. Fato ausente é "tanto faz".
 */
export type CondicaoDaAba = Partial<FatosDaLinha>;

/**
 * A REGRA MORA AQUI E SÓ AQUI — agora como dados. F17.AUD05.
 *
 * Até a AUD05 a regra era um `if` em `abaDaLinha`, e o servidor não a conhecia:
 * ele trazia a rede grossa ("tarefas que me dizem respeito", até 500) e a tela
 * separava as abas. A auditoria mediu o preço: 500 concluídas antigas e uma
 * pendente posterior, e a pendente ficava fora do lote — `Pendente 0`.
 *
 * Filtrar a aba no banco, ANTES do teto, exige que o banco conheça a regra. A
 * saída óbvia — escrever o `where` à mão em `board-trabalho.ts` — seria a
 * segunda verdade sobre o `Delegado`, e a de baixo ganharia calada. Por isso a
 * regra virou esta tabela: `abaDaLinha` deriva dela, e `predicadoDaAba`, no
 * servidor, gera o `where` a partir DELA. Mudar a regra é mudar uma linha
 * daqui, e os dois lados mudam juntos.
 *
 * O que cada linha diz (a leitura por extenso continua no cabeçalho do arquivo):
 *
 *   pendente  — atribuída a mim, em aberto.
 *   feito     — atribuída a mim, concluída.
 *   delegado  — criei, tem responsável, e eu NÃO sou um deles. O
 *               `assignedToMe: false` é o que mantém as três abas sem
 *               sobreposição; `completed` não entra, porque a delegada concluída
 *               CONTINUA em `Delegado`.
 *
 * `src/board/meu-trabalho.test.ts` percorre as dezesseis combinações dos quatro
 * fatos e confere que (1) a tabela dá a mesma resposta que a regra escrita por
 * extenso e (2) nenhuma combinação cai em duas abas — é isso que faz as
 * contagens do servidor, uma por aba, nunca contarem a mesma tarefa duas vezes.
 */
export const ESPECIFICACAO_DAS_ABAS: Record<Aba, CondicaoDaAba> = {
  pendente: { assignedToMe: true, completed: false },
  feito: { assignedToMe: true, completed: true },
  delegado: { assignedToMe: false, createdByMe: true, hasOthers: true },
};

export function fatosDaLinha(
  row: Pick<WorkRow, 'assignedToMe' | 'completedAt' | 'createdByMe' | 'otherAssignees'>,
): FatosDaLinha {
  return {
    assignedToMe: row.assignedToMe,
    completed: row.completedAt !== null,
    createdByMe: row.createdByMe,
    hasOthers: row.otherAssignees > 0,
  };
}

/** Os fatos satisfazem a condição? Fato que a condição não cita é ignorado. */
export function satisfaz(fatos: FatosDaLinha, condicao: CondicaoDaAba): boolean {
  return FATOS.every((f) => condicao[f] === undefined || condicao[f] === fatos[f]);
}

/**
 * Em que aba esta linha mora. `null` quando em nenhuma.
 *
 * Deriva de `ESPECIFICACAO_DAS_ABAS` — ver o cabeçalho dela. A consulta do
 * servidor consome a MESMA tabela; esta função é a leitura dela no navegador.
 */
export function abaDaLinha(row: WorkRow): Aba | null {
  const fatos = fatosDaLinha(row);
  for (const aba of ABAS) if (satisfaz(fatos, ESPECIFICACAO_DAS_ABAS[aba])) return aba;
  return null;
}

export function filtrarPorAba(linhas: readonly WorkRow[], aba: Aba): WorkRow[] {
  return linhas.filter((l) => abaDaLinha(l) === aba);
}

export function contarPorAba(linhas: readonly WorkRow[]): Record<Aba, number> {
  const contas: Record<Aba, number> = { pendente: 0, feito: 0, delegado: 0 };
  for (const l of linhas) {
    const aba = abaDaLinha(l);
    if (aba !== null) contas[aba] += 1;
  }
  return contas;
}

/* ───────────────────────────── os grupos ───────────────────────────── */

export type Grupo = 'hoje' | 'atraso' | 'proximo' | 'sem-data';

/** A ordem é a da referência do ClickUp, e ela não se ordena sozinha. */
export const ORDEM_DOS_GRUPOS: readonly Grupo[] = [
  'hoje',
  'atraso',
  'proximo',
  'sem-data',
] as const;

export const ROTULO_DO_GRUPO: Record<Grupo, string> = {
  hoje: 'Hoje',
  atraso: 'Em atraso',
  proximo: 'Próximo',
  'sem-data': 'Não programado',
};

/**
 * O que o grupo vazio diz — encurtado na F17.20.
 *
 * Eram quatro frases inteiras, uma por grupo, cada uma dentro de uma caixa com
 * borda. Com a contagem `0` ao lado do nome do grupo, a frase comprida repetia
 * o que o número já dizia. Ficou a linha curta, sem caixa.
 *
 * O ClickUp escreve *"Sem tarefas atrasadas ou lembretes agendados"*. Lembrete
 * não existe no modelo, então nenhuma destas o cita — prometer uma coisa que a
 * tela não tem é a mesma mentira de um botão morto, escrita em vez de clicável.
 */
export const VAZIO_DO_GRUPO: Record<Grupo, string> = {
  hoje: 'Nada para hoje.',
  atraso: 'Nada em atraso.',
  proximo: 'Nada programado.',
  'sem-data': 'Nada sem prazo.',
};

/**
 * Em que grupo esta linha cai, pelo PRAZO e só por ele.
 *
 * Prazo ilegível cai em `Não programado` junto com o ausente, e é o menos
 * errado dos destinos: a linha continua aparecendo (a tela mostra o valor cru),
 * e ela não entra em `Em atraso`, onde viraria alarme falso permanente.
 */
export function grupoDaLinha(row: { dueOn: string | null }, hoje: Day): Grupo {
  const prazo = parseDay(row.dueOn);
  if (prazo === null) return 'sem-data';
  const d = compareDay(prazo, hoje);
  if (d === 0) return 'hoje';
  if (d < 0) return 'atraso';
  return 'proximo';
}

export type GrupoDeTrabalho = {
  chave: Grupo;
  rotulo: string;
  vazio: string;
  linhas: WorkRow[];
};

/**
 * Os quatro grupos, sempre os quatro, na ordem da referência.
 *
 * GRUPO VAZIO NÃO SOME. Sumir com `Em atraso` quando não há atraso obrigaria a
 * pessoa a lembrar que o grupo existe para confiar que não há nada nele — e
 * "não vi" e "não tem" passariam a ser a mesma imagem. É a mesma decisão que a
 * coluna vazia do quadro (F17.9a) já tomou.
 */
export function agrupar(linhas: readonly WorkRow[], hoje: Day): GrupoDeTrabalho[] {
  const cestos = new Map<Grupo, WorkRow[]>(ORDEM_DOS_GRUPOS.map((g) => [g, []]));
  for (const l of linhas) cestos.get(grupoDaLinha(l, hoje))?.push(l);
  return ORDEM_DOS_GRUPOS.map((chave) => ({
    chave,
    rotulo: ROTULO_DO_GRUPO[chave],
    vazio: VAZIO_DO_GRUPO[chave],
    linhas: cestos.get(chave) ?? [],
  }));
}

/* ───────────────────────────── a etiqueta de prazo ───────────────────────────── */

/**
 * O que vai escrito à direita da linha: `Hoje`, `Amanhã`, ou a data.
 *
 * `Ontem` NÃO existe aqui de propósito: o grupo já disse `Em atraso`, e repetir
 * a palavra na linha gastaria a largura sem acrescentar nada. Data que não se
 * deixa ler volta CRUA — some-la apagaria da tela o único sinal de que existe
 * um valor torto no banco.
 *
 * ⚠️ "AMANHÃ" É DIFERENÇA DE DIAS, E `compareDay` NÃO A DÁ.
 *   `compareDay` devolve um SINAL — `ano-ano || mês-mês || dia-dia` —, então
 *   `10/09` contra `26/08` devolve `1` por causa do mês, e a primeira versão
 *   desta função escrevia "Amanhã" para uma tarefa a quinze dias. O teste pegou
 *   na primeira execução.
 *
 *   A conta certa é aritmética de dia, e ela já existe: `diasDesdeEpoca`, em
 *   `@/board/calendario`, converte data civil em inteiro pelo algoritmo de
 *   Howard Hinnant — sem `Date`, sem laço e sem limite de ano, inclusive 82025.
 */
export function etiquetaDePrazo(iso: string | null, hoje: Day): string | null {
  if (iso === null || iso.trim() === '') return null;
  const prazo = parseDay(iso);
  if (prazo === null) return iso;
  const d = diasDesdeEpoca(prazo) - diasDesdeEpoca(hoje);
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Amanhã';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(prazo.day)}/${pad(prazo.month)}/${prazo.year}`;
}

/* ───────────────────────────── a trilha ─────────────────────────────
   ⚠️ `trilha(row): string[]` MORAVA AQUI E SAIU NA F17.25.

   Ela devolvia `empresa / espaço / pasta / lista` como texto, e só esta tela a
   usava. A F17.25 fez a trilha virar uma peça só para as quatro telas do Pilar
   B — com ícone por nível e com a lista clicável —, e para isso ela precisa dos
   IDs, não só dos nomes. Manter as duas daria duas verdades sobre o mesmo
   caminho, e a de texto ficaria para trás na primeira mudança.

   O que ela garantia continua garantido, em `degrausDaArvore` de
   `@/board/trilha`, e os três testes dela foram reescritos lá: o pedaço que
   falta SOME em vez de virar buraco, e tarefa sem lista devolve trilha vazia
   para a tela escrever "sem lista".
   ─────────────────────────────────────────────────────────────────────────── */

/* ───────────────────────────── o quadro de tudo ───────────────────────────── */

/**
 * `Todas as tarefas` também abre em QUADRO — e o quadro dela não pode usar
 * esteira nenhuma.
 *
 * A esteira é por lista (F17.2): com nove esteiras diferentes ao alcance, não
 * existe uma coluna `a fazer` que signifique a mesma coisa em todas. O único
 * vocabulário que TODA esteira fala é o **tipo** do status — os cinco que o
 * ClickUp define e que a F17.2 copiou sem traduzir.
 *
 * Então as colunas são os cinco tipos, e uma sexta para o que não tem status.
 * É por isso, também, que o cartão dali NÃO se arrasta: soltar num tipo não diz
 * em qual status daquela esteira a tarefa deve cair, e adivinhar seria mover o
 * trabalho de alguém para um lugar que ninguém pediu.
 */
export const ORDEM_DOS_TIPOS: readonly StatusType[] = [
  'open',
  'unstarted',
  'custom',
  'done',
  'closed',
] as const;

export const ROTULO_DO_TIPO: Record<StatusType, string> = {
  open: 'Aberto',
  unstarted: 'Não começou',
  custom: 'Em andamento',
  done: 'Pronto',
  closed: 'Fechado',
};

export type ColunaPorTipo = {
  /** `null` é a coluna do que não tem status — ela só aparece se houver algo nela. */
  tipo: StatusType | null;
  rotulo: string;
  linhas: WorkRow[];
};

export function colunasPorTipo(linhas: readonly WorkRow[]): ColunaPorTipo[] {
  const cestos = new Map<StatusType | null, WorkRow[]>(
    ORDEM_DOS_TIPOS.map((t) => [t as StatusType | null, [] as WorkRow[]]),
  );
  const semStatus: WorkRow[] = [];

  for (const l of linhas) {
    if (l.statusType === null) semStatus.push(l);
    else cestos.get(l.statusType)?.push(l);
  }

  const colunas: ColunaPorTipo[] = ORDEM_DOS_TIPOS.map((tipo) => ({
    tipo,
    rotulo: ROTULO_DO_TIPO[tipo],
    linhas: cestos.get(tipo) ?? [],
  }));

  // A coluna do sem-status só existe quando há alguém nela: ao contrário das
  // cinco de cima, ela não é o desenho de um fluxo — é um defeito de dado, e
  // desenhá-la vazia todo dia ensinaria a ignorá-la no dia em que encher.
  if (semStatus.length > 0) {
    colunas.push({ tipo: null, rotulo: 'Sem status', linhas: semStatus });
  }
  return colunas;
}

/* ───────────────────────────── o quadro por etapa ───────────────────────────── */

/**
 * O quadro de `Minhas tarefas` — colunas pelas ETAPAS reais, como nos times.
 *
 * POR QUE NÃO O TIPO
 *   Pelo tipo, `Aprovação`, `Alteração` e `Em edição` são todas `custom` e
 *   caíam juntas em `Em andamento`: quem tinha dez vídeos esperando aprovação
 *   via dez vídeos "em andamento". A pessoa reconhece as etapas pelo NOME que
 *   vê no quadro do time, e é por ele que esta tela agrupa.
 *
 * JUNTAR PELO NOME AQUI É SEGURO PORQUE O CARTÃO NÃO ARRASTA
 *   `Aprovação` de duas esteiras são duas etapas no banco (ver
 *   `@/board/lista-kanban`). Este quadro só LÊ: juntá-las numa coluna não move
 *   nada para lugar nenhum. A chave é tipo + nome normalizado, para que um
 *   mesmo nome com tipos diferentes não misture fluxo aberto com fechado.
 *
 * A ORDEM
 *   Primeiro a do tipo (aberto → não começou → em andamento → pronto →
 *   fechado), depois a posição da etapa na esteira (a menor vista), depois o
 *   nome. É a ordem em que o time lê o próprio quadro.
 *
 * AS COLUNAS SAEM DE `base`, OS CARTÕES DE `linhas`
 *   Com busca, `linhas` é o recorte e `base` é o lote inteiro da aba: a coluna
 *   continua no lugar e diz que está vazia por causa da busca, em vez de sumir.
 */
export type ColunaPorEtapa = {
  /** `null` é a coluna do que não tem status. */
  chave: string | null;
  rotulo: string;
  tipo: StatusType | null;
  cor: string | null;
  linhas: WorkRow[];
};

function chaveDaEtapa(l: Pick<WorkRow, 'statusName' | 'statusType'>): string | null {
  if (l.statusType === null || l.statusName === null || l.statusName.trim() === '') return null;
  return `${l.statusType}:${normalizarBusca(l.statusName.trim())}`;
}

export function colunasPorEtapa(linhas: readonly WorkRow[], base: readonly WorkRow[] = linhas): ColunaPorEtapa[] {
  type Molde = { coluna: ColunaPorEtapa; ordem: number; tipo: number };
  const moldes = new Map<string, Molde>();
  let temSemStatus = false;

  for (const l of [...base, ...linhas]) {
    const chave = chaveDaEtapa(l);
    if (chave === null) {
      temSemStatus = true;
      continue;
    }
    const ordem = l.statusSortOrder ?? Number.POSITIVE_INFINITY;
    const ja = moldes.get(chave);
    if (ja) {
      if (ordem < ja.ordem) ja.ordem = ordem;
      if (ja.coluna.cor === null) ja.coluna.cor = l.statusColor;
      continue;
    }
    const tipo = l.statusType as StatusType;
    moldes.set(chave, {
      coluna: { chave, rotulo: (l.statusName as string).trim(), tipo, cor: l.statusColor, linhas: [] },
      ordem,
      tipo: ORDEM_DOS_TIPOS.indexOf(tipo),
    });
  }

  const semStatus: WorkRow[] = [];
  for (const l of linhas) {
    const chave = chaveDaEtapa(l);
    if (chave === null) semStatus.push(l);
    else moldes.get(chave)?.coluna.linhas.push(l);
  }

  const colunas = [...moldes.values()]
    .sort(
      (a, b) =>
        a.tipo - b.tipo ||
        (a.ordem === b.ordem ? 0 : a.ordem < b.ordem ? -1 : 1) ||
        a.coluna.rotulo.localeCompare(b.coluna.rotulo, 'pt-BR'),
    )
    .map((m) => m.coluna);

  // Como no quadro por tipo: o sem-status é defeito de dado, e só aparece com alguém nele.
  if (temSemStatus) {
    colunas.push({ chave: null, rotulo: 'Sem status', tipo: null, cor: null, linhas: semStatus });
  }
  return colunas;
}

/* ───────────────────────────── as duas formas ───────────────────────────── */

export type Forma = 'lista' | 'quadro';

/**
 * A lista fechada das formas — F17.24.
 *
 * Ela existe porque a forma escolhida passou a morar no ENDEREÇO, e o que vem
 * da barra de endereço precisa ser conferido contra uma lista. Escrever
 * `['lista','quadro']` na tela E aqui daria duas listas para a mesma verdade —
 * é o mesmo motivo de `ABAS` existir logo acima.
 */
export const FORMAS: readonly Forma[] = ['lista', 'quadro'] as const;

/* ───────────────────────────── a busca pessoal — F05 do plano UX ───────────────────────────── */

/**
 * O texto como a busca o compara: sem acento e sem caixa. "Revisão", "revisao"
 * e "REVISÃO" acham a mesma tarefa — quem digita no celular não põe acento.
 */
export function normalizarBusca(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

/**
 * As linhas CARREGADAS que o texto acha — no título e no lugar (empresa,
 * espaço, pasta, lista). É filtro do LOTE, e a tela diz isso: a busca que
 * alcança o banco inteiro é a de `Todas as tarefas`.
 */
export function filtrarPorTexto<T extends Pick<WorkRow, 'title' | 'categoryName' | 'spaceName' | 'folderName' | 'listName'>>(
  linhas: readonly T[],
  texto: string,
): readonly T[] {
  const termo = normalizarBusca(texto.trim());
  if (termo === '') return linhas;
  return linhas.filter((t) =>
    normalizarBusca([t.title, t.categoryName, t.spaceName, t.folderName, t.listName].filter(Boolean).join(' ')).includes(
      termo,
    ),
  );
}

/** Uma lista onde moram as tarefas à vista. */
export type ListaDasTarefas = {
  id: string;
  nome: string;
  /** Onde ela fica (pasta ou espaço) — só quando outra lista à vista tem o MESMO nome. */
  lugar: string | null;
  tarefas: number;
};

/**
 * `Listas destas tarefas` — F05 (antes `Suas listas`).
 *
 * A ORIGEM É O LOTE À VISTA, e o nome diz isso: não é histórico de acesso,
 * nem "recentes". As listas saem das linhas desenhadas, contadas, as que têm
 * mais tarefas primeiro (empate: a ordem em que apareceram).
 *
 * ⚠️ O VÍNCULO É PELO ID. Duas listas chamadas `Criação` em clientes
 * diferentes são duas entradas, cada uma levando ao seu quadro — e ganham o
 * lugar ao lado do nome, senão seriam dois botões iguais para destinos
 * diferentes. Lista arquivada fica fora: o quadro dela não abre.
 */
export function listasDestasTarefas(linhas: readonly WorkRow[], maximo = 4): ListaDasTarefas[] {
  const porId = new Map<string, { nome: string; lugar: string | null; tarefas: number; ordem: number }>();
  for (const t of linhas) {
    if (!t.listLive || !t.listId || !t.listName) continue;
    const ja = porId.get(t.listId);
    if (ja) ja.tarefas += 1;
    else porId.set(t.listId, { nome: t.listName, lugar: t.folderName ?? t.spaceName ?? null, tarefas: 1, ordem: porId.size });
  }
  const escolhidas = [...porId]
    .sort(([, a], [, b]) => b.tarefas - a.tarefas || a.ordem - b.ordem)
    .slice(0, maximo);
  const vezes = new Map<string, number>();
  for (const [, l] of escolhidas) vezes.set(normalizarBusca(l.nome), (vezes.get(normalizarBusca(l.nome)) ?? 0) + 1);
  return escolhidas.map(([id, l]) => ({
    id,
    nome: l.nome,
    lugar: (vezes.get(normalizarBusca(l.nome)) ?? 0) > 1 ? l.lugar : null,
    tarefas: l.tarefas,
  }));
}

/**
 * O endereço da busca GERAL com o texto da pessoal — F05. Mesmo parâmetro
 * (`busca`) que `Todas as tarefas` já lê; o teto é o da consulta dela.
 */
export function enderecoDaBuscaGeral(texto: string, teto: number): string {
  const limpo = texto.trim().slice(0, teto);
  return limpo === '' ? '/tarefas' : `/tarefas?${new URLSearchParams({ busca: limpo }).toString()}`;
}

/* ───────────────────── a aba sem nada — F06C (revisão de 28/09, R07) ───────────────────── */

/**
 * O QUE `Minhas tarefas` DIZ QUANDO A ABA ESTÁ VAZIA DE VERDADE.
 *
 * Antes eram quatro grupos "Nada…" empilhados (Hoje, Em atraso, Próximo, Não
 * programado): quatro linhas para dizer uma coisa só. Com a aba confirmada
 * vazia (resposta do servidor, sem busca), a tela diz UMA frase e oferece as
 * saídas que existem: a outra aba que tem algo e `Todas as tarefas` (só para
 * quem a alcança). Com pelo menos uma tarefa, os grupos voltam como antes.
 *
 * `contagens` nulas (ainda não chegaram) não inventam número no rótulo.
 */
export type SaidaDoVazio = { tipo: 'aba'; aba: Aba; rotulo: string } | { tipo: 'todas'; rotulo: string };

export function vazioDaAba(
  aba: Aba,
  contagens: Record<Aba, number> | null,
  alcancaTodas: boolean,
): { titulo: string; frase: string; saidas: SaidaDoVazio[] } {
  const texto: Record<Aba, { titulo: string; frase: string }> = {
    pendente: {
      titulo: 'Nada pendente com você',
      frase: 'Quando uma tarefa for atribuída a você, ela aparece aqui, agrupada por prazo.',
    },
    feito: {
      titulo: 'Nenhuma tarefa concluída por você',
      frase: 'As tarefas suas que forem concluídas aparecem aqui.',
    },
    delegado: {
      titulo: 'Nada delegado',
      frase: 'Tarefas que você criou para outras pessoas aparecem aqui.',
    },
  };
  const VER: Record<Aba, string> = { pendente: 'Ver pendentes', feito: 'Ver concluídas', delegado: 'Ver delegadas' };
  const rotuloDa = (a: Aba) => {
    const n = contagens?.[a];
    return n === undefined ? VER[a] : `${VER[a]} (${n})`;
  };
  // A outra saída de aba: `Delegado` a partir de Pendente/Feito; `Pendente` a partir de Delegado.
  const outra: Aba = aba === 'delegado' ? 'pendente' : 'delegado';
  const saidas: SaidaDoVazio[] = [{ tipo: 'aba', aba: outra, rotulo: rotuloDa(outra) }];
  if (alcancaTodas) saidas.push({ tipo: 'todas', rotulo: 'Todas as tarefas' });
  return { ...texto[aba], saidas };
}
