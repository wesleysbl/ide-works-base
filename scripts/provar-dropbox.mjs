/**
 * Prova da conexão com o Dropbox — F42 Fase 2.
 *
 * Para um link colado, imprime o que o Worker vai responder: visibilidade,
 * arquivo ou pasta, os arquivos com versão (`rev`) e o endereço de exibição.
 * Se o link não serve para o cliente, imprime a recusa com a MESMA frase que a
 * equipe vai ler na tela.
 *
 * Usa o módulo de verdade (`src/server/dropbox.ts`), não uma cópia: o Node
 * roda o TypeScript removendo os tipos, e o módulo não importa nada.
 *
 * SÓ LEITURA. Nada é criado nem alterado no Dropbox. O refresh token e o
 * crachá nunca são impressos.
 *
 * USO
 *   node scripts/provar-dropbox.mjs <link do Dropbox>
 *   node scripts/provar-dropbox.mjs <link> --baixar   # também pede os 1ºs bytes do 1º arquivo
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { DropboxRecusa, NOMES_DA_VISIBILIDADE, clienteDoDropbox, credenciaisDoDropbox } = await import(
  '../src/server/dropbox.ts'
);

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
const link = process.argv.slice(2).find((a) => !a.startsWith('--'));
const baixar = process.argv.includes('--baixar');

const cred = credenciaisDoDropbox(env);
if (!cred.ok) {
  console.error('\n✗ Faltam segredos do Dropbox em .dev.vars (ou .env):');
  for (const nome of cred.faltando) console.error('    ' + nome);
  console.error('\n  Siga docs/tutoriais/dropbox.md (passos 3 e 4) e rode de novo.\n');
  process.exit(1);
}
if (!link) {
  console.error('\nUso: node scripts/provar-dropbox.mjs <link do Dropbox> [--baixar]\n');
  process.exit(1);
}

const dropbox = clienteDoDropbox(cred.credenciais);
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

console.log('\n=== Prova do Dropbox ===\n');
console.log('Link: ' + link + '\n');

try {
  // 1. O que o Dropbox diz do link, aberto ou não — para ver a visibilidade crua.
  const dados = await dropbox.lerLink(link);
  console.log('Tipo:          ' + dados.tipo);
  console.log('Nome:          ' + dados.nome);
  console.log('Id:            ' + (dados.id ?? '(sem id)'));
  console.log('Visibilidade:  ' + NOMES_DA_VISIBILIDADE[dados.visibilidade] + ` (${dados.visibilidade})`);
  console.log('Download:      ' + (dados.permiteBaixar ? 'permitido' : 'DESLIGADO'));
  if (dados.tipo === 'arquivo') {
    console.log('Versão (rev):  ' + dados.rev);
    console.log('Tamanho:       ' + (dados.tamanho === null ? '?' : mb(dados.tamanho)));
  }

  // 2. A pergunta inteira: serve para o cliente? Quais arquivos, em que versão?
  const r = await dropbox.conferirLink(link);
  console.log('\n✓ Aberto para qualquer pessoa. Arquivos (' + r.arquivos.length + '):\n');
  for (const a of r.arquivos) {
    console.log(`  - ${a.nome}  [${a.midia}]  rev ${a.rev}  ${mb(a.tamanho)}  ${a.id}`);
    console.log(
      '    exibição: ' +
        (a.enderecoDeExibicao ?? `pelo Worker (get_shared_link_file, caminho ${a.caminho})`),
    );
  }
  if (r.subpastasIgnoradas > 0) {
    console.log(`\n  (${r.subpastasIgnoradas} subpasta(s) ignorada(s): a listagem não entra em subpastas)`);
  }

  // 3. Opcional: o repasse de bytes com Range, como a página do cliente vai pedir.
  if (baixar && r.arquivos.length > 0) {
    const a = r.arquivos[0];
    const d = await dropbox.baixarDoLink(link, a.caminho, 'bytes=0-1023');
    const bytes = (await d.resposta.arrayBuffer()).byteLength;
    console.log(
      `\nRepasse de "${a.nome}" com Range bytes=0-1023: status ${d.resposta.status}, ` +
        `${bytes} bytes, Content-Range ${d.resposta.headers.get('Content-Range') ?? '(nenhum)'}, ` +
        `Content-Type ${d.resposta.headers.get('Content-Type')}, rev ${d.rev}`,
    );
  }
  console.log('');
} catch (e) {
  if (e instanceof DropboxRecusa) {
    console.log('\n✗ Recusado (' + e.motivo + '). A equipe lê:\n');
    console.log('  "' + e.message + '"\n');
    if (e.detalhe) console.log('  Detalhe técnico: ' + e.detalhe + '\n');
    process.exit(2);
  }
  throw e;
}
