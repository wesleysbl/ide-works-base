/**
 * As visões do Planejamento no endereço e o mês dos dados — F43, Fase 2; o
 * cliente do painel no endereço — Fase 3; a visão Calendário, o mês no
 * endereço e o desvio de `/calendario` — Fase 4.
 */

import { describe, expect, it } from 'vitest';

import {
  ROTULO_DA_VISAO,
  VISOES,
  clienteDoEndereco,
  criarEsperaDaReleitura,
  enderecoDoCalendarioAntigo,
  enderecoDoPainel,
  fraseDaFalha,
  itemDaBarraDaVisao,
  leituraDoMes,
  mesDoEndereco,
  mesValido,
  mudancasDaVisao,
  mudancasDoMes,
  mudancasDoPainel,
  visaoDoEndereco,
} from '@/painel/visoes-do-planejamento';
import { aplicarMudancas } from '@/ui/endereco';

const visao = (busca: string) => visaoDoEndereco(new URLSearchParams(busca));

describe('a visão que o endereço pede', () => {
  it('sem parâmetro, abre Contrato', () => {
    expect(visao('')).toBe('contrato');
  });

  it('?visao=semanas abre Semanas; ?visao=contrato, Contrato', () => {
    expect(visao('visao=semanas')).toBe('semanas');
    expect(visao('visao=contrato')).toBe('contrato');
  });

  it('tolerante: caixa e espaço não importam', () => {
    expect(visao('visao=%20Semanas%20')).toBe('semanas');
  });

  it('valor desconhecido abre Contrato (Casos de Borda do plano)', () => {
    expect(visao('visao=banana')).toBe('contrato');
  });

  it('F43 Fase 4: `?visao=calendario` abre o Calendário, a terceira aba', () => {
    expect(VISOES).toEqual(['contrato', 'semanas', 'calendario']);
    expect(ROTULO_DA_VISAO.calendario).toBe('Calendário');
    expect(visao('visao=calendario')).toBe('calendario');
    expect(visao('visao=Calendario')).toBe('calendario');
  });

  it('o ?aba=semana de antes da F43 continua abrindo Semanas', () => {
    expect(visao('aba=semana')).toBe('semanas');
  });

  it('o ?aba=mes antigo abre Contrato, onde o mês do cliente mora agora', () => {
    expect(visao('aba=mes')).toBe('contrato');
  });

  it('com as duas chaves, `visao` manda — é a escrita mais nova', () => {
    expect(visao('aba=semana&visao=contrato')).toBe('contrato');
  });

  it('`visao` inválida não apaga o `aba` antigo válido', () => {
    expect(visao('visao=banana&aba=semana')).toBe('semanas');
  });

  it('`aba` inventada vira Contrato', () => {
    expect(visao('aba=quadro')).toBe('contrato');
  });
});

describe('escolher uma visão', () => {
  it('grava `visao` e tira o `aba` antigo, sem mexer no resto do endereço', () => {
    const antes = new URLSearchParams('aba=semana&outro=1');
    const depois = aplicarMudancas(antes, mudancasDaVisao('contrato'));
    expect(depois.toString()).toBe('outro=1&visao=contrato');
  });

  it('a visão padrão também é escrita: o endereço colado vale para quem tem outra', () => {
    expect(mudancasDaVisao('contrato')).toEqual({ visao: 'contrato', aba: '' });
  });
});

describe('a barra na visão Calendário — Fase 4', () => {
  it('na visão Calendário, o item aceso é o Calendário (foi por ele que se chegou)', () => {
    expect(itemDaBarraDaVisao('calendario')).toBe('calendario');
  });

  it('nas outras visões, o Planejamento', () => {
    expect(itemDaBarraDaVisao('contrato')).toBe('planejamento');
    expect(itemDaBarraDaVisao('semanas')).toBe('planejamento');
  });
});

