/**
 * As regras do motor de coleta — etapa F8.
 *
 * Sem rede e sem banco: o que está aqui é decisão, e decisão se testa sem
 * infraestrutura. Quem fala com a Meta é `server/meta-coleta.ts`; quem grava é
 * o banco, por função com dono.
 *
 * AS TRÊS REGRAS QUE VÊM DA VIABILIDADE
 *
 *   1. A JANELA É DE 28 DIAS, SEMPRE (seção 6.2). Número de anúncio continua
 *      mudando por até 28 dias depois do fim do anúncio. Coletar só o dia de
 *      ontem produz relatório que envelhece errado — e ninguém percebe, porque
 *      o número parece plausível.
 *
 *   2. O LIMITE É POR CARGA, NÃO POR CONTAGEM (seção 6.4). A Meta devolve o uso
 *      em cabeçalho, em porcentagem. Contar requisições não serve: duas
 *      consultas podem custar cargas muito diferentes.
 *
 *   3. MÉTRICA SOME SEM AVISO (seção 6.5). Campo que desapareceu não é falha da
 *      coleta — é a plataforma mudando. Tratar como erro encheria o alarme de
 *      ruído e faria a equipe parar de olhar para ele.
 */

/* ─────────────────────────── a janela ─────────────────────────── */

/** Dias que o motor reprocessa a cada execução. Ver regra 1. */
export const DIAS_DA_JANELA = 28;

export type Janela = { de: string; ate: string };

const comoDia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A janela a reprocessar.
 *
 * Termina HOJE, não ontem. A Meta leva até 48h para fechar o cálculo de um dia
 * (viabilidade, seção 3), então o dia corrente vem incompleto — e vem de novo,
 * completo, nas próximas execuções. Excluí-lo só atrasaria o painel em um dia
 * sem tornar nenhum número mais correto.
 */
export function janelaDeColeta(hoje = new Date(), dias = DIAS_DA_JANELA): Janela {
  if (!Number.isInteger(dias) || dias < 1) {
    throw new Error(`Janela inválida: ${dias} dia(s).`);
  }
  const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  const inicio = new Date(fim);
  // `dias - 1` porque a janela é inclusiva nas duas pontas: 28 dias contando
  // hoje, e não 29.
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));
  return { de: comoDia(inicio), ate: comoDia(fim) };
}

/* ─────────────────────────── o limitador ─────────────────────────── */

/** Acima disto o motor para de pedir e deixa o resto para a próxima execução. */
export const TETO_DE_USO = 90;

export type Uso = { app: number; conta: number };

/**
 * Lê o cabeçalho `x-fb-ads-insights-throttle`.
 *
 * Devolve `null` quando o cabeçalho não veio ou veio ilegível — e aí o motor
 * segue, porque **não** é erro: a Meta só manda esse cabeçalho nas chamadas de
 * insights de anúncio. Tratar ausência como problema pararia a coleta do
 * orgânico, que nunca o recebe.
 */
export function lerUso(cabecalho: string | null): Uso | null {
  if (cabecalho === null || cabecalho.trim() === '') return null;
  try {
    const j = JSON.parse(cabecalho) as Record<string, unknown>;
    const app = Number(j.app_id_util_pct);
    const conta = Number(j.acc_id_util_pct);
    if (!Number.isFinite(app) && !Number.isFinite(conta)) return null;
    return {
      app: Number.isFinite(app) ? app : 0,
      conta: Number.isFinite(conta) ? conta : 0,
    };
  } catch {
    return null;
  }
}

/** Verdadeiro quando é hora de parar de pedir nesta execução. */
export const devePausar = (uso: Uso | null, teto = TETO_DE_USO) =>
  uso !== null && (uso.app >= teto || uso.conta >= teto);

/* ─────────────────────────── os erros ─────────────────────────── */

export type TipoDeFalha =
  | 'limite'
  | 'token'
  | 'permissao'
  | 'metrica_desconhecida'
  | 'nao_encontrado'
  | 'outro';

