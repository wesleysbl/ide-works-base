/**
 * "IR PARA…" — F43, Fase 9: as regras puras da busca que leva a qualquer lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *
 *   As críticas ao sistema eram "não sei onde começa ou termina algo". A barra
 *   única (Fase 8) pôs cada destino uma vez, com nome; esta fase dá o atalho de
 *   quem já sabe o nome do lugar: `Ctrl + K` (ou o campo no alto da barra),
 *   digitar três letras e `Enter`. Telas, clientes, espaços, pastas e listas — e,
 *   por último, "Procurar tarefas com …", que leva a `Todas as tarefas` já
 *   filtrada.
 *
 * ⚠️ NADA AQUI É CAMINHO NOVO ATÉ O BANCO
 *   As telas saem da MESMA regra da barra (`itensVisiveis`, com área, papel e a
 *   chave do chat) e do menu da conta (`podeVer`); clientes e listas saem da
 *   árvore que a barra já carregou (`useArvoreCompleta`, recortada pela política
 *   de linha). Um id que a pessoa não alcança simplesmente não está ali — é o
 *   mesmo argumento de `acharListas`: um segundo caminho de alcance é sempre o
 *   que fica para trás quando o primeiro é corrigido. As tarefas NÃO são
 *   buscadas daqui: a busca delas mora em `Todas as tarefas` (`?busca=`), que
 *   vai ao banco com o recorte certo.
 *
 * PURO, E POR ISSO PROVADO SEM NAVEGADOR
 *   A suíte desenha no servidor (`renderToStaticMarkup`, nenhum efeito roda).
 *   O atalho, a ordem dos resultados e o teto de cada grupo são decididos aqui
 *   e conferidos caso a caso em `ir-para.test.ts`; o componente (`IrPara.tsx`)
 *   só liga os fios.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type Area } from '@/auth/areas';
import {
  type NoDeEspaco,
  espacosHomonimos,
  listaLevaAFicha,
  nomeDoEspaco,
  somenteVivos,
} from '@/board/arvore';
import { TETO_DA_BUSCA } from '@/board/filtro';
import { normalizarBusca } from '@/board/meu-trabalho';
import { ehCampoDeTexto } from '@/board/secao-recolhivel';
import {
  type ItemDaBarra,
  type Preferencias,
  type SecaoDaBarra,
  DESTINO_DO_ITEM,
  ITENS_DA_BARRA,
  PADRAO,
  ROTULO_DO_ITEM,
  SECOES_DA_BARRA,
  itensVisiveis,
} from '@/ui/preferencias';

/* ───────────────────────────── o atalho ───────────────────────────── */

/**
 * A tecla abre a busca? `Ctrl + K`, ou `⌘ + K` no Mac.
 *
 * ⚠️ O EDITOR RICO JÁ USA `Ctrl/⌘ + K` — é "inserir link" (`atalhoDeTecla`, em
 *   `@/board/barra-de-comandos`). Roubar a tecla dele seria trocar um gesto que
 *   a equipe usa todo dia por outro. Então, com o foco num lugar onde se
 *   escreve (`ehCampoDeTexto`: `input`, `textarea`, `select` e tudo o que é
 *   `contenteditable` — o editor é um), o atalho NÃO dispara e a tecla fica com
 *   o campo. É a mesma regra do `Ctrl + .` de recolher a barra.
 *
 * ⚠️ NEM DENTRO DE OUTRA JANELA. Com o foco num diálogo aberto (o painel do
 *   cliente, a pergunta "Sair sem salvar?", o próprio "Ir para…"), abrir a busca
 *   por cima empilharia duas camadas modais — e escolher um destino deixaria a
 *   de baixo aberta, esquecida. Quem está numa janela termina nela primeiro.
 *   (O "Ir para…" aberto fecha com a mesma tecla — quem cuida disso é ele.)
 *
 * Modificador a mais não conta (`Shift`, `Alt` — e o `AltGr` do Windows chega
 *   como `Ctrl + Alt`), nem a tecla que se repete por estar segurada: segurar
 *   `Ctrl + K` abriria e fecharia a janela em rajada. E a tecla que alguém já
 *   tratou (`defaultPrevented`) é de quem tratou.
 */
