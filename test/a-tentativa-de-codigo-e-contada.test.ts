/**
 * A TENTATIVA DE CÓDIGO É CONTADA — etapa F17.53, achado A3 da auditoria.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE TESTE EXISTE
 *   `POST /auth/activate` e `POST /auth/reset-password` são as duas portas que
 *   recebem código digitado. As duas PERGUNTAVAM ao limitador — `countAttempts`
 *   com a intenção `activation` — e nenhuma das duas ESCREVIA. `recordAttempt`
 *   era chamado num lugar só no projeto inteiro, `src/auth/login.ts:85`, e
 *   sempre com `'login'`.
 *
 *   O resultado ficou treze dias no banco sem ninguém ver: 498 linhas em
 *   `ideworks.auth_attempts`, 100% `login`, ZERO `activation`. A contagem lia 0
 *   e devolvia falso sempre. Um limitador que nunca contou parece, de fora,
 *   idêntico a um limitador que ninguém estourou — e é por isso que a falta
 *   sobrevive a revisão de código.
 *
 *   O comportamento contra o banco é medido por
 *   `scripts/provar-o-teto-do-codigo.mjs`. O que este teste guarda é o
 *   CABEAMENTO: que as duas rotas continuem entregando a origem às portas, e
 *   que as portas continuem escrevendo. Sem isto, a decisão certa fica ligada
 *   em lugar nenhum, que é exatamente o estado de que se veio.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ELE **NÃO** COBRE
 *   Que a linha realmente chegue à tabela — isso é banco, e é da prova. Aqui é
 *   texto de código: a rede que impede a regressão de voltar por um `git
 *   revert` distraído.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LIMITS } from '@/auth/rate-limit';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = readFileSync(join(RAIZ, 'worker', 'index.ts'), 'utf8');
const portas = readFileSync(join(RAIZ, 'src', 'server', 'ports.ts'), 'utf8');

describe('o Worker entrega a origem às duas portas de código', () => {
  it('a ativação recebe `clientIp(request)`', () => {
    expect(worker).toMatch(/activationPorts\(sql, provider, log, clientIp\(request\)\)/);
  });

  it('a redefinição recebe `clientIp(request)`', () => {
    expect(worker).toMatch(/resetRedeemPorts\(sql, log, clientIp\(request\)\)/);
  });

  it('é o MESMO `clientIp` que o login já usava — não uma segunda ideia de origem', () => {
    expect(worker).toMatch(/ip: clientIp\(request\)/);
  });
});

describe('as duas portas escrevem, e sob a mesma intenção', () => {
  it('a ativação registra a tentativa', () => {
    expect(portas).toMatch(/await recordAttempt\('activation', \{ email, ip \}, limits\)/);
  });

  it('as duas registram sob `activation` — é o que torna o teto UM SÓ', () => {
    // Duas ocorrências: uma em `activationPorts`, outra em `resetRedeemPorts`.
    // Se um dia alguém inventar uma intenção própria para a redefinição, o teto
    // vira o dobro de chutes por endereço, que é a nota escrita no cabeçalho de
    // `resetRedeemPorts`.
    const escritas = portas.match(/recordAttempt\('activation'/g) ?? [];
    expect(escritas).toHaveLength(2);
  });

  it('as duas CONSULTAM sob `activation`, pelo mesmo motivo', () => {
    const leituras = portas.match(/checkRateLimit\('activation'/g) ?? [];
    expect(leituras).toHaveLength(2);
  });

  it('nenhuma das duas escreve o número do teto à mão — ele vem de LIMITS', () => {
    // A versão anterior tinha `>= 10` e `15 * 60_000` escritos dentro de
    // `isRateLimited`, e por isso o teto por ORIGEM de `LIMITS.activation` —
    // 20 em 15 minutos — estava declarado e nunca era consultado.
    const trecho = portas.slice(portas.indexOf('export function activationPorts'));
    expect(trecho).not.toMatch(/countAttempts\('activation', 'email'/);
    expect(LIMITS.activation.ip.max).toBe(20);
    expect(LIMITS.activation.email.max).toBe(10);
  });

  it('o teto do login não foi mexido', () => {
    expect(LIMITS.login.email).toEqual({ max: 5, windowMinutes: 15 });
    expect(LIMITS.login.ip).toEqual({ max: 10, windowMinutes: 15 });
  });
});

/**
 * A10 — a intenção no `where` do contador do convite.
 *
 * `POST /auth/activate` incrementava `failed_attempts` sem filtrar `purpose`:
 * um código errado digitado na ativação queimava também o contador de um código
 * de REDEFINIÇÃO pendente do mesmo endereço, e aos dez erros o revogava. A rota
 * de redefinição sempre filtrou; esta não.
 */
describe('errar na ativação não queima o código de senha de ninguém — A10', () => {
  it('a ativação só conta contra convite que ATIVA', () => {
    expect(worker).toMatch(/and purpose in \('invite', 'invite_with_password'\)/);
  });

  it('e a redefinição continua contando só contra código de senha', () => {
    expect(worker).toMatch(/and purpose = 'reset'/);
  });

  it('as duas listas são disjuntas — nenhuma porta alcança o contador da outra', () => {
    const daAtivacao = ["'invite'", "'invite_with_password'"];
    const daRedefinicao = ["'reset'"];
    expect(daAtivacao.filter((p) => daRedefinicao.includes(p))).toEqual([]);
  });
});
