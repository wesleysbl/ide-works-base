/**
 * O MENU `/` DO EDITOR — a parte que dá para provar sem navegador. F17.16.
 *
 * POR QUE ESTE TESTE EXISTE
 *   A faixa de formatação saiu do estado normal (o usuário: *"no ClickUp o
 *   modal é limpo"*), e com ela sairiam três comandos que não agem sobre
 *   seleção: tabela, regra horizontal e emoji. O menu `/` é o que os mantém
 *   alcançáveis — então ele não pode falhar em silêncio.
 *
 *   O risco concreto está na DETECÇÃO: briefing real da Ide tem data em quase
 *   toda linha (`24/08 - [Reels] Oferta VIP 4`) e link do Dropbox em quase todo
 *   comentário. Se qualquer `/` abrisse o menu, escrever uma data viraria briga
 *   com um balão. Os casos abaixo são exatamente esses.
 */

import { describe, expect, it } from 'vitest';

import {
  COMANDOS_DE_SELECAO,
  COMANDOS_DO_EDITOR,
  ESTILOS_DE_BLOCO,
  acharBarra,
  atalhoDeTecla,
  filtrarComandos,
  rotuloDeSelecao,
} from '@/board/barra-de-comandos';

describe('a barra abre no começo de palavra, e só ali', () => {
  it('o `/` sozinho abre, com a consulta vazia', () => {
    expect(acharBarra('/')).toEqual({ inicio: 0, consulta: '' });
  });

  it('depois de espaço abre, e a consulta é o que veio depois', () => {
    expect(acharBarra('escreva /tab')).toEqual({ inicio: 8, consulta: 'tab' });
  });

  it('depois de quebra de linha abre', () => {
    expect(acharBarra('primeira\n/lis')).toEqual({ inicio: 9, consulta: 'lis' });
  });

  it('NÃO abre no meio de uma data — `24/08` é briefing, não comando', () => {
    expect(acharBarra('24/08')).toBeNull();
    expect(acharBarra('entrega 24/08')).toBeNull();
  });

  it('NÃO abre dentro de um endereço — o link do Dropbox tem três barras', () => {
    expect(acharBarra('https://')).toBeNull();
    expect(acharBarra('https://dropbox.com/s/')).toBeNull();
  });

  it('NÃO abre entre palavras coladas', () => {
    expect(acharBarra('arte/vídeo')).toBeNull();
  });

  it('fecha quando se digita espaço depois da barra', () => {
    expect(acharBarra('/ ')).toBeNull();
    expect(acharBarra('/tabela ')).toBeNull();
  });

  it('fecha quando a barra deixa de ser a última coisa antes do cursor', () => {
    // O texto recebido é sempre o do nó ATÉ o cursor. Cursor antes da barra
    // significa que ela não está sendo digitada agora.
    expect(acharBarra('nada aqui')).toBeNull();
    expect(acharBarra('')).toBeNull();
  });

  it('o índice devolvido é o do `/`, que é o que a tela apaga', () => {
    const achado = acharBarra('faça isto: /reg');
    expect(achado).not.toBeNull();
    expect('faça isto: /reg'[achado?.inicio ?? -1]).toBe('/');
  });
});

describe('o filtro acha o que a pessoa tem na cabeça', () => {
  it('consulta vazia mostra o catálogo inteiro', () => {
    expect(filtrarComandos('')).toHaveLength(COMANDOS_DO_EDITOR.length);
  });

  it('acha sem acento — quem digita `titulo` quer `Título`', () => {
    expect(filtrarComandos('titulo').map((c) => c.chave)).toEqual(['h1', 'h2', 'h3']);
  });

  it('acha por sinônimo: `check` é a lista de caixinhas', () => {
    expect(filtrarComandos('check').map((c) => c.chave)).toEqual(['caixas']);
  });

  it('acha por sinônimo: `hr` é a regra horizontal', () => {
    expect(filtrarComandos('hr').map((c) => c.chave)).toEqual(['regra']);
  });

  it('acha `tabela` por `tab`', () => {
    expect(filtrarComandos('tab').map((c) => c.chave)).toContain('tabela');
  });

  it('consulta sem resposta devolve vazio — a tela é quem diz isso em palavras', () => {
    expect(filtrarComandos('zzz')).toEqual([]);
  });
});

