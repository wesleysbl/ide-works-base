import { describe, expect, it } from 'vitest';

import {
  NAME_MAX_LENGTH,
  NAME_REQUIRED,
  NAME_TOO_LONG,
  activationUrlWithName,
  checkInvitedName,
  normalizeName,
  suggestedName,
} from '@/auth/invited-name';

describe('normalizeName', () => {
  it('tira o espaço das pontas', () => {
    expect(normalizeName('  Wesley Barbosa  ')).toBe('Wesley Barbosa');
  });

  it('junta o espaço do meio — nome colado torto não vira nome torto', () => {
    expect(normalizeName('Ana   Maria\tSouza')).toBe('Ana Maria Souza');
  });

  it('só espaço é o mesmo que nada', () => {
    // Um espaço sozinho seria um nome de exibição INVISÍVEL: quem exibe acharia
    // que há nome e deixaria de mostrar o e-mail. Pior que vazio.
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('\n\t ')).toBe('');
  });

  it('o que não é texto é nada, e não explode', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(42)).toBe('');
    expect(normalizeName({ nome: 'x' })).toBe('');
  });

  it('acento e apóstrofo continuam inteiros', () => {
    expect(normalizeName("Maria D'Ávila Gonçalves")).toBe("Maria D'Ávila Gonçalves");
  });
});

describe('checkInvitedName — o convite EXIGE o nome', () => {
  it('aceita e devolve já limpo', () => {
    const r = checkInvitedName('  Wesley  Barbosa ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Wesley Barbosa');
  });

  it('recusa vazio, e a frase diz o que FAZER', () => {
    const r = checkInvitedName('');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe(NAME_REQUIRED);
      // "Escreva…" é instrução; "nome obrigatório" seria diagnóstico.
      expect(r.message).toMatch(/^Escreva /);
    }
  });

  it('recusa espaço em branco pelo mesmo motivo', () => {
    const r = checkInvitedName('    ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(NAME_REQUIRED);
  });

  it('recusa o que não é texto', () => {
    expect(checkInvitedName(undefined).ok).toBe(false);
    expect(checkInvitedName(null).ok).toBe(false);
    expect(checkInvitedName(123).ok).toBe(false);
  });

  it('aceita exatamente no teto e recusa um a mais', () => {
    expect(checkInvitedName('a'.repeat(NAME_MAX_LENGTH)).ok).toBe(true);
    const grande = checkInvitedName('a'.repeat(NAME_MAX_LENGTH + 1));
    expect(grande.ok).toBe(false);
    if (!grande.ok) expect(grande.message).toBe(NAME_TOO_LONG);
  });

  it('nenhuma das duas recusas nomeia banco nem campo de formulário', () => {
    for (const frase of [NAME_REQUIRED, NAME_TOO_LONG]) {
      expect(frase).not.toMatch(/full_name|invitations|profiles|null/i);
    }
  });
});

describe('suggestedName — a sugestão que chega pelo endereço', () => {
  it('limpa como o resto', () => {
    expect(suggestedName('  Ana  Maria ')).toBe('Ana Maria');
  });

  it('corta no teto em vez de recusar — quem clicou o link não escreveu nada', () => {
    expect(suggestedName('b'.repeat(500))).toHaveLength(NAME_MAX_LENGTH);
  });

  it('endereço sem o parâmetro é campo vazio, e não erro', () => {
    expect(suggestedName(null)).toBe('');
  });
});

describe('activationUrlWithName', () => {
  const base = 'https://ideworks.exemplo/ativar';

  it('põe o nome no endereço, escapado', () => {
    expect(activationUrlWithName(base, 'Wesley Barbosa')).toBe(
      'https://ideworks.exemplo/ativar?nome=Wesley%20Barbosa',
    );
  });

  it('e o que sai do endereço é o que entrou — a volta fecha', () => {
    const url = new URL(activationUrlWithName(base, "Maria D'Ávila"));
    expect(suggestedName(url.searchParams.get('nome'))).toBe("Maria D'Ávila");
  });

  it('sem nome, o endereço sai como veio — parâmetro vazio é ruído', () => {
    expect(activationUrlWithName(base, '')).toBe(base);
    expect(activationUrlWithName(base, '   ')).toBe(base);
    expect(activationUrlWithName(base, undefined)).toBe(base);
  });

  it('respeita endereço que já tem pergunta', () => {
    expect(activationUrlWithName(`${base}?x=1`, 'Ana')).toBe(
      'https://ideworks.exemplo/ativar?x=1&nome=Ana',
    );
  });

  it('não deixa o nome fabricar outro parâmetro', () => {
    const url = new URL(activationUrlWithName(base, 'Ana&admin=1'));
    expect(url.searchParams.get('admin')).toBeNull();
    expect(url.searchParams.get('nome')).toBe('Ana&admin=1');
  });
});
