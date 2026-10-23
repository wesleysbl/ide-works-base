/**
 * O HISTÓRICO DE MOVIMENTAÇÃO DA TAREFA — etapa F17.65.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO, COM DUAS CAPTURAS DO PAINEL `Activity` DO CLICKUP
 *
 *     Helena  alterou o status de Aprovação para Enviar Fotos Ao Cliente
 *             removeu o responsável: Murilo Siqueira
 *             alterou a lista de início de Estúdio Ide para ESTÚDIO
 *     Nara   criou esta tarefa
 *
 *   *"Preciso que some o histórico em movimentação"* — **e os comentários no
 *   meio, na mesma linha do tempo**. É essa mistura que torna a coluna legível:
 *   o comentário explica a mudança que veio logo antes dele.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAS FONTES, UMA LINHA — E A JUNÇÃO ACONTECE AQUI, NÃO NO BANCO
 *
 *   `ideworks.task_events` (o livro) e `ideworks.task_comments` (a conversa)
 *   são duas tabelas com dois donos e duas políticas. Uma `union` no banco
 *   obrigaria as duas a caber numa forma só de coluna, e a segunda vez que
 *   alguém mexesse numa delas a união mentiria. Aqui elas continuam separadas
 *   até o último instante, e o que as junta é o INSTANTE.
 *
 *   Este arquivo é puro: sem React, sem servidor, sem `fetch`. Ele é o que tem
 *   teste sem navegador — a mesma decisão de `conversa.ts`, `passos.ts` e
 *   `automacoes.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ A FRASE SE MONTA AQUI, E O NOME VEM RESOLVIDO DO SERVIDOR
 *
 *   `task_events` guarda IDS. Lista, etapa e pessoa viram nome na hora de ler,
 *   pela decisão de `task_assignees` desde a F4.8: *"copia nao se atualiza
 *   quando a pessoa muda de nome"*. Renomear uma lista corrige o histórico
 *   inteiro.
 *
 *   ⚠️ MAS O NOME PODE TER SUMIDO. As quatro chaves de lista e de etapa são
 *   `on delete set null`: apagar uma etapa da esteira não apaga o evento, mas
 *   apaga o id dentro dele — e com o id iria embora a única forma de saber o
 *   nome. O histórico decairia para *"alterou o status de — para —"*.
 *
 *   Por isso a F17.65 pôs quatro colunas de RETRATO em `task_events`, e o
 *   servidor as usa como PARAQUEDAS: o nome vivo ganha, e o retrato só aparece
 *   quando a junção não devolve nada. Quando este arquivo recebe o evento, essa
 *   escolha já foi feita — aqui um nome nulo quer dizer *"não faz parte desta
 *   mudança"*, e não *"sumiu"*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ O SUJEITO DA FRASE É QUEM FEZ — E ELE PODE SER UM ROBÔ
 *
 *   `automation_name` preenchido = foi uma REGRA, e o nome dela é o retrato do
 *   instante em que rodou (a regra pode ter sido apagada; o livro não se
 *   reescreve). `automation_name` nulo = foi GENTE, e quem está em `actor_id`.
 *
 *   As FRASES são as mesmas nos dois casos, de propósito: uma coluna com dois
 *   vocabulários — *"mandou de A para B"* para o robô e *"alterou a lista de A
 *   para B"* para a pessoa — obrigaria quem lê a aprender dois idiomas para ler
 *   uma lista só. Muda o sujeito, não a língua.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ O PASSADO NÃO SE FABRICA, E ISSO TEM UM NÚMERO
 *
 *   Medido em 2026-09-03: das 1.829 tarefas, **1.758 têm `created_by` nulo** —
 *   vieram do ClickUp pela importação, e o `created_at` delas é o instante da
 *   IMPORTAÇÃO (três dias distintos), não a data em que alguém as criou.
 *
 *   Então *"criou esta tarefa"* só aparece quando há AUTOR. Escrevê-la nas
 *   outras 1.758 seria inventar passado com cara de fato — a linha diria
 *   "criada em 21/08" para uma tarefa de abril. E não há evento retroativo
 *   nenhum: o livro começa vazio e enche a partir de agora.
 *
 *   ⚠️ E POR ISSO A LINHA DO TEMPO NÃO É UM BLOCO PRÓPRIO NA TELA. Ela mora
 *   DENTRO da conversa (`ConversaDaTarefa`), que já existe em toda tarefa e já
 *   tem o campo de escrever sempre aberto. Um bloco próprio ficaria vazio em
 *   96% das fichas — e caixa vazia em toda tarefa parece defeito. Assim não há
 *   caixa vazia, e a tela não precisa dizer uma palavra sobre si mesma (F17.37).
 */

import type { Comentario } from '@/board/conversa';
import { nomeDaConexao } from '@/ui/selo-de-origem';

/* ───────────────────────────── o que chega ───────────────────────────── */

