/**
 * NENHUM NOME DE BANCO CHEGA AO OLHO DE QUEM TRABALHA — etapa F17.19.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE TESTE EXISTE: JÁ ESCAPOU DUAS VEZES
 *
 *   1. A F17.20 tirou `ideworks.checklist_items` de um rodapé da tela dos
 *      passos. Texto escrito à mão, na interface, com o nome de uma tabela.
 *
 *   2. Uma semana depois, esta recusa apareceu INTEIRA para o usuário:
 *
 *        "a tarefa '01/09' da lista 'Setembro' esta no status 'a fazer' (…)
 *         mova essas tarefas para outra lista com ideworks.move_task
 *         (ou conclua-as), mude a esteira, e traga-as de volta."
 *
 *      Desta vez o nome não estava na tela: estava no BANCO, e a tela repassava
 *      a frase do gatilho sem olhar.
 *
 *   Duas causas diferentes, um mesmo estrago. Por isso este arquivo cobre as
 *   duas portas: o texto que a interface escreve, e o texto que ela repassa.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE CONTA COMO "NOME DE BANCO", E POR QUE A LISTA NÃO É TODA A `colunas`
 *   O retrato do schema tem 479 colunas, e entre elas `name`, `type`, `color`,
 *   `title`. Cobrar essas palavras faria o teste acusar toda a interface —
 *   e teste que grita à toa é teste que todo mundo aprende a desligar.
 *
 *   Então o vocabulário é o que é INCONFUNDÍVEL:
 *     · qualquer coisa depois de `ideworks.`;
 *     · o nome de cada FUNÇÃO do schema (`move_task`, `create_status_set`…);
 *     · tabela e coluna cujo nome tem sublinhado (`status_sets`, `status_id`).
 *
 *   Fica de fora, de propósito, tabela de palavra única (`tasks`, `lists`).
 *   Elas são ambíguas demais para valer a acusação, e nenhuma das duas fugas
 *   reais passou por elas.
 *
 * O QUE ELE **NÃO** COBRE
 *   Texto montado em tempo de execução a partir de dado do banco fora do
 *   caminho de `emPortugues` — por exemplo, um nome de coluna que virasse
 *   rótulo numa tabela genérica. Não existe hoje; se existir, esta rede não
 *   pega, e é melhor estar escrito do que descoberto depois.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emPortugues, pareceSql } from '@/server/recusas';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ───────────────────────────── o vocabulário ───────────────────────────── */

type Retrato = { colunas: string[]; funcoes: string[] };

const retrato = JSON.parse(
  readFileSync(join(RAIZ, 'supabase', 'schema-esperado.json'), 'utf8'),
) as Retrato;

/** `acting_areas()|area[]|definer|…` → `acting_areas`. */
const NOMES_DE_FUNCAO = [
  ...new Set(retrato.funcoes.map((f) => f.split('(')[0].trim()).filter((n) => n !== '')),
];

/** `admin_audit|action|text|NO|` → tabela e coluna. Só as que têm sublinhado. */
const NOMES_DE_TABELA = [
  ...new Set(
    retrato.colunas
      .map((c) => c.split('|')[0])
      .filter((t) => t.includes('_')),
  ),
];

const NOMES_DE_COLUNA = [
  ...new Set(
    retrato.colunas
      .map((c) => c.split('|')[1])
      .filter((c) => c !== undefined && c.includes('_')),
  ),
];

const VOCABULARIO = [...NOMES_DE_FUNCAO, ...NOMES_DE_TABELA, ...NOMES_DE_COLUNA];

/** O que há de nome de banco num texto qualquer. Devolve os achados. */
function nomesDeBanco(texto: string): string[] {
  const achados = new Set<string>();
  for (const m of texto.matchAll(/\bideworks\.([a-z_]+)/g)) achados.add(`ideworks.${m[1]}`);
  const palavras = new Set(texto.toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []);
  for (const nome of VOCABULARIO) if (palavras.has(nome)) achados.add(nome);
  return [...achados];
}

/* ───────────────────────────── os arquivos ───────────────────────────── */

function varrer(pasta: string, filtro: (n: string) => boolean): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...varrer(caminho, filtro));
    else if (filtro(nome)) achados.push(caminho);
  }
  return achados;
}

/** Fora comentário: comentário PODE nomear tabela, e deve — ele explica. */
const semComentario = (fonte: string) =>
  fonte.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/* ───────────────────────── 1. o texto que a tela escreve ─────────────────── */

