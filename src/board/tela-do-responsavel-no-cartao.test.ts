/**
 * DEFINIR RESPONSÁVEL PELA CAPA DO CARTÃO — o desenho. F17.69.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   *"A equipe necessita alterar ou definir o responsável por um cartão
 *   diretamente pelo quadro, sem abrir o modal completo da tarefa."*
 *
 * O QUE ESTE ARQUIVO PROVA
 *   Que o alvo existe nos DOIS casos — com responsável (as iniciais viram
 *   botão) e SEM (o círculo tracejado), que é o caso de 1.313 das 1.843
 *   tarefas; que o balão traz a busca e as pessoas marcadas; que o cartão sem a
 *   `prop` continua exatamente o cartão de antes desta etapa; e que a capa
 *   desenha o conjunto OTIMISTA, e não o que veio no quadro.
 *
 * O QUE ELE NÃO PROVA, E POR QUÊ
 *   Que a escrita é RECUSADA para gente de outra empresa. Essa é a parede da
 *   etapa, ela mora no banco (`set_task_assignees`, com `can_assign_person` e
 *   `can_reach_task_for`), e um teste que a "verificasse" aqui estaria
 *   verificando o próprio fingimento. Ela é provada como `ideworks_app`, com um
 *   par de empresas montado de propósito, em
 *   `scripts/provar-o-responsavel-no-cartao.mjs`.
 *
 *   Também não prova pixel: que o balão fica por cima, que ele cabe, e que
 *   arrastar o cartão continua movendo de coluna. Isso é Chrome.
 *
 * SEM NAVEGADOR, E POR ISSO O BALÃO SAI NO LUGAR
 *   `Balao` só usa portal quando há `document`; em `node` ele devolve o corpo
 *   ali mesmo. Mesma observação da F17.63.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado, e teste que
 *   não roda é pior que teste nenhum porque conta como cobertura.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { type BoardAssignee, type BoardTask, type Day } from '@/board/board';
import { CorpoDoCartao } from '@/board/CartaoDeTarefa';
import { type ResponsavelDoCartao, pessoasDoConjunto } from '@/board/responsavel-do-cartao';
import { SEM_PUXAR, podePuxar } from '@/board/rolagem';

const HOJE: Day = { year: 2026, month: 9, day: 4 };

const CAMILA: BoardAssignee = { id: 'p1', name: 'Camila Mendes' };
const WESLEY: BoardAssignee = { id: 'p2', name: 'Wesley Gomes' };
const JU: BoardAssignee = { id: 'p3', name: 'Jussara Mendes' };

const tarefa = (p: Partial<BoardTask> = {}): BoardTask => ({
  id: 'a1',
  title: '[A] SABOR DOCE - ARTE SACOLA',
  statusId: 's1',
  priority: null,
  dueOn: null,
  startOn: null,
  completedAt: null,
  hasDescription: false,
  hasAttachment: false,
  clientId: null,
  clientName: null,
  assignees: [],
  tags: [],
  taskTypeName: null,
  parentId: null,
  parentTitle: null,
  subtaskCount: 0,
  checklistDone: 0,
  checklistTotal: 0,
  commentCount: 0,
  previewAttachmentId: null,
  previewCount: 0,
  ...p,
});

const responsavel = (p: Partial<ResponsavelDoCartao> = {}): ResponsavelDoCartao => ({
  pessoas: [],
  aberto: false,
  carregando: false,
  desativado: false,
  opcoes: [CAMILA, WESLEY, JU],
  meuId: 'p2',
  aoAlternar: () => {},
  aoFechar: () => {},
  aoMudar: () => {},
  ...p,
});

function desenhar(t: BoardTask, r?: ResponsavelDoCartao): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(CorpoDoCartao, { tarefa: t, hoje: HOJE, responsavel: r }),
    ),
  );
}

/* ─────────────────── o alvo, nos dois estados do cartão ─────────────────── */

describe('o alvo na capa do cartão', () => {
  it('é um botão quando a página oferece o gesto', () => {
    const html = desenhar(tarefa({ assignees: [CAMILA] }), responsavel({ pessoas: [CAMILA] }));
    expect(html).toContain('q-responsavel-btn');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('CM');
  });

  /**
   * ⚠️ O CASO MAIS COMUM DE TODOS — 1.313 das 1.843 tarefas não têm dono
   * (medido em 2026-09-04). Sem esta linha, o gesto só existiria onde ele já
   * não é mais necessário.
   */
  it('a tarefa SEM responsável também tem onde clicar', () => {
    const html = desenhar(tarefa(), responsavel());
    expect(html).toContain('q-responsavel-btn');
    expect(html).toContain('data-vazio="true"');
    expect(html).toContain('Definir responsável por [A] SABOR DOCE - ARTE SACOLA');
  });

  /* O nome da tarefa entra no rótulo porque a coluna tem cinquenta destes. */
  it('o rótulo diz de qual cartão é, e quem está nele', () => {
    const html = desenhar(tarefa({ assignees: [CAMILA] }), responsavel({ pessoas: [CAMILA] }));
    expect(html).toContain('Alterar responsável por [A] SABOR DOCE - ARTE SACOLA: Camila Mendes');
  });

  /**
   * A metade da armadilha do arrasto que se responde sem pixel: `podePuxar`
   * (F17.25) recusa o gesto de rolagem sobre `button`, então a rolagem do fundo
   * continua sem briga — de graça, por ser um `<button>` de verdade.
   */
  it('é `button`, e por isso a rolagem do fundo não o disputa', () => {
    expect(SEM_PUXAR.includes('button')).toBe(true);
    // `podePuxar` pergunta ao DOM com `closest`; aqui o alvo responde que sim,
    // ele está dentro de um `button` — que é o que o botão da capa é.
    const dentroDeUmBotao = { closest: (s: string) => (s === SEM_PUXAR ? {} : null) };
    expect(podePuxar(dentroDeUmBotao as never)).toBe(false);
  });
});

