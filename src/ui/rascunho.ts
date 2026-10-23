/**
 * Rascunho de formulário longo — etapa F19c, refeito na F17.AUD02.
 *
 * O QUE ELE RESOLVE
 *   A ficha de cliente tem dezoito campos. Fechar a aba, apertar F5 ou clicar
 *   num link no meio do preenchimento perdia tudo — e não havia nem aviso: a
 *   tela simplesmente voltava vazia.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE `sessionStorage` E NÃO `localStorage` — a decisão principal
 * ═══════════════════════════════════════════════════════════════════════════
 *   `localStorage` sobreviveria até a fechar o navegador, o que cobriria mais
 *   casos. E foi recusado de propósito.
 *
 *   O que este rascunho guarda é DADO DE CLIENTE: nome, CNPJ, telefone,
 *   endereço, e-mail do dono. `localStorage` grava isso no disco e deixa lá —
 *   depois do logout, depois de trocar de usuário, indefinidamente. Numa
 *   máquina de escritório compartilhada, é o CNPJ de um cliente esperando a
 *   próxima pessoa que sentar.
 *
 *   `sessionStorage` morre com a aba. Ele cobre os casos comuns — recarregar,
 *   navegar por engano, voltar — e não deixa dado de terceiro no disco de
 *   ninguém. Fechar a aba passa a perder o rascunho, e essa é a troca: um caso
 *   raro em favor de não espalhar dado pessoal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ O RASCUNHO TEM DONO — F17.AUD02, achado 2 da auditoria de 09/09/2026
 * ═══════════════════════════════════════════════════════════════════════════
 *   `sessionStorage` morre com a aba, mas NÃO morre com o logout. A auditoria
 *   provou: guardar um rascunho, sair, entrar com outra conta na mesma aba —
 *   e a ficha de cliente novo oferecia o rascunho da pessoa anterior, com
 *   CNPJ e telefone. A chave era só `cliente:novo`; não dizia de quem.
 *
 *   Agora a chave e o conteúdo levam o id do usuário, e o id vem de
 *   `/auth/me` — do ator que o servidor conferiu, nunca do e-mail digitado ou
 *   de algo guardado no navegador. Três regras seguem disso:
 *
 *   1. NADA SE LÊ NEM SE GRAVA SEM DONO CONFIRMADO. `assumirDono` é chamado
 *      quando a sessão responde; antes disso, e depois de `esquecerDono`,
 *      `guardarRascunho` e `lerRascunho` são inertes. É a porta que fecha o
 *      caso mais traiçoeiro: um temporizador de gravação que dispara DEPOIS de
 *      a saída ter limpado tudo, e regrava o que acabou de ser apagado.
 *
 *   2. A ABA FICA SÓ COM OS RASCUNHOS DO DONO. Confirmar uma identidade apaga
 *      tudo o que não é dela — de outro usuário, ou do formato antigo sem
 *      autor. O formato antigo não é migrado: atribuir ao usuário atual um
 *      rascunho sem dono seria exatamente o vazamento que se quer fechar. Quem
 *      tinha um rascunho aberto no dia da publicação perde só ele.
 *
 *   3. SAIR AVISA AS OUTRAS ABAS. O cookie é compartilhado entre abas; o
 *      `sessionStorage` não. Uma aba no fundo com o rascunho de A continuaria
 *      com ele depois de A sair por outra aba. `avisarOutrasAbas` escreve um
 *      carimbo SEM dado pessoal em `localStorage`; `vigiarOutrasAbas` ouve e
 *      manda quem está montado perguntar de novo quem é.
 *
 * O RASCUNHO NUNCA VOLTA SOZINHO
 *   Restaurar em silêncio é pior que perder. A pessoa abre uma ficha, vê
 *   campos preenchidos e não sabe se aquilo é o que está salvo no sistema ou
 *   uma edição de ontem que ela abandonou — e pode gravar por cima do certo
 *   achando que está só confirmando.
 *
 *   Então quem restaura é ela, num clique, com a tela dizendo de quando é.
 *
 * UMA CHAVE POR FICHA E POR DONO
 *   Cliente novo e cliente existente têm rascunhos separados, e cada cliente
 *   tem o seu. Chave única faria abrir a ficha de um mostrar o rascunho de
 *   outro — o pior defeito possível num formulário de cadastro.
 */

const PREFIXO = 'ideworks:rascunho:';

/**
 * O formato. Subir este número invalida tudo o que está guardado — que é o
 * comportamento certo quando o que muda é O QUE se garante sobre o conteúdo.
 */
const VERSAO = 2;

