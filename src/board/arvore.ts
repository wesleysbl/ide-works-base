/**
 * A árvore EDITÁVEL — espaço, pasta e lista. Etapa F17.14.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE, SENDO QUE `board.ts` JÁ TEM `buildTree`
 *
 *   `buildTree` monta a árvore da NAVEGAÇÃO: só o que está vivo, e só o que
 *   chega até uma lista. Ele parte da view `ideworks.tree`, que começa em
 *   `lists` — e por isso ele é incapaz de representar três coisas que esta etapa
 *   precisa mostrar:
 *
 *     · o espaço recém-criado, que ainda não tem lista nenhuma;
 *     · a pasta recém-criada, pelo mesmo motivo;
 *     · o que foi ARQUIVADO — que precisa aparecer para poder ser desarquivado.
 *
 *   Um espaço criado pela tela que não aparece na tela é o pior defeito
 *   possível numa etapa cujo produto é criar espaço. Daí a segunda montagem.
 *
 *   As DUAS continuam existindo, e uma prova as obriga a concordar: ver
 *   `scripts/provar-arvore-na-tela.mjs`. `buildTree` alimenta o menu de listas
 *   do modal de tarefa (`MenuDeListas`), e `paraNavegacao` aqui embaixo produz
 *   exatamente a mesma forma a partir desta árvore — para o modal não precisar
 *   de uma segunda ida ao servidor.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 *   Falar com o banco e decidir permissão. Quem pode criar espaço é
 *   `spaces_write` (só administrador); quem pode criar pasta e lista é
 *   `can_see_space`. Antecipar isso aqui daria uma segunda regra de acesso — a
 *   dívida 8.1 outra vez — e ainda esconderia a recusa que o banco escreveu.
 *
 * "VIVO" É A CORRENTE INTEIRA, E ELA VEM DO BANCO
 *   `listaViva` chega pronto de `ideworks.tree.is_live`, que já calcula espaço +
 *   pasta + lista num lugar só. Aqui a conta só se repete para os dois níveis
 *   que a view não alcança — o espaço e a pasta sem lista —, e é a mesma regra:
 *   um nó está vivo quando ele e todos os ancestrais dele estão sem carimbo.
 */

import type { TreeList, TreeSpace } from '@/board/board';

/* ───────────────────────────── a linha crua ───────────────────────────── */

/**
 * Uma linha do `GET /board/tree/full`.
 *
 * Vem achatada como a da view: espaço sem pasta traz `folderId` nulo, e espaço
 * (ou pasta) sem lista traz `listId` nulo. É o `left join` aparecendo tal como
 * é, em vez de três consultas que podem discordar entre si.
 */
export type FullTreeRow = {
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  spaceArchivedAt: string | null;
  categoryId: string | null;
  /** A empresa — `client_categories` É a empresa desde a F14. */
  categoryName: string | null;

  folderId: string | null;
  folderName: string | null;
  folderArchivedAt: string | null;

  listId: string | null;
  listName: string | null;
  listContent: string | null;
  listArchivedAt: string | null;
  /** `ideworks.tree.is_live` — a corrente inteira, calculada pelo banco. */
  listIsLive: boolean;
  liveTasks: number;
  totalTasks: number;

  /**
   * O CLIENTE DE QUEM A LISTA É — F17.43.
   *
   * ⚠️ ELE NÃO DÁ ALCANCE A NINGUÉM. A lista continua sendo vista por quem
   * alcança o espaço dela, e só. O vínculo serve para NAVEGAR (a lista leva à
   * ficha) e para o quadro poder falar com a entrega — ver o cabeçalho da
   * migration da F17.43.
   *
   * ⚠️ O NOME PODE VIR NULO COM O IDENTIFICADOR PREENCHIDO, e isso é correto:
   * quem enxerga a lista mas não enxerga o cliente lê a lista sem o vínculo. A
   * política `clients_select` é quem apaga o nome, e a tela não tenta adivinhá-lo.
   */
  clientId: string | null;
  clientName: string | null;
  /**
   * A marca "exige cliente" da lista — F38, Fase 7. Lista SEM cliente com a
   * marca é compartilhada (toda tarefa nova escolhe o cliente); sem a marca é
   * interna. Opcional: servidor de antes da Fase 7 não a manda.
   */
  requiresClient?: boolean;

  /** De `list_workflow`: o nome da esteira resolvida e de que nível ela veio. */
  workflowName: string | null;
  inheritedFrom: 'list' | 'folder' | 'space' | null;
};

