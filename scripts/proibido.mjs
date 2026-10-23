/**
 * Procura padrões proibidos **no código executável**, ignorando comentários.
 *
 * POR QUE ISTO EXISTE
 *   Cinco vezes ao longo deste projeto uma verificação minha por `grep` acusou
 *   falso positivo batendo no **comentário que explicava a ausência** da coisa
 *   proibida. Os casos:
 *
 *     - "nenhum segredo na auditoria" bateu no nome da ação `account_password_reset`
 *     - "não há rota de solicitação de acesso" bateu no comentário que dizia isso
 *     - "o crachá não vai para localStorage" bateu na explicação de por que não vai
 *
 *   Verificação que não distingue código de prosa não verifica nada. Pior: ela
 *   falha quando o código está certo, e ensina a ignorar falha.
 *
 * USO
 *   node scripts/proibido.mjs "<regex>" <arquivo-ou-pasta>...
 *
 *   Sai com 1 e lista as ocorrências quando encontra algo em código executável.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const EXTENSOES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function arquivos(alvo) {
  const info = statSync(alvo);
  if (!info.isDirectory()) return [alvo];
  return readdirSync(alvo, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.wrangler') return [];
    const cheio = join(alvo, e.name);
    return e.isDirectory() ? arquivos(cheio) : EXTENSOES.has(extname(e.name)) ? [cheio] : [];
  });
}

/**
 * Substitui comentários por espaços, preservando as quebras de linha para o
 * número da linha continuar batendo com o arquivo original.
 *
 * Não é um analisador de verdade: uma sequência que pareça comentário dentro de
 * um texto entre aspas seria removida também. Para o que isto faz — procurar
 * padrão proibido — errar para o lado de remover demais é o lado seguro: no
 * máximo deixa passar, nunca acusa falso positivo.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, antes) => antes + ' '.repeat(m.length - antes.length));
}

const [padrao, ...alvos] = process.argv.slice(2);
if (!padrao || alvos.length === 0) {
  console.error('uso: node scripts/proibido.mjs "<regex>" <arquivo-ou-pasta>...');
  process.exit(2);
}

const regex = new RegExp(padrao);
const achados = [];

for (const alvo of alvos) {
  for (const arquivo of arquivos(alvo)) {
    const linhas = semComentarios(readFileSync(arquivo, 'utf8')).split('\n');
    linhas.forEach((linha, i) => {
      if (regex.test(linha)) achados.push(`${arquivo}:${i + 1}: ${linha.trim().slice(0, 100)}`);
    });
  }
}

if (achados.length > 0) {
  console.error(`padrão proibido encontrado em código executável (${achados.length}):`);
  for (const a of achados) console.error(`  ${a}`);
  process.exit(1);
}
process.exit(0);