export function ehAtalhoDaBusca(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** O alvo da tecla. Opcional: sem ele, conta como fora de campo. */
  target?: unknown;
  defaultPrevented?: boolean;
  repeat?: boolean;
}): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (e.shiftKey || e.altKey) return false;
  if (e.defaultPrevented === true || e.repeat === true) return false;
  if (e.key.toLowerCase() !== 'k') return false;
  if (ehCampoDeTexto(e.target)) return false;
  return !dentroDeJanela(e.target);
}

/**
 * O alvo mora dentro de um `[role="dialog"]`? Lê só `closest`, pelo mesmo
 * motivo de `ehCampoDeTexto` ler só `tagName`: a suíte roda em `node`, sem
 * `HTMLElement`, e um objeto com o mesmo método prova a mesma regra.
 */
function dentroDeJanela(alvo: unknown): boolean {
  if (typeof alvo !== 'object' || alvo === null) return false;
  const el = alvo as { closest?: unknown };
  if (typeof el.closest !== 'function') return false;
  return (el.closest as (s: string) => unknown).call(alvo, '[role="dialog"]') != null;
}

/**
 * Como a tecla se escreve para quem lê o gatilho: `⌘K` no Mac (e no iPad com
 * teclado), `Ctrl K` no resto. Recebe a plataforma como texto para ser pura —
 * quem lê o `navigator` é o componente.
 */
export function teclaDoAtalho(plataforma: string): string {
  return /mac|iphone|ipad|ipod/i.test(plataforma) ? '⌘K' : 'Ctrl K';
}

/**
 * A plataforma, como o navegador a diz. `userAgentData` é o caminho novo (o
 * Chrome já esvazia o `platform` antigo em parte das versões); `platform`
 * cobre o Safari e o Firefox. Sem `navigator`, texto vazio — e a tecla sai
 * `Ctrl K`, a de quase toda a equipe.
 */
export function plataformaDoNavegador(): string {
  if (typeof navigator === 'undefined') return '';
  const n = navigator as Navigator & { userAgentData?: { platform?: string } };
  return n.userAgentData?.platform || n.platform || '';
}

/* ───────────────────────────── os destinos ───────────────────────────── */

export type TipoDeDestino = 'tela' | 'cliente' | 'espaco' | 'pasta' | 'lista' | 'tarefas';

/** Um lugar para onde a busca leva. */
export type Destino = {
  /** Única entre todos os destinos — vira o `id` da opção na tela. */
  chave: string;
  tipo: TipoDeDestino;
  /** O nome que a pessoa reconhece (e o que mais pesa na busca). */
  rotulo: string;
  /** A linha calma ao lado do nome: o tipo e onde mora ("Lista · Conteúdo › MIMI"). */
  detalhe?: string;
  /**
   * Outras palavras que também acham o destino, com peso menor que o nome: os
   * nomes que a equipe usa para a tela ("agenda" é o Calendário) e, nas listas,
   * o espaço, a pasta e o cliente — "time a" acha as listas da pasta TIME A.
   */
  apelidos?: readonly string[];
  /** O endereço, para o `navigate` do roteador. */
  para: string;
};

/**
 * Os nomes que a equipe usa para cada tela da barra. Nenhum deles aparece na
 * tela: servem só para achar. Sem eles, quem procura "clientes" não chegaria
 * ao Painel, que é a carteira de clientes.
 */
const APELIDOS_DO_ITEM: Record<ItemDaBarra, readonly string[]> = {
  avisos: ['avisos', 'caixa de entrada', 'menções'],
  chat: ['mensagens', 'conversas'],
  minhas: ['meu trabalho'],
  todas: ['tarefas da equipe'],
  quadro: ['kanban', 'listas'],
  painel: ['clientes', 'carteira'],
  calendario: ['agenda', 'datas'],
  planejamento: ['contrato', 'mês do cliente', 'semanas'],
  controle: ['semana', 'equipe', 'atribuir'],
};

/**
 * AS TELAS DO MENU DA CONTA — as mesmas de `ContaNoPe` (Pessoas, Catálogos,
 * Meta e Agentes de IA), com a mesma regra: área por `podeVer`, e Agentes de IA
 * para qualquer pessoa (a rota da API é `livre`; ver o cabeçalho de
 * `ContaNoPe`). O Ranking de criativos entra junto da Meta porque é uma tela
 * da mesma área que só se alcançava passando por ela.
 *
 * ⚠️ UMA LISTA À PARTE, E A SUÍTE AMARRA AS DUAS: `ir-para.test.ts` desenha o
 *   menu da conta e confere que todo destino dele está aqui. O menu é um
 *   arquivo de componente, e não pode exportar a lista dele (regra do
 *   recarregamento rápido do Vite).
 */