/** Uma empresa, para o seletor de "espaço novo". */
export type Empresa = { id: string; name: string };

/**
 * Um cliente ao alcance para trazer ao quadro — F17.43, informado na F17.83.
 *
 * ⚠️ A CONTAGEM VEM DO SERVIDOR, na mesma consulta. Recalcular aqui — olhando
 * a árvore, filtrando arquivada, somando de outro espaço — daria uma segunda
 * opinião sobre "já tem lista neste espaço", e ela ficaria para trás na
 * primeira aba aberta há dez minutos.
 *
 * `listCountInSpace` é quantas listas deste cliente JÁ EXISTEM neste espaço,
 * inclusive as arquivadas. Zero é "ainda não veio"; um ou mais é selo, não
 * trava: trazer de novo cria outra lista.
 *
 * `active` vem de `clients.is_active`. O inativo continua sendo oferecido —
 * quem quer a lista de um cliente que parou, quer o histórico dele —, mas
 * ele fica marcado e desce na ordem.
 */
export type ClienteParaTrazer = {
  id: string;
  name: string;
  active: boolean;
  listCountInSpace: number;
};

/**
 * Quantas listas deste cliente o selo conta NESTE espaço.
 *
 * É a regra que a consulta de `readClientsForSpace` implementa com
 * `count(l.id)` — sem `archived_at is null`, sem recorte de pasta. A tela
 * não chama isto: ela só escreve o número que chegou.
 *
 * Lista arquivada CONTA. Arquivar não desfaz o vínculo; o selo responde
 * "já tem lista aqui", não "já tem lista viva". Se a arquivada não
 * contasse, a caixa diria que o cliente nunca veio enquanto a lista dele
 * dorme no arquivo.
 *
 * Lista de outro espaço NÃO entra: o mesmo cliente pode ter lista no TIME
 * HELENA e no TIME JUCA; o selo é por espaço, igual à leitura.
 */
export function contarListasDoClienteNoEspaco(
  listas: readonly {
    clientId: string | null;
    spaceId: string;
    archivedAt: string | null;
  }[],
  clientId: string,
  spaceId: string,
): number {
  let n = 0;
  for (const l of listas) {
    if (l.clientId !== clientId) continue;
    if (l.spaceId !== spaceId) continue;
    n += 1;
  }
  return n;
}

/**
 * O selo ao lado do nome. Zero some — "já tem 0" seria ruído em cada linha.
 * A tela não recalcula: só escreve o número que o servidor mandou.
 */
export function seloDeListasNoEspaco(listCountInSpace: number): string | null {
  if (listCountInSpace <= 0) return null;
  if (listCountInSpace === 1) return 'já tem 1 lista aqui';
  return `já tem ${listCountInSpace} listas aqui`;
}

export type ArvoreCompleta = {
  companies: Empresa[];
  spaces: FullTreeRow[];
};

/* ───────────────────────────── os nós ───────────────────────────── */

export type NoDeLista = {
  kind: 'list';
  id: string;
  name: string;
  content: string | null;
  archivedAt: string | null;
  /** Vivo pela corrente inteira. Vem do banco. */
  live: boolean;
  liveTasks: number;
  totalTasks: number;
  workflowName: string | null;
  inheritedFrom: 'list' | 'folder' | 'space' | null;
  spaceId: string;
  folderId: string | null;
  /** De que cliente esta lista é — F17.43. Nulo é lista sem cliente. */
  clientId: string | null;
  /** O nome dele, quando quem lê também alcança o cliente. Ver `FullTreeRow`. */
  clientName: string | null;
  /** A marca "exige cliente" — F38, Fase 7. Ver `FullTreeRow.requiresClient`. */
  requiresClient: boolean;
};

/**
 * Há nome para escrever e ficha para abrir.
 *
 * `clientName` nulo com `clientId` preenchido é quem alcança a lista e não
 * alcança o cliente. Sem nome, atalho para 404 é pior que atalho nenhum — e
 * a regra vale nos três lugares: a linha da árvore, o cabeçalho da lista e a
 * visão geral do espaço.
 *
 * ⚠️ NÃO ASSUME UNICIDADE. Cada lista responde por si. Duas listas do mesmo
 * cliente passam as duas.
 */
export function listaLevaAFicha<
  T extends { clientId: string | null; clientName: string | null },
>(lista: T): lista is T & { clientId: string; clientName: string } {
  return lista.clientId !== null && lista.clientName !== null;
}

