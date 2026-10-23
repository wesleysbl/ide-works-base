/**
 * F13 — que parte do sistema cada rota é.
 *
 * O teste que mais importa aqui é o último: ele lê o Worker e cobra que TODA
 * rota esteja classificada. Sem ele, a regra vale só para as rotas de que
 * alguém se lembrou.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AREAS,
  type Area,
  DESCRICAO_DA_AREA,
  ROTULO_DA_AREA,
  areaDaRota,
  podeChamar,
  recusaDeArea,
} from '@/auth/areas';

const TODAS = [...AREAS];
const SO = (a: Area): Area[] => [a];

describe('areaDaRota', () => {
  it('classifica a entrega', () => {
    expect(areaDaRota('/clients')).toBe('entrega');
    expect(areaDaRota('/clients/abc')).toBe('entrega');
    expect(areaDaRota('/items')).toBe('entrega');
    expect(areaDaRota('/calendar')).toBe('entrega');
    expect(areaDaRota('/planning')).toBe('entrega');
    expect(areaDaRota('/tasks/abc')).toBe('entrega');
  });

  it('O QUADRO É ÁREA PRÓPRIA — F17.36', () => {
    // Era `entrega` até a F17.36, e o comentário do mapa dizia por quê: a
    // separação custaria 403 para a equipe inteira. Ela aconteceu, e o preço
    // foi pago pela migration que deu `quadro` a quem tinha `entrega`.
    expect(areaDaRota('/board/tree')).toBe('quadro');
    expect(areaDaRota('/board/tree/full')).toBe('quadro');
    expect(areaDaRota('/board/my-tasks')).toBe('quadro');
    expect(areaDaRota('/board/all-tasks')).toBe('quadro');
    expect(areaDaRota('/board/lists/abc')).toBe('quadro');
    expect(areaDaRota('/board/tasks/abc')).toBe('quadro');
    expect(areaDaRota('/board/spaces/abc/tags')).toBe('quadro');
  });

  it('mas as DEMANDAS continuam na entrega, e isso não é descuido', () => {
    // `/tasks` é a demanda do painel — outra tela, outro pedido, mesma tabela.
    // Área é sobre qual TELA se alcança, não sobre onde o dado mora.
    expect(areaDaRota('/tasks/abc')).toBe('entrega');
    expect(areaDaRota('/tasks/abc/completion')).toBe('entrega');
  });

  it('classifica a Meta', () => {
    expect(areaDaRota('/meta/accounts')).toBe('meta');
    expect(areaDaRota('/meta/ranking')).toBe('meta');
    expect(areaDaRota('/meta-assets/abc/report/paid')).toBe('meta');
  });

  it('classifica a administração de pessoas', () => {
    expect(areaDaRota('/admin/people')).toBe('pessoas');
    expect(areaDaRota('/admin/invitations')).toBe('pessoas');
    expect(areaDaRota('/admin/clients')).toBe('pessoas');
    // F40: o painel da semana. A área só abre a porta; o 403 do papel mora na leitura.
    expect(areaDaRota('/admin/semana')).toBe('pessoas');
    expect(areaDaRota('/admin/semana/liberar')).toBe('pessoas');
  });

  it('a ESCRITA do catálogo (planos, unidades e etiquetas) é da área Catálogos', () => {
    // As rotas de escrita não moram sob `/catalogs`: são `/plans`, `/categories`
    // e `/tags`. Sem regra para elas o mapa devolvia `null` — e `null` é recusa,
    // inclusive para o super admin: a tela de Catálogos não salvava nem apagava
    // nada, e cada clique voltava "Você não tem acesso a esta parte do sistema".
    const id = '00000000-0000-0000-0000-000000000001';
    for (const caminho of [
      '/plans',
      `/plans/${id}`,
      '/categories',
      `/categories/${id}`,
      `/categories/${id}/default`,
      '/tags',
      `/tags/${id}`,
      `/tags/${id}/merge`,
    ]) {
      expect(areaDaRota(caminho), caminho).toBe('catalogos');
    }
    // E só elas: um prefixo parecido não herda a área.
    expect(areaDaRota('/plansx')).toBeNull();
    expect(areaDaRota('/tagsx/abc')).toBeNull();
  });

  it('A ORDEM IMPORTA: gerir catálogo não é lê-lo', () => {
    // `/catalogs/manage` precisa casar ANTES de `/catalogs`. Se caísse em
    // `entrega`, qualquer pessoa poderia apagar um plano usado por trinta
    // clientes.
    expect(areaDaRota('/catalogs/manage')).toBe('catalogos');
    // E a leitura pertence à entrega, porque o formulário de cliente depende
    // dela para oferecer plano, categoria e etiqueta.
    expect(areaDaRota('/catalogs')).toBe('entrega');
  });

  it('identidade e diretório de nomes são livres', () => {
    expect(areaDaRota('/auth/login')).toBe('livre');
    expect(areaDaRota('/auth/me')).toBe('livre');
    expect(areaDaRota('/health')).toBe('livre');
    expect(areaDaRota('/team')).toBe('livre');
    expect(areaDaRota('/integrations/v1/connections')).toBe('livre');
    expect(areaDaRota('/integrations/v1/connections/executions')).toBe('livre');
  });

  it('todas as rotas do chat são livres — F20.3 / D26', () => {
    // Sem área própria: "para todos os funcionários". A chave IDEWORKS_CHAT
    // é o freio. Rota nova sem regra quebra o teste de cobertura do Worker.
    expect(areaDaRota('/chat/conversations')).toBe('livre');
    expect(areaDaRota('/chat/conversations/groups')).toBe('livre');
    expect(areaDaRota('/chat/conversations/direct')).toBe('livre');
    expect(areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001')).toBe(
      'livre',
    );
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/messages'),
    ).toBe('livre');
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/changes'),
    ).toBe('livre');
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/members'),
    ).toBe('livre');
    expect(
      areaDaRota(
        '/chat/conversations/00000000-0000-0000-0000-000000000001/members/00000000-0000-0000-0000-000000000002',
      ),
    ).toBe('livre');
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/leave'),
    ).toBe('livre');
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/ownership'),
    ).toBe('livre');
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/read'),
    ).toBe('livre');
    expect(areaDaRota('/chat/messages/00000000-0000-0000-0000-000000000003')).toBe(
      'livre',
    );
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/images'),
    ).toBe('livre');
    expect(areaDaRota('/chat/images/00000000-0000-0000-0000-000000000003/url')).toBe(
      'livre',
    );
    expect(areaDaRota('/chat/images/urls')).toBe('livre');
    expect(areaDaRota('/chat/directory')).toBe('livre');
    // Candidatos à menção @ — F20.8.
    expect(
      areaDaRota('/chat/conversations/00000000-0000-0000-0000-000000000001/mentionable'),
    ).toBe('livre');
    // Conexão ao vivo (WebSocket) — F20.4. Mesmo freio da chave; sessão completa.
    expect(areaDaRota('/chat/live')).toBe('livre');
    expect(podeChamar('/chat/conversations', [], false)).toBe(true);
    expect(podeChamar('/chat/live', [], false)).toBe(true);
    expect(
      podeChamar(
        '/chat/conversations/00000000-0000-0000-0000-000000000001/mentionable',
        [],
        false,
      ),
    ).toBe(true);
  });

  it('ROTA DESCONHECIDA devolve null, e null é recusa', () => {
    // A alternativa — deixar passar o que não está no mapa — faria toda rota
    // nova nascer sem proteção, em silêncio.
    expect(areaDaRota('/rota-que-alguem-vai-criar')).toBeNull();
    expect(areaDaRota('/')).toBeNull();
  });
});

describe('podeChamar', () => {
  it('só entra em área que tem', () => {
    expect(podeChamar('/meta/accounts', SO('meta'), false)).toBe(true);
    expect(podeChamar('/meta/accounts', SO('entrega'), false)).toBe(false);
    expect(podeChamar('/clients', SO('entrega'), false)).toBe(true);
    expect(podeChamar('/clients', SO('meta'), false)).toBe(false);
  });

  it('o social media que só tem entrega NÃO alcança a Meta', () => {
    const socialMedia = SO('entrega');
    expect(podeChamar('/clients', socialMedia, false)).toBe(true);
    expect(podeChamar('/items', socialMedia, false)).toBe(true);
    expect(podeChamar('/meta/ranking', socialMedia, false)).toBe(false);
    expect(podeChamar('/meta-assets/abc/media', socialMedia, false)).toBe(false);
  });

  it('o gestor de tráfego que só tem meta NÃO alcança o cockpit', () => {
    const trafego = SO('meta');
    expect(podeChamar('/meta/ranking', trafego, false)).toBe(true);
    expect(podeChamar('/clients', trafego, false)).toBe(false);
  });

  it('as duas metades do trabalho se separam de verdade — F17.36', () => {
    // Quem tem só o quadro não abre o painel; quem tem só a entrega não abre o
    // quadro. Antes da F17.36 as duas eram a mesma coisa e nenhuma das quatro
    // asserções abaixo poderia falhar.
    expect(podeChamar('/board/tree', SO('quadro'), false)).toBe(true);
    expect(podeChamar('/clients', SO('quadro'), false)).toBe(false);
    expect(podeChamar('/board/tree', SO('entrega'), false)).toBe(false);
    expect(podeChamar('/clients', SO('entrega'), false)).toBe(true);
  });

  it('as livres passam mesmo sem área nenhuma', () => {
    // Sem isso, quem ficou sem área não conseguiria nem sair do sistema.
    expect(podeChamar('/auth/logout', [], false)).toBe(true);
    expect(podeChamar('/auth/me', [], false)).toBe(true);
    expect(podeChamar('/team', [], false)).toBe(true);
    expect(podeChamar('/integrations/v1/connections', [], false)).toBe(true);
  });

  it('sem área nenhuma, nada mais passa', () => {
    expect(podeChamar('/clients', [], false)).toBe(false);
    expect(podeChamar('/meta/accounts', [], false)).toBe(false);
  });

  it('administrador ignora áreas', () => {
    // Não é atalho: quem administra pessoas se dá qualquer área em dois
    // cliques. Negar seria teatro, e teatro de permissão ensina a procurar
    // contorno.
    expect(podeChamar('/meta/ranking', [], true)).toBe(true);
    expect(podeChamar('/admin/people', [], true)).toBe(true);
  });

  it('mas nem administrador entra em rota desconhecida', () => {
    // A recusa por não estar no mapa é sobre o MAPA, não sobre a pessoa.
    expect(podeChamar('/rota-nova-sem-classificacao', TODAS, true)).toBe(false);
  });
});

describe('recusaDeArea', () => {
  it('diz QUAL área falta, para o pedido ser específico', () => {
    expect(recusaDeArea('/meta/ranking')).toContain('Meta');
    expect(recusaDeArea('/clients')).toContain('Entrega');
    expect(recusaDeArea('/board/tree')).toContain('Quadro');
  });

  it('toda área tem rótulo e descrição — senão a recusa sai sem nome', () => {
    // A caixinha nova da tela de pessoas sai daqui. Uma área sem rótulo
    // apareceria como `undefined` na lista de telas de acesso.
    for (const a of AREAS) {
      expect(ROTULO_DA_AREA[a], `sem rótulo: ${a}`).toBeTruthy();
      expect(DESCRICAO_DA_AREA[a], `sem descrição: ${a}`).toBeTruthy();
    }
    expect(AREAS).toContain('quadro');
  });

  it('rota desconhecida não inventa nome de área', () => {
    expect(recusaDeArea('/nao-existe')).not.toContain('área ');
  });
});

describe('COBERTURA: toda rota do Worker está classificada', () => {
  const worker = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'index.ts'),
    'utf8',
  );

  it('encontra o arquivo do Worker', () => {
    expect(worker).toContain('/auth/login');
  });

  it('nenhuma rota literal ficou de fora do mapa', () => {
    // Lê os caminhos escritos como `rota === 'GET /x'` e confere que cada um
    // tem área. É este teste que faz a regra valer para rotas FUTURAS: quem
    // acrescentar uma sem classificá-la quebra aqui, e não meses depois em
    // produção.
    const literais = [...worker.matchAll(/rota === '(?:GET|POST|PUT|PATCH|DELETE) ([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(literais.length).toBeGreaterThan(15);

    const orfas = literais.filter((c) => areaDaRota(c) === null);
    expect(orfas).toEqual([]);
  });

  it('nenhuma rota com identificador ficou de fora', () => {
    // As rotas casadas por expressão regular no Worker — `/clients/<uuid>` e
    // companhia. O prefixo é o que basta para classificar.
    const prefixos = [...worker.matchAll(/caminho\.match\(\/\^\\\/([a-z-]+)\\\//g)].map(
      (m) => `/${m[1]}/00000000-0000-0000-0000-000000000000`,
    );
    expect(prefixos.length).toBeGreaterThan(5);

    const orfas = prefixos.filter((c) => areaDaRota(c) === null);
    expect(orfas).toEqual([]);
  });
});

describe('COBERTURA: a rota que casa por grupo de palavras também está no mapa', () => {
  const worker = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'index.ts'),
    'utf8',
  );

  it('cada alternativa de `caminho.match(/^\\/(a|b|c)…/)` tem área', () => {
    // O teste dos prefixos acima só enxerga `caminho.match(/^\/palavra\/`. A rota
    // do catálogo é `/^\/(plans|categories|tags)…/` — um grupo —, e foi por
    // esse vão que ela ficou sem área.
    const grupos = [...worker.matchAll(/caminho\.match\(\s*\/\^\\\/\(([a-z-]+(?:\|[a-z-]+)+)\)/g)].map(
      (m) => m[1].split('|'),
    );
    expect(grupos.length).toBeGreaterThan(0);

    const orfas = grupos
      .flat()
      .map((palavra) => `/${palavra}/00000000-0000-0000-0000-000000000000`)
      .filter((c) => areaDaRota(c) === null);
    expect(orfas).toEqual([]);
  });
});

describe('COBERTURA: toda chamada confere a área', () => {
  const worker = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'index.ts'),
    'utf8',
  );

  it('nenhum `resolveActor` esquece de passar o caminho', () => {
    // `caminho` é opcional na assinatura — e sem ele a área NÃO é conferida.
    // Essa fresta existe para o compilador não quebrar; quem a fecha é este
    // teste. Uma chamada sem o caminho seria uma rota destrancada em silêncio.
    const todas = [...worker.matchAll(/resolveActor\(([^)]*)\)/g)].map((m) => m[1]);
    expect(todas.length).toBeGreaterThan(30);

    const semCaminho = todas.filter((args) => !args.includes('caminho'));
    expect(semCaminho).toEqual([]);
  });
});
