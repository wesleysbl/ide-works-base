/**
 * A ENTREGA NA TELA — comentário, anexo e link. F17.6.
 *
 * POR QUE ESTE TESTE EXISTE
 *   Mesma razão de `tela-dos-passos.test.ts`: `typecheck` não pega import
 *   circular, componente indefinido nem hook fora de ordem. E, como lá, ele tem
 *   um segundo trabalho — guardar a FORMA, porque o usuário vai abrir a ficha
 *   ao lado do ClickUp dele e comparar peça por peça:
 *
 *     · `📎 Anexar arquivo` como ÚLTIMA seção do corpo, com o link ao lado;
 *     · nome e tamanho do arquivo SEMPRE, pré-visualização quando der;
 *     · o bloco `Comentários` com contagem, o campo sempre aberto, e
 *       `Responder` · `Editar` · `Apagar` na fala;
 *     · a resposta RECUADA, um nível só.
 *
 *   E o que NÃO pode estar lá: `Adicione os campos` e `Vincular itens` aparecem
 *   na referência mas são de outras etapas — a segunda nem entra, porque o uso
 *   medido nas duas agências é zero.
 *
 * A TRAVA QUE MAIS IMPORTA AQUI
 *   Comentário é texto de TERCEIRO. O HTML produzido tem que mostrar que
 *   `javascript:` num comentário NÃO virou `href`, e que uma tentativa de
 *   injetar marcação saiu como texto. Nenhum outro teste do projeto cobre esse
 *   caminho, porque nenhum outro desenha texto que outra pessoa escreveu.
 *
 * SEM NAVEGADOR, E POR ISSO SEM `useEffect`
 *   A suíte roda em ambiente `node`. `renderToStaticMarkup` monta a árvore e não
 *   roda efeito — o que se prova aqui é o PRIMEIRO quadro.
 *
 * ESCRITO EM `createElement`, E NÃO EM JSX
 *   A suíte só inclui `*.test.ts`. Um `.tsx` não seria executado — e teste que
 *   não roda é pior que teste nenhum, porque conta como cobertura.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AnexosDaTarefa, EXPLICACAO_DOS_ANEXOS, SOBRE_DOS_ANEXOS } from '@/board/AnexosDaTarefa';
import { ConversaDaTarefa, EXPLICACAO_DA_CONVERSA, SOBRE_DA_CONVERSA } from '@/board/ConversaDaTarefa';
import type { Anexo, Comentario, Link } from '@/board/conversa';
import type { TaskDetail } from '@/board/ficha';
import { SEM_PROGRESSO } from '@/board/passos';

const FICHA: TaskDetail = {
  id: '604ef3c5-a635-45f0-914b-087c47f9eb85',
  title: '[A] JATOBÁ - NÚMERO ALTO DE INVESTIDORES',
  description: null,
  listId: 'l1',
  listName: 'Jatobá',
  folderId: null,
  folderName: null,
  spaceId: 's1',
  spaceName: 'AGÊNCIA IDE',
  categoryName: 'Ide',
  statusId: 'st1',
  priority: null,
  dueOn: null,
  startOn: null,
  customItemId: null,
  taskTypeId: null,
  taskTypeName: null,
  taskTypeMissing: false,
  clientId: null,
  clientName: null,
  assignees: [],
  watchers: [],
  tags: [],
  completedAt: null,
  completedBy: null,
  archivedAt: null,
  createdBy: null,
  createdAt: '2026-08-26T10:00:00.000Z',
  updatedAt: '2026-08-26T10:00:00.000Z',
  statuses: [],
  statusSetName: 'Demandas',
  inheritedFrom: 'space',
  availableTags: [],
  availableTypes: [],
  parentId: null,
  parentTitle: null,
  subtasks: [],
  checklists: [],
  comments: [],
  attachments: [],
  links: [],
  // Tarefa que nunca passou por etapa automatizada — o caso normal (F17.41).
  history: [],
  progress: SEM_PROGRESSO,
};

/** O comentário REAL medido na Agência Ide: o endereço do Dropbox, cru. */
const O_LINK_REAL =
  'www.dropbox.com/scl/fo/exemplo00000000000000/AAexemploDePasta000000_X?rlkey=abc';

