import { TextoComMencoes } from '@/board/CamposDeMencao';
/**
 * Uma linha de `Minhas tarefas` — etapa F17.18.
 *
 * A LINHA DA REFERÊNCIA, LIDA DAS TELAS DO USUÁRIO
 *
 *     ● Gravar depoimento do cliente    Alma9 / FOCUS Ibitinga / Vídeos    Hoje
 *     └ ponto do status, na cor da esteira
 *
 *   Quatro coisas, e cada uma responde a uma pergunta diferente:
 *     · o ponto  — em que pé está (a cor vem do ClickUp, é dado);
 *     · o título — o que é, e é ele que abre a ficha;
 *     · a trilha — de ONDE é. Sem ela, `Minhas tarefas` vira uma lista de
 *                  títulos soltos: a mesma pessoa tem tarefa em quatro
 *                  clientes, e "Reels 3" não diz de quem;
 *     · o prazo   — para quando.
 *
 * O PONTO USA A COR DA ESTEIRA, E ELA ENTRA COMO VARIÁVEL
 *   `status.color` vem da origem e muda de lista para lista — decisão D10. Ela
 *   nunca vira classe. A mesma variável `--cor-status` que a coluna do quadro
 *   já usa, para os dois pintarem igual.
 *
 * O TOM DO PRAZO SAI DE `lerPrazo` (via `dueState`), E NÃO DO GRUPO
 *   O grupo diz QUANDO o prazo era; o tom diz se é alarme. Tarefa concluída
 *   nunca sai em vermelho — é a regra da F17.9a, e é o que impede a aba `Feito`
 *   de virar uma parede de alarme falso. Desde a F06B a palavra (`Atrasada`,
 *   `Hoje`, `Amanhã`) está no texto, e a cor só confirma.
 */

import { type Day } from '@/board/board';
import { type WorkRow } from '@/board/meu-trabalho';
import { Avatares, PrazoCurto, SeloUrgente } from '@/board/CartaoDeTarefa';
import { LinkDaTarefa } from '@/board/LinkDaTarefa';
// A MESMA trilha do topo das telas, na versão curta — F17.25. Ver o cabeçalho
// de `@/board/TrilhaDoLugar` para por que a curta não traz ícone.
import { Trilha } from '@/board/TrilhaDoLugar';
import { trilhaDaLinha } from '@/board/trilha';

export function LinhaDeTrabalho({ tarefa, hoje }: { tarefa: WorkRow; hoje: Day }) {
  const caminho = trilhaDaLinha({
    ...tarefa,
    // ⚠️ LISTA ARQUIVADA NÃO VIRA LINK. `/quadro/:id` de uma lista fora de
    // circulação manda quem clicou para OUTRA lista (é a regra da F17.24 de
    // abertura), e um degrau que leva a um lugar diferente do que diz é pior
    // que um degrau que não clica. O selo `· arquivada` logo abaixo continua
    // explicando por quê.
    listId: tarefa.listLive ? tarefa.listId : null,
  });

  return (
    <li className="mt-linha" data-concluida={tarefa.completedAt !== null}>
      <span
        className="mt-ponto"
        /* Cor de DADO, por variável. Ver o cabeçalho e a D10. */
        style={tarefa.statusColor ? { ['--cor-status' as string]: tarefa.statusColor } : undefined}
        title={tarefa.statusName ?? 'Sem status'}
        aria-hidden
      />

      <span className="mt-texto">
        <SeloUrgente prioridade={tarefa.priority} />
        {/* F43, Fase 7: abre a ficha ao lado, com a lista atrás. */}
        <LinkDaTarefa id={tarefa.id} className="mt-titulo">
          <TextoComMencoes texto={tarefa.title} />
        </LinkDaTarefa>

        <span className="mt-trilha">
          {caminho.length > 0 ? (
            <Trilha degraus={caminho} compacta />
          ) : (
            /* Tarefa sem lista existe: `createTask` do Pilar A′ insere sem ela,
               por desenho. Dizer "sem lista" é a verdade E é acionável — dá
               para abrir a ficha e mover. */
            <span>sem lista</span>
          )}

          {/* A lista pode ter sido arquivada com a tarefa ainda atribuída. Ela
              continua sendo minha; some-la esconderia trabalho. O que não pode
              é a pessoa clicar e não achar o quadro. */}
          {tarefa.listId !== null && !tarefa.listLive && (
            <span className="mt-arquivada" title="A lista (ou o espaço dela) está arquivada">
              {' '}
              · arquivada
            </span>
          )}
        </span>
      </span>

      {/* Os indicadores que o cartão já mostra, na forma curta da linha. */}
      {tarefa.assignees.length > 0 && (
        <span className="mt-avatares">
          <Avatares pessoas={tarefa.assignees} />
        </span>
      )}

      {/* O prazo com palavra — F06B. `Atrasada · 25/09` e não só `25/09/2026`
          em vermelho: o atraso não depende da cor, e a data inteira vai para
          o leitor de tela e para o `title`. A MESMA peça do cartão. */}
      <PrazoCurto tarefa={tarefa} hoje={hoje} className="mt-prazo" />
    </li>
  );
}
