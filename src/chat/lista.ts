import { imagensDoTexto, textoSemImagens } from '@/board/imagens-no-texto';

/**
 * Ordenação da lista de conversas — F20.5.
 *
 * Geral fixo no topo; o resto por atividade mais recente. Empate no instante
 * desempata pelo id (mesma regra de ordem do banco).
 */

export type ConversaParaLista = {
  id: string;
  kind: 'general' | 'group' | 'direct';
  name: string | null;
  lastMessage: { at: string | null; body: string | null; deletedAt: string | null } | null;
  /** F20.6 — nome da outra pessoa na direta. */
  peerName?: string | null;
  unreadCount?: number;
};

/** Nome que a lista escreve. */
export function nomeDaConversa(c: ConversaParaLista): string {
  if (c.kind === 'general') return 'Geral';
  if (c.kind === 'direct') {
    const peer = (c.peerName ?? '').trim();
    if (peer !== '') return peer;
    return 'Conversa direta';
  }
  if (c.name && c.name.trim() !== '') return c.name.trim();
  return 'Grupo';
}

/** Prévia da última mensagem — lápide sem corpo; imagem sem texto vira "Imagem". */
export function previaDaConversa(c: ConversaParaLista): string {
  const last = c.lastMessage;
  if (!last) return 'Nenhuma mensagem ainda';
  if (last.deletedAt) return 'Mensagem apagada';
  const bruto = last.body ?? '';
  const corpo = textoSemImagens(bruto).trim();
  if (corpo === '') {
    return imagensDoTexto(bruto).length > 0 ? 'Imagem' : 'Nenhuma mensagem ainda';
  }
  return corpo.length > 80 ? `${corpo.slice(0, 77)}…` : corpo;
}

function instante(c: ConversaParaLista): number {
  const at = c.lastMessage?.at;
  if (!at) return 0;
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
}

/** Geral primeiro; demais por última atividade (mais recente em cima). */
export function ordenarConversas<T extends ConversaParaLista>(lista: readonly T[]): T[] {
  const geral = lista.filter((c) => c.kind === 'general');
  const resto = lista
    .filter((c) => c.kind !== 'general')
    .slice()
    .sort((a, b) => {
      const da = instante(a);
      const db = instante(b);
      if (db !== da) return db - da;
      return a.id.localeCompare(b.id);
    });
  // Mais de um Geral seria defeito do banco; ainda assim mantém a ordem estável.
  geral.sort((a, b) => a.id.localeCompare(b.id));
  return [...geral, ...resto];
}

/* ───────────────── a linha e o cabeçalho da conversa — F08 do plano UX ───────────────── */

const doisDigitos = (n: number) => String(n).padStart(2, '0');
const DIAS_CURTOS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'] as const;

/**
 * O horário da última mensagem, do jeito que um app de mensagens escreve na
 * linha: hoje → "09:03"; ontem → "Ontem"; nesta semana → "seg."; neste ano →
 * "27/09"; antes → "27/09/25". Hora LOCAL de quem lê. Sem mensagem → vazio.
 */
export function horarioDaConversa(at: string | null | undefined, agora: Date = new Date()): string {
  if (!at) return '';
  const t = new Date(at);
  if (!Number.isFinite(t.getTime())) return '';
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(agora) - dia(t)) / 86_400_000);
  if (dias <= 0) return `${doisDigitos(t.getHours())}:${doisDigitos(t.getMinutes())}`;
  if (dias === 1) return 'Ontem';
  if (dias < 7) return DIAS_CURTOS[t.getDay()];
  const dm = `${doisDigitos(t.getDate())}/${doisDigitos(t.getMonth() + 1)}`;
  return t.getFullYear() === agora.getFullYear() ? dm : `${dm}/${String(t.getFullYear()).slice(-2)}`;
}

/** O selo de não lidas: nada com zero, o número até 99, e "99+" daí em diante. */
export function seloDeNaoLidas(n: number | null | undefined): string | null {
  if (!n || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

/**
 * A linha de apoio do cabeçalho — quem está nesta conversa. O nome diz QUAL;
 * esta frase diz de QUE TIPO e com quantos, para a identidade não depender de
 * lembrar o que cada nome é.
 */
export function sobreAConversa(c: {
  kind: ConversaParaLista['kind'];
  members?: readonly unknown[];
  peerIsActive?: boolean | null;
}): string {
  const n = c.members?.length ?? 0;
  const pessoas = n === 1 ? '1 pessoa' : `${n} pessoas`;
  if (c.kind === 'general') return n > 0 ? `Toda a equipe · ${pessoas}` : 'Toda a equipe';
  if (c.kind === 'group') return n > 0 ? `Grupo · ${pessoas}` : 'Grupo';
  return c.peerIsActive === false ? 'Conversa direta · pessoa desativada' : 'Conversa direta';
}
