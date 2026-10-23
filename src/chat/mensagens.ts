/**
 * Agrupamento do painel — F20.5.
 *
 * Separador por dia no fuso America/Sao_Paulo (só parte o dia; ordem e prazo
 * vêm dos instantes do banco). Agrupamento por autor: falas consecutivas da
 * mesma pessoa compartilham cabeçalho.
 */

import { imagensDoTexto, textoSemImagens } from '@/board/imagens-no-texto';

export type MensagemParaPainel = {
  id: string;
  authorId: string | null;
  body: string;
  kind: 'person' | 'system';
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  clientKey: string | null;
};

export type BlocoDoPainel =
  | { tipo: 'dia'; chave: string; rotulo: string }
  | {
      tipo: 'fala';
      mensagem: MensagemParaPainel;
      primeiraDoAutor: boolean;
    }
  | { tipo: 'sistema'; mensagem: MensagemParaPainel };

const FUSO = 'America/Sao_Paulo';

/**
 * OS FORMATADORES NASCEM UMA VEZ — perf-front, 08/10/2026.
 *
 * `new Intl.DateTimeFormat(...)` custa dezenas de microssegundos (resolve
 * locale, fuso e padrão), e estas funções rodam POR MENSAGEM a cada desenho do
 * Chat — `chaveDoDia` em `montarPainel`, `horaDaMensagem` e `instanteDaMensagem`
 * na bolha. Digitar uma letra no campo redesenhava a conversa inteira, e com
 * 300 mensagens na tela esses três formatadores eram 1,8 s dos 2,9 s gastos em
 * 14 teclas (CPU sem estrangulamento, perfil do Chrome): 927 ms em
 * `instanteDaMensagem`, 453 ms em `horaDaMensagem`, 445 ms em `montarPainel`.
 * O formatador é o mesmo, com as mesmas opções — só deixa de ser reconstruído.
 */
let formatoDoDia: Intl.DateTimeFormat | undefined;
let formatoDaHora: Intl.DateTimeFormat | undefined;

/** YYYY-MM-DD no fuso de São Paulo — chave estável do separador. */
export function chaveDoDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'ilegivel';
  return diaEmSaoPaulo(d);
}

function diaEmSaoPaulo(d: Date): string {
  formatoDoDia ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatoDoDia.format(d);
}

function hojeEmSaoPaulo(agora: Date): string {
  return diaEmSaoPaulo(agora);
}

function ontemEmSaoPaulo(agora: Date): string {
  return chaveDoDia(new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString());
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_DA_SEMANA = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado',
];

/**
 * Rótulo do separador — F09. Perto de hoje, o nome que a pessoa usa ao falar
 * ("Ontem", "Sexta-feira"); mais longe, a data por extenso, sem o ano quando é
 * o deste ano. `agora` é injetável para teste.
 */
export function rotuloDoDia(chave: string, agora: Date = new Date()): string {
  if (chave === 'ilegivel') return 'Dia desconhecido';
  const hoje = hojeEmSaoPaulo(agora);
  if (chave === hoje) return 'Hoje';
  if (chave === ontemEmSaoPaulo(agora)) return 'Ontem';
  const [y, m, d] = chave.split('-').map(Number);
  if (!y || !m || !d) return chave;
  /* Meio-dia UTC do dia: longe de qualquer virada de fuso. */
  const dia = Date.UTC(y, m - 1, d, 12);
  const [hy, hm, hd] = hoje.split('-').map(Number);
  const dias = Math.round((Date.UTC(hy, hm - 1, hd, 12) - dia) / 86_400_000);
  if (dias > 1 && dias < 7) return DIAS_DA_SEMANA[new Date(dia).getUTCDay()];
  const extenso = `${d} de ${MESES[m - 1]}`;
  return y === hy ? extenso : `${extenso} de ${y}`;
}

/** "14:32" no fuso de São Paulo — o dia já está no separador. */
export function horaDaMensagem(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  formatoDaHora ??= new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatoDaHora.format(d);
}

