/**
 * A ROLAGEM DE DENTRO DO QUADRO VOLTA PARA ONDE ESTAVA — F32 (Fase 2), a parte
 * pura. Quem fala com o DOM é `LembrarRolagemInterna`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O RELATO, 25/09/2026
 *
 *   *"quando você abre um card lá do final de uma lista e fecha, em vez de
 *   voltar na mesma posição, ele volta no início da lista… a tela anterior
 *   deveria ficar exatamente como estava antes dele abrir."*
 *
 * O QUE FOI MEDIDO, ANTES DE ESCREVER (Chrome, API simulada, 1440×900)
 *
 *   Coluna de 40 cartões rolada até o fim (`scrollTop` 2420 no quadro da lista,
 *   3030 na pasta, 3025 em `Todas as tarefas`, 3819 em `Minhas tarefas`) e a
 *   faixa de colunas rolada 150px de lado. Abrir o último cartão e fechar pelo
 *   X, pelo Voltar do navegador ou recarregar: coluna em **0** e faixa em **0**
 *   nas quatro telas, nos três caminhos.
 *
 *   E a visão de LISTA de `Minhas tarefas` e `Todas as tarefas` já voltava
 *   certa (1837 → 1837, 2751 → 2751): quem rola ali é o DOCUMENTO, e o
 *   documento é da `LembrarRolagem` desde a F17.24. Ela não foi mexida.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POR QUE A F17.24 NÃO COBRIA
 *   `LembrarRolagem` guarda `window.scrollY`. O quadro é `altura="tela"`
 *   (F17.27): a página não rola, quem rola é o corpo de cada coluna e a faixa
 *   de lado. Abrir o cartão é navegar para `/tarefa/:id`, o quadro desmonta, e
 *   ao voltar essas caixas nascem de novo — em zero.
 *
 * AS MESMAS TRAVAS DA F17.24, DE PROPÓSITO
 *   Mesma aba (`sessionStorage`), mesmo endereço, o gesto da pessoa cancela, e
 *   há prazo. Duas regras diferentes para "a rolagem volta" — uma para a página
 *   e outra para o quadro — ensinariam que às vezes volta e às vezes não.
 *
 *   ⚠️ E POR ISSO VALE PARA QUALQUER CHEGADA, NÃO SÓ PARA O "VOLTAR". Clicar na
 *   mesma lista pela barra lateral também devolve as colunas onde estavam. É a
 *   regra que a F17.24 já aplica ao documento (mesma aba, mesmo endereço →
 *   restaura), e o React Router não distingue "voltei" de "cheguei de novo"
 *   de um jeito que sobreviva ao F5 — que também precisa restaurar.
 *
 * QUEM É GUARDADO
 *   Só o que a tela MARCOU com `data-rolagem` (ver `ROLADOR`). Uma caixa sem
 *   nome estável não tem como ser achada de novo depois de o quadro ser
 *   redesenhado — e adivinhar por posição no documento devolveria a rolagem
 *   de uma coluna para outra quando a esteira mudasse.
 */

/* ───────────────────────────── os nomes ───────────────────────────── */

/** O atributo que marca uma caixa que rola por dentro. */
export const ATRIBUTO = 'data-rolagem';

/**
 * Os nomes que as telas dão às caixas. Por endereço, então só precisam ser
 * únicos DENTRO de uma tela: `coluna:<id do status>` no quadro da lista,
 * `coluna:<chave da etapa>` na pasta, `coluna:<tipo>` no quadro por tipo.
 */
export const ROLADOR = {
  faixa: 'faixa',
  coluna: (id: string) => `coluna:${id}`,
} as const;

/* ───────────────────────────── o prazo ───────────────────────────── */

/** Quantas tentativas. Os mesmos números da `LembrarRolagem` (F17.24). */
export const LIMITE = 40;

/** De quanto em quanto tempo. 40 × 60ms = 2,4s, que cobre a leitura do banco. */
export const PASSO = 60;

/**
 * Por quantas voltas o TAMANHO de uma caixa precisa ficar parado para se
 * aceitar "o mais perto que dá" — 5 × 60ms = 300ms.
 *
 * ⚠️ Sem isto, o caso mais comum do relato quebraria: a pessoa abre o último
 * cartão, conclui a tarefa ali dentro e volta. A coluna agora tem um cartão a
 * menos, o lugar guardado não existe mais, e esperar por ele deixaria a coluna
 * no TOPO — exatamente o defeito. Parada por 300ms, ela vai ao fim possível.
 * Se mais conteúdo chegar depois (o 2º lote de `Minhas tarefas`), a tentativa
 * seguinte ainda acerta o lugar exato, dentro do prazo.
 */
export const ESTAVEL = 5;

/* ───────────────────────────── a chave ───────────────────────────── */

export const PREFIXO = 'ideworks:rolagem-interna:';

/**
 * A chave de uma tela: o caminho e a busca, com os parâmetros em ordem.
 *
 * A busca entra porque ela é a VISÃO: `?ver=quadro`, `?aba=feito`, `?busca=…`
 * desenham colunas diferentes, e a rolagem de uma não serve à outra. A ordem é
 * normalizada porque `?aba=feito&ver=quadro` e `?ver=quadro&aba=feito` são o
 * mesmo lugar escrito de dois jeitos.
 */