const fala = (p: Partial<Comentario>): Comentario => ({
  id: 'c1',
  parentId: null,
  body: O_LINK_REAL,
  author: { id: 'a', name: 'Ana Designer' },
  createdAt: '2026-08-26T10:00:00.000Z',
  editedAt: null,
  replyCount: 0,
  mine: false,
  replies: [],
  ...p,
});

const anexo = (p: Partial<Anexo>): Anexo => ({
  id: 'x1',
  fileName: 'Jatobá Investimentos - Roteiro Leads quiz 1.pdf',
  extension: 'pdf',
  contentType: 'application/pdf',
  byteSize: 2_100_000,
  uploadedBy: { id: 'a', name: 'Ana Designer' },
  createdAt: '2026-08-26T10:00:00.000Z',
  ...p,
});

const link = (p: Partial<Link>): Link => ({
  id: 'k1',
  label: 'Pasta de entrega',
  url: 'https://www.dropbox.com/scl/fo/abc',
  sortOrder: 0,
  createdBy: null,
  createdAt: '2026-08-26T10:00:00.000Z',
  ...p,
});

const conversa = (tarefa: TaskDetail): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ConversaDaTarefa, {
        tarefa,
        ocupado: false,
        aoAssentar: () => {},
        aoErro: () => {},
      }),
    ),
  );

const anexos = (tarefa: TaskDetail, envioPronto = true, variavel = 'A_CHAVE'): string =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(AnexosDaTarefa, {
        tarefa,
        ocupado: false,
        envioPronto,
        variavelQueFalta: variavel,
        aoAssentar: () => {},
        aoErro: () => {},
      }),
    ),
  );

/* ───────────────────────────── 📎 anexar arquivo ───────────────────────────── */

describe('a seção de anexo tem a forma da referência', () => {
  const html = anexos(FICHA);

  it('o cabeçalho é `Anexar arquivo`, como na ficha real', () => {
    expect(html).toContain('Anexar arquivo');
  });

  it('e o link externo entra ao lado — Dropbox e Google Docs são o padrão da casa', () => {
    expect(html).toContain('Guardar link');
  });

  it('a seção diz que o balde é PRIVADO, e que o endereço vence', () => {
    // Não é enfeite: a equipe vem de um sistema cujo balde é público, e a
    // diferença precisa estar escrita onde ela trabalha.
    // F43, Fase 6: a nota foi para o `?` do título da seção — ela explica a
    // seção. Cobra-se o botão que a abre, e a frase com as duas coisas.
    expect(html).toContain(`aria-label="Explicar: ${SOBRE_DOS_ANEXOS}"`);
    expect(EXPLICACAO_DOS_ANEXOS).toContain('privado');
    expect(EXPLICACAO_DOS_ANEXOS).toContain('5 minutos');
  });

  it('⚠️ O TETO É DITO ANTES DA ESCOLHA, no próprio botão — F17.17', () => {
    // Ele estava só na nota do rodapé e na frase da recusa: a pessoa descobria
    // o limite DEPOIS de escolher o arquivo, que é tarde. `até 5 MB` no botão
    // custa cinco caracteres e evita a escolha inútil.
    expect(html).toContain('a-teto');
    expect(html).toContain('até 5 MB');
  });

  it('e a nota diz o teto e a saída, na mesma frase', () => {
    // F43, Fase 6: a frase mora no `?` (acima); o teto continua À VISTA no
    // próprio botão (`até 5 MB`, F17.17), e é esse que evita a escolha inútil.
    expect(EXPLICACAO_DOS_ANEXOS).toContain('Cada arquivo vai até 5 MB');
    expect(EXPLICACAO_DOS_ANEXOS).toContain('Guardar link');
    expect(html).not.toContain('Cada arquivo vai até');
    expect(html).toContain('Guardar link');
  });
});

