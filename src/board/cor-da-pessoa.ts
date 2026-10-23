/**
 * A cor do avatar sai do PRISMA do OBSIDIAN, escolhida pelo identificador.
 *
 * Não é cor de dado — o banco não guarda cor de pessoa —, então ela não pode ser
 * literal: são os cinco tons do prisma mais três semânticos, e o mesmo
 * identificador cai sempre no mesmo. Cor estável é o que faz o avatar ser
 * reconhecido de relance.
 *
 * AS INICIAIS SÃO LETRA, E LETRA PEDE 4,5:1 — acessibilidade, WCAG 1.4.3.
 * Os tons do prisma como FUNDO (`--luz-agencia`, `--luz-estudio`, `--luz-lives`)
 * dão 3,3, 4,4 e 4,2 com a inicial branca do tema claro. Os avatares usam a
 * variante `-texto` deles — o mesmo matiz, um passo mais fechado, que o claro já
 * tem para letra (F11B) e que no escuro é o próprio tom: no escuro nada muda.
 * `test/contraste-legivel.test.ts` mede a inicial sobre cada uma, nos dois temas.
 */
export const CORES_DE_PESSOA = [
  'var(--luz-agencia-texto)',
  'var(--luz-ia-texto)',
  'var(--luz-lives-texto)',
  'var(--luz-estudio-texto)',
  'var(--warn)',
  'var(--err)',
  'var(--luz-filmes)',
  'var(--mute)',
] as const;

export function corDaPessoa(id: string): string {
  let soma = 0;
  for (let i = 0; i < id.length; i += 1) soma = (soma * 31 + id.charCodeAt(i)) % 100003;
  return CORES_DE_PESSOA[soma % CORES_DE_PESSOA.length];
}