describe('o que a interface escreve não nomeia o banco', () => {
  const telas = varrer(join(RAIZ, 'src'), (n) => n.endsWith('.tsx'));

  it('há telas para conferir', () => {
    expect(telas.length).toBeGreaterThan(20);
  });

  it('nenhum texto entre tags, nem `title`, `aria-label` ou `placeholder`', () => {
    const culpados: string[] = [];

    for (const arquivo of telas) {
      const fonte = semComentario(readFileSync(arquivo, 'utf8'));

      const visiveis: string[] = [];
      // O texto literal entre duas tags: `>Mova essas tarefas<`.
      for (const m of fonte.matchAll(/>([^<>{}]+)</g)) visiveis.push(m[1]);
      // Os três atributos que uma pessoa lê — dois deles no leitor de tela.
      for (const m of fonte.matchAll(/(?:title|aria-label|placeholder)="([^"]*)"/g)) {
        visiveis.push(m[1]);
      }

      for (const texto of visiveis) {
        const achados = nomesDeBanco(texto);
        if (achados.length > 0) {
          culpados.push(`${arquivo.slice(RAIZ.length + 1)}: ${achados.join(', ')} — «${texto.trim().slice(0, 90)}»`);
        }
      }
    }

    expect(culpados, `nome de banco em texto visível:\n${culpados.join('\n')}`).toEqual([]);
  });
});

/* ──────────────── 2. o texto que a tela REPASSA, vindo do banco ──────────── */

