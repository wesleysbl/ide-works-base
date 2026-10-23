import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deveDispararNotificacaoDesktop,
  deveTocarSom,
  lerPreferenciaDesktop,
  lerPreferenciaSom,
  resumoDoTextoNotificacao,
  salvarPreferenciaDesktop,
  salvarPreferenciaSom,
} from '@/chat/notificador';

describe('deveTocarSom (supressão inteligente)', () => {
  it('não toca se a mensagem foi escrita pelo próprio usuário', () => {
    const toca = deveTocarSom({
      authorId: 'user-1',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: 'conv-b',
      somHabilitado: true,
      janelaFocada: true,
    });
    expect(toca).toBe(false);
  });

  it('não toca se o som estiver desabilitado pelo usuário', () => {
    const toca = deveTocarSom({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: null,
      somHabilitado: false,
      janelaFocada: true,
    });
    expect(toca).toBe(false);
  });

  it('NÃO TOCA se a conversa estiver aberta na tela e a janela estiver focada (regra estrita)', () => {
    const toca = deveTocarSom({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: 'conv-a', // Mesma conversa aberta
      somHabilitado: true,
      janelaFocada: true, // Usuário visualizando ativamente
    });
    expect(toca).toBe(false);
  });

  it('TOCA se a janela estiver focada mas a mensagem for de OUTRA conversa', () => {
    const toca = deveTocarSom({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-b',
      conversaAbertaId: 'conv-a',
      somHabilitado: true,
      janelaFocada: true,
    });
    expect(toca).toBe(true);
  });

  it('TOCA se nenhuma conversa estiver aberta na tela', () => {
    const toca = deveTocarSom({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: null,
      somHabilitado: true,
      janelaFocada: true,
    });
    expect(toca).toBe(true);
  });

  it('TOCA se a janela estiver desfocada ou minimizada mesmo na conversa aberta', () => {
    const toca = deveTocarSom({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: 'conv-a',
      somHabilitado: true,
      janelaFocada: false, // Em segundo plano / aba oculta
    });
    expect(toca).toBe(true);
  });
});

describe('deveDispararNotificacaoDesktop', () => {
  it('não dispara se a permissão não for granted', () => {
    const dispara = deveDispararNotificacaoDesktop({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: null,
      notificacoesHabilitadas: true,
      permissao: 'denied',
      janelaFocada: false,
    });
    expect(dispara).toBe(false);
  });

  it('não dispara se a mensagem for do próprio usuário', () => {
    const dispara = deveDispararNotificacaoDesktop({
      authorId: 'user-1',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: null,
      notificacoesHabilitadas: true,
      permissao: 'granted',
      janelaFocada: false,
    });
    expect(dispara).toBe(false);
  });

  it('não dispara se o usuário estiver com a conversa aberta e com foco ativo', () => {
    const dispara = deveDispararNotificacaoDesktop({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: 'conv-a',
      notificacoesHabilitadas: true,
      permissao: 'granted',
      janelaFocada: true,
    });
    expect(dispara).toBe(false);
  });

  it('dispara quando a janela está em segundo plano e permissão está concedida', () => {
    const dispara = deveDispararNotificacaoDesktop({
      authorId: 'user-2',
      meuUserId: 'user-1',
      conversationId: 'conv-a',
      conversaAbertaId: 'conv-a',
      notificacoesHabilitadas: true,
      permissao: 'granted',
      janelaFocada: false,
    });
    expect(dispara).toBe(true);
  });
});

describe('resumoDoTextoNotificacao', () => {
  it('remove markdown e limpa links', () => {
    const texto = resumoDoTextoNotificacao('Olá **Wesley**, veja o [link](https://works.exemplo.com.br)!');
    expect(texto).toBe('Olá Wesley, veja o link!');
  });

  it('substitui imagens markdown por [Foto]', () => {
    const texto = resumoDoTextoNotificacao('![foto.jpg](https://works.exemplo.com.br/img.jpg)');
    expect(texto).toBe('[Foto]');
  });

  it('limita o tamanho do texto quando muito longo', () => {
    const longo = 'a'.repeat(150);
    const resultado = resumoDoTextoNotificacao(longo, 50);
    expect(resultado.length).toBe(51); // 50 + '…'
    expect(resultado.endsWith('…')).toBe(true);
  });
});

/**
 * O ARMAZENAMENTO NEGADO NÃO DERRUBA O SISTEMA — conferência de 09/10/2026.
 *
 * `GerenteDeConexao` mora na moldura e lê estas preferências no PRIMEIRO desenho
 * de toda rota (inclusive a entrada). Em navegador que nega `localStorage`
 * (todos os cookies bloqueados, política do dispositivo, aba privada de alguns
 * navegadores) o próprio acesso LANÇA — e como esta era a única leitura de
 * armazenamento do sistema sem `try`, ela derrubava a moldura inteira. As
 * demais (rolagem, aparência, rascunho, lugar) já cuidavam disso.
 */
describe('preferências do chat com o armazenamento negado', () => {
  afterEach(() => vi.unstubAllGlobals());

  const janelaQueNega = () =>
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    });

  it('ler devolve o padrão (ligado), sem lançar', () => {
    janelaQueNega();
    expect(lerPreferenciaSom()).toBe(true);
    expect(lerPreferenciaDesktop()).toBe(true);
  });

  it('gravar vale só nesta visita, sem lançar', () => {
    janelaQueNega();
    expect(() => salvarPreferenciaSom(false)).not.toThrow();
    expect(() => salvarPreferenciaDesktop(false)).not.toThrow();
  });

  it('com o armazenamento cheio (setItem lança), gravar também não lança', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        },
      },
    });
    expect(() => salvarPreferenciaSom(true)).not.toThrow();
  });

  it('com armazenamento normal, lê e grava como sempre', () => {
    const guardado = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => guardado.get(k) ?? null,
        setItem: (k: string, v: string) => void guardado.set(k, v),
      },
    });
    expect(lerPreferenciaSom()).toBe(true);
    salvarPreferenciaSom(false);
    salvarPreferenciaDesktop(false);
    expect(lerPreferenciaSom()).toBe(false);
    expect(lerPreferenciaDesktop()).toBe(false);
  });
});