describe('a ficha do arquivo mostra nome e tamanho SEMPRE', () => {
  const html = anexos({ ...FICHA, attachments: [anexo({})] });

  it('o nome do PDF de roteiro real', () => {
    expect(html).toContain('Roteiro Leads quiz 1.pdf');
  });

  it('o tamanho na base que a pessoa vê no computador dela', () => {
    // `2 MB`, e não `2,0 MB`: a casa decimal zerada saiu na F17.17, para o teto
    // do envio ser escrito `5 MB` — que se lê como regra — e não `5,0 MB`, que
    // se lê como aproximação. A casa que não é zero continua aparecendo.
    expect(html).toContain('2 MB');
  });

  it('a extensão como selo, vinda da coluna GERADA do banco', () => {
    expect(html).toContain('>pdf<');
  });

  it('quem enviou', () => {
    expect(html).toContain('Ana Designer');
  });

  it('PDF oferece `ver aqui`; um `.zip` não oferece', () => {
    expect(html).toContain('ver aqui');
    const zip = anexos({
      ...FICHA,
      attachments: [anexo({ contentType: 'application/zip', extension: 'zip', fileName: 'artes.zip' })],
    });
    expect(zip).not.toContain('ver aqui');
    // Mas continua listado, com nome e tamanho: o que não se pré-visualiza
    // ainda se baixa.
    expect(zip).toContain('artes.zip');
  });
});

