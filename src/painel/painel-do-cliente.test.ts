/**
 * O painel do cliente no Planejamento — F43, Fase 3.
 *
 * As regras puras (`painel-do-cliente.ts`) e o desenho (`ConteudoDoPainel`,
 * `PainelDoCliente`) com `renderToStaticMarkup` — nenhum efeito roda. Mês e
 * HOJE fixos: outubro de 2026, hoje quarta 07/10 (semana 2, 05–11), a mesma
 * carteira de `visao-do-contrato.test.ts`, com um cliente em cada passo:
 *
 *   Aurora    mês NÃO aberto (contrato do cadastro)  → Abrir o mês
 *   Café      aberto, falta planejar                 → Planejamento OK
 *   Estúdio   planejado, falta aprovar               → as duas chaves
 *   Horizonte aprovado                               → planejamento travado
 *   Prisma    só veio nas semanas                    → sem chaves
 *   Quinta    só veio no ritual                      → sem peças
 *   Norte     sem contrato
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RECUSA_SO_ADMIN_MARCA } from '@/delivery/month-ritual';
import { ConteudoDoPainel, PainelDoCliente } from '@/painel/PainelDoCliente';
import {
  SO_ADMIN_ABRE,
  SO_ADMIN_MARCA,
  acaoDoMes,
  entradaDaSemanal,
  gravarNoPainel,
  passosDoMes,
  subtituloDoCliente,
  tituloDoContrato,
} from '@/painel/painel-do-cliente';
import { type LinhaDoMes, planejarMes } from '@/painel/planejamento-do-mes';
import { VisaoDoContrato } from '@/painel/VisaoDoContrato';
import type { PlanningRow } from '@/server/planning';
import type { PlanningWeekItem, PlanningWeeksRow } from '@/server/planning-weeks';

const HOJE = '2026-10-07';
const MES = '2026-10';
const CARLA = { id: 'u-carla', name: 'Carla' };
const HELENA = { id: 'u-helena', name: 'Helena' };
const PLANO = { id: 'pl', name: 'Conteúdo', colorBg: '#eef2ee', colorText: '#3b5a41', colorBorder: '#cfdcd1' };

let seq = 0;
const peca = (tipo: string, dia: string | null, feita = false, isExtra = false): PlanningWeekItem => ({
  id: `p${++seq}`,
  contentType: tipo,
  scheduledAt: dia ? `${dia}T12:00:00Z` : null,
  completedAt: feita && dia ? `${dia}T15:00:00Z` : null,
  isExtra,
  title: null,
});

const semanas = (id: string, name: string, over: Partial<PlanningWeeksRow> = {}): PlanningWeeksRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Ide',
  plan: PLANO,
  owners: [],
  quotaSource: 'contrato',
  quota: {},
  hasContentContract: true,
  items: [],
  ...over,
});
const ritual = (id: string, name: string, over: Partial<PlanningRow> = {}): PlanningRow => ({
  id,
  name,
  categoryId: 'cat',
  categoryName: 'Ide',
  plan: PLANO,
  monthOpened: true,
  planningDoneAt: null,
  clientApprovedAt: null,
  ...over,
});

const PLANEJADO = { planningDoneAt: '2026-10-02T12:00:00Z' };
const APROVADO = { ...PLANEJADO, clientApprovedAt: '2026-10-04T12:00:00Z' };

const RITUAL: PlanningRow[] = [
  ritual('c-aurora', 'Aurora Mercado', { monthOpened: false }),
  ritual('c-cafe', 'Café do Bairro'),
  ritual('c-estudio', 'Estúdio Jardim', PLANEJADO),
  ritual('c-horizonte', 'Horizonte Studio', APROVADO),
  ritual('c-norte', 'Norte Arquitetura', { plan: null }),
  ritual('c-quinta', 'Quinta do Vale', PLANEJADO),
];

const SEMANAS: PlanningWeeksRow[] = [
  semanas('c-aurora', 'Aurora Mercado', { owners: [HELENA], quotaSource: 'cadastro', quota: { arte: 4, video: 2 } }),
  semanas('c-cafe', 'Café do Bairro', {
    owners: [CARLA],
    quota: { arte: 8, video: 4 },
    items: [peca('arte', '2026-10-02', true), peca('arte', '2026-10-20'), peca('arte', null), peca('foto', '2026-10-09', true, true)],
  }),
  semanas('c-estudio', 'Estúdio Jardim', {
    owners: [CARLA, HELENA],
    quota: { arte: 4 },
    items: [peca('arte', '2026-10-08'), peca('arte', '2026-10-15')],
  }),
  semanas('c-horizonte', 'Horizonte Studio', { owners: [HELENA], quota: { video: 2 }, items: [peca('video', '2026-10-06', true)] }),
  semanas('c-norte', 'Norte Arquitetura', { plan: null, hasContentContract: false }),
  semanas('c-prisma', 'Prisma Óptica', { owners: [CARLA], quota: { arte: 2 } }),
];

const LINHAS = planejarMes({ ritual: RITUAL, semanas: SEMANAS, mes: MES, hoje: HOJE });
const linha = (id: string): LinhaDoMes => {
  const l = LINHAS.find((x) => x.id === id);
  if (!l) throw new Error(`sem ${id}`);
  return l;
};

const nada = () => {};
const comRoteador = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/planejamento?cliente=x'] }, el));
const conteudo = (id: string, props: Partial<Parameters<typeof ConteudoDoPainel>[0]> = {}) =>
  comRoteador(
    createElement(ConteudoDoPainel, {
      linha: linha(id),
      mes: MES,
      hoje: HOJE,
      souAdmin: true,
      aoAbrirMes: nada,
      aoMarcar: nada,
      aoMudar: nada,
      ...props,
    }),
  );

/** As chaves (`<input type="checkbox">`) com o rótulo, ligadas e desligadas. */
const chaves = (html: string) =>
  [...html.matchAll(/<label class="o-chave"><input type="checkbox"([^>]*)\/?><span class="trilho"><\/span><span[^>]*>([^<]+)<\/span><\/label>/g)].map(
    (m) => ({ rotulo: m[2], ligada: /checked=""/.test(m[1]), desligada: /disabled=""/.test(m[1]) }),
  );
