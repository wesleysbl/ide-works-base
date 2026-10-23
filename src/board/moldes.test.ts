/**
 * OS MOLDES DE ESTEIRA — F17.16.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Duas razões, e a segunda é a que mais importa.
 *
 *   1. `ideworks.create_status_set` recusa esteira com zero ou dois status que
 *      fecham. Um molde torto só apareceria como recusa do banco na cara de
 *      quem estivesse criando uma lista — e a pessoa não teria como saber que o
 *      problema é do molde, não do que ela fez.
 *
 *   2. `desing de capa` ESTÁ COM AS LETRAS TROCADAS DE PROPÓSITO. É a grafia do
 *      ClickUp da Ide, e a decisão D21 manda copiar o que existe lá como está.
 *      Sem este teste, a primeira pessoa que passar por aqui "conserta" — e a
 *      coluna do IDE Works deixa de ter o nome que a equipe lê todo dia.
 */

import { describe, expect, it } from 'vitest';

import { ESTEIRA_PADRAO, conferirEsteira } from '@/board/arvore';
import { HERDAR, MOLDES_DE_ESTEIRA, moldePorChave } from '@/board/moldes';

describe('todo molde é uma esteira que o banco aceita', () => {
  for (const molde of MOLDES_DE_ESTEIRA) {
    it(`\`${molde.nome}\` passa por \`conferirEsteira\``, () => {
      expect(conferirEsteira(molde.nome, molde.statuses)).toBeNull();
    });

    it(`\`${molde.nome}\` fecha no ÚLTIMO status, e só nele`, () => {
      const fecham = molde.statuses.filter((s) => s.type === 'closed');
      expect(fecham).toHaveLength(1);
      expect(molde.statuses[molde.statuses.length - 1].type).toBe('closed');
    });

    it(`\`${molde.nome}\` começa por um \`open\` — é onde a tarefa nova cai`, () => {
      // `first_open_status` ordena por "não é open" e depois por `sort_order`.
      // Se o primeiro da lista não for `open`, a tarefa nasce na coluna errada.
      expect(molde.statuses[0].type).toBe('open');
    });

    it(`\`${molde.nome}\` tem cor em todo status, e nenhuma é classe`, () => {
      for (const s of molde.statuses) {
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  }
});

describe('o erro de digitação da ORIGEM é copiado, e não consertado', () => {
  /*
    Decisão D21: o que existe no ClickUp é copiado como está. `desing de capa`
    é a coluna real da esteira de vídeo da Ide — a equipe reconhece a palavra
    que ela vê todo dia, e a grafia "certa" seria uma segunda verdade.

    Se este teste falhar porque alguém arrumou a palavra: NÃO arrume o teste.
    Devolva a grafia da origem, ou traga a decisão do usuário de renomear a
    coluna nos DOIS sistemas.
  */
  const video = moldePorChave('video');

  it('a esteira de vídeo existe', () => {
    expect(video).not.toBeNull();
  });

  it('e traz `desing de capa` — com as letras trocadas, como no ClickUp', () => {
    const nomes = (video?.statuses ?? []).map((s) => s.name);
    expect(nomes).toContain('desing de capa');
    expect(nomes).not.toContain('design de capa');
  });
});

describe('as esteiras medidas estão inteiras', () => {
  const nomes = (chave: string) =>
    (moldePorChave(chave)?.statuses ?? []).map((s) => s.name);

  it('Conteúdo: os oito estados, na ordem', () => {
    expect(nomes('conteudo')).toEqual([
      'idéias',
      'a fazer',
      'em andamento',
      'refação',
      'revisão interna',
      'em aprovação do cliente',
      'publicar/agendar',
      'concluído',
    ]);
  });

  it('Vídeo: os dez estados, na ordem', () => {
    expect(nomes('video')).toEqual([
      'ideia inicial',
      'roteiro em progresso',
      'aprovação do roteiro',
      'em captação',
      'em edição',
      'desing de capa',
      'revisão interna',
      'em aprovação do cliente',
      'publicar/agendar',
      'concluído',
    ]);
  });

  it('ADS: os nove estados, na ordem', () => {
    expect(nomes('ads')).toEqual([
      'configurações da conta',
      'aguardando verba',
      'aguardando criativo',
      'pausada',
      'revisão interna',
      'em aprovação do cliente',
      'publicar/agendar',
      'ativo (acompanhamento)',
      'concluído',
    ]);
  });

  it('Demanda: os doze estados, na ordem', () => {
    expect(nomes('demanda')).toEqual([
      'a fazer',
      'a fazer video',
      'a fazer arte',
      'atribuir demanda',
      'stand-by',
      'em andamento',
      'aprovação',
      'enviar para cliente',
      'enviado para cliente',
      'refação',
      'agendar postagem',
      'demanda concluída',
    ]);
  });

  it('Simples é a MESMA esteira padrão de `arvore.ts`, e não uma cópia dela', () => {
    expect(nomes('simples')).toEqual(ESTEIRA_PADRAO.map((s) => s.name));
  });
});

describe('herdar não é molde', () => {
  it('`HERDAR` não colide com chave de molde nenhum', () => {
    expect(moldePorChave(HERDAR)).toBeNull();
  });

  it('chave desconhecida devolve nulo em vez de escolher por engano', () => {
    expect(moldePorChave('não existe')).toBeNull();
  });
});
