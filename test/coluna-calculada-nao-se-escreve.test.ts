/**
 * Ninguém escreve em coluna calculada.
 *
 * O QUE ACONTECEU, E POR QUE UM TESTE DE UNIDADE NÃO PEGOU
 *   `profiles.is_superadmin` era coluna comum. A F14 trouxe a hierarquia de
 *   papéis e ela virou CALCULADA — passou a derivar de `role`. O Postgres
 *   recusa escrita em coluna gerada.
 *
 *   O código de ativação continuou mandando `is_superadmin` no `insert`. A
 *   recusa derrubava a transação inteira, e o estrago era assimétrico: a conta
 *   nascia no provedor de autenticação (que é outro sistema, fora da
 *   transação) e o perfil não. A pessoa ficava com senha válida e sem entrada
 *   em lugar nenhum.
 *
 *   Pior ainda, o convite continuava `pending`: a segunda tentativa morria em
 *   "User already registered", que aponta para o lugar errado. Levou uma sessão
 *   inteira para achar, e valeu para TODOS os convites desde a F14.
 *
 * POR QUE ESTE TESTE LÊ O CÓDIGO-FONTE
 *   Nenhum teste sem banco pega isto: sem Postgres não há coluna gerada, e o
 *   SQL é só uma string. E um teste COM banco pegaria só o caminho que ele
 *   exercita — o defeito estava numa rota que os testes não chamavam.
 *
 *   Ler a fonte cobre todas as escritas de uma vez, inclusive as que ninguém
 *   lembrou de testar. Mesma ideia de `areas.test.ts` e
 *   `cron-e-alarme-concordam.test.ts`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * As colunas que o banco calcula sozinho. Escrever nelas é erro, sempre.
 *
 * Acrescentar uma aqui é o passo que falta quando se cria coluna gerada —
 * senão a próxima repete a história.
 */
const CALCULADAS = [{ tabela: 'ideworks.profiles', coluna: 'is_superadmin' }];

function arquivosDeCodigo(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    if (nome === 'node_modules' || nome === 'dist' || nome.startsWith('.')) continue;
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDeCodigo(caminho));
      continue;
    }
    if (!['.ts', '.tsx', '.mjs', '.js'].includes(extname(nome))) continue;
    if (nome.includes('.test.')) continue;
    achados.push(caminho);
  }
  return achados;
}

const FONTES = [
  ...arquivosDeCodigo(join(RAIZ, 'src')),
  ...arquivosDeCodigo(join(RAIZ, 'worker')),
  ...arquivosDeCodigo(join(RAIZ, 'scripts')),
];

describe('coluna calculada não se escreve', () => {
  it('acha código para conferir', () => {
    // Sem isto, uma pasta renomeada faria o teste passar sem olhar nada.
    expect(FONTES.length).toBeGreaterThan(20);
  });

  for (const { tabela, coluna } of CALCULADAS) {
    it(`nenhum insert em ${tabela} manda ${coluna}`, () => {
      const culpados: string[] = [];

      for (const arquivo of FONTES) {
        const texto = readFileSync(arquivo, 'utf8');
        // A lista de colunas de um `insert into <tabela> ( ... )`.
        const padrao = new RegExp(`insert\\s+into\\s+${tabela.replace('.', '\\.')}\\s*\\(([^)]*)\\)`, 'gis');
        for (const achado of texto.matchAll(padrao)) {
          if (new RegExp(`\\b${coluna}\\b`).test(achado[1])) {
            culpados.push(arquivo.slice(RAIZ.length + 1));
          }
        }
      }

      expect(culpados, `escrevem em ${coluna}: ${culpados.join(', ')}`).toEqual([]);
    });

    it(`nenhum update em ${tabela} atribui ${coluna}`, () => {
      const culpados: string[] = [];

      for (const arquivo of FONTES) {
        const texto = readFileSync(arquivo, 'utf8');
        const padrao = new RegExp(
          `update\\s+${tabela.replace('.', '\\.')}[\\s\\S]{0,400}?\\bset\\b[\\s\\S]{0,400}?\\b${coluna}\\s*=`,
          'gis',
        );
        if (padrao.test(texto)) culpados.push(arquivo.slice(RAIZ.length + 1));
      }

      expect(culpados, `atribuem ${coluna}: ${culpados.join(', ')}`).toEqual([]);
    });
  }
});