export type Falha = { tipo: TipoDeFalha; mensagem: string; deveParar: boolean };

/**
 * Traduz o erro da Meta para algo que a tela de conexões possa mostrar e o
 * motor possa decidir em cima.
 *
 * `deveParar` é sobre a EXECUÇÃO INTEIRA, não sobre este ativo. Token inválido
 * e limite estourado não melhoram no próximo ativo — insistir só queima o resto
 * da cota e enche o alarme com a mesma falha repetida N vezes.
 *
 * A ressalva do token: ele vale para o próximo ativo QUE USA A MESMA CREDENCIAL.
 * Com um token por empresa (F7g), quem decide até onde a parada vai é o motor
 * (`tipo === 'token'` fecha só a credencial); o limite de uso fecha a execução.
 */
export function classificarFalha(erro: unknown): Falha {
  const e = erro as { code?: number; error_subcode?: number; message?: string; type?: string };
  const codigo = Number(e?.code);
  const mensagem = typeof e?.message === 'string' ? e.message : String(erro);

  // 4 e 17 são limite de aplicativo e de usuário; 613 é limite personalizado.
  if (codigo === 4 || codigo === 17 || codigo === 613) {
    return {
      tipo: 'limite',
      mensagem: 'Limite de uso da Meta atingido. A coleta continua na próxima execução.',
      deveParar: true,
    };
  }

  // 190 é token inválido ou vencido. Sem token, nada mais nesta execução vai
  // funcionar — e é o único caso que precisa de gente.
  if (codigo === 190) {
    return {
      tipo: 'token',
      mensagem: 'O token da Meta venceu ou foi revogado. Precisa ser renovado no servidor.',
      deveParar: true,
    };
  }

  if (codigo === 200 || codigo === 10 || codigo === 3) {
    return {
      tipo: 'permissao',
      mensagem: 'Sem permissão para esta conta. Confira o acesso de parceiro na BM do cliente.',
      deveParar: false,
    };
  }

  if (codigo === 803 || codigo === 100) {
    // 100 cobre tanto campo inexistente quanto consulta grande demais. A
    // mensagem da Meta distingue; o motor não precisa — os dois se resolvem
    // pulando este ativo e seguindo.
    return {
      tipo: /unknown|nonexisting|does not exist/i.test(mensagem)
        ? 'metrica_desconhecida'
        : 'nao_encontrado',
      mensagem: `A Meta recusou a consulta: ${mensagem}`,
      deveParar: false,
    };
  }

  return { tipo: 'outro', mensagem, deveParar: false };
}

/* ─────────────────────────── o desfecho ─────────────────────────── */

export type Desfecho = 'ok' | 'partial' | 'failed';

/**
 * Como a execução terminou.
 *
 * Zero ativos é `ok`, e não `failed`: não haver o que coletar é um estado
 * legítimo — ninguém conectou conta ainda. Marcar como falha faria o alarme
 * tocar todo dia até o primeiro cliente ser conectado, e alarme que sempre toca
 * é alarme que ninguém lê.
 */
export function desfechoDaExecucao(ok: number, falhos: number): Desfecho {
  if (falhos === 0) return 'ok';
  return ok === 0 ? 'failed' : 'partial';
}

/* ─────────────────────────── a saúde ─────────────────────────── */

/**
 * Quantas horas sem coleta bem-sucedida antes de a tela chamar UMA CONTA de
 * atrasada.
 *
 * ERA 36, E 36 ERA CEGO
 *   O número veio de quando a coleta era diária: 36 horas dava folga para um
 *   atraso de fila sem piscar vermelho. Com o gatilho de meia em meia hora ele
 *   virou outra coisa — 36 horas são setenta e duas batidas perdidas.
 *
 *   Medido: em 2026-08-20 a coleta parou às 17:30 e ficou catorze horas morta.
 *   Nenhuma conta teria sido marcada como atrasada. O alarme existia e teria
 *   ficado verde o apagão inteiro.
 *
 *   Doze horas é o novo limite, e ele sai de conta: a volta completa da fila
 *   leva no pior caso ~5 horas (41 contas, ~52 segundos cada nas mais caras,
 *   240 segundos de orçamento por execução, uma execução a cada 30 minutos).
 *   Doze horas são duas voltas e meia — folga para um tropeço, curto o
 *   bastante para não esconder um apagão.
 */