/** Depois disto o rascunho é lixo: quem abandonou há horas não vai voltar. */
const VALIDADE_HORAS = 12;

/** O carimbo de "a sessão desta máquina mudou". Só um instante; nenhum dado. */
const MARCA_DE_MUDANCA = 'ideworks:sessao:mudou-em';

/** De quem e de qual ficha é um rascunho. */
export type Ficha = {
  /** O id estável do usuário autenticado — de `/auth/me`, nunca do e-mail. */
  usuario: string;
  /**
   * `cliente` desde a F19c; `tarefa` desde a F17.AUD03 — o título e o
   * briefing da ficha da tarefa passaram a ter rascunho local, com as mesmas
   * regras de dono e validade. É o tipo, e não só o id, que separa as chaves:
   * um cliente e uma tarefa nunca dividem o mesmo rascunho por coincidência.
   */
  tipo: 'cliente' | 'tarefa';
  /** `null` é a ficha de cliente novo. */
  id: string | null;
};

export type Rascunho<T> = {
  versao: typeof VERSAO;
  usuario: string;
  /** `cliente:novo`, `cliente:<id>` ou `tarefa:<id>` — a ficha, sem o dono. */
  ficha: string;
  valor: T;
  guardadoEm: string;
};

/** A ficha sem o dono: é o que o conteúdo repete para se conferir. */
export const nomeDaFicha = (ficha: Ficha) => `${ficha.tipo}:${ficha.id ?? 'novo'}`;

/** A chave de uma ficha DE UM DONO. */
export const chaveDaFicha = (ficha: Ficha) =>
  `${PREFIXO}v${VERSAO}:${ficha.usuario}:${nomeDaFicha(ficha)}`;

/** O começo de toda chave deste dono — o que a varredura preserva. */
const prefixoDoDono = (usuario: string) => `${PREFIXO}v${VERSAO}:${usuario}:`;

/**
 * Toda operação é envolvida: `sessionStorage` LANÇA em navegação privada de
 * alguns navegadores e quando a política do dispositivo bloqueia armazenamento.
 * Um rascunho que derruba o formulário seria pior que rascunho nenhum.
 */
function comCofre<T>(acao: (s: Storage) => T, seFalhar: T): T {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return seFalhar;
    return acao(window.sessionStorage);
  } catch {
    return seFalhar;
  }
}

/** As chaves deste módulo no cofre — lidas antes de remover, porque remover reindexa. */
function chavesDeRascunho(s: Storage): string[] {
  const chaves: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (k !== null && k.startsWith(PREFIXO)) chaves.push(k);
  }
  return chaves;
}

/* ─────────────────────────────── o dono ─────────────────────────────── */

/**
 * Quem a sessão confirmou nesta aba. `null` até `/auth/me` responder, e de
 * novo depois de sair. Vive em memória de propósito: recarregar a página
 * começa sem dono, e nada se lê até a sessão dizer quem é.
 */
let dono: string | null = null;

/** Para a tela e para os testes: há dono confirmado, e é este? */
export const donoConfirmado = (): string | null => dono;

/**
 * A sessão respondeu: esta aba é de `usuario`. Tudo o que não é dele vai
 * embora — inclusive as chaves do formato antigo, que não têm autor.
 *
 * É idempotente e barato; pode ser chamado a cada resposta de `/auth/me`.
 */
export function assumirDono(usuario: string): void {
  dono = usuario;
  const meu = prefixoDoDono(usuario);
  comCofre((s) => {
    for (const k of chavesDeRascunho(s)) if (!k.startsWith(meu)) s.removeItem(k);
    return null;
  }, null);
}

/**
 * A sessão acabou nesta aba — saiu, ou outra aba avisou que saiu. Nenhum
 * rascunho sobrevive, e o que um temporizador atrasado tentar gravar depois
 * disto bate na porta fechada (ver `guardarRascunho`).
 */
export function esquecerDono(): void {
  dono = null;
  comCofre((s) => {
    for (const k of chavesDeRascunho(s)) s.removeItem(k);
    return null;
  }, null);
}

/* ────────────────────────── guardar, ler, apagar ────────────────────────── */

export function guardarRascunho<T>(ficha: Ficha, valor: T): void {
  // Sem dono confirmado, ou com outro dono, não se grava. É aqui que o
  // temporizador atrasado de uma saída morre em silêncio.
  if (dono === null || dono !== ficha.usuario) return;
  const registro: Rascunho<T> = {
    versao: VERSAO,
    usuario: ficha.usuario,
    ficha: nomeDaFicha(ficha),
    valor,
    guardadoEm: new Date().toISOString(),
  };
  comCofre((s) => {
    s.setItem(chaveDaFicha(ficha), JSON.stringify(registro));
    return null;
  }, null);
}

