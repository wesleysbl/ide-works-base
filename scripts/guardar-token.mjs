/**
 * Guarda um token da Meta em `.dev.vars`, sem ele passar por lugar nenhum.
 *
 * POR QUE ISTO EXISTE, E NAO "e so editar o arquivo"
 *   Editar a mao falhou tres vezes seguidas, e por motivos que nao aparecem na
 *   tela:
 *
 *     1. O arquivo NAO TERMINA COM QUEBRA DE LINHA. `Add-Content` do PowerShell
 *        emenda o texto no fim da ultima linha em vez de criar uma nova — o
 *        token vira parte do valor anterior, e os dois se perdem juntos.
 *     2. Ha mais de um `.dev.vars` na maquina (este e o do dashboard
 *        financeiro). Salvar na aba errada nao da erro nenhum.
 *     3. Colar num editor deixa o token no buffer ate alguem salvar, e um
 *        arquivo "salvo" que continua sem a linha nao avisa ninguem.
 *
 *   Este script resolve os tres: ele sabe qual arquivo e, conserta a quebra de
 *   linha que falta, e CONFERE se o token responde antes de gravar.
 *
 * O TOKEN NAO APARECE
 *   Nao ecoa enquanto se digita, nao entra no historico do terminal, nao sai na
 *   saida e nao vai para log. O que se imprime e de quem ele e, nunca ele.
 *
 * USO
 *   node scripts/guardar-token.mjs IDEWORKS_META_TOKEN_ALMA9
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARQUIVO = join(RAIZ, '.dev.vars');
const GRAPH = 'https://graph.facebook.com/v21.0';

const VARIAVEL = process.argv[2];
if (!VARIAVEL || !/^[A-Z][A-Z0-9_]{0,63}$/.test(VARIAVEL)) {
  console.error('Uso: node scripts/guardar-token.mjs NOME_DA_VARIAVEL');
  console.error('  ex: node scripts/guardar-token.mjs IDEWORKS_META_TOKEN_ALMA9');
  process.exit(1);
}

/** Le uma linha sem ecoar. O token e longo; ver ele na tela nao ajuda ninguem. */
function perguntarEmSilencio(pergunta) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Enquanto `mudo` estiver ligado, nada do que se digita e reimpresso.
    let mudo = false;
    rl._writeToOutput = (texto) => {
      if (!mudo) rl.output.write(texto);
    };
    rl.question(pergunta, (resposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(resposta.trim());
    });
    mudo = true;
  });
}

const token = await perguntarEmSilencio(`Cole o token para ${VARIAVEL} (nao vai aparecer): `);

/* --- o que da para recusar antes de gastar uma chamada --------------------- */
if (token === '') {
  console.error('\n✗ Nada foi colado. Nada gravado.');
  process.exit(1);
}
if (/\s/.test(token)) {
  console.error('\n✗ O que foi colado tem espaco ou quebra de linha no meio.');
  console.error('  Token da Meta e uma sequencia continua. Copie de novo, inteiro.');
  process.exit(1);
}
if (token.length < 50) {
  console.error(`\n✗ Curto demais (${token.length} caracteres) para ser um token da Meta.`);
  process.exit(1);
}

/* --- ele responde? --------------------------------------------------------- */
// Conferir ANTES de gravar. Gravar um token morto deixa o sistema parecendo
// configurado, e a falha so aparece na proxima coleta — longe daqui.
console.log('\nConferindo com a Meta antes de gravar…');
let dono;
try {
  const r = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
  const corpo = await r.json();
  if (corpo.error) throw new Error(corpo.error.message);
  dono = corpo;
} catch (e) {
  console.error(`✗ A Meta recusou este token — ${e.message}`);
  console.error('  Nada foi gravado.');
  process.exit(1);
}
console.log(`  ✓ responde — ${dono.name ?? '(sem nome)'} · id ${dono.id}`);

/* --- gravar, consertando a quebra de linha que falta ----------------------- */
const original = readFileSync(ARQUIVO, 'utf8');
const linhas = original.split('\n');
const indice = linhas.findIndex((l) => l.startsWith(VARIAVEL + '='));

let novo;
if (indice >= 0) {
  linhas[indice] = `${VARIAVEL}=${token}`;
  novo = linhas.join('\n');
  console.log(`  ✓ ${VARIAVEL} substituido (linha ${indice + 1})`);
} else {
  // A EMENDA QUE DERRUBOU AS TENTATIVAS ANTERIORES: sem esta quebra, a linha
  // nova cola no fim da anterior e as duas viram lixo.
  const fim = original.endsWith('\n') ? '' : '\n';
  novo = `${original}${fim}${VARIAVEL}=${token}\n`;
  console.log(`  ✓ ${VARIAVEL} acrescentado no fim`);
}
writeFileSync(ARQUIVO, novo, 'utf8');

/* --- e le de volta, porque "gravei" nao e "esta la" ------------------------ */
const conferido = readFileSync(ARQUIVO, 'utf8')
  .split('\n')
  .find((l) => l.startsWith(VARIAVEL + '='));
if ((conferido ?? '').slice(VARIAVEL.length + 1) !== token) {
  console.error('✗ Gravou mas nao leu de volta igual. Nao confie; confira o arquivo.');
  process.exit(1);
}

console.log(`\n=== ${VARIAVEL} guardado em .dev.vars ===`);
console.log('Proximo passo:');
console.log(`  node scripts/conferir-token-meta.mjs ${VARIAVEL}\n`);