/**
 * A EMPRESA SÓ APARECE QUANDO DESFAZ UM HOMÔNIMO — F31.
 *
 * Até a F28 a árvore escrevia `{empresa} · ` na frente de todo espaço, e a F28
 * tirou o prefixo só quando o nome já o repetia (`Ide · AGÊNCIA IDE`). Em
 * 25/09 o Wesley decidiu que o sistema "será apenas Ide": a empresa deixou de
 * ser informação na tela e virou ruído — ela continua decidindo quem vê o quê
 * (é a primeira barreira do banco), mas não precisa ser lida em toda linha.
 *
 * ⚠️ O PREFIXO NÃO SOME DE TODO, e é de propósito. A casa tem DOIS espaços
 * `Demandas` — um da Ide e um da Ide Hub —, e a Ide Hub não é omitida (é o
 * balde compartilhado da Ide; decisão 4 do plano da F31). Sem nada na frente, a
 * barra lateral e o menu de mover mostrariam duas linhas idênticas que levam a
 * lugares diferentes. Então a empresa volta SÓ para quem tem homônimo em OUTRA
 * empresa, e só entre os espaços que estão juntos na mesma lista: o espaço que
 * não tem gêmeo ali fica com o nome sozinho.
 *
 * O NOME SE COMPARA SEM CAIXA, SEM ACENTO E SEM PONTUAÇÃO — `Demandas` e
 * `DEMANDAS` são o mesmo nome para quem lê. Homônimo dentro da MESMA empresa
 * não ganha prefixo: ele não desfaria nada.
 *
 * Devolve os ids dos espaços que precisam da empresa escrita.
 */
export function espacosHomonimos(
  espacos: readonly { id: string; name: string; categoryName: string | null }[],
): Set<string> {
  const chave = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .join(' ');
  const empresasPorNome = new Map<string, Set<string>>();
  for (const e of espacos) {
    const nome = chave(e.name);
    const empresas = empresasPorNome.get(nome) ?? new Set<string>();
    empresas.add(chave(e.categoryName ?? ''));
    empresasPorNome.set(nome, empresas);
  }
  const homonimos = new Set<string>();
  for (const e of espacos) {
    if (!e.categoryName) continue;
    if ((empresasPorNome.get(chave(e.name))?.size ?? 0) > 1) homonimos.add(e.id);
  }
  return homonimos;
}

/**
 * O nome do espaço como os menus e caminhos escrevem — F31. `Demandas`, ou
 * `Ide Hub · Demandas` quando há outro `Demandas` de outra empresa na mesma
 * lista (ver `espacosHomonimos`).
 */
export function nomeDoEspaco(
  espaco: { id: string; name: string; categoryName: string | null },
  homonimos: ReadonlySet<string>,
): string {
  return homonimos.has(espaco.id) && espaco.categoryName
    ? `${espaco.categoryName} · ${espaco.name}`
    : espaco.name;
}

/**
 * AS UNIDADES QUE O BALÃO "ESPAÇO NOVO" OFERECE — F31.
 *
 * O servidor manda o catálogo inteiro (`GET /board/tree/full`, `companies`),
 * inclusive `Sem categoria` — a linha técnica da F2.4, que não é empresa de
 * ninguém. Espaço nascido nela ficaria fora de toda unidade, e ninguém o veria
 * pela regra de alcance. Por isso ela NUNCA é oferecida.
 *
 * Do resto, oferece-se o que a pessoa ALCANÇA, e o alcance que a tela conhece é
 * a própria árvore: as unidades donas de algum espaço que chegou. Com UMA só,
 * o balão nem pergunta — o campo some e o espaço nasce nela ("será apenas Ide",
 * Wesley, 25/09). Com mais de uma, o campo fica.
 *
 * ⚠️ UNIDADE SEM ESPAÇO NENHUM NÃO É OFERECIDA enquanto houver outra com espaço,
 * e isso é troca consciente: a tela não sabe, sem outra consulta, de quais
 * unidades a pessoa é (a regra mora no banco, e repeti-la aqui seria a segunda
 * verdade). A árvore vazia cai no catálogo inteiro, sem a linha técnica, para o
 * primeiro espaço ainda ter onde nascer. Quem cria espaço é o administrador, e
 * o banco continua recusando unidade fora do alcance dele.
 */
export function unidadesDoEspacoNovo(
  companies: readonly Empresa[],
  arvore: readonly { categoryId: string | null }[],
): Empresa[] {
  const tecnica = (nome: string) =>
    nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('pt-BR') === 'sem categoria';
  const reais = companies.filter((c) => !tecnica(c.name));
  const donas = new Set(arvore.flatMap((e) => (e.categoryId === null ? [] : [e.categoryId])));
  const alcancadas = reais.filter((c) => donas.has(c.id));
  return alcancadas.length > 0 ? alcancadas : reais;
}

