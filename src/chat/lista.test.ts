import { describe, expect, it } from 'vitest';

import { chatVisivelNaBarra, definirModoDoChat, modoDoChat } from '@/chat/chave';
import {
  horarioDaConversa,
  nomeDaConversa,
  ordenarConversas,
  previaDaConversa,
  seloDeNaoLidas,
  sobreAConversa,
  type ConversaParaLista,
} from '@/chat/lista';
import {
  aplicarMensagem,
  marcarFalha,
  mensagemOtimista,
  reconciliarEnvio,
} from '@/chat/envio';
import {
  chaveDoDia,
  montarPainel,
  ordenarMensagens,
  rotuloDoDia,
  horaDaMensagem,
  instanteDaMensagem,
  JANELA_DO_GRUPO_MS,
  type MensagemParaPainel,
} from '@/chat/mensagens';
import { esperaDeReconexao, RECONEXAO_TETO_MS } from '@/chat/reconexao';

const c = (p: Partial<ConversaParaLista> & { id: string; kind: ConversaParaLista['kind'] }): ConversaParaLista => ({
  name: null,
  lastMessage: null,
  ...p,
});

describe('a chave do chat na barra', () => {
  it('desligado esconde para todo mundo', () => {
    expect(chatVisivelNaBarra('desligado', true)).toBe(false);
    expect(chatVisivelNaBarra('desligado', false)).toBe(false);
  });

  it('ligado mostra para todo mundo', () => {
    expect(chatVisivelNaBarra('ligado', false)).toBe(true);
    expect(chatVisivelNaBarra('ligado', true)).toBe(true);
  });

  it('piloto só para super admin; enquanto a sessão carrega, mostra', () => {
    expect(chatVisivelNaBarra('piloto', true)).toBe(true);
    expect(chatVisivelNaBarra('piloto', false)).toBe(false);
    expect(chatVisivelNaBarra('piloto', null)).toBe(true);
  });

  it('texto inválido cai em desligado', () => {
    definirModoDoChat('ligado');
    expect(modoDoChat()).toBe('ligado');
    definirModoDoChat('xyz');
    expect(modoDoChat()).toBe('desligado');
    definirModoDoChat('piloto');
    expect(modoDoChat()).toBe('piloto');
  });
});

describe('a lista de conversas', () => {
  it('Geral fica no topo, o resto por atividade mais recente', () => {
    const lista = ordenarConversas([
      c({
        id: 'g1',
        kind: 'group',
        name: 'Velho',
        lastMessage: { at: '2026-09-20T10:00:00.000Z', body: 'a', deletedAt: null },
      }),
      c({ id: 'geral', kind: 'general', name: null }),
      c({
        id: 'g2',
        kind: 'group',
        name: 'Novo',
        lastMessage: { at: '2026-09-21T10:00:00.000Z', body: 'b', deletedAt: null },
      }),
    ]);
    expect(lista.map((x) => x.id)).toEqual(['geral', 'g2', 'g1']);
  });

  it('nome e prévia: Geral, lápide, corte longo', () => {
    expect(nomeDaConversa(c({ id: '1', kind: 'general' }))).toBe('Geral');
    expect(
      previaDaConversa(
        c({
          id: '1',
          kind: 'general',
          lastMessage: { at: '2026-09-21T10:00:00.000Z', body: 'oi', deletedAt: '2026-09-21T11:00:00.000Z' },
        }),
      ),
    ).toBe('Mensagem apagada');
    const longo = 'x'.repeat(100);
    expect(
      previaDaConversa(
        c({
          id: '1',
          kind: 'group',
          name: 'X',
          lastMessage: { at: '2026-09-21T10:00:00.000Z', body: longo, deletedAt: null },
        }),
      ),
    ).toMatch(/…$/);
  });
});

