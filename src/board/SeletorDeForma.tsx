/**
 * O seletor de forma das telas de trabalho.
 *
 * F05 do plano UX: `Lista | Quadro` das duas telas da pessoa.
 * F18C (R09): a peça ficou UMA — `SeletorDeModo` — em espaço, pasta, lista,
 * `Minhas tarefas`, `Todas as tarefas` e nas listas da ficha do cliente, e o
 * quadro passou a se chamar Kanban em todas.
 *
 * `Minhas tarefas` e `Todas as tarefas` montavam o mesmo `AlternadorDeVista`
 * cada uma com a sua lista de opções. Agora é uma peça só, com o ícone de cada
 * forma: no celular o rótulo recolhe e o par cabe AO LADO da busca, em vez de
 * gastar uma linha inteira da tela (meta da F05: primeira tarefa antes de 40%
 * da altura em 390 × 844).
 *
 * O NOME CONTINUA SENDO A PALAVRA. O rótulo sai só do desenho (`.iw-forma-rotulo`
 * vira `sr-only` < 480 px): o leitor de tela e o `getByRole('button', { name:
 * 'Lista' })` da suíte ouvem "Lista" em qualquer largura.
 */

import { Columns3, LayoutDashboard, List } from 'lucide-react';

import { type ContextoDoModo, MODOS_DO_CONTEXTO, type Modo, ROTULO_DO_MODO } from '@/board/lista-kanban';
import { AlternadorDeVista } from '@/ui/AlternadorDeVista';

/**
 * `Panorama | Lista | Kanban` — F18B (R09). A MESMA peça, generalizada: as
 * opções saem do contexto (`MODOS_DO_CONTEXTO`) — o espaço tem o panorama que
 * já existia; pasta, lista e as telas da pessoa têm só `Lista | Kanban`.
 *
 * Botões pressionáveis (`aria-pressed`) num grupo com nome, como o
 * `AlternadorDeVista` manda: Tab chega em cada um, Enter e Espaço acionam. O
 * rótulo recolhe no celular e o nome continua sendo a palavra.
 */
const ICONE_DO_MODO = { panorama: LayoutDashboard, lista: List, kanban: Columns3 } as const;

export function SeletorDeModo({
  contexto,
  valor,
  aoEscolher,
}: {
  contexto: ContextoDoModo;
  valor: Modo;
  aoEscolher: (modo: Modo) => void;
}) {
  return (
    <AlternadorDeVista
      rotulo="Forma de ver"
      className="iw-forma"
      valor={valor}
      aoEscolher={aoEscolher}
      opcoes={MODOS_DO_CONTEXTO[contexto].map((m) => {
        const Icone = ICONE_DO_MODO[m];
        return {
          valor: m,
          rotulo: (
            <>
              <Icone size={15} strokeWidth={1.9} aria-hidden="true" />
              <span className="iw-forma-rotulo">{ROTULO_DO_MODO[m]}</span>
            </>
          ),
        };
      })}
    />
  );
}