const TELAS_DA_CONTA: readonly {
  area: Area | null;
  para: string;
  rotulo: string;
  apelidos: readonly string[];
}[] = [
  { area: 'pessoas', para: '/pessoas', rotulo: 'Pessoas', apelidos: ['equipe', 'usuários', 'convidar', 'acessos'] },
  { area: 'catalogos', para: '/catalogos', rotulo: 'Catálogos', apelidos: ['planos', 'etiquetas', 'unidades'] },
  { area: 'meta', para: '/meta', rotulo: 'Meta', apelidos: ['anúncios', 'ads', 'campanhas', 'resultados', 'instagram'] },
  { area: 'meta', para: '/meta/ranking', rotulo: 'Ranking de criativos', apelidos: ['meta', 'resultados', 'anúncios'] },
  { area: null, para: '/conexoes', rotulo: 'Agentes de IA', apelidos: ['conexões', 'integrações', 'agentes'] },
];

/** O que a sessão alcança — os mesmos três números que a barra já calcula. */
export type AlcanceDoIrPara = {
  /** `podeVer(sessao, area)` — sim a tudo enquanto a sessão carrega. */
  alcanca: (area: Area) => boolean;
  /** `ehAdmin(sessao)` — o Controle da semana é por papel (`ITENS_SO_ADMIN`). */
  souAdmin: boolean;
  /** A chave do chat (`chatVisivelNaBarra`). */
  chatOk: boolean;
};

/**
 * A barra com tudo à vista. A busca NÃO segue o `Personalizar`: esconder um
 * item da barra é tirar ruído da coluna, não perder o caminho até a tela — e a
 * busca é justamente o caminho de quem não quer a tela à vista o tempo todo.
 * O que ela segue é o ALCANCE (área, papel, chave do chat), pela mesma função
 * que a barra usa.
 */
const TUDO_A_VISTA: Preferencias = {
  ...PADRAO,
  itens: Object.fromEntries(ITENS_DA_BARRA.map((i) => [i, true])) as Record<ItemDaBarra, boolean>,
  secoes: Object.fromEntries(SECOES_DA_BARRA.map((s) => [s, true])) as Record<SecaoDaBarra, boolean>,
};

/** As telas que a busca oferece, na ordem da barra e depois a do menu da conta. */
export function telasDoIrPara({ alcanca, souAdmin, chatOk }: AlcanceDoIrPara): Destino[] {
  const daBarra = SECOES_DA_BARRA.flatMap((s) => itensVisiveis(TUDO_A_VISTA, s, alcanca, souAdmin))
    .filter((i) => i !== 'chat' || chatOk)
    .map(
      (i): Destino => ({
        chave: `tela:${i}`,
        tipo: 'tela',
        rotulo: ROTULO_DO_ITEM[i],
        apelidos: APELIDOS_DO_ITEM[i],
        para: DESTINO_DO_ITEM[i],
      }),
    );
  const daConta = TELAS_DA_CONTA.filter((t) => t.area === null || alcanca(t.area)).map(
    (t): Destino => ({
      chave: `tela:${t.para}`,
      tipo: 'tela',
      rotulo: t.rotulo,
      apelidos: t.apelidos,
      para: t.para,
    }),
  );
  return [...daBarra, ...daConta];
}

/**
 * Clientes, espaços, pastas e listas da árvore JÁ CARREGADA.
 *
 * Só o que está vivo: uma lista arquivada não é lugar para onde se vai
 * trabalhar, e a árvore da barra também a esconde por padrão.
 *
 * O CLIENTE SAI DAS LISTAS, e só quando a lista leva à ficha
 *   (`listaLevaAFicha`: com id E nome — sem nome é quem alcança a lista e não
 *   alcança o cliente). É a mesma regra do atalho de cliente na árvore. E só
 *   com `podeVerClientes` (a área `entrega`, onde moram `/clients` e a ficha):
 *   sem ela a ficha responderia 403, e botão que responde 403 é botão morto com
 *   um passo a mais.
 */
