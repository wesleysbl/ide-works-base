/**
 * Reações da bolha do chat — F24.3.
 *
 * Só lógica pura: agrupar por emoji, alternar na hora (otimista) e aplicar o
 * que chega pelo evento ao vivo. A tela em `pages/Chat.tsx` desenha; aqui
 * ninguém sabe o que é React — é o que deixa isto testável (os testes desta
 * casa desenham no servidor e nenhum `useEffect` roda).
 *
 * Regra do banco espelhada aqui: UMA reação viva por pessoa por mensagem.
 * Tocar outro emoji troca; tocar o mesmo remove.
 */

import type { ChatReactionEmoji } from '@/server/chat';

/**
 * Os seis emojis, do lado do navegador.
 *
 * O valor mora em `CHAT_REACTION_EMOJIS` (src/server/chat.ts), mas aquele
 * módulo puxa o banco: importar o VALOR aqui arrastaria o servidor para dentro
 * do pacote do navegador. Então espelhamos como `chave.ts` já espelha o modo do
 * chat — com duas travas para a cópia não envelhecer calada: o tipo vem de lá
 * (`ChatReactionEmoji`), o mapa abaixo obriga os seis a estarem presentes, e o
 * teste `reacoes.test.ts` compara as duas listas item a item.
 */
export const EMOJIS_DE_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

/** Trava de compilação: falta um emoji ou sobra um, o tsc reclama aqui. */
const TODOS_OS_EMOJIS: Record<ChatReactionEmoji, true> = {
  '👍': true,
  '❤️': true,
  '😂': true,
  '😮': true,
  '😢': true,
  '🙏': true,
};
void TODOS_OS_EMOJIS;

export type ReacaoNaTela = {
  messageId: string;
  actorId: string;
  emoji: string;
  reactedAt: string;
};

/** Um emoji no rodapé da bolha: qual, quantos e se um deles sou eu. */
export type GrupoDeReacao = {
  emoji: string;
  contagem: number;
  minha: boolean;
};

/**
 * Grava (ou apaga) a reação de uma pessoa numa mensagem. `emoji: null` remove.
 * Serve tanto para a aposta otimista quanto para o evento ao vivo — as duas
 * fazem a mesma coisa com a lista.
 */
export function definirReacao(
  lista: readonly ReacaoNaTela[],
  entrada: { messageId: string; actorId: string; emoji: string | null; reactedAt: string },
): ReacaoNaTela[] {
  const sem = lista.filter(
    (r) => !(r.messageId === entrada.messageId && r.actorId === entrada.actorId),
  );
  if (!entrada.emoji) return sem;
  return [
    ...sem,
    {
      messageId: entrada.messageId,
      actorId: entrada.actorId,
      emoji: entrada.emoji,
      reactedAt: entrada.reactedAt,
    },
  ];
}

/** O emoji com que esta pessoa está reagindo à mensagem, se houver. */
export function minhaReacao(
  lista: readonly ReacaoNaTela[],
  messageId: string,
  euId: string | null,
): string | null {
  if (!euId) return null;
  const achada = lista.find((r) => r.messageId === messageId && r.actorId === euId);
  return achada ? achada.emoji : null;
}

/**
 * A alternância otimista: devolve a lista já com o palpite aplicado e diz se
 * o palpite foi remover — a tela usa isso só para não pensar duas vezes.
 */
export function alternarReacaoLocal(
  lista: readonly ReacaoNaTela[],
  entrada: { messageId: string; actorId: string; emoji: string; reactedAt: string },
): { lista: ReacaoNaTela[]; removida: boolean } {
  const atual = minhaReacao(lista, entrada.messageId, entrada.actorId);
  const removida = atual === entrada.emoji;
  return {
    lista: definirReacao(lista, { ...entrada, emoji: removida ? null : entrada.emoji }),
    removida,
  };
}

/**
 * As reações de uma mensagem viram grupos por emoji, na ordem em que o
 * primeiro de cada emoji apareceu — assim o rodapé não dança a cada clique.
 */
export function agruparReacoes(
  lista: readonly ReacaoNaTela[],
  messageId: string,
  euId: string | null,
): GrupoDeReacao[] {
  return agruparPorMensagem(lista, euId).get(messageId) ?? [];
}

/** Todas as mensagens de uma vez — a tela agrupa uma vez por quadro, não por bolha. */
export function agruparPorMensagem(
  lista: readonly ReacaoNaTela[],
  euId: string | null,
): Map<string, GrupoDeReacao[]> {
  const ordenada = [...lista].sort((a, b) =>
    a.reactedAt === b.reactedAt ? a.actorId.localeCompare(b.actorId) : a.reactedAt < b.reactedAt ? -1 : 1,
  );
  const mapa = new Map<string, GrupoDeReacao[]>();
  for (const r of ordenada) {
    const grupos = mapa.get(r.messageId) ?? [];
    const achado = grupos.find((g) => g.emoji === r.emoji);
    if (achado) {
      achado.contagem += 1;
      achado.minha = achado.minha || (euId != null && r.actorId === euId);
    } else {
      grupos.push({
        emoji: r.emoji,
        contagem: 1,
        minha: euId != null && r.actorId === euId,
      });
    }
    mapa.set(r.messageId, grupos);
  }
  return mapa;
}