describe('o link guardado mostra o destino, e não só o rótulo', () => {
  const html = anexos({ ...FICHA, links: [link({})] });

  it('o rótulo é o clique', () => {
    expect(html).toContain('Pasta de entrega');
    expect(html).toContain('href="https://www.dropbox.com/scl/fo/abc"');
  });

  it('e o ENDEREÇO aparece ao lado — rótulo amigável não pode esconder o destino', () => {
    expect(html).toContain('a-link-alvo');
    // O endereço INTEIRO continua alcançável, no `title` — o que saiu da linha
    // foi a parede de `rlkey` e `dl=0`, não a informação.
    expect(html).toContain('title="https://www.dropbox.com/scl/fo/abc"');
  });

  it('abre em aba nova sem entregar de onde veio', () => {
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

/* ───────────────────────────── a prévia do link (F17.17) ───────────────────────────── */

/**
 * A PRÉVIA É MONTADA DO PRÓPRIO ENDEREÇO, E O PRIMEIRO QUADRO PROVA ISSO.
 *
 * A suíte roda em `node`, sem navegador e sem efeito — então o que este bloco
 * mede é exatamente o que o servidor renderiza no primeiro quadro. Se a prévia
 * dependesse de buscar metadados, o primeiro quadro viria vazio e estes testes
 * falhariam. Eles passam porque `lerLink` é pura.
 */
describe('a prévia do link é lida do endereço, e nunca quebra a tela', () => {
  it('a pasta do Dropbox aparece como PASTA, e não como um caminho de sorteio', () => {
    const html = anexos({ ...FICHA, links: [link({})] });
    expect(html).toContain('>Pasta<');
    expect(html).toContain('Dropbox');
  });

  it('o PDF de roteiro traz tipo, hospedeiro e o NOME do arquivo', () => {
    const html = anexos({
      ...FICHA,
      links: [
        link({
          label: 'Roteiro',
          url: 'https://www.dropbox.com/scl/fi/9/Roteiro%20Leads%20quiz%201.pdf?rlkey=k&dl=0',
        }),
      ],
    });
    expect(html).toContain('>PDF<');
    expect(html).toContain('Roteiro Leads quiz 1.pdf');
  });

  it('o Google Docs é reconhecido — ele aparece muito nas tarefas reais', () => {
    const html = anexos({
      ...FICHA,
      links: [link({ label: 'Briefing', url: 'https://docs.google.com/document/d/1abc/edit' })],
    });
    expect(html).toContain('Google Docs');
    expect(html).toContain('>Documento<');
  });

  it('⚠️ NENHUMA IMAGEM CARREGA SOZINHA — o Dropbox não fica sabendo quem abriu a tarefa', () => {
    const html = anexos({
      ...FICHA,
      links: [link({ label: 'Arte', url: 'https://www.dropbox.com/scl/fi/1/arte.png?rlkey=k' })],
    });
    // O primeiro quadro tem o BOTÃO, e não a `<img>`. A requisição ao Dropbox
    // só sai no gesto, e aí com `no-referrer`.
    expect(html).toContain('ver imagem');
    expect(html).not.toContain('<img');
  });

  it('link de hospedeiro desconhecido NÃO oferece prévia de imagem', () => {
    // Senão todo link colado numa tarefa viraria pixel de rastreio.
    const html = anexos({
      ...FICHA,
      links: [link({ label: 'Pixel', url: 'https://rastreador.example.com/a.png' })],
    });
    expect(html).not.toContain('ver imagem');
    // Mas continua listado e clicável — a prévia pobre não some com o link.
    expect(html).toContain('Pixel');
    expect(html).toContain('rastreador.example.com');
  });

  it('e NADA de `dangerouslySetInnerHTML` — o endereço veio de terceiro', () => {
    const html = anexos({ ...FICHA, links: [link({})] });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });
});

describe('nenhum botão morto: sem a credencial, o anexar fica DESATIVADO e diz por quê', () => {
  const html = anexos(FICHA, false, 'A_VARIAVEL_QUE_FALTA');

  it('o botão está desativado', () => {
    expect(html).toContain('disabled=""');
  });

  it('a faixa explica que falta uma credencial, e a variável fica onde quem VAI LIGAR a acha', () => {
    expect(html).toContain('ainda não está ligado');
    /*
      ⚠️ A ASSERÇÃO MUDOU DE ALVO NA F17.24, E ESTA NOTA EXISTE PARA ELA NÃO
      PASSAR POR ENGANO.

      Antes, o nome da variável estava no PARÁGRAFO. A F17.24 o levou para
      dentro do `?` — ele é matéria de quem vai ligar o envio, não de quem
      quer entregar um vídeo, e o parágrafo tinha seis linhas por causa dele.

      Um `toContain('A_VARIAVEL_QUE_FALTA')` seco continuaria VERDE depois
      dessa mudança, porque o nome também está no `title` do botão desativado
      — e ficaria verde até o dia em que sumisse dos dois. Então a asserção
      passa a cobrar o LUGAR: o `title`, que é o que aparece sem clique
      nenhum.
    */
    /*
      F07 do plano UX: a dica do botão desativado passou a falar com quem USA
      a ficha. O nome da variável é detalhe de configuração e não pode ser a
      instrução principal — fica só dentro do `?`, rotulado para quem administra
      (fechado no desenho inicial, então nem aparece aqui).
    */
    expect(html).toContain('title="O envio de arquivo ainda não está disponível — use Guardar link"');
    expect(html).not.toContain('A_VARIAVEL_QUE_FALTA');
  });

  it('e diz o que CONTINUA funcionando — senão a pessoa desiste da seção inteira', () => {
    // Sem a marcação: a F17.24 pôs `Guardar link` em negrito dentro da frase, e
    // um `toContain` com `<b>` no meio provaria a marcação, não a mensagem.
    const semMarcacao = html.replace(/<[^>]+>/g, '');
    expect(semMarcacao).toContain('Guardar link funciona desde já');
  });

  it('com a credencial de pé, a faixa some e o campo de arquivo aparece', () => {
    const pronto = anexos(FICHA, true);
    expect(pronto).not.toContain('ainda não está ligado');
    expect(pronto).toContain('type="file"');
  });
});

/* ───────────────────────────── a conversa ───────────────────────────── */

describe('o bloco de comentários tem a forma da referência', () => {
  const html = conversa(FICHA);

  it('o cabeçalho `Comentários` com a contagem', () => {
    expect(html).toContain('Comentários');
    expect(html).toContain('nenhum comentário');
  });

  it('o campo de escrever fica SEMPRE aberto — comentar é o gesto que fecha a tarefa', () => {
    expect(html).toContain('role="textbox"');
    expect(html).toContain('Comentar');
  });

  it('a dica do campo fala da entrega de verdade', () => {
    expect(html).toContain('Dropbox');
  });

  it('a nota explica a tecla: Ctrl+Enter envia, Enter quebra linha', () => {
    // F43, Fase 6: o parágrafo fixo do pé virou o `?` ao lado do clipe. A
    // tecla continua explicada — atrás de um botão de verdade, com nome.
    expect(html).toContain(`aria-label="Explicar: ${SOBRE_DA_CONVERSA}"`);
    expect(EXPLICACAO_DA_CONVERSA).toContain('Ctrl+Enter envia; Enter quebra linha');
    expect(html).not.toContain('Ctrl+Enter');
  });

  it('⚠️ TAREFA VAZIA NÃO MOSTRA CAIXA VAZIA — e a tela não fala sobre si mesma', () => {
    // 1.758 das 1.829 tarefas não têm autor nem evento nem comentário. O fio
    // simplesmente não é desenhado; o que aparece é o campo de escrever, que já
    // aparecia. Nenhuma frase sobre o próprio sistema (F17.37).
    expect(html).not.toContain('c-fio');
    expect(html).not.toContain('c-mudanca');
    expect(html).not.toContain('histórico');
    expect(html).not.toContain('ainda não');
  });
});

/* ─────────────── a linha do tempo — F17.65 ─────────────── */

describe('⚠️ OS COMENTÁRIOS ENTRAM NO MEIO DA MOVIMENTAÇÃO, na mesma coluna', () => {
  /*
    É o pedido do usuário, com as duas capturas do painel `Activity`: a fala e
    a mudança são degraus da MESMA lista, e é essa mistura que torna a coluna
    legível — o comentário explica a mudança que veio logo antes dele.

    Sem isto haveria duas listas na mesma tela, com dois relógios, e quem lê
    teria de intercalá-las de cabeça.
  */
  const html = conversa({
    ...FICHA,
    createdBy: { id: 'n', name: 'Nara' },
    createdAt: '2026-08-26T09:00:00.000Z',
    comments: [fala({ id: 'c1', createdAt: '2026-08-26T10:00:00.000Z' })],
    progress: { ...SEM_PROGRESSO, commentCount: 1 },
    history: [
      {
        id: '31',
        automationName: null,
        actorName: 'Helena',
        fromListName: 'Estúdio Ide',
        toListName: 'ESTÚDIO',
        fromStatusName: 'Aprovação',
        toStatusName: 'Enviar Fotos Ao Cliente',
        removed: ['Murilo Siqueira'],
        added: [],
        occurredAt: '2026-08-26T11:00:00.000Z',
      },
    ],
  });

  it('desenha o nascimento, a fala e a mudança no MESMO fio', () => {
    expect(html).toContain('criou esta tarefa');
    expect(html).toContain('Ana Designer');
    expect(html).toContain('alterou o status de Aprovação para Enviar Fotos Ao Cliente');
  });

  it('e na ordem do relógio: criação, comentário, mudança', () => {
    const ondeCriou = html.indexOf('criou esta tarefa');
    const ondeFalou = html.indexOf('Ana Designer');
    const ondeMexeu = html.indexOf('alterou o status');
    expect(ondeCriou).toBeLessThan(ondeFalou);
    expect(ondeFalou).toBeLessThan(ondeMexeu);
  });

  it('o cabeçalho diz as DUAS coisas que a coluna mostra', () => {
    expect(html).toContain('Comentários e movimentação');
  });

  it('a contagem continua sendo a de COMENTÁRIO, e não a do fio inteiro', () => {
    // `progress.commentCount` vem de `ideworks.task_progress`, a única definição
    // da contagem. Somar movimentação nela faria dois números para uma pergunta.
    expect(html).toContain('1 comentário');
  });
});

describe('a fala mostra autor, instante e o texto desenhado', () => {
  const html = conversa({
    ...FICHA,
    comments: [fala({})],
    progress: { ...SEM_PROGRESSO, commentCount: 1 },
  });

  it('o autor', () => {
    expect(html).toContain('Ana Designer');
  });

  it('O ENDEREÇO CRU VIROU CLIQUE — é a razão da etapa existir', () => {
    expect(html).toContain('href="https://www.dropbox.com/scl/fo/exemplo00000000000000');
  });

  it('e o texto do link continua o que a pessoa escreveu', () => {
    expect(html).toContain('www.dropbox.com/scl/fo/exemplo00000000000000');
  });

  it('`Responder` aparece para qualquer um', () => {
    expect(html).toContain('Responder');
  });

  it('`Editar` e `Apagar` NÃO aparecem quando não é meu', () => {
    expect(html).not.toContain('>Editar<');
    expect(html).not.toContain('>Apagar<');
  });

  it('e aparecem quando é meu — e quem decide isso é o SERVIDOR, não a tela', () => {
    const meu = conversa({
      ...FICHA,
      comments: [fala({ mine: true })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    expect(meu).toContain('>Editar<');
    expect(meu).toContain('>Apagar<');
  });
});

describe('a edição é um INSTANTE, e não a palavra "editado"', () => {
  it('escreve QUANDO foi editado, com dia e hora', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ editedAt: '2026-08-26T14:32:00.000Z' })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    expect(html).toContain('editado');
    // A HORA É A DE QUEM OLHA, e por isso o teste não fixa `14:32`: a suíte roda
    // no fuso da máquina, e `formatarInstante` converte de propósito
    // (`created_at` é instante com fuso, ao contrário do prazo, que é dia). O
    // que se prova é que a hora ESTÁ ESCRITA — o contrário de um "editado" seco.
    expect(html).toMatch(/editado \d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}/);
  });

  it('e não escreve nada quando ninguém editou', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({})],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    expect(html).not.toContain('editado');
  });
});

describe('a resposta em linha — UM nível, recuado', () => {
  const html = conversa({
    ...FICHA,
    comments: [
      fala({ id: 'c1', body: 'segue a pasta', replyCount: 2 }),
      fala({ id: 'r1', parentId: 'c1', body: 'recebi', createdAt: '2026-08-26T11:00:00.000Z' }),
      fala({ id: 'r2', parentId: 'c1', body: 'aprovado', createdAt: '2026-08-26T12:00:00.000Z' }),
    ],
    progress: { ...SEM_PROGRESSO, commentCount: 3 },
  });

  it('as respostas aparecem dentro do comentário', () => {
    expect(html).toContain('recebi');
    expect(html).toContain('aprovado');
    expect(html).toContain('c-respostas');
  });

  it('a contagem de respostas é a do SERVIDOR — o `reply_count` do ClickUp', () => {
    expect(html).toContain('2 respostas');
  });

  it('a resposta vem DEPOIS do comentário que ela responde', () => {
    expect(html.indexOf('segue a pasta')).toBeLessThan(html.indexOf('recebi'));
  });

  it('e o recuo é UM só — não existe neto, porque o banco não deixa nascer', () => {
    // `task_comments_parent_fk` com as duas colunas geradas torna o neto
    // impossível. Se um dia aparecer um segundo `c-respostas` aninhado, é
    // porque a invariante do banco caiu.
    expect(html.split('c-respostas').length - 1).toBe(1);
  });
});

/* ───────────────────────────── a trava que mais importa ───────────────────────────── */

describe('COMENTÁRIO É TEXTO DE TERCEIRO — e ele não vira marcação', () => {
  it('`javascript:` escrito como link de markdown NÃO vira `href`', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ body: '[clique aqui](javascript:alert(1))' })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('href="javascript');
    // O texto do link não some — some o clique, e não a informação.
    expect(html).toContain('clique aqui');
  });

  it('`javascript:` colado CRU também não vira clique', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ body: 'javascript:alert(document.cookie)' })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    expect(html).not.toContain('href="javascript');
  });

  it('marcação escrita no comentário sai como TEXTO, e não como elemento', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ body: '<img src=x onerror=alert(1)>' })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    // NÃO existe uma tag `<img>` no que saiu — nenhum elemento foi criado.
    expect(html).not.toMatch(/<img\b/);
    // O `onerror` continua no HTML, e TEM QUE continuar: ele saiu ESCAPADO,
    // dentro de `&lt;img src=x onerror=alert(1)&gt;`, como texto que a pessoa
    // lê. Exigir que a palavra sumisse seria exigir que o sistema APAGASSE o
    // comentário de alguém — que é pior do que mostrá-lo inerte.
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('o markdown de verdade continua funcionando — negrito e lista', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ body: '**pronto**\n\n- arte\n- vídeo' })],
      progress: { ...SEM_PROGRESSO, commentCount: 1 },
    });
    // O `<span>` interno é do `Markdown.tsx`: cada nó de texto vira um `<span>`
    // com chave, porque a árvore é montada em React e não em HTML.
    expect(html).toContain('<strong><span>pronto</span></strong>');
    expect(html).toContain('<li');
  });
});

