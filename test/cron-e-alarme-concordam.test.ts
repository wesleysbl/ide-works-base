/**
 * O gatilho e o alarme têm de dizer a mesma coisa.
 *
 * POR QUE ESTE TESTE EXISTE
 *   `MINUTOS_ENTRE_EXECUCOES` decide quando o alarme grita: quatro batidas
 *   perdidas. `crons` no `wrangler.toml` decide quando as batidas acontecem. Os
 *   dois vivem em arquivos diferentes, e nenhum compilador liga um ao outro —
 *   um é TypeScript, o outro é configuração de plataforma.
 *
 *   Se alguém mudar o cron para de hora em hora e esquecer da constante, o
 *   alarme passa a chamar de "parada" uma coleta que está rodando como
 *   combinado. Alarme falso é pior que alarme nenhum: ensina a ignorar.
 *
 *   E na direção oposta é pior ainda — cron mais raro que a constante faz o
 *   alarme achar tudo em dia enquanto a coleta rareia.
 *
 *   O apagão de 2026-08-20 durou catorze horas porque ninguém estava fazendo a
 *   pergunta "quando foi a última execução?". Agora alguém faz — e este teste
 *   garante que a pergunta seja feita no ritmo certo.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MINUTOS_ENTRE_EXECUCOES } from '@/meta/coleta';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('o cron e o alarme', () => {
  const wrangler = readFileSync(join(RAIZ, 'wrangler.toml'), 'utf8');

  it('acha o gatilho no wrangler.toml', () => {
    // Sem isto, um `wrangler.toml` sem cron faria o teste passar sem conferir
    // nada — e a coleta simplesmente não rodaria.
    expect(wrangler).toMatch(/crons\s*=/);
  });

  it('o intervalo do gatilho é o que o alarme espera', () => {
    const cron = /crons\s*=\s*\[\s*"([^"]+)"/.exec(wrangler)?.[1];
    expect(cron).toBe(`*/${MINUTOS_ENTRE_EXECUCOES} * * * *`);
  });

  it('o wrangler.toml aponta para onde a constante mora', () => {
    // O comentário é o que faz a pessoa que mexe num arquivo lembrar do outro.
    // Este teste existe para ele não ser apagado numa limpeza.
    expect(wrangler).toMatch(/meta-coleta/);
  });
});