/** Os passos `<li>` do mês, como "estado:rótulo". */
const passos = (html: string) =>
  [...(html.match(/<ol class="plp-passos">([\s\S]*?)<\/ol>/)?.[1] ?? '').matchAll(/<li data-passo="[^"]+" data-estado="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(
    (m) => `${m[1]}:${m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
  );

/* ───────────────────────────── as regras ───────────────────────────── */

describe('os passos do mês', () => {
  it('na ordem do ritual, com o de agora marcado', () => {
    expect(passosDoMes(linha('c-aurora')).map((p) => `${p.estado}:${p.rotulo}`)).toEqual([
      'agora:Mês não aberto',
      'depois:Planejamento',
      'depois:Aprovação do cliente',
    ]);
    expect(passosDoMes(linha('c-cafe')).map((p) => p.estado)).toEqual(['feito', 'agora', 'depois']);
    expect(passosDoMes(linha('c-estudio')).map((p) => p.estado)).toEqual(['feito', 'feito', 'agora']);
    expect(passosDoMes(linha('c-horizonte')).map((p) => p.estado)).toEqual(['feito', 'feito', 'feito']);
  });

  it('quem só veio nas semanas: aberto se sabe; o resto não', () => {
    expect(linha('c-prisma').leitura).toBe('so-semanas');
    expect(passosDoMes(linha('c-prisma')).map((p) => p.estado)).toEqual(['feito', 'desconhecido', 'desconhecido']);
  });
});

describe('a ação do mês — o que aparece em cada passo', () => {
  it('mês não aberto: só "Abrir o mês", com o próximo passo escrito', () => {
    const a = acaoDoMes(linha('c-aurora'), true);
    expect(a).toEqual({
      tipo: 'abrir',
      passo: { acao: 'abrir', texto: 'Abrir o mês para congelar o contrato' },
      desativada: false,
      motivo: null,
    });
  });

  it('aberto: "Planejamento OK" desligada e livre; a aprovação ainda não, e diz por quê', () => {
    const a = acaoDoMes(linha('c-cafe'), true);
    if (a.tipo !== 'chaves') throw new Error(a.tipo);
    expect(a.passo.acao).toBe('planejar');
    expect(a.planejamento).toEqual({ ligada: false, desativada: false, trava: null });
    expect(a.aprovacao).toBeNull();
    expect(a.espera).toBe('A aprovação do cliente vem depois do planejamento.');
    expect(a.motivo).toBeNull();
  });

  it('planejado: as duas chaves, a de aprovação livre', () => {
    const a = acaoDoMes(linha('c-estudio'), true);
    if (a.tipo !== 'chaves') throw new Error(a.tipo);
    expect(a.passo.acao).toBe('aprovar');
    expect(a.planejamento).toEqual({ ligada: true, desativada: false, trava: null });
    expect(a.aprovacao).toEqual({ ligada: false, desativada: false });
    expect(a.espera).toBeNull();
  });

  it('aprovado: o planejamento trava com a frase da regra; a aprovação fica, para ser retirada', () => {
    const a = acaoDoMes(linha('c-horizonte'), true);
    if (a.tipo !== 'chaves') throw new Error(a.tipo);
    expect(a.passo).toEqual({ acao: 'nenhuma', texto: 'Mês fechado com o cliente' });
    expect(a.planejamento.ligada).toBe(true);
    expect(a.planejamento.desativada).toBe(true);
    expect(a.planejamento.trava).toMatch(/^Este mês já foi aprovado pelo cliente\. Retire a aprovação/);
    expect(a.aprovacao).toEqual({ ligada: true, desativada: false });
  });

  it('quem não administra: tudo desligado, com o porquê à vista', () => {
    const abrir = acaoDoMes(linha('c-aurora'), false);
    expect(abrir).toMatchObject({ tipo: 'abrir', desativada: true, motivo: SO_ADMIN_ABRE });
    const marcar = acaoDoMes(linha('c-estudio'), false);
    if (marcar.tipo !== 'chaves') throw new Error(marcar.tipo);
    expect(marcar.planejamento.desativada).toBe(true);
    expect(marcar.aprovacao?.desativada).toBe(true);
    expect(marcar.motivo).toBe(SO_ADMIN_MARCA);
    expect(SO_ADMIN_MARCA).toBe('Só um administrador marca.');
  });

  it('sessão ainda chegando: desligado e SEM motivo — não se diz "só administrador" a um administrador', () => {
    const a = acaoDoMes(linha('c-cafe'), null);
    if (a.tipo !== 'chaves') throw new Error(a.tipo);
    expect(a.planejamento.desativada).toBe(true);
    expect(a.motivo).toBeNull();
    expect(acaoDoMes(linha('c-aurora'), null)).toMatchObject({ desativada: true, motivo: null });
  });

  it('quem só veio nas semanas não ganha chave: marcar às cegas seria pior', () => {
    expect(acaoDoMes(linha('c-prisma'), true)).toMatchObject({ tipo: 'sem-leitura' });
  });
});

describe('quem, o plano e o contrato', () => {
  it('"Carla · plano Conteúdo"; dois responsáveis; ninguém; sem plano', () => {
    expect(subtituloDoCliente(linha('c-cafe'))).toBe('Carla · plano Conteúdo');
    expect(subtituloDoCliente(linha('c-estudio'))).toBe('Carla e Helena · plano Conteúdo');
    expect(subtituloDoCliente(linha('c-norte'))).toBe('Sem responsável · sem plano');
  });

  it('"Contrato de outubro" — com o ano quando não é o de hoje', () => {
    expect(tituloDoContrato(MES, HOJE)).toBe('Contrato de outubro');
    expect(tituloDoContrato('2027-01', HOJE)).toBe('Contrato de janeiro de 2027');
  });

  it('a grade semanal recebe a cota com zeros, o mês aberto e o "sem contrato" do cadastro', () => {
    expect(entradaDaSemanal(linha('c-cafe'))).toEqual({
      itens: linha('c-cafe').items,
      contratado: { video: 4, arte: 8, foto: 0, ads: 0 },
      mesAberto: true,
      semContratoDeConteudo: false,
    });
    expect(entradaDaSemanal(linha('c-aurora')).mesAberto).toBe(false);
    expect(entradaDaSemanal(linha('c-norte')).semContratoDeConteudo).toBe(true);
  });
});

/* ───────────────────────────── o desenho ───────────────────────────── */

describe('ConteudoDoPainel — o mês do cliente', () => {
  it('os três passos numa linha, o de agora com `aria-current`', () => {
    const html = conteudo('c-cafe');
    expect(passos(html)).toEqual(['feito:✓ Mês aberto', 'agora:Planejamento', 'depois:Aprovação do cliente']);
    expect(html).toContain('<li data-passo="planejado" data-estado="agora" aria-current="step">');
    expect(html).toContain('<p class="plp-proximo">Próximo passo: montar o plano e marcar Planejamento OK.</p>');
  });

  it('mês não aberto: o botão "Abrir o mês", nenhuma chave, e o âmbar do passo', () => {
    const html = conteudo('c-aurora');
    expect(html).toMatch(/<button type="button" class="o-btn o-btn-solido o-btn-sm">Abrir o mês<\/button>/);
    expect(chaves(html)).toEqual([]);
    expect(html).toMatch(/<section class="plp-mes" aria-label="Mês do cliente: mês não aberto" data-estagio="fechado" data-atencao="true">/);
  });

  it('aberto: só "Planejamento OK", desligada; a aprovação espera, escrita', () => {
    const html = conteudo('c-cafe');
    expect(chaves(html)).toEqual([{ rotulo: 'Planejamento OK', ligada: false, desligada: false }]);
    expect(html).toContain('<span class="plp-espera">A aprovação do cliente vem depois do planejamento.</span>');
    expect(html).not.toContain('Abrir o mês</button>');
  });

  it('planejado: "Planejamento OK" ligada e "Cliente aprovou" livre', () => {
    expect(chaves(conteudo('c-estudio'))).toEqual([
      { rotulo: 'Planejamento OK', ligada: true, desligada: false },
      { rotulo: 'Cliente aprovou', ligada: false, desligada: false },
    ]);
  });

  it('aprovado: o planejamento travado, com a regra no `title` e no leitor de tela', () => {
    const html = conteudo('c-horizonte');
    expect(chaves(html)).toEqual([
      { rotulo: 'Planejamento OK', ligada: true, desligada: true },
      { rotulo: 'Cliente aprovou', ligada: true, desligada: false },
    ]);
    expect(html).toMatch(/<span title="Este mês já foi aprovado pelo cliente\. Retire a aprovação[^"]*"><label class="o-chave">/);
    expect(html).toMatch(/<span class="sr-only">Este mês já foi aprovado pelo cliente\./);
  });

  it('quem não administra vê as chaves desligadas e o porquê — e não acha que gravou', () => {
    const html = conteudo('c-estudio', { souAdmin: false });
    expect(chaves(html).every((c) => c.desligada)).toBe(true);
    expect(html).toContain('<span class="plp-motivo">Só um administrador marca.</span>');
    const fechado = conteudo('c-aurora', { souAdmin: false });
    expect(fechado).toMatch(/<button type="button" class="o-btn o-btn-solido o-btn-sm" disabled="">Abrir o mês<\/button>/);
    expect(fechado).toContain('<span class="plp-motivo">Só um administrador abre o mês.</span>');
  });

  it('o administrador não vê motivo nenhum', () => {
    expect(conteudo('c-estudio')).not.toContain('plp-motivo');
  });

  it('a chave virada aparece enquanto o pedido anda', () => {
    expect(chaves(conteudo('c-cafe', { virada: { passo: 'planning', valor: true }, ocupado: true }))).toEqual([
      { rotulo: 'Planejamento OK', ligada: true, desligada: true },
    ]);
  });

  it('a recusa do servidor aparece como veio, perto das chaves, e a chave é a do servidor', () => {
    const html = conteudo('c-cafe', { recusa: RECUSA_SO_ADMIN_MARCA });
    expect(html).toContain(`<div class="plp-recusa"><div role="alert" class="o-alerta" data-tom="err"><div>${RECUSA_SO_ADMIN_MARCA}</div></div></div>`);
    expect(chaves(html)).toEqual([{ rotulo: 'Planejamento OK', ligada: false, desligada: false }]);
  });

  it('quem só veio nas semanas: frase calma no lugar das chaves', () => {
    const html = conteudo('c-prisma');
    expect(chaves(html)).toEqual([]);
    expect(html).toContain('não vieram nesta leitura. Recarregue para marcar.');
  });
});

describe('ConteudoDoPainel — o contrato e as peças', () => {
  const html = conteudo('c-cafe');

  it('"Contrato de outubro" com uma linha por tipo, na ordem da grade', () => {
    expect(html).toMatch(/<h3 id="[^"]+" class="plp-secao">Contrato de outubro<\/h3>/);
    const tipos = [...html.matchAll(/<li class="plp-tipo" data-tipo="([^"]+)"><span class="plp-tipo-nome">([^<]+)<\/span>/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    // A foto não está no contrato: aparece porque tem peça (extra), sem barra.
    expect(tipos).toEqual(['video:Vídeo', 'arte:Arte', 'foto:Foto']);
  });

  it('a barra é a MESMA da tabela, marcação por marcação', () => {
    const tabela = comRoteador(
      createElement(VisaoDoContrato, {
        linhas: [linha('c-cafe')],
        mes: MES,
        hoje: HOJE,
        filtro: '',
        aoFiltrar: nada,
        enderecoDoPainel: (id: string) => `?cliente=${id}`,
      }),
    );
    const daTabela = tabela.match(/<td class="plc-tipo" data-tipo="arte">([\s\S]*?)<\/td>/)?.[1];
    const doPainel = html.match(/<li class="plp-tipo" data-tipo="arte"><span class="plp-tipo-nome">Arte<\/span>([\s\S]*?)<\/li>/)?.[1];
    expect(daTabela).toBeTruthy();
    expect(doPainel).toBe(daTabela);
    expect(doPainel).toContain('data-parte="entregue"');
    expect(doPainel).toContain('data-parte="sem-dia"');
    expect(doPainel?.replace(/<[^>]+>/g, '')).toBe('1 de 8 · 6 sem dia');
  });

  it('mês não aberto: a cota diz que é do cadastro de hoje', () => {
    expect(conteudo('c-aurora')).toContain('Pelo cadastro de hoje — o contrato congela quando o mês abre.');
    expect(html).not.toContain('Pelo cadastro de hoje');
  });

  it('sem contrato e sem leitura das peças: frases calmas, sem barra', () => {
    expect(conteudo('c-norte')).toContain('Sem contrato de conteúdo neste mês.');
    const quinta = conteudo('c-quinta');
    expect(quinta).not.toContain('plc-barra');
    expect(quinta).toContain('As peças deste cliente não vieram nesta leitura.');
  });

  it('as peças do mês são a grade `Semanal` da ficha, com o título do painel', () => {
    expect(html).toContain('<h3 class="cl-area-titulo">Peças do mês</h3>');
    expect(html).toContain('id="cl-semana-1"');
    expect(html).toContain('id="cl-sem-dia"');
    expect(html).toMatch(/Sem dia marcado · 1/);
  });

  it('mês não aberto: a grade diz que o mês não abriu, em vez de semanas vazias', () => {
    expect(conteudo('c-aurora')).toContain('O mês ainda não foi aberto.');
  });

  it('sem moldura nova: o único bloco com tom é o mês do cliente', () => {
    expect(html.match(/class="plp-mes"/g)).toHaveLength(1);
    expect(html).not.toMatch(/class="plp-(contrato|tipo)[^"]*o-card/);
  });
});

describe('PainelDoCliente — o diálogo', () => {
  const painel = (props: Partial<Parameters<typeof PainelDoCliente>[0]> = {}) =>
    comRoteador(
      createElement(PainelDoCliente, {
        id: 'c-cafe',
        linha: linha('c-cafe'),
        mes: MES,
        hoje: HOJE,
        carregando: false,
        erro: null,
        souAdmin: true,
        aoFechar: nada,
        aoMudar: nada,
        aoMudarMes: nada,
        ...props,
      }),
    );

  it('um diálogo modal com o nome do cliente, quem cuida e o plano', () => {
    const html = painel();
    const abre = html.match(/<section ([^>]*)>/)?.[1] ?? '';
    expect(abre).toContain('role="dialog"');
    expect(abre).toContain('aria-modal="true"');
    const id = abre.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(html).toContain(`<h2 id="${id}" class="pll-titulo">Café do Bairro</h2>`);
    expect(html).toContain('<p class="pll-subtitulo">Carla · plano Conteúdo</p>');
  });

  it('o mês no alto, com setas que não se confundem com as da página', () => {
    const html = painel();
    expect(html).toContain('<span class="plp-mes-nome tnum" aria-live="polite">Outubro de 2026</span>');
    expect(html).toContain('aria-label="Ver o mês anterior"');
    expect(html).toContain('aria-label="Ver o próximo mês"');
    expect(html).not.toContain('aria-label="Mês anterior"');
  });

  it('o rodapé leva à ficha no mês do painel', () => {
    expect(painel()).toContain('<footer class="pll-rodape"><a class="plp-link" href="/cliente/c-cafe"');
    expect(painel({ mes: '2026-09', linha: null })).toMatch(/href="\/cliente\/c-cafe\?mes=2026-09"/);
  });

  it('o cliente fora da carteira do mês: o painel diz isso, com calma', () => {
    const html = painel({ id: 'c-sumido', linha: null });
    expect(html).toContain('Este cliente não está na carteira de outubro de 2026.');
    expect(html).toContain('<h2 id="');
    expect(html).toContain('class="pll-titulo">Cliente</h2>');
  });

  it('o mês ainda chegando: espera escrita; a falha diz o mês', () => {
    expect(painel({ linha: null, carregando: true })).toContain('Carregando outubro…');
    expect(painel({ linha: null, erro: 'O banco não respondeu.' })).toContain(
      'O planejamento de outubro de 2026 não carregou. O banco não respondeu.',
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A ESCRITA DO PAINEL E A RELEITURA — revisão pós-F43.

   1. A RECUSA É DO MÊS DO PEDIDO. Clicar "Planejamento OK" em outubro e trocar
      de mês pelas setas antes da resposta: o efeito limpava a recusa ao trocar,
      e a resposta de outubro chegava DEPOIS e pintava "Só um administrador…"
      no painel de novembro. A resposta de outro cliente/mês é descartada.
   2. A RELEITURA SE ESPERA. A escrita só termina quando o mês relido chegou —
      é o que segura o `ocupado` (e a `Semanal`, que conta `naBase` para o
      próximo `+`) até os dados estarem frescos.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Uma promessa que a prova solta quando quiser. */
function adiada<T = void>() {
  let soltar!: (v: T) => void;
  let recusar!: (e: unknown) => void;
  const promessa = new Promise<T>((ok, falha) => {
    soltar = ok;
    recusar = falha;
  });
  return { promessa, soltar, recusar };
}

describe('gravarNoPainel — a recusa fica no mês do pedido', () => {
  const recusa = new Error(RECUSA_SO_ADMIN_MARCA);

  it('mesmo cliente e mês: a recusa aparece, e o mês é relido', async () => {
    const recusou = vi.fn();
    const reler = vi.fn(async () => {});
    await gravarNoPainel({ gravar: () => Promise.reject(recusa), aindaAqui: () => true, reler, recusou });
    expect(recusou).toHaveBeenCalledWith(recusa);
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it('trocou de mês antes da resposta: a recusa de outubro NÃO aparece em novembro', async () => {
    const pedido = adiada();
    let mesDaTela = '2026-10';
    const recusou = vi.fn();
    const reler = vi.fn(async () => {});
    const escrita = gravarNoPainel({
      gravar: () => pedido.promessa,
      aindaAqui: () => mesDaTela === '2026-10',
      reler,
      recusou,
    });
    mesDaTela = '2026-11'; // as setas do painel
    pedido.recusar(recusa);
    await escrita;
    expect(recusou).not.toHaveBeenCalled();
    expect(reler).not.toHaveBeenCalled();
  });

  it('o painel já não está lá e a escrita deu certo: a lista é relida, sem esperar e sem recusa', async () => {
    // Abrir o mês de um cliente e fechar o painel (ou abrir outro cliente) antes
    // da resposta: a escrita já está no banco, e a tabela e a faixa "Precisa de
    // atenção" seguiam com o mês de antes ("mês não aberto") até recarregar a
    // página. Reler é seguro: relê o mês que está na página AGORA, e nada do
    // mês do pedido entra sob o nome de outro.
    const reler = vi.fn(async () => {});
    const recusou = vi.fn();
    await gravarNoPainel({ gravar: async () => {}, aindaAqui: () => false, reler, recusou });
    expect(reler).toHaveBeenCalledTimes(1);
    expect(recusou).not.toHaveBeenCalled();
  });

  it('o painel já não está lá e a releitura demora: a escrita não fica esperando por ela', async () => {
    const relida = adiada();
    let terminou = false;
    const escrita = gravarNoPainel({
      gravar: async () => {},
      aindaAqui: () => false,
      reler: () => relida.promessa,
      recusou: vi.fn(),
    }).then(() => {
      terminou = true;
    });
    await escrita;
    expect(terminou).toBe(true);
  });
});

describe('gravarNoPainel — a escrita termina quando o mês relido chegou', () => {
  it('a promessa só se resolve depois da releitura', async () => {
    const relida = adiada();
    let terminou = false;
    const escrita = gravarNoPainel({
      gravar: async () => {},
      aindaAqui: () => true,
      reler: () => relida.promessa,
      recusou: vi.fn(),
    }).then(() => {
      terminou = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(terminou).toBe(false);
    relida.soltar();
    await escrita;
    expect(terminou).toBe(true);
  });
});
