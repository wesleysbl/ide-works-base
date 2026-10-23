/**
 * Autoriza o app do Dropbox na conta da agência e devolve o refresh token —
 * F42 Fase 2.
 *
 * POR QUE EXISTE
 *   O Dropbox só entrega o refresh token (o crachá que não vence) trocando um
 *   código de uso único, com `token_access_type=offline`. Fazer isso à mão é
 *   montar dois endereços e um curl com quatro campos. Aqui é: abrir o
 *   endereço impresso, clicar em Permitir, colar o código.
 *
 * DE ONDE VÊM A CHAVE E O SEGREDO DO APP
 *   De `.dev.vars` (ou `.env`): IDEWORKS_DROPBOX_APP_KEY e
 *   IDEWORKS_DROPBOX_APP_SECRET. O tutorial (`docs/tutoriais/dropbox.md`) manda
 *   gravar as duas lá antes de rodar isto.
 *
 * O QUE ELE NÃO FAZ
 *   Não grava nada em lugar nenhum. Imprime o refresh token e as duas linhas
 *   para gravar (no `.dev.vars` e no Worker). O código colado vale uma vez só e
 *   por poucos minutos; se der erro, rode de novo e gere outro.
 *
 * USO
 *   node scripts/dropbox-autorizar.mjs            # pergunta o código
 *   node scripts/dropbox-autorizar.mjs <código>   # já com o código
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
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

const env = { ...ler('.env'), ...ler('.dev.vars'), ...process.env };
const appKey = (env.IDEWORKS_DROPBOX_APP_KEY ?? '').trim();
const appSecret = (env.IDEWORKS_DROPBOX_APP_SECRET ?? '').trim();

const faltando = [
  ['IDEWORKS_DROPBOX_APP_KEY', appKey],
  ['IDEWORKS_DROPBOX_APP_SECRET', appSecret],
]
  .filter(([, v]) => v === '')
  .map(([n]) => n);

if (faltando.length > 0) {
  console.error('\n✗ Falta no .dev.vars: ' + faltando.join(' e ') + '.');
  console.error('  Copie do App Console do Dropbox (aba Settings, "App key" e "App secret")');
  console.error('  e grave assim, uma por linha, no arquivo .dev.vars da pasta do Ide Work:\n');
  console.error('    IDEWORKS_DROPBOX_APP_KEY=...');
  console.error('    IDEWORKS_DROPBOX_APP_SECRET=...\n');
  console.error('  Depois rode este comando de novo. (Tutorial: docs/tutoriais/dropbox.md, passo 3.)\n');
  process.exit(1);
}

const autorizar = new URL('https://www.dropbox.com/oauth2/authorize');
autorizar.searchParams.set('client_id', appKey);
autorizar.searchParams.set('response_type', 'code');
// `offline` é o que faz o Dropbox devolver o refresh token, e não só um crachá de 4 h.
autorizar.searchParams.set('token_access_type', 'offline');

let codigo = (process.argv[2] ?? '').trim();

if (codigo === '') {
  console.log('\n=== Autorizar o Ide Works no Dropbox ===\n');
  console.log('1. Abra este endereço no navegador, logado na conta do Dropbox DA AGÊNCIA:\n');
  console.log('   ' + autorizar.toString() + '\n');
  console.log('2. Clique em "Continuar" e depois em "Permitir".');
  console.log('3. O Dropbox mostra um código. Copie e cole aqui embaixo.\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  codigo = (await rl.question('Código: ')).trim();
  rl.close();
}

if (codigo === '') {
  console.error('\n✗ Nenhum código colado. Rode de novo.\n');
  process.exit(1);
}

const resposta = await fetch('https://api.dropboxapi.com/oauth2/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: codigo,
    client_id: appKey,
    client_secret: appSecret,
  }).toString(),
}).catch((e) => {
  console.error('\n✗ Não deu para falar com o Dropbox: ' + e.message + '\n');
  process.exit(1);
});

const dados = await resposta.json().catch(() => ({}));

if (!resposta.ok || !dados.refresh_token) {
  console.error('\n✗ O Dropbox recusou o código: ' + (dados.error_description ?? dados.error ?? resposta.status));
  if (dados.error === 'invalid_grant') {
    console.error('  O código já foi usado ou venceu. Rode de novo e use um código novo.');
  } else if (dados.error === 'invalid_client' || resposta.status === 401) {
    console.error('  A chave ou o segredo do app no .dev.vars não batem com o App Console.');
  }
  console.error('');
  process.exit(1);
}

console.log('\n✓ Autorizado. Conta: ' + (dados.account_id ?? '(sem id)'));
console.log('  Permissões concedidas: ' + (dados.scope ?? '(o Dropbox não informou)'));
console.log('\nO refresh token (não vence; guarde só nos dois lugares abaixo):\n');
console.log('  ' + dados.refresh_token + '\n');
console.log('Grave assim no .dev.vars (uma linha):\n');
console.log('  IDEWORKS_DROPBOX_REFRESH_TOKEN=' + dados.refresh_token + '\n');
console.log('E no Worker publicado (o comando pede o valor; cole o token):\n');
console.log('  npx wrangler secret put IDEWORKS_DROPBOX_REFRESH_TOKEN\n');
