#!/usr/bin/env node
/**
 * LIMPA OS CLIENTES OAUTH DE PROVA DO KV PUBLICADO — F44, Fase 9.
 *
 * O QUE ERA
 *   Antes da troca de KV, a prova de agente registrava um cliente OAuth
 *   ("Cliente de integração", retorno `https://agent.test/callback`) no KV
 *   PUBLICADO, sem prazo (ver o comentário em `src/integrations/handler.test.ts`).
 *   Lixo que ninguém usa e que aparece na lista de clientes registrados.
 *
 * O QUE APAGA — E SÓ ISTO
 *   Chave `client:*` do namespace `OAUTH_KV` cujo valor tem NOME exatamente
 *   "Cliente de integração" **E** todo endereço de retorno no host `agent.test`.
 *   Nome parecido com retorno real NÃO entra; retorno de prova com outro nome
 *   NÃO entra. Valor que não é JSON ou não tem a forma esperada é ignorado.
 *
 * MODOS
 *   --relatorio   (padrão) só lê e lista. Não grava nada.
 *   --aplicar     apaga as chaves listadas pelo relatório.
 *
 * Usa o `wrangler` logado. O valor guardado pode trazer `client_secret`/hash:
 * ele é lido e descartado, NUNCA impresso.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOME_DE_PROVA = 'Cliente de integração';
const HOST_DE_PROVA = 'agent.test';

/** O id do namespace `OAUTH_KV`, lido do `wrangler.toml` (única fonte). */
export function idDoNamespace(toml) {
  const bloco = toml.split('[[kv_namespaces]]')[1] ?? '';
  const binding = /binding\s*=\s*"OAUTH_KV"/.exec(bloco);
  const id = /id\s*=\s*"([0-9a-f]{32})"/.exec(bloco);
  if (!binding || !id) throw new Error('namespace OAUTH_KV não encontrado no wrangler.toml');
  return id[1];
}

/** Valor (texto) de uma chave `client:*` → é cliente de prova? Nome E retorno. */
export function ehClienteDeProva(texto) {
  let valor;
  try {
    valor = JSON.parse(texto);
  } catch {
    return false;
  }
  if (!valor || typeof valor !== 'object') return false;
  if (valor.clientName !== NOME_DE_PROVA) return false;
  const retornos = valor.redirectUris;
  if (!Array.isArray(retornos) || retornos.length === 0) return false;
  return retornos.every((u) => {
    try {
      return new URL(u).hostname === HOST_DE_PROVA;
    } catch {
      return false;
    }
  });
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function principal() {
  const aplicar = process.argv.includes('--aplicar');
  const id = idDoNamespace(readFileSync(join(RAIZ, 'wrangler.toml'), 'utf8'));
  const base = ['kv', 'key'];
  const alvo = ['--namespace-id', id, '--remote'];

  const lista = JSON.parse(wrangler([...base, 'list', ...alvo, '--prefix', 'client:']));
  const chaves = lista.map((k) => k.name).filter((n) => n.startsWith('client:'));

  // Leitura EM LOTE (`kv bulk get`, 100 chaves por chamada): uma chamada por
  // chave levava ~3 s cada, e o namespace publicado tem milhares de clientes.
  const pasta = mkdtempSync(join(tmpdir(), 'kv-prova-'));
  const deProva = [];
  let semelhantes = 0;
  const naoLidas = [];
  try {
    for (let i = 0; i < chaves.length; i += 100) {
      const lote = chaves.slice(i, i + 100);
      const arquivo = join(pasta, `lote-${i}.json`);
      writeFileSync(arquivo, JSON.stringify(lote));
      let saida;
      try {
        const bruto = wrangler([...base.slice(0, 1), 'bulk', 'get', arquivo, ...alvo]);
        saida = JSON.parse(bruto.slice(bruto.indexOf('{')));
      } catch (erro) {
        for (const c of lote) naoLidas.push(`${c}: ${String(erro.message).split('\n')[0].slice(0, 120)}`);
        continue;
      }
      for (const chave of lote) {
        const valor = saida[chave];
        if (valor === null || valor === undefined) {
          naoLidas.push(`${chave}: sem valor (expirou entre a listagem e a leitura?)`);
          continue;
        }
        const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
        if (ehClienteDeProva(texto)) deProva.push(chave);
        else {
          try {
            if (JSON.parse(texto)?.clientName === NOME_DE_PROVA) semelhantes += 1;
          } catch {
            /* não é JSON: ignorada */
          }
        }
      }
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }

  console.log(`namespace OAUTH_KV (${id}) — modo ${aplicar ? '--aplicar' : '--relatorio'}`);
  console.log(`chaves client:* no total: ${chaves.length}`);
  console.log(`de prova (nome + retorno em ${HOST_DE_PROVA}): ${deProva.length}`);
  console.log(`com o mesmo nome mas retorno real (NÃO serão apagadas): ${semelhantes}`);
  console.log(`não lidas (ficam de fora): ${naoLidas.length}`);
  for (const n of naoLidas) console.log(`  ${n}`);
  // Lista só as primeiras: o lixo passa de dois mil e o relatório tem de caber na tela.
  for (const c of deProva.slice(0, 5)) console.log(`  ${aplicar ? 'apagando' : 'apagaria'} ${c}`);
  if (deProva.length > 5) console.log(`  … e mais ${deProva.length - 5}`);

  if (!aplicar) {
    console.log('Nada foi apagado. Rode com --aplicar para remover as chaves de prova.');
    return;
  }
  // Apaga em lote (`kv bulk delete`), 100 por vez. `--force` pula o "tem certeza?".
  const pastaDeApagar = mkdtempSync(join(tmpdir(), 'kv-prova-apagar-'));
  try {
    for (let i = 0; i < deProva.length; i += 100) {
      const arquivo = join(pastaDeApagar, `apagar-${i}.json`);
      writeFileSync(arquivo, JSON.stringify(deProva.slice(i, i + 100)));
      wrangler(['kv', 'bulk', 'delete', arquivo, ...alvo, '--force']);
    }
  } finally {
    rmSync(pastaDeApagar, { recursive: true, force: true });
  }
  console.log(`apagadas: ${deProva.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((erro) => {
    console.error(String(erro?.message ?? erro).split('\n')[0]);
    process.exit(1);
  });
}