/* ───────────────────────────── o que NÃO é desta etapa ───────────────────────────── */

describe('as seções de outras etapas não são desenhadas', () => {
  it('nem campos personalizados (F17.5), nem dependências', () => {
    // `Vincular itens` NÃO ENTRA NUNCA: o uso medido nas duas agências é zero,
    // e o usuário confirmou. Desenhá-la seria prometer o que ninguém quer.
    const html = anexos(FICHA) + conversa(FICHA);
    expect(html).not.toContain('Adicione os campos');
    expect(html).not.toContain('Vincular itens');
    expect(html).not.toContain('dependência');
  });
});

/* ───────────────────────────── a D10 ───────────────────────────── */

describe('A D10 NA TELA: nenhuma cor literal do Tailwind no que ela desenha', () => {
  // Mesma rede de `tela-da-tarefa.test.ts` e `tela-dos-passos.test.ts`. Olha o
  // HTML PRODUZIDO, e não a fonte — é o que sobra depois de toda condicional.
  const PALETA_DO_TAILWIND =
    /\b(?:bg|text|border|from|to|via|fill|stroke|ring|divide|shadow|outline|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

  it('a seção de anexo, cheia', () => {
    const html = anexos({ ...FICHA, attachments: [anexo({})], links: [link({})] });
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a seção de anexo, pendente', () => {
    expect(anexos(FICHA, false, 'X')).not.toMatch(PALETA_DO_TAILWIND);
  });

  it('a conversa, com resposta', () => {
    const html = conversa({
      ...FICHA,
      comments: [fala({ id: 'c1', mine: true, replyCount: 1 }), fala({ id: 'r1', parentId: 'c1' })],
      progress: { ...SEM_PROGRESSO, commentCount: 2 },
    });
    expect(html).not.toMatch(PALETA_DO_TAILWIND);
  });
});

describe('imagens temporárias para correção', () => {
  it('oferece seleção de imagem e informa o prazo antes do envio', () => {
    const html = conversa(FICHA);
    expect(html).toContain('Anexar imagem');
    expect(html).toContain('accept="image/png,image/jpeg"');
    // F43, Fase 6: o prazo segue À VISTA no `title` do clipe, que é onde a
    // escolha acontece; a frase inteira mora no `?` do campo.
    expect(html).toContain('disponível por 10 dias');
    expect(EXPLICACAO_DA_CONVERSA).toContain('excluídas após 10 dias');
  });

  it('exibe prints na conversa com validade e mantém anexos permanentes na seção de arquivos', () => {
    const tarefa = { ...FICHA, attachments: [
      anexo({ id: 'print', fileName: 'correcao.png', contentType: 'image/png', expiresAt: '2026-09-21T10:00:00Z' }),
      anexo({ id: 'entrega', fileName: 'entrega.pdf', contentType: 'application/pdf' }),
    ] };
    const html = conversa(tarefa);
    expect(html).toContain('correcao.png');
    expect(html).toContain('Exclusão em');
    expect(html).not.toContain('entrega.pdf');
    const arquivos = anexos(tarefa);
    expect(arquivos).toContain('entrega.pdf');
    expect(arquivos).not.toContain('correcao.png');
  });
});

it('imagens destinadas ao texto não reaparecem soltas quando um rascunho é descartado', () => {
  const tarefa = { ...FICHA, attachments: [anexo({
    id: '12345678-1234-1234-1234-123456789abc', fileName: 'rascunho.png',
    inText: true, expiresAt: '2026-09-21T10:00:00Z',
  })] };
  const html = conversa(tarefa);
  expect(html).not.toContain('imagens-anteriores');
  expect(html).not.toContain('rascunho.png');
});

/* ─────────── F10: comentário apontado por notificação que sumiu ─────────── */

describe('F10 — o link da notificação aponta um comentário que não está mais lá', () => {
  const comHash = (tarefa: TaskDetail, hash: string): string =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [`/tarefa/${tarefa.id}${hash}`] },
        createElement(ConversaDaTarefa, { tarefa, ocupado: false, aoAssentar: () => {}, aoErro: () => {} }),
      ),
    );
  const ID_PRESENTE = 'aaaaaaaa-0000-4000-8000-000000000001';
  const ID_APAGADO = 'bbbbbbbb-0000-4000-8000-000000000002';
  const tarefa = { ...FICHA, comments: [fala({ id: ID_PRESENTE })] };

  it('comentário apagado: a ficha abre e diz por que nada foi destacado, sem revelar texto', () => {
    const html = comHash(tarefa, `#comentario-${ID_APAGADO}`);
    expect(html).toContain('data-alvo-ausente');
    expect(html).toContain('O comentário desta notificação não está mais nesta tarefa');
    expect(html).not.toContain(ID_APAGADO);
  });

  it('comentário presente, ou sem hash: nenhuma linha extra', () => {
    expect(comHash(tarefa, `#comentario-${ID_PRESENTE}`)).not.toContain('data-alvo-ausente');
    expect(comHash(tarefa, '')).not.toContain('data-alvo-ausente');
  });
});

