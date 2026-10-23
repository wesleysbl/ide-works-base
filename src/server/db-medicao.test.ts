import { describe, expect, it } from 'vitest';

import {
  CABECALHO_DE_MEDICAO,
  cabecalhoDeMedicao,
  medirBancoDaRequisicao,
  registrarAberturaDeConexao,
} from '@/server/db-medicao';
import { connect } from '@/server/db';

/** Ambiente de Worker de mentira: o Hyperdrive não é aberto até haver consulta. */
const env = {
  IDEWORKS_PUBLIC_SUPABASE_URL: 'https://exemplo.supabase.co',
  HYPERDRIVE: { connectionString: 'postgres://u:s@127.0.0.1:5432/d' },
};

describe('medição de conexões por requisição', () => {
  it('conta cada abertura e cada fechamento', async () => {
    const { medicao } = await medirBancoDaRequisicao(async () => {
      const a = registrarAberturaDeConexao('concessoes');
      const b = registrarAberturaDeConexao('freio');
      a();
      b();
      registrarAberturaDeConexao('trabalho');
    });

    expect(medicao.aberturas).toBe(3);
    expect(medicao.fechamentos).toBe(2);
    expect(medicao.conexoes.map((c) => c.rotulo)).toEqual(['concessoes', 'freio', 'trabalho']);
    // A que não fechou continua contada: esconder conexão vazada falsearia o número.
    expect(medicao.conexoes[2].fechada).toBe(false);
  });

  it('a contagem bate com o número de clientes abertos por connect()', async () => {
    const { medicao } = await medirBancoDaRequisicao(async () => {
      const um = connect(env, 'concessoes');
      const dois = connect(env, 'freio');
      await um.end({ timeout: 1 });
      await dois.end({ timeout: 1 });
    });

    expect(medicao.aberturas).toBe(2);
    expect(medicao.fechamentos).toBe(2);
    expect(medicao.conexoes.map((c) => c.rotulo)).toEqual(['concessoes', 'freio']);
  });

  it('não conta conexão de outra requisição', async () => {
    const [primeira, segunda] = await Promise.all([
      medirBancoDaRequisicao(async () => {
        registrarAberturaDeConexao('a')();
        await new Promise((resolve) => setTimeout(resolve, 5));
        registrarAberturaDeConexao('a')();
      }),
      medirBancoDaRequisicao(async () => {
        registrarAberturaDeConexao('b')();
      }),
    ]);

    expect(primeira.medicao.aberturas).toBe(2);
    expect(segunda.medicao.aberturas).toBe(1);
  });

  it('fora de uma medição, registrar não lança e não guarda nada', () => {
    expect(() => registrarAberturaDeConexao('solta')()).not.toThrow();
  });

  it('o erro do trabalho sobe intacto', async () => {
    await expect(
      medirBancoDaRequisicao(async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
  });

  it('o cabeçalho traz contagem e tempos, e nada mais', async () => {
    const { medicao } = await medirBancoDaRequisicao(async () => {
      registrarAberturaDeConexao('concessoes')();
    });
    const valor = cabecalhoDeMedicao(medicao);

    expect(CABECALHO_DE_MEDICAO).toBe('x-ideworks-db');
    expect(valor).toMatch(/^conns=1; closed=1; db=\d+ms; req=\d+ms; parts=concessoes:\d+$/);
    // Gramática de cabeçalho HTTP: nada de quebra de linha nem caractere de controle.
    // Gramática de cabeçalho: nenhum caractere de controle atravessa.
    expect([...valor].every((c) => c.charCodeAt(0) >= 0x20)).toBe(true);
  });

  it('rótulo estranho é higienizado antes de virar cabeçalho', async () => {
    const { medicao } = await medirBancoDaRequisicao(async () => {
      registrarAberturaDeConexao('mau\r\nrotulo: x')();
    });
    expect(cabecalhoDeMedicao(medicao)).toContain('parts=maurotulox:');
    expect(cabecalhoDeMedicao(medicao)).not.toMatch(/[\r\n]/);
  });
});
