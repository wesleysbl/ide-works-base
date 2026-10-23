/**
 * A ADMINISTRAÇÃO NO NAVEGADOR — F13 do plano UX (Pessoas, Convidar, Catálogos).
 *
 * A API é INTERCEPTADA (ver `comum.mjs`): nada toca o banco, e os dados são
 * fictícios — nomes inventados, e-mails em `example.invalid`, códigos que não
 * valem em lugar nenhum. As respostas têm a FORMA REAL das rotas
 * (`/admin/people`, `/admin/queue`, `/catalogs/manage`…): a prévia da F01
 * quebrou em `Pessoas` justamente por uma resposta sem `pessoas`.
 *
 *   P1  lista: resumo, alcance de cada pessoa, "só um super admin", e a própria
 *       linha sem Ativa/apagar (a última administradora não se tranca fora).
 *   P2  busca sem resultado é "filtro", com Limpar — não "ninguém cadastrado".
 *   P3  sem a área Pessoas (403): estado sem acesso, sem Convidar e sem ações.
 *   P4  autorização parcial (administrador): o super admin não se mexe, sem
 *       lixeira, sem "Super admin" no menu, a própria unidade travada.
 *   P5  falha e repetição: a recusa aparece, a repetição dá certo e é dita; o
 *       duplo clique numa chave manda UM pedido.
 *   P6  unidades: a recusa fica na janela; repetir salva, fecha e o foco volta
 *       ao botão da linha.
 *   P7  código de senha: aparece uma vez, não vai para o cofre do navegador, e
 *       o Esc devolve o foco a "Redefinir".
 *   P8  código em aberto: Cancelar manda o DELETE e diz o resultado.
 *   P9  códigos em aberto: "vale até" e "convidado em" são o dia de SÃO PAULO,
 *       e não o dia UTC do instante.
 *   C1  convite: nome vazio é recusado junto do campo; Enter duas vezes cria um
 *       código só; o resultado recebe o foco.
 *   C2  convite: a recusa do servidor sobre o e-mail fica embaixo do e-mail.
 *   K1  fundir etiquetas: escolher não funde; o botão que diz o destino funde.
 *   K2  apagar plano: recusar a confirmação não apaga; aceitar apaga.
 *   K3  salvar catálogo com recusa: o formulário fica aberto com a frase.
 *   L1  320 e 390 px: as quatro telas e as janelas cabem, sem rolagem lateral.
 */

import assert from 'node:assert/strict';

import { BASE, criarSuite, sessaoDe } from './comum.mjs';

/* ─────────────────────────── os dados fictícios ─────────────────────────── */

const TODAS = ['entrega', 'quadro', 'meta', 'catalogos', 'pessoas'];

export const pessoa = (id, nome, extra = {}) => ({
  id,
  email: `${id.replace('u-', '')}@example.invalid`,
  nome,
  papel: 'funcionario',
  isSuperadmin: false,
  isActive: true,
  todosOsClientes: false,
  areas: ['entrega', 'quadro'],
  clientes: 0,
  empresas: 1,
  criadaEm: '2026-08-01T12:00:00.000Z',
  ...extra,
});

export const PESSOAS = () => [
  pessoa('u-ana', 'Ana Ribeiro', { papel: 'super_admin', isSuperadmin: true, todosOsClientes: true, areas: TODAS }),
  pessoa('u-bia', 'Beatriz Nogueira', { papel: 'admin', isSuperadmin: true, areas: ['entrega', 'quadro', 'pessoas', 'catalogos'] }),
  pessoa('u-caio', 'Caio Martins', { empresas: 0, clientes: 3 }),
  pessoa('u-duda', 'Eduarda Lima', { areas: [] }),
  pessoa('u-enzo', 'Enzo Prado', { isActive: false }),
  pessoa('u-fe', 'Fernanda Assis de Souza Albuquerque', { areas: ['quadro'], empresas: 0, clientes: 0 }),
];

export const CONVITES = () => [
  { id: 'q-1', email: 'gabi@example.invalid', expiraEm: '2026-10-02T12:00:00.000Z', tentativasFalhas: 0, criadoEm: '2026-09-29T12:00:00.000Z', vencido: false, intencao: 'invite' },
  { id: 'q-2', email: 'heitor@example.invalid', expiraEm: '2026-09-20T12:00:00.000Z', tentativasFalhas: 2, criadoEm: '2026-09-17T12:00:00.000Z', vencido: true, intencao: 'invite' },
  { id: 'q-3', email: 'caio@example.invalid', expiraEm: '2026-10-01T12:00:00.000Z', tentativasFalhas: 0, criadoEm: '2026-09-28T12:00:00.000Z', vencido: false, intencao: 'reset' },
];

