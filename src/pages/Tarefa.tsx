/**
 * A PÁGINA DA TAREFA — `/tarefa/:id`. Etapa F17.10; a ficha saiu daqui na F43,
 * Fase 6, e mora em `@/board/FichaDaTarefa`.
 *
 * O QUE FICOU AQUI, E POR QUÊ
 *   A moldura de página: `PaginaLarga`, a barra (`TelaComBarra`), o topo com a
 *   trilha e o X. É o que faz desta rota um endereço COLÁVEL (`rotas.tsx`: "o
 *   endereço de uma tarefa precisa poder ser colado num comentário") — quem
 *   chega por um link colado ganha o mapa inteiro. A ficha em si (o título, as
 *   propriedades, o briefing, os passos, os anexos e a conversa) é peça
 *   própria, porque a Fase 7 do plano F43 a abre também num painel ao lado do
 *   Quadro, com outro topo.
 *
 *   **O chip salva na hora; o texto salva no botão.** A regra é da ficha, e o
 *   porquê inteiro está no cabeçalho de `FichaDaTarefa` (F17.10b; F07 do plano
 *   UX: "preservar os dois contratos de salvar"). A F43 não a mudou.
 *
 * QUEM GUARDA A FORMA DESTA PÁGINA
 *   `test/toda-tela-diz-onde-esta.test.ts`: ela passa por `PaginaLarga`, o
 *   `Topo` traz título e trilha (`trilhaDaTarefa`), e é a ÚNICA tela que usa a
 *   peça `Voltar` — o X da ficha. `board/tela-da-tarefa.test.ts` desenha a
 *   rota e confere o topo aderente.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { FichaDaTarefa } from '@/board/FichaDaTarefa';
import { textoDasMencoes } from '@/board/mencoes';
import { TelaComBarra } from '@/board/TelaComBarra';
// A trilha do topo — F17.25. A MESMA peça das outras três telas do Pilar B.
import { Trilha } from '@/board/TrilhaDoLugar';
import { destinoAcima, trilhaDaTarefa } from '@/board/trilha';
import { PaginaLarga } from '@/ui/primitivos';
import { marcarFichaEmPagina } from '@/ui/rolador-da-ficha';
import { Topo } from '@/ui/Topo';
import { Voltar } from '@/ui/Voltar';
import '@/ui/tarefa.css';

export default function Tarefa() {
  const { tarefaId } = useParams<{ tarefaId?: string }>();
  /** O meio da trilha, quando ela encurta — F17.25. Mora aqui para sobreviver
   *  a um redesenho da ficha. */
  const [trilhaAberta, setTrilhaAberta] = useState(false);

  // O `html` reserva espaço no alto enquanto a ficha em página cheia está na
  // tela (`tarefa.css`) — por atributo, e não por `:has()`. Ver a peça.
  useEffect(() => marcarFichaEmPagina(), []);

  return (
    <PaginaLarga>
      {/* ⚠️ A BARRA CHEGA À FICHA DA TAREFA — F17.67, E A DECISÃO FOI DISCUTIDA.

          CONTRA: no quadro, a ficha já abre como sobreposição (`ModalDeTarefa`)
          COM a barra atrás; e há a leitura de que a ficha "ocupa a tela".

          A FAVOR, e é o que decide: esta ROTA existe para ser COLADA. Está
          escrito na tabela de rotas (`src/App.tsx`) — *"o endereço de uma tarefa
          precisa poder ser colado num comentário, que é como a equipe já
          trabalha hoje no ClickUp"*. Quem chega por um link colado é justamente
          quem tem MENOS contexto de todo o sistema: não veio de um quadro, não
          escolheu uma lista, não passou pela árvore. Era a única tela onde a
          pessoa podia aterrissar sem nenhum mapa — e o `Voltar` sozinho leva
          um degrau acima, não mostra onde ela está.

          Sem `atual`: a ficha não é nenhum dos sete itens da barra. Quem quiser
          a ficha sem moldura tem a sobreposição do quadro, que continua igual.

          MEDIDO antes de fechar: a coluna de conteúdo em 1.366px e a ficha sem
          nada cortado — ver `scripts/provar-a-barra-nas-dez.mjs`. */}
      <TelaComBarra>
        <FichaDaTarefa
          tarefaId={tarefaId}
          cabecalho={(tarefa) => {
        /*
          O LUGAR ACIMA DESTA TELA — F17.33, e desde a F29 é o destino do X.

          Esta é a tela do pedido: *"quem abre a ficha de uma tarefa por um link não
          tem para onde voltar"*. Com histórico, o X volta ao passo anterior; sem
          ele — o link colado no WhatsApp —, volta ao QUADRO DA LISTA desta tarefa, e
          quem sabe qual é é a trilha da F17.25.

          ⚠️ F29 (Fase 4): o `‹ Voltar` da moldura saiu desta tela — o Wesley achou
          que ele confundia "anterior" com "acima". A ficha fica só com o X (FECHAR a
          ficha, que se entende sem nome) e com os degraus da trilha, que dizem para
          onde levam. O X usa este `acima`; a moldura não recebe mais nenhum.

          ⚠️ `/quadro` ENQUANTO A TAREFA NÃO CHEGOU, e não `null`. Um botão que só
          aparece depois da resposta do banco é um botão que empurra o título para
          baixo meio segundo depois de a tela desenhar — o salto que esta mesma etapa
          veio tirar. `/quadro` sempre existe e abre a última lista aberta.
        */
            const acima = tarefa ? (destinoAcima(trilhaDaTarefa(tarefa)) ?? '/quadro') : '/quadro';
            return (
              <>
              {/*
                A TRILHA — F17.25. Fora da ficha, no topo da coluna de conteúdo: é o
                MESMO lugar das outras três telas do Pilar B.

                ⚠️ ELA NÃO É A LINHA DE CONTROLE DE BAIXO, e essa separação é o conserto.
                `.cu-trilha` começava repetindo `empresa · espaço / pasta` em texto morto
                e só então trazia os dois seletores. Duas coisas diferentes na mesma
                linha: onde a tarefa ESTÁ, e para onde ela PODE IR.

                Aqui em cima ficou o "onde está" — clicável, com ícone por nível, e
                terminando no título da tarefa. Lá embaixo ficou só o que MUDA a tarefa.

                Espaço e pasta levam às telas deles (`/quadro/espaco/:id`,
                `/quadro/pasta/:id`), e o nó chega aberto na árvore — ver
                `trilhaDaTarefa` (28/09).

                O X À DIREITA DA TRILHA — F17.78. Canto superior direito do cartão,
                onde o ClickUp o põe. Ele é a peça `Voltar` — desde a F29 (Fase 5a)
                ela só desenha o X —, e o destino continua sendo decidido por
                `comoVoltar`. Até a F29 o
                `‹ Voltar` da moldura convivia com ele, acima da dobra; desde a Fase 4
                ele é a única saída desenhada da ficha além da trilha (ver o
                cabeçalho de `@/ui/Voltar`).

                O TOPO — F29: trilha + título + o X, a peça única das telas do
                trabalho (`@/ui/Topo`). Ele vem ANTES dos avisos, e não depois como a
                trilha vinha: a primeira coisa da coluna é sempre o lugar, e uma faixa
                de erro que o empurrasse para baixo faria o título pular. Enquanto a
                tarefa não chegou, a linha da trilha fica reservada (`null`).

                ⚠️ E A LINHA INTEIRA ACOMPANHA A ROLAGEM — F17.AUD07 (achado 9).
                "À vista" só valia até o primeiro rolar: com um briefing longo o X
                saía da janela (y=-93px na reprodução da auditoria). `.t-cabeca`
                (`ui/tarefa.css`) gruda o topo inteiro — trilha, título e X — no alto
                da janela (quem rola é o documento, ver lá), abaixo de todo menu,
                janela e gaveta. O X
                continua sendo o mesmo `Voltar`: a proteção de saída da F17.AUD03
                intercepta a navegação, não o botão, então nada muda aqui para ela.
              */}
                <Topo
                  className="t-cabeca"
                  variante="compacta"
                  titulo="Tarefa"
                  /* O `<h1>` é "Tarefa" para todas; a aba diz QUAL — WCAG 2.4.2. */
                  tituloDaAba={tarefa ? `${textoDasMencoes(tarefa.title)} · Tarefa` : undefined}
                  trilha={
                    tarefa ? (
                      <Trilha
                        degraus={trilhaDaTarefa(tarefa)}
                        expandida={trilhaAberta}
                        aoExpandir={() => setTrilhaAberta(true)}
                      />
                    ) : null
                  }
                  acoes={<Voltar acima={acima} />}
                />
              </>
            );
          }}
        />
      </TelaComBarra>

      {/* ⚠️ AQUI HAVIA UM RODAPÉ DE CINCO LINHAS, E ELE SAIU NA F17.20.
          Ele listava o número das etapas que ainda não existem (`F17.5`,
          `F17.15`, `F17.6`) numa tela que designer e videomaker abrem para
          escrever briefing. Número de etapa do plano é vocabulário desta
          sessão, não de quem usa — e "prometer campo que não há é pior que não
          ter o campo" se resolve NÃO desenhando o campo, que é o que a tela já
          faz. O que ficou fora de vista continua registrado no plano. */}
    </PaginaLarga>
  );
}
