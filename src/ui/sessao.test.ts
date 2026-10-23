/**
 * `sairDaConta` — F29. A sequência que morava inline no cabeçalho do Painel,
 * agora uma função só, chamada pelo menu da conta. O que se prova aqui é a
 * ORDEM, com dublês: é ela que protege o dado de quem sai (ver o comentário da
 * função em `ui/sessao.ts`). O pedido real a `/auth/logout` é provado no
 * navegador.
 */

import { describe, expect, it } from 'vitest';

import { type PassosDeSair, sairDaConta } from '@/ui/sessao';

function dubles(encerrar: () => Promise<unknown> = async () => ({ ok: true })) {
  const ordem: string[] = [];
  const passos: PassosDeSair = {
    limpar: () => ordem.push('limpar'),
    esquecer: () => ordem.push('esquecer'),
    encerrar: () => {
      ordem.push('encerrar');
      return encerrar();
    },
    avisar: () => ordem.push('avisar'),
    irParaEntrada: () => ordem.push('irParaEntrada'),
  };
  return { ordem, passos };
}

describe('sairDaConta', () => {
  it('limpa e esquece ANTES do servidor, avisa DEPOIS, e só então troca de página', async () => {
    const { ordem, passos } = dubles();
    await sairDaConta(passos);
    expect(ordem).toEqual(['limpar', 'esquecer', 'encerrar', 'avisar', 'irParaEntrada']);
  });

  it('o aviso às outras abas espera o servidor responder', async () => {
    let responder: () => void = () => {};
    const { ordem, passos } = dubles(() => new Promise<void>((r) => (responder = r)));
    const saindo = sairDaConta(passos);
    await Promise.resolve();
    // O servidor ainda não respondeu: a limpeza local já aconteceu, o aviso não.
    expect(ordem).toEqual(['limpar', 'esquecer', 'encerrar']);
    responder();
    await saindo;
    expect(ordem).toEqual(['limpar', 'esquecer', 'encerrar', 'avisar', 'irParaEntrada']);
  });

  it('com a rede fora, a pessoa sai do mesmo jeito — a falha do servidor não a prende', async () => {
    const { ordem, passos } = dubles(() => Promise.reject(new Error('rede fora')));
    await expect(sairDaConta(passos)).resolves.toBeUndefined();
    expect(ordem).toEqual(['limpar', 'esquecer', 'encerrar', 'avisar', 'irParaEntrada']);
  });
});