/** "28/09/2026 às 14:32" — o instante inteiro, para o `title` do horário. */
export function instanteDaMensagem(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const [y, m, dd] = chaveDoDia(iso).split('-');
  return `${dd}/${m}/${y} às ${horaDaMensagem(iso)}`;
}

/**
 * Falas seguidas do mesmo autor se agrupam só dentro desta janela. Depois de
 * uma pausa, a próxima fala volta a mostrar nome e horário — sem isso, uma
 * conversa de manhã e outra à tarde viravam um bloco só, com o horário da
 * primeira.
 */
export const JANELA_DO_GRUPO_MS = 5 * 60 * 1000;

/** Ordena pelo instante do banco; empate no id. */
export function ordenarMensagens<T extends { id: string; createdAt: string }>(
  lista: readonly T[],
): T[] {
  return lista.slice().sort((a, b) => {
    const da = Date.parse(a.createdAt);
    const db = Date.parse(b.createdAt);
    const ta = Number.isFinite(da) ? da : 0;
    const tb = Number.isFinite(db) ? db : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Monta a lista desenhável: separadores de dia + falas (com marca de primeiro
 * do autor) + linhas de sistema.
 */
export function montarPainel(
  mensagens: readonly MensagemParaPainel[],
  agora: Date = new Date(),
): BlocoDoPainel[] {
  const ordenadas = ordenarMensagens(mensagens);
  const saida: BlocoDoPainel[] = [];
  let diaAtual: string | null = null;
  let ultimoAutor: string | null = null;
  let ultimoInstante = 0;

  for (const m of ordenadas) {
    const dia = chaveDoDia(m.createdAt);
    if (dia !== diaAtual) {
      diaAtual = dia;
      ultimoAutor = null;
      saida.push({ tipo: 'dia', chave: dia, rotulo: rotuloDoDia(dia, agora) });
    }

    if (m.kind === 'system') {
      ultimoAutor = null;
      saida.push({ tipo: 'sistema', mensagem: m });
      continue;
    }

    const autor = m.authorId ?? '';
    const instante = Date.parse(m.createdAt);
    const pausa = Number.isFinite(instante) && instante - ultimoInstante > JANELA_DO_GRUPO_MS;
    const primeira = autor !== ultimoAutor || pausa;
    ultimoAutor = autor;
    if (Number.isFinite(instante)) ultimoInstante = instante;
    saida.push({ tipo: 'fala', mensagem: m, primeiraDoAutor: primeira });
  }

  return saida;
}

/** Status visual estilo WhatsApp para as mensagens do próprio autor. */
export type StatusDoEnvioVisual = 'pendente' | 'enviada' | 'entregue' | 'lida' | 'falha';

export function statusVisualDaMensagem(
  mensagem: { estado: 'confirmada' | 'pendente' | 'falha'; createdAt: string },
  peerLastReadAt?: string | null,
): StatusDoEnvioVisual {
  if (mensagem.estado === 'pendente') return 'pendente';
  if (mensagem.estado === 'falha') return 'falha';

  if (peerLastReadAt) {
    const dMsg = Date.parse(mensagem.createdAt);
    const dRead = Date.parse(peerLastReadAt);
    if (Number.isFinite(dMsg) && Number.isFinite(dRead) && dRead >= dMsg) {
      return 'lida';
    }
  }

  return 'entregue';
}

/**
 * O texto que a JANELINHA desenha na bolha. Ela não renderiza markdown (a tela
 * cheia do Chat sim), então o que a tela cheia mostra como lápide ou como
 * imagem não pode chegar aqui cru: a mensagem apagada tem corpo vazio (uma
 * bolha só com a hora) e a imagem é uma referência `![…](attachment:…)`.
 */
export function textoNaJanelinha(m: { body: string; deletedAt: string | null }): string {
  if (m.deletedAt) return 'Mensagem apagada';
  const imagens = imagensDoTexto(m.body).length;
  if (imagens === 0) return m.body;
  const texto = textoSemImagens(m.body).trim();
  if (texto === '') return imagens === 1 ? 'Imagem' : `${imagens} imagens`;
  return `${texto}\n[${imagens === 1 ? 'Imagem' : `${imagens} imagens`}]`;
}
