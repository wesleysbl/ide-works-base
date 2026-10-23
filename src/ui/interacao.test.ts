/**
 * A REGRA DO CROMO × CONTEÚDO, guardada por teste — etapa F17.25.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO PRECISA DE TESTE, E NÃO SÓ DA MEDIÇÃO NO CHROME
 *
 *   A medição no Chrome prova que a regra funciona HOJE. Ela não impede que
 *   alguém, daqui a duas etapas, tire o `user-select: none` do `body` para
 *   resolver um caso pontual — e o sistema inteiro volte a selecionar a barra
 *   lateral num arrasto.
 *
 *   O estrago que a regra evita é o mais caro do sistema: aqui se copia link do
 *   Dropbox e briefing o dia inteiro, e arrastar sem querer e colar numa tarefa
 *   de cliente é erro que CHEGA AO CLIENTE.
 *
 *   Este teste guarda as duas metades da regra — a que fecha e a que abre. Uma
 *   sem a outra é pior do que nenhuma: só a que fecha tira a cópia do
 *   comentário; só a que abre não fecha nada.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ ELE NÃO INTERPRETA CSS
 *   Lê o texto da folha e procura as declarações. É deliberado: um analisador
 *   de CSS aqui seria uma segunda implementação do navegador, e a prova de que
 *   a regra PEGA está no Chrome (a sonda da etapa, com arrasto de ponteiro de
 *   verdade). O que este arquivo guarda é que as linhas continuam existindo e
 *   que os quatro lugares de conteúdo continuam marcados.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const folha = ler('src/ui/interacao.css');

/** O texto sem comentário de bloco — a folha explica o que NÃO faz, e uma
 *  busca ingênua bateria na explicação em vez de na regra. É a mesma lição do
 *  `scripts/proibido.mjs`. */
const semComentario = folha.replace(/\/\*[\s\S]*?\*\//g, ' ');

describe('a metade que FECHA — o cromo não se seleciona', () => {
  it('o `body` inteiro nasce `user-select: none`', () => {
    // A regra mora no lugar mais alto de propósito: posta no `body`, ela vale
    // para as trinta telas de uma vez, inclusive as da Meta.
    const corpo = /body\s*\{[^}]*\}/.exec(semComentario)?.[0] ?? '';
    expect(corpo).toMatch(/(^|[^-])user-select:\s*none/);
    expect(corpo).toMatch(/-webkit-user-select:\s*none/);
  });

  it('a folha entra pelo `index.css`, e não por dentro de um componente', () => {
    // Importada de dentro de um componente, ela só valeria nas telas que
    // importassem aquele componente — e a regra é do `body` para baixo.
    expect(ler('src/index.css')).toContain("@import './ui/interacao.css';");
  });

  it('ela NÃO toca no `obsidian.css`, que é da sessão paralela', () => {
    expect(ler('src/ui/obsidian.css')).not.toContain('.selecionavel');
  });
});

describe('a metade que ABRE — o conteúdo se seleciona', () => {
  const liberacao =
    /:root input[\s\S]*?\{[^}]*\}/.exec(semComentario)?.[0] ?? '';

  it('todo campo de digitação continua liberado', () => {
    for (const alvo of ['input', 'textarea', 'select', '[contenteditable]']) {
      expect(liberacao).toContain(alvo);
    }
    expect(liberacao).toMatch(/(^|[^-])user-select:\s*text/);
  });

  it('o editor da descrição depende desta liberação, e ela é explícita', () => {
    // Medido no Chrome: com `user-select: none` herdado, o cursor entra no
    // `contenteditable` mas a seleção não pega — e `document.execCommand`
    // mira o que está selecionado. Sem esta linha, negrito e itálico morrem.
    expect(liberacao).toContain('[contenteditable]');
    expect(liberacao).toContain('[contenteditable] *');
  });

  it('a classe de conteúdo e os filhos dela estão liberados', () => {
    expect(liberacao).toContain('.selecionavel');
    expect(liberacao).toContain('.selecionavel *');
  });

  it('a recusa se copia — quem leva um erro manda a frase para alguém', () => {
    expect(liberacao).toContain('.o-alerta');
  });

  it('o VALOR de uma ficha e a CÉLULA de uma tabela também — e o rótulo não', () => {
    /*
      A regra é do `body` para baixo, então o Pilar A (Entrega) e a área Meta
      vieram junto. Telefone, WhatsApp e endereço do cliente moram em
      `.o-linha .v`, e o número do relatório em `tbody td` — os dois se copiam
      para colar numa mensagem.

      O rótulo (`.k`) e o nome da coluna (`thead th`) são cromo, e é isso que
      as duas asserções negativas guardam: liberar a linha ou a tabela INTEIRA
      devolveria o arrasto que seleciona a tela toda.
    */
    expect(liberacao).toContain('.o-linha .v');
    expect(liberacao).toContain('.o-tab-rola tbody td');
    expect(liberacao).not.toContain('.o-linha .k');
    expect(liberacao).not.toContain('thead');
  });
});

describe('os quatro lugares de conteúdo continuam marcados', () => {
  /*
    Estes são os quatro gestos que a etapa não pode quebrar, e são os mesmos
    quatro que a sonda mede no Chrome. Um `className` renomeado sem o
    `selecionavel` junto é o jeito silencioso de perder um deles.
  */
  it('o comentário — na Agência Ide ele É a entrega', () => {
    expect(ler('src/board/ConversaDaTarefa.tsx')).toContain('"c-texto selecionavel"');
  });

  it('o nome do arquivo anexado', () => {
    expect(ler('src/board/AnexosDaTarefa.tsx')).toContain('"a-nome selecionavel"');
  });

  it('o rótulo e o endereço do link', () => {
    expect(ler('src/board/AnexosDaTarefa.tsx')).toContain('"a-link-corpo selecionavel"');
  });

  it('a descrição da tarefa — pelo `contenteditable` do editor rico', () => {
    // Ela não usa `.selecionavel`: o editor JÁ é `contenteditable`, e a
    // liberação nativa o cobre. Marcá-lo com a classe seria dizer a mesma coisa
    // duas vezes, e a segunda ficaria para trás na primeira mudança.
    expect(ler('src/board/EditorRico.tsx')).toContain('contentEditable={!desativado && !enviandoImagem}');
  });
});
