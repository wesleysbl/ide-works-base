/** Tipos, frases e agrupamento das notificações de menção, automação e prazo.
 * O servidor resolve nomes e chaves; as políticas do banco limitam o acesso.
 */

import { type Day, parseDay } from '@/board/board';
// A aritmética de dia SEM `Date`, do seletor de data da F17.10b. A mesma que
// `etiquetaDePrazo` usa em `@/board/meu-trabalho`, e pelo mesmo motivo: `new
// Date('82025-08-07')` não existe, e a subtração de mês devolveria "amanhã"
// para uma tarefa a quinze dias.
import { diasDesdeEpoca } from '@/board/calendario';
import { chaveDoDia, horaDaMensagem, instanteDaMensagem, rotuloDoDia } from '@/chat/mensagens';

/* ───────────────────────────── o vocabulário ───────────────────────────── */

/** Fontes disponíveis na caixa de notificações. */
export const TIPOS_DE_AVISO = [
  // F42, Fase 7: a resposta do cliente vem PRIMEIRO — é a única notícia da
  // caixa que vem de fora da agência, e ela destrava (ou devolve) o trabalho.
  'aprovacao',
  'mencao',
  'mencao_chat',
  'atribuicao',
  'automacao',
  'prazo',
  'agente',
  'controle',
] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];

/** Cada grupo mantém a ordem de sua consulta: ocorrência ou vencimento. */
export const ROTULO_DO_TIPO: Record<TipoDeAviso, string> = {
  mencao: 'Mencionaram você',
  mencao_chat: 'Mencionaram você no chat',
  atribuicao: 'Adicionaram você como responsável',
  automacao: 'Chegou para você',
  prazo: 'Prazo virando',
  agente: 'Um agente de IA escreveu por você',
  controle: 'Controle da semana',
  aprovacao: 'O cliente respondeu',
};

/**
 * O QUE UM AGENTE FEZ QUE MERECE A SUA ATENÇÃO — F21.3.
 *
 * São TRÊS, e a lista é curta de propósito. Comentário de rotina NÃO está
 * aqui: um agente que ajuda numa carteira comenta dezenas de vezes por dia, e
 * dezenas de avisos por dia ensinam a pessoa a ignorar a caixa inteira —
 * inclusive no dia em que o aviso importava.
 *
 * | Caso    | Por que ele merece aviso                                        |
 * |---------|-----------------------------------------------------------------|
 * | `move`  | Mudou o card de lugar: mexe no que a equipe vê no quadro         |
 * | `limit` | O agente bateu o teto do dia e PAROU — trabalho deixou de andar  |
 * | `first` | A primeira escrita de uma conexão: "foi você mesmo que ligou?"   |
 *
 * ⚠️ `first` e `limit` podem cair na MESMA escrita (uma conexão de teto um, na
 * estreia). São DOIS avisos, com duas chaves e dois vistos, e não um só: são
 * duas perguntas diferentes — *foi você quem ligou isto?* e *quer liberar mais
 * cota?* — e juntar as duas numa linha faria a pessoa responder só a primeira.
 */
export const EVENTOS_DE_AGENTE = ['move', 'limit', 'first'] as const;
export type EventoDeAgente = (typeof EVENTOS_DE_AGENTE)[number];

/** F26.6 — onde o agente escreveu: numa tarefa, no mural ou no histórico do cliente. */
export type AlvoDoAgente = 'task' | 'mural_note' | 'history_entry';

/** O aviso de agente aponta o CLIENTE, e não uma tarefa (F26.6). */
export function avisoApontaCliente(a: Aviso): boolean {
  return (a.targetKind === 'mural_note' || a.targetKind === 'history_entry') && !!a.clientId;
}

/**
 * Quantos dias à frente o prazo já é "virando".
 *
 * UM. Hoje e amanhã — e tudo o que já passou, que entra sem teto porque tarefa
 * atrasada não deixa de ser urgente por ficar velha.
 *
 * Vive aqui, e não solto na consulta, porque a tela também precisa dele para
 * escrever a frase certa: uma janela de três dias na consulta com um "Vence
 * amanhã" na tela seria a caixa mostrando aviso que a frase não sabe explicar.
 */
export const DIAS_DE_ANTECEDENCIA = 1;

/* ───────────────────────────── o aviso ───────────────────────────── */

