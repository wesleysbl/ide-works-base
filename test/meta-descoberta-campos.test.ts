/**
 * Os campos que a descoberta pede à Meta.
 *
 * POR QUE ESTE TESTE EXISTE
 *   A Meta **não ignora** campo que o token não pode ler: ela recusa a
 *   requisição inteira, com erro 100. Um campo privilegiado a mais não custa
 *   aquele campo — custa a listagem toda.
 *
 *   Em 2026-08-20 a F7d acrescentou `business{id,name}` a `/me/adaccounts`,
 *   para saber de qual gerenciador cada conta era. Esse campo exige
 *   `business_management`, que o token não tem por decisão. A chamada passou a
 *   ser recusada, as 20 contas de anúncio viraram zero, a falha foi parar numa
 *   tarja verde de sucesso, e a área Meta ficou só com Instagram.
 *
 *   Nada quebrou: a tela carregou, o build passou, os testes passaram. O
 *   usuário é que percebeu, olhando.
 *
 * O QUE ELE PEGA
 *   Campo conhecidamente privilegiado escrito na lista de campos. Não substitui
 *   perguntar à API — substitui descobrir pela ausência.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const FONTE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'server',
  'meta-descoberta.ts',
);

/**
 * Campos que exigem permissão que este token não tem — medidos contra a API de
 * verdade em 2026-08-20, não copiados da documentação.
 *
 *   business{...}  → (#100) Requires business_management permission
 *   owner          → (#200) Requires business_management permission
 *
 * `business_name`, achatado, passa: é o nome do gerenciador sem o objeto. É por
 * isso que a área Meta agrupa por nome, e não por id.
 */
const PROIBIDOS = ['business{', 'owner', 'adspixels', 'assigned_users', 'business_users'];

describe('campos pedidos à Meta', () => {
  const fonte = readFileSync(FONTE, 'utf8');

  it('encontra o arquivo da descoberta', () => {
    // Sem isto, um caminho errado faria o teste passar sem ter olhado nada.
    expect(fonte).toContain('me/adaccounts');
  });

  it('nenhum campo privilegiado entra na lista de campos', () => {
    // Só a lista declarada — o texto dos comentários cita `business{id,name}`
    // ao explicar o incidente, e comentário não é requisição.
    const lista = fonte.match(/const CAMPOS_DA_CONTA = \[[^\]]*\]/s)?.[0] ?? '';
    expect(lista).not.toBe('');

    const achados = PROIBIDOS.filter((p) => lista.includes(p));
    expect(achados).toEqual([]);
  });

  it('a lista termina no conjunto mínimo, que é o que sempre passa', () => {
    // O último recuo tem de ser `id,name`: sem ele, um campo novo que passe a
    // exigir permissão volta a custar a listagem inteira.
    const lista = fonte.match(/const CAMPOS_DA_CONTA = \[([^\]]*)\]/s)?.[1] ?? '';
    const opcoes = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(opcoes.length).toBeGreaterThan(1);
    expect(opcoes.at(-1)).toBe('id,name');
  });

  it('o Instagram continua vindo pelas páginas', () => {
    // Não é detalhe de implementação: o Instagram profissional não se lista
    // sozinho, ele pende da página do Facebook. Se esta linha sumir, some com
    // ela a razão pela qual o vínculo IG↔página é obrigatório na arquitetura.
    expect(fonte).toContain('instagram_business_account');
  });
});
