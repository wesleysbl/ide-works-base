import { describe, expect, it } from 'vitest';

import { NOME_DO_SISTEMA, tituloDoDocumento } from '@/ui/titulo-do-documento';

describe('tituloDoDocumento', () => {
  it('diz a tela e, depois, o sistema', () => {
    expect(tituloDoDocumento('Painel')).toBe('Painel · IDE Works');
    expect(tituloDoDocumento('Controle da semana')).toBe('Controle da semana · IDE Works');
  });

  it('a entrada (cujo título é a própria marca) fica só com o nome do sistema', () => {
    expect(tituloDoDocumento('IDE Works')).toBe(NOME_DO_SISTEMA);
  });

  it('sem nome — a tela ainda não chegou — volta ao nome do sistema, e não a " · IDE Works"', () => {
    expect(tituloDoDocumento('')).toBe(NOME_DO_SISTEMA);
    expect(tituloDoDocumento('   ')).toBe(NOME_DO_SISTEMA);
    expect(tituloDoDocumento(null)).toBe(NOME_DO_SISTEMA);
    expect(tituloDoDocumento(undefined)).toBe(NOME_DO_SISTEMA);
  });

  it('colapsa quebra de linha e espaço repetido de um nome que veio de dado (cliente, lista, tarefa)', () => {
    expect(tituloDoDocumento('  Peça   01\n— FOCUS ')).toBe('Peça 01 — FOCUS · IDE Works');
  });
});
