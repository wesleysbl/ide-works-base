import { describe, expect, it } from 'vitest';

import { segundosAteVencer } from '@/server/session';

/** Um JWT com o `exp` dado. A assinatura não importa: aqui só se LÊ o prazo. */
const jwtCom = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.assinatura`;
};

describe('quanto o crachá ainda vale', () => {
  it('lê o exp do token e devolve os segundos que faltam', () => {
    expect(segundosAteVencer(jwtCom({ exp: 1_003_600 }), 1_000_000)).toBe(3600);
  });

  it('vencido volta zero, e não número negativo', () => {
    expect(segundosAteVencer(jwtCom({ exp: 900 }), 1000)).toBe(0);
  });

  it('o que não é token com exp numérico volta nulo — a tela cai no comportamento de antes', () => {
    expect(segundosAteVencer(null, 0)).toBeNull();
    expect(segundosAteVencer('', 0)).toBeNull();
    expect(segundosAteVencer('nao.e.jwt', 0)).toBeNull();
    expect(segundosAteVencer(jwtCom({ sub: 'x' }), 0)).toBeNull();
    expect(segundosAteVencer(jwtCom({ exp: '99' }), 0)).toBeNull();
  });
});
