/**
 * Notificador audiovisual e desktop do Chat — F36.
 *
 * Cuida do som de notificação (Web Audio API sintetizada, sem dependência de
 * arquivo de áudio externo e com zero latência) e das notificações nativas
 * do sistema operacional (Chrome no Mac e Windows).
 *
 * Inclui a regra de SUPRESSÃO ESTREITA pedida pelo usuário:
 * "um pequeno som quando não se está visualizando, se a conversa estiver aberta
 * ai não sai som...".
 */

export type ParametrosSupressaoSom = {
  authorId: string | null;
  meuUserId: string | null;
  conversationId: string;
  conversaAbertaId: string | null;
  somHabilitado: boolean;
  janelaFocada: boolean;
};

export type ParametrosNotificacaoDesktop = {
  authorId: string | null;
  meuUserId: string | null;
  conversationId: string;
  conversaAbertaId: string | null;
  notificacoesHabilitadas: boolean;
  permissao: NotificationPermission | null;
  janelaFocada: boolean;
};

/**
 * Regra de decisão de som:
 * - Mensagem própria nunca toca.
 * - Se o som estiver mutado pelo usuário, não toca.
 * - Se a conversa está aberta e a janela está focada (usuário está olhando): NÃO TOCA SOM.
 * - Se a janela está em segundo plano/oculta OU a mensagem for de outra conversa: TOCA SOM.
 */
export function deveTocarSom(p: ParametrosSupressaoSom): boolean {
  if (!p.somHabilitado) return false;
  if (p.authorId != null && p.meuUserId != null && p.authorId === p.meuUserId) return false;
  // Se a janela está focada E a conversa que recebeu mensagem é exatamente a que está aberta:
  // o usuário já está visualizando, então NÃO toca.
  if (p.janelaFocada && p.conversaAbertaId === p.conversationId) {
    return false;
  }
  return true;
}

/**
 * Regra de decisão de notificação desktop no sistema operacional:
 * - Só dispara se a permissão estiver concedida ('granted').
 * - Mensagem própria nunca notifica.
 * - Só notifica se o usuário não estiver visualizando a conversa (janela desfocada ou outra conversa).
 */
export function deveDispararNotificacaoDesktop(p: ParametrosNotificacaoDesktop): boolean {
  if (p.permissao !== 'granted') return false;
  if (!p.notificacoesHabilitadas) return false;
  if (p.authorId != null && p.meuUserId != null && p.authorId === p.meuUserId) return false;
  if (p.janelaFocada && p.conversaAbertaId === p.conversationId) {
    return false;
  }
  return true;
}

