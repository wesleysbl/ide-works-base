/**
 * O contexto da ficha do cliente no endereço — F11B do plano UX.
 *
 * O QUE PRECISA SER VERDADE SEMPRE
 *   O endereço vem da barra: qualquer coisa pode ser digitada. Cada peça
 *   inválida vira o padrão DELA sem derrubar as outras, e o padrão nunca é
 *   escrito — a ficha aberta pela carteira tem o endereço limpo de sempre.
 */

import { describe, expect, it } from 'vitest';

import {
  AREAS,
  chaveDaLeitura,
  contextoParaEndereco,
  enderecoDoCliente,
  lerContexto,
  mesValido,
  observacoesLongas,
  periodoDaProducao,
} from '@/clients/contexto';
import { aplicarMudancas } from '@/ui/endereco';

const MES = '2026-09';
const ler = (q: string) => lerContexto(new URLSearchParams(q), MES);

describe('ler o contexto do endereço', () => {
  it('sem parâmetro: Conteúdos, o mês corrente, o mês inteiro', () => {
    expect(ler('')).toEqual({ area: 'conteudos', mes: MES, periodo: null });
  });

  it('as sete áreas, na ordem da tela, e nenhuma oitava', () => {
    expect(AREAS).toEqual(['conteudos', 'calendario', 'checklist', 'semanal', 'captacao', 'mural', 'historico']);
    for (const a of AREAS) expect(ler(`area=${a}`).area).toBe(a);
  });

  it('o deep link inteiro volta como foi escrito', () => {
    expect(ler('area=semanal&mes=2026-08&de=2026-08-11&ate=2026-08-14')).toEqual({
      area: 'semanal',
      mes: '2026-08',
      periodo: { de: '2026-08-11', ate: '2026-08-14' },
    });
  });

  it('cada peça inválida vira o padrão dela, sem derrubar as outras', () => {
    expect(ler('area=banana&mes=2026-08')).toEqual({ area: 'conteudos', mes: '2026-08', periodo: null });
    expect(ler('area=mural&mes=2026-13').mes).toBe(MES);
    expect(ler('area=mural&mes=26-08').area).toBe('mural');
    expect(ler('area=MURAL').area).toBe('mural');
  });

  it('período: os dois ou nenhum, data real, em ordem, até 36 meses', () => {
    expect(periodoDaProducao('2026-08-11', null)).toBeNull();
    expect(periodoDaProducao('2026-02-31', '2026-03-02')).toBeNull();
    expect(periodoDaProducao('2026-08-14', '2026-08-11')).toBeNull();
    expect(periodoDaProducao('2020-01-01', '2026-12-31')).toBeNull();
    expect(periodoDaProducao('2026-08-11', '2026-08-11')).toEqual({ de: '2026-08-11', ate: '2026-08-11' });
  });

  it('mês: AAAA-MM de verdade', () => {
    expect(mesValido('2026-01')).toBe(true);
    expect(mesValido('2026-00')).toBe(false);
    expect(mesValido('1999-12')).toBe(false);
    expect(mesValido(null)).toBe(false);
  });
});

describe('escrever o contexto no endereço', () => {
  it('o padrão nunca é escrito — as chaves saem', () => {
    const r = aplicarMudancas(
      new URLSearchParams('area=mural&mes=2026-08&de=2026-08-01&ate=2026-08-02'),
      contextoParaEndereco({ area: 'conteudos', mes: MES, periodo: null }, MES),
    );
    expect(r.toString()).toBe('');
  });

  it('trocar a área leva competência e período juntos (uma gravação só)', () => {
    const agora = ler('mes=2026-08&de=2026-08-11&ate=2026-08-14');
    const r = aplicarMudancas(new URLSearchParams(), contextoParaEndereco({ ...agora, area: 'mural' }, MES));
    expect(Object.fromEntries(r)).toEqual({ area: 'mural', mes: '2026-08', de: '2026-08-11', ate: '2026-08-14' });
  });

  it('parâmetro de outra peça na mesma tela não é apagado', () => {
    const r = aplicarMudancas(new URLSearchParams('x=1'), contextoParaEndereco(ler('area=semanal'), MES));
    expect(r.get('x')).toBe('1');
    expect(r.get('area')).toBe('semanal');
  });

  it('o vizinho abre na mesma área, competência e período', () => {
    expect(enderecoDoCliente('cx-2', ler('area=checklist&mes=2026-08'), MES)).toBe('/cliente/cx-2?area=checklist&mes=2026-08');
    expect(enderecoDoCliente('cx-2', ler(''), MES)).toBe('/cliente/cx-2');
  });
});

describe('a chave da leitura', () => {
  it('muda com cliente, competência e período — não com a área', () => {
    const a = chaveDaLeitura('c1', ler('area=mural&mes=2026-08'));
    expect(chaveDaLeitura('c1', ler('area=semanal&mes=2026-08'))).toBe(a);
    expect(chaveDaLeitura('c2', ler('mes=2026-08'))).not.toBe(a);
    expect(chaveDaLeitura('c1', ler('mes=2026-07'))).not.toBe(a);
    expect(chaveDaLeitura('c1', ler('mes=2026-08&de=2026-08-01&ate=2026-08-02'))).not.toBe(a);
  });
});

describe('observações longas', () => {
  it('curta não recolhe; comprida ou com muitas linhas, sim', () => {
    expect(observacoesLongas(null)).toBe(false);
    expect(observacoesLongas('Priorizar a campanha.\nRevisar antes.')).toBe(false);
    expect(observacoesLongas('x'.repeat(281))).toBe(true);
    expect(observacoesLongas('1\n2\n3\n4\n5\n6')).toBe(true);
  });
});
