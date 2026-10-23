/**
 * A SESSÃO QUE ATRAVESSA O EXPEDIENTE — etapa F17.62.
 *
 * O DEFEITO QUE ESTES TESTES GUARDAM
 *   O crachá do provedor vive UMA HORA — medido, `exp - iat` de um crachá real
 *   deste projeto dá 3.600 segundos. O cookie dizia oito, e a diferença era o
 *   que a equipe chamou de *"deslogando da tela fácil"*: a partir da primeira
 *   hora o navegador mandava um crachá morto e o provedor recusava.
 *
 * O QUE MORA AQUI, E O QUE NÃO
 *   Aqui ficam as PEÇAS PURAS: como o cookie é escrito e como ele é lido de
 *   volta. Que a tela sobreviva à virada da hora é frase sobre navegador, e é
 *   `scripts/provar-a-sessao-que-dura.mjs` quem a prova, com Chrome de verdade.
 */

import { describe, expect, it } from 'vitest';

import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  TETO_DA_SESSAO_EM_SEGUNDOS,
  refreshCookieHeader,
  refreshFromCookie,
  sessionCookieHeader,
} from '@/server/session';

const comCookie = (valor: string) => new Request('https://x/', { headers: { Cookie: valor } });

describe('as defesas dos dois cookies', () => {
  it('os dois cookies são inacessíveis ao script, só por canal seguro e não viajam de outro site', () => {
    for (const cabecalho of [
      sessionCookieHeader('abc', 60),
      refreshCookieHeader('def', 1_800_000_000, 60),
    ]) {
      expect(cabecalho).toContain('HttpOnly');
      expect(cabecalho).toContain('Secure');
      expect(cabecalho).toContain('SameSite=Strict');
      expect(cabecalho).toContain('Path=/');
    }
  });

  it('apagar é Max-Age zero, e vale para os dois', () => {
    expect(sessionCookieHeader('', 0)).toContain(`${SESSION_COOKIE}=;`);
    expect(sessionCookieHeader('', 0)).toContain('Max-Age=0');
    expect(refreshCookieHeader('', 0, 0)).toContain(`${REFRESH_COOKIE}=;`);
    expect(refreshCookieHeader('', 0, 0)).toContain('Max-Age=0');
  });

  it('o cookie da renovação leva o crachá E o instante-limite', () => {
    expect(refreshCookieHeader('umcracha', 1_800_000_000, 43_200)).toContain(
      `${REFRESH_COOKIE}=umcracha~1800000000;`,
    );
  });
});

describe('o que se lê de volta do cookie da renovação', () => {
  it('devolve o crachá e o limite', () => {
    const lido = refreshFromCookie(comCookie(`${REFRESH_COOKIE}=abc123~1800000000`));
    expect(lido).toEqual({ refreshToken: 'abc123', limiteEmSegundos: 1_800_000_000 });
  });

  it('o crachá do provedor pode ter til no meio — o corte é no ÚLTIMO', () => {
    const lido = refreshFromCookie(comCookie(`${REFRESH_COOKIE}=a~b~c~1800000000`));
    expect(lido).toEqual({ refreshToken: 'a~b~c', limiteEmSegundos: 1_800_000_000 });
  });

  it('não confunde com o cookie da sessão, que viaja ao lado', () => {
    const lido = refreshFromCookie(
      comCookie(`${SESSION_COOKIE}=jwt.aqui; ${REFRESH_COOKIE}=r1~1800000000`),
    );
    expect(lido?.refreshToken).toBe('r1');
  });

  it('cookie ausente, meio escrito ou com limite que não é número não serve', () => {
    // Tratar o que falta como zero daria uma sessão vencida em 1970 — recusa
    // confusa no lugar de uma clara.
    expect(refreshFromCookie(new Request('https://x/'))).toBeNull();
    expect(refreshFromCookie(comCookie(`${REFRESH_COOKIE}=semlimite`))).toBeNull();
    expect(refreshFromCookie(comCookie(`${REFRESH_COOKIE}=~1800000000`))).toBeNull();
    expect(refreshFromCookie(comCookie(`${REFRESH_COOKIE}=abc~depois`))).toBeNull();
    expect(refreshFromCookie(comCookie(`${REFRESH_COOKIE}=abc~-5`))).toBeNull();
  });
});

describe('o teto da sessão', () => {
  it('é de doze horas — um dia de trabalho, e uma senha por dia', () => {
    expect(TETO_DA_SESSAO_EM_SEGUNDOS).toBe(60 * 60 * 12);
  });

  it('é maior que a hora que o crachá do provedor vive, senão não haveria o que renovar', () => {
    expect(TETO_DA_SESSAO_EM_SEGUNDOS).toBeGreaterThan(3600);
  });
});
