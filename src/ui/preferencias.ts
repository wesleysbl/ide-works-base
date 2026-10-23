/**
 * O que a pessoa escolheu na barra lateral — etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONDE A PREFERÊNCIA MORA, E POR QUÊ: NO NAVEGADOR
 *
 *   Havia dois destinos possíveis — uma tabela nova no schema `ideworks`, ou o
 *   armazenamento do navegador. Escolhido o navegador, por três razões, e a
 *   terceira é a que decide sozinha.
 *
 *   1. JÁ HÁ UM DONO PARA ESTE ASSUNTO. A escolha de tema claro/escuro mora em
 *      `localStorage` desde a F10d, com o motivo escrito em `src/ui/tema.ts`.
 *      Pôr "a cor do tema" e "a ordem das seções" num banco deixaria o mesmo
 *      assunto — a aparência desta pessoa — com dois donos. É a dívida 8.1
 *      outra vez, agora do lado do cliente.
 *
 *   2. NÃO É DADO DE DOMÍNIO. Nada aqui muda o que existe, quem alcança o quê,
 *      nem o que a equipe vê. É a posição dos móveis. Uma tabela com política
 *      de linha para guardar "a seção Entrega vem antes" custaria uma migration
 *      em produção com gente trabalhando, e não protegeria nada.
 *
 *   3. ⚠️ A COR TEM QUE SER APLICADA ANTES DO PRIMEIRO QUADRO. Ela é um
 *      atributo no `<html>`, e ler o armazenamento do navegador é SÍNCRONO.
 *      Vinda do banco, ela chegaria depois de uma ida à rede — e toda página
 *      abriria verde e viraria roxa meio segundo depois, em toda carga. Um
 *      piscar de cor a cada F5 é pior do que perder a escolha ao trocar de
 *      máquina.
 *
 *   O QUE SE PERDE, DITO SEM ENFEITE: a escolha é DAQUELE navegador. Quem
 *   personalizar no computador da agência e abrir em casa, ou no celular, ou
 *   numa janela anônima, encontra o padrão de novo. Também se perde ao limpar
 *   os dados do site. Não há sincronização, e não há como saber, olhando o
 *   banco, como a barra de alguém está.
 *
 *   Se um dia isso incomodar, a saída é conhecida e não joga nada fora: uma
 *   tabela `user_preferences` guardaria este MESMO objeto como `jsonb`, o
 *   navegador viraria o cache de partida (que é o que resolve o piscar), e este
 *   arquivo continuaria sendo quem valida. Fica anotado como dívida, não como
 *   conserto pendente.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TOLERANTE NA LEITURA, ESTRITO NA ESCRITA
 *   O que está guardado veio do navegador e pode ser qualquer coisa — inclusive
 *   de uma versão futura deste arquivo. Então a leitura NUNCA estoura: valor
 *   estranho vira o padrão, campo que falta é preenchido, seção desconhecida é
 *   descartada e seção nova é ACRESCENTADA no fim.
 *
 *   Essa última é a que importa: sem ela, a próxima etapa que criar uma seção
 *   veria ela sumir para todo mundo que já tinha personalizado a barra — e o
 *   defeito apareceria como "a função nova não funciona para mim".
 */

import { type Area } from '@/auth/areas';
import { type Aba } from '@/board/meu-trabalho';
import { type ChaveDeCor, corValida } from '@/ui/cores';

/* ───────────────────────────── o vocabulário ───────────────────────────── */

/** Um item de navegação da barra. */
export const ITENS_DA_BARRA = [
  /* ⚠️ A CAIXA DE ENTRADA VEM PRIMEIRO — F17.46, e a ordem é o argumento dela.
     Ela é o único item que muda de conteúdo sem ninguém pedir: a automação
     passa a tarefa e o aviso nasce sozinho. Um item que se move sozinho posto
     abaixo de dois que não se movem é um item que ninguém olha — e esta etapa
     existe justamente porque a pessoa "descobre quando abrir". */
  'avisos',
  /* Chat da equipe — F20.5. Depois dos avisos; a chave IDEWORKS_CHAT ainda pode escondê-lo. */
  'chat',
  'minhas',
  'todas',
  'quadro',
  'painel',
  'calendario',
  'planejamento',
  /* O CONTROLE DA SEMANA — F40, Fase 7. Só para quem administra: o filtro é
     por PAPEL (`ITENS_SO_ADMIN`), e não por área — ver `itensVisiveis`. Desde
     a F43 (Fase 8) ele mora na seção própria, `Gestão`. */
  'controle',
] as const;
export type ItemDaBarra = (typeof ITENS_DA_BARRA)[number];

