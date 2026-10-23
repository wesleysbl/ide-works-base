/**
 * A automação da etapa — etapa F17.41.
 *
 * ⚠️ O REGISTRO QUE ELA DEIXA MUDOU DE ENDEREÇO NA F17.65. Ele mora em
 * `@/board/historico`, porque `task_events` deixou de ser só de automação: a
 * mudança feita à mão escreve na mesma tabela, e o tipo passou a ser o do
 * HISTÓRICO da tarefa. O que sobrou aqui é a REGRA — configurá-la, dizê-la por
 * extenso, e a frase de uma linha que a tela dá quando ela acaba de rodar.
 *
 * O PEDIDO
 *   *"dentro dos status das listas, é necessário a possibilidade de
 *   automações... após determinada etapa troca o responsável e encaminha para
 *   outro, de forma que não fique mais responsável para o anterior."*
 *
 * O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É
 *   É a camada pura: os tipos que atravessam servidor e tela, e a FRASE que o
 *   registro vira na tela.
 *
 *   REGRA DE DOMÍNIO NÃO MORA AQUI. Como na F17.15 e na F17.6, tudo virou
 *   restrição declarativa ou conferência do banco:
 *     · "não anda em círculo" ........ a chave primária de dois pares
 *     · "uma regra por chegada" ...... a chave única da chegada
 *     · "a regra faz alguma coisa" ... a restrição de checagem
 *     · "não atribui a quem não vê" .. a pergunta de alcance, com a pessoa
 *     · "só quem cuida configura" .... a política de escrita
 *
 *   O que existe aqui é CONFORTO DE DIGITAÇÃO — a pessoa vê o problema antes de
 *   gastar uma ida ao servidor — e ele é sempre MENOS SEVERO OU IGUAL ao banco,
 *   nunca mais. A lição está escrita em `passos.ts`: conferência de conforto
 *   mais severa que a regra mente sobre o que o sistema aceita.
 *
 * POR QUE A FRASE SE MONTA AQUI, E NÃO NO BANCO
 *   O registro guarda IDS, e os nomes saem na hora de ler — é a decisão de
 *   `task_assignees` desde a F4.8: *"copia nao se atualiza quando a pessoa muda
 *   de nome"*. Uma frase gravada pronta ficaria com o nome velho da pessoa e da
 *   lista para sempre.
 *
 *   A ÚNICA exceção é o nome da REGRA, que vem copiado do instante em que ela
 *   rodou: a regra pode ser apagada, e o livro não se reescreve.
 */

/** Uma regra: quando a tarefa chega nesta etapa desta lista, faça isto. */
export type Automacao = {
  id: string;
  name: string;
  /** A etapa que dispara. Sempre de uma etapa da esteira resolvida da lista. */
  triggerStatusId: string;
  triggerStatusName: string | null;
  /** Para onde a tarefa vai. Nulo quando a regra só troca quem cuida. */
  targetListId: string | null;
  targetListName: string | null;
  targetStatusId: string | null;
  targetStatusName: string | null;
  /** Quem passa a cuidar. Nulo quando a regra só encaminha. */
  assigneeId: string | null;
  assigneeName: string | null;
  active: boolean;
};

/** O que a tela manda para gravar. `id` nulo cria; preenchido, muda. */
export type AutomacaoEmEdicao = {
  id: string | null;
  name: string;
  triggerStatusId: string;
  targetListId: string | null;
  targetStatusId: string | null;
  assigneeId: string | null;
  active: boolean;
};

/*
 * ⚠️ `RegistroDeAutomacao` E `frasesDoRegistro` SAÍRAM DAQUI NA F17.65.
 *
 * Eles moravam neste arquivo enquanto TODA linha de `task_events` vinha de uma
 * regra. Desde a F17.65 a mesma tabela guarda a mudança feita À MÃO — quem
 * trocou o status, quem tirou o responsável —, e o tipo passou a ser o do
 * HISTÓRICO da tarefa, não o da automação. Ele mora em `@/board/historico`,
 * junto com a linha do tempo que mistura eventos e comentários.
 *
 * A automação continua sendo UM dos sujeitos possíveis daquele histórico: é o
 * que `EventoDaTarefa.automationName` preenchido quer dizer.
 */

/**
 * O que a mudança de etapa devolve quando a automação rodou.
 *
 * Vem de `ideworks.move_task`, que faz tudo na mesma escrita. `removed` é
 * quantas pessoas SAÍRAM — o pedido inteiro está nesse número.
 */