describe('o mês no endereço — Fase 4', () => {
  const mes = (busca: string) => mesDoEndereco(new URLSearchParams(busca), '2026-10');

  it('sem `mes`, vale o padrão (o mês de hoje, que a tela fixa ao abrir)', () => {
    expect(mes('')).toBe('2026-10');
    expect(mes('visao=calendario&cliente=p-2')).toBe('2026-10');
  });

  it('`?mes=AAAA-MM` abre aquele mês — o link colado também, com o cliente junto', () => {
    expect(mes('mes=2026-12')).toBe('2026-12');
    expect(mes('visao=contrato&mes=2027-01&cliente=p-2')).toBe('2027-01');
  });

  it('tolerante: espaço em volta não importa', () => {
    expect(mes('mes=%202026-11%20')).toBe('2026-11');
  });

  it('inválido vale o mês de hoje, e não tela vazia', () => {
    for (const cru of ['2026-13', '2026-00', '2026-1', 'banana', '26-10', '2026-10-05', '', '0000-01', '2100-01']) {
      expect(mes(`mes=${cru}`), cru).toBe('2026-10');
    }
  });

  it('`mesValido` é a mesma régua para o campo do calendário e para o endereço', () => {
    expect(mesValido('2026-12')).toBe('2026-12');
    expect(mesValido(' 1999-01 ')).toBe('1999-01');
    expect(mesValido('2026-13')).toBeNull();
    expect(mesValido(null)).toBeNull();
    expect(mesValido(undefined)).toBeNull();
  });

  it('escolher um mês grava `mes` sem mexer na visão nem no cliente', () => {
    const antes = new URLSearchParams('visao=calendario&cliente=p-2');
    expect(aplicarMudancas(antes, mudancasDoMes('2026-11')).toString()).toBe('visao=calendario&cliente=p-2&mes=2026-11');
  });

  it('o `href` do painel leva o mês junto — o link do cliente abre no mês certo', () => {
    expect(enderecoDoPainel(new URLSearchParams('mes=2026-09'), 'p-2')).toBe('?mes=2026-09&cliente=p-2');
  });
});

describe('`/calendario` leva à visão Calendário — Fase 4', () => {
  it('sem consulta, vai direto à visão', () => {
    expect(enderecoDoCalendarioAntigo('')).toBe('/planejamento?visao=calendario');
  });

  it('o resto da consulta vem junto: um `?mes=` colado vale lá também', () => {
    expect(enderecoDoCalendarioAntigo('?mes=2026-12')).toBe('/planejamento?visao=calendario&mes=2026-12');
    expect(enderecoDoCalendarioAntigo('?mes=2026-12&cliente=p-2')).toBe('/planejamento?visao=calendario&mes=2026-12&cliente=p-2');
  });

  it('`visao` e o `aba` antigo não passam: o destino é o Calendário', () => {
    expect(enderecoDoCalendarioAntigo('?visao=semanas&aba=mes')).toBe('/planejamento?visao=calendario');
  });
});

describe('o cliente do painel no endereço — Fase 3', () => {
  const cliente = (busca: string) => clienteDoEndereco(new URLSearchParams(busca));

  it('sem `cliente`, sem painel', () => {
    expect(cliente('')).toBeNull();
    expect(cliente('visao=semanas')).toBeNull();
  });

  it('`?cliente=<id>` abre o painel daquele cliente — o link colado também', () => {
    expect(cliente('cliente=p-2')).toBe('p-2');
    expect(cliente('visao=contrato&cliente=cl-5')).toBe('cl-5');
    expect(cliente('cliente=6f1d1c9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f')).toBe('6f1d1c9e-1b2a-4c3d-9e8f-0a1b2c3d4e5f');
  });

  it('tolerante: espaço em volta não importa; vazio é "sem painel"', () => {
    expect(cliente('cliente=%20p-2%20')).toBe('p-2');
    expect(cliente('cliente=')).toBeNull();
    expect(cliente('cliente=%20%20')).toBeNull();
  });

  it('o que não tem forma de id não abre nada — ele iria parar num link', () => {
    expect(cliente('cliente=%3Cscript%3E')).toBeNull();
    expect(cliente('cliente=..%2Fpainel')).toBeNull();
    expect(cliente(`cliente=${'a'.repeat(65)}`)).toBeNull();
  });

  it('abrir grava `cliente`; fechar o tira — sem mexer na visão', () => {
    const antes = new URLSearchParams('visao=semanas');
    const aberto = aplicarMudancas(antes, mudancasDoPainel('p-2'));
    expect(aberto.toString()).toBe('visao=semanas&cliente=p-2');
    expect(aplicarMudancas(aberto, mudancasDoPainel(null)).toString()).toBe('visao=semanas');
  });

  it('o `href` do painel é só a consulta, com a visão de agora', () => {
    expect(enderecoDoPainel(new URLSearchParams(''), 'p-2')).toBe('?cliente=p-2');
    expect(enderecoDoPainel(new URLSearchParams('visao=contrato'), 'p-2')).toBe('?visao=contrato&cliente=p-2');
    // Com outro painel aberto, troca o cliente — não acumula.
    expect(enderecoDoPainel(new URLSearchParams('cliente=p-1&visao=semanas'), 'p-3')).toBe('?cliente=p-3&visao=semanas');
  });
});