/**
 * Uma linha do livro da tarefa, com os nomes já resolvidos pelo servidor.
 *
 * `automationName` preenchido = foi regra. Nulo = foi gente, e o nome dela está
 * em `actorName`.
 */
export type EventoDaTarefa = {
  id: string;
  automationName: string | null;
  actorName: string | null;
  fromListName: string | null;
  toListName: string | null;
  fromStatusName: string | null;
  toStatusName: string | null;
  /**
   * O cliente ANTES e DEPOIS de uma troca feita no cartão (F38, fase 7). Nulo =
   * sem cliente (ou "não faz parte desta mudança" — a frase decide pelo par).
   * Opcionais porque a ficha de antes da fase não os trazia.
   */
  fromClientName?: string | null;
  toClientName?: string | null;
  /** Quem SAIU de responsável, por nome. */
  removed: string[];
  /**
   * Quem ENTROU, por nome.
   *
   * É lista e não um só porque o seletor de pessoas é de marcar vários — uma
   * gravação à mão pode pôr duas pessoas de uma vez. A automação só sabe pôr
   * uma, e o servidor junta as duas colunas numa lista só.
   */
  added: string[];
  occurredAt: string;
  /**
   * O nome da conexão de IA da sessão que GEROU o evento — F26, fase 9.
   *
   * `task_events.via_name` (F26.2): "adicionou o responsável: Ana", feito pela
   * IA da Carla, vira *Carla · via ChatGPT*. A linha da AUTOMAÇÃO que a IA
   * disparou ao mover também vem marcada: a regra rodou porque a IA empurrou a
   * tarefa. Nulo = gente. Opcional porque a ficha de antes da F26 não o trazia.
   */
  viaName?: string | null;
};

/* ───────────────────────────── a frase ───────────────────────────── */

/**
 * O SUJEITO da linha: o nome da regra, ou o de quem fez.
 *
 * `Alguém` é o último recurso — evento sem ator só nasce se a escrita acontecer
 * fora de uma sessão declarada. Dizer "Alguém alterou o status" é honesto;
 * deixar a linha sem sujeito faria a frase começar no verbo e parecer defeito.
 */
export function quemFez(e: EventoDaTarefa): string {
  return e.automationName ?? e.actorName ?? 'Alguém';
}

/** Verdadeiro quando a linha é obra de uma REGRA, e não de gente. */
export function foiAutomacao(e: EventoDaTarefa): boolean {
  return e.automationName !== null;
}

const listaDeNomes = (nomes: readonly string[]) => nomes.join(', ');

/**
 * O evento em português de gente, uma linha por coisa que mudou.
 *
 * A ORDEM É A DA CAPTURA: status, lista, cliente, quem saiu, quem entrou.
 *
 * ⚠️ NOME QUE NÃO VEIO NÃO VIRA LINHA. *"alterou o status de — para —"* é pior
 * do que não dizer nada, e é o que sobraria se a etapa tivesse sido apagada
 * ANTES de a F17.65 existir — os eventos velhos não têm retrato, e a linha
 * deles some em vez de mentir.
 *
 * ⚠️ E MUDANÇA QUE NÃO MUDOU NADA NÃO VIRA LINHA. O banco já recusa o evento em
 * branco (`task_events_says_something`); aqui a mesma regra evita a linha
 * *"alterou o status de a fazer para a fazer"*, que o banco aceitaria quando
 * duas etapas de listas diferentes têm o mesmo nome.
 */
export function frasesDoEvento(e: EventoDaTarefa): string[] {
  const linhas: string[] = [];

  if (e.toStatusName !== null && e.toStatusName !== e.fromStatusName) {
    linhas.push(
      e.fromStatusName === null
        ? `pôs o status em ${e.toStatusName}`
        : `alterou o status de ${e.fromStatusName} para ${e.toStatusName}`,
    );
  }

  if (e.toListName !== null && e.toListName !== e.fromListName) {
    linhas.push(
      e.fromListName === null
        ? `moveu para a lista ${e.toListName}`
        : `alterou a lista de ${e.fromListName} para ${e.toListName}`,
    );
  }

  // O cliente: os dois nulos = o evento não mexeu nele. Só o "depois" nulo =
  // a tarefa ficou sem cliente (lista interna). Só o "antes" nulo = ganhou um.
  const deCliente = e.fromClientName ?? null;
  const paraCliente = e.toClientName ?? null;
  if (deCliente !== paraCliente) {
    if (deCliente === null) linhas.push(`definiu o cliente ${paraCliente}`);
    else if (paraCliente === null) linhas.push(`tirou o cliente ${deCliente}`);
    else linhas.push(`trocou o cliente de ${deCliente} para ${paraCliente}`);
  }

  if (e.removed.length === 1) linhas.push(`removeu o responsável: ${e.removed[0]}`);
  else if (e.removed.length > 1)
    linhas.push(`removeu os responsáveis: ${listaDeNomes(e.removed)}`);

  if (e.added.length === 1) linhas.push(`adicionou o responsável: ${e.added[0]}`);
  else if (e.added.length > 1) linhas.push(`adicionou os responsáveis: ${listaDeNomes(e.added)}`);

  return linhas;
}