export type AutomacaoQueRodou = {
  name: string;
  moved: boolean;
  assigned: boolean;
  removed: number;
};

/* ───────────────────────── a frase ───────────────────────── */

/**
 * O aviso que a tela dá logo depois de arrastar o cartão, quando a regra rodou.
 *
 * Uma frase só, porque ela aparece num rodapé passageiro — o registro completo
 * mora na tarefa. Sem ela, a tarefa muda de lista debaixo do dedo de quem
 * arrastou e nada explica por quê, que é o defeito que esta etapa existe para
 * não criar.
 */
export function avisoDaAutomacao(a: AutomacaoQueRodou): string {
  const partes: string[] = [];
  if (a.moved) partes.push('mandou a tarefa para outra lista');
  if (a.assigned) {
    partes.push(
      a.removed === 0
        ? 'e definiu quem cuida'
        : a.removed === 1
          ? 'e passou para outra pessoa'
          : `e passou para outra pessoa, tirando ${a.removed}`,
    );
  }
  return `“${a.name}” ${partes.join(', ')}.`;
}

/* ───────────────────── conforto de digitação ───────────────────── */

/**
 * O que o botão de gravar precisa saber para se desabilitar. Nulo = pode.
 *
 * ⚠️ MENOS SEVERO OU IGUAL AO BANCO, SEMPRE. Aqui não se confere alcance, nem
 * se a etapa pertence à esteira, nem se a chegada já é gatilho de outra regra —
 * essas três só o banco sabe responder, e responder errado aqui esconderia
 * configuração legítima.
 */
export function conferirAutomacao(a: AutomacaoEmEdicao): string | null {
  if (a.name.trim() === '') return 'Dê um nome a esta automação.';
  /* ⚠️ AS FRASES NÃO DIZEM "DISPARA" NEM "GATILHO" — F17.45. Quem vai usar isto
     são as atendentes, e a palavra que elas conhecem é a que descreve o que
     acontece na tela: a tarefa CHEGA numa etapa. */
  if (a.triggerStatusId === '') return 'Escolha em que etapa a tarefa precisa chegar.';
  if (a.targetListId === null && a.assigneeId === null) {
    return 'Escolha o que a automação faz: mandar a tarefa para outra lista, passar a tarefa para alguém, ou as duas coisas.';
  }
  if (a.targetListId !== null && a.targetStatusId === null) {
    return 'Escolha em que etapa a tarefa vai parar na outra lista.';
  }
  return null;
}

/** Uma regra gravada, de volta ao formulário — para MUDAR em vez de recriar. */
export function paraEdicao(a: Automacao): AutomacaoEmEdicao {
  return {
    id: a.id,
    name: a.name,
    triggerStatusId: a.triggerStatusId,
    targetListId: a.targetListId,
    targetStatusId: a.targetStatusId,
    assigneeId: a.assigneeId,
    active: a.active,
  };
}

/* ─────────────────── a regra dita por extenso — F17.45 ─────────────────── */

/**
 * UM PEDAÇO DA FRASE: texto corrido, ou um NOME que veio do banco.
 *
 * A separação existe porque nome de lista, de etapa e de pessoa são escolhidos
 * por quem cadastra — `a fazer`, `Todas as demandas`, `Carla` — e no meio de uma
 * frase eles somem. A tela os desenha destacados; quem precisa da frase em
 * texto puro (leitor de tela, prova, `title`) usa `fraseDaAutomacao`, que os
 * põe entre aspas.
 */
export type Pedaco = { readonly texto: string; readonly nome?: true };

const t = (texto: string): Pedaco => ({ texto });
const n = (texto: string): Pedaco => ({ texto, nome: true });

/** Um passo da regra: o rótulo à esquerda e a frase dele. */
export type PassoDaAutomacao = { readonly rotulo: string; readonly pedacos: readonly Pedaco[] };

