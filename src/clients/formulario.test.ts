import { describe, expect, it } from 'vitest';

import {
  ENTRADA_VAZIA,
  type EntradaDeCliente,
  documentoEhValido,
  emailEhValido,
  formatarDocumento,
  formatarTelefone,
  normalizarUrl,
  soDigitos,
  telefoneEhValido,
  validarCliente,
} from '@/clients/formulario';

const valida = (over: Partial<EntradaDeCliente> = {}) =>
  validarCliente({
    ...ENTRADA_VAZIA,
    name: 'Ótica Rubi',
    categoryId: 'cat-1',
    startedOn: '2026-01-10',
    ...over,
  });

describe('documento', () => {
  it.each(['111.444.777-35', '11144477735'])('aceita CPF valido %s', (v) => {
    expect(documentoEhValido(v)).toBe(true);
  });

  it('recusa CPF com digito verificador errado', () => {
    // O legado guarda isto sem reclamar, porque o campo la e texto com mascara.
    expect(documentoEhValido('111.444.777-36')).toBe(false);
  });

  it('recusa CPF de digitos todos iguais', () => {
    // Passa na conta do modulo 11 — e o furo classico de quem so faz a soma.
    expect(documentoEhValido('111.111.111-11')).toBe(false);
  });

  it.each(['11.222.333/0001-81', '11222333000181'])('aceita CNPJ valido %s', (v) => {
    expect(documentoEhValido(v)).toBe(true);
  });

  it('recusa CNPJ com digito errado', () => {
    expect(documentoEhValido('11.222.333/0001-82').valueOf()).toBe(false);
  });

  it('recusa CNPJ de digitos todos iguais', () => {
    expect(documentoEhValido('11111111111111')).toBe(false);
  });

  it('recusa comprimento que nao e nem CPF nem CNPJ', () => {
    expect(documentoEhValido('123')).toBe(false);
    expect(documentoEhValido('')).toBe(false);
  });

  it('formata para leitura', () => {
    expect(formatarDocumento('11144477735')).toBe('111.444.777-35');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('devolve o original quando nao sabe formatar', () => {
    expect(formatarDocumento('abc')).toBe('abc');
  });

  it('soDigitos tira tudo que nao e numero', () => {
    expect(soDigitos('(16) 99123-4567')).toBe('16991234567');
  });
});

describe('telefone', () => {
  it('aceita fixo com DDD', () => {
    expect(telefoneEhValido('(16) 3000-1234')).toBe(true);
  });

  it('aceita celular com o nono digito', () => {
    expect(telefoneEhValido('(16) 99123-4567')).toBe(true);
  });

  it('enxerga o numero certo sob a mascara torta do legado', () => {
    // A ficha de um cliente real mostra `(16) 30001-234`. Sao os dez digitos
    // corretos de um fixo, com a mascara no lugar errado — o numero nunca
    // esteve errado, so a apresentacao guardada junto com ele.
    expect(telefoneEhValido('(16) 30001-234')).toBe(true);
    expect(formatarTelefone('(16) 30001-234')).toBe('(16) 3000-1234');
  });

  it('recusa telefone curto de verdade', () => {
    expect(telefoneEhValido('3000-1234')).toBe(false);
    expect(telefoneEhValido('')).toBe(false);
  });

  it('recusa onze digitos cujo terceiro nao e 9', () => {
    expect(telefoneEhValido('16812345678')).toBe(false);
  });

  it('formata os dois comprimentos', () => {
    expect(formatarTelefone('1630001234')).toBe('(16) 3000-1234');
    expect(formatarTelefone('16991234567')).toBe('(16) 99123-4567');
  });
});

describe('normalizarUrl', () => {
  it('mantem https intocado', () => {
    expect(normalizarUrl('https://instagram.com/ide')).toBe('https://instagram.com/ide');
  });

  it('aceita esquema de aplicativo que nao esta em lista nenhuma', () => {
    // O legado tem `sheinlink://` cadastrado. Lista fechada recusaria dado real.
    expect(normalizarUrl('sheinlink://shein.com/store/home')).toBe(
      'sheinlink://shein.com/store/home',
    );
    expect(normalizarUrl('whatsapp://send?phone=5516999999999')).toBe(
      'whatsapp://send?phone=5516999999999',
    );
  });

  it('completa o esquema de dominio digitado sem ele', () => {
    // Existe assim no legado: `www.linkedin.com/in/lojaexemplodistribuidora`.
    expect(normalizarUrl('www.linkedin.com/in/alguem')).toBe('https://www.linkedin.com/in/alguem');
    expect(normalizarUrl('instagram.com/ide')).toBe('https://instagram.com/ide');
  });

  it('recusa o que executa script', () => {
    expect(normalizarUrl('javascript:alert(1)')).toBeNull();
    // Com as barras o esquema parece bem-formado, e o resto vira comentario JS.
    expect(normalizarUrl('javascript://x%0Aalert(1)')).toBeNull();
    expect(normalizarUrl('data:text/html,<script>')).toBeNull();
    expect(normalizarUrl('VBScript:msgbox(1)')).toBeNull();
  });

  it('recusa texto que nao e endereco', () => {
    expect(normalizarUrl('o instagram dele')).toBeNull();
  });

  it('vazio devolve nulo sem reclamar', () => {
    expect(normalizarUrl('   ')).toBeNull();
  });
});

describe('emailEhValido', () => {
  it('aceita o comum', () => {
    expect(emailEhValido('contato@empresa.com.br')).toBe(true);
  });
  it('recusa sem arroba ou sem ponto', () => {
    expect(emailEhValido('contato')).toBe(false);
    expect(emailEhValido('contato@empresa')).toBe(false);
  });
});

describe('validarCliente', () => {
  it('aceita o minimo: nome, categoria e inicio', () => {
    const r = valida();
    expect(r.ok).toBe(true);
  });

  it('exige nome e categoria', () => {
    const r = validarCliente({ ...ENTRADA_VAZIA, startedOn: '2026-01-10' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros.name).toBeDefined();
    expect(r.erros.categoryId).toBeDefined();
  });

  it('recusa renovacao anterior ao inicio', () => {
    const r = valida({ startedOn: '2026-05-01', renewsOn: '2026-04-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.renewsOn).toMatch(/anterior/);
  });

  it('aceita renovacao no mesmo dia do inicio', () => {
    expect(valida({ startedOn: '2026-05-01', renewsOn: '2026-05-01' }).ok).toBe(true);
  });

  it('guarda documento e telefone como digito, nao como mascara', () => {
    const r = valida({ taxId: '111.444.777-35', phone: '(16) 3000-1234' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.taxId).toBe('11144477735');
    expect(r.valor.phone).toBe('1630001234');
  });

  it('campo opcional em branco vira nulo, nao string vazia', () => {
    const r = valida();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.taxId).toBeNull();
    expect(r.valor.notes).toBeNull();
    expect(r.valor.renewsOn).toBeNull();
  });

  it('recusa quantidade negativa e quebrada', () => {
    expect(valida({ quotas: { video: -1, arte: 0, foto: 0, ads: 0 } }).ok).toBe(false);
    expect(valida({ quotas: { video: 1.5, arte: 0, foto: 0, ads: 0 } }).ok).toBe(false);
  });

  it('ignora linha de link totalmente em branco', () => {
    const r = valida({ links: [{ title: '', url: '' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor.links).toEqual([]);
  });

  it('reclama de link pela metade', () => {
    const r = valida({ links: [{ title: '', url: 'https://x.com' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.link0).toMatch(/nome/);
  });

  it('numera a ordem dos links, ignorando as linhas vazias no meio', () => {
    const r = valida({
      links: [
        { title: 'WhatsApp', url: 'wa.me/5516999999999' },
        { title: '', url: '' },
        { title: 'Instagram', url: 'instagram.com/ide' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.links).toEqual([
      { title: 'WhatsApp', url: 'https://wa.me/5516999999999', sortOrder: 0 },
      { title: 'Instagram', url: 'https://instagram.com/ide', sortOrder: 1 },
    ]);
  });

  it('avisa da duplicata antes de o banco recusar', () => {
    const r = valida({
      links: [
        { title: 'Instagram', url: 'https://instagram.com/ide' },
        { title: 'instagram', url: 'HTTPS://INSTAGRAM.COM/IDE' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.link1).toMatch(/já está/);
  });

  it('deixa passar o mesmo endereco com rotulos diferentes', () => {
    // Uso legitimo, medido no legado: 19 casos. O indice unico e sobre o par.
    const r = valida({
      links: [
        { title: 'WhatsApp', url: 'https://wa.me/551699' },
        { title: 'WhatsApp Comercial', url: 'https://wa.me/551699' },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('junta todos os erros de uma vez, em vez de parar no primeiro', () => {
    const r = validarCliente({ ...ENTRADA_VAZIA, taxId: '123', companyEmail: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).length).toBeGreaterThanOrEqual(4);
  });

  it('ignora alvo de lista vazio, e não recusa o salvamento', () => {
    const r = valida({ boardListIds: ['', '  ', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.boardListIds).toEqual(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
  });

  it('alvo de lista repetido na mesma ficha é desduplicado, não recusado', () => {
    const a = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const b = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const r = valida({ boardListIds: [a, b, a, ` ${a} `] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.boardListIds).toEqual([a, b]);
  });

  it('preserva a ordem escolhida das listas, ignorando vazio no meio', () => {
    const a = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const b = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
    const c = 'cccccccc-dddd-eeee-ffff-000000000000';
    const r = valida({ boardListIds: [b, '', a, '  ', c] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.boardListIds).toEqual([b, a, c]);
  });
});