/** Rótulo do botão de reação, dito por extenso para quem ouve a tela. */
export function rotuloDaReacao(grupo: GrupoDeReacao): string {
  const quantos = grupo.contagem === 1 ? '1 pessoa' : `${grupo.contagem} pessoas`;
  return grupo.minha
    ? `${grupo.emoji}, ${quantos}, incluindo você — tocar remove a sua`
    : `${grupo.emoji}, ${quantos} — tocar reage também`;
}

/**
 * Quanto o dedo pode andar sem cancelar o toque longo, em pixels de CSS.
 *
 * DEDO DE GENTE TREME. Cancelar ao menor movimento transforma o toque longo em
 * loteria no aparelho real — no CDP, com o ponteiro parado, o defeito nem
 * aparece. 10px é a tolerância que Android (`ViewConfiguration` toca em 8dp) e
 * as bibliotecas de toque longo usam: grande o bastante para o tremor, pequena
 * o bastante para que rolar o fio ainda cancele na primeira fração do gesto.
 */
export const TOLERANCIA_DO_TOQUE_PX = 10;

/** O dedo andou longe demais? Então virou rolagem, e o toque longo morre. */
export function saiuDoToqueLongo(
  origem: { x: number; y: number } | null,
  agora: { x: number; y: number },
  tolerancia: number = TOLERANCIA_DO_TOQUE_PX,
): boolean {
  if (!origem) return true;
  return Math.hypot(agora.x - origem.x, agora.y - origem.y) > tolerancia;
}

/** Só as reações das mensagens que estão na tela — o resto é lixo de memória. */
export function apenasDasMensagens(
  lista: readonly ReacaoNaTela[],
  messageIds: readonly string[],
): ReacaoNaTela[] {
  const vivos = new Set(messageIds);
  return lista.filter((r) => vivos.has(r.messageId));
}

/* ───────────────── reposição depois de ficar offline — F24.4 ───────────── */

/** Uma reação como a rota de mudanças devolve: pode ser a remoção. */
export type MudancaDeReacao = ReacaoNaTela & { removed: boolean };

/**
 * A identidade de uma reação: uma pessoa por mensagem. É a chave do conjunto
 * de palpites em voo — o que a fusão usa para não pisar no que ainda não
 * voltou da API.
 */
export function chaveDaReacao(messageId: string, actorId: string): string {
  return `${messageId}|${actorId}`;
}

/**
 * Funde no que está na tela o que o servidor diz ter mudado desde um instante.
 *
 * A regra que importa: **palpite em voo não é sobrescrito**. Se eu acabei de
 * tocar um emoji e a resposta da API ainda não chegou, a reposição pode trazer
 * o estado ANTERIOR ao meu toque (a leitura saiu antes da escrita entrar) e
 * faria o rodapé piscar de volta. Então toda mudança cuja chave está em
 * `emVoo` é ignorada aqui — quem manda naquela linha é a resposta do POST, que
 * chega logo depois. Mudança de outra pessoa entra normalmente.
 */
export function fundirMudancas(
  lista: readonly ReacaoNaTela[],
  mudancas: readonly MudancaDeReacao[],
  emVoo: ReadonlySet<string> = new Set<string>(),
): ReacaoNaTela[] {
  let proxima: ReacaoNaTela[] = [...lista];
  for (const m of mudancas) {
    if (emVoo.has(chaveDaReacao(m.messageId, m.actorId))) continue;
    proxima = definirReacao(proxima, {
      messageId: m.messageId,
      actorId: m.actorId,
      emoji: m.removed ? null : m.emoji,
      reactedAt: m.reactedAt,
    });
  }
  return proxima;
}

/**
 * O próximo instante de referência da reposição: o maior relógio que veio.
 *
 * Avança inclusive sobre a mudança que a fusão pulou por estar em voo — aquela
 * linha é minha, e a resposta do POST já a acerta. Sem isso a reposição pediria
 * a mesma janela para sempre.
 */
export function relogioDaReposicao(
  desde: string,
  mudancas: readonly MudancaDeReacao[],
): string {
  return mudancas.reduce((acc, m) => (m.reactedAt > acc ? m.reactedAt : acc), desde);
}

/**
 * Desfaz SÓ o meu palpite quando a API recusa: devolve a minha reação ao que
 * ela era antes do toque (`anterior`, com `emoji: null` quando eu não tinha
 * nenhuma) e não encosta em mais ninguém.
 *
 * Voltar a lista inteira que o render capturou seria uma viagem no tempo: a
 * reação que OUTRA pessoa mandou pelo evento ao vivo entre o meu toque e a
 * recusa desapareceria da tela sem nada a trazer de volta.
 */
export function desfazerPalpite(
  lista: readonly ReacaoNaTela[],
  anterior: { messageId: string; actorId: string; emoji: string | null; reactedAt: string },
): ReacaoNaTela[] {
  return definirReacao(lista, anterior);
}
