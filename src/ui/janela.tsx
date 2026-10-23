/**
 * A REGRA DAS COISAS QUE ABREM POR CIMA — etapa F17.33.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   *"…ou as telas menores devem ter um X para sair delas e voltarem."*
 *
 * O QUE HAVIA, CONFERIDO PEÇA POR PEÇA ANTES DE ESCREVER
 *
 *   | peça                          | X                  | Esc       | fora  |
 *   |-------------------------------|--------------------|-----------|-------|
 *   | `ModalDeTarefa`               | sim                | sim       | sim   |
 *   | `Personalizar`                | sim                | **morto** | sim   |
 *   | `FichaDeCliente`              | sim (`✕` sem nome) | **não**   | sim   |
 *   | `Gaveta`                      | **não**            | sim       | sim   |
 *   | `Balao` com título (o `?`)    | **não**            | sim       | sim   |
 *   | as duas janelas de `Pessoas`  | **não**            | **não**   | **não** |
 *
 *   O `Esc` de `Personalizar` estava escrito e não funcionava: o ouvinte mora
 *   no `<div>` da janela, e nada dentro dela recebia foco ao abrir. Tecla
 *   apertada com o foco no `<body>` não passa por ali. Certo no código e morto
 *   na tela.
 *
 *   As duas janelas de `Pessoas` eram piores. `className="o-modal"` no
 *   elemento de fora e `o-modal-caixa` no de dentro — e **`o-modal-caixa` não
 *   existe em CSS nenhum do projeto**. `.o-modal` é o CARTÃO, e quem faz o
 *   fundo escuro é `.o-scrim`. Elas não abriam por cima de nada: caíam como um
 *   cartão no fim da página de `Pessoas`, e a única saída era o botão
 *   `Fechar`/`Cancelar` do rodapé.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONDE A LINHA FOI TRAÇADA, E POR QUÊ
 *   **Janela e painel** — o que tem cabeçalho próprio e tapa a tela — fecha
 *   pelos três: `X`, `Esc` e clique fora.
 *
 *   **Menu suspenso de escolha única** (`Menu`, os menus de chip da ficha) NÃO
 *   ganha `X`: ele fecha ao escolher, e o gatilho que o abriu está a três
 *   pixels dali fazendo o mesmo trabalho. Um `X` num menu de seis linhas seria
 *   uma sétima linha para dizer o que a primeira já resolve.
 *
 *   **A gaveta é a exceção que confirma a regra** — ela FICA ABERTA ao
 *   escolher, de propósito (marcar três etiquetas é um gesto só). Um menu que
 *   não fecha sozinho precisa de um jeito explícito de fechar, e por isso ela
 *   ganhou `X` nesta etapa.
 */

import { type ReactNode } from 'react';

import { prenderOTab, useDevolverFoco, useFocoDaJanela } from '@/ui/foco';

/** O `✕` do canto, com nome. Ver `BotaoDeFechar` para por que ele tem nome. */
const IconeFechar = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    className="h-4 w-4"
    aria-hidden="true"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/**
 * O `X` de sair.
 *
 * ⚠️ ELE TEM NOME, e isso não é detalhe de conformidade. A ficha de cliente
 * trazia o caractere `✕` solto dentro do botão: quem usa leitor de tela ouvia
 * "cruz de multiplicação", que não é o nome de nada que se possa fazer. O
 * desenho vai como `aria-hidden` e o nome vai no `aria-label`.
 */
export function BotaoDeFechar({ aoFechar }: { aoFechar: () => void }) {
  return (
    <button
      type="button"
      className="o-btn o-btn-fantasma o-btn-icone shrink-0"
      aria-label="Fechar"
      onClick={aoFechar}
    >
      <IconeFechar />
    </button>
  );
}

/**
 * Uma janela que abre por cima, com as três saídas.
 *
 * `o-scrim` é o fundo (`position: fixed`, `inset: 0`) e `o-modal` é o cartão —
 * os dois já existiam no OBSIDIAN, e a única novidade aqui é usá-los juntos,
 * que é como eles foram desenhados para funcionar.
 *
 * ⚠️ O CLIQUE FORA TESTA O ALVO. Sem o teste, arrastar para selecionar um texto
 * de dentro e soltar o botão fora fecharia a janela com o formulário
 * preenchido. É a mesma decisão que `FichaDeCliente` já tinha tomado.
 */
export function Janela({
  rotulo,
  largura = 'max-w-lg',
  aoFechar,
  devolverFoco = true,
  children,
}: {
  /** O nome da janela para quem usa leitor de tela. */
  rotulo: string;
  largura?: string;
  aoFechar: () => void;
  /**
   * Ao fechar, o foco volta ao botão que abriu a janela — F13. `true` usa o
   * foco do momento em que ela abre; um elemento diz qual botão, para a janela
   * que abre depois de um pedido (o botão estava travado e perdeu o foco).
   *
   * É `true` por padrão desde a revisão de acessibilidade. Era `false`, e as
   * quatro janelas que não o pediam (Marcar no dia, Sair sem salvar?, a imagem
   * ampliada e Status diferentes) deixavam o foco no `<body>` ao fechar — o
   * `Tab` seguinte recomeçava do alto da página. `false` continua valendo para
   * quem não quer devolver nada.
   */
  devolverFoco?: boolean | HTMLElement | null;
  children: ReactNode;
}) {
  const janela = useFocoDaJanela<HTMLDivElement>();
  useDevolverFoco(devolverFoco);

  return (
    <div
      className="o-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={janela}
        tabIndex={-1}
        className={`o-modal p-5 ${largura}`}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            // A janela é `aria-modal`, e o `Tab` precisa cumprir o que ela
            // declara: sem isto ele saía do último botão e caía na página de
            // trás, coberta pelo véu, onde não se vê o que está focado (WCAG
            // 2.4.3 e 2.4.11). Só as pontas — no meio anda o navegador.
            if (!e.defaultPrevented) prenderOTab(e, e.currentTarget);
            return;
          }
          if (e.key !== 'Escape') return;
          // `stopPropagation`: um menu aberto DENTRO desta janela já tratou a
          // tecla e a parou antes; se ela chegou aqui, não havia menu aberto —
          // e daqui ela também não sobe, para não fechar duas coisas de uma vez.
          e.preventDefault();
          e.stopPropagation();
          aoFechar();
        }}
      >
        {children}
      </div>
    </div>
  );
}
