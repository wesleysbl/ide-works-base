/**
 * Camada única de leitura de configuração — etapa F0.3.
 *
 * POR QUE ISTO EXISTE
 *   O IDE Works divide o projeto de banco com o Sistema IDE em produção
 *   (decisão D8). O schema `public` tem 91 clientes reais e o financeiro da
 *   agência. Nada aqui pode alcançá-lo.
 *
 *   No sistema legado não havia noção de ambiente: o endereço e a chave do banco
 *   de produção estavam escritos direto no código do cliente, e a configuração
 *   da suíte de testes registra, em comentário próprio, que os testes de
 *   segurança faziam chamadas reais contra produção.
 *
 * A REGRA
 *   Nada no resto do código lê variável de ambiente. Tudo passa por aqui.
 *   E aqui recusa alto: sem valor padrão, sem degradar, sem seguir em frente.
 */

/** O único schema onde o IDE Works pode operar. */
export const WORK_SCHEMA = 'ideworks' as const;

/**
 * Schemas que pertencem a outro dono neste mesmo banco. Mencioná-los é erro,
 * não configuração.
 */
export const FOREIGN_SCHEMAS = ['public', 'auth', 'storage', 'graphql_public'] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type Env = Readonly<{
  dbSchema: typeof WORK_SCHEMA;
  supabaseUrl: string;
  supabaseAnonKey: string;
}>;

type Source = Record<string, string | undefined>;

function required(source: Source, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(
      `Configuração ausente: ${key}. ` +
        'Copie .env.example para .env e preencha. ' +
        'Não existe valor padrão de propósito — foi assumindo padrão em silêncio ' +
        'que o sistema legado acabou com produção embutida no código.',
    );
  }
  return value.trim();
}

/**
 * Lê e valida a configuração. Lança `ConfigError` em vez de devolver algo
 * parcialmente válido.
 */
export function readEnv(source: Source): Env {
  const dbSchema = required(source, 'IDEWORKS_PUBLIC_DB_SCHEMA');

  if (dbSchema !== WORK_SCHEMA) {
    const extra = (FOREIGN_SCHEMAS as readonly string[]).includes(dbSchema)
      ? ` O schema "${dbSchema}" pertence a outro sistema neste mesmo banco — ` +
        'o Sistema IDE, que está em produção com 91 clientes reais.'
      : '';
    throw new ConfigError(
      `Schema de trabalho inválido: "${dbSchema}". ` +
        `O IDE Works só opera em "${WORK_SCHEMA}".${extra} ` +
        'Corrija IDEWORKS_PUBLIC_DB_SCHEMA no seu .env.',
    );
  }

  const supabaseUrl = required(source, 'IDEWORKS_PUBLIC_SUPABASE_URL');
  if (!/^https:\/\/[^\s/]+$/.test(supabaseUrl)) {
    throw new ConfigError(
      `Endereço de banco inválido: "${supabaseUrl}". ` +
        'Esperado algo como https://projeto.supabase.co, sem barra no fim.',
    );
  }

  return Object.freeze({
    dbSchema: WORK_SCHEMA,
    supabaseUrl,
    supabaseAnonKey: required(source, 'IDEWORKS_PUBLIC_SUPABASE_ANON_KEY'),
  });
}

/**
 * Recusa qualquer comando que mencione schema de outro dono.
 *
 * É rede de cima, não a garantia. A garantia é o papel de banco `ideworks_app`
 * da etapa F0.2b, que fisicamente não alcança `public`. Esta função existe para
 * dar mensagem legível antes de o banco recusar com um erro cru.
 *
 * @param sql       o comando a inspecionar
 * @param migrating true apenas na migração de cadastro (F11), único momento em
 *                  que ler `public` é legítimo. Escrita segue proibida sempre.
 */
export function assertStaysInOurSchema(sql: string, migrating = false): void {
  const withoutComments = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  for (const schema of FOREIGN_SCHEMAS) {
    const mentions = new RegExp(`\\b${schema}\\s*\\.`, 'i').test(withoutComments);
    if (!mentions) continue;

    const readOnly = /^\s*(select|with)\b/i.test(withoutComments);
    if (migrating && schema === 'public' && readOnly) continue;

    throw new ConfigError(
      `Comando recusado: menciona o schema "${schema}", que não pertence ao IDE Works. ` +
        `Só é permitido operar em "${WORK_SCHEMA}".` +
        (schema === 'auth'
          ? ' O schema auth é COMPARTILHADO com o Sistema IDE: o IDE Works nunca cria nem apaga usuário.'
          : ''),
    );
  }
}
