import { describe, expect, it } from 'vitest';

import { type ClienteRef, extrairPrefixo, normalizar, rotuloDoCliente, sugerirCliente } from './sugestao';

const c = (id: string, name: string, isActive = true): ClienteRef => ({ id, name, isActive });

const CLIENTES = [
  c('fonseca', 'Fonseca Moura Contrutora'),
  c('pex', 'PEX Equipamentos'),
  c('mirela', 'Mirela Enxovais'),
  c('vitta', 'Clínica +Vitta'),
  c('cartao', 'Cartão +Vitta'),
  c('proforma', 'Pró-Forma Equipamentos'),
  c('charme', 'Capricho do Detalhe', false),
  c('cheia', 'Cheia de Cor', false),
  c('clinica-ravel', 'Clínica Ravel', false),
  c('clinica-sorrir', 'Clinica Sorrir', false),
  c('ltda', 'Ortokey Ibitinga Colchões LTDA'),
];

describe('extrairPrefixo', () => {
  it('tira a etiqueta e pega o que vem antes do " - "', () => {
    expect(extrairPrefixo('[A] FONSECA MOURA - MITOS SOBRE A CASA PRÓPRIA')).toBe('FONSECA MOURA');
    expect(extrairPrefixo('[V] [F] ZETA - MAQUINA NOVA')).toBe('ZETA');
    expect(extrairPrefixo('FONSECA – algo')).toBe('FONSECA');
  });

  it('título sem separador ou com prefixo sem letra não tem prefixo', () => {
    expect(extrairPrefixo('O TOQUE FINAL')).toBeNull();
    expect(extrairPrefixo('[A] SEMANA 3 HL')).toBeNull();
    expect(extrairPrefixo('07 - PRODUTOS DE 2 A 30 REAIS')).toBeNull();
    expect(extrairPrefixo('30/03 - SEMANA')).toBeNull();
  });
});

describe('sugerirCliente', () => {
  it('"[A] FONSECA MOURA - …" sugere a Fonseca com certeza "exato"', () => {
    const s = sugerirCliente('[A] FONSECA MOURA - CASA POPULAR DIFERENCIAL', CLIENTES);
    expect(s.grau).toBe('exato');
    expect(s.cliente?.id).toBe('fonseca');
    expect(s.prefixo).toBe('FONSECA MOURA');
  });

  it('o começo do nome, em palavras inteiras e inequívoco, é exato', () => {
    expect(sugerirCliente('FONSECA - X', CLIENTES)).toMatchObject({ grau: 'exato', cliente: { id: 'fonseca' } });
    expect(sugerirCliente('[V] MIRELA - BEACH 2 BF', CLIENTES)).toMatchObject({ grau: 'exato', cliente: { id: 'mirela' } });
    expect(sugerirCliente('[A] PRÓ-FORMA - BANCO', CLIENTES)).toMatchObject({ grau: 'exato', cliente: { id: 'proforma' } });
  });

  it('casa sem se importar com acento, maiúscula e palavra de empresa', () => {
    expect(sugerirCliente('[A] pro forma - x', CLIENTES).cliente?.id).toBe('proforma');
    expect(sugerirCliente('ORTOKEY IBITINGA COLCHOES - x', CLIENTES)).toMatchObject({ grau: 'exato', cliente: { id: 'ltda' } });
    expect(normalizar('Clínica +Vitta')).toBe('clinica vitta');
    expect(normalizar('Pity & Rê')).toBe(normalizar('PITY E RÊ'));
  });

  it('título sem prefixo fica sem sugestão', () => {
    expect(sugerirCliente('2 - O TOQUE FINAL', CLIENTES)).toMatchObject({ grau: 'nenhum', cliente: null, prefixo: null });
    expect(sugerirCliente('[A] SEMANA 3 - HL', CLIENTES).cliente).toBeNull();
  });

  it('o nome do cliente no começo de um prefixo maior é "parecido"', () => {
    const s = sugerirCliente('[A] CLINICA VITTA IBITINGA - DOR DE CABEÇA', CLIENTES);
    expect(s).toMatchObject({ grau: 'parecido', cliente: { id: 'vitta' } });
  });

  it('erro de digitação pequeno é "parecido"', () => {
    expect(sugerirCliente('[A] FONSECA MOURO - X', CLIENTES)).toMatchObject({ grau: 'parecido', cliente: { id: 'fonseca' } });
  });

  it('duas letras de diferença numa palavra curta é outro nome, não erro de digitação', () => {
    const kr = [c('kr', 'KM Enxovais', false)];
    expect(sugerirCliente('VE ENXOVAIS - KIT', kr).grau).toBe('nenhum');
    expect(sugerirCliente('CARTAS - IDE', CLIENTES).grau).toBe('nenhum');
  });

  it('ambíguo não se chuta: grau "nenhum" com os candidatos', () => {
    const s = sugerirCliente('CLINICA - X', CLIENTES);
    expect(s.grau).toBe('nenhum');
    expect(s.cliente).toBeNull();
    expect(s.candidatos.map((x) => x.id).sort()).toEqual(['clinica-ravel', 'clinica-sorrir', 'vitta']);
  });

  it('prefixo que não é cliente fica sem sugestão', () => {
    expect(sugerirCliente('[A] JOIA CASA - Estamos abertos', CLIENTES).grau).toBe('nenhum');
    expect(sugerirCliente('ALMA 9 - DELICATO SORVETE', CLIENTES).grau).toBe('nenhum');
  });

  it('cancelado também é sugerido, e o rótulo sinaliza', () => {
    const s = sugerirCliente('[A] CAPRICHO DO DETALHE - X', CLIENTES);
    expect(s.cliente?.id).toBe('charme');
    expect(rotuloDoCliente(s.cliente as ClienteRef)).toBe('Capricho do Detalhe (cancelado)');
  });
});
