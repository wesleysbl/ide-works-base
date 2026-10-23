import { describe, expect, it } from 'vitest';

import {
  abaEstaComFoco,
  conversaEmVista,
  idDaPrimeiraNova,
  podeGerenciarGrupo,
  podeMarcarComoLida,
  somarNaoLidas,
  widgetPodeMarcarLida,
  zerarNaoLidasDaConversa,
} from '@/chat/nao-lidas';
import { nomeDaConversa } from '@/chat/lista';

describe('a conta de não lidas', () => {
  it('soma só contagens positivas', () => {
    expect(somarNaoLidas([])).toBe(0);
    expect(
      somarNaoLidas([
        { unreadCount: 0 },
        { unreadCount: 3 },
        { unreadCount: -1 },
        { unreadCount: 2.7 },
      ]),
    ).toBe(5);
  });

  it('zera a conversa certa na lista local', () => {
    const lista = zerarNaoLidasDaConversa(
      [
        { id: 'a', unreadCount: 2 },
        { id: 'b', unreadCount: 5 },
      ],
      'b',
    );
    expect(lista).toEqual([
      { id: 'a', unreadCount: 2 },
      { id: 'b', unreadCount: 0 },
    ]);
  });
});

describe('marcar como lida só com foco', () => {
  it('exige conversa visível e aba em foco', () => {
    expect(podeMarcarComoLida(true, true)).toBe(true);
    expect(podeMarcarComoLida(true, false)).toBe(false);
    expect(podeMarcarComoLida(false, true)).toBe(false);
  });

  it('aba oculta ou sem foco não conta', () => {
    expect(abaEstaComFoco('hidden', true)).toBe(false);
    expect(abaEstaComFoco('visible', false)).toBe(false);
    expect(abaEstaComFoco('visible', true)).toBe(true);
  });
});

describe('o divisor de novas mensagens', () => {
  it('aponta a primeira mensagem de outra pessoa depois da marca', () => {
    const id = idDaPrimeiraNova(
      [
        {
          id: '1',
          kind: 'person',
          authorId: 'eu',
          createdAt: '2026-09-21T10:00:00.000Z',
          deletedAt: null,
        },
        {
          id: '2',
          kind: 'person',
          authorId: 'outro',
          createdAt: '2026-09-21T11:00:00.000Z',
          deletedAt: null,
        },
        {
          id: '3',
          kind: 'person',
          authorId: 'outro',
          createdAt: '2026-09-21T12:00:00.000Z',
          deletedAt: null,
        },
      ],
      '2026-09-21T10:30:00.000Z',
      'eu',
    );
    expect(id).toBe('2');
  });

  it('ignora sistema, apagada e própria', () => {
    expect(
      idDaPrimeiraNova(
        [
          {
            id: 's',
            kind: 'system',
            authorId: null,
            createdAt: '2026-09-21T12:00:00.000Z',
            deletedAt: null,
          },
          {
            id: 'd',
            kind: 'person',
            authorId: 'outro',
            createdAt: '2026-09-21T12:01:00.000Z',
            deletedAt: '2026-09-21T12:02:00.000Z',
          },
        ],
        null,
        'eu',
      ),
    ).toBe(null);
  });
});

describe('nome da direta e gestão do grupo', () => {
  it('direta usa o nome do parceiro', () => {
    expect(
      nomeDaConversa({
        id: '1',
        kind: 'direct',
        name: null,
        peerName: 'Bia',
        lastMessage: null,
      }),
    ).toBe('Bia');
  });

  it('só grupo com dono ou superadmin gerencia', () => {
    expect(podeGerenciarGrupo('general', null, true)).toBe(false);
    expect(podeGerenciarGrupo('group', 'member', false)).toBe(false);
    expect(podeGerenciarGrupo('group', 'owner', false)).toBe(true);
    expect(podeGerenciarGrupo('group', 'member', true)).toBe(true);
  });
});

describe('a janelinha do chat marca leitura só quando é ela que está na frente — conferência de 08/10', () => {
  const base = { widgetAberto: true, naTelaDoChat: false, conversaNaJanela: true, abaComFoco: true };

  it('marca com a janelinha aberta, na conversa, e a aba em foco', () => {
    expect(widgetPodeMarcarLida(base)).toBe(true);
  });

  it('na tela cheia do Chat quem marca é a tela, nunca a janelinha', () => {
    expect(widgetPodeMarcarLida({ ...base, naTelaDoChat: true })).toBe(false);
  });

  it('janelinha fechada não marca, mesmo com a conversa lembrada', () => {
    expect(widgetPodeMarcarLida({ ...base, widgetAberto: false })).toBe(false);
  });

  it('aba escondida ou sem foco não marca: a mensagem fica não lida', () => {
    expect(widgetPodeMarcarLida({ ...base, abaComFoco: false })).toBe(false);
  });

  it('mensagem de outra conversa não marca a aberta', () => {
    expect(widgetPodeMarcarLida({ ...base, conversaNaJanela: false })).toBe(false);
  });
});

describe('a conversa que a pessoa está VENDO', () => {
  // `conversaAbertaId` é compartilhado entre a tela cheia e a janelinha, e o X
  // da janelinha só a esconde: a conversa continuava "aberta" para o gerente,
  // que a tirava da conta do selo e calava o som e o aviso do sistema dela.
  it('na tela do Chat, a conversa da rota é a que se vê', () => {
    expect(conversaEmVista({ naTelaDoChat: true, widgetAberto: false, conversaAbertaId: 'c1' })).toBe('c1');
  });

  it('com a janelinha aberta fora do Chat, a conversa dela é a que se vê', () => {
    expect(conversaEmVista({ naTelaDoChat: false, widgetAberto: true, conversaAbertaId: 'c1' })).toBe('c1');
  });

  it('janelinha fechada fora do Chat: nenhuma conversa está à vista', () => {
    expect(conversaEmVista({ naTelaDoChat: false, widgetAberto: false, conversaAbertaId: 'c1' })).toBeNull();
  });

  it('sem conversa aberta, nenhuma está à vista', () => {
    expect(conversaEmVista({ naTelaDoChat: true, widgetAberto: true, conversaAbertaId: null })).toBeNull();
  });
});
