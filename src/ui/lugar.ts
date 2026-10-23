/**
 * ONDE A PESSOA ESTAVA — etapa F17.24.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTE ARQUIVO FECHA
 *
 *   Palavras do usuário: *"resetar com F5, Ctrl+Shift+R não deveria fazer com
 *   que rebobinasse toda a página ao começo."*
 *
 *   Foi medido no Chrome, item por item, antes de escrever uma linha:
 *
 *     · `/quadro/:id`            → SOBREVIVE. A lista já está no endereço.
 *     · `/quadro` sem id         → PERDE. Abria sempre a PRIMEIRA lista.
 *     · pasta/espaço recolhido   → PERDE. Tudo volta aberto.
 *     · grupo recolhido          → PERDE. Tudo volta aberto.
 *     · `Subtarefas` no quadro   → PERDE.
 *     · `Ver arquivados`         → PERDE.
 *     · aba de `Minhas tarefas`  → PERDE (mora no endereço agora, ver abaixo).
 *     · `Lista`×`Quadro`         → PERDE (idem).
 *     · rolagem                  → PERDE (600 → 0).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A REGRA QUE SEPARA O QUE VAI PARA O ENDEREÇO DO QUE VEM PARA CÁ
 *
 *   **Se outra pessoa, abrindo o mesmo endereço, deve ver a mesma coisa, é
 *   URL. Se é arrumação pessoal, é navegador.**
 *
 *   Por isso a ABA de `Minhas tarefas` e a FORMA de `Todas as tarefas` **não
 *   estão neste arquivo**: elas são "qual visão", e um endereço colado num
 *   comentário precisa abrir na mesma visão para quem o recebe. Elas moram em
 *   `@/ui/endereco`.
 *
 *   O que está aqui é o que NÃO faz sentido colar para outra pessoa:
 *
 *     `lista`      — a última lista aberta. Ela é a resposta de `/quadro` SEM
 *                    id, e por definição não cabe num endereço: se coubesse,
 *                    o endereço seria `/quadro/:id`, que já existe e continua
 *                    intocado.
 *     `arvore`     — quais espaços e pastas eu deixo recolhidos.
 *     `grupos`     — quais grupos de `Hoje`/`Em atraso` eu deixo recolhidos.
 *     `subtarefas` — o interruptor da barra de controle do quadro.
 *     `arquivados` — ver ou não o que foi arquivado, na árvore.
 *     `vazias`     — recolher as etapas vazias do quadro (F06C).
 *     `modos`      — Panorama/Lista/Kanban escolhido em cada tela (F18B). O
 *                    endereço (`?ver=`) continua mandando quando existe; isto
 *                    é o que a pessoa encontra ao voltar sem ele.
 *
 * POR QUE UMA CHAVE PRÓPRIA, E NÃO UM CAMPO EM `ideworks:barra`
 *   `ideworks:barra` é o que o painel `Personalizar` escreve: escolha
 *   deliberada, feita uma vez. Isto aqui é escrito por GESTO — dezenas de
 *   vezes por sessão, ao recolher uma pasta ou trocar de lista. Misturar as
 *   duas faria cada clique numa seta reescrever as preferências inteiras, e
 *   uma corrida com o painel aberto apagaria a personalização de alguém.
 *
 * POR QUE NAVEGADOR E NÃO BANCO
 *   Vale o mesmo argumento já escrito em `@/ui/preferencias`: não é dado de
 *   domínio, e uma tabela com política de linha para guardar "a pasta MIMI está
 *   recolhida" custaria migration em produção com gente trabalhando e não
 *   protegeria nada. O que se perde, dito sem enfeite: a arrumação é DAQUELE
 *   navegador.
 *
 * TOLERANTE NA LEITURA, ESTRITO NA ESCRITA
 *   O mesmo contrato de `@/ui/preferencias`: o que está guardado veio do
 *   navegador e pode ser qualquer coisa. Valor estranho vira o padrão, campo
 *   que falta é preenchido, e nada aqui estoura.
 *
 * ⚠️ AS LISTAS TÊM TETO
 *   `arvore` e `grupos` guardam chave de nó recolhido. Sem teto, uma árvore
 *   grande e alguns meses de uso encheriam o armazenamento do navegador — que
 *   é pequeno e é COMPARTILHADO com a sessão e com o tema. O teto corta as
 *   mais antigas, e o pior que acontece é uma pasta voltar aberta.
 */

