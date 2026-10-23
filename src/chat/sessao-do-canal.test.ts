import { describe, expect, it } from 'vitest';

import { depoisDeFecharSemAbrir } from '@/chat/sessao-do-canal';
import { ApiError } from '@/lib/api';

describe('o canal que fecha sem ter aberto passa pela sessão antes de tentar de novo', () => {
  it('confere a sessão antes de decidir — é essa chamada que renova o login vencido', async () => {
    let conferiu = 0;
    const r = await depoisDeFecharSemAbrir(async () => {
      conferiu += 1;
    });
    expect(conferiu).toBe(1);
    expect(r).toBe('tentar-de-novo');
  });

  it('sessão encerrada de vez: para de tentar, em vez de bater na porta a cada 30 s', async () => {
    const r = await depoisDeFecharSemAbrir(async () => {
      throw new ApiError('Sessão inválida ou expirada. Entre novamente.', 401);
    });
    expect(r).toBe('parar');
  });

  it('rede caída ou renovação indisponível: tenta de novo, porque a sessão não acabou', async () => {
    const rede = await depoisDeFecharSemAbrir(async () => {
      throw new ApiError('Sem conexão.', 0, undefined, undefined, true);
    });
    const indisponivel = await depoisDeFecharSemAbrir(async () => {
      throw new ApiError('Não foi possível renovar agora.', 503, undefined, undefined, true);
    });
    const qualquer = await depoisDeFecharSemAbrir(async () => {
      throw new Error('inesperado');
    });
    expect([rede, indisponivel, qualquer]).toEqual([
      'tentar-de-novo',
      'tentar-de-novo',
      'tentar-de-novo',
    ]);
  });
});