export const EMPRESAS = [
  { id: '00000000-0000-4000-8000-00000000000a', nome: 'Ide' },
  { id: '00000000-0000-4000-8000-00000000000b', nome: 'Ide Hub' },
];

export const CATALOGOS = () => ({
  ok: true,
  plans: [
    { id: 'pl-1', name: 'Básico', colorBg: '#1f2a22', colorText: '#d9f2df', colorBorder: '#3c6b48', sortOrder: 0, isActive: true, clientCount: 7 },
    { id: 'pl-2', name: 'Intermediário', colorBg: '#1d2433', colorText: '#dbe6ff', colorBorder: '#3d5a99', sortOrder: 1, isActive: true, clientCount: 12 },
    { id: 'pl-3', name: 'Full', colorBg: '#2d2216', colorText: '#ffe8c7', colorBorder: '#a8743a', sortOrder: 2, isActive: true, clientCount: 4 },
    { id: 'pl-4', name: 'Legado 2024', colorBg: '#222222', colorText: '#cccccc', colorBorder: '#555555', sortOrder: 3, isActive: false, clientCount: 0 },
  ],
  categories: [
    { id: 'c1', name: 'Ide', isDefault: true, sortOrder: 0, clientCount: 21 },
    { id: 'c2', name: 'Ide Hub', isDefault: false, sortOrder: 1, clientCount: 3 },
  ],
  tags: [
    { id: 't-1', name: 'Lançamento', color: '#4b7555', clientCount: 5 },
    { id: 't-2', name: 'lançamento', color: '#8a6d3b', clientCount: 2 },
    { id: 't-3', name: 'Recorrente', color: '#3b5d8a', clientCount: 11 },
    { id: 't-4', name: 'Sazonal', color: '#7a3b8a', clientCount: 0 },
    { id: 't-5', name: 'Varejo', color: '#8a3b3b', clientCount: 6 },
    { id: 't-6', name: 'Indústria', color: '#3b8a85', clientCount: 1 },
  ],
});

/**
 * As rotas da administração, com a forma real. `estado.pedidos` guarda toda
 * escrita (método, rota, corpo); `estado.falhas` responde a próxima escrita de
 * uma rota com recusa — `{ 'PUT /api/admin/people/u-caio/active': [{status, message}] }`.
 */