/**
 * Uma seção da barra. A ordem abaixo é a de fábrica.
 *
 * ⚠️ A ÁRVORE FOI PARA O FIM NA F28, E O MOTIVO É ALTURA.
 *   Até a F28 a fábrica era `trabalho, arvore, entrega`. A árvore é a única
 *   seção que cresce — com a carteira cheia ela pede mais do que a janela
 *   tem —, e posta no meio ela empurrava Painel, Calendário e Planejamento
 *   para debaixo da dobra: quem queria o calendário tinha de rolar o mapa
 *   inteiro antes. No fim, ela fica com a altura que SOBRA e rola dentro de
 *   si (F17.50), e as seções fixas ficam sempre à vista.
 *
 *   Quem tinha a ordem antiga de fábrica guardada é levado para esta — ver
 *   `ORDEM_DE_FABRICA_ATE_F28` e `lerPreferencias`.
 */
export const SECOES_DA_BARRA = ['trabalho', 'entrega', 'gestao', 'arvore'] as const;
export type SecaoDaBarra = (typeof SECOES_DA_BARRA)[number];

/**
 * DE ONDE VEIO CADA SEÇÃO NOVA — F43, Fase 8 ("Uma barra só").
 *
 * `Gestão` nasceu com um item só, o `Controle da semana`, que até ali morava no
 * fim de `Entrega`. Ela não é ordem nem visibilidade que alguém escolheu: é o
 * mesmo item mudando de prateleira. Então, para quem já tinha a barra guardada,
 * a seção nova nasce ONDE o item estava e COMO ele estava:
 *   · na ordem, logo depois da origem (e não no fim, que é a regra geral de
 *     `ordemValida`): no fim ela cairia embaixo da árvore — a única seção que
 *     cresce —, e o Controle sumiria para debaixo da dobra;
 *   · escondida ou recolhida se a origem estava — quem escondeu `Entrega` não
 *     via o Controle, e não pode passar a vê-lo sem ter pedido.
 * Seção sem origem aqui segue a regra geral: entra no fim, aberta e à vista.
 */
const ORIGEM_DA_SECAO: Partial<Record<SecaoDaBarra, SecaoDaBarra>> = { gestao: 'entrega' };

/**
 * A fábrica de antes da F28. Existe só para a migração da leitura: quem a tem
 * guardada nunca ESCOLHEU essa ordem — ela veio junto com qualquer outra
 * escolha (a aparência, a cor), porque o objeto inteiro é gravado de uma vez.
 */
const ORDEM_DE_FABRICA_ATE_F28: readonly SecaoDaBarra[] = ['trabalho', 'arvore', 'entrega'];

export const ROTULO_DA_SECAO: Record<SecaoDaBarra, string> = {
  trabalho: 'Meu trabalho',
  arvore: 'Compartilhado comigo',
  entrega: 'Entrega',
  /* F43 Fase 8: o que é de quem administra a agência, e só aparece para ela —
     a seção não tem item que um funcionário alcance (ver `secaoDeAdmin`). */
  gestao: 'Gestão',
};

/** A que seção cada item pertence. Um item só, uma seção só. */
export const SECAO_DO_ITEM: Record<ItemDaBarra, SecaoDaBarra> = {
  avisos: 'trabalho',
  chat: 'trabalho',
  minhas: 'trabalho',
  todas: 'trabalho',
  quadro: 'trabalho',
  painel: 'entrega',
  calendario: 'entrega',
  planejamento: 'entrega',
  controle: 'gestao',
};

export const ROTULO_DO_ITEM: Record<ItemDaBarra, string> = {
  /* O nome da referência, e ele deixou de ser proibido NESTA etapa: até a
     F17.45, `Caixa de entrada` estava na lista de seções que não existem, em
     `tela-do-trabalho.test.ts`. Aquele arquivo diz, por escrito, que o commit
     que tira a linha de lá é o commit que a entrega — e é este. */
  avisos: 'Notificações',
  chat: 'Chat',
  minhas: 'Minhas tarefas',
  todas: 'Todas as tarefas',
  quadro: 'Quadro',
  painel: 'Painel',
  calendario: 'Calendário',
  planejamento: 'Planejamento',
  controle: 'Controle da semana',
};

/**
 * OS ITENS QUE SÓ QUEM ADMINISTRA VÊ — F40, Fase 7.
 *
 * ⚠️ É FILTRO POR PAPEL, E NÃO POR ÁREA. Até aqui todo item dependia de uma
 *   área (`AREA_DO_ITEM`), e a área é uma caixinha que se marca por pessoa: um
 *   funcionário com a área `pessoas` marcada veria o item e levaria 403 do
 *   servidor, que só abre a leitura da semana para `admin` e `super_admin`.
 *   O papel é o que o servidor confere (`actor.isSuperadmin`), então é ele que
 *   esconde o item aqui.
 *
 * Enquanto a sessão carrega o item fica ESCONDIDO — o contrário da regra das
 * áreas: ele vem no fim da lista, não empurra nenhum outro botão ao aparecer, e
 * mostrá-lo e depois tirá-lo de um funcionário seria o menu mentindo.
 *
 * F43 Fase 8: o "fim da lista" agora é a seção `Gestão`, entre `Entrega` e a
 * árvore. Ao aparecer ela empurra só a árvore, que é a peça que já rola e já
 * chega depois (ela também espera a leitura); os itens fixos não andam.
 */