export type NoDePasta = {
  kind: 'folder';
  id: string;
  name: string;
  archivedAt: string | null;
  live: boolean;
  spaceId: string;
  lists: NoDeLista[];
};

export type NoDeEspaco = {
  kind: 'space';
  id: string;
  name: string;
  color: string | null;
  archivedAt: string | null;
  live: boolean;
  categoryId: string | null;
  categoryName: string | null;
  folders: NoDePasta[];
  /** Listas penduradas direto no espaço — o `Skills` da referência. */
  lists: NoDeLista[];
};

export type NoDaArvore = NoDeEspaco | NoDePasta | NoDeLista;

/**
 * A árvore montada.
 *
 * A ORDEM É A DO BANCO, e ela não é refeita aqui. A consulta já ordena por
 * empresa, `sort_order` e nome; reordenar em JavaScript daria uma segunda
 * opinião sobre a mesma coisa, e a segunda opinião é a que fica para trás
 * quando o `sort_order` passar a ser editável.
 */
export function buildFullTree(rows: readonly FullTreeRow[]): NoDeEspaco[] {
  const espacos = new Map<string, NoDeEspaco>();
  const pastas = new Map<string, NoDePasta>();

  for (const r of rows) {
    let espaco = espacos.get(r.spaceId);
    if (!espaco) {
      espaco = {
        kind: 'space',
        id: r.spaceId,
        name: r.spaceName,
        color: r.spaceColor,
        archivedAt: r.spaceArchivedAt,
        // O espaço não tem ancestral: a corrente dele é ele mesmo.
        live: r.spaceArchivedAt === null,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        folders: [],
        lists: [],
      };
      espacos.set(r.spaceId, espaco);
    }

    let pasta: NoDePasta | null = null;
    if (r.folderId !== null) {
      pasta = pastas.get(r.folderId) ?? null;
      if (!pasta) {
        pasta = {
          kind: 'folder',
          id: r.folderId,
          name: r.folderName ?? '(sem nome)',
          archivedAt: r.folderArchivedAt,
          // A corrente da pasta é espaço + pasta. Mesma regra de `tree.is_live`,
          // aplicada ao nível que a view não alcança.
          live: espaco.archivedAt === null && r.folderArchivedAt === null,
          spaceId: r.spaceId,
          lists: [],
        };
        pastas.set(r.folderId, pasta);
        espaco.folders.push(pasta);
      }
    }

    if (r.listId === null) continue;

    const lista: NoDeLista = {
      kind: 'list',
      id: r.listId,
      name: r.listName ?? '(sem nome)',
      content: r.listContent,
      archivedAt: r.listArchivedAt,
      live: r.listIsLive,
      liveTasks: r.liveTasks,
      totalTasks: r.totalTasks,
      workflowName: r.workflowName,
      inheritedFrom: r.inheritedFrom,
      spaceId: r.spaceId,
      folderId: r.folderId,
      clientId: r.clientId,
      clientName: r.clientName,
      requiresClient: r.requiresClient === true,
    };

    if (pasta) pasta.lists.push(lista);
    else espaco.lists.push(lista);
  }

  return [...espacos.values()];
}

/* ───────────────────────────── mostrar ou esconder o arquivado ───────────── */

/**
 * A árvore sem o que está arquivado.
 *
 * Arquivar NÃO apaga (regra da F17.1: cada nível guarda o próprio instante), e
 * por isso a tela precisa dos dois modos — sem o modo "com arquivados" não
 * haveria como desarquivar nada, e o botão de arquivar seria uma porta sem
 * volta disfarçada de organização.
 */
export function somenteVivos(arvore: readonly NoDeEspaco[]): NoDeEspaco[] {
  return arvore
    .filter((e) => e.live)
    .map((e) => ({
      ...e,
      folders: e.folders
        .filter((f) => f.live)
        .map((f) => ({ ...f, lists: f.lists.filter((l) => l.live) })),
      lists: e.lists.filter((l) => l.live),
    }));
}

/** Quantos nós estão arquivados, por nível. É o que o interruptor conta. */
export function contarArquivados(arvore: readonly NoDeEspaco[]): {
  spaces: number;
  folders: number;
  lists: number;
  total: number;
} {
  let spaces = 0;
  let folders = 0;
  let lists = 0;
  for (const e of arvore) {
    if (e.archivedAt !== null) spaces += 1;
    for (const f of e.folders) {
      if (f.archivedAt !== null) folders += 1;
      for (const l of f.lists) if (l.archivedAt !== null) lists += 1;
    }
    for (const l of e.lists) if (l.archivedAt !== null) lists += 1;
  }
  return { spaces, folders, lists, total: spaces + folders + lists };
}

