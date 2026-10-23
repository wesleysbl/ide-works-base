/**
 * DOCUMENTO DE CLIENTE NÃO TEM ENDEREÇO FIXO — etapa F17.52.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE TESTE EXISTE
 *   O balde `client-history-documents` foi `public = true` por catorze meses.
 *   Os 15 documentos de cliente que ele guarda — contratos, planejamentos e uma
 *   transcrição de reunião — abriam SEM LOGIN, bastando ter o endereço. E o
 *   endereço estava gravado dentro do próprio dado, em
 *   `public.client_history.documentos[].url`, num formato que ninguém precisava
 *   adivinhar:
 *
 *     https://<projeto>.supabase.co/storage/v1/object/public/<balde>/<arquivo>
 *
 *   A F17.52 fechou o balde e passou a servir por endereço assinado de vida
 *   curta. O que este teste guarda não é o estado do banco — isso é papel de
 *   `scripts/provar-documento-do-cliente.mjs`, que mede a coisa real. O que ele
 *   guarda é o CÓDIGO: que ninguém volte a montar um endereço permanente porque
 *   era mais simples, num arquivo que ninguém abriu naquele dia.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ELE **NÃO** COBRE
 *   O dado do legado. As 9 `url` continuam gravadas em `public.client_history`,
 *   de propósito: apagá-las é irreversível, e a F17.52 preferiu ACRESCENTAR o
 *   caminho ao lado delas. Elas já não abrem nada — o balde é privado —, e o
 *   IDE Works nunca as lê. Este teste cobre o código, e não a memória do
 *   sistema antigo.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRAZO_DA_ASSINATURA } from '@/server/board-anexos';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const varrer = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const cheio = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : varrer(cheio);
    return /\.(ts|tsx)$/.test(e.name) ? [cheio] : [];
  });

const fontes = [...varrer(join(RAIZ, 'src')), ...varrer(join(RAIZ, 'worker'))].filter(
  (f) => !f.includes('.test.'),
);

const relativo = (f: string) => f.replace(/\\/g, '/').slice(RAIZ.replace(/\\/g, '/').length + 1);

describe('o documento do cliente não tem endereço fixo', () => {
  it('nenhum arquivo do IDE Works monta um endereço `/object/public/`', () => {
    // O nome do arquivo deste teste aparece na frase, então ele se acusaria
    // sozinho se não estivesse fora da varredura — e está: `.test.` é filtrado.
    const infratores = fontes.filter((f) => readFileSync(f, 'utf8').includes('/object/public/'));
    expect(infratores.map(relativo)).toEqual([]);
  });

  it('a tela do histórico não usa a `url` gravada no dado do legado', () => {
    // A F4.9 já guardava CAMINHO na tabela do IDE Works. O risco não era a
    // tabela: era alguém ler `documentos[].url` do legado por ser um campo
    // pronto, e devolvê-lo à tela.
    const tela = readFileSync(join(RAIZ, 'src', 'clients', 'Historico.tsx'), 'utf8');
    expect(tela).not.toMatch(/\bhref=\{[^}]*\burl\b/);
    expect(tela).toContain('enderecoDoDocumento');
  });

  it('a leitura do documento passa pelo servidor, e o servidor pergunta ao banco antes', () => {
    const servidor = readFileSync(join(RAIZ, 'src', 'server', 'history.ts'), 'utf8');

    // O alcance vem do banco, sob o ator declarado — não de um `if` aqui.
    expect(servidor).toContain('withActor');
    expect(servidor).toContain('ideworks.history_documents');
    // E a assinatura é a mesma mecânica do anexo da tarefa, e não uma segunda
    // cópia dela com outro prazo.
    expect(servidor).toContain('assinarObjetoDoBalde');
  });

  it('o prazo da assinatura é curto — minutos, nunca horas', () => {
    // Cinco minutos hoje. O teto é o que importa: um endereço vazado num
    // histórico de navegação ou num log de proxy não pode valer amanhã.
    expect(PRAZO_DA_ASSINATURA).toBeGreaterThan(0);
    expect(PRAZO_DA_ASSINATURA).toBeLessThanOrEqual(15 * 60);
  });
});
