/**
 * O INTERRUPTOR DO TEXTO DIRETO — conferência de 08/10.
 *
 * O ganho de idas (`db-literal.ts`, `withActor`) foi medido com o driver real
 * contra um servidor de fio de teste, não contra o Hyperdrive. Se em produção
 * algo estranhar, `IDEWORKS_SQL_TEXTO_DIRETO = "desligado"` no wrangler.toml (ou
 * no painel da Cloudflare) faz tudo voltar ao parâmetro de sempre, sem código.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { aceitaTextoDireto, definirTextoDireto, inlineUuid } from '@/server/db-literal';
import type { Sql } from '@/server/db';

const ID = '11111111-1111-4111-8111-111111111111';
const clienteReal = { unsafe: (texto: string) => ({ texto }) } as unknown as Sql;

describe('o interruptor do texto direto', () => {
  afterEach(() => definirTextoDireto('ligado'));

  it('ligado (o padrão): o cliente real aceita texto direto', () => {
    expect(aceitaTextoDireto(clienteReal)).toBe(true);
    expect(inlineUuid(clienteReal, ID)).toEqual({ texto: `'${ID}'` });
  });

  it('desligado: o mesmo cliente volta ao parâmetro de sempre', () => {
    definirTextoDireto('desligado');
    expect(aceitaTextoDireto(clienteReal)).toBe(false);
    expect(inlineUuid(clienteReal, ID)).toBe(ID);
  });

  it('"false" também desliga; ausente, "ligado" ou "true" ficam ligados', () => {
    definirTextoDireto('false');
    expect(aceitaTextoDireto(clienteReal)).toBe(false);
    for (const valor of [undefined, 'ligado', 'true']) {
      definirTextoDireto(valor);
      expect(aceitaTextoDireto(clienteReal)).toBe(true);
    }
  });
});
