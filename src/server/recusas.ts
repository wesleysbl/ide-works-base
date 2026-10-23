/**
 * A recusa do banco, dita para gente — etapa F17.19.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ACONTECEU, DUAS VEZES
 *
 *   Esta frase apareceu INTEIRA na tela de um designer:
 *
 *     "a tarefa '01/09' da lista 'Setembro' esta no status 'a fazer' (…) mova
 *      essas tarefas para outra lista com ideworks.move_task (ou conclua-as),
 *      mude a esteira, e traga-as de volta."
 *
 *   Dois defeitos, e os dois são de comunicação:
 *
 *   1. `ideworks.move_task` é nome de função de banco. Quem lê a tela é
 *      designer e videomaker; para eles isso é ruído com cara de culpa. A
 *      F17.20 já tinha tirado um `ideworks.checklist_items` de outro rodapé —
 *      esta é a SEGUNDA vez que um identificador de schema chega ao olho de
 *      quem trabalha.
 *
 *   2. "ou conclua-as" é remédio que NÃO funciona. Concluir não solta a tarefa
 *      da esteira: ela continua com `status_id` apontando para a etapa antiga,
 *      e o guarda recusa de novo, com a mesma frase. A verificação da F17.3c já
 *      tinha medido isso — a frase envelheceu sozinha.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE A TRADUÇÃO MORA AQUI, E NÃO EM CADA ARQUIVO DE ESCRITA
 *   Porque são SEIS os lugares que devolvem a frase do banco para a tela
 *   (`tree.ts`, `board.ts`, `board-task.ts`, `board-passos.ts`,
 *   `board-anexos.ts`, `catalogos.ts`). Seis cópias da mesma tradução seriam
 *   seis lugares para esquecer de um — e o que faltasse não daria sinal nenhum,
 *   que é exatamente a dívida que este projeto existe para não repetir.
 *
 * ⚠️ ISTO NÃO SUBSTITUI CONSERTAR A MENSAGEM NO BANCO
 *   A migração da F17.19 reescreve os textos dos gatilhos. Esta camada continua
 *   valendo por dois motivos medidos: o aplicativo sobe antes da migração (há
 *   uma janela em que o banco ainda responde a frase velha), e um gatilho
 *   escrito amanhã pode nascer com o mesmo vício. Rede, não substituto.
 *
 * A REGRA QUE DECIDE O QUE É TÉCNICO
 *   Dado de gente vem SEMPRE entre aspas nessas frases — nome de tarefa, de
 *   lista, de esteira, de etapa. Identificador de banco vem SEMPRE solto.
 *   Então: tira-se o que está entre aspas e procura-se, no que sobrou,
 *   `ideworks.<algo>` ou palavra_com_sublinhado. Achou — a oração inteira sai.
 *
 *   É por isso que uma tarefa chamada `post_01` não faz a frase se desmontar:
 *   ela está entre aspas, e o que está entre aspas nunca é examinado.
 */

/* ───────────────────────────── as frases conhecidas ───────────────────────── */

/**
 * As traduções por marca. A MARCA é um pedaço da frase que sobrevive à
 * interpolação do `%` — nada de casar a frase inteira, que muda com o nome da
 * tarefa.
 *
 * `refazer` recebe a frase original e devolve a de gente. Quando a original
 * carrega dado útil (qual tarefa, qual lista, quantas), a tradução aproveita:
 * jogar fora "qual tarefa está no caminho" seria desfazer o trabalho de três
 * etapas para consertar uma palavra.
 */
type Traducao = { marca: RegExp; refazer: (frase: string) => string };

/** O que está entre aspas — retas ou curvas — é dado de gente, e fica. */
const ASPAS = /"([^"]*)"|“([^”]*)”|'([^']*)'/g;

/** Os pedaços entre aspas, na ordem em que aparecem. */
function citados(frase: string): string[] {
  const achados: string[] = [];
  for (const m of frase.matchAll(ASPAS)) achados.push(m[1] ?? m[2] ?? m[3] ?? '');
  return achados;
}

