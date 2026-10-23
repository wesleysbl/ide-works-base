import type { Config } from 'tailwindcss';
// Import ESM em vez de require(): o lint proíbe require em TypeScript, e o
// projeto inteiro é ESM ("type": "module").
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * O Tailwind aqui fala OBSIDIAN — etapa F4.3.
 *
 * A paleta padrão do Tailwind (`emerald-400`, `neutral-900`) **não é usada**.
 * Cada cor abaixo aponta para uma variável do design system, de modo que
 * `bg-ink-1` e `var(--ink-1)` sejam sempre a mesma tinta.
 *
 * É o que torna a troca de espectro barata: mexe-se em `src/ui/obsidian.css`
 * e a interface inteira acompanha, incluindo o que foi escrito em utilitário.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        plat: { DEFAULT: 'var(--plat)', dim: 'var(--plat-dim)' },
        // A escada de texto tem TRÊS degraus — F17.37. O quarto (`faint`) foi
        // retirado: ele existia para ser o mais apagado, e num sistema onde o
        // texto apagado já é miúdo isso é só um jeito de sumir. Deixá-lo aqui
        // como apelido de `mute` seria dois nomes para uma tinta, que é o que a
        // decisão D10 existe para impedir.
        mute: 'var(--mute)',
        luz: { DEFAULT: 'var(--luz)', soft: 'var(--luz-soft)', ia: 'var(--luz-ia)' },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
      },
      // `text-luz` é letra: lê `--luz-texto`, que só difere da `--luz` no verde
      // padrão do tema claro (#00a344 dá 2,72 sobre `--ink-3`) — F01 do plano UX.
      // `bg-luz`/`border-luz` seguem a cor escolhida, intacta.
      textColor: {
        luz: { DEFAULT: 'var(--luz-texto)' },
      },
      borderColor: {
        hair: 'var(--hair)',
        'hair-2': 'var(--hair-2)',
        'hair-3': 'var(--hair-3)',
      },
      // `divideColor` NÃO herda o que se estende em `borderColor`: sem esta
      // repetição, `divide-hair` compila em silêncio e não gera regra nenhuma —
      // as linhas entre os itens de uma lista simplesmente somem, sem erro.
      divideColor: {
        hair: 'var(--hair)',
        'hair-2': 'var(--hair-2)',
      },
      // As duas famílias apontam para a MESMA variável que o CSS usa — F17.20.
      // Antes eram duas listas escritas à mão, e `font-mono` num utilitário do
      // Tailwind podia divergir de `var(--f-mono)` numa folha sem ninguém ver.
      // É a regra da D10 aplicada à letra: um lugar só decide.
      fontFamily: {
        sans: ['var(--f-body)'],
        mono: ['var(--f-mono)'],
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: {
        e1: 'var(--e-1)',
        e2: 'var(--e-2)',
        e3: 'var(--e-3)',
        luz: 'var(--glow-luz)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
