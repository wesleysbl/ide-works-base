/**
 * Trilha de auditoria administrativa — etapa F1.8.
 *
 * TRÊS DECISÕES QUE FAZEM O LIVRO VALER
 *
 *   a) Guarda cópias, não atalhos.
 *      O e-mail do alvo vai em texto, não como referência a outra tabela. Quando
 *      a conta é excluída, a referência apontaria para o nada. O livro precisa
 *      continuar legível **depois** de o mundo ao redor ter mudado.
 *
 *   b) Nem o próprio administrador reescreve.
 *      A gravação usa a chave-mestra, e a tabela não tem permissão de escrita
 *      para usuário logado nenhum — nem de topo. Um livro que o próprio
 *      auditado edita não é livro. (A regra vive nas políticas do schema; aqui
 *      fica o que se grava.)
 *
 *   c) Segredo nunca entra.
 *      O filtro abaixo varre o que vai ser gravado e **descarta** qualquer campo
 *      cujo nome sugira segredo. É recursivo — pega segredo escondido dentro de
 *      outro objeto — e **apaga em vez de mascarar**: nem asterisco, nem
 *      tamanho, porque saber que "tinha nove caracteres" já ajuda quem procura.
 *      O nome do campo barrado vai para o registro, para virar sinal de defeito
 *      em vez de sumir calado.
 *
 * FALHA PARA O LADO CERTO
 *   Se a gravação falhar, **a ação acontece mesmo assim** e o erro é gritado. A
 *   alternativa — "não consigo registrar, então não faço" — transformaria uma
 *   migration pendente em sistema quebrado. A ação é o que a pessoa pediu; o
 *   registro é o extra. Mas a falha nunca é engolida.
 */

export type AuditAction =
  | 'account_created'
  /**
   * A conta JÁ EXISTIA e só ganhou acesso ao IDE Works — F17.30.
   *
   * Fato diferente de `account_created`, e por isso palavra diferente: uma
   * criou conta no cadastro que o Sistema IDE compartilha, a outra apenas deu
   * acesso a quem já entrava por ele, sem tocar em senha nenhuma. Registrar as
   * duas com o mesmo nome faria quem auditar acreditar em contas que este
   * projeto nunca criou.
   */
  | 'account_linked'
  | 'superadmin_created'
  | 'account_password_reset'
  | 'account_disabled'
  | 'account_reactivated'
  | 'account_deleted';

export type AuditEntry = {
  action: AuditAction;
  actorId: string;
  actorEmail: string;
  targetId?: string;
  /** Em texto, de propósito. Ver decisão (a). */
  targetEmail?: string;
  context?: Record<string, unknown>;
};

/**
 * Nomes que denunciam segredo. Comparação sem acento e sem caixa.
 *
 * Em duas línguas, de propósito. A primeira versão desta lista só tinha
 * `credential`, em inglês, e deixou passar um campo chamado `credenciais` — o
 * conteúdo dele só não vazou porque a chave interna se chamava `token`. Num
 * sistema cuja interface é em português, lista só em inglês é meia lista.
 */
const SECRET_HINTS = [
  // inglês
  'password',
  'code',
  'token',
  'hash',
  'key',
  'secret',
  'credential',
  'authorization',
  // português
  'senha',
  'codigo',
  'chave',
  'credencia',
  'segredo',
];

function looksSecret(name: string): boolean {
  const plain = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  return SECRET_HINTS.some((hint) => plain.includes(hint));
}

export type Redaction = { clean: Record<string, unknown>; dropped: string[] };

/**
 * Remove do contexto tudo que parece segredo, em profundidade.
 *
 * Devolve também os nomes descartados, para irem ao registro — um campo barrado
 * costuma ser sinal de que alguém está passando adiante algo que não deveria.
 */
export function redactSecrets(value: unknown, path = ''): Redaction {
  const dropped: string[] = [];

  const walk = (input: unknown, trail: string): unknown => {
    if (Array.isArray(input)) return input.map((item, i) => walk(item, `${trail}[${i}]`));

    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
        const here = trail ? `${trail}.${key}` : key;
        if (looksSecret(key)) {
          dropped.push(here);
          continue; // apaga, não mascara
        }
        out[key] = walk(val, here);
      }
      return out;
    }

    return input;
  };

  const clean = walk(value, path) as Record<string, unknown>;
  return { clean: clean ?? {}, dropped };
}

export type AuditPorts = {
  /** Grava com a chave-mestra. Ver decisão (b). */
  append(entry: AuditEntry): Promise<void>;
  /** Grita a falha. Silêncio aqui apagaria o sinal junto com o erro. */
  reportFailure(context: string, error: unknown): void;
  /** Registra nomes de campo barrados, para virarem sinal de defeito. */
  reportRedaction(action: AuditAction, dropped: string[]): void;
};

/**
 * Grava uma decisão administrativa. **Nunca lança**: falha para o lado certo.
 * Devolve `false` quando não conseguiu registrar, para quem chama saber — mas a
 * ação em curso segue.
 */
export async function recordAdminAction(
  entry: AuditEntry,
  ports: AuditPorts,
): Promise<boolean> {
  const { clean, dropped } = redactSecrets(entry.context ?? {});
  if (dropped.length > 0) ports.reportRedaction(entry.action, dropped);

  try {
    await ports.append({ ...entry, context: clean });
    return true;
  } catch (error) {
    ports.reportFailure(`auditoria falhou ao gravar "${entry.action}"`, error);
    return false;
  }
}
