/**
 * O MODELO DO FILTRO — F17.55.
 *
 * O QUE ESTE ARQUIVO GUARDA, E POR QUE CADA COISA ESTÁ AQUI
 *   Três armadilhas medidas, e nenhuma delas aparece como erro na tela:
 *
 *   1. **A sentinela no lugar do identificador.** `sem` e um `uuid` viajam na
 *      mesma escolha, e a consulta manda o identificador com `::uuid`. Se
 *      `paraConsulta` deixasse `sem` passar por ali, a escolha MAIS USADA da
 *      tela — 1.015 das 1.070 tarefas — derrubaria a consulta com "invalid
 *      input syntax for type uuid".
 *
 *   2. **O acento.** A tabela é a mesma para o banco e para o navegador, e é
 *      testada como tabela: se as duas strings tiverem tamanhos diferentes,
 *      `translate` do Postgres ignora a sobra em silêncio e a busca passa a
 *      achar menos do que devia, sem erro nenhum.
 *
 *   3. **O que vem do endereço.** `?responsavel=eu` chega de uma barra de
 *      endereço, e a resposta certa é "qualquer um", não uma tela vazia.
 */

import { describe, expect, it } from 'vitest';

import {
  ACENTOS_DE,
  ACENTOS_PARA,
  SEM_FILTRO,
  SEM_RESPONSAVEL,
  TETO_DA_BUSCA,
  lerFiltro,
  nomeDoResponsavel,
  paraConsulta,
  paraEndereco,
  semAcento,
  temFiltro,
} from '@/board/filtro';

const ALGUEM = '96dcfc56-8460-4fc8-870a-b4745a01b943';