export const ITENS_SO_ADMIN: readonly ItemDaBarra[] = ['controle'];

/**
 * A que ÁREA cada item pertence — F17.36.
 *
 * Até a F17.36 os seis eram de `entrega` e este mapa não precisava existir. A
 * separação do quadro criou a combinação que não existia: alguém com `quadro`
 * e sem `entrega`, para quem os três itens de baixo respondem 403.
 *
 * Um item apontando para área que a pessoa não tem é botão morto com um passo
 * a mais. Meta, Pessoas e Catálogos ficam de fora da barra por esse motivo, e
 * não por esquecimento.
 */
export const AREA_DO_ITEM: Record<ItemDaBarra, Area> = {
  avisos: 'quadro',
  /* API livre (D26); itensVisiveis não consulta área para chat. */
  chat: 'quadro',
  minhas: 'quadro',
  todas: 'quadro',
  quadro: 'quadro',
  painel: 'entrega',
  calendario: 'entrega',
  planejamento: 'entrega',
  /* A mesma área da rota da API (`/admin/semana`, em `auth/areas.ts`). Quem
     decide de verdade é o papel: ver `ITENS_SO_ADMIN`. */
  controle: 'pessoas',
};

/**
 * A área de cada seção. `arvore` não tem item — o conteúdo dela é a árvore do
 * Pilar B inteira —, então ela precisa dizer a própria área.
 */
export const AREA_DA_SECAO: Record<SecaoDaBarra, Area> = {
  trabalho: 'quadro',
  arvore: 'quadro',
  entrega: 'entrega',
  /* A área do único item dela. Quem decide de verdade é o papel (ver
     `ITENS_SO_ADMIN`): sem item visível, a seção some em `secoesVisiveis`. */
  gestao: 'pessoas',
};

/** Para onde cada item vai. **Todas as rotas existem.** */
export const DESTINO_DO_ITEM: Record<ItemDaBarra, string> = {
  avisos: '/avisos',
  chat: '/chat',
  minhas: '/meu-trabalho',
  todas: '/tarefas',
  quadro: '/quadro',
  painel: '/painel',
  /* F43 Fase 4: o Calendário virou a terceira visão do Planejamento. O ITEM
     FICA — é o hábito da equipe, e quem o escondeu ou o mantém em
     `Personalizar` não perde a escolha (a chave `calendario` é a mesma) —,
     só o destino mudou: direto para a visão, sem passar pelo desvio de
     `/calendario`. A tela acende este item nessa visão
     (`itemDaBarraDaVisao`). */
  calendario: '/planejamento?visao=calendario',
  planejamento: '/planejamento',
  controle: '/controle-da-semana',
};

export type Aparencia = 'icones' | 'icones-e-rotulos';

export const ROTULO_DA_APARENCIA: Record<Aparencia, string> = {
  icones: 'Somente ícones',
  'icones-e-rotulos': 'Ícones e rótulos',
};

/** Onde o trabalho começa. Só as três telas do Pilar B — ver `Início` no painel. */
export const TELAS_INICIAIS = ['minhas', 'todas', 'quadro'] as const;
export type TelaInicial = (typeof TELAS_INICIAIS)[number];

/* ───────────────────────────── a forma guardada ───────────────────────────── */

export type Preferencias = {
  /** Item por item: aparece na barra? */
  itens: Record<ItemDaBarra, boolean>;
  /** Seção por seção: aparece na barra? */
  secoes: Record<SecaoDaBarra, boolean>;
  /** A ORDEM das seções. Contém todas, sempre — inclusive as escondidas. */
  ordem: SecaoDaBarra[];
  aparencia: Aparencia;
  /**
   * Seção por seção: está RECOLHIDA pelo título? — F29.
   *
   * ⚠️ NÃO É O MESMO QUE `secoes`. Esconder (em `Personalizar`) tira a seção
   *   da barra; recolher deixa o título à vista e guarda só os itens — é o
   *   gesto de um clique, desfeito por outro clique no mesmo lugar. Dois
   *   campos porque são duas perguntas: "quero esta seção?" e "quero ver os
   *   itens dela agora?".
   *
   * Em `Somente ícones` a barra IGNORA este campo e desenha todos os ícones:
   *   ali não há título onde clicar para reabrir, e um item que some sem
   *   caminho de volta visível é um item perdido. A escolha continua guardada
   *   e volta a valer quando a barra expande.
   */
  recolhidas: Record<SecaoDaBarra, boolean>;
  /**
   * A árvore mora numa COLUNA PRÓPRIA, ao lado da barra? — F29.
   *
   * O botão no título de `Compartilhado comigo` solta a árvore da barra para
   * uma segunda coluna com a altura inteira da janela, e o mesmo botão a
   * devolve. É para quem está ORGANIZANDO listas: a árvore espremida embaixo
   * das seções fixas mostra meia dúzia de linhas; na coluna, a janela toda.
   *
   * Vale só acima de 1024px — ver `arvoreNaColuna`. Na gaveta do celular a
   *   árvore fica sempre dentro.
   *
   * ⚠️ F02B (revisão de 28/09, R08): ESTE CAMPO É SÓ O ENCAIXE — onde a árvore
   *   mora (dentro da barra × coluna própria). Mostrar ou esconder a coluna é
   *   `listasRecolhidas`, e recolher o menu (`aparencia`) não mexe em nenhum
   *   dos dois. Até a F02B recolher o menu escondia a coluna junto.
   */
  arvoreEmColuna: boolean;
  /**
   * A coluna das listas está RECOLHIDA? — F02B (R08).
   *
   * Uma coluna de cada vez: o menu recolhe pelo `«` do alto da barra
   * (`aparencia`), as listas pelo `«` do título da coluna (este campo). As
   * quatro combinações valem. Só tem efeito com `arvoreEmColuna` ligado: dentro
   * da barra a árvore recolhe pelo título da seção (`recolhidas.arvore`).
   *
   * Recolhida, a barra mostra no lugar da árvore o botão que a reabre — o ícone
   * no rail, a linha "Compartilhado comigo" na barra expandida.
   */
  listasRecolhidas: boolean;
  telaInicial: TelaInicial;
  /** Qual aba de `Minhas tarefas` abre sozinha. */
  abaInicial: Aba;
  cor: ChaveDeCor;
};

