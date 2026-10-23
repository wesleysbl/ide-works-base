import { describe, expect, it } from 'vitest';

import {
  type ClientBoardListRow,
  assembleClientBoardLists,
  avisoDeTransferenciaDaLista,
  FRASE_AO_DESLIGAR_LISTA,
  listasAlcancaveisDaArvore,
  rotuloDaListaDoQuadro,
  rotuloDeListaLigada,
} from '@/clients/listas-do-quadro';

const linha = (mudou: Partial<ClientBoardListRow>): ClientBoardListRow => ({
  id: 'l-1',
  name: 'Demandas',
  archived: false,
  spaceId: 's-helena',
  spaceName: 'TIME HELENA',
  folderId: null,
  folderName: null,
  liveTasks: 0,
  totalTasks: 0,
  ...mudou,
});

describe('assembleClientBoardLists', () => {
  it('nenhuma lista devolve lista vazia, nunca erro', () => {
    expect(assembleClientBoardLists([])).toEqual([]);
  });

  it('uma lista sai na forma aninhada, com pasta nula quando não há pasta', () => {
    expect(
      assembleClientBoardLists([
        linha({ liveTasks: 2, totalTasks: 5, folderId: null, folderName: null }),
      ]),
    ).toEqual([
      {
        id: 'l-1',
        name: 'Demandas',
        archived: false,
        space: { id: 's-helena', name: 'TIME HELENA' },
        folder: null,
        liveTasks: 2,
        totalTasks: 5,
      },
    ]);
  });

  it('várias listas ordenam por espaço e depois por nome', () => {
    const montadas = assembleClientBoardLists([
      linha({
        id: 'l-zebra',
        name: 'Zebra',
        spaceId: 's-juca',
        spaceName: 'TIME JUCA',
      }),
      linha({
        id: 'l-beta',
        name: 'Beta',
        spaceId: 's-helena',
        spaceName: 'TIME HELENA',
        folderId: 'f-1',
        folderName: 'Clientes',
      }),
      linha({
        id: 'l-alpha',
        name: 'Alpha',
        spaceId: 's-helena',
        spaceName: 'TIME HELENA',
      }),
    ]);

    expect(montadas.map((l) => l.id)).toEqual(['l-alpha', 'l-beta', 'l-zebra']);
    expect(montadas[1].folder).toEqual({ id: 'f-1', name: 'Clientes' });
  });

  it('lista arquivada no meio permanece no meio — arquivar não reordena', () => {
    const montadas = assembleClientBoardLists([
      linha({ id: 'l-gamma', name: 'Gamma', archived: false }),
      linha({ id: 'l-alpha', name: 'Alpha', archived: false }),
      linha({ id: 'l-beta', name: 'Beta', archived: true, liveTasks: 0, totalTasks: 4 }),
    ]);

    expect(montadas.map((l) => ({ id: l.id, archived: l.archived }))).toEqual([
      { id: 'l-alpha', archived: false },
      { id: 'l-beta', archived: true },
      { id: 'l-gamma', archived: false },
    ]);
  });

  it('nome nulo permanece nulo — inventar revelaria o time que a pessoa não alcança', () => {
    const [lista] = assembleClientBoardLists([
      linha({
        id: 'l-secreta',
        name: null,
        spaceName: null,
        folderId: 'f-oculto',
        folderName: null,
        liveTasks: 3,
        totalTasks: 9,
      }),
    ]);

    expect(lista.name).toBeNull();
    expect(lista.space).toEqual({ id: 's-helena', name: null });
    expect(lista.folder).toEqual({ id: 'f-oculto', name: null });
    expect(lista.id).toBe('l-secreta');
    expect(lista.liveTasks).toBe(3);
    expect(lista.totalTasks).toBe(9);
  });

  it('duas chamadas seguidas, mesmo embaralhado, devolvem a mesma ordem', () => {
    const entrada: ClientBoardListRow[] = [
      linha({ id: 'l-c', name: 'Caldas', spaceId: 's-b', spaceName: 'Brisa' }),
      linha({ id: 'l-a', name: 'Alpha', spaceId: 's-a', spaceName: 'Agência Ide' }),
      linha({ id: 'l-b', name: 'Beta', spaceId: 's-a', spaceName: 'Agência Ide', archived: true }),
    ];

    const primeira = assembleClientBoardLists(entrada);
    const segunda = assembleClientBoardLists([...entrada].reverse());

    expect(primeira.map((l) => l.id)).toEqual(['l-a', 'l-b', 'l-c']);
    expect(segunda).toEqual(primeira);
  });
});

