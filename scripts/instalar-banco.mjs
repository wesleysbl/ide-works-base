/**
 * INSTALA O BANCO DO IDEWORKS NUM PROJETO DO SUPABASE: aplica as migrations em ordem.
 *
 * É o caminho testado: as migrations de `supabase/migrations/` rodam uma a uma, cada
 * uma na própria transação, e quem já rodou fica registrado na mesma tabela que o
 * Supabase CLI usa (`supabase_migrations.schema_migrations`). Rodar de novo só aplica
 * as que faltam, e serve também para ATUALIZAR depois de puxar código novo.
 *
 * USO
 *   node scripts/instalar-banco.mjs "postgresql://postgres.SEU-PROJETO:SENHA@HOST:5432/postgres"
 *
 *   A string é a do botão "Connect" do Supabase → "Session pooler" (funciona em
 *   qualquer rede). A senha é a do BANCO, definida quando o projeto foi criado, e não é
 *   a do papel `ideworks_app`, que ainda não existe a esta altura.
 *   Também aceita a string na variável IDEWORKS_ADMIN_DB_URL.
 *
 *   --listar   só mostra o que já foi aplicado e o que falta, sem mudar nada.
 *
 * Esta string dá acesso de ADMINISTRADOR ao banco. Ela não vai para o .env, nem para o
 * git, nem para a Cloudflare: use aqui e esqueça.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = join(RAIZ, 'supabase', 'migrations');

const args = process.argv.slice(2);
const soListar = args.includes('--listar');
const url = args.find((a) => !a.startsWith('--')) ?? process.env.IDEWORKS_ADMIN_DB_URL;

if (!url) {
  console.error(
    'Falta a string de conexão de administrador.\n' +
      'Uso: node scripts/instalar-banco.mjs "postgresql://postgres.SEU-PROJETO:SENHA@HOST:5432/postgres"\n' +
      'Supabase → botão Connect → Session pooler. Passo a passo em docs/tutoriais/02-configurar-o-supabase.md',
  );
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
const sql = postgres(url, {
  ssl: local ? false : 'require',
  prepare: false,
  max: 1,
  onnotice: () => {},
});

const arquivos = readdirSync(PASTA)
  .filter((n) => /^\d{14}_.+\.sql$/.test(n))
  .sort();

try {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
  const feitas = new Set(
    (await sql`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
  );
  const faltam = arquivos.filter((n) => !feitas.has(n.slice(0, 14)));

  console.log(`${arquivos.length} migrations no repositório · ${arquivos.length - faltam.length} já aplicadas · ${faltam.length} a aplicar`);
  if (soListar) {
    for (const n of faltam) console.log(`  falta: ${n}`);
    process.exit(0);
  }

  for (const nome of faltam) {
    const versao = nome.slice(0, 14);
    const texto = readFileSync(join(PASTA, nome), 'utf8');
    process.stdout.write(`  ${nome} ... `);
    try {
      // Algumas migrations abrem e fecham a própria transação (`begin;` ... `commit;`).
      // Por isso o arquivo vai inteiro, como o SQL Editor mandaria, e o registro vem
      // logo depois, só se ele passou.
      await sql.unsafe(texto);
      await sql`
        insert into supabase_migrations.schema_migrations (version, name, statements)
        values (${versao}, ${nome.slice(15, -4)}, ${[texto]})
        on conflict (version) do nothing
      `;
      console.log('ok');
    } catch (erro) {
      console.log('FALHOU');
      console.error(`\n${erro.message}`);
      if (erro.where) console.error(erro.where);
      console.error(
        '\nNada desta migration ficou registrado. Corrija e rode de novo: as anteriores não se repetem.',
      );
      process.exit(1);
    }
  }
  console.log(
    faltam.length
      ? '\nBanco pronto. Próximo passo: rodar supabase/primeiro-acesso.sql no SQL Editor.'
      : '\nNada a fazer: o banco já está em dia.',
  );
} finally {
  await sql.end({ timeout: 5 });
}
