/**
 * UM DEGRAU DA LINHA DO TEMPO QUE NÃO É FALA — etapa F17.65.
 *
 * ⚠️ ESTA PEÇA SUBSTITUIU `RegistroDaTarefa` (F17.41), E A TROCA TEM MOTIVO
 *   Aquela desenhava um BLOCO à parte, no pé da ficha, com o título "O que
 *   aconteceu sozinho" — e só sabia falar de automação. Duas coisas mudaram na
 *   F17.65:
 *
 *     1. `task_events` passou a guardar a mudança feita À MÃO. O sujeito da
 *        frase deixou de ser sempre uma regra e passou a ser, quase sempre, uma
 *        pessoa. Um bloco chamado "o que aconteceu sozinho" mentiria.
 *     2. *"E os comentários no meio, na mesma linha do tempo"*. Um bloco à
 *        parte não tem como intercalar: a fala e a mudança viraram degraus da
 *        MESMA lista, e quem os ordena é `montarHistorico`.
 *
 *   Então esta peça deixou de ser um bloco e virou UMA LINHA. Quem a coloca no
 *   lugar é `ConversaDaTarefa`, entre as falas.
 *
 * POR QUE ELA É UM ARQUIVO PRÓPRIO, E NÃO SEIS LINHAS DENTRO DA CONVERSA
 *   A ficha carrega a tarefa num efeito, e `renderToStaticMarkup` não roda
 *   efeito. Aqui a linha recebe tudo por propriedade, e o teste desenha
 *   exatamente o que a pessoa vai ler.
 *
 * ⚠️ O SELO `automação` NÃO É ENFEITE
 *   Quando a mudança veio de uma regra, o sujeito da frase é o NOME DELA —
 *   `Passa para o atendimento`. Sem o selo, quem lê acha que é o nome de uma
 *   pessoa que nunca viu, e a linha passa a confundir em vez de explicar. Com
 *   ele, a mesma frase se lê como o que é: o robô agiu.
 *
 * O SELO DE ORIGEM — F26.9
 *   Quando a linha foi escrita pela IA de alguém (`via`), o selo diz só
 *   *"via ChatGPT"*: o nome de quem pediu já é o sujeito da frase, logo ao
 *   lado. Na linha de uma REGRA que a IA disparou, os dois selos aparecem — a
 *   regra agiu, e agiu porque a IA empurrou a tarefa.
 */

import { formatarInstante } from '@/board/ficha';
import type { ItemDoHistorico } from '@/board/historico';
import { SeloDeOrigem } from '@/ui/SeloDeOrigem';

/**
 * A linha de uma mudança, ou a do nascimento da tarefa.
 *
 * ⚠️ COMENTÁRIO NÃO PASSA POR AQUI. Ele tem avatar, corpo em markdown, resposta
 * e botões, e quem o desenha continua sendo `Fala`, dentro de
 * `ConversaDaTarefa` — a linha do tempo mistura os dois, o desenho não.
 */
export function MovimentacaoDaTarefa({
  item,
}: {
  item: Extract<ItemDoHistorico, { tipo: 'criacao' | 'evento' }>;
}) {
  // Instante ilegível não vira travessão nem data inventada: a linha continua
  // dizendo o que aconteceu, e só o relógio some. É a mesma escolha de
  // `rodapeDaFicha`, que escreve "instante ilegível" em vez de esconder.
  const quando = formatarInstante(item.quando);
  const automatica = item.tipo === 'evento' && item.automatico;

  return (
    <div className="c-mudanca" data-automatica={automatica ? 'true' : 'false'}>
      <span className="c-mudanca-marca" aria-hidden="true" />

      <div className="c-mudanca-corpo">
        <div className="c-mudanca-cabeca">
          <span className="c-autor">{item.quem}</span>
          {automatica && <span className="c-mudanca-selo">automação</span>}
          <SeloDeOrigem via={item.via} pessoa={automatica ? null : item.quem} nomeAoLado />
          {quando !== null && <span className="c-quando tnum">{quando}</span>}
        </div>

        {item.tipo === 'criacao' ? (
          <p className="c-mudanca-frase">criou esta tarefa</p>
        ) : (
          item.frases.map((f) => (
            <p key={f} className="c-mudanca-frase">
              {f}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
