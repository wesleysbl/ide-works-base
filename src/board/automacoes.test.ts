/**
 * A automação da etapa — a frase e o conforto de digitação. F17.41.
 *
 * O QUE ESTE ARQUIVO PROVA, E O QUE ELE NÃO CONSEGUE PROVAR
 *   Aqui não há banco. Então ele NÃO prova que a automação roda, que o
 *   responsável anterior sai, nem que o círculo é impossível — isso é
 *   `scripts/provar-automacao-por-status.mjs`, que precisa de banco vivo e
 *   termina em rollback proposital.
 *
 *   O que ele guarda é o que quebra em silêncio: a FRASE que a pessoa lê, e a
 *   conferência de conforto ser MENOS SEVERA que o banco.
 *
 * ⚠️ AS PROVAS DA FRASE DO REGISTRO SAÍRAM DAQUI NA F17.65. Elas foram para
 * `historico.test.ts`, junto com o tipo: `task_events` deixou de ser só de
 * automação, e a frase passou a ter dois sujeitos possíveis — a regra e a
 * pessoa. O que ficou aqui é a REGRA.
 */

import { describe, expect, it } from 'vitest';

import {
  type AutomacaoEmEdicao,
  avisoDaAutomacao,
  conferirAutomacao,
  fraseDaAutomacao,
  paraEdicao,
  passosDaAutomacao,
} from '@/board/automacoes';

describe('o aviso de uma linha, logo depois de arrastar o cartão', () => {
  it('conta as duas coisas quando as duas aconteceram', () => {
    expect(
      avisoDaAutomacao({ name: 'Passa para o atendimento', moved: true, assigned: true, removed: 1 }),
    ).toBe('“Passa para o atendimento” mandou a tarefa para outra lista, e passou para outra pessoa.');
  });

  it('quando não havia responsável antes, não diz que tirou ninguém', () => {
    expect(
      avisoDaAutomacao({ name: 'Triagem', moved: false, assigned: true, removed: 0 }),
    ).toBe('“Triagem” e definiu quem cuida.');
  });

  it('e diz quantos saíram quando foi mais de um', () => {
    expect(
      avisoDaAutomacao({ name: 'Triagem', moved: false, assigned: true, removed: 3 }),
    ).toContain('tirando 3');
  });
});

describe('a regra dita por extenso — F17.45', () => {
  const BASE = {
    id: 'a1',
    name: 'Passa para o atendimento',
    triggerStatusId: 's1',
    triggerStatusName: 'em revisão',
    targetListId: 'l2',
    targetListName: 'ATENDIMENTO',
    targetStatusId: 's9',
    targetStatusName: 'na fila',
    assigneeId: 'u1',
    assigneeName: 'Carla',
    active: true,
  };

  /**
   * ⚠️ O QUE ESTA FRASE SUBSTITUIU, e por que a etapa existe.
   *
   *     chega em a fazer · vai para Todas as demandas · a fazer · passa a cuidar: Carla
   *
   * Medido na captura do usuário. Sem sujeito, sem dizer de ONDE, e com o
   * mesmo `·` separando o que dispara, o destino, a etapa do destino e a
   * pessoa — quem lê tem de adivinhar qual `a fazer` é qual.
   */
  it('se lê como uma frase inteira, com a lista de origem dentro dela', () => {
    expect(fraseDaAutomacao(BASE, 'CLIENTE')).toBe(
      'Quando uma tarefa chegar na etapa “em revisão” da lista “CLIENTE”, ' +
        'ela vai para a etapa “na fila” da lista “ATENDIMENTO” e “Carla” passa a cuidar dela.',
    );
  });

  it('⚠️ e não usa a palavra `gatilho`, nem `status`, nem `disparar`', () => {
    // *"Poucas pessoas realmente sabem criar uma automação, não é o caso das
    // atendentes."* A frase não pode supor que se sabe o que é gatilho.
    expect(fraseDaAutomacao(BASE, 'CLIENTE')).not.toMatch(/gatilho|status|dispar/i);
  });

  it('vem em passos: quando, então, e', () => {
    expect(passosDaAutomacao(BASE, 'CLIENTE').map((p) => p.rotulo)).toEqual([
      'Quando',
      'Então',
      'E',
    ]);
  });

  it('os NOMES vêm marcados, para a tela poder destacá-los no meio da frase', () => {
    // Nome de etapa, de lista e de pessoa é escolhido por quem cadastra. No
    // meio de uma frase corrida eles somem — e é aí que "chega em a fazer"
    // deixa de ter sujeito.
    const quando = passosDaAutomacao(BASE, 'CLIENTE')[0];
    expect(quando.pedacos.filter((p) => p.nome === true).map((p) => p.texto)).toEqual([
      'em revisão',
      'CLIENTE',
    ]);
  });

  it('a regra que só troca quem cuida não inventa um destino', () => {
    expect(
      fraseDaAutomacao(
        {
          ...BASE,
          targetListId: null,
          targetListName: null,
          targetStatusId: null,
          targetStatusName: null,
        },
        'CLIENTE',
      ),
    ).toBe('Quando uma tarefa chegar na etapa “em revisão” da lista “CLIENTE”, “Carla” passa a cuidar dela.');
  });

  it('a regra que só encaminha não fala em quem cuida', () => {
    expect(
      fraseDaAutomacao({ ...BASE, assigneeId: null, assigneeName: null }, 'CLIENTE'),
    ).toBe(
      'Quando uma tarefa chegar na etapa “em revisão” da lista “CLIENTE”, ' +
        'ela vai para a etapa “na fila” da lista “ATENDIMENTO”.',
    );
  });

  it('⚠️ DUAS LISTAS COM O MESMO NOME — a frase leva o caminho do destino', () => {
    // Medido na regra de exemplo do usuário, em 2026-08-31: ela sai de
    // `Todas as demandas` (604ef3c5…) e vai para `Todas as demandas`
    // (630cc195…). São duas listas diferentes, em espaços diferentes. Sem o
    // caminho, a frase diria que a tarefa vai para onde ela já está — e essa
    // era metade do *"não entendi a lógica por detrás dela"*.
    expect(
      fraseDaAutomacao(
        { ...BASE, targetListName: 'Todas as demandas' },
        'Todas as demandas',
        'Ide Hub · Demandas / Todas as demandas',
      ),
    ).toBe(
      'Quando uma tarefa chegar na etapa “em revisão” da lista “Todas as demandas”, ' +
        'ela vai para a etapa “na fila” da lista “Ide Hub · Demandas / Todas as demandas” ' +
        'e “Carla” passa a cuidar dela.',
    );
  });

  it('etapa que sumiu não vira travessão: a frase diz que ela não existe mais', () => {
    expect(fraseDaAutomacao({ ...BASE, triggerStatusName: null }, 'CLIENTE')).toBe(
      'Quando uma tarefa chegar numa etapa que já não existe, ' +
        'ela vai para a etapa “na fila” da lista “ATENDIMENTO” e “Carla” passa a cuidar dela.',
    );
  });
});