/**
 * Um aviso, já resolvido pelo servidor.
 *
 * Os nomes — regra, lista, etapa, cliente — vêm resolvidos na hora de ler, e
 * não copiados ao lado do id: é a decisão de `task_assignees` desde a F4.8,
 * *"copia nao se atualiza quando a pessoa muda de nome"*. A única cópia é
 * `automationName`, que é o retrato do nome da regra no instante em que ela
 * rodou — a regra pode ter sido apagada, e o livro não se reescreve.
 */
export type Aviso = {
  /**
   * A chave do "já vi isto". OPACA: montada pela consulta que desenha o aviso,
   * e por ninguém mais. A tela a devolve como veio, sem nunca a interpretar.
   *
   * ⚠️ No aviso de prazo ela carrega a DATA. É o que faz o aviso VOLTAR quando
   * o prazo muda: marcar "vi que vence dia 01" e a tarefa passar para o dia 03
   * é um fato novo, e um visto antigo que o calasse esconderia a mudança
   * justamente de quem precisa dela.
   */
  key: string;
  tipo: TipoDeAviso;

  taskId: string;
  taskTitle: string;
  listId?: string | null;
  actorName?: string | null;
  commentId?: string | null;
  /** Menção no chat (F20.8): conversa e mensagem destacada. */
  conversationId?: string | null;
  messageId?: string | null;
  listName: string | null;
  clientName: string | null;

  /** Quando a menção ou a automação ocorreu. */
  occurredAt: string | null;
  /** O prazo, como texto. Só o aviso de prazo tem. */
  dueOn: string | null;

  /** O retrato do nome da regra. Só o aviso de automação tem. */
  automationName: string | null;
  fromListName: string | null;
  toListName: string | null;
  toStatusName: string | null;

  /**
   * F21.3 — o que o agente fez. Só o aviso de agente tem.
   *
   * O tipo `agente` sozinho não basta para escrever a frase: mover um card,
   * bater o teto e estrear são três notícias diferentes para a mesma pessoa.
   */
  agentEvent?: EventoDeAgente | null;
  /**
   * O nome da conexão que agiu, para a pessoa reconhecer QUAL das suas
   * conexões foi — ela não conhece o vocabulário técnico, e "concessão
   * 9f3a…" não diz nada a ninguém.
   *
   * ⚠️ ELE É DECLARADO POR QUEM SE CONECTA, E NÃO ESCOLHIDO PELO DONO.
   *   Sai do `client_name` que o próprio cliente OAuth registra, cortado em
   *   80 caracteres por `grantName()` em `@/integrations/handler`. O dono
   *   nunca digitou este texto: ele o herdou de quem pediu a conexão.
   *
   *   Não é injeção — o React escapa o que desenha, e a frase inteira é
   *   texto. Mas É um nome que pode mentir: nada impede um cliente de se
   *   anunciar como "Sistema Ide" ou "Suporte oficial". Por isso a frase
   *   NUNCA usa este nome como autoridade ("X autorizou", "X confirmou"):
   *   ele só identifica de qual conexão veio a escrita, e todo caminho de
   *   ação aponta a tela de conexões, onde os fatos do servidor estão.
   *
   *   Deixar o dono renomear a conexão é decisão da Fase 5, que mexe na
   *   tela. Até lá, o texto é de quem se conectou — e quem ler isto depois
   *   precisa saber disso antes de confiar no campo.
   */
  agentName?: string | null;
  /** O teto vigente do dia, para a frase do `limit` dizer o número. */
  dailyLimit?: number | null;
  /**
   * F26.6 — de que é o alvo da escrita do agente. `task` (ou ausente) é o de
   * sempre, e o aviso leva à ficha; nota do mural e registro do histórico não
   * têm tarefa (`taskId` vazio), e o aviso leva ao CLIENTE (`clientId`).
   */
  targetKind?: AlvoDoAgente | null;
  clientId?: string | null;

  /**
   * F40.8 — o aviso-resumo do Controle da semana (só admin). Um por semana,
   * calculado na leitura, sem tarefa: o título é "Controle da semana", e o
   * destino é a aba na semana certa. `clientesEmFalta` e `clientesAtrasados`
   * são os números de CLIENTES (distintos) com meta sem card e com card vencido;
   * `weekStart` é a segunda da semana.
   */
  clientesEmFalta?: number | null;
  clientesAtrasados?: number | null;
  weekStart?: string | null;

  /**
   * F42, Fase 7 — o que o cliente decidiu pelo link, e em qual versão. Só o
   * aviso `aprovacao` tem. `commentId` aponta o motivo (o comentário da decisão).
   */
  approvalDecision?: 'approved' | 'rejected' | null;
  approvalVersion?: number | null;

  /** Se esta pessoa já marcou. É por pessoa: dois leitores não brigam. */
  seen: boolean;
};