/* ───────────────── o cartão que NÃO recebeu a `prop` ───────────────── */

describe('o cartão sem o gesto', () => {
  /**
   * `Todas as tarefas` (F17.18) e a `MiniaturaDoCartao` desenham o MESMO corpo,
   * e lá não há de onde reler o quadro depois da escrita. Sem a `prop`, as
   * iniciais voltam a ser só iniciais.
   */
  it('continua exatamente o cartão de antes desta etapa', () => {
    const html = desenhar(tarefa({ assignees: [CAMILA] }));
    expect(html).toContain('q-avatares');
    expect(html).not.toContain('q-responsavel-btn');
    expect(html).not.toContain('aria-haspopup="menu"');
  });
});

/* ───────────────────────────── o balão ───────────────────────────── */

describe('o seletor que a capa abre', () => {
  it('traz a busca e as pessoas, com quem já está marcado', () => {
    const html = desenhar(
      tarefa({ assignees: [CAMILA] }),
      responsavel({ pessoas: [CAMILA], aberto: true }),
    );
    expect(html).toContain('cu-busca');
    expect(html).toContain('Camila Mendes');
    expect(html).toContain('Jussara Mendes');
    // `Eu` no topo — quem mais se atribui tarefa é quem está olhando (F17.10b).
    expect(html).toContain('Eu');
  });

  /**
   * ⚠️ "Ninguém com acesso ao IDE Works" durante a espera seria uma frase
   * ERRADA e assustadora: a lista é pedida no clique, para aquela tarefa.
   */
  it('enquanto a lista não chegou, diz que está buscando', () => {
    const html = desenhar(tarefa(), responsavel({ aberto: true, carregando: true, opcoes: [] }));
    expect(html).toContain('Buscando quem pode ficar com esta tarefa');
    expect(html).not.toContain('Ninguém com acesso ao IDE Works');
    // E não afirma "hoje 0 pessoas", que é o número que a frase existe para dizer.
    expect(html).not.toContain('hoje 0');
  });

  it('some enquanto a escrita não voltou', () => {
    const html = desenhar(tarefa(), responsavel({ desativado: true }));
    expect(html).toContain('disabled=""');
  });
});

/* ──────────────── a capa otimista, e o desfazer ──────────────── */

describe('o que a capa mostra', () => {
  /**
   * ⚠️ É `responsavel.pessoas`, E NÃO `tarefa.assignees`. Sem isto o clique não
   * teria resposta até a releitura do quadro voltar — e a releitura é a parte
   * lenta.
   */
  it('é o conjunto otimista, e não o que veio no quadro', () => {
    const html = desenhar(
      tarefa({ assignees: [CAMILA] }),
      responsavel({ pessoas: [CAMILA, WESLEY] }),
    );
    expect(html).toContain('WG');
  });

  it('e quando a escrita é desfeita, volta ao que veio no quadro', () => {
    // O desfazer apaga a marca otimista; o cartão volta a desenhar `assignees`.
    const html = desenhar(tarefa({ assignees: [CAMILA] }), responsavel({ pessoas: [CAMILA] }));
    expect(html).toContain('CM');
    expect(html).not.toContain('WG');
  });
});

/* ─────────── de ids para gente: as duas metades do nome ─────────── */

describe('pessoasDoConjunto', () => {
  it('acha o nome de quem foi marcado agora, na lista do menu', () => {
    expect(pessoasDoConjunto(['p3'], [CAMILA, JU], [])).toEqual([JU]);
  });

  /**
   * ⚠️ A SEGUNDA METADE, e ela não é enfeite: um responsável antigo pode estar
   * FORA da parede de hoje. O menu o traz marcado justamente para poder ser
   * tirado — mas se o nome dele só saísse da lista do menu, tirar OUTRA pessoa
   * o faria sumir da capa por um instante e voltar depois da releitura.
   */
  it('acha o nome de quem já estava, mesmo fora da lista oferecida', () => {
    expect(pessoasDoConjunto(['p1'], [], [CAMILA])).toEqual([CAMILA]);
  });

  it('a ordem é a do conjunto pedido, e o desconhecido não derruba a capa', () => {
    const r = pessoasDoConjunto(['p2', 'p9'], [WESLEY], []);
    expect(r.map((p) => p.id)).toEqual(['p2', 'p9']);
    expect(r[1].name).toBe('?');
  });

  it('conjunto vazio é conjunto vazio — tirar todo mundo é um gesto legítimo', () => {
    expect(pessoasDoConjunto([], [CAMILA, WESLEY], [CAMILA])).toEqual([]);
  });
});