export function destinosDaArvore(
  arvore: readonly NoDeEspaco[],
  podeVerClientes: boolean,
): { clientes: Destino[]; lugares: Destino[] } {
  const vivos = somenteVivos(arvore);
  const homonimos = espacosHomonimos(vivos);
  const lugares: Destino[] = [];
  const clientes = new Map<string, Destino>();

  for (const espaco of vivos) {
    const nomeDoLugar = nomeDoEspaco(espaco, homonimos);
    lugares.push({
      chave: `espaco:${espaco.id}`,
      tipo: 'espaco',
      rotulo: nomeDoLugar,
      detalhe: 'Espaço',
      para: `/quadro/espaco/${espaco.id}`,
    });
    const lista = (l: NoDeEspaco['lists'][number], pasta: string | null) => {
      lugares.push({
        chave: `lista:${l.id}`,
        tipo: 'lista',
        rotulo: l.name,
        detalhe: pasta === null ? `Lista · ${nomeDoLugar}` : `Lista · ${nomeDoLugar} › ${pasta}`,
        apelidos: [nomeDoLugar, ...(pasta === null ? [] : [pasta]), ...(l.clientName ? [l.clientName] : [])],
        para: `/quadro/${l.id}`,
      });
      if (podeVerClientes && listaLevaAFicha(l) && !clientes.has(l.clientId)) {
        clientes.set(l.clientId, {
          chave: `cliente:${l.clientId}`,
          tipo: 'cliente',
          rotulo: l.clientName,
          // Sem `detalhe`: o grupo já se chama "Clientes", e "Cliente" ao lado
          // de cada nome seria a mesma palavra duas vezes na mesma linha.
          para: `/cliente/${l.clientId}`,
        });
      }
    };
    for (const pasta of espaco.folders) {
      lugares.push({
        chave: `pasta:${pasta.id}`,
        tipo: 'pasta',
        rotulo: pasta.name,
        detalhe: `Pasta · ${nomeDoLugar}`,
        apelidos: [nomeDoLugar],
        para: `/quadro/pasta/${pasta.id}`,
      });
      for (const l of pasta.lists) lista(l, pasta.name);
    }
    for (const l of espaco.lists) lista(l, null);
  }

  return {
    clientes: [...clientes.values()].sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
    lugares,
  };
}

/* ───────────────────────────── a busca ───────────────────────────── */