import { type Modo, modosValidos } from '@/board/lista-kanban';

/* ───────────────────────────── a forma guardada ───────────────────────────── */

export type Lugar = {
  /** A última lista aberta no quadro. Nulo = nunca abri nenhuma. */
  lista: string | null;
  /** As chaves (`space:…`, `folder:…`) que estão RECOLHIDAS na árvore. */
  arvore: string[];
  /** Os grupos (`hoje`, `atraso`, …) que estão RECOLHIDOS. */
  grupos: string[];
  /**
   * As últimas listas para onde alguém MANDOU uma tarefa — F17.63.
   *
   * Mais recente PRIMEIRO, e é essa ordem que a seção `Recentes` do seletor
   * desenha. Mora aqui pelo mesmo argumento de `lista`: é gesto, é pessoal, e
   * não faz sentido colar num endereço para outra pessoa ver.
   *
   * ⚠️ ID GUARDADO NÃO É PERMISSÃO. Quem decide se a lista aparece é a ÁRVORE,
   * que já vem recortada pela política de linha. Um id que sobrou aqui depois
   * de alguém perder o alcance simplesmente não é encontrado, e some da seção
   * sem ninguém precisar limpar nada.
   */
  recentes: string[];
  /** O interruptor `Subtarefas` da barra de controle do quadro. */
  subtarefas: boolean;
  /** Ver o que foi arquivado, na árvore. */
  arquivados: boolean;
  /**
   * RECOLHER AS ETAPAS VAZIAS DO QUADRO — F06C (revisão de 28/09, R04).
   *
   * Ligado por padrão: na lista observada, duas etapas vazias ocupavam 572 px
   * antes da primeira tarefa aberta. Recolhida, a etapa continua na ordem do
   * fluxo com nome, contagem e soltura de cartão — nada some, só encolhe. É
   * gesto pessoal, igual a `subtarefas`, e vale para todos os quadros deste
   * navegador.
   */
  vazias: boolean;
  /**
   * LISTA | KANBAN POR TELA — F18B (revisão de 28/09, R09).
   *
   * `espaco:<id>` guarda a escolha DAQUELA tela; `espaco` (sem id), a última
   * escolha no tipo de tela, que vale para a tela ainda não visitada. Trocar
   * o modo no espaço não mexe na pasta, na lista nem nas telas da pessoa.
   * Ver `resolverModo` em `@/board/lista-kanban`.
   */
  modos: Record<string, Modo>;
};

export const CHAVE = 'ideworks:lugar';

export const PADRAO: Lugar = {
  lista: null,
  arvore: [],
  grupos: [],
  recentes: [],
  subtarefas: false,
  arquivados: false,
  vazias: true,
  modos: {},
};

/**
 * Quantas chaves recolhidas cabem. Ver o cabeçalho.
 *
 * 200 é folgado para a árvore real (hoje há 4 espaços e 2 pastas) e continua
 * pequeno em bytes — cada chave é um `uuid` com prefixo, ~45 caracteres.
 */
export const TETO = 200;

/**
 * Quantos destinos recentes cabem — F17.63.
 *
 * Cinco, e não duzentos: `Recentes` é um atalho, e um atalho de vinte itens é
 * a mesma busca de novo, só que sem nome de espaço em cima. O ClickUp mostra
 * meia dúzia; a árvore inteira continua logo abaixo, para tudo o mais.
 */
export const TETO_RECENTES = 5;

const novo = (): Lugar => ({ ...PADRAO, arvore: [], grupos: [], recentes: [], modos: {} });

const booleano = (v: unknown, padrao: boolean): boolean =>
  typeof v === 'boolean' ? v : padrao;

/**
 * Uma lista de chaves, saneada: só texto, sem repetição, sem vazio, com teto.
 *
 * O corte é pelo FIM porque quem chega por último é quem a pessoa acabou de
 * recolher — e perder o gesto mais recente seria o mais visível dos dois
 * jeitos de cortar.
 */
