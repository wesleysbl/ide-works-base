import { describe, expect, it } from 'vitest';

import {
  ALPHABET,
  CODE_LENGTH,
  INVITATION_TTL_HOURS,
  InvalidCode,
  expiresAt,
  formatCode,
  generateCode,
  hashCode,
  normalizeCode,
  verifyCode,
} from '@/auth/activation-code';

describe('alfabeto do código', () => {
  it('tem 32 símbolos — o que dá os 45 bits do documento', () => {
    expect(ALPHABET.length).toBe(32);
    expect(Math.log2(ALPHABET.length ** CODE_LENGTH)).toBe(45);
  });

  it.each(['I', 'L', 'O', 'U'])('não contém a letra ambígua %s', (letra) => {
    expect(ALPHABET).not.toContain(letra);
  });

  it('não repete símbolo', () => {
    expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
  });
});

describe('generateCode', () => {
  it('gera código do tamanho certo, só com símbolos do alfabeto', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const c of code) expect(ALPHABET).toContain(c);
    }
  });

  it('nunca produz as letras ambíguas', () => {
    const amostra = Array.from({ length: 500 }, generateCode).join('');
    expect(amostra).not.toMatch(/[ILOU]/);
  });

  it('não repete — 2000 códigos, 2000 valores distintos', () => {
    const codigos = new Set(Array.from({ length: 2000 }, generateCode));
    expect(codigos.size).toBe(2000);
  });

  it('usa os 32 símbolos, sem viés grosseiro', () => {
    const amostra = Array.from({ length: 2000 }, generateCode).join('');
    const vistos = new Set(amostra);
    expect(vistos.size).toBe(32);
  });
});

describe('normalizeCode — as trocas de leitura', () => {
  it.each([
    ['letra O no lugar do zero', 'OOO111222', '000111222'],
    ['letra I no lugar do um', 'III222333', '111222333'],
    ['letra L no lugar do um', 'LLL222333', '111222333'],
    ['letra U no lugar do V', 'UUU222333', 'VVV222333'],
  ])('corrige %s', (_nome, digitado, esperado) => {
    expect(normalizeCode(digitado)).toBe(esperado);
  });

  it('aceita minúscula', () => {
    expect(normalizeCode('abc123xyz')).toBe('ABC123XYZ');
  });

  it('ignora hífen e espaço — o formato de exibição não atrapalha', () => {
    expect(normalizeCode('ABC-123-XYZ')).toBe('ABC123XYZ');
    expect(normalizeCode(' ABC 123 XYZ ')).toBe('ABC123XYZ');
  });

  it.each([
    ['curto demais', 'ABC123'],
    ['longo demais', 'ABC123XYZ99'],
    ['vazio', ''],
  ])('recusa código %s', (_nome, entrada) => {
    expect(() => normalizeCode(entrada)).toThrow(InvalidCode);
  });
});

describe('formatCode', () => {
  it('mostra em três grupos de três', () => {
    expect(formatCode('ABC123XYZ')).toBe('ABC-123-XYZ');
  });

  it('formata mesmo o que veio digitado torto', () => {
    expect(formatCode('abc-123-xyz')).toBe('ABC-123-XYZ');
  });
});

describe('hashCode — o código nunca é guardado', () => {
  it('produz impressão digital de 64 caracteres hexadecimais', async () => {
    const hash = await hashCode(generateCode());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a impressão digital não contém o código', async () => {
    const code = 'ABC123XYZ';
    expect(await hashCode(code)).not.toContain(code.toLowerCase());
  });

  it('mesmo código, mesma impressão digital', async () => {
    expect(await hashCode('ABC123XYZ')).toBe(await hashCode('ABC123XYZ'));
  });

  it('a troca de leitura acontece ANTES do hash — senão o perdão não funcionaria', async () => {
    expect(await hashCode('OII222333')).toBe(await hashCode('011222333'));
  });

  it('códigos diferentes, impressões diferentes', async () => {
    expect(await hashCode('ABC123XYZ')).not.toBe(await hashCode('ABC123XYW'));
  });

  it('um único caractere diferente já muda a impressão inteira', async () => {
    const a = await hashCode('ABC123XYZ');
    const b = await hashCode('ABC123XY9');
    const iguais = [...a].filter((c, i) => c === b[i]).length;
    // Duas impressões sem relação coincidem em ~1/16 das posições. Bem longe de
    // "quase iguais" — que seria sinal de o hash estar vazando estrutura.
    expect(iguais).toBeLessThan(a.length / 2);
  });
});