export const CHAVE = 'ideworks:barra';

/**
 * O formato do que se grava — F28.
 *
 * ⚠️ SEM ESTE NÚMERO A MIGRAÇÃO DA ORDEM DESFARIA UMA ESCOLHA.
 *   O texto gravado antes da F28 não diz se a ordem `trabalho, arvore,
 *   entrega` foi escolhida ou só herdada da fábrica — e até ali ela era quase
 *   sempre herdada. Depois da F28 a pessoa pode ARRASTAR para essa mesma
 *   ordem de propósito; se a leitura migrasse toda ordem igual à antiga, a
 *   linha voltaria sozinha no instante seguinte (a barra relê o que gravou, ver
 *   `usePreferencias`), e ninguém conseguiria escolhê-la.
 *
 *   Então o texto novo sai com `versao: 2`, e a migração só vale para o texto
 *   SEM versão — o que foi gravado antes da F28. É o mesmo recurso do
 *   rascunho (`src/ui/rascunho.ts`): o conteúdo diz de qual formato ele é.
 *
 * ⚠️ A F29 ACRESCENTOU `recolhidas` E NÃO MUDOU O NÚMERO, de propósito. A
 *   versão existe para quando a AUSÊNCIA de um dado é ambígua — "herdou ou
 *   escolheu?". Aqui não é: texto sem `recolhidas` foi gravado antes de haver
 *   como recolher, então ninguém recolheu nada, e "tudo aberto" é a leitura
 *   certa para qualquer versão. Um número novo só teria de ser tratado igual
 *   ao `2` em toda leitura futura, sem decidir nada.
 *
 * ⚠️ E `arvoreEmColuna` TAMBÉM NÃO MUDOU — mesma conta. Texto sem o campo foi
 *   gravado antes de o botão existir: ninguém soltou a árvore, e "dentro da
 *   barra" é a leitura certa para qualquer versão.
 */
const VERSAO = 2;

export const PADRAO: Preferencias = {
  itens: {
    avisos: true,
    chat: true,
    minhas: true,
    todas: true,
    quadro: true,
    painel: true,
    calendario: true,
    planejamento: true,
    controle: true,
  },
  secoes: { trabalho: true, arvore: true, entrega: true, gestao: true },
  ordem: [...SECOES_DA_BARRA],
  aparencia: 'icones-e-rotulos',
  recolhidas: { trabalho: false, arvore: false, entrega: false, gestao: false },
  arvoreEmColuna: false,
  listasRecolhidas: false,
  telaInicial: 'minhas',
  abaInicial: 'pendente',
  cor: 'ide',
};

/* ───────────────────────────── leitura ───────────────────────────── */

const booleano = (v: unknown, padrao: boolean): boolean =>
  typeof v === 'boolean' ? v : padrao;

const umDe = <T extends string>(v: unknown, validos: readonly T[], padrao: T): T =>
  typeof v === 'string' && (validos as readonly string[]).includes(v) ? (v as T) : padrao;

/**
 * A ordem guardada, saneada.
 *
 * Três coisas acontecem aqui, e cada uma responde a um estrago possível:
 *   · repetida some — duas vezes a mesma seção desenharia a árvore duas vezes;
 *   · desconhecida some — seção que este código não sabe desenhar;
 *   · **faltante entra no fim** — é o que faz a seção NOVA de uma etapa futura
 *     aparecer para quem já personalizou a barra. Sem isto, ela nasceria
 *     invisível justamente para quem mais usa o sistema.
 *
 * ⚠️ F43 Fase 8: A FALTANTE QUE TEM ORIGEM ENTRA LOGO DEPOIS DELA, e não no
 *   fim — ver `ORIGEM_DA_SECAO`. Sem origem (ou com a origem ausente também), o
 *   fim continua valendo.
 */
