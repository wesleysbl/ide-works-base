/**
 * O TIPO DA TAREFA NA TELA — F40, Fase 4.
 *
 * Desenhado no servidor (`renderToStaticMarkup`): nenhum `useEffect` roda. Prova
 * o primeiro quadro de cada peça e a regra pura. O fluxo (criar sem tipo não
 * salva, com "Vídeo" salva e o selo aparece) está em `scripts/e2e/tipo-do-card.mjs`.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { CARTOES_POR_COLUNA, type Board } from '@/board/board';
import { SEM_FILTRO } from '@/board/filtro';
import { ModalDeTarefa } from '@/board/ModalDeTarefa';
import { AdicionarNaColuna } from '@/board/pecas-da-ficha';
import { SeletorDoTipo, SeloDoTipo } from '@/board/SeletorDoTipo';
import {
  FRASE_FALTA_TIPO,
  faltaTipo,
  fraseDaRecusa,
  opcoesDaFicha,
  rotuloDoTipoDoCartao,
} from '@/board/tipo-no-cartao';

const FRASE = 'Escolha o tipo: Vídeo, Arte, Foto ou Outros';

const semRota = (elemento: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, elemento));

const quadro = (header: Partial<Board['header']>): Board => ({
  header: {
    listId: 'aaaa0001-0000-4000-8000-000000000001',
    listName: 'Saae Itaverde',
    listContent: null,
    folderId: null,
    folderName: null,
    spaceId: 'aaaaaaaa-0000-0000-0000-000000000000',
    spaceName: 'AGÊNCIA IDE',
    categoryName: 'Ide',
    statusSetName: 'Demandas',
    inheritedFrom: 'space',
    ...header,
  },
  statuses: [{ id: 's1', name: 'atribuir demanda', type: 'open', color: '#d3d3d3', sortOrder: 0 }],
  tasks: [],
  availableTags: [],
  columnTotals: {},
  columnMatched: {},
  perColumn: CARTOES_POR_COLUNA,
  assigneeOptions: [],
  unassignedTasks: 0,
  filter: SEM_FILTRO,
});

describe('a regra do tipo na tela', () => {
  it('a frase é a do servidor', () => {
    expect(FRASE_FALTA_TIPO).toBe(FRASE);
  });

  it('só a lista de produção exige o tipo ao criar', () => {
    expect(faltaTipo({ isProduction: true }, null)).toBe(FRASE);
    expect(faltaTipo({ isProduction: true }, undefined)).toBe(FRASE);
    expect(faltaTipo({ isProduction: true }, 'video')).toBeNull();
    expect(faltaTipo({ isProduction: false }, null)).toBeNull();
    // Servidor de antes da F40 não manda a marca: lista interna.
    expect(faltaTipo({}, null)).toBeNull();
    expect(faltaTipo(undefined, null)).toBeNull();
  });

  it('a ficha não oferece "Nenhum" em produção, e oferece em lista interna', () => {
    expect(opcoesDaFicha(true).map((o) => o.label)).toEqual(['Vídeo', 'Arte', 'Foto', 'Outros']);
    expect(opcoesDaFicha(false).map((o) => o.label)).toEqual(['Nenhum', 'Vídeo', 'Arte', 'Foto', 'Outros']);
    expect(opcoesDaFicha(false)[0].value).toBeNull();
  });

  it('o rótulo do selo; sem tipo não há selo', () => {
    expect(rotuloDoTipoDoCartao('video')).toBe('Vídeo');
    expect(rotuloDoTipoDoCartao('outros')).toBe('Outros');
    expect(rotuloDoTipoDoCartao(null)).toBeNull();
  });

  it('type_required vira a mesma frase, qualquer que seja o texto cru', () => {
    expect(fraseDaRecusa({ code: 'type_required', message: 'new row violates trigger IW040' })).toBe(FRASE);
    expect(fraseDaRecusa({ message: 'Outra coisa' })).toBe('Outra coisa');
  });
});

describe('as peças do tipo', () => {
  it('o seletor tem os quatro botões e marca o escolhido', () => {
    const html = semRota(createElement(SeletorDoTipo, { valor: 'arte', aoMudar: () => {}, obrigatorio: true }));
    for (const nome of ['Vídeo', 'Arte', 'Foto', 'Outros']) expect(html).toContain(`>${nome}<`);
    expect(html).toContain('data-obrigatorio="true"');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-tipo="arte"|data-tipo="arte"[^>]*aria-pressed="true"/);
  });

  it('o selo do card desenha o tipo, e nada sem tipo', () => {
    expect(semRota(createElement(SeloDoTipo, { tipo: 'video' }))).toContain('Vídeo');
    expect(semRota(createElement(SeloDoTipo, { tipo: null }))).toBe('');
  });
});

describe('o modal de tarefa nova pede o tipo conforme a lista', () => {
  const modal = (header: Partial<Board['header']>) =>
    semRota(
      createElement(ModalDeTarefa, { quadro: quadro(header), arvore: [], aoFechar: () => {}, aoCriar: () => {} }),
    );

  it('lista de PRODUÇÃO: seletor obrigatório, frase à vista e botão de criar desabilitado', () => {
    const html = modal({ isProduction: true });
    expect(html).toContain('data-tipo-seletor="1"');
    expect(html).toContain('data-obrigatorio="true"');
    expect(html).toContain(FRASE);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Criar Tarefa<\/button>/);
  });

  it('lista INTERNA: seletor opcional, sem a frase', () => {
    const html = modal({ isProduction: false });
    expect(html).toContain('data-tipo-seletor="1"');
    expect(html).not.toContain('data-obrigatorio="true"');
    expect(html).not.toContain(FRASE);
  });
});

describe('o "+ Adicionar tarefa" pede o tipo conforme a lista', () => {
  // A caixa só abre ao clicar (estado), e o servidor não clica: a prova do
  // quadro aberto está no e2e. Aqui se prova que fechada ela continua o botão.
  it('fechada, é só o botão', () => {
    const html = semRota(
      createElement(AdicionarNaColuna, {
        statusId: 's1',
        aoCriar: async () => true,
        lista: { listId: 'l1', isProduction: true },
      }),
    );
    expect(html).toContain('+ Adicionar tarefa');
  });
});