describe('o painel agrupa por dia e por autor', () => {
  const fala = (p: Partial<MensagemParaPainel> & { id: string }): MensagemParaPainel => ({
    authorId: 'a',
    body: 'oi',
    kind: 'person',
    createdAt: '2026-09-21T15:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    clientKey: null,
    ...p,
  });

  it('o fuso de São Paulo parte o dia — não o relógio da máquina sozinho', () => {
    // 2026-09-21T02:30Z = 23:30 do dia 20 em São Paulo (UTC-3).
    expect(chaveDoDia('2026-09-21T02:30:00.000Z')).toBe('2026-09-20');
    expect(chaveDoDia('2026-09-21T03:30:00.000Z')).toBe('2026-09-21');
  });

  it('Hoje / Ontem / dia da semana / data por extenso (F09)', () => {
    // 21/09/2026 é uma segunda-feira.
    const agora = new Date('2026-09-21T18:00:00.000Z');
    expect(rotuloDoDia(chaveDoDia('2026-09-21T18:00:00.000Z'), agora)).toBe('Hoje');
    expect(rotuloDoDia('2026-09-20', agora)).toBe('Ontem');
    expect(rotuloDoDia('2026-09-18', agora)).toBe('Sexta-feira');
    expect(rotuloDoDia('2026-09-15', agora)).toBe('Terça-feira');
    expect(rotuloDoDia('2026-09-14', agora)).toBe('14 de setembro');
    expect(rotuloDoDia('2026-01-05', agora)).toBe('5 de janeiro');
    expect(rotuloDoDia('2025-12-31', agora)).toBe('31 de dezembro de 2025');
  });

  it('a hora da fala é HH:MM em São Paulo; o instante inteiro vai no title', () => {
    expect(horaDaMensagem('2026-09-21T02:30:00.000Z')).toBe('23:30');
    expect(instanteDaMensagem('2026-09-21T02:30:00.000Z')).toBe('20/09/2026 às 23:30');
    expect(horaDaMensagem('lixo')).toBeNull();
  });

  it('pausa maior que a janela recomeça o grupo do mesmo autor', () => {
    const blocos = montarPainel(
      [
        fala({ id: '1', authorId: 'ana', createdAt: '2026-09-21T15:00:00.000Z' }),
        fala({ id: '2', authorId: 'ana', createdAt: '2026-09-21T15:04:59.000Z' }),
        fala({ id: '3', authorId: 'ana', createdAt: '2026-09-21T15:10:00.000Z' }),
      ],
      new Date('2026-09-21T18:00:00.000Z'),
    );
    expect(JANELA_DO_GRUPO_MS).toBe(5 * 60 * 1000);
    expect(blocos.map((b) => (b.tipo === 'fala' ? b.primeiraDoAutor : b.tipo))).toEqual([
      'dia',
      true,
      false,
      true,
    ]);
  });

  it('empate de instante desempata pelo id', () => {
    const ids = ordenarMensagens([
      fala({ id: 'b', createdAt: '2026-09-21T15:00:00.000Z' }),
      fala({ id: 'a', createdAt: '2026-09-21T15:00:00.000Z' }),
    ]).map((m) => m.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('monta separador, falas consecutivas do mesmo autor e linha de sistema', () => {
    const blocos = montarPainel(
      [
        fala({ id: '1', authorId: 'ana', createdAt: '2026-09-21T15:00:00.000Z' }),
        fala({ id: '2', authorId: 'ana', createdAt: '2026-09-21T15:01:00.000Z' }),
        fala({
          id: '3',
          authorId: null,
          kind: 'system',
          body: 'Fulano entrou',
          createdAt: '2026-09-21T15:02:00.000Z',
        }),
        fala({ id: '4', authorId: 'bia', createdAt: '2026-09-21T15:03:00.000Z' }),
      ],
      new Date('2026-09-21T18:00:00.000Z'),
    );
    expect(blocos[0]).toMatchObject({ tipo: 'dia', rotulo: 'Hoje' });
    expect(blocos[1]).toMatchObject({ tipo: 'fala', primeiraDoAutor: true });
    expect(blocos[2]).toMatchObject({ tipo: 'fala', primeiraDoAutor: false });
    expect(blocos[3]).toMatchObject({ tipo: 'sistema' });
    expect(blocos[4]).toMatchObject({ tipo: 'fala', primeiraDoAutor: true });
  });
});

describe('o envio otimista reconcilia pela chave', () => {
  it('pendente vira confirmada sem duplicar', () => {
    const opt = mensagemOtimista({
      conversationId: 'c1',
      authorId: 'u1',
      body: 'bom dia',
      clientKey: 'k1',
      agoraIso: '2026-09-21T12:00:00.000Z',
    });
    const lista = reconciliarEnvio([opt], {
      id: 'm1',
      conversationId: 'c1',
      authorId: 'u1',
      body: 'bom dia',
      kind: 'person',
      createdAt: '2026-09-21T12:00:01.000Z',
      editedAt: null,
      deletedAt: null,
      clientKey: 'k1',
    });
    expect(lista).toHaveLength(1);
    expect(lista[0].id).toBe('m1');
    expect(lista[0].estado).toBe('confirmada');
  });

  it('falha e tentar de novo usa a mesma chave', () => {
    const opt = mensagemOtimista({
      conversationId: 'c1',
      authorId: 'u1',
      body: 'oi',
      clientKey: 'k-retry',
      agoraIso: '2026-09-21T12:00:00.000Z',
    });
    const falhou = marcarFalha([opt], 'k-retry', 'Rede caiu');
    expect(falhou[0].estado).toBe('falha');
    expect(falhou[0].clientKey).toBe('k-retry');
    const ok = reconciliarEnvio(falhou, {
      ...opt,
      id: 'm2',
      createdAt: '2026-09-21T12:00:02.000Z',
    });
    expect(ok).toHaveLength(1);
    expect(ok[0].estado).toBe('confirmada');
  });

  it('mensagem nova sem otimista entra na lista', () => {
    const lista = aplicarMensagem([], {
      id: 'm9',
      conversationId: 'c1',
      authorId: 'u2',
      body: 'olá',
      kind: 'person',
      createdAt: '2026-09-21T12:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      clientKey: 'kx',
    });
    expect(lista).toHaveLength(1);
    expect(lista[0].estado).toBe('confirmada');
  });
});

describe('a espera de reconexão', () => {
  it('cresce com a tentativa e respeita o teto', () => {
    expect(esperaDeReconexao(0, 0)).toBe(250);
    expect(esperaDeReconexao(0, 1)).toBe(500);
    expect(esperaDeReconexao(1, 0)).toBe(500);
    expect(esperaDeReconexao(10, 1)).toBe(RECONEXAO_TETO_MS);
  });

  it('o sorteio espalha — duas abas com sorte diferente não batem juntas', () => {
    const a = esperaDeReconexao(3, 0.1);
    const b = esperaDeReconexao(3, 0.9);
    expect(a).toBeLessThan(b);
  });
});

describe('F08: a linha e o cabeçalho da conversa', () => {
  // Quarta, 30/09/2026, 15:00 no fuso de quem lê.
  const agora = new Date(2026, 8, 30, 15, 0);
  const em = (...p: [number, number, number, number, number]) => new Date(...p).toISOString();

  it('escreve o horário como um app de mensagens', () => {
    expect(horarioDaConversa(em(2026, 8, 30, 9, 3), agora)).toBe('09:03');
    expect(horarioDaConversa(em(2026, 8, 29, 23, 59), agora)).toBe('Ontem');
    expect(horarioDaConversa(em(2026, 8, 28, 10, 0), agora)).toBe('seg.');
    expect(horarioDaConversa(em(2026, 8, 24, 10, 0), agora)).toBe('qui.');
    expect(horarioDaConversa(em(2026, 8, 23, 10, 0), agora)).toBe('23/09');
    expect(horarioDaConversa(em(2025, 11, 31, 10, 0), agora)).toBe('31/12/25');
  });

  it('sem mensagem ou com instante inválido não inventa horário', () => {
    expect(horarioDaConversa(null, agora)).toBe('');
    expect(horarioDaConversa(undefined, agora)).toBe('');
    expect(horarioDaConversa('não é data', agora)).toBe('');
  });

  it('selo: nada com zero, número até 99, 99+ depois', () => {
    expect(seloDeNaoLidas(0)).toBeNull();
    expect(seloDeNaoLidas(undefined)).toBeNull();
    expect(seloDeNaoLidas(1)).toBe('1');
    expect(seloDeNaoLidas(99)).toBe('99');
    expect(seloDeNaoLidas(100)).toBe('99+');
  });

  it('diz o tipo e quantos estão na conversa', () => {
    expect(sobreAConversa({ kind: 'general', members: [1, 2, 3] })).toBe('Toda a equipe · 3 pessoas');
    expect(sobreAConversa({ kind: 'general' })).toBe('Toda a equipe');
    expect(sobreAConversa({ kind: 'group', members: [1] })).toBe('Grupo · 1 pessoa');
    expect(sobreAConversa({ kind: 'direct', peerIsActive: true })).toBe('Conversa direta');
    expect(sobreAConversa({ kind: 'direct', peerIsActive: false })).toBe('Conversa direta · pessoa desativada');
  });
});
