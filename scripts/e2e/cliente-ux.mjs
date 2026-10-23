/**
 * A FICHA DO CLIENTE: OPERAÇÃO PERTO DO TOPO — F11B do plano UX.
 *
 * O que se prova aqui, no Chrome, com a API interceptada (dados fictícios):
 *
 *   CX1  celular 390 × 844, ficha cheia: as sete áreas começam antes de 35% da
 *        altura e o primeiro item da produção aparece na primeira tela; sem
 *        rolagem lateral. O cadastro inteiro abre em "Dados do cliente".
 *   CX2  desktop 1440 × 900: áreas e primeiro item na primeira tela; cota
 *        vigente (cadastro) ≠ contratado do mês (congelado), cada um com nome.
 *   CX3  o endereço reproduz área, competência e período: o deep link abre a
 *        Semanal de junho no recorte pedido; trocar de área mantém mês e
 *        período; o que é inválido vira o padrão sem derrubar o resto.
 *   CX4  voltar do Painel: o degrau "Painel" e o VOLTAR do navegador devolvem
 *        o recorte, mesmo depois de trocar área, mês e de cliente.
 *   CX5  editar o cadastro: fechar devolve o foco a "Editar cadastro" e o
 *        contexto fica; o rascunho não se perde (é oferecido ao reabrir).
 *   CX6  pedidos atrasados: trocar de cliente e de mês depressa — a resposta
 *        velha, chegando depois, não substitui a ficha nova.
 *   CX7  sem contrato (mês fechado), inativo, nome e observações longos.
 *   CX8  acesso parcial: a recusa do servidor aparece e FICA (antes a releitura
 *        a apagava no mesmo instante).
 *   CX9  teclado nas áreas: ←/→/Home/End trocam a área e o endereço.
 *   CX-RITUAL (F43, Fase 3) o ciclo do mês para quem não administra: os
 *        botões vêm desligados com o porquê escrito ("Só um administrador
 *        marca."/"…abre o mês."); a ficha do administrador não muda; 390 sem
 *        rolagem lateral.
 *
 * F11C — as áreas internas:
 *   CX10 Conteúdos, Semanal e Calendário: os mesmos itens nos mesmos dias; o
 *        extra e o sem-data aparecem uma vez só; o compromisso do Calendário
 *        não vira conteúdo; cada caixa de conclusão se chama pelo item.
 *   CX11 Checklist: pendentes → concluídas → arquivadas; resumo sem as
 *        arquivadas; editar no lugar; a recusa ao salvar deixa o rascunho.
 *   CX11b Checklist: "concluída por … · data" e "arquivada" dizem o dia de SÃO
 *        PAULO (22h30 do dia 8 não vira dia 9, nem o mês seguinte no dia 31).
 *   CX12 Semanal: atalho por semana e para o "sem dia" leva e dá foco.
 *   CX13 Captação: o mês que conta separado dos outros; data, quem e estado;
 *        a recusa ao salvar deixa o rascunho.
 *   CX14 Mural: lista por padrão a 390; editar na lista grava só o texto;
 *        o quadro guarda as posições; a alça move pelas setas e grava só a
 *        posição; o fundo do quadro deixa rolar; o vazio não fala de senha.
 *   CX15 Histórico: data, origem e documentos; endereço pedido no clique; a
 *        falha aparece junto do documento.
 *   CX16 vazio e erro de leitura nas quatro áreas com leitura própria.
 *
 * F18C (R09) — Lista | Kanban nas listas operacionais da ficha:
 *   CX-LK1 Checklist: colunas = Pendentes/Concluídas(/Arquivadas); setas e
 *          arrasto usam as MESMAS escritas da Lista; a escolha é deste cliente
 *          e não vaza para Conteúdos; o Mural segue com o "Quadro" dele.
 *   CX-LK2 Conteúdos: A entregar/Entregues com os mesmos itens da Lista; a
 *          seta marca como a caixa marca; o foco acompanha o cartão.
 *   CX-LK3 Conteúdos: gesto cancelado não grava; entregar pelo arrasto oferece
 *          "Desfazer" (a escrita contrária); recusa devolve o cartão e avisa.
 *   CX-LK4 Checklist: "Ver arquivadas" no Kanban mostra "Carregando" na coluna,
 *          não "Nenhuma arquivada", até a releitura chegar.
 *   CX-LK-telas-{1440,1280,390}-{claro,escuro}: sem rolagem lateral;
 *          capturas com LK_CAPTURAS=<pasta>.
 *
 * Revisão de 28/09 (fixture densa na cx-21):
 *   CX17 R02 Mural: duas notas no MESMO retângulo e uma além da janela —
 *        abrir e trocar de forma não gravam; o teclado traz a de baixo para a
 *        frente; a lista edita as duas; "Organizar notas" só grava com o sim.
 *   CX18 R05 Checklist: 40 concluídas recolhidas; alcance escrito; descrição
 *        fechada e, aberta, sem Markdown cru; editar recebe o texto original.
 *
 * `CLIENTE_CAPTURAS=<pasta>` grava cheio/sem-contrato/inativo em 1440/1024/390,
 * claro e escuro; `CLIENTE_CAPTURAS_AREAS=<pasta>` grava as seis áreas (cheia
 * e vazia) em 1440 e 390, claro e escuro.
 */

import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, criarSuite, hojeEmSaoPaulo, pause } from './comum.mjs';
import { CARTEIRA } from './painel-ux.mjs';

/* ─────────────────────────── fixtures ─────────────────────────── */

const TIPOS = ['video', 'arte', 'foto', 'ads'];
const hoje = hojeEmSaoPaulo();
const MES_ATUAL = hoje.toISOString().slice(0, 7);
const emDias = (n) =>
  new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + n)).toISOString().slice(0, 10);

/** A cota VIGENTE do cadastro. */
const COTA_VIGENTE = { video: 4, arte: 8, foto: 6, ads: 2 };
/** O contratado CONGELADO no mês — diferente de propósito (a cota mudou depois). */
const CONGELADO = { video: 3, arte: 6, foto: 5, ads: 2 };