/** Todas as listas da árvore, em ordem de leitura. */
export function todasAsListas(arvore: readonly NoDeEspaco[]): NoDeLista[] {
  return arvore.flatMap((e) => [...e.folders.flatMap((f) => f.lists), ...e.lists]);
}

/* ───────────────────────────── a ponte com o modal ───────────────────────── */

const paraTreeList = (l: NoDeLista): TreeList => ({
  id: l.id,
  name: l.name,
  liveTasks: l.liveTasks,
  totalTasks: l.totalTasks,
});

/**
 * A mesma forma que `buildTree` produz, a partir desta árvore.
 *
 * O `MenuDeListas` do modal de tarefa fala `TreeSpace`. Traduzir aqui é uma
 * volta de laço; a alternativa seria a tela pedir a árvore duas vezes ao
 * servidor, ou o menu aprender uma segunda forma. Só o que está VIVO passa:
 * criar tarefa numa lista arquivada é criar trabalho num lugar que ninguém vê.
 */
export function paraNavegacao(arvore: readonly NoDeEspaco[]): TreeSpace[] {
  return somenteVivos(arvore)
    .filter((e) => e.folders.some((f) => f.lists.length > 0) || e.lists.length > 0)
    .map((e) => ({
      id: e.id,
      name: e.name,
      color: e.color,
      categoryName: e.categoryName,
      folders: e.folders
        .filter((f) => f.lists.length > 0)
        .map((f) => ({ id: f.id, name: f.name, lists: f.lists.map(paraTreeList) })),
      lists: e.lists.map(paraTreeList),
    }));
}

/* ─────────────────────── os destinos recentes — F17.63 ─────────────────────── */

/** Uma lista achada na árvore, com o caminho por escrito. */
export type ListaNaArvore = {
  id: string;
  /** `Demandas` */
  nome: string;
  /** `MIMI`, ou nulo quando a lista está solta no espaço. */
  pasta: string | null;
  /** `Conteúdo` — o espaço, com a empresa só quando desfaz homônimo (F31). */
  espaco: string;
  liveTasks: number;
};

/**
 * ONDE ESTÃO, NA ÁRVORE, ESTES IDS — na ORDEM em que foram pedidos.
 *
 * ⚠️ É AQUI QUE A SEÇÃO `Recentes` HERDA O ALCANCE, e é de propósito que ela
 * não tenha caminho próprio até o banco. A árvore que chega já veio recortada
 * pela política de linha de `lists`; um id lembrado no navegador que não esteja
 * nela simplesmente não é achado, e a seção o omite. Uma seção `Recentes` que
 * consultasse nomes por conta própria seria um segundo caminho de alcance — e
 * o segundo é sempre o que fica para trás quando o primeiro é corrigido (foram
 * quatro correções nesta semana: F17.32, F17.34, F17.54).
 *
 * A ORDEM É A DOS IDS, e não a da árvore: `Recentes` só quer dizer alguma coisa
 * se o último destino usado estiver em cima.
 */
export function acharListas(
  arvore: readonly TreeSpace[],
  ids: readonly string[],
): ListaNaArvore[] {
  const porId = new Map<string, ListaNaArvore>();
  const homonimos = espacosHomonimos(arvore);
  for (const espaco of arvore) {
    const nome = nomeDoEspaco(espaco, homonimos);
    const guardar = (lista: TreeList, pasta: string | null) => {
      if (porId.has(lista.id)) return;
      porId.set(lista.id, {
        id: lista.id,
        nome: lista.name,
        pasta,
        espaco: nome,
        liveTasks: lista.liveTasks,
      });
    };
    for (const l of espaco.lists) guardar(l, null);
    for (const f of espaco.folders) for (const l of f.lists) guardar(l, f.name);
  }

  const achadas: ListaNaArvore[] = [];
  const vistos = new Set<string>();
  for (const id of ids) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const achada = porId.get(id);
    if (achada) achadas.push(achada);
  }
  return achadas;
}

/* ───────────────────────────── mover a lista ───────────────────────────── */