const entreAspas = (s: string | undefined) => (s === undefined || s === '' ? '—' : `“${s}”`);

/** "Sao 3 tarefa(s) no caminho" → 3. Ausente vira 1, que é o mínimo verdadeiro. */
function quantas(frase: string): number {
  const m = /\b(\d+)\s+tarefa/i.exec(frase);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const TRADUCOES: Traducao[] = [
  /*
    O guarda da árvore da esteira (F17.3c). A frase original nomeia a tarefa, a
    lista, a etapa, a esteira de hoje e a esteira que passaria a valer — tudo
    isso serve, e fica. O que sai é o parágrafo de instrução, que citava
    `ideworks.move_task` e mandava concluir, que não resolve.
  */
  {
    marca: /esta no status .* da esteira|está na etapa .* da esteira/i,
    refazer: (frase) => {
      const [tarefa, lista, etapa, esteira, destino] = citados(frase);
      const n = quantas(frase);
      const fim =
        /SEM esteira nenhuma|sem esteira nenhuma/.test(frase) || destino === undefined
          ? 'e essa lista ficaria sem esteira nenhuma — o quadro dela não teria coluna'
          : `e essa lista passaria a usar a esteira ${entreAspas(destino)}`;
      const conta =
        n > 1
          ? ` São ${n} tarefas nessa situação.`
          : ' É a única tarefa nessa situação.';
      return (
        `A tarefa ${entreAspas(tarefa)}, da lista ${entreAspas(lista)}, está na etapa ` +
        `${entreAspas(etapa)} da esteira ${entreAspas(esteira)}, ${fim}.${conta}` +
        ' Diga para onde vai cada uma dessas tarefas e a mudança passa.' +
        ' Concluir não resolve: a tarefa concluída continua nessa etapa. Nada foi mudado.'
      );
    },
  },

  /* A lista sem esteira nenhuma (F17.3 e F17.3c). */
  {
    marca: /nao tem esteira|não tem esteira/i,
    refazer: (frase) => {
      const [lista] = citados(frase);
      return (
        `A lista ${entreAspas(lista)} não tem esteira: nem ela, nem a pasta dela, nem o ` +
        'espaço definem uma. Dê uma esteira a um dos três antes de pôr tarefa aqui — sem ' +
        'esteira o quadro não tem coluna nenhuma.'
      );
    },
  },

  /* A etapa que não é da esteira da lista (F17.3 e F17.3c). */
  {
    marca: /nao pertence a esteira|não pertence à esteira/i,
    refazer: (frase) => {
      const [etapa, lista] = citados(frase);
      return (
        `A etapa ${entreAspas(etapa)} não é da esteira da lista ${entreAspas(lista)}. A etapa ` +
        'de uma tarefa tem que ser uma das que essa lista mostra no quadro. Escolha uma delas, ' +
        'ou mova a tarefa para a lista certa — mover reposiciona a etapa sozinho.'
      );
    },
  },

  /* Mover sem destino (F17.3 e F17.15). */
  {
    marca: /mover exige a lista de destino/i,
    refazer: () =>
      'Mover pede a lista de destino. Para tirar a tarefa do quadro sem apagá-la, arquive-a.',
  },

  /* Etiqueta em tarefa que não está em lista nenhuma (F17.4). */
  {
    marca: /nao esta em lista nenhuma|não está em lista nenhuma/i,
    refazer: () =>
      'Esta tarefa não está em lista nenhuma, então não pertence a espaço nenhum — e etiqueta ' +
      'de tarefa vive no espaço. Ponha a tarefa num quadro antes de etiquetá-la. Etiqueta de ' +
      'cliente é outra coisa, e se põe na ficha do cliente.',
  },
];

/* ───────────────────────────── a rede de baixo ───────────────────────────── */

/**
 * O que denuncia texto de banco: `ideworks.alguma_coisa`, ou palavra com
 * sublinhado no meio (`status_set_id`, `tasks_status_fk`, `move_task`).
 *
 * Nome de gente não tem sublinhado no meio, e quando tiver estará entre aspas —
 * e o que está entre aspas some antes desta busca.
 */
const CHEIRO_DE_BANCO = /\bideworks\.[a-z_]+|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;

/** Vale para a frase toda: sobrou identificador de banco em algum lugar? */
export function pareceSql(frase: string): boolean {
  return CHEIRO_DE_BANCO.test(frase.replace(ASPAS, '""'));
}

/**
 * Tira as orações que carregam identificador de banco.
 *
 * Corta por PONTO, e não pela frase inteira, porque a primeira metade dessas
 * mensagens costuma ser a parte boa — a que diz qual tarefa está no caminho.
 * Perder ela junto com o jargão seria trocar um defeito por outro.
 */
function semJargao(frase: string): string {
  const oracoes = frase
    .split(/(?<=\.)\s+/)
    .filter((o) => o.trim() !== '')
    .filter((o) => !pareceSql(o));

  const sobrou = oracoes.join(' ').trim();
  return sobrou === '' ? '' : sobrou;
}

/** A frase de último recurso. Ela não explica — ela não mente, que é o mínimo. */
const GENERICA =
  'O banco recusou esta mudança para não deixar o quadro incoerente. Nada foi mudado.';

/**
 * A frase que a tela pode mostrar.
 *
 * Ordem: tradução conhecida → poda do jargão → frase genérica. Nunca devolve
 * texto com identificador de banco dentro; é isso que
 * `test/nada-de-sql-na-tela.test.ts` cobra.
 */
export function emPortugues(frase: string | null | undefined): string {
  const original = (frase ?? '').split('\n')[0].trim();
  if (original === '') return GENERICA;

  for (const t of TRADUCOES) {
    if (t.marca.test(original)) {
      const nova = t.refazer(original);
      // Cinto e suspensório: se a tradução nascer com jargão dentro (nome de
      // lista com sublinhado, por exemplo, fora das aspas), ela ainda passa pela
      // poda. Traduzir não pode ser a porta que a poda fecharia.
      return pareceSql(nova) ? (semJargao(nova) || GENERICA) : nova;
    }
  }

  if (!pareceSql(original)) return original;

  const podada = semJargao(original);
  // Sobra curta demais não é frase, é caco. Melhor a genérica, que ao menos
  // diz que nada mudou.
  return podada.length >= 24 ? podada : GENERICA;
}

/* ───────────────────────── o que o Postgres escreve sozinho ───────────────── */

/**
 * As frases que o PRÓPRIO Postgres escreve — e que `emPortugues` não pega, porque
 * não têm sublinhado fora das aspas nem `ideworks.`.
 *
 *   new row violates row-level security policy for table "mural_notes"
 *   permission denied for function set_user_areas
 *   duplicate key value violates unique constraint "…"
 *
 * Cada uma carrega o nome de uma tabela, de uma função ou de uma restrição — e,
 * no caso da última, até o VALOR duplicado. Quem está do outro lado é uma pessoa
 * da equipe, e nada disso a ajuda a decidir o que fazer; a quem ataca, ajuda a
 * mapear o esquema. As frases que o banco escreve de propósito para gente (as
 * `raise exception` das funções) NÃO casam aqui e passam inteiras.
 */
const DETALHES_DO_POSTGRES: readonly { marca: RegExp; frase: string }[] = [
  {
    marca: /row-level security|permission denied|must be owner of|insufficient[ _]privilege/i,
    frase: 'Você não tem permissão para esta ação.',
  },
  {
    marca:
      /violates (?:check|foreign key|unique|not-null|exclusion) constraint|duplicate key value|null value in column|invalid input (?:syntax|value)|value too long|out of range|could not serialize|deadlock detected/i,
    frase: 'O banco não aceitou estes dados. Confira os campos e tente de novo.',
  },
];

/** A frase de uma recusa, sem o texto interno do Postgres. As escritas à mão passam intactas. */
export function frasePublicaDaRecusa(frase: string): string {
  const achada = DETALHES_DO_POSTGRES.find((d) => d.marca.test(frase));
  return achada ? achada.frase : frase;
}