/* ─────────────────────────── a linha do tempo ─────────────────────────── */

/**
 * Um degrau da linha do tempo: uma fala, uma mudança, ou o nascimento.
 *
 * `via` (F26.9) é o nome da conexão de IA pela qual a linha foi escrita, e só
 * EXISTE quando existe: linha de gente não carrega a chave, nem nula.
 */
export type ItemDoHistorico =
  | {
      readonly tipo: 'criacao';
      readonly chave: string;
      readonly quem: string;
      readonly quando: string;
      readonly via?: string;
    }
  | {
      readonly tipo: 'evento';
      readonly chave: string;
      readonly quem: string;
      readonly quando: string;
      readonly automatico: boolean;
      readonly frases: readonly string[];
      readonly via?: string;
    }
  | {
      readonly tipo: 'comentario';
      readonly chave: string;
      readonly quando: string;
      readonly fala: Comentario;
    };

const instante = (iso: string): number => {
  const n = new Date(iso).getTime();
  // Instante ilegível vai para o FIM, e não para o começo: `NaN` em `sort`
  // embaralha a lista inteira em vez de mover um item.
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
};

/**
 * A LINHA DO TEMPO, DO MAIS ANTIGO PARA O MAIS RECENTE.
 *
 * ⚠️ CRESCENTE, E NÃO DECRESCENTE COMO ERA O REGISTRO DA F17.41. A linha mora
 * dentro da conversa, e a conversa tem o campo de escrever no PÉ: com o mais
 * recente em cima, o comentário que alguém acabou de mandar apareceria no topo,
 * a um scroll de distância do botão que o mandou.
 *
 * `criacao` sai de `tasks.created_by` e `tasks.created_at` — não é evento
 * gravado, e por isso não aparece quando não há autor. Ver o cabeçalho.
 *
 * ⚠️ `falas` SÃO SÓ AS DO PRIMEIRO NÍVEL. Quem aninha resposta é
 * `aninharConversa`; uma resposta no meio da linha do tempo a arrancaria de
 * baixo do comentário que ela responde.
 *
 * O DESEMPATE É ESTÁVEL: mesmo instante ordena por espécie (nascimento, depois
 * mudança, depois fala) e então por chave. Sem isso, as DUAS linhas que
 * `move_task` grava numa transação — a da mão e a da regra — sairiam em ordem
 * aleatória, porque `occurred_at` é o instante da TRANSAÇÃO e é o mesmo nas
 * duas.
 */
export function montarHistorico(entrada: {
  readonly criadaPor: string | null;
  /** `tasks.via_name`: a conexão de IA pela qual a tarefa nasceu (F26.9). */
  readonly criadaVia?: string | null;
  readonly criadaEm: string;
  readonly eventos: readonly EventoDaTarefa[];
  readonly falas: readonly Comentario[];
}): ItemDoHistorico[] {
  const itens: ItemDoHistorico[] = [];

  if (entrada.criadaPor !== null) {
    const via = nomeDaConexao(entrada.criadaVia);
    itens.push({
      tipo: 'criacao',
      chave: 'criacao',
      quem: entrada.criadaPor,
      quando: entrada.criadaEm,
      ...(via === null ? {} : { via }),
    });
  }

  for (const e of entrada.eventos) {
    const frases = frasesDoEvento(e);
    // Evento sem uma frase legível não vira degrau: seria um nome e um relógio
    // sem nada entre eles. Só acontece com evento velho cuja lista ou etapa foi
    // apagada antes de existir retrato.
    if (frases.length === 0) continue;
    const via = nomeDaConexao(e.viaName);
    itens.push({
      tipo: 'evento',
      chave: `e${e.id}`,
      quem: quemFez(e),
      quando: e.occurredAt,
      automatico: foiAutomacao(e),
      frases,
      ...(via === null ? {} : { via }),
    });
  }

  for (const c of entrada.falas) {
    itens.push({ tipo: 'comentario', chave: `c${c.id}`, quando: c.createdAt, fala: c });
  }

  const peso = { criacao: 0, evento: 1, comentario: 2 } as const;

  return itens.sort((a, b) => {
    const d = instante(a.quando) - instante(b.quando);
    if (d !== 0) return d;
    const p = peso[a.tipo] - peso[b.tipo];
    if (p !== 0) return p;
    // `localeCompare` não serve: a chave é `e30`, `e31`, `e100` — e a ordem que
    // importa aqui é a da identidade crescente do banco, que é numérica.
    return a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true });
  });
}
