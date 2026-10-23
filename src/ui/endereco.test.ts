/**
 * A ESCOLHA QUE MORA NO ENDEREÇO — etapa F17.24.
 *
 * O QUE PRECISA SER VERDADE SEMPRE
 *   O parâmetro vem da BARRA DE ENDEREÇO. Qualquer pessoa pode digitar
 *   `?aba=banana`, e o resultado tem que ser a aba padrão — nunca uma tela
 *   vazia, nunca um erro. É o mesmo contrato da leitura do armazenamento, e
 *   pelo mesmo motivo: a entrada não é nossa.
 */

import { describe, expect, it } from 'vitest';

import { ABAS, type Aba } from '@/board/meu-trabalho';
import { FORMAS, type Forma } from '@/board/meu-trabalho';
import { aplicarMudancas, escolhaValida, textoParaEndereco } from '@/ui/endereco';

describe('o parâmetro de tela', () => {
  it('sem parâmetro, vale o padrão de quem chama', () => {
    expect(escolhaValida<Aba>(null, ABAS, 'pendente')).toBe('pendente');
    expect(escolhaValida<Aba>(null, ABAS, 'delegado')).toBe('delegado');
  });

  it('valor conhecido passa', () => {
    expect(escolhaValida<Aba>('feito', ABAS, 'pendente')).toBe('feito');
    expect(escolhaValida<Forma>('quadro', FORMAS, 'lista')).toBe('quadro');
  });

  it('valor inventado vira o padrão em vez de tela vazia', () => {
    expect(escolhaValida<Aba>('banana', ABAS, 'pendente')).toBe('pendente');
    expect(escolhaValida<Forma>('calendario', FORMAS, 'lista')).toBe('lista');
  });

  it('espaço em volta e caixa alta não derrubam a escolha', () => {
    expect(escolhaValida<Aba>('  FEITO ', ABAS, 'pendente')).toBe('feito');
    expect(escolhaValida<Forma>('Quadro', FORMAS, 'lista')).toBe('quadro');
  });

  it('vazio vira o padrão', () => {
    expect(escolhaValida<Aba>('', ABAS, 'pendente')).toBe('pendente');
  });
});

describe('F05: parâmetros trocados juntos, e o texto que vai para o endereço', () => {
  it('a mudança preserva o que não mexeu (a aba não apaga a busca, a busca não apaga a forma)', () => {
    const antes = new URLSearchParams('aba=feito&ver=quadro');
    expect(aplicarMudancas(antes, { busca: 'carrossel' }).toString()).toBe('aba=feito&ver=quadro&busca=carrossel');
    expect(aplicarMudancas(new URLSearchParams('busca=carrossel&ver=quadro'), { aba: 'delegado', busca: 'carrossel' }).toString()).toBe(
      'busca=carrossel&ver=quadro&aba=delegado',
    );
  });

  it('valor vazio SAI do endereço, em vez de virar `?busca=`', () => {
    expect(aplicarMudancas(new URLSearchParams('aba=feito&busca=x'), { busca: '' }).toString()).toBe('aba=feito');
  });

  it('não muta o que recebeu — o React chama o atualizador duas vezes em modo estrito', () => {
    const antes = new URLSearchParams('aba=feito');
    aplicarMudancas(antes, { aba: 'pendente' });
    expect(antes.toString()).toBe('aba=feito');
  });

  it('só espaço é o mesmo que nada; o resto vai como foi digitado', () => {
    expect(textoParaEndereco('   ')).toBe('');
    expect(textoParaEndereco('')).toBe('');
    expect(textoParaEndereco('revisão ')).toBe('revisão ');
  });
});

describe('F11A: o recorte do painel gravado de uma vez', () => {
  it('as chaves do recorte substituem as de antes; o padrão sai e o resto fica', () => {
    const antes = new URLSearchParams('urgencia=perigo&ordem=nome&busca=caf%C3%A9&outra=1');
    const depois = aplicarMudancas(antes, {
      de: '',
      ate: '',
      urgencia: 'perigo,alerta',
      plano: '',
      etiqueta: '',
      financeiro: '',
      ordem: '',
      sentido: 'desc',
      busca: 'café',
    });
    expect(depois.get('urgencia')).toBe('perigo,alerta');
    expect(depois.get('ordem')).toBeNull();
    expect(depois.get('sentido')).toBe('desc');
    expect(depois.get('busca')).toBe('café');
    expect(depois.get('outra')).toBe('1');
  });
});
