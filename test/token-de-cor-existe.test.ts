/**
 * TODO `var(--x)` DE COR USADO NUMA FOLHA EXISTE DE VERDADE — F20.9.
 *
 * O DEFEITO QUE ESTE TESTE NASCEU PARA PEGAR
 *   `src/chat/chat.css` foi escrito contra uma paleta que este projeto nunca
 *   teve: `--borda`, `--fundo`, `--superficie`, `--texto-suave`, `--perigoso`.
 *   Nenhuma delas existe — os tokens do Obsidian são `--hair`, `--ink-*`,
 *   `--mute`, `--err`.
 *
 *   O CSS não reclama disso. `border: 1px solid var(--nao-existe)` não fica
 *   vermelho no console: a declaração inteira vira inválida e o navegador cai
 *   no valor inicial, que para borda é `none`. O chat foi para produção em
 *   22/09/2026 SEM UMA ÚNICA DIVISÓRIA, com a lista, o fio e a barra lateral
 *   derretidos num cinza só, e `color: var(--texto-suave)` fazendo a prévia da
 *   conversa e o rodapé dos 30 dias pesarem igual ao texto normal.
 *
 *   Nada quebrou, nenhum teste caiu, o build passou. Por isso a checagem é
 *   aqui e não no olhômetro: o defeito é invisível para todo o resto.
 *
 * O QUE ELE NÃO FAZ
 *   Não confere se a cor é bonita nem se contrasta — disso cuidam
 *   `src/ui/cores.test.ts` e `test/contraste-legivel.test.ts`. Aqui a pergunta
 *   é só: o nome existe em algum lugar?
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = join(import.meta.dirname, '..', 'src');

/** Toda folha do projeto, onde quer que ela esteja. */
function folhas(dir: string): string[] {
  const achadas: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) achadas.push(...folhas(caminho));
    else if (item.name.endsWith('.css')) achadas.push(caminho);
  }
  return achadas;
}

const ARQUIVOS = folhas(RAIZ);
const TUDO = ARQUIVOS.map((f) => readFileSync(f, 'utf8')).join('\n');

/* Definido = declarado numa folha (`--x:`) OU entregue por um componente como
   estilo em linha. O segundo caso é legítimo e comum aqui: `--cor-pessoa` sai
   do `style` do avatar, `--cor-espaco` do ícone da árvore. Por isso a lista do
   componente é LIDA do código, e não digitada — uma lista à mão viraria a
   segunda verdade e continuaria verde depois de alguém apagar o `style`. */
const FONTES = join(import.meta.dirname, '..', 'src');

function codigo(dir: string): string[] {
  const achados: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) achados.push(...codigo(caminho));
    else if (/\.tsx?$/.test(item.name) && !item.name.includes('.test.')) {
      achados.push(caminho);
    }
  }
  return achados;
}

const TSX = codigo(FONTES)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const DEFINIDOS = new Set<string>(
  [...TUDO.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
);
/* `['--cor-pessoa' as string]: …` e `style={{ '--bc': … }}` — as duas formas
   que o projeto usa para entregar um token pelo componente. */
const VINDOS_DO_COMPONENTE = new Set<string>(
  [...TSX.matchAll(/['"](--[a-z0-9-]+)['"]/g)].map((m) => m[1]),
);

describe('os tokens usados nas folhas existem', () => {
  it('nenhum `var(--x)` aponta para um nome que ninguém declara', () => {
    const orfaos: string[] = [];

    for (const arquivo of ARQUIVOS) {
      const css = readFileSync(arquivo, 'utf8');
      for (const uso of css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const nome = uso[1];
        if (DEFINIDOS.has(nome) || VINDOS_DO_COMPONENTE.has(nome)) continue;
        orfaos.push(`${arquivo.slice(arquivo.indexOf('src/'))}: var(${nome})`);
      }
    }

    expect([...new Set(orfaos)]).toEqual([]);
  });
});
