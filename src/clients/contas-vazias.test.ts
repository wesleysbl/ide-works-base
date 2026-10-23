/**
 * A frase do bloco vazio — F19e.
 *
 * O QUE ESTES TESTES PROTEGEM
 *   Um bloco vazio que diz apenas "nenhum ligado" descreve três mundos
 *   diferentes com a mesma frase, e dois deles pedem ação de gente diferente:
 *   ligar a conta é trabalho de quem cuida da carteira; pedir acesso à conta
 *   de anúncio é conversa com o cliente.
 *
 *   O caso que originou isto: o cliente Jatobá tinha o Instagram coletando
 *   e nenhum gerenciador — porque a página estava compartilhada e a conta de
 *   anúncio não. A tela mostrava um vazio sem explicação, e a dúvida virou
 *   pergunta para quem construiu o sistema.
 */

import { describe, expect, it } from 'vitest';

import { type ContaDaMeta, porQueVazio, resumoDaMeta } from '@/clients/contas-vazias';

const conta = (p: Partial<ContaDaMeta> & Pick<ContaDaMeta, 'kind'>): ContaDaMeta => ({
  id: crypto.randomUUID(),
  externalId: 'act_1',
  displayName: null,
  businessName: null,
  pageName: null,
  lastError: null,
  client: null,
  diasColetados: 0,
  ...p,
});

const ads = (contas: ContaDaMeta[], nome: string) =>
  porQueVazio(contas, nome, 'ad_account', 'gerenciador', 'gerenciadores', 'CONSEQUÊNCIA');
const ig = (contas: ContaDaMeta[], nome: string) =>
  porQueVazio(contas, nome, 'instagram_account', 'perfil', 'perfis', 'CONSEQUÊNCIA');

describe('quando não chegou conta nenhuma', () => {
  it('diz que não há o que ligar, e não manda ninguém procurar', () => {
    const r = ads([], 'Jatobá');
    expect(r.forte).toContain('Não há gerenciador livre');
    expect(r.resto).toContain('nem deste cliente, nem de outro');
  });

  it('conta de OUTRO cliente não conta como livre', () => {
    // Ela existe, mas oferecê-la faria alguém tirá-la de quem já a tem.
    const c = [conta({ kind: 'ad_account', displayName: 'Pró Forma', client: { id: 'x', name: 'Pró Forma' } })];
    expect(ads(c, 'Jatobá').forte).toContain('Não há gerenciador livre');
  });
});

describe('o caso Jatobá: há contas livres, nenhuma dele', () => {
  const carteira = [
    conta({ kind: 'ad_account', displayName: 'Pró Forma' }),
    conta({ kind: 'ad_account', displayName: 'RAIZ ADS' }),
    conta({ kind: 'ad_account', displayName: 'Focus Ibitinga ADS' }),
  ];

  it('não finge que basta ligar — diz que o nome dele não está na lista', () => {
    const r = ads(carteira, 'Jatobá');
    expect(r.forte).toContain('nenhum dos 3 gerenciadores livres');
    expect(r.forte).toContain('Jatobá');
  });

  it('aponta as duas permissões, e manda perguntar a quem sabe: a área Meta', () => {
    const r = ads(carteira, 'Jatobá');
    expect(r.resto).toContain('permissões separadas na Meta');
    // e não chuta a atribuição: manda olhar quem sabe.
    expect(r.resto).toContain('usuário do sistema');
  });

  it('sem fechar a porta — o nome na Meta pode ser outro', () => {
    // A semelhança erra. Dizer "não existe" seria mais forte do que se sabe.
    expect(ads(carteira, 'Jatobá').resto).toContain('abrir a gaveta assim mesmo');
  });

  it('para o Instagram a causa provável é outra, e a frase muda', () => {
    const perfis = [conta({ kind: 'instagram_account', displayName: '@valentini.oficial' })];
    const r = ig(perfis, 'Jatobá');
    expect(r.resto).toContain('conta profissional');
    expect(r.resto).not.toContain('usuário do sistema é o nosso token');
  });
});

describe('quando a conta está lá esperando', () => {
  it('manda ligar, e diz quantas são', () => {
    const c = [
      conta({ kind: 'instagram_account', displayName: '@jatoba.investe' }),
      conta({ kind: 'instagram_account', displayName: '@valentini.oficial' }),
    ];
    const r = ig(c, 'Jatobá');
    expect(r.forte).toContain('1 perfil livre tem');
    expect(r.resto).toContain('Ligar conta');
  });

  it('no plural, concorda', () => {
    const c = [
      conta({ kind: 'instagram_account', displayName: '@focusmoveis.ibitinga' }),
      conta({ kind: 'instagram_account', displayName: '@lojaexemplodeibitinga' }),
    ];
    expect(ig(c, 'Focus Ibitinga').forte).toContain('perfis livres têm');
  });

  it('reconhece o cliente pelo nome da BM quando a conta não tem nome', () => {
    // `display_name` vem nulo em algumas contas; a origem é o que sobra.
    const c = [conta({ kind: 'ad_account', businessName: 'Pró Forma' })];
    expect(ads(c, 'Pró Forma').forte).toContain('1 gerenciador livre tem');
  });
});

describe('a consequência aparece sempre', () => {
  it('nos três caminhos, porque é ela que explica por que isto importa', () => {
    const cheio = [conta({ kind: 'ad_account', displayName: 'Pró Forma' })];
    expect(ads([], 'X').resto).toContain('CONSEQUÊNCIA');
    expect(ads(cheio, 'Jatobá').resto).toContain('CONSEQUÊNCIA');
    expect(ads(cheio, 'Pró Forma').resto).toContain('CONSEQUÊNCIA');
  });
});

describe('o vínculo em uma linha — F11B', () => {
  it('antes de as contas chegarem, não afirma nada', () => {
    expect(resumoDaMeta(null, 'c1')).toBeNull();
  });

  it('nada ligado diz isso, e conta de outro cliente não conta', () => {
    const c = [conta({ kind: 'ad_account', client: { id: 'outro', name: 'Outro' } })];
    expect(resumoDaMeta(c, 'c1')).toBe('Meta: nenhuma conta ligada');
    expect(resumoDaMeta([], 'c1')).toBe('Meta: nenhuma conta ligada');
  });

  it('separa gerenciador de perfil, no singular e no plural', () => {
    const dele = { id: 'c1', name: 'Cliente' };
    const c = [
      conta({ kind: 'ad_account', client: dele }),
      conta({ kind: 'instagram_account', client: dele }),
      conta({ kind: 'instagram_account', client: dele }),
      conta({ kind: 'ad_account' }),
    ];
    expect(resumoDaMeta(c, 'c1')).toBe('Meta: 1 gerenciador e 2 perfis');
    expect(resumoDaMeta(c.slice(1), 'c1')).toBe('Meta: 2 perfis');
  });
});