export function ordemValida(v: unknown): SecaoDaBarra[] {
  const vindas = Array.isArray(v) ? v : [];
  const vistas = new Set<SecaoDaBarra>();
  const ordem: SecaoDaBarra[] = [];

  for (const item of vindas) {
    if (typeof item !== 'string') continue;
    if (!(SECOES_DA_BARRA as readonly string[]).includes(item)) continue;
    const chave = item as SecaoDaBarra;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    ordem.push(chave);
  }

  for (const chave of SECOES_DA_BARRA) {
    if (vistas.has(chave)) continue;
    const origem = ORIGEM_DA_SECAO[chave];
    const onde = origem === undefined ? -1 : ordem.indexOf(origem);
    if (onde < 0) ordem.push(chave);
    else ordem.splice(onde + 1, 0, chave);
  }
  return ordem;
}

/**
 * O que está guardado, ou o padrão.
 *
 * Recebe o TEXTO cru — quem fala com `localStorage` é quem chama. É o que deixa
 * esta função testável sem navegador, e é o mesmo desenho de `escolhaGuardada`
 * em `src/ui/tema.ts`.
 */
/** O padrão, em cópia — ninguém que mexa no objeto lido pode mexer no `PADRAO`. */
const copiaDoPadrao = (): Preferencias => ({
  ...PADRAO,
  itens: { ...PADRAO.itens },
  secoes: { ...PADRAO.secoes },
  recolhidas: { ...PADRAO.recolhidas },
  ordem: [...PADRAO.ordem],
});

export function lerPreferencias(texto: string | null): Preferencias {
  if (texto === null || texto.trim() === '') return copiaDoPadrao();

  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    // Texto que não é JSON é lixo de outra versão, ou de outro sistema no mesmo
    // domínio. Estourar aqui deixaria a barra sem desenhar nenhuma.
    return copiaDoPadrao();
  }

  const o = (cru ?? {}) as Record<string, unknown>;
  const itensCru = (o.itens ?? {}) as Record<string, unknown>;
  const secoesCru = (o.secoes ?? {}) as Record<string, unknown>;

  const itens = {} as Record<ItemDaBarra, boolean>;
  for (const i of ITENS_DA_BARRA) itens[i] = booleano(itensCru[i], PADRAO.itens[i]);

  /* F43 Fase 8: a seção nova que tem origem herda dela — ver `ORIGEM_DA_SECAO`.
     A origem é lida antes, porque ela vem antes em `SECOES_DA_BARRA`. */
  const herdado = (lido: Record<SecaoDaBarra, boolean>, s: SecaoDaBarra, padrao: boolean) => {
    const origem = ORIGEM_DA_SECAO[s];
    return origem === undefined ? padrao : lido[origem];
  };

  const secoes = {} as Record<SecaoDaBarra, boolean>;
  for (const s of SECOES_DA_BARRA) {
    secoes[s] = booleano(secoesCru[s], herdado(secoes, s, PADRAO.secoes[s]));
  }

  /* F29: texto sem o campo (tudo o que foi gravado antes dele) lê tudo aberto,
     e seção nova de uma etapa futura também nasce aberta — o mesmo cuidado de
     `ordemValida`: seção que a pessoa nunca viu não pode nascer escondida. */
  const recolhidasCru = (o.recolhidas ?? {}) as Record<string, unknown>;
  const recolhidas = {} as Record<SecaoDaBarra, boolean>;
  for (const s of SECOES_DA_BARRA) {
    recolhidas[s] = booleano(recolhidasCru[s], herdado(recolhidas, s, PADRAO.recolhidas[s]));
  }

  /* ⚠️ A MIGRAÇÃO DA F28 — só para o texto gravado ANTES dela (sem `versao`).
     A comparação é com a ordem já SANEADA: `['trabalho', 'arvore']`, gravada
     por uma versão velha sem a terceira seção, é a fábrica antiga completada, e
     migra junto. Qualquer outra ordem foi escolha da pessoa, e fica. */
  const saneada = ordemValida(o.ordem);
  /* F43 Fase 8: a fábrica antiga passa pelo MESMO saneamento antes da
     comparação — senão a seção que entrou depois dela (`gestao`) faria toda
     ordem antiga parecer escolhida, e a migração nunca mais valeria. */
  const fabricaAntiga = ordemValida(ORDEM_DE_FABRICA_ATE_F28);
  const eraDeFabrica =
    o.versao === undefined && saneada.every((s, i) => s === fabricaAntiga[i]);

  return {
    itens,
    secoes,
    ordem: eraDeFabrica ? [...SECOES_DA_BARRA] : saneada,
    aparencia: umDe(o.aparencia, ['icones', 'icones-e-rotulos'] as const, PADRAO.aparencia),
    recolhidas,
    /* F29: ausente ou estranho = dentro da barra, que é onde ela sempre esteve. */
    arvoreEmColuna: booleano(o.arvoreEmColuna, PADRAO.arvoreEmColuna),
    /* ⚠️ F02B: A MIGRAÇÃO PRESERVA O QUE ESTAVA NA TELA. Texto sem o campo foi
       gravado quando recolher o menu escondia a coluna junto: quem guardou
       `icones` + `arvoreEmColuna` via o rail SEM a coluna. Ler "listas
       abertas" faria a coluna saltar sozinha no primeiro recarregamento;
       então esse caso lê "recolhidas", e o `Mostrar listas` a devolve. Todo
       outro texto antigo lê aberto — o que já se via. Sem número de versão
       novo: a ausência não é ambígua, ela se resolve pelos outros dois campos. */
    listasRecolhidas: booleano(
      o.listasRecolhidas,
      o.arvoreEmColuna === true && o.aparencia === 'icones',
    ),
    telaInicial: umDe(o.telaInicial, TELAS_INICIAIS, PADRAO.telaInicial),
    abaInicial: umDe(o.abaInicial, ['pendente', 'feito', 'delegado'] as const, PADRAO.abaInicial),
    cor: corValida(o.cor),
  };
}

