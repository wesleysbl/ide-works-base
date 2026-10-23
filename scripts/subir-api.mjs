/**
 * Sobe a API em desenvolvimento.
 *
 * POR QUE ISTO PRECISA EXISTIR
 *   `npx wrangler dev` sozinho NÃO sobe. Ele recusa com:
 *
 *     When developing locally, you should use a local Postgres connection
 *     string to emulate Hyperdrive functionality.
 *
 *   A credencial do banco mora no Hyperdrive, que é um recurso da Cloudflare e
 *   não existe na máquina. Em desenvolvimento, o wrangler quer a string de
 *   conexão numa variável de ambiente de nome comprido — e esse nome não
 *   estava escrito em lugar nenhum do repositório.
 *
 *   Em 2026-08-21 a máquina do usuário reiniciou, o ambiente caiu, e subir de
 *   volta virou engenharia reversa. Uma vez é acidente; duas seria descuido.
 *
 * A SENHA NÃO É ESCRITA EM DISCO NEM IMPRESSA
 *   A string é montada em memória a partir do `.env` e entregue ao processo
 *   filho pelo ambiente. Não passa por arquivo temporário, não aparece em log,
 *   e não entra em `wrangler.toml` — que é versionado.
 *
 * USO
 *   npm run dev:api
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const ler = (arquivo) => {
  try {
    return Object.fromEntries(
      readFileSync(join(RAIZ, arquivo), 'utf8')
        .split('\n')
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => [
          l.slice(0, l.indexOf('=')).trim(),
          l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, ''),
        ]),
    );
  } catch {
    return {};
  }
};

const env = { ...ler('.env'), ...ler('.dev.vars') };

const faltando = ['IDEWORKS_PUBLIC_SUPABASE_URL', 'IDEWORKS_SERVER_DB_USER', 'IDEWORKS_SERVER_DB_PASSWORD']
  .filter((k) => !env[k]);

if (faltando.length > 0) {
  console.error(
    `Faltam no .env: ${faltando.join(', ')}.\n` +
      'Sem elas a API não sobe, porque o Hyperdrive não existe fora da nuvem.',
  );
  process.exit(1);
}

const ref = env.IDEWORKS_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0];
const host = env.IDEWORKS_SERVER_DB_HOST || 'aws-0-sa-east-1.pooler.supabase.com';
const usuario = encodeURIComponent(`${env.IDEWORKS_SERVER_DB_USER}.${ref}`);
const senha = encodeURIComponent(env.IDEWORKS_SERVER_DB_PASSWORD);

// O nome comprido é o que o wrangler exige: o sufixo é o BINDING declarado no
// wrangler.toml. Renomear o binding lá quebra isto aqui, e o erro que aparece
// não diz isso — por isso o nome é montado a partir da constante.
// O `wrangler dev` recusa subir sem a pasta do site (`[assets]` no wrangler.toml).
// Numa máquina que nunca rodou `npm run build` ela não existe; vazia basta para a API,
// e o site em desenvolvimento é servido pelo Vite na 8080.
if (!existsSync(join(RAIZ, 'dist'))) mkdirSync(join(RAIZ, 'dist'));

const BINDING = 'HYPERDRIVE';

console.log(`API em desenvolvimento — banco: ${ref}, papel: ${env.IDEWORKS_SERVER_DB_USER}`);
console.log('(a senha não é impressa nem gravada em disco)\n');

// A porta padrão é 8787 porque é ela que o proxy do front procura (ver
// `vite.config.ts`). Mas se quem chamou já passou `--port`, não se acrescenta o
// padrão: o wrangler recusa a bandeira repetida, e a mensagem dele é a ajuda
// inteira — cinquenta linhas que não dizem qual foi o problema.
const pediuPorta = process.argv.slice(2).some((a) => a === '--port' || a.startsWith('--port='));
const extras = process.argv.slice(2);

const filho = spawn(
  'npx',
  ['wrangler', 'dev', ...(pediuPorta ? [] : ['--port', '8787']), ...extras],
  {
    cwd: RAIZ,
    stdio: 'inherit',
    // `shell: true` não é enfeite no Windows: `npx` é um `.cmd`, e desde o Node
    // 20 `spawn` recusa arquivo de lote sem shell — com `EINVAL`, que não diz
    // nada sobre a causa. Custou uma depuração; fica escrito.
    shell: true,
    env: {
      ...process.env,
      [`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${BINDING}`]:
        `postgresql://${usuario}:${senha}@${host}:6543/postgres`,
    },
  },
);

filho.on('exit', (codigo) => process.exit(codigo ?? 0));
