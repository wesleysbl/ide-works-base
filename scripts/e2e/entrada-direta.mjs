/**
 * Entrada com sessão válida, renovação e fallback; e, desde a F15, as outras
 * portas públicas — ativar, redefinir e o 404. API simulada, sem credenciais
 * reais: e-mails `example.invalid`, códigos e senhas fictícios.
 */
import assert from 'node:assert/strict';
import { BASE, criarSuite, pause, sessaoDe } from './comum.mjs';

const SEM_SESSAO = (url) => {
  if (url.pathname === '/api/auth/me' || url.pathname === '/api/auth/refresh') return { status: 401, body: {} };
  return null;
};

/** Preenche ativar/redefinir. `codigo` é o que se digita, não o formatado. */
async function preencher(page, { codigo = 'abc-def-ghj', senha = 'senha-ficticia-1' } = {}) {
  await page.getByLabel('E-mail', { exact: true }).fill('test@example.invalid');
  await page.getByLabel(/^Código/).fill(codigo);
  await page.getByLabel(/^Sua senha/).fill(senha);
}

/** O que está escrito em cada campo — para provar que um erro não apagou nada. */
const valores = (page) =>
  page.evaluate(() => [...document.querySelectorAll('main input:not([type=checkbox])')].map((i) => i.value));