describe('os três comandos órfãos da bolha de seleção estão no menu `/`', () => {
  /*
    São eles que justificam este menu existir: `inserir tabela`, `regra
    horizontal` e `emoji` agem com o cursor parado, e por isso a bolha de
    seleção — que só existe com texto selecionado — nunca os alcançaria.

    Se algum sumir daqui, ele deixa de ter caminho pela tela.
  */
  for (const chave of ['tabela', 'regra', 'emoji']) {
    it(`\`${chave}\` está no catálogo`, () => {
      expect(COMANDOS_DO_EDITOR.some((c) => c.chave === chave)).toBe(true);
    });
  }

  it('nenhuma chave repetida — duas linhas iguais no menu é escolha sem resposta', () => {
    const chaves = COMANDOS_DO_EDITOR.map((c) => c.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

/* ───────────────────────────── a bolha e os atalhos ───────────────────────── */

describe('NENHUM COMANDO DA FAIXA ANTIGA FICOU SEM PORTA', () => {
  /*
    A faixa que saiu tinha doze peças. Elas foram para dois lugares — a bolha de
    seleção e o menu `/` —, e a soma dos dois tem que continuar cobrindo as doze.
    Este é o teste que o usuário pediu em palavras: *"nenhum pode regredir"*.
  */
  // `Set<string>` de propósito: o teste pergunta por CHAVE ESCRITA, que é
  // como ela aparece no relatório e na revisão. Tipar o conjunto pelo enum
  // faria o compilador recusar a pergunta antes de o teste poder respondê-la —
  // e uma chave removida do enum deixaria de falhar aqui para falhar lá.
  const naBolha = new Set<string>(COMANDOS_DE_SELECAO.map((c) => c.chave));
  const naBarra = new Set<string>(COMANDOS_DO_EDITOR.map((c) => c.chave));

  const PECAS_DA_FAIXA_ANTIGA: [string, 'bolha' | 'barra' | 'ambos'][] = [
    ['estilo', 'bolha'],
    ['negrito', 'bolha'],
    ['italico', 'bolha'],
    ['riscado', 'bolha'],
    ['codigo', 'bolha'],
    ['link', 'bolha'],
    ['marcador', 'barra'],
    ['numerada', 'barra'],
    ['caixas', 'barra'],
    ['tabela', 'barra'],
    ['regra', 'barra'],
    ['emoji', 'barra'],
    // `Citação` era botão próprio na faixa; virou item do menu de estilo e do `/`.
    ['citacao', 'barra'],
  ];

  for (const [chave, onde] of PECAS_DA_FAIXA_ANTIGA) {
    it(`\`${chave}\` continua alcançável (${onde})`, () => {
      expect(onde === 'bolha' ? naBolha.has(chave) : naBarra.has(chave)).toBe(true);
    });
  }

  it('as três listas e a citação estão nos DOIS caminhos', () => {
    // `Aa` transforma o que está selecionado; `/` começa do zero. É a
    // duplicidade da referência, e ela é deliberada.
    const noEstilo = new Set<string>(ESTILOS_DE_BLOCO.map((c) => c.chave));
    for (const chave of ['marcador', 'numerada', 'caixas', 'citacao']) {
      expect(noEstilo.has(chave)).toBe(true);
      expect(naBarra.has(chave)).toBe(true);
    }
  });

  it('o menu de estilo NÃO oferece inserção — ele transforma, não cria', () => {
    const noEstilo = new Set<string>(ESTILOS_DE_BLOCO.map((c) => c.chave));
    for (const chave of ['tabela', 'regra', 'emoji']) {
      expect(noEstilo.has(chave)).toBe(false);
    }
  });

  it('o rótulo mostra o atalho quando há atalho', () => {
    expect(rotuloDeSelecao({ chave: 'negrito', titulo: 'Negrito', atalho: 'Ctrl+B' })).toBe(
      'Negrito (Ctrl+B)',
    );
    expect(rotuloDeSelecao({ chave: 'codigo', titulo: 'Código', atalho: null })).toBe('Código');
  });
});

describe('OS QUATRO ATALHOS DE TECLADO CONTINUAM RESPONDENDO', () => {
  /*
    A garantia central da F17.16. A faixa sumiu da tela; se os atalhos tivessem
    sumido junto, quem formata sem tirar a mão do teclado teria perdido o
    editor inteiro — e o defeito só apareceria com alguém já digitando um
    briefing.

    `atalhoDeTecla` é pura justamente para caber aqui.
  */
  const tecla = (
    key: string,
    extra: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  ) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });

  it('Ctrl+B é negrito', () => {
    expect(atalhoDeTecla(tecla('b', { ctrlKey: true }))).toBe('negrito');
    expect(atalhoDeTecla(tecla('B', { ctrlKey: true }))).toBe('negrito');
  });

  it('Ctrl+I é itálico', () => {
    expect(atalhoDeTecla(tecla('i', { ctrlKey: true }))).toBe('italico');
  });

  it('Ctrl+Shift+X é riscado', () => {
    expect(atalhoDeTecla(tecla('x', { ctrlKey: true, shiftKey: true }))).toBe('riscado');
  });

  it('Ctrl+K é link', () => {
    expect(atalhoDeTecla(tecla('k', { ctrlKey: true }))).toBe('link');
  });

  it('o Command do Mac vale como Ctrl — a equipe tem as duas máquinas', () => {
    expect(atalhoDeTecla(tecla('b', { metaKey: true }))).toBe('negrito');
    expect(atalhoDeTecla(tecla('k', { metaKey: true }))).toBe('link');
  });

  it('letra sem modificador NÃO é atalho — senão não daria para escrever', () => {
    for (const k of ['b', 'i', 'k', 'x']) {
      expect(atalhoDeTecla(tecla(k))).toBeNull();
    }
  });

  it('Ctrl+X sem shift NÃO é riscado — é o recortar do navegador', () => {
    expect(atalhoDeTecla(tecla('x', { ctrlKey: true }))).toBeNull();
  });

  it('todo atalho anunciado no catálogo é um atalho que responde', () => {
    // Anunciar `Ctrl+B` no `title` de um botão e não tratar a tecla seria
    // mentir num lugar onde ninguém confere.
    const traduzir = (a: string) =>
      atalhoDeTecla({
        key: a.split('+').pop() ?? '',
        ctrlKey: a.includes('Ctrl'),
        metaKey: false,
        shiftKey: a.includes('Shift'),
      });

    for (const c of COMANDOS_DE_SELECAO) {
      if (c.atalho === null) continue;
      expect(traduzir(c.atalho)).toBe(c.chave);
    }
  });
});