/** As palavras de um texto, sem acento e sem caixa. "Mês do cliente" → mes, do, cliente. */
const palavrasDe = (texto: string): string[] =>
  normalizarBusca(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * QUANTO o destino casa com a consulta — menor é melhor, `null` é não casa.
 *
 *   0  o nome inteiro é o que se digitou        "Planejamento"
 *   1  o nome começa com o que se digitou        "plan"   → Planejamento
 *   2  cada palavra digitada começa uma palavra do nome
 *                                                 "tar to" → Todas as tarefas
 *   3  idem, contando os apelidos (onde mora, como a equipe chama)
 *                                                 "agenda" → Calendário
 *   4  o que se digitou aparece no meio do nome  "nej"    → Planejamento
 *
 * Começo de palavra antes de pedaço no meio: quem digita "cal" quer o
 * Calendário, e não a lista "Local" que por acaso tem "cal" dentro. Sem acento
 * e sem caixa dos dois lados (`normalizarBusca`): quem digita no celular não
 * põe acento, e "calendario" tem de achar "Calendário".
 */
export function pontuar(consulta: string, destino: Pick<Destino, 'rotulo' | 'apelidos'>): number | null {
  const q = normalizarBusca(consulta).trim().replace(/\s+/g, ' ');
  if (q === '') return null;
  const nome = normalizarBusca(destino.rotulo).trim();
  if (nome === q) return 0;
  if (nome.startsWith(q)) return 1;
  const procuradas = palavrasDe(q);
  const cobre = (palavras: readonly string[]) =>
    procuradas.length > 0 && procuradas.every((p) => palavras.some((w) => w.startsWith(p)));
  const doNome = palavrasDe(nome);
  if (cobre(doNome)) return 2;
  if (destino.apelidos && cobre([...doNome, ...destino.apelidos.flatMap(palavrasDe)])) return 3;
  if (nome.includes(q)) return 4;
  return null;
}

export type ChaveDoGrupo = 'telas' | 'clientes' | 'listas' | 'tarefas';

export const ROTULO_DO_GRUPO: Record<ChaveDoGrupo, string> = {
  telas: 'Telas',
  clientes: 'Clientes',
  listas: 'Listas',
  tarefas: 'Tarefas',
};

/**
 * O TETO DE CADA GRUPO. A busca é para IR, não para listar: com uma letra só,
 * a árvore inteira casaria, e a tela viraria um segundo mapa — o que a barra já
 * é. Quem não achou entre os primeiros digita mais uma letra.
 */
export const TETO_DO_GRUPO: Record<Exclude<ChaveDoGrupo, 'tarefas'>, number> = {
  telas: 6,
  clientes: 5,
  listas: 8,
};

export type GrupoDoIrPara = { chave: ChaveDoGrupo; rotulo: string; itens: Destino[] };

/** O destino de "Procurar tarefas com …": `Todas as tarefas`, já filtrada. */
export function procurarTarefas(consulta: string): Destino {
  // O mesmo teto que `Todas as tarefas` aplica ao ler o endereço: mandar mais
  // seria mandar texto que a tela vai cortar.
  const texto = consulta.trim().slice(0, TETO_DA_BUSCA);
  return {
    chave: 'tarefas',
    tipo: 'tarefas',
    rotulo: `Procurar tarefas com “${texto}”`,
    detalhe: 'Todas as tarefas',
    para: `/tarefas?${new URLSearchParams({ busca: texto }).toString()}`,
  };
}

/**
 * OS RESULTADOS, AGRUPADOS E EM ORDEM.
 *
 * SEM NADA DIGITADO, só as telas — a lista "óbvia" de quem abriu para ir a um
 *   lugar conhecido, na ordem da barra. Clientes e listas sem consulta seriam a
 *   árvore inteira repetida.
 *
 * COM CONSULTA, cada grupo leva os seus achados pela nota de `pontuar` (empate:
 *   a ordem de origem — a da barra, a alfabética dos clientes, a da árvore) e
 *   corta no teto. Os GRUPOS vêm na ordem do melhor achado de cada um — quem
 *   digita o nome exato de uma lista quer ela em primeiro, e não as telas que a
 *   têm no meio do nome —; empate, a ordem fixa Telas › Clientes › Listas.
 *
 * "Procurar tarefas" vem SEMPRE por último, e sempre que houver consulta e a
 *   pessoa alcançar `Todas as tarefas` (`procurarTarefasOk`): é a saída de quem
 *   não achou o lugar — e é o que sobra quando nada mais casa.
 */
export function resultadosDoIrPara(
  consulta: string,
  fontes: {
    telas: readonly Destino[];
    clientes: readonly Destino[];
    lugares: readonly Destino[];
    procurarTarefasOk: boolean;
  },
): GrupoDoIrPara[] {
  if (consulta.trim() === '') {
    return fontes.telas.length === 0
      ? []
      : [{ chave: 'telas', rotulo: ROTULO_DO_GRUPO.telas, itens: [...fontes.telas] }];
  }
  const candidatos: { chave: Exclude<ChaveDoGrupo, 'tarefas'>; itens: readonly Destino[] }[] = [
    { chave: 'telas', itens: fontes.telas },
    { chave: 'clientes', itens: fontes.clientes },
    { chave: 'listas', itens: fontes.lugares },
  ];
  const grupos = candidatos
    .map((g, ordem) => {
      const achados = g.itens
        .map((destino, i) => ({ destino, i, nota: pontuar(consulta, destino) }))
        .filter((a): a is { destino: Destino; i: number; nota: number } => a.nota !== null)
        .sort((a, b) => a.nota - b.nota || a.i - b.i);
      return {
        grupo: {
          chave: g.chave,
          rotulo: ROTULO_DO_GRUPO[g.chave],
          itens: achados.slice(0, TETO_DO_GRUPO[g.chave]).map((a) => a.destino),
        } as GrupoDoIrPara,
        melhor: achados[0]?.nota ?? Number.POSITIVE_INFINITY,
        ordem,
      };
    })
    .filter((g) => g.grupo.itens.length > 0)
    .sort((a, b) => a.melhor - b.melhor || a.ordem - b.ordem)
    .map((g) => g.grupo);
  if (fontes.procurarTarefasOk) {
    grupos.push({ chave: 'tarefas', rotulo: ROTULO_DO_GRUPO.tarefas, itens: [procurarTarefas(consulta)] });
  }
  return grupos;
}

/**
 * A opção ativa depois de `↑` (`-1`) ou `↓` (`+1`). Dá a volta nas pontas: do
 * último, `↓` vai ao primeiro — a lista é curta (tetos acima), e a volta poupa
 * a pessoa de subir tudo de novo.
 */
export function moverAtivo(atual: number, total: number, passo: 1 | -1): number {
  if (total <= 0) return 0;
  return (((atual + passo) % total) + total) % total;
}