export function chaveDaTela(caminho: string, busca: string): string {
  const limpo = caminho.replace(/\/+$/, '') || '/';
  const pares = [...new URLSearchParams(busca)].sort(([a, va], [b, vb]) =>
    a === b ? (va < vb ? -1 : va > vb ? 1 : 0) : a < b ? -1 : 1,
  );
  if (pares.length === 0) return limpo;
  return `${limpo}?${new URLSearchParams(pares).toString()}`;
}

/* ───────────────────────────── o armazenamento ───────────────────────────── */

export type Posicao = { x: number; y: number };
export type Rolagens = Readonly<Record<string, Posicao>>;

/** O pedaço de `Storage` que se usa. `null` = o navegador não deu acesso. */
export type Armazem = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Teto de caixas por tela. Uma pasta larga tem ~30 etapas; 200 é folga. */
export const TETO = 200;

const valido = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/**
 * O que está guardado para uma tela. TOLERANTE: o texto veio do navegador e
 * pode ser qualquer coisa — outra versão desta tela, uma extensão, um disco
 * cheio. Nada aqui estoura; o pior caso é `{}`, que é "começa do topo", o
 * comportamento de antes da F32.
 */
export function lerRolagens(armazem: Armazem | null, chave: string): Rolagens {
  if (armazem === null) return {};
  let texto: string | null;
  try {
    texto = armazem.getItem(PREFIXO + chave);
  } catch {
    return {};
  }
  if (texto === null) return {};
  let cru: unknown;
  try {
    cru = JSON.parse(texto);
  } catch {
    return {};
  }
  if (cru === null || typeof cru !== 'object' || Array.isArray(cru)) return {};
  const saida: Record<string, Posicao> = {};
  let n = 0;
  for (const [nome, v] of Object.entries(cru as Record<string, unknown>)) {
    if (n >= TETO) break;
    if (nome === '' || nome.length > 200 || v === null || typeof v !== 'object') continue;
    const { x, y } = v as { x?: unknown; y?: unknown };
    if (!valido(x) || !valido(y)) continue;
    const pos = { x: Math.round(x), y: Math.round(y) };
    if (pos.x === 0 && pos.y === 0) continue;
    saida[nome] = pos;
    n += 1;
  }
  return saida;
}

/**
 * Grava o retrato de uma tela. ESTRITO: só vai o que tem posição; caixa no
 * topo não é gravada (o topo já é o padrão), e tela sem nada fora do topo
 * APAGA a chave — senão uma coluna que a pessoa rolou de volta ao começo
 * voltaria, na próxima visita, para onde estava antes.
 */
export function gravarRolagens(armazem: Armazem | null, chave: string, rolagens: Rolagens): void {
  if (armazem === null) return;
  const limpo: Record<string, Posicao> = {};
  let n = 0;
  for (const [nome, p] of Object.entries(rolagens)) {
    if (n >= TETO) break;
    if (!valido(p.x) || !valido(p.y)) continue;
    const pos = { x: Math.round(p.x), y: Math.round(p.y) };
    if (pos.x === 0 && pos.y === 0) continue;
    limpo[nome] = pos;
    n += 1;
  }
  try {
    if (n === 0) armazem.removeItem(PREFIXO + chave);
    else armazem.setItem(PREFIXO + chave, JSON.stringify(limpo));
  } catch {
    // Navegação privada ou armazenamento cheio: sem memória de rolagem, que é
    // o comportamento de antes da F32.
  }
}

/** O retrato com uma caixa atualizada. Topo = sai do retrato. */
export function comPosicao(rolagens: Rolagens, nome: string, pos: Posicao): Rolagens {
  const x = Math.max(0, Math.round(pos.x));
  const y = Math.max(0, Math.round(pos.y));
  const resto: Record<string, Posicao> = { ...rolagens };
  delete resto[nome];
  return x === 0 && y === 0 ? resto : { ...resto, [nome]: { x, y } };
}

/* ───────────────────────────── a restauração ───────────────────────────── */

/** O que se lê de uma caixa para decidir. Um `HTMLElement` serve. */
export type Caixa = {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
};

/** A caixa já tem conteúdo para chegar ao lugar guardado, nos dois eixos? */
export function alcanca(caixa: Caixa, alvo: Posicao): boolean {
  return (
    caixa.scrollWidth - caixa.clientWidth >= alvo.x - 1 &&
    caixa.scrollHeight - caixa.clientHeight >= alvo.y - 1
  );
}

/**
 * O que fazer com uma caixa nesta volta do relógio.
 *
 *   `concluir` — o lugar existe: pôr lá e parar de tentar.
 *   `aparar`   — o lugar não existe, mas a caixa parou de crescer há
 *                `ESTAVEL` voltas: pôr no mais perto que dá, e continuar
 *                tentando até o prazo (ver `ESTAVEL`).
 *   `esperar`  — o conteúdo ainda está chegando. Não rolar: rolar agora seria
 *                o degrau que a F17.33 mediu no documento (0 → 68 → 833).
 */
export function passoDaRestauracao(
  caixa: Caixa,
  alvo: Posicao,
  voltasParada: number,
): 'concluir' | 'aparar' | 'esperar' {
  if (alcanca(caixa, alvo)) return 'concluir';
  return voltasParada >= ESTAVEL ? 'aparar' : 'esperar';
}

/** Teclas que rolam — o mesmo conjunto da `LembrarRolagem`. */
export const TECLAS_DE_ROLAGEM: readonly string[] = [
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ' ',
];