/** Grava com a versão do formato — ver `VERSAO`. Ela não entra em `Preferencias`: é do texto, não da escolha. */
export const escreverPreferencias = (p: Preferencias): string =>
  JSON.stringify({ ...p, versao: VERSAO });

/* ───────────────────────────── mexer ───────────────────────────── */

/**
 * Arrastar uma seção para outra posição.
 *
 * Recebe DE e PARA em índice, e não "sobe"/"desce": arrastar é o gesto da
 * referência, e um par de setas seria um segundo jeito de fazer a mesma coisa —
 * com a chance de os dois discordarem sobre o que é "subir" quando a lista tem
 * seção escondida no meio.
 *
 * Índice fora da lista devolve a lista como estava. Arrastar para fora da caixa
 * é gesto comum, e ele precisa não fazer nada em vez de embaralhar.
 */
export function reordenar(
  ordem: readonly SecaoDaBarra[],
  de: number,
  para: number,
): SecaoDaBarra[] {
  if (de === para) return [...ordem];
  if (de < 0 || de >= ordem.length) return [...ordem];
  if (para < 0 || para >= ordem.length) return [...ordem];
  const proxima = [...ordem];
  const [movida] = proxima.splice(de, 1);
  proxima.splice(para, 0, movida);
  return proxima;
}

/**
 * Recolher ou expandir a BARRA inteira — F29.
 *
 * Recolher é a aparência `Somente ícones`, que já existia dentro de
 * `Personalizar`: o botão do alto da barra só a põe a um clique. Uma função
 * só para os dois caminhos (botão e atalho de teclado), para os dois nunca
 * discordarem do que é "o outro estado".
 */
export const alternarAparencia = (p: Preferencias): Preferencias => ({
  ...p,
  aparencia: p.aparencia === 'icones' ? 'icones-e-rotulos' : 'icones',
});

/** Recolher ou expandir UMA seção pelo título — F29. As outras ficam como estão. */
export const alternarRecolhida = (p: Preferencias, secao: SecaoDaBarra): Preferencias => ({
  ...p,
  recolhidas: { ...p.recolhidas, [secao]: !p.recolhidas[secao] },
});

/** Soltar a árvore numa coluna, ou devolvê-la à barra — F29. O resto fica como está. */
export const alternarArvoreEmColuna = (p: Preferencias): Preferencias => ({
  ...p,
  arvoreEmColuna: !p.arvoreEmColuna,
});

/**
 * Recolher ou reabrir a COLUNA DAS LISTAS — F02B (R08). O menu (`aparencia`)
 * e o encaixe (`arvoreEmColuna`) ficam como estão: uma coluna de cada vez.
 */
export const alternarListas = (p: Preferencias): Preferencias => ({
  ...p,
  listasRecolhidas: !p.listasRecolhidas,
});

/**
 * Se a pessoa alcança uma área. O padrão diz sim a tudo.
 *
 * ESTE ARQUIVO NÃO CONHECE A SESSÃO, E É DE PROPÓSITO. Ele guarda a escolha de
 * quem usa; quem sabe o que a pessoa alcança é `podeVer` em `src/ui/sessao.ts`.
 * A barra passa a pergunta pronta, e as duas contas continuam separadas.
 */
export type Alcanca = (area: Area) => boolean;
const TUDO: Alcanca = () => true;

/**
 * Os itens de uma seção que devem aparecer.
 *
 * Seção escondida não devolve item nenhum, e é por isso que a checagem está
 * aqui e não na tela: se ficasse lá, esconder a seção e esconder cada item
 * dela seriam duas contas diferentes, e uma delas ficaria para trás.
 *
 * ⚠️ E A ÁREA ENTRA PELO MESMO MOTIVO — F17.36. Enquanto o quadro e a entrega
 * eram a mesma área, quem via a barra alcançava tudo o que ela oferece. Com
 * `quadro` separado, alguém pode ter o quadro e não ter a entrega — e os três
 * itens de Entrega virariam botão que responde 403.
 */
