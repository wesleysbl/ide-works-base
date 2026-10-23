/**
 * Os ativos da Meta, sem tela e sem banco — etapa F7.
 *
 * O QUE É REGRA AQUI
 *   Reconhecer e normalizar o identificador que a pessoa cola. Na prática ela
 *   não digita o id: ela **copia a URL** do Gerenciador de Anúncios, do
 *   Instagram ou da página. Recusar a URL e exigir só o número transformaria a
 *   tarefa mais comum num exercício de recorte.
 *
 * POR QUE NÃO SE CONFERE CONTRA A META AQUI
 *   Porque este módulo não fala com a rede — é regra pura, testável. A
 *   conferência de que o ativo existe e é alcançável é da F8, e o resultado
 *   dela mora em `last_seen_at` / `last_error`.
 *
 *   A separação importa: um id bem formado que a Meta recusa é um problema
 *   **de permissão**, não de digitação, e as duas coisas pedem mensagens
 *   diferentes.
 */

import { saudeDaColeta } from '@/meta/coleta';

export const TIPOS_DE_ATIVO = [
  'business',
  'ad_account',
  'facebook_page',
  'instagram_account',
] as const;

export type TipoDeAtivo = (typeof TIPOS_DE_ATIVO)[number];

export const ROTULO_DO_ATIVO: Record<TipoDeAtivo, string> = {
  business: 'Business Manager',
  ad_account: 'Conta de anúncios',
  facebook_page: 'Página do Facebook',
  instagram_account: 'Conta do Instagram',
};

/** O que a pessoa vê como exemplo em cada campo. */
export const EXEMPLO_DO_ATIVO: Record<TipoDeAtivo, string> = {
  business: '1234567890 ou a URL do Business Manager',
  ad_account: 'act_1234567890, 1234567890, ou a URL do Gerenciador',
  facebook_page: '1234567890 ou a URL da página',
  instagram_account: '17841400000000000 (ID da conta profissional)',
};

export const ehTipoDeAtivo = (v: unknown): v is TipoDeAtivo =>
  typeof v === 'string' && (TIPOS_DE_ATIVO as readonly string[]).includes(v);

/**
 * Extrai o identificador do que a pessoa colou.
 *
 * Aceita o id puro, o id com o prefixo `act_`, e as URLs mais comuns do
 * ecossistema. Devolve `null` quando não achou número nenhum plausível — e aí
 * o problema é de digitação, que é o que a mensagem vai dizer.
 *
 * A CONTA DE ANÚNCIO É O ÚNICO CASO COM PREFIXO
 *   A API da Meta espera `act_123` no caminho da requisição. Guardar o número
 *   pelado obrigaria toda chamada a lembrar de acrescentar o prefixo — e a que
 *   esquecesse falharia com "objeto não encontrado", que não diz nada sobre a
 *   causa. Normaliza-se uma vez, aqui.
 */
export function normalizarIdentificador(tipo: TipoDeAtivo, bruto: string): string | null {
  const v = bruto.trim();
  if (v === '') return null;

  // Da URL, interessa a sequência de dígitos mais longa: os outros números que
  // aparecem (versão da API, parâmetros de rastreio) são sempre menores.
  const digitos = v.match(/\d{5,}/g);
  if (digitos === null) return null;

  const id = digitos.reduce((maior, atual) => (atual.length >= maior.length ? atual : maior));

  if (tipo === 'ad_account') return `act_${id}`;
  return id;
}

/** Verdadeiro quando o texto já está na forma que o banco guarda. */
export function identificadorEhValido(tipo: TipoDeAtivo, valor: string): boolean {
  return normalizarIdentificador(tipo, valor) === valor;
}

/* ─────────────────────────── o estado de um cliente ─────────────────────────── */

export type Ativo = {
  id: string;
  clientId: string;
  kind: TipoDeAtivo;
  externalId: string;
  displayName: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
};

export type EstadoDaConexao = 'sem_conexao' | 'incompleta' | 'com_erro' | 'conectado';

