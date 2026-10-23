import { TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * A TRILHA, desenhada — etapa F17.25.
 *
 * UMA PEÇA SÓ, NO MESMO LUGAR, EM TODAS AS TELAS DO PILAR B
 *   Quadro, ficha da tarefa, `Minhas tarefas` e `Todas as tarefas` desenham
 *   esta mesma peça, no primeiro lugar da coluna de conteúdo. Antes desta etapa
 *   havia três trilhas diferentes e duas telas sem nenhuma — ver a tabela
 *   medida no cabeçalho de `@/board/trilha`.
 *
 * O SEPARADOR É `›`, E ELE É UM SÓ
 *   Conviviam `·` (empresa → espaço) e `/` (o resto). O usuário mandou o
 *   explorador de arquivos, que usa `>`; o `›` é o mesmo sinal com o desenho
 *   tipográfico certo, e ele é `aria-hidden` — quem usa leitor de tela ouve a
 *   estrutura da lista, não uma sopa de setas.
 *
 * A VERSÃO CURTA NÃO TEM ÍCONE, E ISSO É DECISÃO
 *   `Todas as tarefas` traz até 500 linhas, e cada trilha tem até quatro
 *   degraus: com ícone seriam 2000 desenhos na mesma tela, repetidos até
 *   pararem de significar coisa alguma. Na versão curta ficam o separador, o
 *   truncamento e o clique na lista — que é o que serve ali.
 *
 * CLICAR NUM ESPAÇO OU NUMA PASTA LEVA À TELA DELE — E ABRE O NÓ (28/09)
 *   Espaço e pasta têm tela (`/quadro/espaco/:id`, `/quadro/pasta/:id`). O
 *   degrau é um link para ela, e o clique também tira a chave do nó da lista de
 *   recolhidos de `@/ui/lugar` — a mesma lista que a árvore lê —, para a barra
 *   acompanhar quando for aberta. Até 28/09 o botão `Mostrar … na barra
 *   lateral` vinha ANTES do link: com a árvore recolhida no trilho ou na gaveta
 *   (shell F02), o clique não mostrava nada. Agora o botão só aparece para
 *   degrau que é nó e não tem endereço.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  IconeListaMarcada,
  IconePasta,
  IconeTarefa,
  MarcaDoEspaco,
} from '@/board/icones-da-arvore';
import { type Degrau, encurtar } from '@/board/trilha';
import { useLugar } from '@/ui/aparencia';

function Sinal({ degrau }: { degrau: Degrau }): ReactNode {
  switch (degrau.tipo) {
    case 'espaco':
      return <MarcaDoEspaco nome={degrau.nome} cor={degrau.cor ?? null} />;
    case 'pasta':
      return <IconePasta c="tr-icone" />;
    case 'lista':
      return <IconeListaMarcada c="tr-icone" />;
    case 'tarefa':
      return <IconeTarefa c="tr-icone" />;
    default:
      // A raiz e a tela não ganham sinal: na referência do usuário
      // (`Compartilhado comigo / 📁 …`) o primeiro degrau também não tem.
      return null;
  }
}