describe('a recusa do banco chega traduzida', () => {
  /** Toda mensagem de `raise exception` das migrações. É o que sobe para a tela. */
  const mensagens = (() => {
    const achados: { arquivo: string; texto: string }[] = [];
    for (const arquivo of varrer(join(RAIZ, 'supabase', 'migrations'), (n) => n.endsWith('.sql'))) {
      const sql = readFileSync(arquivo, 'utf8');
      for (const m of sql.matchAll(/raise\s+exception\s*(?:using[^']*)?\s*'((?:[^']|'')+)'/gi)) {
        achados.push({ arquivo: arquivo.slice(RAIZ.length + 1), texto: m[1].replace(/''/g, "'") });
      }
    }
    return achados;
  })();

  it('há mensagens de gatilho para conferir', () => {
    // Sem isto, um `raise exception` reescrito com aspas duplas faria o teste
    // passar sem olhar nada.
    expect(mensagens.length).toBeGreaterThan(10);
  });

  it('NENHUMA delas chega à tela com nome de banco dentro', () => {
    const culpados: string[] = [];
    for (const { arquivo, texto } of mensagens) {
      // O `%` do `format` do Postgres vira um valor de verdade: é assim que a
      // frase chega, e é assim que ela tem que ser conferida.
      const comoChega = texto
        .replace(/%s/g, 'Cronograma')
        .replace(/%/g, 'Setembro');
      const traduzida = emPortugues(comoChega);
      const achados = nomesDeBanco(traduzida);
      if (achados.length > 0) {
        culpados.push(`${arquivo}: ${achados.join(', ')} — «${traduzida.slice(0, 120)}»`);
      }
    }
    expect(culpados, `recusa com nome de banco:\n${culpados.join('\n')}`).toEqual([]);
  });

  /*
    A FRASE EXATA QUE O USUÁRIO VIU. Ela está aqui inteira, e não resumida, por
    um motivo: é a única maneira de este teste continuar provando o que diz
    depois de a mensagem do banco mudar. Uma asserção sobre a frase NOVA passaria
    a verde no dia em que o banco voltasse a responder a velha.
  */
  const A_FRASE_QUE_ELE_VIU =
    'a tarefa "01/09" da lista "Setembro" esta no status \'a fazer\', da esteira "Demandas", ' +
    'e a esteira resolvida dessa lista passaria a ser "Cronograma". Sao 3 tarefa(s) no caminho. ' +
    'A esteira de uma lista so pode mudar quando nenhuma tarefa depende dela: mova essas ' +
    'tarefas para outra lista com ideworks.move_task (ou conclua-as), mude a esteira, e ' +
    'traga-as de volta — move_task reposiciona o status sozinho e diz que reposicionou. ' +
    'Nada foi mudado.';

  /*
    ⚠️ ESTE `it` É O QUE IMPEDE OS DE BAIXO DE FICAREM VERDES POR CEGUEIRA.
    Se `nomesDeBanco` parasse de reconhecer qualquer coisa — um vocabulário
    vazio, um regex quebrado —, todos os outros passariam sem olhar nada. Aqui
    ele é apontado para a frase ORIGINAL, a que de fato vazou, e cobra que ela
    seja acusada.
  */
  it('o farejador acusa a frase ORIGINAL — senão o resto é verde de mentira', () => {
    const achados = nomesDeBanco(A_FRASE_QUE_ELE_VIU);
    expect(achados).toContain('ideworks.move_task');
    expect(achados).toContain('move_task');
  });

  it('a frase que o usuário viu não sai mais com `ideworks.move_task`', () => {
    const nova = emPortugues(A_FRASE_QUE_ELE_VIU);
    expect(nova).not.toContain('ideworks.');
    expect(nova).not.toContain('move_task');
    expect(nomesDeBanco(nova)).toEqual([]);
  });

  it('e ela não manda mais CONCLUIR, que não solta a tarefa da etapa', () => {
    const nova = emPortugues(A_FRASE_QUE_ELE_VIU);
    // A verificação da F17.3c mediu isto: a tarefa concluída continua com a
    // mesma etapa, e o guarda recusa de novo. Mandar concluir é mandar a pessoa
    // trabalhar à toa.
    expect(nova).not.toMatch(/conclua-as|ou conclua|conclua as/i);
    expect(nova).toMatch(/Concluir não resolve/i);
  });

  it('mas ela continua dizendo QUAL tarefa e QUANTAS estão no caminho', () => {
    const nova = emPortugues(A_FRASE_QUE_ELE_VIU);
    expect(nova).toContain('01/09');
    expect(nova).toContain('Setembro');
    expect(nova).toContain('Demandas');
    expect(nova).toContain('Cronograma');
    expect(nova).toContain('3 tarefas');
  });

  it('a lista que ficaria sem esteira nenhuma é dita assim, e não com jargão', () => {
    const nova = emPortugues(
      'a tarefa "Post" da lista "Setembro" esta no status \'a fazer\', da esteira "Demandas", ' +
        'e a lista ficaria SEM esteira nenhuma: o quadro dela nao teria coluna. ' +
        'Sao 1 tarefa(s) no caminho. mova essas tarefas para outra lista com ideworks.move_task.',
    );
    expect(nova).toContain('sem esteira nenhuma');
    expect(nomesDeBanco(nova)).toEqual([]);
  });
});

/* ─────────── 3. o texto que o servidor escreve à mão, e também aparece ───── */

describe('as recusas escritas à mão no servidor', () => {
  const fontes = varrer(join(RAIZ, 'src', 'server'), (n) => n.endsWith('.ts') && !n.includes('.test.'));

  it('nenhuma `BoardRefused` ou `CatalogoRefused` literal nomeia o banco', () => {
    const culpados: string[] = [];
    for (const arquivo of fontes) {
      const fonte = semComentario(readFileSync(arquivo, 'utf8'));
      for (const m of fonte.matchAll(/new (?:Board|Catalogo)Refused\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gs)) {
        const achados = nomesDeBanco(m[2]);
        if (achados.length > 0) {
          culpados.push(`${arquivo.slice(RAIZ.length + 1)}: ${achados.join(', ')} — «${m[2].slice(0, 90)}»`);
        }
      }
    }
    expect(culpados, `recusa escrita à mão com nome de banco:\n${culpados.join('\n')}`).toEqual([]);
  });
});

/* ───────────────────────── 4. o farejador em si ─────────────────────────── */

describe('`pareceSql` sabe separar dado de gente de nome de banco', () => {
  it('nome entre aspas nunca é jargão, mesmo com sublinhado', () => {
    // Uma tarefa chamada `post_01` não pode desmontar a frase inteira.
    expect(pareceSql('A tarefa “post_01” está na etapa “a fazer”.')).toBe(false);
  });

  it('identificador solto é jargão', () => {
    expect(pareceSql('use ideworks.move_task')).toBe(true);
    expect(pareceSql('viola a restrição tasks_status_fk')).toBe(true);
  });

  it('português puro passa intacto', () => {
    const frase = 'A lista precisa de um nome.';
    expect(pareceSql(frase)).toBe(false);
    expect(emPortugues(frase)).toBe(frase);
  });
});