export function itensVisiveis(
  p: Preferencias,
  secao: SecaoDaBarra,
  alcanca: Alcanca = TUDO,
  ehAdmin = false,
): ItemDaBarra[] {
  if (!p.secoes[secao]) return [];
  return ITENS_DA_BARRA.filter((i) => {
    if (SECAO_DO_ITEM[i] !== secao || !p.itens[i]) return false;
    // F40 Fase 7: item de administração — por papel, e fechado por padrão.
    if (ITENS_SO_ADMIN.includes(i) && !ehAdmin) return false;
    if (i === 'chat') return true;
    return alcanca(AREA_DO_ITEM[i]);
  });
}

/**
 * A seção é SÓ de quem administra? — F43, Fase 8.
 *
 * Verdade quando todos os itens dela estão em `ITENS_SO_ADMIN` (hoje, só
 * `Gestão`). A barra não precisa perguntar — sem item visível a seção já some
 * em `secoesVisiveis` —, mas `Personalizar` desenha seção por seção, e mostrar
 * a um funcionário uma caixa "Gestão" vazia, ou uma linha dela para arrastar,
 * seria o painel prometendo o que a barra nunca vai mostrar. A árvore não tem
 * item e não é de administração.
 */
export function secaoDeAdmin(secao: SecaoDaBarra): boolean {
  const itens = ITENS_DA_BARRA.filter((i) => SECAO_DO_ITEM[i] === secao);
  return itens.length > 0 && itens.every((i) => ITENS_SO_ADMIN.includes(i));
}

/**
 * As seções que a barra desenha, na ordem escolhida.
 *
 * A seção `arvore` não tem item nenhum — o conteúdo dela é a árvore inteira —,
 * então ela entra pela visibilidade e não pela contagem de itens. Uma seção de
 * navegação sem item visível some: cabeçalho sozinho é ruído.
 */
export function secoesVisiveis(
  p: Preferencias,
  alcanca: Alcanca = TUDO,
  ehAdmin = false,
): SecaoDaBarra[] {
  return p.ordem.filter((s) => {
    if (!p.secoes[s]) return false;
    if (s === 'arvore') return alcanca(AREA_DA_SECAO.arvore);
    return itensVisiveis(p, s, alcanca, ehAdmin).length > 0;
  });
}

/**
 * A árvore está desenhada numa coluna própria? — F29.
 *
 * ⚠️ UMA CONTA SÓ, PARA A GRADE E PARA A BARRA CONCORDAREM.
 *   A coluna é desenhada pela `BarraLateral`, mas quem abre espaço para ela é a
 *   GRADE (`.q-tela[data-coluna]`, em `ui/clickup.css`), montada pela página.
 *   Se as duas decidissem cada uma à sua maneira, bastava discordarem uma vez
 *   — a seção escondida em `Personalizar`, alguém sem a área do quadro — para
 *   a grade reservar 16.5rem para uma coluna que não veio, e o conteúdo da
 *   página cair no lugar dela. Então as duas perguntam aqui.
 *
 * As três condições, e o porquê de cada uma:
 *   · a pessoa ligou o modo;
 *   · as listas não estão recolhidas — F02B (R08). A APARÊNCIA DO MENU NÃO
 *     ENTRA MAIS: até a F02B o rail escondia a coluna junto (decisão 5 do
 *     plano F29), e o Wesley pediu uma coluna de cada vez;
 *   · a seção da árvore aparece — escondida ou sem a área, não há árvore para
 *     pôr na coluna, e uma coluna vazia seria 16.5rem de nada.
 *
 * A largura (só acima de 1024px) não entra: ela é da folha, pela media query.
 * Abaixo dela a coluna e a grade de três não existem para o desenho.
 */
export function arvoreNaColuna(p: Preferencias, alcanca: Alcanca = TUDO): boolean {
  if (!p.arvoreEmColuna || p.listasRecolhidas) return false;
  return secoesVisiveis(p, alcanca).includes('arvore');
}

/* ─────────────────── a composição EFETIVA do shell — F02 do plano UX ─────────────────── */

/**
 * Em que tipo de tela a moldura está — F02.
 *
 * Cada contexto tem um mínimo de largura para o CONTEÚDO (o que sobra à
 * direita da barra e da árvore). O chat pede 720 px: lista (~240) + conversa
 * (~480), a regra do chat da especificação §3.2. Trabalho e administração
 * aceitam uma coluna de escrita de 560; entrega (painel, calendário) é larga
 * por natureza e pede 640.
 */
export const CONTEXTOS_DO_SHELL = ['trabalho', 'entrega', 'chat', 'administracao'] as const;
export type ContextoDoShell = (typeof CONTEXTOS_DO_SHELL)[number];

export const CONTEUDO_MINIMO: Record<ContextoDoShell, number> = {
  trabalho: 560,
  entrega: 640,
  chat: 720,
  administracao: 560,
};

/**
 * As larguras das faixas da grade, em rem — ESPELHO de `layout-foco.css`
 * (`.iw-app .q-tela`, acima de 1024 px): barra expandida 18rem, rail 3.5rem,
 * coluna da árvore 16.5rem. Se a folha mudar, muda aqui; a regressão
 * `chat-responsivo` (F02-1024-arvore) mede a largura real e pega a diferença.
 */