/* ───────────────────────────── as frases ───────────────────────────── */

/**
 * O prazo em português de gente, na voz de quem vai cumpri-lo.
 *
 * Data ilegível devolve nulo em vez de aparecer crua: uma linha dizendo
 * `Vence 0000-00-00` é pior do que uma linha sem prazo.
 */
export function fraseDePrazo(iso: string | null, hoje: Day): string | null {
  const prazo = parseDay(iso);
  if (prazo === null) return null;

  const d = diasDesdeEpoca(prazo) - diasDesdeEpoca(hoje);
  if (d === 0) return 'Vence hoje';
  if (d === 1) return 'Vence amanhã';
  if (d === -1) return 'Venceu ontem';
  if (d < -1) return `Venceu há ${-d} dias`;
  return `Vence em ${d} dias`;
}

/**
 * O quanto o prazo aperta. É o que a tela usa para dar destaque, e nada mais.
 *
 * Devolve nulo para o que não é aviso de prazo — a tela então não pinta nada,
 * em vez de pintar "em dia" num aviso que não fala de prazo nenhum.
 */
export type Aperto = 'vencido' | 'hoje' | 'proximo';

export function apertoDoPrazo(iso: string | null, hoje: Day): Aperto | null {
  const prazo = parseDay(iso);
  if (prazo === null) return null;
  const d = diasDesdeEpoca(prazo) - diasDesdeEpoca(hoje);
  if (d < 0) return 'vencido';
  if (d === 0) return 'hoje';
  return 'proximo';
}

/**
 * A FRASE DO AVISO — por que isto está na sua caixa.
 *
 * ⚠️ ELA NÃO É `frasesDoRegistro`, DE `@/board/automacoes`, E A DIFERENÇA É O
 *   LEITOR. Aquela é a voz do LIVRO, na ficha da tarefa, contando o que o robô
 *   fez a todo mundo: *"tirou de Caio · mandou de Sabor Doce para ATENDIMENTO ·
 *   passou a cuidar: Carla"*. Terceira pessoa, histórico, uma linha por efeito.
 *
 *   Esta é a voz da CAIXA de uma pessoa só, e ela responde outra pergunta:
 *   *por que isto apareceu para mim?* — segunda pessoa, uma frase, agora. Quem
 *   lê a própria caixa não precisa saber de quem a tarefa saiu; precisa saber
 *   que ela é sua.
 *
 *   Reusar aquela aqui obrigaria a dizer "passou a cuidar: Carla" para a
 *   própria Carla, que é o sistema falando dela na terceira pessoa dentro da
 *   caixa dela.
 *
 * Nome que não veio (regra apagada, lista sem nome) não vira travessão: a
 * frase encolhe. `mandou de — para —` é pior do que não dizer de onde veio.
 */
export function fraseDoAviso(a: Aviso, hoje: Day): string {
  if (a.tipo === 'agente') return fraseDeAgente(a);
  if (a.tipo === 'aprovacao') return fraseDeAprovacao(a);
  if (a.tipo === 'controle') return fraseDoControle(a);
  if (a.tipo === 'atribuicao') return 'Você foi adicionado como responsável por este post.';
  if (a.tipo === 'mencao') return `${a.actorName ?? 'Alguém'} mencionou você neste card.`;
  if (a.tipo === 'mencao_chat') {
    return `${a.actorName ?? 'Alguém'} mencionou você no chat.`;
  }
  if (a.tipo === 'prazo') {
    return fraseDePrazo(a.dueOn, hoje) ?? 'Esta tarefa tem prazo';
  }

  const partes: string[] = [];
  partes.push(
    a.automationName === null
      ? 'Uma automação passou esta tarefa para você'
      : `“${a.automationName}” passou esta tarefa para você`,
  );

  if (a.fromListName !== null && a.toListName !== null && a.fromListName !== a.toListName) {
    partes.push(`e mandou de ${a.fromListName} para ${a.toListName}`);
  } else if (a.toListName !== null && a.fromListName === null) {
    partes.push(`e mandou para ${a.toListName}`);
  }

  if (a.toStatusName !== null) partes.push(`na etapa ${a.toStatusName}`);

  return `${partes.join(', ')}.`;
}

