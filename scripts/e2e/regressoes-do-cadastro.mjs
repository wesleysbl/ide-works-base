/**
 * `docs/auditoria-2026-09-09/reproduzir-cadastro.mjs`, INVERTIDO — F17.AUD08.
 *
 * O original afirma os achados 7 (abrir o cadastro sobrescreve o rascunho
 * pendente) e 8 (a data inicial usa o dia UTC). Ele usava a API antiga do
 * rascunho (`chaveDaFicha(null)`, `guardarRascunho(chave, v)`) e um
 * `/auth/me` sem `userId`. Aqui o rascunho é o v2 da AUD02 — com dono, tipo
 * e id — e a sessão fictícia tem `userId`, como a AUD02 anotou que seria
 * preciso. Os percursos passam pela tela real (`/painel` → `Novo cliente`),
 * não por um componente montado à parte.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, pause } from './comum.mjs';

const RASCUNHO = { usuario: 'u-ana', tipo: 'cliente', id: null };

/** Guarda um rascunho de cliente novo pelo módulo real, com o dono já confirmado pela tela. */
async function plantarRascunho(page, nome) {
  await page.evaluate(
    async ({ ficha, nome }) => {
      const m = await import('/src/ui/rascunho.ts');
      const { ENTRADA_VAZIA } = await import('/src/clients/formulario.ts');
      if (m.donoConfirmado() !== ficha.usuario) throw new Error('dono não confirmado: ' + m.donoConfirmado());
      m.guardarRascunho(ficha, { ...ENTRADA_VAZIA, name: nome });
    },
    { ficha: RASCUNHO, nome },
  );
}

const lerRascunho = (page) =>
  page.evaluate(async (ficha) => {
    const m = await import('/src/ui/rascunho.ts');
    return m.lerRascunho(ficha);
  }, RASCUNHO);

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('M3', 'achado 7 — reabrir Novo cliente NÃO sobrescreve o rascunho pendente; fechar sem decidir o mantém', async (abrir) => {
    const { page } = await abrir({ timezoneId: 'America/Sao_Paulo' });
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).waitFor();
    await page.waitForLoadState('networkidle');
    await plantarRascunho(page, 'Cadastro ainda não salvo');

    // Primeira abertura: a oferta aparece; 800 ms depois o rascunho continua inteiro.
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).waitFor();
    await page.waitForTimeout(800);
    let guardado = await lerRascunho(page);
    // Antes: `valor.name === ''` — o formulário vazio tinha passado por cima.
    assert.equal(guardado?.valor?.name, 'Cadastro ainda não salvo', 'o rascunho pendente não foi sobrescrito');
    assert.equal(await page.getByLabel('Nome do cliente *').inputValue(), '', 'o rascunho não foi aplicado sozinho');

    // Fecha sem decidir, espera de novo, reabre: a oferta continua e é a mesma.
    await page.getByRole('dialog', { name: 'Novo cliente' }).getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo cliente' }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(800);
    guardado = await lerRascunho(page);
    assert.equal(guardado?.valor?.name, 'Cadastro ainda não salvo', 'fechar sem decidir não grava o vazio');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).click();
    assert.equal(await page.getByLabel('Nome do cliente *').inputValue(), 'Cadastro ainda não salvo', 'Recuperar aplica o conteúdo certo');
    return 'rascunho intacto após 800 ms, após fechar sem decidir e após reabrir; Recuperar aplica';
  });

  await cenario('M3-descartar', 'achado 7 — Descartar apaga o rascunho e ele não volta na próxima abertura', async (abrir) => {
    const { page } = await abrir();
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).waitFor();
    await page.waitForLoadState('networkidle');
    await plantarRascunho(page, 'Para descartar');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForTimeout(700);
    assert.equal(await lerRascunho(page), null, 'descartado some do cofre');
    await page.getByRole('dialog', { name: 'Novo cliente' }).getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Novo cliente' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await page.getByLabel('Nome do cliente *').waitFor();
    await page.waitForTimeout(600);
    assert.equal(await page.getByRole('button', { name: 'Recuperar rascunho', exact: true }).count(), 0);
    return 'Descartar remove; a reabertura não oferece nada';
  });

  await cenario('B2', 'achado 8 — às 22h de 09/09 em São Paulo, Novo cliente sugere 09/09 (não o dia UTC)', async (abrir) => {
    const { page } = await abrir({ timezoneId: 'America/Sao_Paulo' });
    await page.clock.setFixedTime(new Date('2026-09-10T01:00:00Z')); // 22h de 09/09 em SP
    await page.goto(BASE + '/painel');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    const campo = page.getByLabel('Data de início *');
    await campo.waitFor();
    await pause(400);
    const relogio = await page.evaluate(() => ({ utc: new Date().toISOString().slice(0, 10), local: new Date().toLocaleDateString('sv-SE') }));
    assert.equal(relogio.local, '2026-09-09');
    assert.equal(relogio.utc, '2026-09-10', 'o dia UTC já virou');
    // Antes: `2026-09-10`.
    assert.equal(await campo.inputValue(), '2026-09-09');
    return `UTC ${relogio.utc}, local ${relogio.local}; Data de início = 2026-09-09`;
  });

  await cenario('F11A-cadastro', 'abrir e fechar Novo cliente num recorte do painel não perde o recorte', async (abrir) => {
    const { page } = await abrir();
    const recorte = '?urgencia=perigo&ordem=nome&sentido=desc';
    await page.goto(BASE + '/painel' + recorte);
    await page.getByRole('button', { name: 'Novo cliente' }).waitFor();
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Novo cliente' }).click();
    const ficha = page.getByRole('dialog', { name: 'Novo cliente' });
    await ficha.waitFor();
    await ficha.getByRole('button', { name: 'Fechar', exact: true }).click();
    await ficha.waitFor({ state: 'hidden' });
    assert.equal(new URL(page.url()).search, recorte, 'a ficha não mexe no endereço do painel');
    assert.equal(await page.locator('#pn-ordem').inputValue(), 'nome');
    return `recorte intacto: ${recorte}`;
  });

  return resultados;
}
