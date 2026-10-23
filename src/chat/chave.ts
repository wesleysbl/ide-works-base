/**
 * Estado da chave do chat no navegador — F20.5.
 *
 * A rota `/config` devolve `chat` sem sessão, e `main.tsx` grava aqui ANTES
 * do primeiro quadro — a barra lateral lê no primeiro desenho, sem piscar.
 */

export type ChatMode = 'desligado' | 'piloto' | 'ligado';

export const CHAT_BODY_MAX = 4000;

export const FRASE_PAREDE_30_DIAS = 'As mensagens ficam guardadas por 30 dias';

let modo: ChatMode = 'desligado';

export function definirModoDoChat(valor: unknown): ChatMode {
  const v = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  modo = v === 'ligado' || v === 'piloto' ? v : 'desligado';
  return modo;
}

export function modoDoChat(): ChatMode {
  return modo;
}

/**
 * O item Chat aparece na barra?
 *
 * `isSuper === null` = sessão ainda carregando. Em piloto mostramos para não
 * piscar o menu do super admin; quem não for cai quando a sessão chegar.
 */
export function chatVisivelNaBarra(mode: ChatMode, isSuper: boolean | null): boolean {
  if (mode === 'desligado') return false;
  if (mode === 'ligado') return true;
  if (isSuper === null) return true;
  return isSuper;
}
