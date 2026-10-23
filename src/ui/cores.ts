/**
 * A cor do tema — etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO CABE EM UM ARQUIVO PEQUENO: A DECISÃO D10
 *
 *   A paleta do Tailwind foi trocada por ponteiros para tokens, e a cor da
 *   marca mora em UMA variável — `--luz`, em `src/ui/obsidian.css`. Trinta
 *   telas pedem `var(--luz)` e nenhuma sabe o que ele vale.
 *
 *   Então trocar o espectro do sistema inteiro é trocar o valor dessa variável.
 *   É o mesmo mecanismo que o tema claro (`:root[data-tema='claro']`) e o
 *   contexto do Instagram (`[data-contexto='instagram']`) já usam: troca-se o
 *   DICIONÁRIO, não as páginas.
 *
 *   Este arquivo é só a lista de chaves e rótulos. Os valores moram em
 *   `src/ui/cores-do-tema.css`, que é onde cor deve morar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O PADRÃO NÃO ESCREVE ATRIBUTO NENHUM
 *   `ide` é a ausência de escolha, e por isso ele NÃO carimba `data-cor` no
 *   `<html>`. Sem atributo, nenhuma regra de `cores-do-tema.css` casa e o sistema fica
 *   byte a byte como estava antes desta etapa — inclusive o degradê do botão
 *   sólido, que tem um verde literal no fim e por isso ganha um substituto
 *   apenas quando há cor escolhida.
 *
 * AS DEZ SÃO AS DA REFERÊNCIA DO USUÁRIO
 *   Preto · Roxo · Azul · Rosa · Violeta · Anil · Laranja · Azul-petróleo ·
 *   Bronze · Menta. `Preto` é monocromático: no escuro ele é a platina, no
 *   claro ele é a tinta — um preto literal sobre obsidiana seria um destaque
 *   invisível.
 *
 * CONTRASTE MEDIDO, NÃO ESCOLHIDO A OLHO
 *   `--luz` aparece como TEXTO (o nome da lista selecionada, a marca do item de
 *   menu) e como FUNDO (o botão sólido, o dia escolhido no calendário). As duas
 *   passam de 4.5 sobre a pior superfície de cada tema, e há teste que mede.
 */

export const CHAVES_DE_COR = [
  'ide',
  'preto',
  'roxo',
  'azul',
  'rosa',
  'violeta',
  'anil',
  'laranja',
  'petroleo',
  'bronze',
  'menta',
] as const;

export type ChaveDeCor = (typeof CHAVES_DE_COR)[number];

export const COR_PADRAO: ChaveDeCor = 'ide';

export const ROTULO_DA_COR: Record<ChaveDeCor, string> = {
  ide: 'Ide',
  preto: 'Preto',
  roxo: 'Roxo',
  azul: 'Azul',
  rosa: 'Rosa',
  violeta: 'Violeta',
  anil: 'Anil',
  laranja: 'Laranja',
  petroleo: 'Azul-petróleo',
  bronze: 'Bronze',
  menta: 'Menta',
};

/** Valor estranho vira o padrão, do mesmo jeito que a escolha de tema faz. */
export const corValida = (v: unknown): ChaveDeCor =>
  typeof v === 'string' && (CHAVES_DE_COR as readonly string[]).includes(v)
    ? (v as ChaveDeCor)
    : COR_PADRAO;

/**
 * O que carimbar no `<html>`. `null` significa "não carimbe nada".
 *
 * Ver o cabeçalho: sem atributo, o sistema é exatamente o de antes.
 */
export const atributoDaCor = (cor: ChaveDeCor): string | null =>
  cor === COR_PADRAO ? null : cor;

/**
 * A amostra que o botão do painel pinta.
 *
 * Ela aponta para a MESMA variável que a folha define (`--cor-roxo`), e não
 * para um hexadecimal copiado: cor copiada é a segunda verdade que diverge na
 * primeira vez que alguém acerta o tom em um só dos dois lugares. E como as
 * variáveis mudam de valor no tema claro, a amostra acompanha o tema sozinha.
 */
export const amostraDaCor = (cor: ChaveDeCor): string => `var(--cor-${cor})`;
