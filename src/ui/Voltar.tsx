/**
 * O VOLTAR, desenhado — etapa F17.33. Desde a F29, SÓ O X DA FICHA DA TAREFA.
 *
 * ⚠️ F29: ELE SAIU DAS TELAS, E O PORQUÊ VEM PRIMEIRO
 *   O Wesley disse em 23/09 que o Voltar confundia: com histórico ele fazia
 *   "anterior", sem histórico fazia "acima", e `‹ Voltar` não dizia qual dos
 *   dois — ninguém sabia para onde ia antes de ir. A escolha dele foi a opção
 *   A: **a trilha substitui o Voltar**, porque cada degrau dela diz, pelo nome,
 *   o lugar a que leva (`Topo`, em `@/ui/Topo`).
 *
 *   Na Fase 4 do plano F29 as oito telas do quadro e do trabalho perderam o
 *   `‹ Voltar` da moldura; na Fase 5a, as outras — e as molduras (`Pagina`,
 *   `PaginaLarga`) deixaram de desenhá-lo. O modo `‹ Voltar` saiu deste
 *   arquivo com elas, e a prop `close` com ele: sobrou um desenho só.
 *
 * O QUE FICA É O X — F17.78: A MESMA DECISÃO, OUTRA ROUPA
 *   Ali a saída é o gesto de FECHAR a ficha, que a pessoa entende sem nome.
 *   Para onde ir continua sendo o que `comoVoltar` decide (`@/ui/volta`):
 *   o passo anterior, se ele é do sistema; senão o quadro da lista da tarefa;
 *   nunca para fora do sistema. Ele mora nas ações do `Topo` da ficha, à
 *   direita da trilha. Só `aria-label`, como o X do modal: sem `title`, sem
 *   texto ao lado.
 *
 *   O nome do arquivo e do componente ficou `Voltar` de propósito: as provas
 *   no navegador (`scripts/e2e/`, `provar-a-volta.mjs`) e a suíte o conhecem
 *   por este nome e pelo `aria-label`, e o que ele decide continua sendo
 *   "voltar" — só o desenho é um X.
 */

import { useLocation, useNavigate } from 'react-router-dom';

import { IconeFechar } from '@/ui/Icones';
import { comoVoltar } from '@/ui/volta';

/**
 * O estado da entrada de histórico atual.
 *
 * Lido no desenho, e não num efeito: assim o botão já nasce certo ou já nasce
 * ausente. Decidir isso depois do primeiro quadro seria pôr um botão na tela
 * meio segundo tarde — que é justamente o tipo de salto que esta etapa veio
 * tirar do sistema.
 */
const estadoDaEntrada = (): unknown => {
  if (typeof window === 'undefined') return null;
  try {
    return window.history.state;
  } catch {
    // Navegador que recuse o histórico: sem passo anterior conhecido, vale o
    // lugar acima — que é o comportamento de quem chegou por link direto.
    return null;
  }
};

export function Voltar({ acima }: { acima: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const volta = comoVoltar(pathname, estadoDaEntrada(), acima);
  if (volta === null) return null;

  return (
    <button
      type="button"
      className="o-btn o-btn-fantasma h-9 w-9 shrink-0 p-0"
      // O X não tem palavra ao lado, então o nome vai no `aria-label` — e só
      // nele.
      aria-label="Fechar tarefa e voltar"
      onClick={() => {
        // `-1` é o passo anterior de verdade; o outro modo é um endereço
        // conhecido. Ver `comoVoltar` para por que nunca é só `-1`.
        if (volta.modo === 'historico') navigate(-1);
        else navigate(volta.para);
      }}
    >
      <IconeFechar className="h-4 w-4" />
    </button>
  );
}