export function chavesValidas(v: unknown, teto = TETO): string[] {
  const vindas = Array.isArray(v) ? v : [];
  const vistas = new Set<string>();
  for (const item of vindas) {
    if (typeof item !== 'string') continue;
    const chave = item.trim();
    if (chave === '') continue;
    vistas.add(chave);
  }
  const todas = [...vistas];
  return todas.length <= teto ? todas : todas.slice(todas.length - teto);
}

/**
 * Os destinos recentes, saneados — F17.63.
 *
 * ⚠️ NÃO É `chavesValidas`, E A DIFERENÇA É O LADO DO CORTE. Lá o mais recente
 * está no FIM e o corte tira do começo; aqui o mais recente está no COMEÇO,
 * porque é essa a ordem em que a seção `Recentes` desenha. Cortar pelo fim é o
 * mesmo princípio dito ao contrário: quem some é o mais antigo.
 */
export function recentesValidos(v: unknown, teto = TETO_RECENTES): string[] {
  const vindas = Array.isArray(v) ? v : [];
  const vistas: string[] = [];
  for (const item of vindas) {
    if (typeof item !== 'string') continue;
    const chave = item.trim();
    if (chave === '' || vistas.includes(chave)) continue;
    vistas.push(chave);
  }
  return vistas.slice(0, teto);
}

/**
 * Pôr um destino no topo dos recentes.
 *
 * Repetir um destino não cria linha nova: ele SOBE. Sem isto, mandar cinco
 * tarefas para a mesma lista encheria a seção inteira com o mesmo nome — que é
 * exatamente o uso que o usuário descreveu (*"mover algumas demandas para
 * outra lista"*), e o atalho morreria no primeiro dia de uso.
 */
export function lembrarRecente(
  recentes: readonly string[],
  id: string,
  teto = TETO_RECENTES,
): string[] {
  return recentesValidos([id, ...recentes], teto);
}

/** O que está guardado, ou o padrão. Recebe o TEXTO cru — quem fala com o
 *  armazenamento é quem chama, como em `@/ui/preferencias`. */
export function lerLugar(texto: string | null): Lugar {
  if (texto === null || texto.trim() === '') return novo();

  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    return novo();
  }

  const o = (cru ?? {}) as Record<string, unknown>;
  const lista = typeof o.lista === 'string' && o.lista.trim() !== '' ? o.lista : null;

  return {
    lista,
    arvore: chavesValidas(o.arvore),
    grupos: chavesValidas(o.grupos),
    recentes: recentesValidos(o.recentes),
    subtarefas: booleano(o.subtarefas, PADRAO.subtarefas),
    arquivados: booleano(o.arquivados, PADRAO.arquivados),
    vazias: booleano(o.vazias, PADRAO.vazias),
    modos: modosValidos(o.modos),
  };
}

export const escreverLugar = (l: Lugar): string => JSON.stringify(l);

/* ───────────────────────────── mexer ───────────────────────────── */

/**
 * Pôr ou tirar uma chave da lista de recolhidos.
 *
 * Devolve lista NOVA sempre — inclusive quando nada muda —, porque quem chama
 * é um `setState` e comparar identidade seria o segundo jeito de decidir se
 * houve mudança.
 */
export function alternar(chaves: readonly string[], chave: string, teto = TETO): string[] {
  const tem = chaves.includes(chave);
  const proximas = tem ? chaves.filter((c) => c !== chave) : [...chaves, chave];
  return chavesValidas(proximas, teto);
}

/**
 * Qual lista o `/quadro` SEM id deve abrir.
 *
 * A guardada, quando ela ainda existe e está viva; senão a primeira. É o único
 * lugar do sistema que decide isto, e a segunda metade é o que impede o quadro
 * de abrir vazio quando alguém arquiva a lista que eu tinha aberto.
 */
export function listaDeAbertura(
  guardada: string | null,
  vivas: readonly { id: string }[],
): string | null {
  if (vivas.length === 0) return null;
  if (guardada !== null && vivas.some((l) => l.id === guardada)) return guardada;
  return vivas[0].id;
}
