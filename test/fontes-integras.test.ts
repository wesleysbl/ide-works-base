/**
 * As fontes não contêm byte nulo.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Em 2026-08-20, na F2.4, uma edição feita com `perl -0pi` trocou um espaço
 *   por um byte nulo dentro de um template literal em `clients/formulario.ts`.
 *   O byte caiu no separador de uma chave de `Map` — onde antes havia um espaço
 *   entre o título e a URL:
 *
 *     `${titulo.toLowerCase()}·${url.toLowerCase()}`   ← o `·` era o NUL
 *
 *   E por isso NADA reclamou: o TypeScript compilou, o ESLint passou, e os 440
 *   testes continuaram verdes — um NUL separa tão bem quanto um espaço. O
 *   arquivo estava corrompido e o repositório dizia que estava tudo certo.
 *
 *   Foi o `grep` que denunciou, ao chamar o arquivo de binário.
 *
 * O QUE ELE PEGA
 *   Qualquer byte nulo em arquivo de código, migration, script ou estilo. É a
 *   assinatura de edição feita por ferramenta que não entendeu a codificação —
 *   e o tipo de estrago que só aparece semanas depois, num comportamento
 *   estranho que ninguém liga à edição que o causou.
 *
 *   Não substitui revisão. Substitui a sorte.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

const PASTAS = ['src', 'worker', 'scripts', 'supabase', 'test'];
const EXTENSOES = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.sql', '.json', '.html', '.md']);
const IGNORAR = new Set(['node_modules', 'dist', '.git', '.wrangler']);

function arquivos(pasta: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
    if (IGNORAR.has(entrada.name)) continue;
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) achados.push(...arquivos(caminho));
    else if (EXTENSOES.has(extname(entrada.name))) achados.push(caminho);
  }
  return achados;
}

describe('integridade das fontes', () => {
  const todos = PASTAS.flatMap((p) => arquivos(join(RAIZ, p)));

  it('encontra arquivos para conferir', () => {
    // Sem isto, um erro no caminho faria a suite passar sem ter olhado nada —
    // um teste que não testa nada é pior que teste nenhum, porque tranquiliza.
    expect(todos.length).toBeGreaterThan(50);
  });

  it('nenhum arquivo de codigo contem byte nulo', () => {
    const corrompidos = todos
      .map((caminho) => ({ caminho, offset: readFileSync(caminho).indexOf(0) }))
      .filter((r) => r.offset >= 0)
      .map((r) => `${r.caminho.slice(RAIZ.length + 1)} (byte ${r.offset})`);

    expect(corrompidos).toEqual([]);
  });

  /**
   * Dois arquivos que só diferem por maiúscula são o MESMO arquivo.
   *
   * Windows e macOS não distinguem caixa no nome. Na F9 nasceram
   * `src/ui/grafico.ts` (a geometria) e `src/ui/Grafico.tsx` (o desenho) — e o
   * empacotador resolveu os dois para um só, escolhendo o errado: o import do
   * componente foi parar no módulo de conta, e o build quebrou com "não é
   * exportado" apontando para um arquivo onde de fato nunca esteve.
   *
   * O tipo de erro que some quando a máquina muda: no Linux o par funciona, e
   * volta a quebrar no laptop de quem for rodar depois. Por isso vira teste, e
   * não conselho.
   */
  it('nenhum par de arquivos difere apenas por maiuscula', () => {
    const porChave = new Map<string, string[]>();
    for (const caminho of todos) {
      const relativo = caminho.slice(RAIZ.length + 1).replace(/\\/g, '/');
      // Sem a extensão: `Grafico.tsx` e `grafico.ts` colidem no import, que não
      // escreve extensão nenhuma.
      const chave = relativo.slice(0, relativo.length - extname(relativo).length).toLowerCase();
      porChave.set(chave, [...(porChave.get(chave) ?? []), relativo]);
    }

    const colididos = [...porChave.values()]
      .filter((lista) => lista.length > 1)
      .map((lista) => lista.sort().join(' ↔ '));

    expect(colididos).toEqual([]);
  });
});