export function rotasDaAdministracao(estado = {}) {
  const e = {
    pessoas: PESSOAS(),
    convites: CONVITES(),
    catalogos: CATALOGOS(),
    eu: 'u-ana',
    pedidos: [],
    falhas: {},
    ...estado,
  };
  const recusar = (chave) => {
    const fila = e.falhas[chave];
    if (!fila || fila.length === 0) return null;
    const f = fila.shift();
    return { status: f.status ?? 400, body: { ok: false, message: f.message } };
  };
  const handler = (url, req) => {
    const p = url.pathname;
    const m = req.method();
    if (m !== 'GET') {
      e.pedidos.push({ metodo: m, rota: p, corpo: req.postDataJSON?.() ?? null });
      const recusa = recusar(`${m} ${p}`);
      if (recusa) return recusa;
    }
    if (p === '/api/admin/people' && m === 'GET') {
      if (e.recusaDaLista) return { status: e.recusaDaLista.status, body: { ok: false, message: e.recusaDaLista.message } };
      return { body: { ok: true, pessoas: e.pessoas, eu: e.eu } };
    }
    if (p === '/api/admin/queue' && m === 'GET') return { body: { ok: true, convites: e.convites } };
    const fila = /^\/api\/admin\/queue\/([^/]+)$/.exec(p);
    if (fila && m === 'DELETE') {
      e.convites = e.convites.filter((c) => c.id !== fila[1]);
      return { body: { ok: true } };
    }
    if (p === '/api/admin/companies') return { body: { ok: true, empresas: EMPRESAS } };
    if (p === '/api/admin/clients') {
      return { body: { ok: true, clientes: ['Horizonte Studio', 'Aurora Mercado', 'Casa das Flores'].map((nome, i) => ({ id: `cl-${i}`, nome })) } };
    }
    const daPessoa = /^\/api\/admin\/people\/([^/]+)\/(companies|clients|active|areas|role|password-reset)$/.exec(p);
    if (daPessoa) {
      const [, id, oque] = daPessoa;
      const alvo = e.pessoas.find((x) => x.id === id);
      if (m === 'GET' && oque === 'companies') return { body: { ok: true, empresas: EMPRESAS.slice(0, alvo?.empresas ?? 0) } };
      if (m === 'GET' && oque === 'clients') return { body: { ok: true, clientes: [] } };
      const corpo = req.postDataJSON?.() ?? {};
      if (oque === 'active' && alvo) alvo.isActive = corpo.ativo;
      if (oque === 'areas' && alvo) alvo.areas = corpo.areas;
      if (oque === 'role' && alvo) Object.assign(alvo, { papel: corpo.papel, todosOsClientes: corpo.todosOsClientes });
      if (oque === 'companies' && alvo) alvo.empresas = corpo.ids.length;
      if (oque === 'password-reset') {
        // Código FICTÍCIO: não é hash de nada e não vale em lugar nenhum.
        return { body: { ok: true, code: 'TESTE0000', expiresAt: '2026-10-01T12:00:00.000Z', email: alvo?.email, revogados: 0 } };
      }
      return { body: { ok: true, total: 1 } };
    }
    if (p === '/api/admin/invitations' && m === 'POST') {
      return { body: { ok: true, code: 'TESTE0000', expiresAt: '2026-10-02T12:00:00.000Z' } };
    }
    if (p === '/api/catalogs/manage') return { body: e.catalogos };
    if (/^\/api\/tags\/[^/]+\/merge$/.test(p)) return { body: { ok: true, moved: 2 } };
    if (/^\/api\/(plans|categories|tags)(\/[^/]+)?$/.test(p) && m !== 'GET') return { body: { ok: true, id: 'novo', reallocated: 0 } };
    return null;
  };
  return { estado: e, handler };
}

const sessaoAdmin = () => ({ ...sessaoDe('u-bia'), isSuperadmin: true, isSuper: false, papel: 'admin', areas: ['entrega', 'quadro', 'pessoas', 'catalogos'] });
const sessaoSemArea = () => ({ ...sessaoDe('u-duda'), isSuperadmin: false, isSuper: false, papel: 'funcionario', areas: [] });

async function abrirTela(abrir, caminho, { estado, sessao, viewport } = {}) {
  const { estado: e, handler } = rotasDaAdministracao(estado);
  const s = await abrir({
    viewport,
    custom: (url, req) => {
      if (url.pathname === '/api/auth/me' && sessao) return { body: sessao };
      return handler(url, req);
    },
  });
  await s.page.addInitScript(() => {
    window.copiado = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.copiado.push(t); } },
    });
  });
  await s.page.goto(BASE + caminho);
  return { ...s, estado: e };
}

const linha = (page, nome) => page.getByRole('listitem', { name: nome, exact: true });
const escritas = (e) => e.pedidos.filter((p) => p.metodo !== 'GET');