describe('o mês dos dados (a regra da F35)', () => {
  const outubro = { mes: '2026-10', valor: ['números de outubro'] };

  it('os dados só aparecem sob o mês de que são', () => {
    expect(leituraDoMes(outubro, null, '2026-10')).toEqual({ dados: ['números de outubro'], erro: null, carregando: false });
  });

  it('trocou o mês e a resposta não chegou: carregando, e nenhum número do mês anterior', () => {
    expect(leituraDoMes(outubro, null, '2026-11')).toEqual({ dados: null, erro: null, carregando: true });
  });

  it('o erro de novembro não fica sobre outubro, e outubro não fica sob o erro de novembro', () => {
    const falha = { mes: '2026-11', texto: 'Falhou.' };
    expect(leituraDoMes(outubro, falha, '2026-11')).toEqual({ dados: null, erro: 'Falhou.', carregando: false });
    expect(leituraDoMes(outubro, falha, '2026-10')).toEqual({ dados: ['números de outubro'], erro: null, carregando: false });
  });

  it('a releitura do MESMO mês que falha mantém os dados dele na tela, com o aviso', () => {
    const falha = { mes: '2026-10', texto: 'Falhou.' };
    expect(leituraDoMes(outubro, falha, '2026-10')).toEqual({ dados: ['números de outubro'], erro: 'Falhou.', carregando: false });
  });

  it('a frase da falha diz de que mês ela é, e traz a do servidor inteira', () => {
    expect(fraseDaFalha('2026-11', 'Sem permissão.')).toBe('O planejamento de novembro de 2026 não carregou. Sem permissão.');
    expect(fraseDaFalha('2026-11', '')).toBe('O planejamento de novembro de 2026 não carregou.');
  });
});

/* A RELEITURA QUE SE PODE ESPERAR — revisão pós-F43. O `recarregar` da página
   devolvia `void`, e a `Semanal` do painel do cliente faz `await aoMudar()`
   para serializar cliques e contar `naBase` com o mês fresco: sem promessa,
   o segundo `+` saía antes de o primeiro aparecer, com `naBase` velho. */
describe('a releitura que se pode esperar', () => {
  const pronta = async (p: Promise<void>) => {
    let foi = false;
    void p.then(() => {
      foi = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    return foi;
  };

  it('a espera termina quando chega a leitura que começou DEPOIS do pedido', async () => {
    const e = criarEsperaDaReleitura();
    const primeira = e.comecou(); // a leitura que já estava em voo
    const relido = e.proxima(); // "relê": quem chama quer o dado de depois da escrita
    const segunda = e.comecou(); // a releitura que o pedido disparou
    e.chegou(primeira);
    expect(await pronta(relido)).toBe(false); // a de antes não serve
    e.chegou(segunda);
    expect(await pronta(relido)).toBe(true);
  });

  it('cada espera termina uma vez, e uma leitura atende todas as que vieram antes dela', async () => {
    const e = criarEsperaDaReleitura();
    const a = e.proxima();
    const b = e.proxima();
    const g = e.comecou();
    e.chegou(g);
    expect(await pronta(a)).toBe(true);
    expect(await pronta(b)).toBe(true);
    const c = e.proxima();
    e.chegou(g); // a mesma leitura de novo não atende quem pediu depois dela
    expect(await pronta(c)).toBe(false);
  });
});