export default async function rodar(browser) {
  const suite = criarSuite(browser);

  for (const expired of [false, true]) {
    await suite.cenario(`entrada-${expired ? 'renovada' : 'valida'}`, 'sessão existente abre o painel sem novo login', async (abrir) => {
      let valid = !expired;
      let logins = 0;
      let refreshes = 0;
      const { page } = await abrir({ custom(url) {
        if (url.pathname === '/api/auth/login') logins++;
        if (url.pathname === '/api/auth/me' && !valid) return { status: 401, body: {} };
        if (url.pathname === '/api/auth/refresh') {
          refreshes++;
          valid = true;
          return { body: { ok: true } };
        }
      } });
      await page.goto(BASE + '/');
      await page.waitForURL('**/painel');
      assert.equal(logins, 0);
      assert.equal(refreshes, expired ? 1 : 0);
      assert.equal(await page.getByLabel('Senha', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => history.state.idx), 0);
    });
  }

  for (const rememberMe of [true, false]) {
    await suite.cenario(`entrada-sem-sessao-${rememberMe ? '30-dias' : '12-horas'}`, 'Enter envia uma vez com a duração escolhida', async (abrir) => {
      let loggedIn = false;
      let logins = 0;
      const { page } = await abrir({ custom(url, req) {
        if (url.pathname === '/api/auth/me') return loggedIn ? { body: sessaoDe() } : { status: 401, body: {} };
        if (url.pathname === '/api/auth/refresh') return { status: 401, body: {} };
        if (url.pathname === '/api/auth/login') {
          logins++;
          assert.deepEqual(req.postDataJSON(), { email: 'test@example.invalid', password: 'senha-ficticia', rememberMe });
          loggedIn = true;
          return { body: { ok: true, userId: 'u-ana' } };
        }
      } });
      await page.goto(BASE + '/');
      await page.getByLabel('E-mail', { exact: true }).fill('test@example.invalid');
      await page.getByLabel('Senha', { exact: true }).fill('senha-ficticia');
      const remember = page.getByRole('checkbox', { name: 'Manter conectado por 30 dias' });
      assert.ok(await remember.isChecked());
      if (!rememberMe) {
        await page.getByText('Manter conectado por 30 dias', { exact: true }).click();
        assert.equal(await remember.isChecked(), false);
      }
      assert.equal(logins, 0);
      await page.getByLabel('Senha', { exact: true }).press('Enter');
      await page.waitForURL('**/painel');
      assert.equal(logins, 1);
    });
  }

  await suite.cenario('entrada-indisponivel', 'falha temporária permite entrar e não redireciona', async (abrir) => {
    const { page } = await abrir({ custom(url) {
      if (url.pathname === '/api/auth/me') return { status: 503, body: {} };
    } });
    await page.goto(BASE + '/');
    await page.getByText('Não foi possível verificar sua sessão. Recarregue a página ou tente entrar.').waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.ok(await page.getByRole('button', { name: 'Entrar', exact: true }).isEnabled());
  });

  /* ─────────────── F15 — as outras portas públicas ─────────────── */

  await suite.cenario('publicas-sem-cracha', 'ativar e redefinir abrem sem sessão e não mandam para a entrada', async (abrir) => {
    const { page } = await abrir({ custom: SEM_SESSAO });
    for (const [rota, titulo] of [['/ativar', 'Ativar conta'], ['/redefinir', 'Escolher senha nova']]) {
      await page.goto(BASE + rota);
      await page.getByRole('heading', { name: titulo, exact: true }).waitFor();
      await pause(400);
      assert.equal(new URL(page.url()).pathname, rota);
      assert.equal(await page.getByRole('link', { name: 'Entrada' }).getAttribute('href'), '/');
    }
  });

  await suite.cenario('protegida-sem-cracha', 'rota protegida sem sessão continua mandando para a entrada', async (abrir) => {
    // Sem crachá, a API inteira responde 401 — é assim que o servidor responde.
    const { page } = await abrir({ custom: (url) => (url.pathname === '/api/config' ? null : { status: 401, body: {} }) });
    /* ⚠️ ESPERA-SE O LUGAR FINAL, E NÃO A NAVEGAÇÃO — revisão pós-F43. Sem
       crachá, cada leitura da tela (`/auth/me`, a árvore e os avisos da barra,
       os clientes do painel) recebe 401 e manda para a entrada por conta
       própria (`window.location.replace('/')`). A segunda chamada ABORTA a
       navegação da primeira — as duas para `/` —, e o `waitForURL` às vezes
       pega a abortada e falha com `net::ERR_ABORTED`, embora a página termine
       na entrada. Medido: em toda execução há um `/` abortado; o `waitForURL`
       falhou 1 vez em 3 rodadas do arquivo, e 2 em 28 repetições do cenário.
       Pelo mesmo motivo o `goto` só espera a página COMEÇAR (`commit`): se o
       desvio chegasse antes do `load` de `/painel`, seria o `goto` a abortar.
       O que se prova continua o mesmo: termina na entrada, com o formulário. */
    await page.goto(BASE + '/painel', { waitUntil: 'commit' });
    await page.getByLabel('Senha', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/');
  });

  await suite.cenario('autocomplete', 'os campos dizem ao gerenciador de senhas o que são', async (abrir) => {
    const { page } = await abrir({ custom: SEM_SESSAO });
    const auto = (rotulo) => page.getByLabel(rotulo).first().getAttribute('autocomplete');
    await page.goto(BASE + '/');
    assert.equal(await auto('E-mail'), 'username');
    assert.equal(await page.getByLabel('Senha', { exact: true }).getAttribute('autocomplete'), 'current-password');
    for (const rota of ['/ativar', '/redefinir']) {
      await page.goto(BASE + rota);
      await page.getByLabel(/^Código/).waitFor();
      assert.equal(await auto('E-mail'), 'username', rota);
      assert.equal(await page.getByLabel(/^Código/).getAttribute('autocomplete'), 'one-time-code', rota);
      const senha = page.getByLabel(/^Sua senha/);
      assert.equal(await senha.getAttribute('autocomplete'), 'new-password', rota);
      // Mostrar/ocultar também na senha nova.
      assert.equal(await senha.getAttribute('type'), 'password');
      await page.getByRole('button', { name: 'Mostrar senha' }).click();
      assert.equal(await senha.getAttribute('type'), 'text');
      await page.getByRole('button', { name: 'Ocultar senha' }).click();
      assert.equal(await senha.getAttribute('type'), 'password');
    }
  });

  await suite.cenario('ativar-codigo-malformado', 'código torto é recusado NO campo, sem ir à rede e sem apagar nada', async (abrir) => {
    let pedidos = 0;
    const { page } = await abrir({ custom(url) {
      if (url.pathname === '/api/auth/activate') pedidos++;
      return SEM_SESSAO(url);
    } });
    await page.goto(BASE + '/ativar');
    await preencher(page, { codigo: 'ab1' });
    await page.getByRole('button', { name: 'Ativar e definir senha' }).click();
    const codigo = page.getByLabel(/^Código/);
    await page.getByText('O código tem nove caracteres, no formato XXX-XXX-XXX.').waitFor();
    assert.equal(pedidos, 0);
    assert.equal(await codigo.getAttribute('aria-invalid'), 'true');
    assert.ok(await codigo.evaluate((el) => el === document.activeElement), 'o foco vai ao código');
    const ref = await codigo.getAttribute('aria-describedby');
    assert.match(await page.locator(`[id="${ref}"]`).innerText(), /nove caracteres/);
    assert.deepEqual(await valores(page), ['', 'test@example.invalid', 'ab1', 'senha-ficticia-1']);
  });

  await suite.cenario('ativar-codigo-expirado', 'código vencido: frase do servidor, dados preservados, uma tentativa por clique', async (abrir) => {
    let pedidos = 0;
    const { page } = await abrir({ async custom(url) {
      if (url.pathname === '/api/auth/activate') {
        pedidos++;
        await pause(500);
        return { status: 400, body: { message: 'Código inválido ou expirado.' } };
      }
      return SEM_SESSAO(url);
    } });
    await page.goto(BASE + '/ativar?nome=Ana%20Teste');
    await preencher(page);
    // Dois Enter seguidos: um pedido só.
    await page.getByLabel(/^Sua senha/).press('Enter');
    await page.getByLabel(/^Sua senha/).press('Enter').catch(() => {});
    await page.getByRole('button', { name: 'Ativando…' }).waitFor();
    await page.getByText('Código inválido ou expirado.').waitFor();
    assert.equal(pedidos, 1);
    assert.equal(await page.getByRole('alert').filter({ hasText: 'expirado' }).count(), 1);
    assert.deepEqual(await valores(page), ['Ana Teste', 'test@example.invalid', 'ABC-DEF-GHJ', 'senha-ficticia-1']);
    assert.ok(await page.getByRole('button', { name: 'Ativar e definir senha' }).isEnabled());
  });

  await suite.cenario('ativar-sucesso', 'ativou: diz o que aconteceu e o foco vai para Entrar', async (abrir) => {
    let corpo = null;
    const { page } = await abrir({ custom(url, req) {
      if (url.pathname === '/api/auth/activate') {
        corpo = req.postDataJSON();
        return { body: { ok: true, email: 'test@example.invalid', senhaDefinida: true } };
      }
      return SEM_SESSAO(url);
    } });
    await page.goto(BASE + '/ativar');
    await preencher(page);
    await page.getByRole('button', { name: 'Ativar e definir senha' }).click();
    await page.getByRole('heading', { name: 'Conta ativada' }).waitFor();
    const entrar = page.getByRole('link', { name: 'Entrar', exact: true });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Entrar');
    assert.equal(await entrar.getAttribute('href'), '/');
    // O código segue como foi digitado: quem normaliza é o servidor (sem mudança na F15).
    assert.deepEqual(corpo, { email: 'test@example.invalid', code: 'abc-def-ghj', password: 'senha-ficticia-1', nome: '' });
  });

  await suite.cenario('redefinir-rede-fora', 'rede caiu: diz que é a conexão e não apaga o que foi digitado', async (abrir) => {
    const { page } = await abrir({ custom: SEM_SESSAO });
    await page.route('**/api/auth/reset-password', (r) => r.abort('internetdisconnected'));
    await page.goto(BASE + '/redefinir');
    await preencher(page);
    await page.getByRole('button', { name: 'Trocar minha senha' }).click();
    await page.getByText('Não foi possível falar com o servidor. Verifique a conexão.').waitFor();
    assert.deepEqual(await valores(page), ['test@example.invalid', 'ABC-DEF-GHJ', 'senha-ficticia-1']);
    // Voltou a rede: a mesma tela, sem redigitar, conclui.
    await page.unroute('**/api/auth/reset-password');
    await page.route('**/api/auth/reset-password', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, email: 'test@example.invalid' }) }));
    await page.getByRole('button', { name: 'Trocar minha senha' }).click();
    await page.getByRole('heading', { name: 'Senha trocada' }).waitFor();
  });

  await suite.cenario('entrada-dois-enter', 'dois Enter no login mandam um pedido só', async (abrir) => {
    let logins = 0;
    const { page } = await abrir({ async custom(url) {
      if (url.pathname === '/api/auth/login') {
        logins++;
        await pause(500);
        return { status: 401, body: { message: 'E-mail ou senha inválidos.' } };
      }
      return SEM_SESSAO(url);
    } });
    await page.goto(BASE + '/');
    await page.getByLabel('E-mail', { exact: true }).fill('test@example.invalid');
    const senha = page.getByLabel('Senha', { exact: true });
    await senha.fill('senha-ficticia');
    await senha.press('Enter');
    await senha.press('Enter').catch(() => {});
    await page.getByText('E-mail ou senha inválidos.').waitFor();
    assert.equal(logins, 1);
    assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'test@example.invalid');
  });

  for (const comSessao of [false, true]) {
    await suite.cenario(`404-${comSessao ? 'com' : 'sem'}-sessao`, '404 oferece a saída certa para quem olha, sem redirecionar', async (abrir) => {
      const { page } = await abrir({ custom: (url) => (comSessao ? null : SEM_SESSAO(url)) });
      await page.goto(BASE + '/endereco/que/nao/existe');
      await page.getByRole('heading', { name: 'Página não encontrada' }).waitFor();
      await page.getByText('/endereco/que/nao/existe', { exact: true }).waitFor();
      const [nome, destino] = comSessao ? ['Ir para o Painel', '/painel'] : ['Voltar para a entrada', '/'];
      const link = page.getByRole('link', { name: nome });
      await link.waitFor();
      await pause(400);
      assert.equal(new URL(page.url()).pathname, '/endereco/que/nao/existe');
      assert.equal(await link.getAttribute('href'), destino);
      await link.click();
      if (comSessao) await page.waitForURL('**/painel');
      else await page.getByLabel('Senha', { exact: true }).waitFor();
    });
  }

  for (const [largura, altura, tema] of [[390, 844, 'escuro'], [390, 360, 'claro'], [390, 360, 'escuro']]) {
    await suite.cenario(`estreita-${largura}x${altura}-${tema}`, 'celular com teclado: campos e ação principal alcançáveis', async (abrir) => {
      const { page } = await abrir({ custom: SEM_SESSAO, viewport: { width: largura, height: altura }, tema });
      for (const [rota, botao] of [['/', 'Entrar'], ['/ativar', 'Ativar e definir senha'], ['/redefinir', 'Trocar minha senha']]) {
        await page.goto(BASE + rota);
        const acao = page.getByRole('button', { name: botao, exact: true });
        await acao.waitFor();
        const campos = page.locator('main input:not([type=checkbox])');
        for (let i = 0; i < (await campos.count()); i++) {
          await campos.nth(i).focus();
          const caixa = await campos.nth(i).boundingBox();
          // Meio pixel de folga, como em `medirFocado`: o foco rola o campo até
          // encostar na borda de baixo, e o arredondamento do subpixel às vezes
          // dava 360,2 numa janela de 360 (3 em 15 numa reprodução, 08/10).
          assert.ok(caixa && caixa.y >= -0.5 && caixa.y + caixa.height <= altura + 0.5, `${rota}: campo ${i} fora da janela ao focar`);
        }
        await acao.scrollIntoViewIfNeeded();
        const b = await acao.boundingBox();
        assert.ok(b && b.y >= 0 && b.y + b.height <= altura, `${rota}: ação fora da janela`);
        assert.ok(b.height >= 44, `${rota}: ação com ${b.height}px de altura`);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
        assert.equal(m.sw, m.iw, `${rota}: rolagem lateral`);
        // O que se pede nunca promete o que não existe.
        const texto = await page.locator('main').innerText();
        assert.doesNotMatch(texto, /esqueci|cadastre-se|criar conta|enviaremos|link por e-mail|solicit/i, rota);
      }
    });
  }

  return suite.resultados;
}
