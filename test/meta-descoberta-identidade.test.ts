/**
 * De quem é o token — F19f.
 *
 * O QUE ESTE TESTE PROTEGE
 *   A área Meta listava o que o token alcança e nunca dizia QUEM ele é. Sem o
 *   sujeito, "por que meu cliente não está aqui?" não tem resposta na tela — e
 *   a pergunta chegou, sobre o cliente Jatobá, em 25/08/2026.
 *
 *   O sujeito é o que decide o conserto. `/me/adaccounts` devolve as contas em
 *   que o USUÁRIO DO SISTEMA tem papel; atribuir a conta ao app é outra
 *   atribuição e não traz a conta para cá. Sem o nome na tela, não há como
 *   saber a quem atribuir.
 *
 * E A REGRA ANTIGA CONTINUA VALENDO
 *   `/me` é mais uma chamada, e mais uma chamada é mais uma forma de a
 *   listagem inteira morrer. Ela falha para o lado do aviso — nunca derruba as
 *   contas, que são o motivo de a tela existir.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { descobrirContas } from '@/server/meta-descoberta';

/** Responde por trecho de URL; o que não casar vira 400 com erro da Meta. */
function fingirMeta(respostas: Array<[string, unknown, number?]>) {
  vi.stubGlobal('fetch', async (url: string) => {
    for (const [trecho, corpo, status] of respostas) {
      if (url.includes(trecho)) {
        return new Response(JSON.stringify(corpo), { status: status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ error: { message: 'não combinado', code: 1 } }), {
      status: 400,
    });
  });
}

const CONTAS = ['me/adaccounts', { data: [{ id: 'act_1', name: 'Pró Forma' }] }] as [
  string,
  unknown,
];
const PAGINAS = [
  'me/accounts',
  { data: [{ id: 'p1', name: 'Jatobá Investimentos', instagram_business_account: { id: 'ig1', username: 'jatoba.investe' } }] },
] as [string, unknown];

afterEach(() => vi.unstubAllGlobals());

describe('a descoberta diz de quem é o token', () => {
  it('devolve o usuário do sistema junto com as contas', async () => {
    fingirMeta([['me?fields=id,name', { id: '1209', name: 'Ide [CS]' }], CONTAS, PAGINAS]);
    const r = await descobrirContas('tok');
    expect(r.identidade).toEqual({ id: '1209', nome: 'Ide [CS]' });
  });

  it('aceita usuário sem nome, sem inventar um', async () => {
    fingirMeta([['me?fields=id,name', { id: '1209' }], CONTAS, PAGINAS]);
    expect((await descobrirContas('tok')).identidade).toEqual({ id: '1209', nome: null });
  });
});

describe('a identidade não pode derrubar a listagem', () => {
  it('se /me falha, as contas continuam vindo', async () => {
    // A lição da F7d: uma chamada a mais que recusa não pode custar a lista.
    fingirMeta([
      ['me?fields=id,name', { error: { message: 'token sem escopo', code: 190 } }, 400],
      CONTAS,
      PAGINAS,
    ]);
    const r = await descobrirContas('tok');
    expect(r.contas).toHaveLength(2);
    expect(r.identidade).toBeNull();
  });

  it('e a falha vira aviso, em vez de sumir', async () => {
    fingirMeta([
      ['me?fields=id,name', { error: { message: 'token sem escopo', code: 190 } }, 400],
      CONTAS,
      PAGINAS,
    ]);
    const r = await descobrirContas('tok');
    expect(r.avisos.join(' ')).toContain('token sem escopo');
  });
});

describe('quando não vem página nenhuma', () => {
  it('o aviso nomeia o usuário do sistema a quem faltam ativos', async () => {
    // Dizer "confira o usuário do sistema" sem dizer QUAL é mandar procurar.
    fingirMeta([
      ['me?fields=id,name', { id: '1209', name: 'Ide [CS]' }],
      CONTAS,
      ['me/accounts', { data: [] }],
    ]);
    const r = await descobrirContas('tok');
    expect(r.avisos.join(' ')).toContain('«Ide [CS]»');
  });
});

describe('o token vazio não vira chamada', () => {
  it('recusa antes de falar com a Meta', async () => {
    fingirMeta([]);
    await expect(descobrirContas('   ')).rejects.toThrow(/Sem token/);
  });
});