const nomeDoMes = (mes) => {
  const t = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${mes}-01T12:00:00Z`),
  );
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const itens = (mes, n = 8) => [
  ...Array.from({ length: n }, (_, i) => ({
    id: `it-${mes}-${i}`,
    contentType: TIPOS[i % 4],
    scheduledAt: `${mes}-${String(10 + i).padStart(2, '0')}T12:00:00Z`,
    completedAt: i < 3 ? `${mes}-${String(10 + i).padStart(2, '0')}T15:00:00Z` : null,
    isExtra: false,
    title: `Peça ${i + 1} de ${mes}`,
  })),
  // O extra do mês (F11C): tem dia, e não pode aparecer duas vezes.
  { id: `it-${mes}-x`, contentType: 'arte', scheduledAt: `${mes}-20T12:00:00Z`, completedAt: null, isExtra: true, title: `Extra de ${mes}` },
];

/** O item sem dia do mês — o mesmo em `unscheduled` e em `monthItems`. */
const semDia = (mes) => ({ id: `sd-${mes}`, contentType: 'video', scheduledAt: null, completedAt: null, isExtra: false, title: 'Sem data' });

const perfil = (o = {}) => ({
  taxId: null,
  companyEmail: 'contato@example.invalid',
  plan: { id: 'pl-full', name: 'Full', colorBg: '#eceff6', colorText: '#34466b', colorBorder: '#cbd3e6' },
  startedOn: '2026-01-01',
  renewsOn: emDias(7),
  phone: null,
  whatsapp: '16999990000',
  address: 'Endereço fictício, 100',
  ownerName: 'Responsável de demonstração',
  ownerPhone: null,
  ownerWhatsapp: null,
  notes: 'Priorizar a campanha de primavera.\nRevisar as peças antes da aprovação.',
  financeOk: false,
  inactiveAt: null,
  links: [{ id: 'l1', title: 'Pasta de materiais', url: 'https://example.invalid/materiais' }],
  tags: [{ id: 'tg-recorrente', name: 'Recorrente', color: '#4b7555' }],
  quotas: TIPOS.map((t) => ({ contentType: t, quantity: COTA_VIGENTE[t] })),
  ...o,
});

const mensuravel = (nivel) => ({
  measurable: true,
  level: nivel,
  base: Math.min(100, nivel),
  bonus: Math.max(0, nivel - 100),
  breakdown: TIPOS.map((t) => ({
    contentType: t,
    contracted: CONGELADO[t],
    delivered: Math.min(CONGELADO[t], Math.round((CONGELADO[t] * nivel) / 100)),
    extras: 0,
  })),
});

const LONGO =
  'Cliente com uma observação comprida de propósito. '.repeat(12) +
  '\nSegunda linha que precisa sobreviver.\nTerceira linha.\nQuarta.\nQuinta.\nSexta linha, só visível ao expandir.';

/** As fichas, por id: a mesma carteira do painel-ux (ids `cx-N`). */
export const FICHAS = {
  'cx-1': { name: 'Horizonte Studio', urgency: 'perigo', isActive: true, tipo: 'cheio' },
  'cx-2': { name: 'Aurora Mercado', urgency: 'alerta', isActive: true, tipo: 'sem-contrato' },
  'cx-3': { name: 'Instituto Vila Nova', urgency: 'paz', isActive: true, tipo: 'cheio' },
  'cx-13': { name: 'Antiga Papelaria', urgency: 'paz', isActive: false, tipo: 'inativo' },
  'cx-20': {
    name: 'Associação Comercial e Industrial dos Fabricantes de Enxovais e Cama, Mesa e Banho de Ibitinga',
    urgency: 'alerta',
    isActive: true,
    tipo: 'longo',
  },
  // Nome de DUAS linhas a 390 px: a meta de 35% tem de passar com ele também.
  'cx-21': { name: 'Associação Comercial e Industrial dos Fabricantes de Enxovais de Ibitinga', urgency: 'paz', isActive: true, tipo: 'cheio' },
};
const ORDEM = ['cx-1', 'cx-2', 'cx-3', 'cx-13', 'cx-20'];

/** O `GET /api/clients/:id?month=AAAA-MM-01[&from&to]` de cada ficha. */
function ficha(id, url) {
  const f = FICHAS[id];
  const mes = (url.searchParams.get('month') ?? `${MES_ATUAL}-01`).slice(0, 7);
  const de = url.searchParams.get('from');
  const ate = url.searchParams.get('to');
  const i = ORDEM.indexOf(id);
  const todos = itens(mes);
  const noPeriodo = de && ate ? todos.filter((x) => x.scheduledAt.slice(0, 10) >= de && x.scheduledAt.slice(0, 10) < ate) : todos;
  const aberto = f.tipo === 'cheio' || f.tipo === 'longo';
  return {
    id,
    name: f.name,
    categoryName: 'Ide',
    planName: 'Full',
    urgency: f.urgency,
    isActive: f.isActive,
    profile: perfil({
      ...(f.tipo === 'sem-contrato' ? { plan: null, renewsOn: null, notes: null, links: [], tags: [], financeOk: true } : {}),
      // Cancelado às 22h de 31/03 em São Paulo (01h UTC de 01/04): o "Inativo desde"
      // é o dia de São Paulo, o mesmo da regra do mês do cancelamento.
      ...(f.tipo === 'inativo' ? { inactiveAt: '2026-04-01T01:00:00Z', financeOk: true, renewsOn: emDias(-20) } : {}),
      ...(f.tipo === 'longo' ? { notes: LONGO, companyEmail: 'atendimento.comercial.enxovais@exemplo-muito-comprido.invalid' } : {}),
    }),
    neighbors: { previous: ORDEM[i - 1] ?? null, next: ORDEM[i + 1] ?? null },
    month: `${mes}-01`,
    monthOpened: aberto,
    planningDoneAt: aberto ? `${mes}-02T12:00:00Z` : null,
    clientApprovedAt: null,
    delivery: aberto
      ? mensuravel(mes === MES_ATUAL ? 25 : 60)
      : { measurable: false, reason: 'no_contract', message: 'Mês ainda não aberto.' },
    scheduled: aberto ? noPeriodo : [],
    unscheduled: aberto ? [semDia(mes)] : [],
    monthItems: aberto ? [...todos, semDia(mes)] : [],
  };
}

const FORM = {
  name: 'Horizonte Studio', taxId: '', companyEmail: 'contato@example.invalid', planId: null, categoryId: 'c1',
  startedOn: '2026-01-01', renewsOn: '', phone: '', whatsapp: '', address: '', ownerName: '', ownerPhone: '',
  ownerWhatsapp: '', notes: '', quotas: COTA_VIGENTE, links: [], tagIds: [],
};

/**
 * O `custom` do `setup`. `atraso(url)` devolve ms de espera para aquela
 * leitura (a corrida do CX6); `recusar(url, req)` devolve a recusa (CX8).
 */
/* ── as áreas internas (F11C): só a ficha cx-1 tem conteúdo; as outras, vazio ── */

const EQUIPE = [{ id: 'u-ana', name: 'Ana Demo' }, { id: 'u-bruno', name: 'Bruno Demo' }];
const ANA = EQUIPE[0];
const mesAnterior = (() => {
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 15));
  return d.toISOString().slice(0, 7);
})();

const demanda = (o) => ({
  description: null, dueOn: null, completedAt: null, completedBy: null, archivedAt: null, assignees: [],
  createdAt: '2026-08-01T00:00:00Z', ...o,
});
const DEMANDAS = [
  demanda({ id: 't-atrasada', title: 'Aprovar roteiro institucional', dueOn: emDias(-3), assignees: [ANA], description: 'Cliente pediu uma versão mais curta.\nMandar por e-mail.' }),
  demanda({ id: 't-hoje', title: 'Enviar pauta do próximo mês', dueOn: emDias(0) }),
  demanda({ id: 't-em-dia', title: 'Revisar legendas', dueOn: emDias(5), assignees: EQUIPE }),
  demanda({ id: 't-sem-prazo', title: 'Atualizar manual de marca' }),
  demanda({ id: 't-feita', title: 'Coletar fotos da loja', dueOn: emDias(-10), completedAt: `${emDias(-9)}T12:00:00Z`, completedBy: ANA }),
];
const ARQUIVADA = demanda({ id: 't-arquivada', title: 'Campanha antiga', dueOn: emDias(-40), archivedAt: `${emDias(-30)}T12:00:00Z` });

const captura = (o) => ({ capturedBy: null, capturedByNote: null, kinds: [], script: null, notes: null, totalMinutes: null, ...o });
const CAPTACOES = [
  captura({ id: 'cp-1', recordedOn: `${MES_ATUAL}-08`, videoCount: 2, status: 'in_edit', capturedBy: ANA, kinds: ['institutional', 'product'], totalMinutes: 45, script: 'Depoimento do fundador e produtos novos.' }),
  captura({ id: 'cp-2', recordedOn: `${MES_ATUAL}-03`, videoCount: 1, status: 'published', capturedByNote: 'Produtora parceira (fictícia)', kinds: ['event'] }),
  captura({ id: 'cp-3', recordedOn: `${mesAnterior}-20`, videoCount: 3, status: 'edited', capturedBy: EQUIPE[1], kinds: ['promotional'], notes: 'Chuva atrasou a gravação.' }),
];

const nota = (o) => ({ title: null, color: 'yellow', width: 220, height: 160, viaName: null, viaAuthorName: null, ...o });
const NOTAS = [
  nota({ id: 'n-1', title: 'Tom de voz', content: 'Próximo, sem gírias.\nNunca usar "promoção imperdível".', positionX: 16, positionY: 16 }),
  nota({ id: 'n-2', title: 'Referências', content: 'Paleta da campanha de primavera.', color: 'blue', positionX: 260, positionY: 40 }),
  nota({ id: 'n-3', title: 'Combinados', content: 'Aprovação sempre com o responsável.', color: 'green', positionX: 640, positionY: 500 }),
];

const registro = (o) => ({ subtitle: null, ledBy: null, ledByNote: null, documents: [], viaName: null, viaAuthorName: null, ...o });
const REGISTROS = [
  registro({
    id: 'h-1', happenedOn: emDias(-2), createdAt: `${emDias(-1)}T15:00:00Z`, title: 'Reunião de alinhamento', subtitle: 'Planejamento do próximo mês',
    body: 'Decidimos dobrar os vídeos curtos e manter as artes.', ledBy: ANA,
    documents: [
      { id: 'doc-ok', fileName: 'ata-da-reuniao.pdf', mimeType: 'application/pdf', sizeBytes: 182_000, uploadedAt: `${emDias(-1)}T15:00:00Z` },
      { id: 'doc-falha', fileName: 'contrato-assinado.pdf', mimeType: 'application/pdf', sizeBytes: 2_400_000, uploadedAt: `${emDias(-1)}T15:00:00Z` },
    ],
  }),
  registro({ id: 'h-2', happenedOn: emDias(-20), createdAt: `${emDias(-20)}T15:00:00Z`, title: 'Mudança de escopo', body: 'Entrou o impulsionamento mensal.', ledByNote: 'O próprio cliente', viaName: 'Claude', viaAuthorName: 'Ana Demo' }),
];

/* R02/R05 (revisão de 28/09): a ficha cx-21 tem o mural e o checklist densos. */
const DESCRICAO_MD = '**Roteiro aprovado** pelo cliente.\n\n- Cortar para 30 s\n- Legenda em *caixa alta*\n\n' + 'Contexto longo da demanda. '.repeat(20);
const DEMANDAS_DENSAS = [
  demanda({ id: 'td-p1', title: 'Fechar pauta de outubro', dueOn: emDias(2), description: DESCRICAO_MD }),
  demanda({ id: 'td-p2', title: 'Revisar vídeo do fundador', dueOn: emDias(-1) }),
  ...Array.from({ length: 40 }, (_, i) =>
    demanda({ id: `td-c${i}`, title: `Entrega concluída ${i + 1}`, dueOn: emDias(-60 - i), completedAt: `${emDias(-59 - i)}T12:00:00Z`, completedBy: ANA, description: DESCRICAO_MD }),
  ),
];
const NOTAS_SOBREPOSTAS = [
  nota({ id: 'ns-1', title: 'Primeira', content: 'A nota de cima.', positionX: 334, positionY: 40 }),
  nota({ id: 'ns-2', title: 'Segunda', content: 'A nota escondida embaixo.', color: 'green', positionX: 334, positionY: 40 }),
  nota({ id: 'ns-3', title: 'Distante', content: 'Posta além da janela estreita.', color: 'blue', positionX: 1180, positionY: 700 }),
];

/** As entradas do `/calendar` do cliente: os mesmos itens da ficha + um compromisso. */
function calendario(url) {
  const de = url.searchParams.get('from');
  const ate = url.searchParams.get('to');
  const id = url.searchParams.get('client');
  const f = FICHAS[id];
  if (!f || !(f.tipo === 'cheio' || f.tipo === 'longo')) return [];
  const meses = new Set([de.slice(0, 7), ate.slice(0, 7)]);
  const entradas = [...meses].flatMap((m) => itens(m)).filter((i) => {
    const d = i.scheduledAt.slice(0, 10);
    return d >= de && d < ate;
  }).map((i) => ({
    kind: 'delivery', id: i.id, clientId: id, clientName: f.name, contentType: i.contentType, day: i.scheduledAt.slice(0, 10),
    time: null, title: i.title, isExtra: i.isExtra, isCompleted: i.completedAt !== null, notes: null,
  }));
  const reuniao = `${de.slice(0, 7)}-15`;
  if (reuniao >= de && reuniao < ate)
    entradas.push({ kind: 'appointment', id: 'ap-1', clientId: id, clientName: f.name, contentType: '', day: reuniao, time: '10:00', title: 'Reunião de pauta', isExtra: false, isCompleted: false, notes: null });
  return entradas;
}

/** O que as áreas leem de cada ficha. `vazias`: responder tudo vazio. */
function areaDe(id, url, vazias) {
  const cheia = id === 'cx-1' && !vazias;
  const r = /^\/api\/clients\/[^/]+\/(mural|history|tasks|captures)$/.exec(url.pathname)?.[1];
  if (id === 'cx-21' && !vazias) {
    if (r === 'tasks') return { ok: true, tasks: DEMANDAS_DENSAS };
    if (r === 'mural') return { ok: true, notes: NOTAS_SOBREPOSTAS };
  }
  if (r === 'tasks') {
    const arquivadas = url.searchParams.get('archived') === '1';
    return { ok: true, tasks: cheia ? [...DEMANDAS, ...(arquivadas ? [ARQUIVADA] : [])] : [] };
  }
  if (r === 'captures') return { ok: true, captures: cheia ? CAPTACOES : [] };
  if (r === 'mural') return { ok: true, notes: cheia ? NOTAS : [] };
  if (r === 'history') return { ok: true, events: cheia ? REGISTROS : [] };
  return null;
}

export const comFichas = ({ pedidos, atraso, recusar, escritas, vazias = false } = {}) => async (url, req) => {
  const p = url.pathname;
  const m = /^\/api\/clients\/([^/]+)$/.exec(p);
  if (m && req.method() === 'GET' && FICHAS[m[1]]) {
    pedidos?.push({ id: m[1], month: url.searchParams.get('month'), from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    const ms = atraso?.(url) ?? 0;
    if (ms) await pause(ms);
    return { body: { ok: true, client: ficha(m[1], url) } };
  }
  if (req.method() !== 'GET') escritas?.push({ metodo: req.method(), url: url.pathname, corpo: req.postDataJSON?.() ?? null });
  const r = recusar?.(url, req);
  if (r) return r;
  if (p === '/api/clients' && req.method() === 'GET') {
    return {
      body: {
        ok: true, from: url.searchParams.get('from'), to: url.searchParams.get('to'), months: [`${MES_ATUAL}-01`],
        clients: CARTEIRA, conferencia: { clientesSemLista: [], listasSemCliente: [] },
      },
    };
  }
  if (/^\/api\/clients\/[^/]+\/form$/.test(p)) return { body: { ok: true, client: FORM } };
  // F42, Fase 3: a aprovação externa (dentro de "Dados do cliente", só admin).
  // Desligada e sem link: a forma da rota real, para o bloco não cair no genérico.
  const aprovacao = /^\/api\/clients\/([^/]+)\/approval$/.exec(p);
  if (aprovacao && req.method() === 'GET')
    return { body: { ok: true, approval: { clientId: aprovacao[1], enabled: false, active: true, link: null } } };
  if (p === '/api/meta/accounts') return { body: { ok: true, hasToken: false, accounts: [] } };
  // As áreas internas (F11C).
  const idDaArea = /^\/api\/clients\/([^/]+)\/(mural|history|tasks|captures)$/.exec(p)?.[1];
  if (idDaArea && req.method() === 'GET') return { body: areaDe(idDaArea, url, vazias) };
  if (p === '/api/calendar') return { body: { ok: true, entries: calendario(url) } };
  if (p === '/api/team') return { body: { ok: true, team: EQUIPE, me: 'u-ana' } };
  if (p === '/api/history/documents/doc-ok/url')
    return { body: { ok: true, url: 'https://example.invalid/assinado/ata', expiresAt: emDias(1), fileName: 'ata-da-reuniao.pdf', contentType: 'application/pdf' } };
  if (p === '/api/history/documents/doc-falha/url')
    return { status: 403, body: { ok: false, message: 'Este documento não está ao seu alcance (simulado).' } };
  if (req.method() !== 'GET' && /^\/api\/(items|tasks|captures|mural|history)\//.test(p)) return { body: { ok: true } };
  if (req.method() === 'POST' && /^\/api\/clients\//.test(p)) return { body: { ok: true } };
  return null;
};

/* ─────────────────────────── leitura da tela ─────────────────────────── */

const esperarFicha = (page, nome) =>
  page.waitForFunction((n) => document.querySelector('h1')?.textContent?.trim() === n, nome, { timeout: 8000 });

const topoDe = (page, seletor) =>
  page.locator(seletor).first().evaluate((el) => Math.round(el.getBoundingClientRect().top));

const semRolagemLateral = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const abaSelecionada = (page) =>
  page.locator('[role="tablist"][aria-label="Áreas do cliente"] [aria-selected="true"]').textContent();

/** O botão que abre "Dados do cliente": a linha no desktop, "Dados" no celular. */
const botaoDosDados = (page) => page.locator('.cl-dados-alternar:visible, .cl-dados-botao:visible').first();

const parametros = (page) => Object.fromEntries(new URL(page.url()).searchParams);

const errosReais = (erros) => erros.filter((e) => !/chat\/live|WebSocket|Failed to load resource/i.test(e));

export default async function (browser) {
  const { cenario, resultados } = criarSuite(browser);
  const CAPTURAS = process.env.CLIENTE_CAPTURAS ?? '';

  await cenario('CX1', 'celular 390×844: áreas antes de 35% e primeiro item na primeira tela; cadastro a um clique', async (abrir) => {
    const { page, erros } = await abrir({ custom: comFichas(), viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    const areas = await topoDe(page, '.cl-areas');
    assert.ok(areas < 844 * 0.35, `áreas em y=${areas} (meta < ${Math.round(844 * 0.35)})`);
    const item = await topoDe(page, '#cl-area ul li');
    assert.ok(item < 844 - 40, `primeiro item em y=${item} (meta: dentro dos 844)`);
    assert.ok(await semRolagemLateral(page), 'sem rolagem lateral');
    // Urgência com a palavra escrita (no celular, a lista), e não só o ícone.
    const urg = page.getByRole('combobox', { name: 'Urgência' });
    assert.equal(await urg.inputValue(), 'perigo');
    assert.equal((await urg.locator('option:checked').textContent()).trim(), 'Crítico');
    // O cadastro inteiro está a um clique ("Dados", no cabeçalho).
    const alternar = page.getByRole('button', { name: 'Dados', exact: true });
    assert.equal(await alternar.getAttribute('aria-expanded'), 'false');
    await alternar.click();
    const painel = page.locator('#cl-dados-painel');
    for (const texto of ['Contrato', 'Cota vigente', 'Contato', 'Links', 'Observações', 'Contas da Meta', 'Responsável de demonstração', 'Pasta de materiais']) {
      await painel.getByText(texto, { exact: false }).first().waitFor();
    }
    await painel.getByRole('button', { name: 'Ligar conta' }).waitFor();
    assert.ok(await semRolagemLateral(page), 'aberto também sem rolagem lateral');
    assert.deepEqual(errosReais(erros), []);
    // Nome em duas linhas: ainda antes de 35% (a folga da compactação). Os
    // dados fecham antes — a escolha fica lembrada no navegador.
    await alternar.click();
    await page.goto(BASE + '/cliente/cx-21');
    await esperarFicha(page, FICHAS['cx-21'].name);
    const linhas = await page.locator('h1').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    assert.equal(linhas, 2, `o nome de teste ocupa ${linhas} linhas`);
    const areas2 = await topoDe(page, '.cl-areas');
    assert.ok(areas2 < 844 * 0.35, `nome em 2 linhas: áreas em y=${areas2} (meta < ${Math.round(844 * 0.35)})`);
    return `áreas y=${areas} (${Math.round((areas / 844) * 100)}%), 1º item y=${item}; nome em 2 linhas: áreas y=${areas2}`;
  });

  await cenario('CX-RITUAL', 'ciclo do mês: quem não administra vê os botões desligados com o porquê; o administrador, como antes', async (abrir) => {
    const semAdmin = { ok: true, userId: 'u-bia', email: 'equipe@example.invalid', isSuperadmin: false, isSuper: false, papel: 'funcionario', areas: ['entrega'] };
    const escritas = [];
    const comoEquipe = (url, req) => (url.pathname === '/api/auth/me' ? { body: semAdmin } : comFichas({ escritas })(url, req));
    const ritual = (page) => page.locator('.cl-ritual');
    const { page, erros } = await abrir({ custom: comoEquipe });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    await ritual(page).locator('.cl-ritual-motivo').waitFor();
    assert.equal((await ritual(page).locator('.cl-ritual-motivo').textContent()).trim(), 'Só um administrador marca.');
    assert.equal(await page.getByRole('button', { name: 'Mês planejado', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Registrar aprovação do cliente', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Registrar aprovação do cliente', exact: true }).click({ force: true });
    await pause(300);
    assert.deepEqual(escritas.filter((e) => /months/.test(e.url)), [], 'nada sai para o servidor');
    // Mês não aberto: o botão de abrir também, com a frase do servidor.
    await page.goto(BASE + '/cliente/cx-2');
    await esperarFicha(page, 'Aurora Mercado');
    await ritual(page).getByText('Só um administrador abre o mês.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Abrir o mês', exact: true }).isDisabled(), true);
    assert.deepEqual(errosReais(erros), []);

    // 390: o porquê desce para a linha de baixo, sem empurrar a página de lado.
    const cel = await abrir({ custom: comoEquipe, viewport: { width: 390, height: 844 } });
    await cel.page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(cel.page, 'Horizonte Studio');
    await ritual(cel.page).locator('.cl-ritual-motivo').waitFor();
    assert.ok(await cel.page.locator('.cl-ritual-motivo').isVisible(), 'o porquê fica à vista no celular');
    assert.ok(await semRolagemLateral(cel.page), '390 sem rolagem lateral');

    // O administrador (a sessão padrão): nenhuma frase, botões ligados — como antes.
    const adm = await abrir({ custom: comFichas() });
    await adm.page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(adm.page, 'Horizonte Studio');
    await adm.page.getByRole('button', { name: 'Mês planejado', exact: true }).waitFor();
    assert.equal(await adm.page.getByRole('button', { name: 'Mês planejado', exact: true }).isDisabled(), false);
    assert.equal(await adm.page.locator('.cl-ritual-motivo').count(), 0);
    return 'equipe: desligados com o porquê (marcar e abrir); admin: igual a antes';
  });

  await cenario('CX2', '1440×900: áreas e primeiro item na primeira tela; cota vigente ≠ contratado do mês', async (abrir) => {
    const { page } = await abrir({ custom: comFichas() });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    const areas = await topoDe(page, '.cl-areas');
    const item = await topoDe(page, '#cl-area ul li');
    assert.ok(areas < 900 * 0.35, `áreas em y=${areas}`);
    assert.ok(item < 900 * 0.6, `primeiro item em y=${item}`);
    const urg = page.getByRole('group', { name: 'Urgência' });
    assert.equal(await urg.getByRole('button', { name: 'Crítico' }).getAttribute('aria-pressed'), 'true');
    const linha = page.getByRole('button', { name: /^Dados do cliente/ });
    assert.match(await linha.textContent(), /Full.*renova.*7d.*contato@example\.invalid.*Meta: nenhuma conta ligada.*observações/);
    // Contratado congelado do mês (3/6/5/2) na régua; cota vigente (4/8/6/2) nos dados.
    const regua = page.locator('.cl-tipos');
    assert.match(await regua.getAttribute('aria-label'), new RegExp(`^Contratado em ${nomeDoMes(MES_ATUAL)}$`));
    assert.match((await regua.textContent()).replace(/\s+/g, ' '), /Vídeos\s*\d+\/3.*Artes\s*\d+\/6.*Fotos\s*\d+\/5/);
    await linha.click();
    const cota = (await page.locator('.cl-cota').textContent()).replace(/\s+/g, '');
    assert.equal(cota, '4Vídeos8Artes6Fotos2ADS', `cota vigente = ${cota}`);
    return `áreas y=${areas}, 1º item y=${item}; congelado 3/6/5/2 × vigente 4/8/6/2`;
  });

  await cenario('CX3', 'o endereço reproduz área, competência e período; trocar de área mantém o resto', async (abrir) => {
    const pedidos = [];
    const { page } = await abrir({ custom: comFichas({ pedidos }) });
    await page.goto(BASE + '/cliente/cx-1?area=semanal&mes=2026-06&de=2026-06-11&ate=2026-06-14');
    await esperarFicha(page, 'Horizonte Studio');
    assert.equal(await abaSelecionada(page), 'Semanal');
    assert.equal((await page.locator('.cl-mes-nome').textContent()).trim(), 'Junho de 2026');
    const ultimo = pedidos.at(-1);
    assert.deepEqual(
      { month: ultimo.month, from: ultimo.from, to: ultimo.to },
      { month: '2026-06-01', from: '2026-06-11', to: '2026-06-15' },
      'o pedido leva competência e período (fim exclusivo)',
    );
    await page.getByRole('tab', { name: 'Conteúdos' }).click();
    await page.waitForURL((u) => !u.search.includes('area='));
    assert.deepEqual(parametros(page), { mes: '2026-06', de: '2026-06-11', ate: '2026-06-14' });
    // Só os itens do período (11–14/08): quatro linhas agendadas.
    // (F11C: a lista dos agendados tem nome — a dos sem-data mora num grupo próprio.)
    await page.waitForFunction(() => document.querySelectorAll('#cl-area ul[aria-label="Agendados"] li').length === 4);
    await page.getByRole('button', { name: 'Próxima competência' }).click();
    await page.waitForURL(/mes=2026-07/);
    assert.equal(parametros(page).de, '2026-06-11', 'mudar a competência não mexe no período (dois controles)');
    await page.getByRole('tab', { name: 'Mural' }).click();
    await page.waitForURL(/area=mural/);
    assert.equal(parametros(page).mes, '2026-07');
    // Recarregar reproduz.
    await page.reload();
    await esperarFicha(page, 'Horizonte Studio');
    assert.equal(await abaSelecionada(page), 'Mural');
    assert.equal((await page.locator('.cl-mes-nome').textContent()).trim(), 'Julho de 2026');
    // Inválido vira padrão sem derrubar o resto.
    await page.goto(BASE + '/cliente/cx-1?area=banana&mes=2026-13&de=2026-02-31&ate=2026-03-02');
    await esperarFicha(page, 'Horizonte Studio');
    assert.equal(await abaSelecionada(page), 'Conteúdos');
    assert.equal((await page.locator('.cl-mes-nome').textContent()).trim(), nomeDoMes(MES_ATUAL));
    assert.equal(pedidos.at(-1).from, null, 'período impossível = mês inteiro');
    return 'deep link, troca de área, recarga e normalização';
  });

  await cenario('CX4', 'voltar do Painel conserva o recorte, depois de trocar área, mês e cliente', async (abrir) => {
    const { page } = await abrir({ custom: comFichas() });
    const recorte = '?urgencia=perigo&ordem=nome';
    await page.goto(BASE + '/painel' + recorte);
    await page.getByRole('link', { name: /^Abrir Horizonte Studio/ }).click();
    await esperarFicha(page, 'Horizonte Studio');
    await page.getByRole('tab', { name: 'Checklist' }).click();
    await page.waitForURL(/area=checklist/);
    await page.getByRole('button', { name: 'Competência anterior' }).click();
    await page.waitForURL(/mes=/);
    await page.getByRole('button', { name: 'Próximo cliente' }).click();
    await esperarFicha(page, 'Aurora Mercado');
    assert.equal(parametros(page).area, 'checklist', 'o vizinho abre na mesma área');
    assert.ok(parametros(page).mes, 'e na mesma competência');
    await page.getByRole('navigation', { name: 'Trilha' }).getByRole('link', { name: 'Painel', exact: true }).click();
    await page.waitForURL(/\/painel/);
    assert.equal(new URL(page.url()).search, recorte, 'o degrau Painel leva ao recorte');
    // O VOLTAR do navegador: da ficha para o painel filtrado.
    await page.goBack();
    await esperarFicha(page, 'Aurora Mercado');
    assert.equal(parametros(page).area, 'checklist', 'voltar à ficha reproduz a área');
    return `degrau Painel → /painel${recorte}`;
  });

  await cenario('CX5', 'editar o cadastro: foco volta a quem abriu, contexto fica, rascunho é oferecido', async (abrir) => {
    const { page } = await abrir({ custom: comFichas() });
    await page.goto(BASE + '/cliente/cx-1?area=mural');
    await esperarFicha(page, 'Horizonte Studio');
    await page.getByRole('button', { name: 'Editar cadastro' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Editar cliente' });
    const nome = dialogo.getByLabel('Nome do cliente *');
    await nome.waitFor();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] input')?.value === 'Horizonte Studio');
    await nome.fill('Horizonte Studio — nome em edição');
    await pause(1200);
    await page.keyboard.press('Escape');
    await dialogo.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('Editar cadastro'));
    assert.equal(parametros(page).area, 'mural', 'fechar o cadastro não mexe no contexto');
    assert.equal(await abaSelecionada(page), 'Mural');
    await page.getByRole('button', { name: 'Editar cadastro' }).click();
    await dialogo.getByRole('button', { name: 'Recuperar rascunho' }).click();
    assert.equal(await nome.inputValue(), 'Horizonte Studio — nome em edição');
    return 'Esc → foco em "Editar cadastro"; rascunho recuperado';
  });

  await cenario('CX6', 'pedidos atrasados: a resposta velha não substitui cliente nem mês novos', async (abrir) => {
    // Lentos: o cliente cx-1 (qualquer mês) e fevereiro de 2026 de qualquer cliente.
    const lento = (url) =>
      url.pathname.endsWith('/cx-1') || url.searchParams.get('month') === '2026-02-01' ? 1500 : 0;
    const { page } = await abrir({ custom: comFichas({ atraso: lento }) });
    // (a) cliente: de cx-2 ao anterior (cx-1, lento) e de volta antes de ele chegar.
    await page.goto(BASE + '/cliente/cx-2');
    await esperarFicha(page, 'Aurora Mercado');
    await page.getByRole('button', { name: 'Cliente anterior' }).click();
    await page.waitForURL(/\/cliente\/cx-1/);
    await page.goBack();
    await esperarFicha(page, 'Aurora Mercado');
    await pause(2000); // a resposta de cx-1 chega agora
    assert.equal((await page.locator('h1').textContent()).trim(), 'Aurora Mercado', 'cx-1 atrasado não pintou cx-2');
    assert.match(page.url(), /\/cliente\/cx-2/);
    // (b) mês: janeiro (rápido) → fevereiro (lento) → março (rápido), sem esperar.
    await page.goto(BASE + '/cliente/cx-3?mes=2026-01');
    await esperarFicha(page, 'Instituto Vila Nova');
    await page.getByRole('button', { name: 'Próxima competência' }).click();
    await page.waitForURL(/mes=2026-02/);
    await page.getByRole('button', { name: 'Próxima competência' }).click();
    await page.waitForURL(/mes=2026-03/);
    await pause(2200); // fevereiro chega agora
    assert.equal((await page.locator('.cl-mes-nome').textContent()).trim(), 'Março de 2026');
    const item = await page.locator('#cl-area ul li').first().textContent();
    assert.ok(item.includes('2026-03'), `o item na tela (${item.trim()}) é de março, não de fevereiro`);
    assert.equal(await page.locator('.cl-resumo').getAttribute('aria-busy'), null, 'nada ficou "carregando"');
    return 'cliente e mês: nenhuma resposta velha pintou a ficha';
  });

  await cenario('CX7', 'sem contrato, inativo e nome/observações longos', async (abrir) => {
    const { page } = await abrir({ custom: comFichas(), viewport: { width: 390, height: 844 } });
    // Sem contrato: travessão com o motivo, "Abrir o mês" à mão; áreas ainda no alto.
    await page.goto(BASE + '/cliente/cx-2');
    await esperarFicha(page, 'Aurora Mercado');
    await page.getByRole('button', { name: 'Abrir o mês', exact: true }).waitFor();
    assert.match(await page.locator('.cl-entrega').textContent(), /Mês ainda não aberto/);
    assert.equal(await page.locator('.cl-tipos').count(), 0, 'sem régua de contratado quando não há contrato');
    const areas = await topoDe(page, '.cl-areas');
    assert.ok(areas < 844 * 0.35, `sem contrato: áreas em y=${areas}`);
    assert.match(await page.locator('.cl-dados-resumo').textContent(), /sem plano/);
    // Inativo: dito junto do nome e reativável em Dados do cliente.
    await page.goto(BASE + '/cliente/cx-13');
    await esperarFicha(page, 'Antiga Papelaria');
    await page.locator('.o-topo .o-selo', { hasText: 'Inativo desde 31/03/2026' }).waitFor();
    await botaoDosDados(page).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Ativo' }).isChecked(), false);
    assert.match(await page.locator('.cl-dados-resumo').textContent(), /vencido/);
    // Nome e observações longos: nada corta, nada rola de lado; texto inteiro a um clique.
    await page.goto(BASE + '/cliente/cx-20');
    await esperarFicha(page, FICHAS['cx-20'].name);
    assert.ok(await semRolagemLateral(page), 'nome longo sem rolagem lateral');
    const dados = botaoDosDados(page);
    if ((await dados.getAttribute('aria-expanded')) !== 'true') await dados.click();
    const obs = page.locator('#cl-observacoes');
    assert.equal(await obs.getAttribute('data-recolhida'), 'true');
    await page.getByRole('button', { name: 'Mostrar observações inteiras' }).click();
    assert.equal(await obs.getAttribute('data-recolhida'), null);
    assert.equal(await obs.textContent(), LONGO, 'o texto inteiro, com as quebras de linha');
    assert.ok(await semRolagemLateral(page), 'observações abertas sem rolagem lateral');
    return `sem contrato: áreas y=${areas}; inativo com selo; longo sem corte`;
  });

  await cenario('CX8', 'acesso parcial: a recusa do servidor aparece e fica na tela', async (abrir) => {
    const recusar = (url, req) =>
      req.method() === 'POST' && url.pathname.endsWith('/flags')
        ? { status: 403, body: { ok: false, message: 'Só quem cuida deste cliente muda a urgência (simulado).' } }
        : null;
    const { page } = await abrir({ custom: comFichas({ recusar }) });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    await page.getByRole('group', { name: 'Urgência' }).getByRole('button', { name: 'Em dia' }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'Só quem cuida deste cliente' });
    await aviso.waitFor();
    await pause(800); // a releitura já passou
    assert.equal(await aviso.count(), 1, 'a frase do servidor continua depois da releitura');
    assert.equal(
      await page.getByRole('group', { name: 'Urgência' }).getByRole('button', { name: 'Crítico' }).getAttribute('aria-pressed'),
      'true',
      'a urgência não mudou',
    );
    return 'recusa visível após a releitura';
  });

  await cenario('CX9', 'teclado nas áreas: setas e Home/End trocam a área e o endereço', async (abrir) => {
    const { page } = await abrir({ custom: comFichas() });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    await page.getByRole('tab', { name: 'Conteúdos' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/area=calendario/);
    await page.keyboard.press('End');
    await page.waitForURL(/area=historico/);
    await page.keyboard.press('ArrowRight');
    await page.waitForURL((u) => !u.search.includes('area='));
    assert.equal(await abaSelecionada(page), 'Conteúdos');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'tab');
    return '→ Calendário, End → Histórico, → volta a Conteúdos';
  });

  /* ─────────────────────────── F11C — as áreas internas ─────────────────────────── */

  const irParaArea = async (page, nome) => {
    await page.getByRole('tab', { name: nome, exact: true }).click();
    await page.waitForFunction((n) => document.querySelector('[role="tablist"][aria-label="Áreas do cliente"] [aria-selected="true"]')?.textContent?.trim() === n, nome);
  };
  const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  await cenario('CX10', 'Conteúdos, Semanal e Calendário: mesmos itens nos mesmos dias; extra e sem-data uma vez; cada caixa se chama pelo item', async (abrir) => {
    const escritas = [];
    const { page, erros } = await abrir({ custom: comFichas({ escritas }) });
    await page.goto(BASE + '/cliente/cx-1');
    await esperarFicha(page, 'Horizonte Studio');
    const esperados = [...itens(MES_ATUAL), semDia(MES_ATUAL)];

    // Conteúdos: uma caixa por item do mês, cada uma com nome único (tipo, título, dia).
    const caixas = page.locator('#cl-area input[type="checkbox"]');
    await page.waitForFunction((n) => document.querySelectorAll('#cl-area input[type="checkbox"]').length === n, esperados.length);
    const nomes = await caixas.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    assert.equal(new Set(nomes).size, nomes.length, `nomes repetidos: ${nomes.join(' | ')}`);
    assert.ok(nomes.includes(`Vídeo “Peça 1 de ${MES_ATUAL}”, dia 10/${MES_ATUAL.slice(5)}`), nomes[0]);
    assert.ok(nomes.includes(`Arte “Extra de ${MES_ATUAL}”, dia 20/${MES_ATUAL.slice(5)}, extra`));
    assert.ok(nomes.includes('Vídeo “Sem data”, sem data'));
    assert.ok(!nomes.some((n) => /^marcar /.test(n)), 'o nome "marcar Vídeo" acabou');
    // Tocar no TÍTULO marca (a linha inteira é o rótulo) — e marca o item certo.
    await page.locator('.cl-conteudo', { hasText: `Peça 4 de ${MES_ATUAL}` }).locator('.cl-conteudo-titulo').click();
    await pause(300);
    assert.ok(escritas.some((e) => e.metodo === 'POST' && e.url === `/api/items/it-${MES_ATUAL}-3/completion`), JSON.stringify(escritas));

    // Semanal: as mesmas pastilhas, com os mesmos nomes, uma vez cada.
    await irParaArea(page, 'Semanal');
    await page.locator('.cl-pastilha-dia').first().waitFor();
    const pastilhas = await page.locator('.cl-pastilha-dia').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const comDia = nomes.filter((n) => !n.endsWith('sem data'));
    assert.deepEqual([...pastilhas].sort(), [...comDia].sort(), 'mesmos itens com dia em Conteúdos e Semanal');
    const semDiaNaSemanal = await page.locator('#cl-sem-dia button[aria-label^="Escolher o dia"]').count();
    assert.equal(semDiaNaSemanal, 1, 'o sem-data aparece uma vez, na fila');

    // Calendário: cada item com dia no mesmo dia; o compromisso não é conteúdo.
    await irParaArea(page, 'Calendário');
    await page.getByText(`Peça 1 de ${MES_ATUAL}`, { exact: false }).first().waitFor();
    const noCalendario = await page.evaluate(() =>
      [...document.querySelectorAll('#cl-area li > button, #cl-area li > span')].map((el) => {
        const casa = el.closest('li')?.parentElement?.parentElement;
        const marcar = casa?.querySelector('[aria-label^="Marcar no dia"]')?.getAttribute('aria-label') ?? '';
        return { texto: el.textContent.trim(), dia: marcar.replace('Marcar no dia ', '') };
      }),
    );
    for (const i of itens(MES_ATUAL)) {
      const achados = noCalendario.filter((x) => x.texto.includes(i.title));
      assert.equal(achados.length, 1, `${i.title} aparece ${achados.length}× no calendário`);
      assert.equal(Number(achados[0].dia), Number(i.scheduledAt.slice(8, 10)), `${i.title} no dia ${achados[0].dia}`);
    }
    assert.equal(noCalendario.filter((x) => x.texto.includes('Reunião de pauta')).length, 1, 'o compromisso está no calendário');
    assert.ok(!nomes.some((n) => n.includes('Reunião de pauta')), 'e não em Conteúdos');
    assert.deepEqual(errosReais(erros), []);
    return `${nomes.length} itens em Conteúdos = ${pastilhas.length} com dia na Semanal + 1 sem dia; calendário nos mesmos dias`;
  });

  await cenario('CX11', 'Checklist: grupos, resumo sem arquivadas, editar no lugar e rascunho mantido na recusa', async (abrir) => {
    const escritas = [];
    const recusar = (url, req) =>
      req.method() === 'PUT' && url.pathname === '/api/tasks/t-em-dia'
        ? { status: 500, body: { ok: false, message: 'O servidor recusou a gravação (simulado).' } }
        : null;
    const { page, erros } = await abrir({ custom: comFichas({ escritas, recusar }), viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/cliente/cx-1?area=checklist');
    await esperarFicha(page, 'Horizonte Studio');
    const resumo = page.locator('.cl-resumo-area');
    await resumo.waitFor();
    const antes = (await resumo.textContent()).replace(/\s+/g, ' ');
    assert.match(antes, /4 pendentes.*1 atrasada.*1 vence hoje.*1 concluída/);
    const grupos = await page.locator('#cl-area .cl-grupo-titulo').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.deepEqual(grupos, ['Pendentes 4', 'Concluídas 1']);
    // A atrasada vem primeiro, e a caixa diz de qual demanda é.
    const primeira = page.locator('#cl-area .cl-lista').first().locator('input[type="checkbox"]').first();
    assert.match(await primeira.getAttribute('aria-label'), /^Concluir “Aprovar roteiro institucional”, prazo /);
    // Ver arquivadas: grupo próprio, por último; o resumo NÃO muda.
    await page.getByRole('button', { name: 'Ver arquivadas' }).click();
    await page.locator('#cl-area .cl-grupo-titulo', { hasText: 'Arquivadas' }).waitFor();
    assert.equal((await resumo.textContent()).replace(/\s+/g, ' '), antes, 'o resumo não conta arquivadas');
    const ultimo = await page.locator('#cl-area .cl-grupo-titulo').last().textContent();
    assert.match(ultimo, /^Arquivadas/);
    // Editar abre NO LUGAR da demanda; a recusa deixa o texto e o formulário.
    await page.getByRole('button', { name: 'Editar “Revisar legendas”' }).click();
    const form = page.getByRole('form', { name: 'Editar a demanda “Revisar legendas”' });
    await form.waitFor();
    assert.equal(await page.locator('li.cl-linha-form form').count(), 1, 'formulário dentro da lista');
    await form.getByLabel('O que precisa ser feito *').fill('Revisar legendas — versão final');
    await form.getByRole('button', { name: 'Salvar' }).click();
    // A recusa aparece no lugar da demanda, junto do formulário.
    await page.locator('li.cl-linha-form').getByRole('alert').filter({ hasText: 'O servidor recusou' }).waitFor();
    assert.equal(await form.getByLabel('O que precisa ser feito *').inputValue(), 'Revisar legendas — versão final', 'rascunho mantido');
    assert.ok(await semRolagemLateral(page));
    assert.deepEqual(errosReais(erros).filter((e) => !/500/.test(e)), []);
    return `${antes.trim()}; arquivadas por último; recusa com rascunho aberto`;
  });

  await cenario('CX11b', 'Checklist: concluída e arquivada à noite dizem o dia de São Paulo, não o dia UTC', async (abrir) => {
    // 08/10 às 22h30 de Brasília = 09/10 às 01h30 em UTC; 31/10 às 22h = 01/11 01h UTC.
    const noite = [
      demanda({ id: 't-noite', title: 'Fechar a pauta à noite', completedAt: '2026-10-09T01:30:00.000Z', completedBy: ANA }),
      demanda({ id: 't-arq-noite', title: 'Campanha do fim do mês', archivedAt: '2026-11-01T01:00:00.000Z' }),
    ];
    const base = comFichas();
    const { page } = await abrir({
      custom: (url, req) =>
        /^\/api\/clients\/cx-1\/tasks$/.test(url.pathname) && req.method() === 'GET'
          ? { body: { ok: true, tasks: noite } }
          : base(url, req),
    });
    await page.goto(BASE + '/cliente/cx-1?area=checklist');
    await esperarFicha(page, 'Horizonte Studio');
    // As concluídas vêm recolhidas: abrir o grupo antes de ler a linha.
    await page.getByRole('button', { name: /^Concluídas 1/ }).click();
    const feita = page.locator('#cl-area .cl-linha', { hasText: 'Fechar a pauta à noite' });
    await feita.getByText('por Ana Demo · 08/10/2026', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Ver arquivadas' }).click();
    const arquivada = page.locator('#cl-area .cl-linha', { hasText: 'Campanha do fim do mês' });
    await arquivada.getByText('arquivada 31/10/2026', { exact: true }).waitFor();
    const tudo = (await page.locator('#cl-area').textContent()).replace(/\s+/g, ' ');
    assert.doesNotMatch(tudo, /09\/10\/2026|01\/11\/2026/, 'nenhum dia UTC no Checklist');
  });

  await cenario('CX12', 'Semanal: atalho de cada semana e do "sem dia" leva até lá e dá foco', async (abrir) => {
    const { page } = await abrir({ custom: comFichas(), viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/cliente/cx-1?area=semanal');
    await esperarFicha(page, 'Horizonte Studio');
    const nav = page.getByRole('navigation', { name: 'Ir para a semana' });
    await nav.waitFor();
    const atalhos = await nav.getByRole('button').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.ok(atalhos.length >= 5, atalhos.join(' | '));
    assert.ok(atalhos.some((a) => /a fazer/.test(a)), 'uma semana com pendência se vê no atalho');
    assert.ok(atalhos.some((a) => /^Sem dia 1$/.test(a)), atalhos.join(' | '));
    assert.ok(atalhos.every((a) => !/^Semana \d\d/.test(a)), 'número da semana e intervalo não se colam no nome');
    assert.equal(await nav.locator('[aria-current="date"]').count(), 1, 'a semana de hoje acende');
    await nav.getByRole('button', { name: /^Sem dia/ }).click();
    await page.waitForFunction(() => document.activeElement?.id === 'cl-sem-dia');
    // A rolagem é suave (sem `prefers-reduced-motion`): espera ela assentar.
    await page.waitForFunction(() => {
      const y = document.getElementById('cl-sem-dia').getBoundingClientRect().top;
      return y >= 0 && y < window.innerHeight;
    });
    const topo = await topoDe(page, '#cl-sem-dia');
    assert.ok(topo >= 0 && topo < 844, `a fila sem dia ficou à vista (y=${topo})`);
    const ultima = atalhos.filter((a) => a.startsWith('Semana')).length;
    await nav.getByRole('button', { name: new RegExp(`^Semana ${ultima}\\b`) }).click();
    await page.waitForFunction((n) => document.activeElement?.id === `cl-semana-${n}`, ultima);
    return atalhos.join(' | ');
  });

  await cenario('CX13', 'Captação: o mês que conta separado; data, quem e estado; recusa mantém o rascunho', async (abrir) => {
    const recusar = (url, req) =>
      req.method() === 'POST' && url.pathname.endsWith('/captures')
        ? { status: 500, body: { ok: false, message: 'Não deu para registrar agora (simulado).' } }
        : null;
    const { page } = await abrir({ custom: comFichas({ recusar }) });
    await page.goto(BASE + '/cliente/cx-1?area=captacao');
    await esperarFicha(page, 'Horizonte Studio');
    const resumo = page.locator('.cl-resumo-area');
    await resumo.waitFor();
    // 2 + 1 vídeos neste mês; o de mês passado (3) não entra. Cota congelada: 3.
    assert.match((await resumo.textContent()).replace(/\s+/g, ' '), new RegExp(`3/3 vídeos captados em ${nomeDoMes(MES_ATUAL)}.*cota do mês captada.*1 aguardando edição`));
    const grupos = await page.locator('#cl-area .cl-grupo-titulo').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    assert.match(grupos[0], new RegExp(`^Em ${nomeDoMes(MES_ATUAL)} 2`));
    assert.match(grupos[1], /^Outros meses 1 · não contam/);
    const linha = page.locator('#cl-area .cl-linha').first();
    assert.match((await linha.textContent()).replace(/\s+/g, ' '), new RegExp(`08/${MES_ATUAL.slice(5)}.*2 vídeos.*Em edição.*captado por Ana Demo.*45 min`));
    await page.getByRole('button', { name: `Editar a gravação de 08/${MES_ATUAL.slice(5)}/${MES_ATUAL.slice(0, 4)}, 2 vídeos` }).waitFor();
    // Registrar com recusa: o formulário e o que foi escrito ficam.
    await page.getByRole('button', { name: 'Registrar gravação' }).first().click();
    const form = page.getByRole('form', { name: 'Registrar gravação' });
    await form.getByLabel('Roteiro').fill('Roteiro que não pode sumir');
    await form.getByRole('button', { name: 'Registrar' }).click();
    await page.locator('.cl-form-novo').getByRole('alert').filter({ hasText: 'Não deu para registrar' }).waitFor();
    assert.equal(await form.getByLabel('Roteiro').inputValue(), 'Roteiro que não pode sumir');
    return grupos.join(' | ');
  });

  await cenario('CX14', 'Mural: lista no celular, texto sem posição, quadro com posições, alça pelas setas', async (abrir) => {
    const s = await abrir({ custom: comFichas(), viewport: { width: 390, height: 844 } });
    const { page, writes } = s;
    await page.goto(BASE + '/cliente/cx-1?area=mural');
    await esperarFicha(page, 'Horizonte Studio');
    // Celular: a lista é a forma padrão; as três notas, na ordem de leitura.
    const lista = page.getByRole('list', { name: 'Notas do mural' });
    await lista.waitFor();
    const titulos = await lista.locator('input').evaluateAll((els) => els.map((e) => e.value));
    assert.deepEqual(titulos, ['Tom de voz', 'Referências', 'Combinados']);
    assert.ok(await semRolagemLateral(page), 'lista sem rolagem lateral (a nota em x=640 não corta)');
    // Editar o texto pela lista: grava SÓ o texto.
    const texto = page.getByRole('textbox', { name: 'Texto da nota “Referências”' });
    await texto.fill('Paleta da campanha de primavera.\nFotos com luz natural.');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click(); // trocar de forma tira o foco: grava
    await page.waitForFunction(() => document.querySelector('.cl-mural-plano'));
    const escrita = writes.find((w) => w.url === '/api/mural/n-2');
    assert.deepEqual(escrita?.body, { content: 'Paleta da campanha de primavera.\nFotos com luz natural.' }, JSON.stringify(writes));
    // Quadro: posições preservadas, o texto novo junto; rola dentro de si.
    const pos = await page.locator('.cl-mural-plano > div').evaluateAll((els) => els.map((e) => [e.style.left, e.style.top]));
    assert.deepEqual(pos, [['16px', '16px'], ['260px', '40px'], ['640px', '500px']]);
    assert.equal(await page.getByRole('textbox', { name: 'Texto da nota “Referências”' }).inputValue(), 'Paleta da campanha de primavera.\nFotos com luz natural.');
    const quadro = await page.locator('.cl-mural-quadro').evaluate((el) => ({ rola: el.scrollWidth > el.clientWidth, toque: getComputedStyle(el.firstElementChild).touchAction }));
    assert.ok(quadro.rola, 'o quadro rola de lado dentro de si');
    assert.notEqual(quadro.toque, 'none', 'o fundo do quadro deixa o dedo rolar a página');
    // A alça pelas setas: move e grava SÓ a posição, uma vez.
    const alca = page.getByRole('button', { name: /^Mover a nota “Tom de voz”/ });
    await alca.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await pause(900);
    const movidas = writes.filter((w) => w.url === '/api/mural/n-1');
    assert.deepEqual(movidas.map((w) => w.body), [{ positionX: 32, positionY: 64 }], JSON.stringify(movidas));
    // A lista não grava posição; voltar a ela mantém a ordem.
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    await lista.waitFor();
    assert.equal(writes.filter((w) => w.body && 'positionX' in w.body).length, 1, 'nenhuma posição gravada pela troca de forma');
    // O vazio não sugere guardar senha.
    await page.goto(BASE + '/cliente/cx-3?area=mural');
    await esperarFicha(page, 'Instituto Vila Nova');
    const vazio = page.locator('#cl-area [data-estado="vazio"]');
    await vazio.waitFor();
    assert.doesNotMatch(await vazio.textContent(), /senha/i);
    return `lista ${titulos.join(', ')}; texto só com {content}; alça → {32,64}`;
  });

  await cenario('CX14b', 'Mural: arrastar a nota até a borda grava posição INTEIRA, mesmo com o quadro medindo em fração', async (abrir) => {
    // O quadro de 777,5 px dá `777,5 − largura da nota` na borda direita; a coluna é
    // `integer` e o banco recusava a fração ("Não foi possível mover a nota").
    const s = await abrir({ custom: comFichas(), viewport: { width: 1100, height: 900 } });
    const { page, writes } = s;
    await page.goto(BASE + '/cliente/cx-1?area=mural');
    await esperarFicha(page, 'Horizonte Studio');
    await page.getByRole('button', { name: 'Quadro', exact: true }).click().catch(() => {});
    await page.waitForFunction(() => document.querySelector('.cl-mural-plano'));
    await page.locator('.cl-mural-plano').evaluate((el) => {
      el.style.width = '777.5px';
    });
    const alca = page.getByRole('button', { name: /^Mover a nota “Tom de voz”/ });
    const caixa = await alca.boundingBox();
    assert.ok(caixa, 'a alça está à vista');
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(1090, caixa.y + 40, { steps: 8 });
    await page.mouse.up();
    await pause(500);
    const gravadas = writes.filter((w) => w.url === '/api/mural/n-1' && w.body && 'positionX' in w.body);
    assert.equal(gravadas.length, 1, JSON.stringify(writes));
    const { positionX, positionY } = gravadas[0].body;
    assert.ok(Number.isInteger(positionX) && Number.isInteger(positionY), `posição inteira, veio ${positionX},${positionY}`);
    return `x=${positionX}, y=${positionY}`;
  });

  await cenario('CX15', 'Histórico: data, origem e documentos; endereço no clique; falha junto do documento', async (abrir) => {
    const { page } = await abrir({ custom: comFichas() });
    await page.addInitScript(() => {
      window.__abertos = [];
      window.open = (u) => {
        window.__abertos.push(u);
        return null;
      };
    });
    await page.goto(BASE + '/cliente/cx-1?area=historico');
    await esperarFicha(page, 'Horizonte Studio');
    const reg = page.locator('.cl-evento', { hasText: 'Reunião de alinhamento' });
    await reg.waitFor();
    const texto = (await reg.textContent()).replace(/\s+/g, ' ');
    assert.match(texto, /conduzido por Ana Demo/);
    assert.match(texto, /registrado em/);
    assert.equal(await reg.locator('time').getAttribute('datetime'), emDias(-2));
    const ia = page.locator('.cl-evento', { hasText: 'Mudança de escopo' });
    await ia.locator('.o-selo', { hasText: 'Ana Demo, via Claude' }).waitFor();
    // Falha: a frase do servidor aparece NO registro do documento.
    await reg.getByRole('button', { name: 'Abrir contrato-assinado.pdf' }).click();
    await reg.getByRole('alert').filter({ hasText: 'não está ao seu alcance' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 1, 'um aviso só, no lugar certo');
    // Sucesso: o endereço assinado é pedido no clique e aberto.
    await reg.getByRole('button', { name: 'Abrir ata-da-reuniao.pdf' }).click();
    await page.waitForFunction(() => window.__abertos.length === 1);
    assert.equal(await page.evaluate(() => window.__abertos[0]), 'https://example.invalid/assinado/ata');
    return 'falha junto do documento; abrir pede o endereço no clique';
  });

  await cenario('CX16', 'vazio e erro de leitura nas áreas com leitura própria', async (abrir) => {
    const recusar = (url, req) =>
      req.method() === 'GET' && /^\/api\/clients\/cx-13\/(mural|history|tasks|captures)$/.test(url.pathname)
        ? { status: 500, body: { ok: false, message: 'Leitura indisponível (simulado).' } }
        : null;
    const { page } = await abrir({ custom: comFichas({ recusar }) });
    const areas = ['Checklist', 'Captação', 'Mural', 'Histórico'];
    await page.goto(BASE + '/cliente/cx-3');
    await esperarFicha(page, 'Instituto Vila Nova');
    // F16 (CX16 caiu 1× em 4 no E2E completo): esperar QUALQUER vazio pegava,
    // sob carga, o vazio da área anterior ainda no painel — a contagem media a
    // troca. Agora espera o vazio DESTA área (pelo título) e só então conta.
    const tituloDoVazio = {
      Checklist: 'Nenhuma demanda aberta',
      'Captação': 'Nenhuma gravação registrada',
      Mural: 'Mural vazio',
      'Histórico': 'Nada registrado ainda',
    };
    for (const a of areas) {
      await irParaArea(page, a);
      await page.locator('#cl-area [data-estado="vazio"]', { hasText: tituloDoVazio[a] }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('#cl-area [data-estado]').length === 1);
      assert.equal(await page.locator('#cl-area .iw-estado-acao').count(), 1, `${a}: o vazio oferece a ação`);
    }
    await page.goto(BASE + '/cliente/cx-13');
    await esperarFicha(page, 'Antiga Papelaria');
    for (const a of areas) {
      await irParaArea(page, a);
      const erro = page.locator('#cl-area [data-estado="erro"]');
      await erro.waitFor();
      assert.match(await erro.textContent(), /Leitura indisponível/);
      assert.equal(await page.locator('#cl-area [data-estado="vazio"]').count(), 0, `${a}: erro não vira "vazio"`);
      await erro.getByRole('button', { name: 'Tentar de novo' }).waitFor();
    }
    return 'vazio com ação e erro com "Tentar de novo" nas quatro';
  });

  await cenario('CX17', 'R02 Mural: notas no mesmo lugar e além da janela — localizáveis por mouse, toque e teclado sem mover a primeira', async (abrir) => {
    const s = await abrir({ custom: comFichas(), viewport: { width: 1024, height: 768 } });
    const { page, writes } = s;
    await page.addInitScript(() => { try { localStorage.setItem('ideworks:mural-vista', 'quadro'); } catch {} });
    await page.goto(BASE + '/cliente/cx-21?area=mural');
    await esperarFicha(page, FICHAS['cx-21'].name);
    await page.waitForFunction(() => document.querySelectorAll('.cl-mural-plano > div').length === 3);
    const posicoes = () => writes.filter((w) => w.body && 'positionX' in w.body);
    // O quadro avisa e oferece as duas saídas; abrir não grava nada.
    const aviso = page.locator('.cl-mural-aviso');
    assert.match((await aviso.textContent()).replace(/\s+/g, ' '), /2 notas estão umas sobre as outras/);
    await page.getByRole('button', { name: 'Organizar notas' }).waitFor();
    // Teclado: o Tab chega na de baixo e ela vem para a frente (o ponto do meio é dela).
    await page.getByRole('textbox', { name: 'Título da nota “Segunda”' }).focus();
    const naFrente = await page.evaluate(() => {
      const campo = document.querySelector('input[aria-label="Título da nota “Segunda”"]');
      const r = campo.getBoundingClientRect();
      return campo.closest('.cl-mural-plano > div').contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    assert.ok(naFrente, 'a nota com o foco fica por cima');
    await page.keyboard.type(' (editada)');
    await page.keyboard.press('Tab');
    await pause(300);
    assert.deepEqual(writes.find((w) => w.url === '/api/mural/ns-2')?.body, { title: 'Segunda (editada)' });
    // A distante está dentro do quadro, que rola em si (a página não).
    const quadro = await page.locator('.cl-mural-quadro').evaluate((el) => ({ rola: el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight }));
    assert.ok(quadro.rola, 'o quadro rola até a nota distante');
    assert.ok(await semRolagemLateral(page));
    // Mouse/toque: "Ver todas em lista" — as três, editáveis, nenhuma posição gravada.
    await aviso.getByRole('button', { name: 'Ver todas em lista' }).click();
    const lista = page.getByRole('list', { name: 'Notas do mural' });
    await lista.waitFor();
    assert.deepEqual(await lista.locator('input').evaluateAll((els) => els.map((e) => e.value)), ['Primeira', 'Segunda (editada)', 'Distante']);
    await page.getByRole('textbox', { name: 'Texto da nota “Primeira”' }).click();
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.cl-mural-plano > div').length === 3);
    assert.equal(posicoes().length, 0, `abrir e trocar de forma não gravam posição: ${JSON.stringify(writes)}`);
    // Organizar: "Cancelar" não grava; "OK" grava só posições, e ninguém fica por baixo.
    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: 'Organizar notas' }).click();
    await pause(300);
    assert.equal(posicoes().length, 0, 'cancelar não grava');
    let pergunta = '';
    page.once('dialog', (d) => { pergunta = d.message(); void d.accept(); });
    await page.getByRole('button', { name: 'Organizar notas' }).click();
    await page.waitForFunction(() => !document.querySelector('.cl-mural-aviso'));
    await pause(300);
    assert.match(pergunta, /Organizar as 3 notas/);
    const gravadas = posicoes();
    assert.ok(gravadas.length >= 2, JSON.stringify(gravadas));
    assert.ok(gravadas.every((w) => Object.keys(w.body).sort().join() === 'positionX,positionY'), 'organizar grava SÓ a posição');
    return `aviso 2 sobrepostas; foco traz a de baixo; lista com as 3; ${gravadas.length} posições só após o OK`;
  });

  await cenario('CX18', 'R05 Checklist: dezenas de concluídas recolhidas; alcance escrito; descrição sob pedido e sem Markdown cru', async (abrir) => {
    // A leitura das demandas demora 800 ms: dá para olhar a tela no meio dela.
    const custom = comFichas();
    const { page } = await abrir({
      custom: async (url, req) => {
        if (/\/api\/clients\/cx-21\/tasks$/.test(url.pathname)) await pause(800);
        return custom(url, req);
      },
      viewport: { width: 390, height: 844 },
    });
    await page.goto(BASE + '/cliente/cx-21?area=checklist');
    await esperarFicha(page, FICHAS['cx-21'].name);
    // Durante a leitura: nenhum número (nada de "0 pendentes").
    await page.locator('#cl-area [data-estado="carregando"]').waitFor();
    assert.equal(await page.locator('.cl-resumo-area').count(), 0, 'sem resumo durante a leitura');
    await page.locator('.cl-resumo-area').waitFor();
    assert.match(await page.locator('.cl-alcance').textContent(), /Todas as demandas deste cliente/);
    // Pendentes primeiro e à vista; as 40 concluídas recolhidas.
    assert.equal(await page.locator('#cl-area .cl-linha').count(), 2, 'só as pendentes à vista');
    const alternar = page.getByRole('button', { name: /^Concluídas 40/ });
    assert.equal(await alternar.getAttribute('aria-expanded'), 'false');
    const primeira = await topoDe(page, '#cl-area .cl-linha');
    assert.ok(primeira < 844, `a primeira pendente em y=${primeira}`);
    // Descrição fechada; aberta, desenhada (negrito e lista) e sem ** nem "- ".
    assert.equal(await page.locator('#cl-area .cl-linha-md').count(), 0, 'nenhuma descrição aberta por padrão');
    await page.getByRole('button', { name: 'Ver os detalhes de “Fechar pauta de outubro”' }).click();
    const md = page.locator('#cl-area .cl-linha-md').first();
    await md.locator('strong', { hasText: 'Roteiro aprovado' }).waitFor();
    assert.equal(await md.locator('li').count(), 2);
    assert.doesNotMatch(await md.textContent(), /\*\*|^- /m);
    // Editar recebe o texto ORIGINAL (com os sinais).
    await page.getByRole('button', { name: 'Editar “Fechar pauta de outubro”' }).click();
    const form = page.getByRole('form', { name: 'Editar a demanda “Fechar pauta de outubro”' });
    assert.match(await form.getByLabel('Detalhes').inputValue(), /^\*\*Roteiro aprovado\*\*/);
    await form.getByRole('button', { name: 'Cancelar' }).click();
    // Abrir as concluídas: as 40, com a descrição também fechada.
    await alternar.click();
    assert.equal(await alternar.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('#cl-area .cl-linha').count(), 42);
    assert.equal(await page.locator('#cl-area .cl-linha-md').count(), 1, 'só a descrição pedida está aberta');
    assert.ok(await semRolagemLateral(page));
    return `2 pendentes à vista, 40 concluídas recolhidas; primeira pendente y=${primeira}; Markdown desenhado`;
  });

  const CAPTURAS_AREAS = process.env.CLIENTE_CAPTURAS_AREAS ?? '';
  if (CAPTURAS_AREAS) {
    await cenario('CX-capturas-areas', 'seis áreas cheias e vazias × 1440/390 × claro/escuro', async (abrir) => {
      mkdirSync(CAPTURAS_AREAS, { recursive: true });
      const areas = [['conteudos', null], ['calendario', 'calendario'], ['semanal', 'semanal'], ['checklist', 'checklist'], ['captacao', 'captacao'], ['mural', 'mural'], ['historico', 'historico']];
      let n = 0;
      for (const tema of ['claro', 'escuro']) {
        for (const [largura, altura] of [[1440, 900], [390, 844]]) {
          const { page } = await abrir({ custom: comFichas(), viewport: { width: largura, height: altura }, tema });
          for (const [nome, area] of areas) {
            for (const [estado, id] of [['cheia', 'cx-1'], ['vazia', nome === 'conteudos' || nome === 'semanal' || nome === 'calendario' ? 'cx-2' : 'cx-3']]) {
              await page.goto(BASE + '/cliente/' + id + (area ? `?area=${area}` : ''));
              await esperarFicha(page, FICHAS[id].name);
              await page.waitForLoadState('networkidle');
              await pause(250);
              await page.locator('#cl-area').evaluate((el) => el.scrollIntoView({ block: 'start' }));
              await pause(100);
              await page.screenshot({ path: join(CAPTURAS_AREAS, `f11c-${nome}-${estado}-${largura}-${tema}.png`) });
              n += 1;
            }
          }
        }
      }
      // Revisão de 28/09: mural com notas sobrepostas (quadro) e checklist denso.
      for (const tema of ['claro', 'escuro']) {
        for (const [largura, altura] of [[1440, 900], [390, 844]]) {
          const { page } = await abrir({ custom: comFichas(), viewport: { width: largura, height: altura }, tema });
          await page.addInitScript(() => { try { localStorage.setItem('ideworks:mural-vista', 'quadro'); } catch {} });
          await page.goto(BASE + '/cliente/cx-21?area=mural');
          await esperarFicha(page, FICHAS['cx-21'].name);
          await page.locator('.cl-mural-aviso').waitFor();
          await page.locator('#cl-area').evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await pause(150);
          await page.screenshot({ path: join(CAPTURAS_AREAS, `r02-mural-sobreposto-${largura}-${tema}.png`) });
          await page.goto(BASE + '/cliente/cx-21?area=checklist');
          await page.locator('.cl-resumo-area').waitFor();
          await page.waitForLoadState('networkidle');
          // A rolagem herdada da captura anterior volta a 0 logo depois da leitura;
          // clicar antes disso cai no vazio.
          await pause(800);
          await page.getByRole('button', { name: 'Ver os detalhes de “Fechar pauta de outubro”' }).click();
          await page.locator('#cl-area .cl-linha-md strong').waitFor();
          await page.locator('#cl-area').evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await pause(150);
          await page.screenshot({ path: join(CAPTURAS_AREAS, `r05-checklist-denso-${largura}-${tema}.png`) });
          n += 2;
        }
      }
      return `${n} capturas em ${CAPTURAS_AREAS}`;
    });
  }

  if (CAPTURAS) {
    await cenario('CX-capturas', 'capturas cheio/sem contrato/inativo × 1440/1024/390 × claro/escuro', async (abrir) => {
      mkdirSync(CAPTURAS, { recursive: true });
      const casos = [['cheio', 'cx-1'], ['sem-contrato', 'cx-2'], ['inativo', 'cx-13'], ['longo', 'cx-20']];
      let n = 0;
      for (const tema of ['claro', 'escuro']) {
        for (const [largura, altura] of [[1440, 900], [1024, 768], [390, 844]]) {
          const { page } = await abrir({ custom: comFichas(), viewport: { width: largura, height: altura }, tema });
          for (const [nome, id] of casos) {
            await page.goto(BASE + '/cliente/' + id);
            await esperarFicha(page, FICHAS[id].name);
            await page.waitForLoadState('networkidle');
            await pause(250);
            await page.screenshot({ path: join(CAPTURAS, `f11b-${nome}-${largura}x${altura}-${tema}.png`) });
            n += 1;
          }
          // O cadastro aberto, uma vez por largura e tema.
          await page.goto(BASE + '/cliente/cx-1');
          await esperarFicha(page, 'Horizonte Studio');
          await botaoDosDados(page).click();
          await page.waitForLoadState('networkidle');
          await pause(250);
          await page.screenshot({ path: join(CAPTURAS, `f11b-dados-${largura}x${altura}-${tema}.png`), fullPage: true });
          // Deixa fechado para as próximas (a escolha fica no navegador).
          await botaoDosDados(page).click();
          n += 1;
        }
      }
      return `${n} capturas em ${CAPTURAS}`;
    });
  }

  /* ───────────── F18C: Lista | Kanban nas listas da ficha ───────────── */

  const modoCX = (page, nome) => page.getByRole('group', { name: 'Forma de ver', exact: true }).getByRole('button', { name: nome, exact: true });
  const colunaCX = (page, chave) => page.locator(`#cl-area section.q-coluna[data-estado="${chave}"]`);
  const cartoesCX = (page, chave) => colunaCX(page, chave).locator('li.cl-cartao');
  const soltarCX = (page, de, para) =>
    page.evaluate(([o, d]) => {
      const dt = new DataTransfer();
      const a = document.querySelector(o);
      const b = document.querySelector(d);
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      b.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      b.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, [de, para]);

  await cenario('CX-LK1', 'Checklist em Kanban: os estados da demanda, as mesmas escritas, preferência deste cliente', async (abrir) => {
    const escritas = [];
    const { page, erros } = await abrir({ custom: comFichas({ escritas }) });
    await page.goto(BASE + '/cliente/cx-1?area=checklist');
    await esperarFicha(page, 'Horizonte Studio');
    await page.locator('.cl-resumo-area').waitFor();
    assert.equal(await modoCX(page, 'Lista').getAttribute('aria-pressed'), 'true', 'Lista é o padrão');
    await modoCX(page, 'Kanban').click();
    await colunaCX(page, 'pendentes').waitFor();
    const nomes = await page.locator('#cl-area .q-coluna-nome').allInnerTexts();
    assert.deepEqual(nomes, ['Pendentes', 'Concluídas'], 'só os estados da demanda');
    assert.equal(await cartoesCX(page, 'pendentes').count(), 4);
    assert.equal(await cartoesCX(page, 'concluidas').count(), 1, 'concluídas à vista numa coluna própria');
    assert.equal(new URL(page.url()).searchParams.get('ver'), null, 'o modo da área não vai para o endereço');

    // Setas: Pendentes → Concluídas é o mesmo "concluir" da caixa.
    await cartoesCX(page, 'pendentes').filter({ hasText: 'Enviar pauta do próximo mês' }).focus();
    await page.keyboard.press('ArrowRight');
    await pause(400);
    assert.deepEqual(escritas.map((e) => `${e.metodo} ${e.url}`), ['POST /api/tasks/t-hoje/completion']);

    // Arquivadas vira coluna quando pedida; de lá para Concluídas = desarquivar + concluir.
    await page.getByRole('button', { name: 'Ver arquivadas' }).click();
    await cartoesCX(page, 'arquivadas').first().waitFor(); // a coluna nasce antes da releitura com as arquivadas
    assert.equal(await cartoesCX(page, 'arquivadas').count(), 1);
    escritas.length = 0;
    await cartoesCX(page, 'arquivadas').first().focus();
    await page.keyboard.press('ArrowLeft');
    await pause(600);
    assert.deepEqual(escritas.map((e) => `${e.metodo} ${e.url}`), ['DELETE /api/tasks/t-arquivada/archive', 'POST /api/tasks/t-arquivada/completion']);

    // Arrastar uma pendente para Arquivadas = arquivar.
    escritas.length = 0;
    await soltarCX(page, '#cl-area li[data-item="t-sem-prazo"]', '#cl-area section[data-estado="arquivadas"]');
    await pause(600);
    assert.deepEqual(escritas.map((e) => `${e.metodo} ${e.url}`), ['POST /api/tasks/t-sem-prazo/archive']);

    // A escolha é deste cliente e desta lista: recarregar volta no Kanban; Conteúdos segue na Lista.
    await page.reload();
    await colunaCX(page, 'pendentes').waitFor();
    assert.equal(await modoCX(page, 'Kanban').getAttribute('aria-pressed'), 'true');
    await page.goto(BASE + '/cliente/cx-1?area=conteudos');
    await page.locator('#cl-area ul[aria-label="Agendados"]').waitFor();
    assert.equal(await modoCX(page, 'Lista').getAttribute('aria-pressed'), 'true', 'Conteúdos não herdou o Kanban do Checklist');
    const lugar = await page.evaluate(() => JSON.parse(localStorage.getItem('ideworks:lugar') ?? '{}'));
    assert.deepEqual(lugar.modos, { checklist: 'kanban', 'checklist:cx-1': 'kanban' });
    // O Mural tem o "Quadro" dele (notas soltas, não etapas) e não ganhou Kanban.
    await page.goto(BASE + '/cliente/cx-1?area=mural');
    await page.getByRole('group', { name: 'Forma de ver o mural' }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Forma de ver', exact: true }).count(), 0);
    assert.deepEqual(errosReais(erros), []);
  });

  await cenario('CX-LK2', 'Conteúdos em Kanban: A entregar/Entregues com os mesmos itens; a seta marca; o foco acompanha', async (abrir) => {
    const escritas = [];
    const { page, erros } = await abrir({ custom: comFichas({ escritas }) });
    await page.goto(BASE + '/cliente/cx-1?area=conteudos');
    await esperarFicha(page, 'Horizonte Studio');
    const caixas = page.locator('#cl-area input.cl-marca');
    await caixas.first().waitFor();
    const naLista = await caixas.evaluateAll((els) => ({ feitos: els.filter((e) => e.checked).length, abertos: els.filter((e) => !e.checked).length }));
    await modoCX(page, 'Kanban').click();
    await colunaCX(page, 'a-entregar').waitFor();
    assert.deepEqual(await page.locator('#cl-area .q-coluna-nome').allInnerTexts(), ['A entregar', 'Entregues']);
    const noKanban = { feitos: await cartoesCX(page, 'entregues').count(), abertos: await cartoesCX(page, 'a-entregar').count() };
    assert.deepEqual(noKanban, naLista, 'os mesmos itens nas duas formas');
    assert.ok(await cartoesCX(page, 'a-entregar').filter({ hasText: 'Sem data' }).count() === 1, 'o sem-data entra em A entregar, uma vez');

    const primeiro = cartoesCX(page, 'a-entregar').first();
    const id = await primeiro.getAttribute('data-item');
    await primeiro.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((i) => document.activeElement?.getAttribute('data-item') === i && document.activeElement.closest('[data-estado="entregues"]'), id, { timeout: 3000 });
    await pause(300);
    assert.deepEqual(escritas.map((e) => `${e.metodo} ${e.url}`), [`POST /api/items/${id}/completion`], 'a mesma escrita da caixa');
    assert.deepEqual(errosReais(erros), []);
    return `${JSON.stringify(naLista)}; foco seguiu ${id}`;
  });

  await cenario('CX-LK3', 'Conteúdos em Kanban: gesto cancelado não grava; entregar oferece Desfazer; recusa devolve o cartão e avisa', async (abrir) => {
    const escritas = [];
    let recusarEntrega = false;
    const recusar = (url, req) =>
      recusarEntrega && req.method() === 'POST' && /^\/api\/items\/[^/]+\/completion$/.test(url.pathname)
        ? { status: 403, body: { ok: false, message: 'Você não pode marcar entregas deste cliente (simulado).' } }
        : null;
    const { page, erros } = await abrir({ custom: comFichas({ escritas, recusar }) });
    await page.goto(BASE + '/cliente/cx-1?area=conteudos');
    await esperarFicha(page, 'Horizonte Studio');
    await modoCX(page, 'Kanban').click();
    await colunaCX(page, 'a-entregar').waitFor();
    const id = await cartoesCX(page, 'a-entregar').first().getAttribute('data-item');
    const cartao = `#cl-area li[data-item="${id}"]`;
    const escritasDe = () => escritas.map((e) => `${e.metodo} ${e.url}`);

    // Gesto cancelado (Esc / soltar fora): dragstart + dragend sem drop. E soltar na própria coluna.
    await page.evaluate((o) => {
      const dt = new DataTransfer();
      const a = document.querySelector(o);
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    }, cartao);
    await soltarCX(page, cartao, '#cl-area section[data-estado="a-entregar"]');
    await pause(400);
    assert.deepEqual(escritasDe(), [], 'cancelar ou soltar na mesma coluna não grava');

    // Entregar pelo arrasto: a mesma escrita da caixa, e a frase com Desfazer.
    await soltarCX(page, cartao, '#cl-area section[data-estado="entregues"]');
    const aviso = page.locator('#cl-area .cl-kanban-aviso');
    await aviso.getByText(/marcado como entregue/).waitFor({ timeout: 3000 });
    assert.deepEqual(escritasDe(), [`POST /api/items/${id}/completion`]);
    await aviso.getByRole('button', { name: 'Desfazer' }).click();
    await pause(600);
    assert.deepEqual(escritasDe(), [`POST /api/items/${id}/completion`, `DELETE /api/items/${id}/completion`], 'desfazer = a escrita contrária');
    assert.equal(await aviso.getByRole('button', { name: 'Desfazer' }).count(), 0, 'a frase sai depois de desfazer');

    // Recusa do servidor: o cartão volta para A entregar e a frase aparece junto do quadro.
    escritas.length = 0;
    recusarEntrega = true;
    await soltarCX(page, cartao, '#cl-area section[data-estado="entregues"]');
    await aviso.getByText(/não pode marcar entregas.*O cartão voltou/).waitFor({ timeout: 3000 });
    assert.equal(await colunaCX(page, 'a-entregar').locator(`li[data-item="${id}"]`).count(), 1, 'o cartão voltou');
    assert.equal(await colunaCX(page, 'entregues').locator(`li[data-item="${id}"]`).count(), 0);
    assert.deepEqual(escritasDe(), [`POST /api/items/${id}/completion`]);
    assert.deepEqual(errosReais(erros), []);
    return `cancelado sem escrita; entregue + Desfazer (DELETE); recusa devolveu ${id}`;
  });

  await cenario('CX-LK4', 'Checklist em Kanban: a coluna Arquivadas diz "Carregando" até a leitura com as arquivadas chegar', async (abrir) => {
    const base = comFichas();
    const custom = async (url, req) => {
      if (req.method() === 'GET' && url.pathname === '/api/clients/cx-1/tasks' && url.searchParams.get('archived')) await pause(1500);
      return base(url, req);
    };
    const { page, erros } = await abrir({ custom });
    await page.goto(BASE + '/cliente/cx-1?area=checklist');
    await esperarFicha(page, 'Horizonte Studio');
    await modoCX(page, 'Kanban').click();
    await colunaCX(page, 'pendentes').waitFor();
    await page.getByRole('button', { name: 'Ver arquivadas' }).click();
    const col = colunaCX(page, 'arquivadas');
    await col.waitFor();
    assert.match(await col.innerText(), /Carregando as arquivadas/);
    assert.doesNotMatch(await col.innerText(), /Nenhuma arquivada/);
    assert.ok((await cartoesCX(page, 'pendentes').count()) > 0, 'o quadro não some enquanto relê');
    await cartoesCX(page, 'arquivadas').first().waitFor({ timeout: 4000 });
    assert.doesNotMatch(await col.innerText(), /Carregando/);
    assert.deepEqual(errosReais(erros), []);
  });

  for (const [largura, tema] of [[1440, 'claro'], [1440, 'escuro'], [1280, 'claro'], [1280, 'escuro'], [390, 'claro'], [390, 'escuro']]) {
    await cenario(`CX-LK-telas-${largura}-${tema}`, 'Checklist e Conteúdos nos dois modos: sem rolagem lateral', async (abrir) => {
      const { page, erros } = await abrir({ custom: comFichas(), viewport: { width: largura, height: largura > 500 ? 900 : 844 }, tema });
      const medidas = [];
      for (const area of ['checklist', 'conteudos']) {
        for (const m of ['Lista', 'Kanban']) {
          await page.goto(`${BASE}/cliente/cx-1?area=${area}`);
          await esperarFicha(page, 'Horizonte Studio');
          await modoCX(page, m).waitFor();
          await pause(300);
          if ((await modoCX(page, m).getAttribute('aria-pressed')) !== 'true') await modoCX(page, m).click();
          await page.locator(m === 'Kanban' ? '#cl-area .cl-cartao' : '#cl-area .cl-lista').first().waitFor();
          await pause(300);
          assert.ok(await semRolagemLateral(page), `${area} ${m}: sem rolagem lateral`);
          medidas.push(`${area}/${m}`);
          if (process.env.LK_CAPTURAS) {
            await page.locator('#cl-area').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${process.env.LK_CAPTURAS}/cliente-${area}-${m.toLowerCase()}-${largura}-${tema}.png` });
            // Volta ao topo: a mesma URL devolveria esta rolagem no meio do próximo clique.
            await page.evaluate(() => window.scrollTo(0, 0));
            await pause(150);
          }
        }
      }
      assert.deepEqual(errosReais(erros), []);
      return medidas.join('; ');
    });
  }

  return resultados;

}
