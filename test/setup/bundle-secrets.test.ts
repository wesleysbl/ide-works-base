import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Trava contra segredo no pacote do navegador — etapa F0.3/F0.4.
 *
 * POR QUE ISTO EXISTE
 *   O empacotador DISPONIBILIZA ao codigo do navegador toda variavel que casa
 *   com `envPrefix`. Se alguem trocar 'IDEWORKS_PUBLIC_' por 'IDEWORKS_', a
 *   senha do banco passa a estar ao alcance de qualquer linha do front.
 *
 * O QUE ESTE TESTE PROVA, E O QUE ELE NAO PROVA — medido em 2026-08-19
 *   Afrouxamos o prefixo de proposito e rodamos: o caso da CONFIGURACAO pegou;
 *   o de CONTEUDO nao. Motivo: o empacotador so embute no pacote a variavel que
 *   o codigo referencia de fato, e nenhuma linha referencia a senha.
 *
 *   Logo: a trava que carrega o peso e a do prefixo. A varredura de conteudo e
 *   rede de baixo — ela so dispara se alguem escrever algo como
 *   `console.log(import.meta.env)`, que arrasta o objeto inteiro para dentro do
 *   pacote.
 *
 *   Fica escrito porque cobertura que se acredita ter, e nao se tem, e pior do
 *   que cobertura nenhuma.
 */

const RAIZ = join(import.meta.dirname, '..', '..');

/**
 * Constrói numa pasta própria, e não em `dist`.
 *
 * A versão anterior apagava e reconstruía `dist` — e passou a falhar com
 * "permissão negada" no dia em que o servidor de desenvolvimento ficou de pé,
 * porque ele segura a pasta. Um teste que só passa com o app desligado é um
 * teste que alguém vai acabar ignorando.
 */
const DIST = join(RAIZ, 'node_modules', '.tmp', 'dist-teste');

function arquivosDoPacote(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? arquivosDoPacote(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('segredo no pacote do navegador', () => {
  let conteudo = '';

  beforeAll(() => {
    rmSync(DIST, { recursive: true, force: true });
    // Chama o empacotador pelo proprio Node, sem shell e sem `.cmd`:
    //  - com `shell: true` os argumentos vao concatenados e nao escapados;
    //  - sem shell, o Node no Windows recusa executar `.cmd` (EINVAL), por
    //    causa de uma correcao de seguranca.
    // Executar o binario JS direto resolve os dois, e e igual nos tres sistemas.
    const vite = join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js');
    execFileSync(process.execPath, [vite, 'build', '--outDir', DIST, '--emptyOutDir'], {
      cwd: RAIZ,
      stdio: 'pipe',
    });
    conteudo = arquivosDoPacote(DIST)
      .filter((f) => /\.(js|css|html|map)$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
  }, 180_000);

  it('a senha do banco nao aparece no pacote', () => {
    const senha = process.env.IDEWORKS_SERVER_DB_PASSWORD;
    if (senha && senha.length > 8) expect(conteudo).not.toContain(senha);
    // Mesmo sem a variavel carregada, o nome dela nunca pode aparecer:
    expect(conteudo).not.toContain('IDEWORKS_SERVER_DB_PASSWORD');
  });

  it('nenhuma variavel de servidor aparece no pacote', () => {
    expect(conteudo).not.toMatch(/IDEWORKS_SERVER_/);
  });

  it('o empacotador esta configurado com o prefixo restrito', () => {
    const config = readFileSync(join(RAIZ, 'vite.config.ts'), 'utf8');
    expect(config).toContain("envPrefix: 'IDEWORKS_PUBLIC_'");
  });
});
