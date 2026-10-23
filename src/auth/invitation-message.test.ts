import { describe, expect, it } from 'vitest';

import {
  CODE_SHOWN_ONCE_WARNING,
  buildInvitationMessage,
  buildResetMessage,
} from '@/auth/invitation-message';

const agora = new Date('2026-08-19T12:00:00Z');
const base = {
  email: 'fulano@exemplo.com.br',
  code: 'ABC123XYZ',
  activationUrl: 'https://ideworks.exemplo/ativar',
  expiresAt: new Date('2026-08-22T12:00:00Z'),
};

describe('buildInvitationMessage', () => {
  const texto = buildInvitationMessage(base, agora);

  it('traz o endereço de ativação', () => {
    expect(texto).toContain('https://ideworks.exemplo/ativar');
  });

  it('traz o e-mail da pessoa', () => {
    expect(texto).toContain('fulano@exemplo.com.br');
  });

  it('traz o código formatado, como ela vai ler e digitar', () => {
    expect(texto).toContain('ABC-123-XYZ');
  });

  it('traz o prazo em horas, que é acionável', () => {
    expect(texto).toContain('72 horas');
  });

  it('avisa quando o convite já expirou, em vez de dizer "0 horas"', () => {
    const vencido = buildInvitationMessage(base, new Date('2026-08-23T12:00:00Z'));
    expect(vencido).toContain('já expirou');
    expect(vencido).toContain('gere outro');
  });

  it('é só texto: nada aqui envia coisa alguma', () => {
    expect(typeof texto).toBe('string');
  });

  it('não vaza a impressão digital do código', () => {
    expect(texto).not.toMatch(/[0-9a-f]{64}/);
  });

  it('arredonda o prazo para baixo — nunca promete mais tempo do que há', () => {
    const quase = buildInvitationMessage(base, new Date('2026-08-19T12:59:00Z'));
    expect(quase).toContain('71 horas');
  });

  /* --- o nome sugerido viaja no endereço — F17.29 --- */

  it('leva o nome dentro do endereço, para a ativação já mostrá-lo preenchido', () => {
    const com = buildInvitationMessage({ ...base, name: 'Wesley Barbosa' }, agora);
    expect(com).toContain('https://ideworks.exemplo/ativar?nome=Wesley%20Barbosa');
  });

  it('sem nome, o endereço sai exatamente como antes', () => {
    expect(texto).toContain('1. Acesse: https://ideworks.exemplo/ativar\n');
  });
});

describe('aviso de código mostrado uma vez só', () => {
  it('diz que não será mostrado de novo', () => {
    expect(CODE_SHOWN_ONCE_WARNING).toContain('não será mostrado de novo');
  });

  it('explica o motivo — não fica guardado em lugar nenhum', () => {
    expect(CODE_SHOWN_ONCE_WARNING).toContain('não fica guardado');
  });
});

/* ───────────────────── o código de senha (F17.31) ────────────────────────── */

describe('buildResetMessage', () => {
  const reset = {
    email: 'fulano@exemplo.com.br',
    code: 'ABC123XYZ',
    resetUrl: 'https://ideworks.exemplo/redefinir',
    expiresAt: new Date('2026-08-22T12:00:00Z'),
  };
  const texto = buildResetMessage(reset, agora);

  it('manda para a tela da senha, e NÃO para a de ativar', () => {
    // Quem recebe este código já tem conta. A tela de ativação recusa este
    // código de propósito — mandá-lo para lá o faria bater numa porta fechada.
    expect(texto).toContain('https://ideworks.exemplo/redefinir');
    expect(texto).not.toContain('/ativar');
    expect(texto).not.toMatch(/ativar|ativa[çc][ãa]o/i);
  });

  it('não promete acesso novo a quem já entrava', () => {
    expect(texto).not.toMatch(/acesso.*criado|conta.*criada/i);
  });

  it('mostra o código legível, com hífen', () => {
    expect(texto).toContain('ABC-123-XYZ');
  });

  it('diz o prazo em horas e que serve uma vez só', () => {
    expect(texto).toContain('72 horas');
    expect(texto).toMatch(/uma vez s[óo]/i);
  });

  it('avisa que expirou quando já passou do prazo', () => {
    const vencido = buildResetMessage(reset, new Date('2026-08-23T12:00:00Z'));
    expect(vencido).toMatch(/expirou/i);
  });

  it('deixa claro que quem gerou não saberá a senha', () => {
    expect(texto).toMatch(/ningu[ée]m aqui vai saber/i);
  });

  it('não carrega a senha de ninguém, porque não existe senha neste caminho', () => {
    expect(texto).not.toMatch(/senha[:=]\s*\S/i);
  });
});