describe('a tabela de acento', () => {
  /* `translate(texto, de, para)` casa letra a letra. Com `de` maior que `para`,
     o Postgres APAGA as letras sobrando em vez de recusar — e a busca por
     `coração` deixaria de achar `coraçao` sem ninguém saber por quê. */
  it('tem o mesmo tamanho dos dois lados', () => {
    expect([...ACENTOS_DE].length).toBe([...ACENTOS_PARA].length);
  });

  it('não repete letra', () => {
    expect(new Set([...ACENTOS_DE]).size).toBe([...ACENTOS_DE].length);
  });

  it('não tem letra acentuada do lado de chegada', () => {
    expect(ACENTOS_PARA).toBe(ACENTOS_PARA.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  });
});

describe('semAcento', () => {
  it('dobra maiúscula acentuada, porque `lower` vem antes no banco', () => {
    // `[A] FOR HIM - THUMB DOCUMENTÁRIO` é um título real desta base, e
    // `documentario` tem de achá-lo.
    expect(semAcento('DOCUMENTÁRIO')).toBe('documentario');
    expect(semAcento('PRÓ-FORMA')).toBe('pro-forma');
  });

  it('dobra o ç e o ã', () => {
    expect(semAcento('Coração')).toBe('coracao');
  });

  /* O teclado do macOS entrega `á` como `a` + acento combinante. Nessa forma a
     letra não está na tabela, e sem o `normalize` a mesma busca acharia coisas
     diferentes conforme a máquina de quem digitou. */
  it('junta o acento combinante antes de dobrar', () => {
    // A forma decomposta é PRODUZIDA aqui, e não escrita: as duas são
    // invisíveis num editor, e um arquivo salvo por outra ferramenta poderia
    // juntá-las sozinho — o teste passaria a comparar a mesma string consigo
    // mesma, e continuaria verde sem provar nada.
    const decomposto = 'ágil'.normalize('NFD');
    expect([...decomposto].length).toBe(5);
    expect(semAcento(decomposto)).toBe('agil');
  });

  it('deixa em paz o que não tem acento', () => {
    expect(semAcento('Sabor Doce - Arte: Torta')).toBe('sabor doce - arte: torta');
  });
});

describe('lerFiltro é tolerante, porque vem da barra de endereço', () => {
  it('sem nada, não filtra', () => {
    expect(lerFiltro(null, null)).toEqual(SEM_FILTRO);
  });

  it('aceita a sentinela de quem não tem ninguém', () => {
    expect(lerFiltro(null, 'sem').responsavel).toBe(SEM_RESPONSAVEL);
    expect(lerFiltro(null, ' SEM ').responsavel).toBe(SEM_RESPONSAVEL);
  });

  it('aceita identificador de gente', () => {
    expect(lerFiltro(null, ALGUEM).responsavel).toBe(ALGUEM);
    expect(lerFiltro(null, ALGUEM.toUpperCase()).responsavel).toBe(ALGUEM);
  });

  it('o que não é nem um nem outro vira `qualquer um`, e não erro', () => {
    for (const torto of ['eu', 'null', '00000000', 'sem-responsavel', '1 or 1=1']) {
      expect(lerFiltro(null, torto).responsavel).toBeNull();
    }
  });

  it('corta o texto no teto', () => {
    expect(lerFiltro('x'.repeat(500), null).texto.length).toBe(TETO_DA_BUSCA);
  });
});

describe('paraConsulta separa a sentinela do identificador', () => {
  /* A armadilha nº 1 do cabeçalho. O Postgres resolve o molde do parâmetro
     ANTES de decidir qual ramo do `or` executar. */
  it('`sem responsável` NUNCA vai pelo parâmetro que a consulta manda como uuid', () => {
    const c = paraConsulta({ texto: '', responsavel: SEM_RESPONSAVEL });
    expect(c.responsavel).toBeNull();
    expect(c.semResponsavel).toBe(true);
  });

  it('uma pessoa vai pelo identificador, e não liga a sentinela', () => {
    const c = paraConsulta({ texto: '', responsavel: ALGUEM });
    expect(c.responsavel).toBe(ALGUEM);
    expect(c.semResponsavel).toBe(false);
  });

  it('sem escolha, os dois ficam desligados', () => {
    expect(paraConsulta(SEM_FILTRO)).toEqual({
      texto: null,
      responsavel: null,
      semResponsavel: false,
    });
  });

  it('o texto chega ao banco já dobrado e em minúsculas', () => {
    expect(paraConsulta({ texto: '  Sabor DOCE  ', responsavel: null }).texto).toBe('sabor doce');
    expect(paraConsulta({ texto: 'DOCUMENTÁRIO', responsavel: null }).texto).toBe('documentario');
  });

  it('só espaço é o mesmo que nada — uma tecla de espaço não é uma busca', () => {
    expect(paraConsulta({ texto: '   ', responsavel: null }).texto).toBeNull();
  });
});

describe('temFiltro', () => {
  it('nada ligado', () => {
    expect(temFiltro(SEM_FILTRO)).toBe(false);
    expect(temFiltro({ texto: '  ', responsavel: null })).toBe(false);
  });

  it('qualquer um dos dois basta', () => {
    expect(temFiltro({ texto: 'a', responsavel: null })).toBe(true);
    expect(temFiltro({ texto: '', responsavel: SEM_RESPONSAVEL })).toBe(true);
  });
});

describe('paraEndereco', () => {
  it('não escreve o que está desligado — o endereço sem filtro fica limpo', () => {
    expect(paraEndereco(SEM_FILTRO)).toEqual({});
    expect(paraEndereco({ texto: '   ', responsavel: null })).toEqual({});
  });

  it('escreve os dois quando os dois estão ligados', () => {
    expect(paraEndereco({ texto: ' sabor ', responsavel: SEM_RESPONSAVEL })).toEqual({
      busca: 'sabor',
      responsavel: 'sem',
    });
  });

  /* O acento NÃO se perde no endereço: quem colar o endereço tem de ver a
     palavra que digitou. Quem dobra é a consulta, na hora de comparar. */
  it('guarda o texto como foi digitado, com acento e tudo', () => {
    expect(paraEndereco({ texto: 'DOCUMENTÁRIO', responsavel: null }).busca).toBe('DOCUMENTÁRIO');
  });
});

describe('nomeDoResponsavel', () => {
  const opcoes = [{ id: ALGUEM, name: 'Caio Moraes', tasks: 30 }];

  it('sem escolha, não há nome', () => {
    expect(nomeDoResponsavel(SEM_FILTRO, opcoes)).toBeNull();
  });

  it('a sentinela tem nome próprio', () => {
    expect(nomeDoResponsavel({ texto: '', responsavel: SEM_RESPONSAVEL }, opcoes)).toBe(
      'Sem responsável',
    );
  });

  it('a pessoa aparece pelo nome', () => {
    expect(nomeDoResponsavel({ texto: '', responsavel: ALGUEM }, opcoes)).toBe('Caio Moraes');
  });

  /* Endereço colado de outro quadro, ou a pessoa perdeu a última tarefa daqui
     enquanto a aba estava aberta. Mostrar o identificador cru não diria nada a
     ninguém. */
  it('quem não está na lista é dito como desconhecido, e não como um código', () => {
    const nome = nomeDoResponsavel(
      { texto: '', responsavel: '00000000-0000-0000-0000-000000000000' },
      opcoes,
    );
    expect(nome).toBe('alguém que não está nesta lista');
    expect(nome).not.toContain('0000');
  });
});
