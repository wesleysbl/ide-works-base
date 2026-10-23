import { describe, expect, it } from 'vitest';

import { ConfigError, assertStaysInOurSchema, readEnv } from '@/config/env';

const valido = {
  IDEWORKS_PUBLIC_DB_SCHEMA: 'ideworks',
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://exemplo.supabase.co',
  IDEWORKS_PUBLIC_SUPABASE_ANON_KEY: 'chave-de-teste',
};

describe('readEnv — a trava de schema (F0.3)', () => {
  it('aceita configuração válida', () => {
    const env = readEnv(valido);
    expect(env.dbSchema).toBe('ideworks');
    expect(env.supabaseUrl).toBe('https://exemplo.supabase.co');
  });

  it('recusa o schema do sistema legado, e diz de quem ele é', () => {
    const erro = () => readEnv({ ...valido, IDEWORKS_PUBLIC_DB_SCHEMA: 'public' });
    expect(erro).toThrow(ConfigError);
    expect(erro).toThrow(/"public"/);
    expect(erro).toThrow(/Sistema IDE/);
    expect(erro).toThrow(/91 clientes reais/);
  });

  it('recusa o schema de autenticação, que é compartilhado', () => {
    expect(() => readEnv({ ...valido, IDEWORKS_PUBLIC_DB_SCHEMA: 'auth' })).toThrow(ConfigError);
  });

  it('recusa qualquer schema que não seja o nosso, nomeando o detectado', () => {
    const erro = () => readEnv({ ...valido, IDEWORKS_PUBLIC_DB_SCHEMA: 'ideworks_v2' });
    expect(erro).toThrow(/"ideworks_v2"/);
  });

  it.each([
    'IDEWORKS_PUBLIC_DB_SCHEMA',
    'IDEWORKS_PUBLIC_SUPABASE_URL',
    'IDEWORKS_PUBLIC_SUPABASE_ANON_KEY',
  ])('recusa configuração ausente, nomeando a variável que falta: %s', (chave) => {
    const erro = () => readEnv({ ...valido, [chave]: undefined });
    expect(erro).toThrow(ConfigError);
    expect(erro).toThrow(new RegExp(chave));
  });

  it('trata string vazia como ausente — não como valor', () => {
    expect(() => readEnv({ ...valido, IDEWORKS_PUBLIC_SUPABASE_URL: '   ' })).toThrow(ConfigError);
  });

  it('nunca assume valor padrão: fonte vazia falha', () => {
    expect(() => readEnv({})).toThrow(ConfigError);
  });

  it('recusa endereço malformado', () => {
    expect(() =>
      readEnv({ ...valido, IDEWORKS_PUBLIC_SUPABASE_URL: 'http://exemplo.supabase.co' }),
    ).toThrow(ConfigError);
  });

  it('devolve objeto congelado — configuração não se altera em tempo de execução', () => {
    const env = readEnv(valido) as { dbSchema: string };
    expect(() => {
      env.dbSchema = 'public';
    }).toThrow();
  });
});

describe('assertStaysInOurSchema — a fronteira com o legado', () => {
  it('deixa passar comando no nosso schema', () => {
    expect(() => assertStaysInOurSchema('select * from ideworks.profiles')).not.toThrow();
  });

  it.each([
    ['leitura do legado', 'select * from public.clients'],
    ['escrita no legado', 'update public.clients set name = 1'],
    ['exclusão no legado', 'delete from public.weekly_progress'],
    ['leitura de usuários', 'select * from auth.users'],
    ['exclusão de usuários', 'delete from auth.users where id = 1'],
    ['espaço antes do ponto', 'select * from public . clients'],
    ['maiúsculas', 'SELECT * FROM PUBLIC.CLIENTS'],
  ])('recusa %s', (_nome, sql) => {
    expect(() => assertStaysInOurSchema(sql)).toThrow(ConfigError);
  });

  it('avisa que o schema de autenticação é compartilhado', () => {
    expect(() => assertStaysInOurSchema('select * from auth.users')).toThrow(/COMPARTILHADO/);
  });

  it('não se engana com o schema mencionado apenas em comentário', () => {
    expect(() =>
      assertStaysInOurSchema('-- nao mexer em public.clients\nselect 1 from ideworks.profiles'),
    ).not.toThrow();
  });

  it('permite leitura do legado apenas no modo de migração (F11)', () => {
    expect(() => assertStaysInOurSchema('select id from public.clients', true)).not.toThrow();
  });

  it('nem no modo de migração permite ESCRITA no legado', () => {
    expect(() => assertStaysInOurSchema('update public.clients set name = 1', true)).toThrow(
      ConfigError,
    );
  });

  it('nem no modo de migração permite tocar em usuários', () => {
    expect(() => assertStaysInOurSchema('select * from auth.users', true)).toThrow(ConfigError);
  });
});