/**
 * A REGRA EM PASSOS — **quando** … **então** … **e** …
 *
 * ⚠️ ESTA FUNÇÃO É A ETAPA F17.45 INTEIRA. O que ela substituiu:
 *
 *     chega em a fazer · vai para Todas as demandas · a fazer · passa a cuidar: Carla
 *
 *   Quatro pedaços colados por `·`, e três defeitos medidos na captura do
 *   usuário: não havia SUJEITO (quem chega?), não se dizia DE ONDE (o nome da
 *   lista de origem ficava solto no título da caixa), e o MESMO `·` separava
 *   coisas de níveis diferentes — o que dispara, o destino, a etapa do destino
 *   e a pessoa. A pessoa tinha de adivinhar que o primeiro `a fazer` era a
 *   chegada e o segundo era o destino.
 *
 *   *"Poucas pessoas realmente sabem criar uma automação, não é o caso das
 *   atendentes."* A frase não pode supor que se sabe o que é gatilho — então
 *   ela não usa a palavra, e diz o que acontece na tela: a tarefa CHEGA.
 *
 * A LISTA DE ORIGEM ENTRA POR FORA, e de propósito: `Automacao` guarda os ids
 * do que a regra faz, e a lista de onde ela parte é a lista cuja caixa está
 * aberta. Guardar o nome dela dentro do registro seria a cópia que a F4.8
 * proibiu — ela ficaria velha assim que a lista fosse renomeada.
 *
 * ⚠️ E O DESTINO PODE PRECISAR DO CAMINHO — medido na regra de exemplo do
 *   usuário, em 2026-08-31: ela sai de `Todas as demandas` e vai para
 *   `Todas as demandas`. São DUAS listas diferentes com o mesmo nome, em
 *   espaços diferentes. Só o nome não distingue uma da outra, e a frase
 *   pareceria dizer que a tarefa vai para onde já está.
 *
 *   Por isso `caminhoDoDestino`: a tela manda o mesmo texto que ela mostra no
 *   seletor (`Espaço / Pasta / Lista`), e a frase passa a nomear a lista do
 *   jeito que a pessoa a escolheu. Sem ele, sobra o nome — que é o que o
 *   servidor sabe.
 */
export function passosDaAutomacao(
  a: Automacao,
  listaDeOrigem: string,
  caminhoDoDestino: string | null = null,
): PassoDaAutomacao[] {
  /* A etapa apagada NÃO vira travessão nem nome vazio: `task_automations`
     some junto com a etapa, mas a leitura pode chegar aqui no meio do caminho,
     e "chegar na etapa —" seria pior do que dizer que ela não existe mais. */
  const quando: Pedaco[] =
    a.triggerStatusName === null
      ? [t('uma tarefa chegar numa etapa que já não existe')]
      : [
          t('uma tarefa chegar na etapa '),
          n(a.triggerStatusName),
          t(' da lista '),
          n(listaDeOrigem),
        ];

  const efeitos: Pedaco[][] = [];

  if (a.targetListName !== null) {
    const destino = caminhoDoDestino ?? a.targetListName;
    efeitos.push(
      a.targetStatusName === null
        ? [t('ela vai para a lista '), n(destino)]
        : [t('ela vai para a etapa '), n(a.targetStatusName), t(' da lista '), n(destino)],
    );
  }

  if (a.assigneeName !== null) {
    efeitos.push([n(a.assigneeName), t(' passa a cuidar dela')]);
  }

  /* O banco exige que a regra faça alguma coisa (`task_automations_does_
     something`), então zero efeitos só acontece se o destino tiver sumido
     debaixo dela. Dizer isso é melhor do que uma frase que termina no ar. */
  if (efeitos.length === 0) efeitos.push([t('o destino desta regra não existe mais')]);

  return [
    { rotulo: 'Quando', pedacos: quando },
    ...efeitos.map((pedacos, i) => ({ rotulo: i === 0 ? 'Então' : 'E', pedacos })),
  ];
}

/**
 * A MESMA REGRA EM UMA FRASE SÓ, em texto puro.
 *
 * É o que o leitor de tela anuncia e o que a prova escreve na saída para o
 * usuário julgar. Os rótulos viram pontuação — `Quando` abre, `Então` é a
 * vírgula, `E` é o `e` — porque uma frase lida em voz alta não tem colunas.
 */
export function fraseDaAutomacao(
  a: Automacao,
  listaDeOrigem: string,
  caminhoDoDestino: string | null = null,
): string {
  const [quando, ...efeitos] = passosDaAutomacao(a, listaDeOrigem, caminhoDoDestino);
  const emTexto = (p: PassoDaAutomacao) =>
    p.pedacos.map((x) => (x.nome === true ? `“${x.texto}”` : x.texto)).join('');
  return `Quando ${emTexto(quando)}, ${efeitos.map(emTexto).join(' e ')}.`;
}