/**
 * F42, Fase 7 — a resposta do cliente pelo link. "Cliente aprovou a versão 2
 * pelo link." / "Cliente pediu ajustes na versão 1 pelo link. Veja o motivo no
 * card." Sem a versão, a frase encolhe.
 */
export function fraseDeAprovacao(a: Aviso): string {
  const v = typeof a.approvalVersion === 'number' && a.approvalVersion > 0 ? a.approvalVersion : null;
  if (a.approvalDecision === 'approved') {
    return v === null ? 'Cliente aprovou pelo link.' : `Cliente aprovou a versão ${v} pelo link.`;
  }
  return v === null
    ? 'Cliente pediu ajustes pelo link. Veja o motivo no card.'
    : `Cliente pediu ajustes na versão ${v} pelo link. Veja o motivo no card.`;
}

/**
 * F40.8 — a frase do aviso-resumo do Controle da semana. Ex.: "24 clientes com
 * falta nesta semana · 3 com cards atrasados". Só falta: "24 clientes com falta
 * nesta semana". Só atrasados: "3 clientes com cards atrasados". Singular e
 * plural certos.
 */
export function fraseDoControle(a: Aviso): string {
  const falta = typeof a.clientesEmFalta === 'number' && a.clientesEmFalta > 0 ? a.clientesEmFalta : 0;
  const atraso = typeof a.clientesAtrasados === 'number' && a.clientesAtrasados > 0 ? a.clientesAtrasados : 0;
  const deFalta = falta === 1 ? '1 cliente com falta nesta semana' : `${falta} clientes com falta nesta semana`;
  if (falta > 0 && atraso > 0) {
    return `${deFalta} · ${atraso === 1 ? '1 com cards atrasados' : `${atraso} com cards atrasados`}`;
  }
  if (falta > 0) return deFalta;
  return atraso === 1 ? '1 cliente com cards atrasados' : `${atraso} clientes com cards atrasados`;
}

/**
 * A FRASE DO AVISO DE AGENTE — F21.3.
 *
 * ESCRITA PARA QUEM NÃO SABE O QUE É MCP. Nada de "execução", "concessão",
 * "ledger" ou "capacidade": o que a pessoa precisa entender é *quem* (a
 * conexão que ela mesma nomeou), *em nome de quem* (dela — o aviso só chega ao
 * dono), *o que* aconteceu e *para onde ir* se aquilo não devia ter
 * acontecido. A tarefa é o título logo acima, que já é link.
 *
 * O CAMINHO DE VOLTA VEM NA FRASE, e não só num botão: quem lê isto às onze da
 * noite no celular precisa saber que existe volta antes de precisar procurá-la.
 * Ele aponta a tela de conexões, onde moram o desfazer em lote (F21.2), a
 * revogação e o teto.
 */
export function fraseDeAgente(a: Aviso): string {
  const agente = a.agentName ?? 'Um agente de IA';

  if (a.agentEvent === 'limit') {
    const teto = typeof a.dailyLimit === 'number' && a.dailyLimit > 0 ? a.dailyLimit : null;
    return teto === null
      ? `${agente} atingiu o limite de escritas do dia e parou. Para liberar mais, abra Agentes de IA.`
      : `${agente} atingiu as ${teto} escritas permitidas por dia e parou. Para liberar mais, abra Agentes de IA.`;
  }

  if (a.agentEvent === 'first') {
    return `${agente} escreveu em seu nome pela primeira vez${ondeEscreveu(a)}. Se não foi você quem ligou, desfaça e desconecte em Agentes de IA.`;
  }

  // `move` e qualquer coisa que venha a ser tratada como movimento: o card
  // mudou de lugar, e isso muda o que a equipe vê no quadro.
  return `${agente} moveu este card de lugar em seu nome. Para desfazer ou desconectar, abra Agentes de IA.`;
}

/**
 * F26.6 — onde a escrita caiu, quando não foi numa tarefa: " no mural de
 * Clinimax". Sem nome de cliente a frase encolhe para "no mural do cliente",
 * em vez de mostrar travessão.
 */
function ondeEscreveu(a: Aviso): string {
  const cliente = a.clientName && a.clientName !== '' ? a.clientName : null;
  if (a.targetKind === 'mural_note') return cliente ? ` no mural de ${cliente}` : ' no mural do cliente';
  if (a.targetKind === 'history_entry') {
    return cliente ? ` no histórico de ${cliente}` : ' no histórico do cliente';
  }
  return '';
}