/** Limpa markdown e formata prévia curta para a notificação nativa do SO. */
export function resumoDoTextoNotificacao(corpo: string, limite = 100): string {
  if (!corpo) return 'Nova mensagem';
  // Substitui tags markdown de imagem por [Foto]
  let limpo = corpo.replace(/!\[.*?\]\(.*?\)/g, '[Foto]');
  // Remove marcações de link [texto](url) -> texto
  limpo = limpo.replace(/\[(.*?)\]\(.*?\)/g, '$1');
  // Remove asteriscos e sublinhados de negrito/itálico
  limpo = limpo.replace(/[*_~`]/g, '');
  // Remove quebras de linha excessivas
  limpo = limpo.replace(/\s+/g, ' ').trim();
  if (limpo.length > limite) {
    return `${limpo.slice(0, limite)}…`;
  }
  return limpo || 'Nova mensagem';
}

/* ─────────────────────────── Sintetizador de Áudio (Web Audio API) ─────────────────────────── */

let audioCtxSingleton: AudioContext | null = null;

function obterAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtxSingleton || audioCtxSingleton.state === 'closed') {
    try {
      audioCtxSingleton = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return audioCtxSingleton;
}

/** Desbloqueia o AudioContext sob interação do usuário (evita bloqueio de autoplay do navegador). */
export function desbloquearAudio(): void {
  const ctx = obterAudioContext();
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume();
  }
}

/**
 * Toca um chime duplo harmônico, elegante e discreto (587.33 Hz D5 -> 880 Hz A5).
 * Volume calibrado para ambiente corporativo (suave e refinado).
 */
export function tocarSomNotificacao(): void {
  try {
    const ctx = obterAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const agora = ctx.currentTime;
    const duracao = 0.18;

    // Primeiro tom (D5: 587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, agora);
    gain1.gain.setValueAtTime(0, agora);
    gain1.gain.linearRampToValueAtTime(0.12, agora + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.0001, agora + duracao);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(agora);
    osc1.stop(agora + duracao);

    // Segundo tom mais agudo harmônico (A5: 880.00 Hz) que entra 40ms depois
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(880.0, agora + 0.04);
    gain2.gain.setValueAtTime(0, agora + 0.04);
    gain2.gain.linearRampToValueAtTime(0.1, agora + 0.055);
    gain2.gain.exponentialRampToValueAtTime(0.0001, agora + duracao + 0.06);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(agora + 0.04);
    osc2.stop(agora + duracao + 0.06);
  } catch {
    /* Áudio não pode derrubar a aplicação se houver restrição do browser */
  }
}

/* ─────────────────────────── Notificações Nativas do Sistema ─────────────────────────── */

export function notificacaoNativaDisponivel(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissaoNotificacaoNativa(): NotificationPermission | null {
  if (!notificacaoNativaDisponivel()) return null;
  return Notification.permission;
}

export async function solicitarPermissaoNotificacaoNativa(): Promise<boolean> {
  if (!notificacaoNativaDisponivel()) return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function dispararNotificacaoNativa(entrada: {
  title: string;
  body: string;
  conversationId: string;
  icon?: string;
  aoClicar?: () => void;
}): void {
  if (!notificacaoNativaDisponivel()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notif = new Notification(entrada.title, {
      body: entrada.body,
      icon: entrada.icon || '/favicon.ico',
      tag: `ideworks-chat-${entrada.conversationId}`,
    });

    notif.onclick = () => {
      try {
        if (typeof window !== 'undefined') {
          window.focus();
        }
      } catch {
        /* ignora falha de foco */
      }
      if (entrada.aoClicar) {
        entrada.aoClicar();
      }
      notif.close();
    };
  } catch {
    /* falha silenciosa em navegadores que bloqueiem chamadas */
  }
}

/* ─────────────────────────── Preferências no LocalStorage ─────────────────────────── */

const CHAVE_SOM = 'ideworks_chat_som_habilitado';
const CHAVE_DESKTOP = 'ideworks_chat_desktop_habilitado';

/*
  ⚠️ CADA ACESSO AO `localStorage` TEM `try` — conferência de 09/10/2026. Estas
  funções rodam no primeiro desenho da moldura (`GerenteDeConexao`), em toda
  rota. Onde o navegador nega o armazenamento (todos os cookies bloqueados,
  política do dispositivo) o acesso LANÇA, e sem o `try` isso derrubava o
  sistema inteiro — as outras leituras de armazenamento do código já se
  protegiam. Sem armazenamento, vale o padrão (ligado) e a escolha dura só
  esta visita.
*/
function lerGuardado(chave: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravarGuardado(chave: string, habilitado: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(chave, habilitado ? 'true' : 'false');
  } catch {
    /* sem armazenamento (negado ou cheio): a escolha vale só nesta visita */
  }
}

export function lerPreferenciaSom(): boolean {
  return lerGuardado(CHAVE_SOM) !== 'false';
}

export function salvarPreferenciaSom(habilitado: boolean): void {
  gravarGuardado(CHAVE_SOM, habilitado);
}

export function lerPreferenciaDesktop(): boolean {
  return lerGuardado(CHAVE_DESKTOP) !== 'false';
}

export function salvarPreferenciaDesktop(habilitado: boolean): void {
  gravarGuardado(CHAVE_DESKTOP, habilitado);
}