/**
 * Para onde uma lista pode ir.
 *
 * ⚠️ AS DUAS COLUNAS VIAJAM JUNTAS, SEMPRE. `lists_folder_same_space_fk` é
 * chave composta `(folder_id, space_id) → folders (id, space_id)`: mandar
 * `folder_id` sem o `space_id` da pasta é um estado que o banco recusa, e
 * mandar só `space_id` deixando a pasta antiga é o mesmo erro do outro lado.
 * Com `folder_id` nulo a chave fica satisfeita por definição — é o que permite
 * a lista solta no espaço.
 *
 * O destino atual entra na lista, marcado: um menu de mover que esconde onde a
 * coisa está obriga a pessoa a lembrar de onde ela veio.
 */
export type DestinoDeLista = {
  chave: string;
  spaceId: string;
  folderId: string | null;
  /** `Demandas`, ou `Ide Hub · Demandas` quando há homônimo (F31). */
  espaco: string;
  /** `MIMI Enxovais`, ou nulo para a raiz do espaço. */
  pasta: string | null;
  atual: boolean;
};

export function destinosDeLista(
  arvore: readonly NoDeEspaco[],
  lista: Pick<NoDeLista, 'spaceId' | 'folderId'>,
): DestinoDeLista[] {
  const destinos: DestinoDeLista[] = [];
  const vivos = somenteVivos(arvore);
  const homonimos = espacosHomonimos(vivos);
  for (const e of vivos) {
    const nome = nomeDoEspaco(e, homonimos);
    destinos.push({
      chave: `${e.id}:`,
      spaceId: e.id,
      folderId: null,
      espaco: nome,
      pasta: null,
      atual: lista.spaceId === e.id && lista.folderId === null,
    });
    for (const f of e.folders) {
      destinos.push({
        chave: `${e.id}:${f.id}`,
        spaceId: e.id,
        folderId: f.id,
        espaco: nome,
        pasta: f.name,
        atual: lista.folderId === f.id,
      });
    }
  }
  return destinos;
}

/**
 * Toda lista viva da árvore, achatada e com o caminho por extenso — F17.41.
 *
 * A caixa de automação precisa oferecer PARA ONDE a tarefa vai, e o que está
 * ao alcance já é exatamente o que a árvore trouxe: `readTree` filtra por
 * `is_live` e a política de linha filtra o resto. Montar uma segunda consulta
 * de "listas que eu alcanço" seria uma segunda versão da regra de alcance.
 *
 * A lista de ORIGEM sai fora: encaminhar para a própria lista não encaminha
 * nada, e o banco recusa — oferecê-la seria oferecer o que vai ser recusado.
 */
export type ListaDoQuadro = {
  id: string;
  name: string;
  /** `Demandas`, ou `Demandas / MIMI Enxovais` quando há pasta. A empresa só
   *  entra na frente quando desfaz homônimo — F31, ver `espacosHomonimos`. */
  caminho: string;
};

export function listasDoQuadro(
  arvore: readonly NoDeEspaco[],
  exceto: string | null = null,
): ListaDoQuadro[] {
  const achadas: ListaDoQuadro[] = [];
  const vivos = somenteVivos(arvore);
  const homonimos = espacosHomonimos(vivos);
  for (const e of vivos) {
    const nome = nomeDoEspaco(e, homonimos);
    for (const l of e.lists) {
      if (l.id !== exceto) achadas.push({ id: l.id, name: l.name, caminho: nome });
    }
    for (const f of e.folders) {
      for (const l of f.lists) {
        if (l.id !== exceto) {
          achadas.push({ id: l.id, name: l.name, caminho: `${nome} / ${f.name}` });
        }
      }
    }
  }
  return achadas;
}

/* ───────────────────────────── a esteira da lista ───────────────────────── */

export const DE_ONDE_VEIO: Record<'list' | 'folder' | 'space', string> = {
  list: 'própria da lista',
  folder: 'herdada da pasta',
  space: 'herdada do espaço',
};

/** Um status em edição, na caixa de esteira. */
export type StatusEmEdicao = {
  /**
   * A LINHA QUE ESTA ETAPA JÁ É NO BANCO — acrescentado na F17.19.
   *
   * ⚠️ É ELE QUE FAZ RENOMEAR SER RENOMEAR. Sem o `id`, trocar `a fazer` por
   * `pendente` chega ao banco como "some uma etapa, nasce outra", e as tarefas
   * que estavam nela ficariam sem destino — a pessoa levaria uma pergunta que
   * ninguém precisava fazer. Com ele, `ideworks.set_list_workflow` reconhece a
   * mesma etapa e leva as tarefas junto.
   *
   * Ausente quer dizer ETAPA NOVA. É o que a lista de moldes manda, e é o que
   * o botão `+ etapa` cria.
   */
  id?: string;
  name: string;
  type: 'open' | 'unstarted' | 'custom' | 'done' | 'closed';
  color: string;
};