export function Trilha({
  degraus,
  compacta = false,
  aoRevelar,
  expandida = false,
  aoExpandir,
}: {
  degraus: readonly Degrau[];
  /** A versão de linha de lista: sem ícone, sem raiz. Ver o cabeçalho. */
  compacta?: boolean;
  /**
   * Trazer um nó da árvore para a vista. Só quem DESENHA a árvore na mesma tela
   * passa isto, e só vale para degrau que é nó SEM endereço — com endereço, o
   * degrau é link e leva à tela do nó.
   */
  aoRevelar?: (chave: string) => void;
  /** Se o meio encurtado já foi aberto. Mora em quem chama, para sobreviver a
   *  um redesenho da tela. */
  expandida?: boolean;
  aoExpandir?: () => void;
}) {
  const [, definirLugar] = useLugar();

  /** Abrir o nó: tirar a chave da lista de RECOLHIDOS que a árvore lê. */
  const abrirNo = (chave: string) =>
    definirLugar((l) =>
      l.arvore.includes(chave) ? { ...l, arvore: l.arvore.filter((k) => k !== chave) } : l,
    );

  /**
   * ⚠️ ELA ENCURTA QUANDO NÃO CABE, E NÃO QUANDO TEM MUITOS DEGRAUS.
   *
   *   A primeira versão encurtava acima de cinco degraus. No Chrome, numa
   *   janela de 1440, a ficha ficou assim:
   *
   *     Compartilhado comigo  ›  …  ›  Setembro  ›  01/09
   *
   *   Sobrava metade da largura, e a empresa, o espaço e a pasta tinham sumido
   *   por nada — justamente a informação que a etapa veio pôr na tela.
   *
   *   Agora a decisão é MEDIDA: se a trilha inteira não couber na caixa, o meio
   *   vira `…`; se couber, ela fica inteira. Numa janela larga não encurta
   *   nunca; numa de 420 px, encurta sozinha.
   *
   *   A largura da trilha INTEIRA fica guardada em `cheia` — sem isso haveria
   *   oscilação: encurtar diminui a largura, a medição seguinte diria "agora
   *   cabe", e ela voltaria a crescer, para encurtar de novo, sem parar.
   */
  const caixa = useRef<HTMLElement>(null);
  const cheia = useRef(0);
  const [apertada, setApertada] = useState(false);

  const medir = useCallback(() => {
    const n = caixa.current;
    if (n === null) return;
    // Só dá para medir a trilha inteira quando ela ESTÁ inteira.
    if (!apertada) cheia.current = n.scrollWidth;
    setApertada(cheia.current > n.clientWidth + 1);
  }, [apertada]);

  /*
    ⚠️ A VERSÃO CURTA NÃO MEDE, E O MOTIVO É CONTAGEM.
    `Todas as tarefas` desenha até 500 linhas, cada uma com uma trilha. Um
    `ResizeObserver` por linha seriam 500 observadores vivos na mesma tela, e
    todos disparando juntos a cada redimensionamento da janela. Ela também não
    precisa: tem no máximo quatro degraus e aperta em vez de transbordar.
  */
  useEffect(() => {
    if (compacta) return;
    medir();
  }, [compacta, medir, degraus, expandida]);

  useEffect(() => {
    const n = caixa.current;
    if (compacta || n === null || typeof ResizeObserver === 'undefined') return;
    const olho = new ResizeObserver(() => medir());
    olho.observe(n);
    return () => olho.disconnect();
  }, [compacta, medir]);

  const pedacos =
    expandida || !apertada
      ? degraus.map((degrau, posicao) => ({ tipo: 'degrau' as const, degrau, posicao }))
      : encurtar(degraus, 0);

  if (degraus.length === 0) return null;

  /**
   * ⚠️ QUEM DECIDE SE O DEGRAU CLICA É O `destino`, NUNCA A POSIÇÃO.
   *
   * A primeira versão desligava o link no ÚLTIMO degrau — e isso quebrou a
   * versão curta: na linha de `Minhas tarefas` o último degrau é a LISTA, e ali
   * ela precisa clicar, porque quem olha aquela linha não está na lista.
   *
   * Os construtores de `@/board/trilha` já zeram o `destino` do degrau que é o
   * lugar onde se está — a lista no quadro, a tarefa na ficha. A posição só
   * decide o `aria-current`, e só na trilha inteira: na curta, nenhum degrau é
   * "a página atual".
   */
  const desenharDegrau = (degrau: Degrau, ultimo: boolean) => {
    const dentro = (
      <>
        {!compacta && <Sinal degrau={degrau} />}
        <span className="tr-nome"><TextoComMencoes texto={degrau.nome} /></span>
      </>
    );

    const atual = ultimo && !compacta ? 'page' : undefined;

    if (degrau.destino !== null) {
      return (
        <Link
          to={degrau.destino}
          className="tr-degrau"
          title={degrau.nome}
          aria-current={atual}
          onClick={() => {
            // Abre o galho para a barra acompanhar. `aoRevelar` NÃO é chamado
            // aqui, de propósito: ele expande a barra que a pessoa deixou em
            // `Somente ícones` (preferência gravada) e é estado da tela que
            // está saindo — a de destino monta com o pedido vazio.
            if (degrau.no !== null) abrirNo(degrau.no);
          }}
        >
          {dentro}
        </Link>
      );
    }

    // Nó da árvore SEM endereço (falta o id), e há árvore na tela: o degrau a
    // revela onde ela está. Com endereço, o link acima já levou — ver o
    // cabeçalho.
    if (degrau.no !== null && aoRevelar) {
      return (
        <button
          type="button"
          className="tr-degrau"
          title={`Mostrar ${degrau.nome} na barra lateral`}
          onClick={() => {
            abrirNo(degrau.no as string);
            aoRevelar(degrau.no as string);
          }}
        >
          {dentro}
        </button>
      );
    }

    return (
      <span className="tr-degrau" title={degrau.nome} aria-current={atual}>
        {dentro}
      </span>
    );
  };

  return (
    <nav
      ref={caixa}
      className="tr-trilha"
      data-compacta={compacta}
      /* F29 (Fase 5a): encurtada e ainda apertada, os degraus de antes encolhem
         e o último — onde se está — fica inteiro. Ver `interacao.css`. */
      data-apertada={apertada && !expandida && !compacta ? 'true' : undefined}
      aria-label="Trilha"
    >
      <ol>
        {pedacos.map((pedaco, i) => (
          <li
            key={pedaco.tipo === 'reticencias' ? 'meio' : `${pedaco.posicao}`}
            /* O `…` não encolhe quando a trilha aperta — F29 (Fase 5a). Ver
               `interacao.css`. */
            data-meio={pedaco.tipo === 'reticencias' ? 'true' : undefined}
          >
            {i > 0 && (
              <span className="tr-seta" aria-hidden="true">
                ›
              </span>
            )}
            {pedaco.tipo === 'reticencias' ? (
              <button
                type="button"
                className="tr-degrau tr-mais"
                title={`Mostrar os ${pedaco.escondidos} níveis do meio`}
                aria-label={`Mostrar os ${pedaco.escondidos} níveis do meio da trilha`}
                onClick={aoExpandir}
              >
                …
              </button>
            ) : (
              desenharDegrau(pedaco.degrau, pedaco.posicao === degraus.length - 1)
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
