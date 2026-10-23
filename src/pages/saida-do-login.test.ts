import { describe, expect, it } from 'vitest';

import { sairDoLogin, saidaDepoisDeEntrar } from './saida-do-login';

describe('saída depois de entrar', () => {
  it('manda o retorno do OAuth para o Worker, por navegação de documento', () => {
    const saida = saidaDepoisDeEntrar('/oauth/authorize');
    expect(saida).toEqual({ tipo: 'documento', destino: '/oauth/authorize' });

    const aplicacao: string[] = [];
    const documento: string[] = [];
    sairDoLogin(saida, (d) => aplicacao.push(d), (d) => documento.push(d));

    // Se isto virar `navigate`, o roteador procura `/oauth/authorize` entre as
    // rotas da aplicação, não acha, e desenha "Página não encontrada" — o
    // pedido guardado no cookie nunca chega ao servidor.
    expect(documento).toEqual(['/oauth/authorize']);
    expect(aplicacao).toEqual([]);
  });

  it('sem `next`, vai para o painel pelo roteador, substituindo o histórico', () => {
    const saida = saidaDepoisDeEntrar(null);
    expect(saida).toEqual({ tipo: 'aplicacao', destino: '/painel' });

    const chamadas: Array<[string, { replace: boolean }]> = [];
    sairDoLogin(saida, (d, o) => chamadas.push([d, o]), () => {
      throw new Error('destino interno não pode sair da aplicação');
    });
    expect(chamadas).toEqual([['/painel', { replace: true }]]);
  });

  it('qualquer outro `next` continua preso ao painel — nada de redirecionamento aberto', () => {
    for (const next of ['https://exemplo.com', '//exemplo.com', '/oauth/authorize/../x', '/painel']) {
      expect(saidaDepoisDeEntrar(next)).toEqual({ tipo: 'aplicacao', destino: '/painel' });
    }
  });
});