/**
 * Para onde vão as tarefas de uma etapa que a esteira nova não tem — F17.19.
 *
 * A tela só monta isto depois de o banco recusar dizendo QUAIS etapas ficaram
 * sem destino. Antes disso não há o que perguntar: etapa vazia que some não
 * pergunta nada a ninguém.
 */
export type DestinoDeEtapa = {
  /** O `id` da etapa que vai sumir. */
  de: string;
  /** O NOME da etapa de destino, entre as da esteira nova. */
  para: string;
};

/**
 * O que `create_status_set` recusaria, dito ANTES de gastar a ida ao banco.
 *
 * NÃO É A REGRA — a regra está na função do banco, que confere tudo de novo e
 * é quem manda. Isto existe só para a caixa poder desabilitar o botão e dizer
 * o que falta enquanto a pessoa digita. Se as duas divergirem, a do banco
 * ganha, e a tela mostra a frase dela.
 */
export function conferirEsteira(
  nome: string,
  statuses: readonly StatusEmEdicao[],
): string | null {
  if (nome.trim() === '') return 'A esteira precisa de um nome.';
  if (statuses.length === 0) return 'A esteira precisa de pelo menos um status.';
  if (statuses.some((s) => s.name.trim() === '')) return 'Todo status precisa de um nome.';

  const vistos = new Set<string>();
  for (const s of statuses) {
    const chave = s.name.trim().toLowerCase();
    if (vistos.has(chave)) return `O status "${s.name.trim()}" aparece duas vezes.`;
    vistos.add(chave);
  }

  const fecham = statuses.filter((s) => s.type === 'closed').length;
  if (fecham !== 1) {
    return `A esteira precisa de exatamente um status que FECHA (tipo "closed"), e tem ${fecham}. É ele que faz o quadro saber onde é o fim.`;
  }
  return null;
}

/* ─────────────────────── os grupos de status, F17.19 ─────────────────────── */

/**
 * OS QUATRO NOMES DA REFERÊNCIA, e por que são quatro para cinco tipos.
 *
 * O ClickUp agrupa o seletor de status assim, e foi assim que o usuário mandou:
 *
 *     Não iniciado    IDÉIAS · A FAZER
 *     Ativo           EM ANDAMENTO · REFAÇÃO
 *     Feito           REVISÃO INTERNA · EM APROVAÇÃO DO CLIENTE
 *     Fechado         CONCLUÍDO
 *
 * O enum `ideworks.status_type` tem CINCO valores, porque ele copia a API do
 * ClickUp e não a tela dele. O mapeamento, e o julgamento de cada linha:
 *
 *   `open`      → Não iniciado. É o status de entrada da esteira, aquele em que
 *                 a tarefa cai quando ninguém escolheu um.
 *   `unstarted` → Não iniciado. TAMBÉM. A API manda `open` para a coluna de
 *                 entrada e `unstarted` para as outras que ainda não começaram
 *                 — `idéias` e `a fazer` são exatamente esse par. Na tela do
 *                 ClickUp as duas aparecem sob o mesmo cabeçalho, e é o que o
 *                 usuário mandou.
 *   `custom`    → Ativo. É a tradução direta: no ClickUp, `custom` é o tipo de
 *                 toda coluna do meio do fluxo.
 *   `done`      → Feito. Terminou o trabalho, mas o cartão ainda está no
 *                 quadro. `publicar/agendar` é isso.
 *   `closed`    → Fechado. O fim, e há exatamente um por esteira — regra do
 *                 banco (`statuses_one_closing_key` mais `statuses_must_close`),
 *                 e não escolha da tela.
 *
 * ⚠️ ISTO SUBSTITUIU RÓTULOS MEUS. Eram `a fazer`, `não começou`, `no meio`,
 * `pronto` e `fecha o quadro` — inventados, e que não batiam com nada que a
 * equipe já lê no ClickUp dela. Nome que só existe aqui obriga a traduzir de
 * cabeça toda vez.
 */
export const GRUPOS_DE_STATUS = ['Não iniciado', 'Ativo', 'Feito', 'Fechado'] as const;

export type GrupoDeStatus = (typeof GRUPOS_DE_STATUS)[number];

