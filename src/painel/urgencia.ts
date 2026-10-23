/**
 * A urgência do cliente, como a tela a escreve — F30.
 *
 * O NOME NOVO, E A CHAVE QUE FICOU
 *   Até a F29 a tela dizia "Paz / Alerta / Perigo". O estudo de UX de 22/09
 *   (`docs/estudo-ux-layout-2026-09-22.md`) notou que o nome indica gravidade
 *   mas não o que ela significa, e sugeriu "Em dia / Atenção / Crítico". A F27
 *   deixou para decisão do Wesley — nome usado no sistema inteiro e no
 *   legado —, e ele aceitou em 25/09.
 *
 *   Só o RÓTULO mudou. As chaves `paz | alerta | perigo` são o dado: o enum
 *   `ideworks.urgency_level` no banco, o corpo de `PATCH` do Worker, o tipo
 *   `Urgencia` de `carteira.ts`. Renomear a chave seria migration, contrato de
 *   API e cliente velho aberto numa aba mandando valor que o servidor recusa —
 *   tudo isso para trocar uma palavra que só a tela lê.
 *
 * UM MAPA SÓ
 *   Painel e tela do cliente tinham cada um o seu `URGENCIA`, idênticos por
 *   cópia. A troca de nome é exatamente o tipo de mudança que acerta um e
 *   esquece o outro — e a mesma carteira passaria a falar duas línguas conforme
 *   a tela. Aqui mora o rótulo, o ícone, o tom do cartão e a cor.
 *
 *   `.ts`, e não `.tsx`: o arquivo não desenha nada, só aponta os ícones. Um
 *   `.tsx` que exporta constante perderia o recarregamento rápido do Vite
 *   (`react-refresh/only-export-components`) — o motivo de `board/conta.ts`.
 *
 *   Os ícones continuam `IconePaz`, `IconeAlerta` e `IconePerigo`: são o
 *   desenho (escudo, triângulo, círculo), e `IconeAlerta` também marca a
 *   renovação vencida no cartão, que não é urgência nenhuma.
 */

import { type Urgencia } from '@/painel/carteira';
import { IconeAlerta, IconePaz, IconePerigo } from '@/ui/Icones';

/**
 * A ordem das chaves é a ordem na tela: do calmo ao grave, que é como a métrica
 * do topo e a gaveta de filtro listam. A ORDENAÇÃO da carteira é outra (grave
 * primeiro) e mora em `carteira.ts`.
 */
export const URGENCIA = {
  paz: { rotulo: 'Em dia', Icone: IconePaz, tom: 'ok', cor: 'var(--ok)' },
  alerta: { rotulo: 'Atenção', Icone: IconeAlerta, tom: 'warn', cor: 'var(--warn)' },
  perigo: { rotulo: 'Crítico', Icone: IconePerigo, tom: 'err', cor: 'var(--err)' },
} as const satisfies Record<Urgencia, unknown>;

/** As três chaves, na ordem de `URGENCIA`. */
export const URGENCIAS = Object.keys(URGENCIA) as Urgencia[];