/** O que o navegador guardou — o código e o segredo NÃO podem estar aqui. */
const cofre = (page) =>
  page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, url: location.href }));

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);

  await cenario('P1', 'Pessoas: resumo, alcance por pessoa e a própria linha sem as chaves que trancariam a porta', async (abrir) => {
    const { page, erros } = await abrirTela(abrir, '/pessoas');
    await page.getByRole('heading', { name: 'Pessoas', exact: true }).waitFor();
    await linha(page, 'Caio Martins').waitFor();
    const resumo = await page.getByRole('definition').allTextContents();
    assert.ok(resumo.includes('só um: se ele sair, ninguém assume'), 'um só super admin é dito');
    // Alcance em frase, com o tom de aviso onde a pessoa não vê nada.
    await linha(page, 'Eduarda Lima').getByText('nenhuma área — não abre tela nenhuma').waitFor();
    assert.equal(await linha(page, 'Eduarda Lima').getAttribute('data-tom'), 'warn');
    await linha(page, 'Caio Martins').getByText('3 cliente(s) à parte').waitFor();
    await linha(page, 'Enzo Prado').getByText('desativada — não entra').waitFor();
    // A PRÓPRIA LINHA (a única super admin): sem Ativa, sem Todos, sem lixeira,
    // papel fixo — ninguém se rebaixa nem se desativa.
    const eu = linha(page, 'Ana Ribeiro');
    assert.equal(await eu.getByRole('checkbox', { name: 'Ativa' }).count(), 0);
    assert.equal(await eu.getByRole('button', { name: /^Apagar/ }).count(), 0);
    assert.equal(await eu.getByRole('button', { name: 'Papel', exact: false }).count(), 0);
    await eu.getByText('Você não muda o próprio papel nem se desativa.').waitFor();
    // Os códigos em aberto: o vencido marcado, com as tentativas.
    await page.getByText('2 tentativa(s) errada(s)', { exact: false }).waitFor();
    assert.deepEqual(erros, []);
    return 'resumo, alcance, códigos e a própria linha travada';
  });

  await cenario('P2', 'Pessoas: busca sem resultado é filtro, com Limpar filtros', async (abrir) => {
    const { page } = await abrirTela(abrir, '/pessoas');
    await linha(page, 'Caio Martins').waitFor();
    await page.getByRole('searchbox', { name: 'Buscar por nome ou e-mail' }).fill('ninguém-com-este-nome');
    const estado = page.locator('[data-estado="sem-resultado"]');
    await estado.getByText('Ninguém com esse filtro').waitFor();
    await page.getByText('0 de 6').waitFor();
    await estado.getByRole('button', { name: 'Limpar filtros' }).click();
    await linha(page, 'Caio Martins').waitFor();
    assert.equal(await page.getByRole('searchbox', { name: 'Buscar por nome ou e-mail' }).inputValue(), '');
  });

  await cenario('P3', 'sem a área Pessoas: estado sem acesso, sem Convidar e sem nenhuma ação', async (abrir) => {
    const { page, estado } = await abrirTela(abrir, '/pessoas', {
      sessao: sessaoSemArea(),
      estado: { recusaDaLista: { status: 403, message: 'Você não tem acesso à área Pessoas. Peça a um administrador.' } },
    });
    await page.locator('[data-estado="sem-acesso"]').getByText('Pessoas não está entre as suas áreas').waitFor();
    await page.getByText('Peça a um administrador.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Convidar alguém' }).count(), 0, 'nenhum caminho novo');
    assert.equal(await page.getByRole('searchbox').count(), 0);
    assert.equal(await page.locator('.ad-pessoa, .ad-convite').count(), 0, 'nenhum dado nem ação');
    assert.deepEqual(escritas(estado), []);
  });

  await cenario('P4', 'autorização parcial: administrador não mexe no super admin nem apaga, e não oferece Super admin', async (abrir) => {
    const { page } = await abrirTela(abrir, '/pessoas', { sessao: sessaoAdmin(), estado: { eu: 'u-bia' } });
    const topo = linha(page, 'Ana Ribeiro');
    await topo.waitFor();
    // O papel do super admin é fixo para quem só administra.
    await topo.locator('.ad-papel-fixo').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Apagar / }).count(), 0, 'sem lixeira para quem não é super admin');
    // A própria unidade é do super admin.
    assert.equal(await linha(page, 'Beatriz Nogueira').getByRole('button', { name: /^Unidades de Beatriz/ }).isDisabled(), true);
    // O menu de papel de outra pessoa não oferece "Super admin".
    await linha(page, 'Caio Martins').getByRole('button', { name: /Papel/ }).click();
    const opcoes = await page.getByRole('option').allTextContents();
    assert.ok(opcoes.some((o) => o.includes('Administrador')), 'oferece Administrador');
    assert.ok(!opcoes.some((o) => o.includes('Super admin')), `não oferece Super admin: ${opcoes}`);
  });

  await cenario('P5', 'falha e repetição: a recusa aparece; repetir dá certo e é dito; o duplo clique manda um pedido', async (abrir) => {
    const rota = 'PUT /api/admin/people/u-caio/active';
    const { page, estado } = await abrirTela(abrir, '/pessoas', {
      estado: { falhas: { [rota]: [{ status: 500, message: 'O banco não respondeu. Tente de novo.' }] } },
    });
    const caio = linha(page, 'Caio Martins');
    const ativa = caio.getByRole('checkbox', { name: 'Ativa' });
    await ativa.waitFor({ state: 'attached' });
    // Duplo clique no mesmo instante: a trava deixa passar UM pedido.
    await ativa.evaluate((el) => { el.click(); el.click(); });
    await page.getByRole('alert').getByText('O banco não respondeu. Tente de novo.').waitFor();
    assert.equal(escritas(estado).filter((p) => `${p.metodo} ${p.rota}` === rota).length, 1, 'um pedido só');
    assert.equal(await ativa.isChecked(), true, 'a recusa não mudou nada');
    // Repetir: agora dá certo, e o resultado é dito com o nome.
    await caio.locator('.o-chave', { hasText: 'Ativa' }).click();
    await page.getByRole('status').getByText('Caio Martins foi desativada: não entra mais.').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0, 'a recusa antiga saiu');
    assert.equal(await caio.getByRole('checkbox', { name: 'Ativa' }).isChecked(), false);
    assert.deepEqual(escritas(estado).map((p) => p.corpo), [{ ativo: false }, { ativo: false }]);
  });

  await cenario('P6', 'unidades: a recusa fica na janela; repetir salva, fecha e devolve o foco à linha', async (abrir) => {
    const rota = 'PUT /api/admin/people/u-caio/companies';
    const { page, estado } = await abrirTela(abrir, '/pessoas', {
      estado: { falhas: { [rota]: [{ status: 403, message: 'Você não pode dar uma unidade que não tem.' }] } },
    });
    const botao = linha(page, 'Caio Martins').getByRole('button', { name: /^Unidades de Caio/ });
    await botao.click();
    const janela = page.getByRole('dialog', { name: 'Acesso aos clientes por unidade' });
    await janela.getByRole('button', { name: 'Ide', exact: true }).click();
    await janela.getByText('Ao salvar, ela passa a ver todos os clientes', { exact: false }).waitFor();
    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await janela.getByRole('alert').getByText('Você não pode dar uma unidade que não tem.').waitFor();
    assert.equal(await janela.getByRole('button', { name: 'Ide', exact: true }).getAttribute('aria-pressed'), 'true', 'a marcação continua');
    await janela.getByRole('button', { name: 'Salvar', exact: true }).click();
    await janela.waitFor({ state: 'hidden' });
    await page.getByRole('status').getByText('Unidades de Caio Martins salvas: 1 marcada(s).').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Unidades de Caio'));
    assert.deepEqual(escritas(estado).map((p) => p.corpo), [{ ids: [EMPRESAS[0].id] }, { ids: [EMPRESAS[0].id] }]);
  });

  await cenario('P7', 'código de senha: uma vez, fora do cofre do navegador, e o Esc devolve o foco', async (abrir) => {
    const { page } = await abrirTela(abrir, '/pessoas');
    const botao = linha(page, 'Caio Martins').getByRole('button', { name: 'Redefinir', exact: true });
    await botao.click();
    const janela = page.getByRole('dialog', { name: 'Senha nova' });
    const codigo = (await janela.locator('.tracking-widest').first().textContent()) ?? '';
    assert.ok(codigo.replace(/\W/g, '').includes('TESTE'), `o código aparece: ${codigo}`);
    const guardado = await cofre(page);
    assert.ok(!guardado.includes('TESTE0000'), 'o código não foi para o cofre nem para o endereço');
    await page.keyboard.press('Escape');
    await janela.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Redefinir');
    assert.equal(await page.getByText('TESTE', { exact: false }).count(), 0, 'fechada a janela, o código não existe na tela');
  });

  await cenario('P8', 'código em aberto: Cancelar manda o pedido e diz o resultado', async (abrir) => {
    const { page, estado } = await abrirTela(abrir, '/pessoas');
    await page.getByRole('button', { name: 'Cancelar o código de heitor@example.invalid' }).click();
    await page.getByRole('status').getByText('Código de heitor@example.invalid cancelado: ele deixou de valer.').waitFor();
    assert.deepEqual(escritas(estado).map((p) => `${p.metodo} ${p.rota}`), ['DELETE /api/admin/queue/q-2']);
    assert.equal(await page.getByText('heitor@example.invalid', { exact: true }).count(), 0);
  });

  await cenario('P9', 'código em aberto: "convidado em" e "vale até" são o dia de São Paulo', async (abrir) => {
    // Convidado em 28/09 às 22h30 de Brasília (29/09 01h30 em UTC); vale até
    // 01/10 às 22h (02/10 01h em UTC). O corte do texto por posição dizia 29/09
    // e 02/10.
    const convite = {
      id: 'q-noite',
      email: 'noite@example.invalid',
      expiraEm: '2026-10-02T01:00:00.000Z',
      tentativasFalhas: 0,
      criadoEm: '2026-09-29T01:30:00.000Z',
      vencido: false,
      intencao: 'invite',
    };
    const { page } = await abrirTela(abrir, '/pessoas', { estado: { convites: [convite] } });
    const item = page.locator('.ad-convite', { hasText: 'noite@example.invalid' });
    await item.waitFor();
    await item.getByText('vale até 01/10/2026', { exact: true }).waitFor();
    await item.getByText('convidado em 28/09/2026', { exact: false }).waitFor();
    const texto = (await item.textContent()).replace(/\s+/g, ' ');
    assert.doesNotMatch(texto, /29\/09\/2026|02\/10\/2026/, 'nenhum dia UTC na linha');
  });

  await cenario('C1', 'convite: nome vazio recusado no campo; Enter duas vezes cria um código; o resultado recebe o foco', async (abrir) => {
    const { page, estado } = await abrirTela(abrir, '/contas');
    await page.getByRole('heading', { name: 'Convidar', exact: true }).waitFor();
    const nome = page.getByRole('textbox', { name: /^Nome de quem vai receber/ });
    const email = page.getByRole('textbox', { name: /^E-mail de quem vai receber/ });
    await nome.fill('   ');
    await email.fill('nova@example.invalid');
    await page.getByRole('button', { name: 'Criar acesso', exact: true }).click();
    // A frase fica no campo e nada foi pedido.
    // A frase é a DESCRIÇÃO do campo (aria-describedby) — o leitor a diz junto.
    const descricao = (el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
    const noCampo = await nome.evaluate(descricao);
    assert.ok(noCampo.length > 0, 'o erro do nome mora junto do nome');
    assert.equal(await nome.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(escritas(estado), []);

    await nome.fill('Nova Pessoa');
    // Duas submissões no mesmo quadro: a trava deixa passar UMA.
    await page.locator('form.ad-form').evaluate((f) => { f.requestSubmit(); f.requestSubmit(); });
    const titulo = page.getByRole('heading', { name: 'Acesso criado para Nova Pessoa' });
    await titulo.waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'ad-resultado-titulo');
    assert.equal(escritas(estado).length, 1, 'um convite só');
    assert.equal(escritas(estado)[0].corpo.nome, 'Nova Pessoa');
    assert.ok(!(await cofre(page)).includes('TESTE0000'), 'o código não vai para o cofre');
    await page.getByRole('button', { name: /Copiar instruções/ }).click();
    await page.getByRole('button', { name: 'Copiado — cole no WhatsApp' }).waitFor();
  });

  await cenario('C2', 'convite: a recusa do servidor sobre o e-mail aparece embaixo do e-mail', async (abrir) => {
    const { page } = await abrirTela(abrir, '/contas', {
      estado: { falhas: { 'POST /api/admin/invitations': [{ status: 409, message: 'Este e-mail já tem conta no IDE Works.' }] } },
    });
    await page.getByRole('textbox', { name: /^Nome de quem vai receber/ }).fill('Repetida');
    const email = page.getByRole('textbox', { name: /^E-mail de quem vai receber/ });
    await email.fill('ana@example.invalid');
    await page.getByRole('button', { name: 'Criar acesso', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[type="email"]')?.getAttribute('aria-invalid') === 'true');
    const noCampo = await email.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
    assert.equal(noCampo, 'Este e-mail já tem conta no IDE Works.');
    assert.equal(await page.getByRole('button', { name: 'Criar acesso', exact: true }).isEnabled(), true, 'dá para tentar de novo');
  });

  await cenario('K1', 'fundir etiquetas: escolher o destino não funde; o botão que diz o destino funde', async (abrir) => {
    const { page, estado } = await abrirTela(abrir, '/catalogos');
    await page.getByRole('button', { name: 'Fundir a etiqueta lançamento com outra', exact: true }).click();
    const fusao = page.getByRole('group', { name: 'Fundir lançamento' });
    await fusao.getByRole('button', { name: 'Lançamento', exact: true }).click();
    await fusao.getByText('"lançamento" é apagada e os clientes dela passam a ter "Lançamento"', { exact: false }).waitFor();
    assert.deepEqual(escritas(estado), [], 'escolher não funde');
    await fusao.getByRole('button', { name: 'Fundir em "Lançamento"' }).click();
    await page.getByRole('status').getByText('Fundidas. 2 vínculo(s) movidos para "Lançamento".').waitFor();
    assert.deepEqual(escritas(estado), [{ metodo: 'POST', rota: '/api/tags/t-2/merge', corpo: { into: 't-1' } }]);
  });

  await cenario('K2', 'apagar plano: recusar a confirmação não apaga; aceitar apaga e diz', async (abrir) => {
    const { page, estado } = await abrirTela(abrir, '/catalogos');
    let texto = '';
    const recusar = async (d) => { texto = d.message(); await d.dismiss(); };
    page.on('dialog', recusar);
    await page.getByRole('button', { name: 'Apagar o plano Básico' }).click();
    await page.waitForTimeout(200);
    assert.match(texto, /7 cliente\(s\) usam este plano: o banco vai recusar/);
    assert.deepEqual(escritas(estado), []);
    page.off('dialog', recusar);
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Apagar o plano Legado 2024' }).click();
    await page.getByRole('status').getByText('Plano "Legado 2024" apagado.').waitFor();
    assert.deepEqual(escritas(estado).map((p) => `${p.metodo} ${p.rota}`), ['DELETE /api/plans/pl-4']);
  });

  await cenario('K3', 'salvar catálogo com recusa: o formulário fica aberto, com a frase e o rascunho', async (abrir) => {
    const { page } = await abrirTela(abrir, '/catalogos', {
      estado: { falhas: { 'PUT /api/tags/t-3': [{ status: 409, message: 'Já existe uma etiqueta com esse nome.' }] } },
    });
    await page.getByRole('button', { name: 'Editar a etiqueta Recorrente' }).click();
    const form = page.getByRole('form', { name: 'Editar etiqueta' });
    await form.getByText('os 11 cliente(s) que já a têm', { exact: false }).waitFor();
    await form.getByRole('textbox', { name: 'Nome *' }).fill('Lançamento');
    await form.getByRole('button', { name: 'Salvar', exact: true }).click();
    await form.getByRole('alert').getByText('Já existe uma etiqueta com esse nome.').waitFor();
    assert.equal(await form.getByRole('textbox', { name: 'Nome *' }).inputValue(), 'Lançamento', 'o rascunho continua');
    await form.getByRole('textbox', { name: 'Nome *' }).fill('Recorrente mensal');
    await form.getByRole('button', { name: 'Salvar', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    await page.getByRole('status').getByText('Etiqueta "Recorrente mensal" salva.').waitFor();
  });

  await cenario('L1', '320 e 390 px: telas, formulários e janelas cabem, sem rolagem lateral', async (abrir) => {
    const medidas = [];
    for (const largura of [320, 390]) {
      const viewport = { width: largura, height: 740 };
      for (const caminho of ['/pessoas', '/contas', '/catalogos', '/conexoes']) {
        const { page, context } = await abrirTela(abrir, caminho, { viewport });
        await page.locator('h1').first().waitFor();
        await page.waitForLoadState('networkidle');
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        assert.ok(m.sw <= m.iw, `${caminho} a ${largura}: scrollWidth ${m.sw} > ${m.iw}`);
        if (caminho === '/pessoas') {
          await linha(page, 'Caio Martins').getByRole('button', { name: /^Unidades de Caio/ }).click();
          const caixa = await page.getByRole('dialog').boundingBox();
          assert.ok(caixa && caixa.x >= 0 && caixa.x + caixa.width <= largura, `janela de unidades cabe a ${largura}`);
          await page.keyboard.press('Escape');
        }
        if (caminho === '/catalogos') {
          await page.getByRole('button', { name: 'Novo plano' }).click();
          const form = await page.getByRole('form', { name: 'Novo plano' }).boundingBox();
          assert.ok(form && form.x >= 0 && form.x + form.width <= largura, `formulário do plano cabe a ${largura}`);
          const d = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(d <= 0, `catálogos com o formulário aberto a ${largura}: +${d}px`);
        }
        medidas.push(`${caminho}@${largura}`);
        await context.close();
      }
    }
    return medidas.join(' ');
  });

  return resultados;
}