export const GRUPO_DO_TIPO: Record<StatusEmEdicao['type'], GrupoDeStatus> = {
  open: 'Não iniciado',
  unstarted: 'Não iniciado',
  custom: 'Ativo',
  done: 'Feito',
  closed: 'Fechado',
};

/**
 * O caminho de volta: quatro nomes, cinco tipos.
 *
 * `Não iniciado` vira `unstarted` por padrão, e `normalizarEntrada` promove a
 * PRIMEIRA delas a `open` — ver a função. Escolher aqui seria escolher sem
 * saber a posição, e a posição é o que decide.
 */
export const TIPO_DO_GRUPO: Record<GrupoDeStatus, StatusEmEdicao['type']> = {
  'Não iniciado': 'unstarted',
  Ativo: 'custom',
  Feito: 'done',
  Fechado: 'closed',
};

/**
 * A PRIMEIRA ETAPA DE `Não iniciado` É A DE ENTRADA, E ELA É `open`.
 *
 * Por que isto existe: o seletor mostra quatro grupos, e dois tipos caem em
 * `Não iniciado`. Sem esta normalização, uma esteira inteira poderia sair sem
 * nenhum `open` — e `ideworks.first_open_status` é quem decide onde a tarefa
 * cai quando ninguém escolheu status. Ela tem plano B (o primeiro que não
 * fecha), então não quebraria; mas a entrada da esteira passaria a depender da
 * ordem de desempate em vez de estar declarada.
 *
 * É pura, e é a mesma conta que o ClickUp faz: uma coluna de entrada, as outras
 * "não começaram".
 */
export function normalizarEntrada(
  statuses: readonly StatusEmEdicao[],
): StatusEmEdicao[] {
  let jaTemEntrada = false;
  return statuses.map((s) => {
    if (GRUPO_DO_TIPO[s.type] !== 'Não iniciado') return { ...s };
    if (jaTemEntrada) return { ...s, type: 'unstarted' as const };
    jaTemEntrada = true;
    return { ...s, type: 'open' as const };
  });
}

/** A esteira que um espaço novo ganha ao nascer. Ver `server/tree.ts`. */
export const ESTEIRA_PADRAO: StatusEmEdicao[] = [
  { name: 'a fazer', type: 'open', color: '#d3d3d3' },
  { name: 'concluída', type: 'closed', color: '#6bc950' },
];

/* ───────────────────────────── acesso por nó (F17.23) ───────────────────── */

/**
 * Os quatro níveis, como o usuário os descreveu.
 *
 * O NOME NA TELA MORA AQUI, NUM LUGAR SÓ — decisão D5: código em inglês,
 * interface em português. Espalhar a tradução pelas telas faria a terceira que
 * a escrevesse inventar uma palavra diferente.
 */
export type NivelDeAcesso = 'view' | 'execute' | 'create' | 'manage';

export const NIVEIS: readonly NivelDeAcesso[] = ['view', 'execute', 'create', 'manage'];

export const ROTULO_DO_NIVEL: Record<NivelDeAcesso, string> = {
  view: 'Ver',
  execute: 'Executar',
  create: 'Criar',
  manage: 'Administrar',
};

export const O_QUE_O_NIVEL_PODE: Record<NivelDeAcesso, string> = {
  view: 'Lê o quadro e as tarefas. Não muda nada.',
  execute: 'Arrasta cartão, comenta, anexa, conclui e edita a tarefa. Não cria nem apaga.',
  create: 'Tudo de Executar, mais criar tarefa, lista e pasta.',
  manage: 'Tudo de Criar, mais mudar as etapas da esteira e dar acesso a outros.',
};

export type PessoaComNivel = { userId: string; name: string; level: NivelDeAcesso };

export type AcessoDoNo = {
  /** O nó em si está fechado? */
  restricted: boolean;
  /**
   * As paredes ACIMA dele.
   *
   * É o que impede a tela de mentir: numa lista dentro de uma pasta fechada, uma
   * concessão dada aqui não alcança quem a pasta barra, porque o nível de um nó
   * é o MENOR da corrente. Sem esta lista, quem concedesse acharia que concedeu.
   */
  closedAbove: Array<{ level: 'space' | 'folder'; id: string; name: string }>;
  /** As concessões escritas NESTE nó. */
  grants: PessoaComNivel[];
  /** Quem alcança de verdade, já contando a corrente inteira e a empresa. */
  reachers: Array<PessoaComNivel & { admin: boolean }>;
  /** Quem pergunta pode mudar isto? */
  canGrant: boolean;
  /** E em que nível ele próprio está aqui. */
  myLevel: NivelDeAcesso | null;
};