export const ROTULO_DO_ESTADO: Record<EstadoDaConexao, string> = {
  sem_conexao: 'Sem conexão',
  incompleta: 'Incompleta',
  com_erro: 'Com erro',
  conectado: 'Conectado',
};

/**
 * O que é preciso para o motor da F8 ter o que coletar.
 *
 * O ORGÂNICO E O PAGO SÃO INDEPENDENTES
 *   Cliente que só faz orgânico não tem conta de anúncio, e isso **não é**
 *   conexão incompleta — é o contrato dele. Exigir os dois marcaria de vermelho
 *   metade da carteira por uma falta que não existe.
 *
 *   Então "conectado" é: tem ao menos UM ativo que rende coleta — Instagram
 *   (orgânico) ou conta de anúncio (pago). A BM e a página são contexto, não
 *   fonte.
 */
const RENDEM_COLETA: readonly TipoDeAtivo[] = ['instagram_account', 'ad_account'];

export function estadoDaConexao(ativos: readonly Ativo[]): EstadoDaConexao {
  const ligados = ativos.filter((a) => a.isActive);
  if (ligados.length === 0) return 'sem_conexao';

  // Erro vence "conectado": o dado parou de chegar, e é isso que a tela precisa
  // gritar. Um ativo saudável ao lado não conserta o que quebrou.
  if (ligados.some((a) => a.lastError !== null)) return 'com_erro';

  return ligados.some((a) => RENDEM_COLETA.includes(a.kind)) ? 'conectado' : 'incompleta';
}

export type ResumoDasConexoes = Record<EstadoDaConexao, number> & { total: number };

export function resumirConexoes(
  porCliente: ReadonlyArray<readonly Ativo[]>,
): ResumoDasConexoes {
  const r: ResumoDasConexoes = {
    total: porCliente.length,
    sem_conexao: 0,
    incompleta: 0,
    com_erro: 0,
    conectado: 0,
  };
  for (const ativos of porCliente) r[estadoDaConexao(ativos)] += 1;
  return r;
}

/* ─────────────────────── o estado de uma conta na área Meta ─────────────────────── */

/**
 * O que a linha de uma conta diz sobre a COLETA dela — F14 do plano UX.
 *
 * Eram um selo colorido e uma frase solta: a cor decidia sozinha entre "em
 * dia", "atrasada" e "falhou", e a conta desligada só ficava mais clara. Aqui
 * cada caso tem nome, e a tela escreve o nome — a cor acompanha, não decide.
 *
 * A ORDEM É A DO QUE MAIS PESA
 *   Inativa vem antes de tudo: não é mais coletada, e um erro antigo nela não
 *   é alarme. Depois a falha, que vence qualquer série — o dado parou de
 *   chegar. Sem nenhum dia coletado é "sem coleta", que é diferente de "zero".
 */
export type EstadoDaConta = 'inativa' | 'falha' | 'sem_coleta' | 'sem_registro' | 'atrasada' | 'em_dia';

export const ROTULO_DA_CONTA: Record<EstadoDaConta, string> = {
  inativa: 'Inativa',
  falha: 'Última coleta falhou',
  sem_coleta: 'Sem coleta',
  sem_registro: 'Sem registro da última coleta',
  atrasada: 'Coleta atrasada',
  em_dia: 'Coleta em dia',
};

export function estadoDaConta(
  c: { isActive: boolean; lastError: string | null; lastSeenAt: string | null; diasColetados: number },
  agora = new Date(),
): EstadoDaConta {
  if (!c.isActive) return 'inativa';
  if (c.lastError !== null && c.lastError !== '') return 'falha';
  if (c.diasColetados <= 0) return 'sem_coleta';
  const saude = saudeDaColeta(c.lastSeenAt, agora);
  if (saude === 'nunca_coletou') return 'sem_registro';
  return saude === 'atrasado' ? 'atrasada' : 'em_dia';
}