describe('listasAlcancaveisDaArvore', () => {
  const linha = (mudou: Partial<Parameters<typeof listasAlcancaveisDaArvore>[0][number]>) => ({
    listId: 'l-1',
    listName: 'Demandas',
    spaceName: 'TIME HELENA',
    folderName: null as string | null,
    listArchivedAt: null as string | null,
    clientId: null as string | null,
    clientName: null as string | null,
    ...mudou,
  });

  it('ignora espaço ou pasta sem lista — o seletor só oferece lista', () => {
    expect(
      listasAlcancaveisDaArvore([
        linha({ listId: null, listName: null, spaceName: 'Vazio' }),
        linha({ listId: 'l-viva', listName: 'Viva' }),
      ]).map((l) => l.id),
    ).toEqual(['l-viva']);
  });

  it('não oferece a mesma lista duas vezes', () => {
    expect(
      listasAlcancaveisDaArvore([linha({ listId: 'l-1' }), linha({ listId: 'l-1' })]).map(
        (l) => l.id,
      ),
    ).toEqual(['l-1']);
  });

  it('traz o cliente atual da lista, para o aviso de transferência', () => {
    const [lista] = listasAlcancaveisDaArvore([
      linha({
        clientId: 'c-jatoba',
        clientName: 'Jatobá',
        folderName: 'Clientes',
        listArchivedAt: '2026-01-01T00:00:00Z',
      }),
    ]);
    expect(lista.clientId).toBe('c-jatoba');
    expect(lista.clientName).toBe('Jatobá');
    expect(lista.folderName).toBe('Clientes');
    expect(lista.archived).toBe(true);
  });
});

describe('rotuloDaListaDoQuadro', () => {
  it('mostra espaço e pasta junto do nome — nomes iguais em espaços diferentes são o caso comum', () => {
    expect(
      rotuloDaListaDoQuadro({
        name: 'Demandas',
        spaceName: 'TIME HELENA',
        folderName: 'Setembro',
      }),
    ).toBe('Demandas · TIME HELENA · Setembro');
    expect(
      rotuloDaListaDoQuadro({
        name: 'Demandas',
        spaceName: 'TIME JUCA',
        folderName: null,
      }),
    ).toBe('Demandas · TIME JUCA');
  });

  it('marca arquivada no rótulo, sem escondê-la da escolha', () => {
    expect(
      rotuloDaListaDoQuadro({
        name: 'Antiga',
        spaceName: 'Agência Ide',
        folderName: null,
        archived: true,
      }),
    ).toBe('Antiga · Agência Ide (arquivada)');
  });
});

describe('rotuloDeListaLigada', () => {
  it('nome nulo não é adivinhado — a pessoa vê que o vínculo existe, sem o quadro do outro time', () => {
    expect(
      rotuloDeListaLigada({
        id: 'l-secreta',
        name: null,
        archived: false,
        space: { id: 's-x', name: null },
        folder: null,
        liveTasks: 0,
        totalTasks: 0,
      }),
    ).toBe('Lista fora do seu alcance no quadro');
  });
});

describe('avisoDeTransferenciaDaLista', () => {
  it('não avisa quando a lista não tem cliente, nem quando já é deste', () => {
    expect(avisoDeTransferenciaDaLista({ clientId: null, clientName: null }, 'c-1')).toBeNull();
    expect(
      avisoDeTransferenciaDaLista({ clientId: 'c-1', clientName: 'Ótica Rubi' }, 'c-1'),
    ).toBeNull();
  });

  it('avisa de quem a lista é, e que ligar aqui tira ela de lá', () => {
    expect(
      avisoDeTransferenciaDaLista({ clientId: 'c-jac', clientName: 'Jatobá' }, 'c-rose'),
    ).toBe('Esta lista já é de Jatobá. Ligar aqui tira ela de lá.');
  });

  it('sem o nome do outro cliente, ainda avisa da transferência', () => {
    expect(avisoDeTransferenciaDaLista({ clientId: 'c-x', clientName: null }, null)).toBe(
      'Esta lista já é de outro cliente. Ligar aqui tira ela de lá.',
    );
  });
});

describe('FRASE_AO_DESLIGAR_LISTA', () => {
  it('diz com todas as letras que soltar não apaga a lista', () => {
    expect(FRASE_AO_DESLIGAR_LISTA).toMatch(/solta o vínculo/i);
    expect(FRASE_AO_DESLIGAR_LISTA).toMatch(/não apaga a lista/i);
    expect(FRASE_AO_DESLIGAR_LISTA).toMatch(/continua no quadro/i);
  });
});