export function lerRascunho<T>(ficha: Ficha, agora = new Date()): Rascunho<T> | null {
  if (dono === null || dono !== ficha.usuario) return null;
  return comCofre((s) => {
    const chave = chaveDaFicha(ficha);
    const cru = s.getItem(chave);
    if (cru === null) return null;

    let lido: Partial<Rascunho<T>>;
    try {
      lido = JSON.parse(cru) as Partial<Rascunho<T>>;
    } catch {
      // Rascunho corrompido some sozinho. Deixá-lo lá faria a tela tentar de
      // novo a cada abertura, para sempre.
      s.removeItem(chave);
      return null;
    }

    // A chave já diz dono e ficha; o conteúdo repete os dois e a versão. Se
    // discordam, alguém escreveu ali por fora — e o que se faz com o que não
    // se reconhece é apagar, não adivinhar.
    if (
      lido?.versao !== VERSAO ||
      lido.usuario !== ficha.usuario ||
      lido.ficha !== nomeDaFicha(ficha) ||
      typeof lido.guardadoEm !== 'string' ||
      lido.valor === undefined
    ) {
      s.removeItem(chave);
      return null;
    }

    const horas = (agora.getTime() - new Date(lido.guardadoEm).getTime()) / 3_600_000;
    if (!Number.isFinite(horas) || horas > VALIDADE_HORAS || horas < 0) {
      s.removeItem(chave);
      return null;
    }

    return lido as Rascunho<T>;
  }, null);
}

export function apagarRascunho(ficha: Ficha): void {
  comCofre((s) => {
    s.removeItem(chaveDaFicha(ficha));
    return null;
  }, null);
}

/* ─────────────────────────── as outras abas ─────────────────────────── */

const lerMarca = (): string | null => {
  try {
    return window.localStorage.getItem(MARCA_DE_MUDANCA);
  } catch {
    return null;
  }
};

/**
 * Avisa as outras abas desta máquina que a sessão mudou. É um instante em
 * `localStorage` — o único lugar que o evento `storage` alcança — e nada mais:
 * nem id, nem e-mail. Quem ouve não aprende quem entrou; só que precisa
 * perguntar de novo.
 */
export function avisarOutrasAbas(): void {
  try {
    window.localStorage.setItem(MARCA_DE_MUDANCA, String(Date.now()));
  } catch {
    // Sem `localStorage` as outras abas descobrem na próxima chamada, que
    // volta 401 — mais tarde, mas descobrem.
  }
}

/**
 * O que `Sair` faz nesta aba, ANTES de falar com o servidor: esquece o dono,
 * apaga os rascunhos e avisa as outras abas. Antes, e não depois, porque a
 * página é substituída logo em seguida — e uma limpeza que dependesse da
 * resposta do servidor não aconteceria com a rede fora.
 */
export function limparAoSair(): void {
  esquecerDono();
  avisarOutrasAbas();
}

/**
 * Ouve o aviso. Dois caminhos, porque um só não basta: o evento `storage`
 * chega na hora a quem está aberto; uma aba congelada ou descartada pelo
 * navegador não o recebe, e por isso a marca é conferida também ao voltar a
 * ficar visível. Devolve o que desliga os dois.
 */
export function vigiarOutrasAbas(aoMudar: () => void): () => void {
  let vista = lerMarca();
  const conferir = () => {
    const agora = lerMarca();
    if (agora === vista) return;
    vista = agora;
    aoMudar();
  };
  const aoGravar = (e: StorageEvent) => {
    // `key === null` é o `clear()` de outra aba — a marca pode ter ido junto.
    if (e.key === MARCA_DE_MUDANCA || e.key === null) conferir();
  };
  const aoVisivel = () => {
    if (document.visibilityState === 'visible') conferir();
  };
  try {
    window.addEventListener('storage', aoGravar);
    document.addEventListener('visibilitychange', aoVisivel);
  } catch {
    return () => {};
  }
  return () => {
    window.removeEventListener('storage', aoGravar);
    document.removeEventListener('visibilitychange', aoVisivel);
  };
}

/** "há 3 minutos", para a tela dizer de quando é o rascunho oferecido. */
export function quandoFoi(iso: string, agora = new Date()): string {
  const minutos = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return 'agora há pouco';
  if (minutos === 1) return 'há 1 minuto';
  if (minutos < 60) return `há ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  return horas === 1 ? 'há 1 hora' : `há ${horas} horas`;
}
