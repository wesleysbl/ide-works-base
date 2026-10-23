import { describe, expect, it } from 'vitest';

import { RemoteNetworkBlocked } from './network-guard';

describe('isolamento de rede da suite (F0.4)', () => {
  it.each([
    ['o projeto de banco de producao', 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/clients'],
    ['a API da Meta', 'https://graph.facebook.com/v21.0/me'],
    ['qualquer host remoto', 'https://exemplo.com'],
  ])('bloqueia %s', async (_nome, url) => {
    await expect(fetch(url)).rejects.toThrow(RemoteNetworkBlocked);
  });

  it('nomeia o destino bloqueado, para o erro ser acionavel', async () => {
    await expect(fetch('https://graph.facebook.com/v21.0/me')).rejects.toThrow(
      /graph\.facebook\.com/,
    );
  });

  it('explica por que bloqueia, citando o legado', async () => {
    await expect(fetch('https://exemplo.com')).rejects.toThrow(/legado/);
  });

  it('deixa passar destino local', async () => {
    // Nao ha servidor de pe: o que importa e o erro ser de conexao recusada,
    // e NAO o nosso bloqueio. Prova que local passa pela trava.
    await expect(fetch('http://127.0.0.1:59999/')).rejects.not.toThrow(RemoteNetworkBlocked);
  });
})