/**
 * De onde é este trabalho, numa linha — cliente e lista.
 *
 * Curta de propósito: a trilha inteira já existe em `@/board/trilha`, e a caixa
 * não é a tela de navegar. Aqui a pergunta é "de que canto do sistema isto
 * veio", e o caminho completo se lê na tarefa, a um clique.
 */
export function origemDoAviso(a: Aviso): string | null {
  if (a.tipo === 'mencao_chat') {
    return a.listName && a.listName !== '' ? a.listName : null;
  }
  const partes = [a.clientName, a.listName].filter((p): p is string => p !== null && p !== '');
  return partes.length === 0 ? null : partes.join(' · ');
}

/**
 * QUANDO — F10 do plano UX. "Hoje, 14:32", "Ontem, 09:10", "Sexta-feira, 18:05",
 * "14 de setembro, 11:00". O mesmo vocabulário dos separadores do chat (F09),
 * no fuso de São Paulo, para a caixa e a conversa não discordarem do dia.
 *
 * Aviso de prazo não tem instante (`occurredAt` nulo): a frase dele já é o
 * tempo ("Vence hoje"), e repetir uma data aqui seria dizer duas vezes.
 * Instante ilegível devolve nulo — nada de "Invalid Date" na linha.
 */
export function quandoDoAviso(
  iso: string | null,
  agora: Date = new Date(),
): { rotulo: string; completo: string; iso: string } | null {
  if (!iso) return null;
  const hora = horaDaMensagem(iso);
  const completo = instanteDaMensagem(iso);
  if (hora === null || completo === null) return null;
  return { rotulo: `${rotuloDoDia(chaveDoDia(iso), agora)}, ${hora}`, completo, iso };
}

/* ───────────────────────────── os grupos ───────────────────────────── */

export type GrupoDeAvisos = { tipo: TipoDeAviso; avisos: Aviso[] };

/**
 * Os avisos em grupos, na ordem em que o servidor os trouxe.
 *
 * ⚠️ ELE **NÃO** REORDENA. A ordem de cada espécie é decidida na consulta — o
 * que chegou vem do mais recente, o prazo vem do mais apertado —, e reordenar
 * aqui daria duas verdades sobre a mesma lista, com a de cima ficando para trás
 * na primeira mudança. O que este arquivo decide é o AGRUPAMENTO, que é
 * vocabulário de tela.
 *
 * O grupo vazio SOME. É o contrário da decisão de `Minhas tarefas`, e de
 * propósito: lá o grupo vazio fica porque "não vi" e "não tem" precisam ser
 * imagens diferentes num painel de atrasos. Aqui, um cabeçalho `Prazo virando`
 * com nada embaixo é a tela falando sobre si mesma (F17.37) — e uma caixa de
 * entrada vazia deve parecer vazia.
 */
export function agruparAvisos(avisos: readonly Aviso[]): GrupoDeAvisos[] {
  return TIPOS_DE_AVISO.map((tipo) => ({
    tipo,
    avisos: avisos.filter((a) => a.tipo === tipo),
  })).filter((g) => g.avisos.length > 0);
}

/** Quantos ainda não foram vistos. É o número que a barra lateral mostra. */
export function contarNaoVistos(avisos: readonly Aviso[]): number {
  return avisos.filter((a) => !a.seen).length;
}

/**
 * O que fica à vista.
 *
 * O que já foi visto SAI DA FRENTE — é o pedido da etapa. Ele não some do
 * sistema: `Já vistos` o traz de volta, e desmarcar o devolve à frente. Sem
 * essa volta, um toque errado apagaria para sempre o único lugar que diz "isto
 * chegou para você", e a pessoa nem saberia o que perdeu.
 */
export function filtrarAvisos(avisos: readonly Aviso[], mostrarVistos: boolean): Aviso[] {
  // F16: as duas abas são DISJUNTAS. Antes, `Já vistos` devolvia tudo — o novo
  // aparecia nas duas, contra as frases da própria tela ("Está em Já vistos",
  // "Devolvido para Novos", "continua em Novos").
  return avisos.filter((a) => a.seen === mostrarVistos);
}

/**
 * O contador que a barra lateral desenha ao lado do nome.
 *
 * Acima de noventa e nove vira `99+`: o lugar dele é uma pastilha de 22px, e um
 * número de quatro dígitos ali estoura a barra inteira. Zero devolve nulo, e a
 * pastilha não é desenhada — um `0` permanente ensina a não olhar.
 */
export function selo(naoVistos: number): string | null {
  if (naoVistos <= 0) return null;
  return naoVistos > 99 ? '99+' : String(naoVistos);
}
