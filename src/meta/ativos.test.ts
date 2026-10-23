import { describe, expect, it } from 'vitest';

import {
  type Ativo,
  ROTULO_DA_CONTA,
  estadoDaConexao,
  estadoDaConta,
  identificadorEhValido,
  normalizarIdentificador,
  resumirConexoes,
} from '@/meta/ativos';

describe('normalizarIdentificador', () => {
  it('aceita o numero pelado', () => {
    expect(normalizarIdentificador('facebook_page', '1234567890')).toBe('1234567890');
  });

  it('poe o prefixo `act_` na conta de anuncio, e so nela', () => {
    // A API espera `act_123` no caminho. Guardar o numero pelado obrigaria toda
    // chamada a lembrar do prefixo, e a que esquecesse falharia com "objeto nao
    // encontrado" — que nao diz nada sobre a causa.
    expect(normalizarIdentificador('ad_account', '1234567890')).toBe('act_1234567890');
    expect(normalizarIdentificador('instagram_account', '17841400000000000')).toBe(
      '17841400000000000',
    );
  });

  it('nao duplica o prefixo quando ele ja veio', () => {
    expect(normalizarIdentificador('ad_account', 'act_1234567890')).toBe('act_1234567890');
  });

  it('extrai da URL do Gerenciador de Anuncios', () => {
    expect(
      normalizarIdentificador(
        'ad_account',
        'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1234567890',
      ),
    ).toBe('act_1234567890');
  });

  it('escolhe a sequencia mais longa quando a URL tem varios numeros', () => {
    // Versao da API e parametros de rastreio sao sempre mais curtos que o id.
    expect(
      normalizarIdentificador(
        'facebook_page',
        'https://business.facebook.com/v19.0/latest/98765432109876?ref=12345',
      ),
    ).toBe('98765432109876');
  });

  it('aceita id colado com espaco em volta', () => {
    expect(normalizarIdentificador('business', '  1234567890  ')).toBe('1234567890');
  });

  it('recusa texto sem numero plausivel', () => {
    expect(normalizarIdentificador('ad_account', 'a conta do cliente')).toBeNull();
    expect(normalizarIdentificador('ad_account', '')).toBeNull();
  });

  it('recusa numero curto demais para ser identificador', () => {
    // Quatro digitos e ano, numero de sala, qualquer coisa — nao e id da Meta.
    expect(normalizarIdentificador('facebook_page', '2026')).toBeNull();
  });

  it('identificadorEhValido concorda com a normalizacao', () => {
    expect(identificadorEhValido('ad_account', 'act_1234567890')).toBe(true);
    expect(identificadorEhValido('ad_account', '1234567890')).toBe(false);
    expect(identificadorEhValido('facebook_page', '1234567890')).toBe(true);
  });
});

const ativo = (over: Partial<Ativo> = {}): Ativo => ({
  id: 'a1',
  clientId: 'c1',
  kind: 'instagram_account',
  externalId: '17841400000000000',
  displayName: null,
  isActive: true,
  lastSeenAt: null,
  lastError: null,
  ...over,
});

describe('estadoDaConexao', () => {
  it('sem ativo nenhum e sem conexao', () => {
    expect(estadoDaConexao([])).toBe('sem_conexao');
  });

  it('so ativo desligado tambem e sem conexao', () => {
    expect(estadoDaConexao([ativo({ isActive: false })])).toBe('sem_conexao');
  });

  it('so Instagram ja e conectado — organico nao precisa de conta de anuncio', () => {
    // Cliente que so faz organico nao tem conta de anuncio, e isso e o contrato
    // dele. Exigir as duas marcaria de vermelho metade da carteira.
    expect(estadoDaConexao([ativo({ kind: 'instagram_account' })])).toBe('conectado');
  });

  it('so conta de anuncio tambem e conectado', () => {
    expect(estadoDaConexao([ativo({ kind: 'ad_account' })])).toBe('conectado');
  });

  it('so BM e pagina e incompleta: nenhuma das duas rende coleta', () => {
    expect(
      estadoDaConexao([ativo({ kind: 'business' }), ativo({ id: 'a2', kind: 'facebook_page' })]),
    ).toBe('incompleta');
  });

  it('erro vence conectado', () => {
    // O dado parou de chegar, e e isso que a tela precisa gritar. Um ativo
    // saudavel ao lado nao conserta o que quebrou.
    const r = estadoDaConexao([
      ativo({ id: 'ok', kind: 'instagram_account' }),
      ativo({ id: 'ruim', kind: 'ad_account', lastError: 'sem permissao' }),
    ]);
    expect(r).toBe('com_erro');
  });

  it('erro em ativo DESLIGADO nao conta', () => {
    // Foi desligado justamente porque parou. Continuar gritando seria alarme
    // que ninguem consegue silenciar.
    const r = estadoDaConexao([
      ativo({ id: 'ok', kind: 'instagram_account' }),
      ativo({ id: 'antigo', kind: 'ad_account', isActive: false, lastError: 'sem permissao' }),
    ]);
    expect(r).toBe('conectado');
  });
});

describe('resumirConexoes', () => {
  it('conta cada estado', () => {
    const r = resumirConexoes([
      [],
      [ativo({ kind: 'business' })],
      [ativo({ kind: 'instagram_account' })],
      [ativo({ kind: 'ad_account', lastError: 'expirou' })],
    ]);
    expect(r).toEqual({
      total: 4,
      sem_conexao: 1,
      incompleta: 1,
      conectado: 1,
      com_erro: 1,
    });
  });

  it('carteira vazia nao inventa pendencia', () => {
    expect(resumirConexoes([])).toEqual({
      total: 0,
      sem_conexao: 0,
      incompleta: 0,
      conectado: 0,
      com_erro: 0,
    });
  });
});

describe('estadoDaConta — F14: o estado da coleta tem nome', () => {
  const agora = new Date('2026-09-29T12:00:00Z');
  const base = { isActive: true, lastError: null, lastSeenAt: '2026-09-29T10:00:00Z', diasColetados: 28 };

  it('série viva e visto há pouco: em dia', () => {
    expect(estadoDaConta(base, agora)).toBe('em_dia');
  });

  it('visto há mais de 12 h: atrasada', () => {
    expect(estadoDaConta({ ...base, lastSeenAt: '2026-09-28T20:00:00Z' }, agora)).toBe('atrasada');
  });

  it('nenhum dia coletado é "sem coleta" — e não zero', () => {
    expect(estadoDaConta({ ...base, diasColetados: 0, lastSeenAt: null }, agora)).toBe('sem_coleta');
  });

  it('a falha vence a série', () => {
    expect(estadoDaConta({ ...base, lastError: 'código 190' }, agora)).toBe('falha');
  });

  it('inativa vence tudo, inclusive um erro antigo', () => {
    expect(estadoDaConta({ ...base, isActive: false, lastError: 'código 190' }, agora)).toBe('inativa');
  });

  it('série sem carimbo da última coleta não é afirmada em dia', () => {
    expect(estadoDaConta({ ...base, lastSeenAt: null }, agora)).toBe('sem_registro');
  });

  it('cada estado tem rótulo escrito', () => {
    for (const e of ['inativa', 'falha', 'sem_coleta', 'sem_registro', 'atrasada', 'em_dia'] as const) {
      expect(ROTULO_DA_CONTA[e].length).toBeGreaterThan(3);
    }
  });
});