describe('mudar a regra em vez de recriá-la — a dívida da F17.41', () => {
  it('a regra gravada volta ao formulário COM O `id`, e é isso que faz o servidor mudar', () => {
    // `set_task_automation` já aceitava `id` e o servidor já o repassava. A
    // tela é que mandava `null` sempre — e por isso mudar uma regra era apagar
    // e recriar, o que troca o registro de lugar e perde a pausa.
    const gravada = {
      id: 'a1',
      name: 'Passa para o atendimento',
      triggerStatusId: 's1',
      triggerStatusName: 'em revisão',
      targetListId: 'l2',
      targetListName: 'ATENDIMENTO',
      targetStatusId: 's9',
      targetStatusName: 'na fila',
      assigneeId: 'u1',
      assigneeName: 'Carla',
      active: false,
    };
    expect(paraEdicao(gravada)).toEqual({
      id: 'a1',
      name: 'Passa para o atendimento',
      triggerStatusId: 's1',
      targetListId: 'l2',
      targetStatusId: 's9',
      assigneeId: 'u1',
      active: false,
    });
  });
});

describe('a conferência de conforto — SEMPRE menos severa que o banco', () => {
  const RASCUNHO: AutomacaoEmEdicao = {
    id: null,
    name: 'Passa para o atendimento',
    triggerStatusId: 's1',
    targetListId: 'l2',
    targetStatusId: 's9',
    assigneeId: null,
    active: true,
  };

  it('a regra completa passa', () => {
    expect(conferirAutomacao(RASCUNHO)).toBeNull();
  });

  it('sem nome, não', () => {
    expect(conferirAutomacao({ ...RASCUNHO, name: '   ' })).toMatch(/nome/i);
  });

  it('sem a etapa em que a tarefa chega, não', () => {
    expect(conferirAutomacao({ ...RASCUNHO, triggerStatusId: '' })).toMatch(
      /em que etapa a tarefa precisa chegar/i,
    );
  });

  it('⚠️ NENHUMA DESSAS FRASES DIZ `GATILHO` NEM `DISPARA` — F17.45', () => {
    // Elas são a única explicação que aparece quando o botão está apagado, e a
    // pessoa que as lê é a que nunca criou uma automação.
    const todas = [
      conferirAutomacao({ ...RASCUNHO, name: ' ' }),
      conferirAutomacao({ ...RASCUNHO, triggerStatusId: '' }),
      conferirAutomacao({ ...RASCUNHO, targetListId: null, targetStatusId: null }),
      conferirAutomacao({ ...RASCUNHO, targetStatusId: null }),
    ].join(' ');
    expect(todas).not.toMatch(/gatilho|dispar|status/i);
  });

  it('regra que não faz nada, não — é a restrição do banco, dita antes', () => {
    expect(
      conferirAutomacao({ ...RASCUNHO, targetListId: null, targetStatusId: null }),
    ).toMatch(/o que a automação faz/i);
  });

  it('destino pela metade, não — lista escolhida e etapa em branco', () => {
    expect(conferirAutomacao({ ...RASCUNHO, targetStatusId: null })).toMatch(/em que etapa/i);
  });

  it('a regra que SÓ troca quem cuida passa — e é metade do pedido do usuário', () => {
    // *"após determinada etapa troca o responsável"*. Exigir destino aqui
    // recusaria configuração que o banco aceita, e conferência de conforto mais
    // severa que a regra mente sobre o que o sistema faz.
    expect(
      conferirAutomacao({
        ...RASCUNHO,
        targetListId: null,
        targetStatusId: null,
        assigneeId: 'u1',
      }),
    ).toBeNull();
  });

  it('⚠️ ela NÃO julga alcance, círculo nem esteira — só o banco sabe responder', () => {
    // Uma regra que aponta para uma lista fora do alcance, ou cuja chegada é o
    // gatilho de outra, PASSA aqui de propósito: o banco recusa com frase, e
    // recusar antes esconderia configuração legítima em todo caso parecido.
    expect(
      conferirAutomacao({ ...RASCUNHO, targetListId: 'lista-que-eu-nao-alcanco' }),
    ).toBeNull();
  });
});