export const FAIXAS_EM_REM = { barra: 18, rail: 3.5, arvore: 16.5 } as const;

export type ComposicaoDoShell = {
  /** A aparência DESENHADA — pode ser o rail mesmo com a escolha expandida. */
  aparencia: Aparencia;
  /** A árvore está na coluna própria AGORA (escolha + espaço + contexto). */
  arvoreNaColuna: boolean;
  /** O espaço mudou o desenho em relação à escolha guardada? */
  adaptada: boolean;
  /** A largura que sobra para o conteúdo, em px (nula sem medida). */
  conteudo: number | null;
};

export type MedidaDoShell = {
  contexto: ContextoDoShell;
  /**
   * Largura da GRADE (`.q-tela`) em px, ou nula: sem medida ainda (primeiro
   * desenho, suíte sem navegador) ou abaixo de 1024 px, onde a barra é gaveta e
   * a grade não tem faixas laterais. Nula = a escolha vale como está.
   */
  largura: number | null;
  /** O vão entre as faixas, em px (o `column-gap` computado). */
  vao: number;
  /** Tamanho do rem em px. */
  rem?: number;
  /** A pessoa expandiu a barra NESTA tela, por cima da adaptação (não gravado). */
  expandidaNaMao?: boolean;
};

/**
 * A COMPOSIÇÃO EFETIVA — F02: a escolha da pessoa, adaptada ao espaço, SEM
 * reescrevê-la.
 *
 * ⚠️ O QUE ESTA FUNÇÃO NUNCA FAZ É GRAVAR. Ela devolve o que desenhar; a
 *   preferência guardada (`ideworks:barra`) continua a mesma, e ampliar a
 *   janela devolve o desenho escolhido sem ninguém ter escolhido de novo.
 *
 * A ORDEM DO RECUO, de quem cede primeiro:
 *   1. a coluna da árvore (volta para dentro da barra) — é a faixa opcional;
 *      no chat ela nunca abre (§3.1: a árvore fica recolhida por padrão
 *      visual nessa área);
 *   2. a barra expandida vira rail de ícones — no chat, sempre (F08): lá o
 *      contexto é a lista de Conversas, e não a árvore.
 *   O conteúdo é o último a encolher. Se a pessoa expandiu na mão por cima do
 *   rail, a barra fica expandida (a escolha momentânea dela ganha), e o próprio
 *   conteúdo se defende — o chat passa a uma área por vez.
 */
export function composicaoEfetiva(
  p: Preferencias,
  medida: MedidaDoShell,
  alcanca: Alcanca = TUDO,
): ComposicaoDoShell {
  const escolhida = arvoreNaColuna(p, alcanca);
  const noChat = medida.contexto === 'chat';
  if (medida.largura === null) {
    const coluna = escolhida && !noChat;
    return { aparencia: p.aparencia, arvoreNaColuna: coluna, adaptada: coluna !== escolhida, conteudo: null };
  }
  const rem = medida.rem ?? 16;
  const minimo = CONTEUDO_MINIMO[medida.contexto];
  const sobra = (aparencia: Aparencia, coluna: boolean) =>
    medida.largura! -
    (aparencia === 'icones' ? FAIXAS_EM_REM.rail : FAIXAS_EM_REM.barra) * rem -
    medida.vao -
    (coluna ? FAIXAS_EM_REM.arvore * rem + medida.vao : 0);

  let aparencia = p.aparencia;
  let coluna = escolhida && !noChat;
  if (coluna && sobra(aparencia, coluna) < minimo) coluna = false;
  /* F08: NO CHAT O CONTEXTO É A LISTA DE CONVERSAS. Com a barra na tela (a
     partir de 1024 px, quando há medida), ela fica em rail em qualquer largura:
     a barra expandida traria de novo a árvore e os atalhos do trabalho ao lado
     de "Conversas" — duas colunas de navegação antes da conversa (UX02). O
     `Expandir a barra` continua valendo, só nesta tela e sem gravar. */
  const railDoChat = noChat && !medida.expandidaNaMao;
  if (
    aparencia === 'icones-e-rotulos' &&
    (railDoChat || (!medida.expandidaNaMao && sobra(aparencia, coluna) < minimo))
  ) {
    aparencia = 'icones';
  }
  return {
    aparencia,
    arvoreNaColuna: coluna,
    adaptada: aparencia !== p.aparencia || coluna !== escolhida,
    conteudo: Math.round(sobra(aparencia, coluna)),
  };
}

/**
 * O contexto de uma tela pelo item aceso na barra — o padrão retrocompatível
 * de `TelaComBarra` quando a tela não diz o seu.
 */
export function contextoDoItem(item: ItemDaBarra | undefined): ContextoDoShell {
  if (item === 'chat') return 'chat';
  if (item === 'painel' || item === 'calendario' || item === 'planejamento' || item === 'controle')
    return 'entrega';
  return 'trabalho';
}