export const HORAS_ATE_ATRASO = 12;

export type Saude = 'nunca_coletou' | 'em_dia' | 'atrasado';

/** Se UMA CONTA está sendo coletada. */
export function saudeDaColeta(ultimoSucesso: string | null, agora = new Date()): Saude {
  if (ultimoSucesso === null) return 'nunca_coletou';
  const horas = (agora.getTime() - new Date(ultimoSucesso).getTime()) / 3_600_000;
  return horas <= HORAS_ATE_ATRASO ? 'em_dia' : 'atrasado';
}

/* ─────────────────────────── a saúde do MOTOR ─────────────────────────── */

/**
 * O intervalo entre execuções, em minutos. Espelha o `crons` do wrangler.toml.
 *
 * Está aqui e lá, e não há como o compilador ligar os dois — é configuração de
 * plataforma. Mudar um sem o outro faz o alarme mentir, e por isso os dois
 * arquivos se citam.
 */
export const MINUTOS_ENTRE_EXECUCOES = 15;

/** Quantas batidas podem falhar antes de a tela gritar. */
export const BATIDAS_ATE_ALARME = 4;

export type SaudeDoMotor = 'nunca_rodou' | 'em_dia' | 'atrasada' | 'parada';

/**
 * Se o MOTOR está vivo — que é a pergunta que faltava.
 *
 * POR QUE OLHAR A EXECUÇÃO, E NÃO A CONTA
 *   `saudeDaColeta` responde "esta conta está sendo coletada?". É a pergunta
 *   certa para uma linha da lista, e a errada para o sistema: quando o motor
 *   morre, TODAS as contas envelhecem juntas e devagar. Cada linha continua
 *   parecendo aceitável por horas, e o problema só fica óbvio quando já é
 *   grande.
 *
 *   Em 2026-08-20 o motor morreu às 17:30 e ninguém soube por catorze horas.
 *   Não havia erro para ver — a execução era uma transação só, e ao ser morta
 *   pelo teto de tempo desfazia até o próprio registro. O que restava como
 *   sintoma era uma ausência, e ausência não aparece sozinha: alguém tem que
 *   perguntar "quando foi a última?".
 *
 *   Esta função é essa pergunta.
 *
 * OS TRÊS ESTADOS, E POR QUE TRÊS
 *   `atrasada` é uma batida perdida — acontece, e não merece alarme vermelho.
 *   `parada` são quatro seguidas, duas horas: aí não é tropeço, é defeito.
 *   Ter os dois evita a tela que grita por qualquer coisa, que é a tela que
 *   ninguém mais olha.
 */
export function saudeDoMotor(
  ultimaExecucao: string | null,
  agora = new Date(),
): SaudeDoMotor {
  if (ultimaExecucao === null) return 'nunca_rodou';

  const minutos = (agora.getTime() - new Date(ultimaExecucao).getTime()) / 60_000;

  // Uma batida e meia de folga: a execução leva minutos, e o relógio da
  // Cloudflare não é pontual ao segundo.
  if (minutos <= MINUTOS_ENTRE_EXECUCOES * 1.5) return 'em_dia';
  if (minutos <= MINUTOS_ENTRE_EXECUCOES * BATIDAS_ATE_ALARME) return 'atrasada';
  return 'parada';
}

/** Quantas batidas se perderam desde a última execução. Zero quando em dia. */
export function batidasPerdidas(ultimaExecucao: string | null, agora = new Date()): number {
  if (ultimaExecucao === null) return 0;
  const minutos = (agora.getTime() - new Date(ultimaExecucao).getTime()) / 60_000;
  return Math.max(0, Math.floor(minutos / MINUTOS_ENTRE_EXECUCOES) - 1);
}