/* ─────────────── F42, Fase 7 — o comentário do cliente no card ─────────────── */

describe('o comentário do cliente na conversa', () => {
  const doCliente = fala({
    id: 'cli-1',
    body: 'A cor da arte está escura.',
    author: null,
    fromClient: true,
    approvalItemName: 'arte-1.jpg',
    approvalItemPosition: 1,
    approvalVersion: 2,
  });
  const html = conversa({ ...FICHA, comments: [doCliente, fala({ id: 'eq-1', mine: true })] });

  it('autor nulo vira "Cliente (pelo link)", com o selo "do cliente" e o material', () => {
    expect(html).toContain('Cliente (pelo link)');
    expect(html).toContain('>do cliente</span>');
    expect(html).toContain('sobre arte-1.jpg · v2');
    expect(html).toContain('data-do-cliente="true"');
    expect(html).not.toContain('autor sem perfil');
    expect(html).toContain('A cor da arte está escura.');
  });

  it('ninguém da equipe edita nem apaga o que o cliente escreveu', () => {
    const falaDoCliente = html.slice(html.indexOf('id="comentario-cli-1"'), html.indexOf('id="comentario-eq-1"'));
    expect(falaDoCliente).toContain('Responder');
    expect(falaDoCliente).not.toContain('>Editar<');
    expect(falaDoCliente).not.toContain('>Apagar<');
  });

  it('o comentário da decisão (sem material) diz só a versão; conta apagada continua "autor sem perfil"', () => {
    const decisao = conversa({
      ...FICHA,
      comments: [fala({ id: 'cli-2', author: null, fromClient: true, approvalVersion: 1, body: 'Ajustem a logo.' })],
    });
    expect(decisao).toContain('>v1</span>');
    expect(decisao).not.toContain('sobre ');
    const semPerfil = conversa({ ...FICHA, comments: [fala({ id: 'x-9', author: null })] });
    expect(semPerfil).toContain('autor sem perfil');
    expect(semPerfil).not.toContain('do cliente');
  });
});