describe('verifyCode', () => {
  it('aceita o código certo', async () => {
    const code = generateCode();
    expect(await verifyCode(code, await hashCode(code))).toBe(true);
  });

  it('aceita o código certo digitado com hífen e minúscula', async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(await verifyCode(formatCode(code).toLowerCase(), hash)).toBe(true);
  });

  it('aceita a letra ambígua no lugar do dígito', async () => {
    const hash = await hashCode('011222333');
    expect(await verifyCode('OII-222-333', hash)).toBe(true);
  });

  it('recusa código errado', async () => {
    expect(await verifyCode(generateCode(), await hashCode(generateCode()))).toBe(false);
  });

  it('recusa entrada malformada sem lançar — palpite ruim é só palpite errado', async () => {
    const hash = await hashCode(generateCode());
    await expect(verifyCode('nao-e-codigo', hash)).resolves.toBe(false);
    await expect(verifyCode('', hash)).resolves.toBe(false);
  });

  /**
   * A prova DETERMINÍSTICA de que não há saída antecipada.
   *
   * A versão anterior deste teste media o relógio e comparava as duas durações.
   * Ele falhava **1 vez em 8** quando a suíte inteira rodava junto — e teste que
   * falha às vezes ensina a ignorar falha, que é pior do que não ter teste.
   *
   * O que se quer garantir não é "as durações são parecidas": é que a
   * comparação **percorre todos os bytes sempre**. Isso dá para verificar sem
   * cronômetro, olhando o que o código faz.
   */
  it('a comparação não tem saída antecipada — verificado no código', async () => {
    const fonte = verifyCode.toString();

    // `===` ou `!==` entre as impressões digitais faria o motor parar no
    // primeiro byte diferente, que é exatamente o vazamento.
    expect(fonte).not.toMatch(/candidate\s*[!=]==\s*storedHash/);
    expect(fonte).not.toMatch(/storedHash\s*[!=]==\s*candidate/);

    // `break` ou `return` dentro do laço teriam o mesmo efeito.
    const laco = fonte.slice(fonte.indexOf('for ('));
    expect(laco).not.toMatch(/\bbreak\b/);
    expect(laco.slice(0, laco.indexOf('}'))).not.toMatch(/\breturn\b/);

    // O acumulador por ou-exclusivo é a marca da comparação em tempo constante.
    expect(fonte).toMatch(/\^/);
  });

  it('todo palpite do mesmo tamanho custa o mesmo número de comparações', async () => {
    // Corroboração pelo relógio, com estatística que resiste a soluço de
    // agendamento: as duas medições são INTERCALADAS, para sofrerem a mesma
    // carga, e o resultado é a MEDIANA de cinco rodadas — uma pausa do sistema
    // operacional distorce uma rodada, não a mediana de cinco.
    const code = generateCode();
    const hash = await hashCode(code);
    const quaseCerto = code.slice(0, 8) + (code[8] === '0' ? '1' : '0');
    const bemErrado = generateCode();

    const medir = async (palpite: string) => {
      const t = performance.now();
      for (let i = 0; i < 200; i++) await verifyCode(palpite, hash);
      return performance.now() - t;
    };

    await medir(quaseCerto); // aquece

    const razoes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const a = await medir(quaseCerto);
      const b = await medir(bemErrado);
      razoes.push(Math.max(a, b) / Math.min(a, b));
    }
    const mediana = razoes.sort((x, y) => x - y)[2];

    // Margem folgada: o alvo é saída antecipada, que produz diferença de ordem
    // de grandeza. Não é medir ruído de máquina compartilhada.
    expect(mediana).toBeLessThan(4);
  });
});

describe('expiresAt', () => {
  it('expira em 72 horas, como o documento diz', () => {
    const agora = new Date('2026-08-19T12:00:00Z');
    expect(expiresAt(agora).toISOString()).toBe('2026-08-22T12:00:00.000Z');
    expect(INVITATION_TTL_HOURS).toBe(72);
  });
});
