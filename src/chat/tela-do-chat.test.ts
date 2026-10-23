/**
 * A tela do chat no primeiro quadro — F20.5.
 *
 * Mesma técnica de `tela-do-trabalho.test.ts` e `tela-da-conversa.test.ts`:
 * monta sem navegador, sem `useEffect`. Guarda título, barra, lista e o
 * campo com Enter envia.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { definirModoDoChat } from '@/chat/chave';
import { montarPainel, type MensagemParaPainel } from '@/chat/mensagens';
import Chat from '@/pages/Chat';

afterEach(() => {
  definirModoDoChat('desligado');
});

function desenhar(caminho: string): string {
  definirModoDoChat('ligado');
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [caminho] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: '/chat', element: createElement(Chat) }),
        createElement(Route, {
          path: '/chat/:conversationId',
          element: createElement(Chat),
        }),
      ),
    ),
  );
}

describe('a tela do chat monta', () => {
  it('abre em /chat sem estourar', () => {
    expect(() => desenhar('/chat')).not.toThrow();
  });

  /* F29 (Fase 4): o Chat é tela principal — só o título no topo, sem trilha
     e sem o `‹ Voltar` para o Painel que a moldura desenhava (o Chat é irmão
     do Painel, e o caminho entre os dois é a barra). */
  it('tem o título no topo, a barra, e nenhum Voltar', () => {
    const html = desenhar('/chat');
    expect(html).toMatch(/<header class="o-topo[^"]*"[^>]*><div[^>]*><h1 class="o-titulo[^"]*">Chat<\/h1>/);
    expect(html).not.toContain('>Voltar</button>');
    expect(html).not.toContain('tr-trilha');
    expect(html).toContain('q-tela');
    expect(html).toContain('bl-barra');
  });

  it('desenha a grade Obsidian com a lista de conversas', () => {
    const html = desenhar('/chat');
    expect(html).toContain('Conversas');
    expect(html).toContain('ch-grade');
    expect(html).toContain('ch-lista');
  });

  it('o fonte promete Enter envia, Shift+Enter e a parede dos 30 dias', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Chat.tsx'),
      'utf8',
    );
    expect(fonte).toContain('Enter envia');
    expect(fonte).toContain('Shift+Enter');
    expect(fonte).toContain('FRASE_PAREDE_30_DIAS');
  });

  it('o fonte promete editar, apagar com confirmação, teto 4000 e novas mensagens', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Chat.tsx'),
      'utf8',
    );
    expect(fonte).toContain('Editar');
    expect(fonte).toContain('Apagar');
    expect(fonte).toContain(
      "window.confirm('Apagar esta mensagem? Quem já leu verá que ela foi apagada.')",
    );
    expect(fonte).toContain('CHAT_BODY_MAX');
    expect(fonte).toMatch(/passa do teto de \$\{CHAT_BODY_MAX\}/);
    expect(fonte).toContain('novas mensagens');
    expect(fonte).toContain('setTemNovas(true)');
  });

  it('a constante da parede é a frase exata do critério', async () => {
    const { FRASE_PAREDE_30_DIAS, CHAT_BODY_MAX } = await import('@/chat/chave');
    expect(FRASE_PAREDE_30_DIAS).toBe('As mensagens ficam guardadas por 30 dias');
    expect(CHAT_BODY_MAX).toBe(4000);
  });

  it('com a chave desligada, não promete o painel — avisa', () => {
    definirModoDoChat('desligado');
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/chat'] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/chat', element: createElement(Chat) }),
        ),
      ),
    );
    expect(html).toContain('desligado');
  });

  it('o fonte promete novo grupo, nova conversa, membros e divisor de novas', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Chat.tsx'),
      'utf8',
    );
    expect(fonte).toContain('Novo grupo');
    expect(fonte).toContain('Nova conversa');
    expect(fonte).toContain('PainelDoGrupo');
    expect(fonte).toContain('podeMarcarComoLida');
    expect(fonte).toContain('data-divisor="novas"');
    expect(fonte).toContain('desativada');
  });

  it('o fonte promete reagir em qualquer bolha, sem editar a dos outros', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Chat.tsx'),
      'utf8',
    );
    // Reagir vale para qualquer mensagem viva; Editar/Apagar seguem atrás de `minha`.
    // F09: os três são ícones com nome acessível (o leitor e o Tab alcançam).
    expect(fonte).toContain('aria-label="Reagir"');
    expect(fonte).toContain('aria-label="Editar"');
    expect(fonte).toContain('aria-label="Apagar"');
    expect(fonte).toContain('const reagivel =');
    expect(fonte).toContain("m.estado === 'confirmada' && !m.deletedAt && editandoId !== m.id");
    expect(fonte).toContain('{minha && (');
    // Barra, rodapé, Esc e toque longo.
    expect(fonte).toContain('EMOJIS_DE_REACAO');
    expect(fonte).toContain('ch-barra-reacoes');
    expect(fonte).toContain('ch-reacoes');
    expect(fonte).toContain("if (e.key !== 'Escape') return;");
    expect(fonte).toContain('setBarraDeReacao(null);');
    // A barra é desenhada ANTES do botão "Reagir": sem levar o foco ao primeiro
    // emoji, o Tab seguinte pula a barra inteira e cai em Editar. Esc devolve.
    expect(fonte).toContain(".ch-barra-emoji')?.focus()");
    expect(fonte).toContain(".c-acoes .c-acao')?.focus()");
    expect(fonte).toContain('comecarToque');
    expect(fonte).toContain('data-pressionada');
    // Tremor de dedo não cancela o toque longo: só movimento além da tolerância.
    expect(fonte).toContain('saiuDoToqueLongo');
    expect(fonte).toContain('const moverToque =');
    expect(fonte).not.toContain('onPointerMove={reagivel ? soltarToque : undefined}');
    expect(fonte).toContain('rotuloDaReacao');
    // Evento ao vivo de conversa fechada é descartado.
    expect(fonte).toContain("evento.type === 'chat_reaction'");
    expect(fonte).toContain('if (evento.conversationId !== conversaAbertaRef.current) return;');
  });

  it('o CSS das reações só usa token que existe', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const aqui = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(aqui, 'chat.css'), 'utf8');
    const bloco = css.slice(css.indexOf('.ch-reacoes'));
    expect(bloco).toContain('.ch-reacao[data-minha=');
    expect(bloco).toContain('user-select: none');
    const permitidos = new Set([
      '--hair',
      '--ink-0',
      '--ink-1',
      '--ink-2',
      '--mute',
      '--luz',
      '--plat',
      '--dur-1',
      '--ease-out',
      // F09: a camada Foco (declarada em obsidian.css/acabamento.css).
      '--iw-linha',
      '--iw-fundo',
      '--iw-hover',
      '--iw-texto',
      '--iw-texto-2',
      '--iw-e-1',
      '--iw-t-meta',
      '--iw-verde-marca',
      '--iw-verde-marca-texto',
      '--iw-desabilitado',
      '--iw-sobreposicao',
      '--iw-relevo',
    ]);
    for (const achado of bloco.matchAll(/var\((--[a-z0-9-]+)/g)) {
      expect(permitidos.has(achado[1])).toBe(true);
    }
  });

  it('as caixas NovoGrupo e NovaDireta montam com busca', async () => {
    const { NovoGrupo } = await import('@/chat/NovoGrupo');
    const { NovaDireta } = await import('@/chat/NovaDireta');
    const { PainelDoGrupo } = await import('@/chat/PainelDoGrupo');

    const grupo = renderToStaticMarkup(
      createElement(NovoGrupo, {
        pessoas: [{ id: 'u2', name: 'Bia' }],
        euId: 'u1',
        salvando: false,
        aoFechar: () => {},
        aoCriar: async () => {},
      }),
    );
    expect(grupo).toContain('Novo grupo');
    expect(grupo).toContain('Busque por nome');
    expect(grupo).toContain('Bia');

    const direta = renderToStaticMarkup(
      createElement(NovaDireta, {
        pessoas: [{ id: 'u2', name: 'Bia' }],
        euId: 'u1',
        salvando: false,
        aoFechar: () => {},
        aoAbrir: async () => {},
      }),
    );
    expect(direta).toContain('Nova conversa');
    expect(direta).toContain('Bia');

    const painel = renderToStaticMarkup(
      createElement(PainelDoGrupo, {
        kind: 'general',
        nome: 'Geral',
        members: [{ id: 'u1', name: 'Ana', role: null, isActive: true }],
        myRole: null,
        euId: 'u1',
        isSuperadmin: false,
        diretorio: [],
        salvando: false,
        aoFechar: () => {},
        aoRenomear: async () => {},
        aoAdicionar: async () => {},
        aoRemover: async () => {},
        aoSair: async () => {},
        aoPassarPosse: async () => {},
      }),
    );
    // F43 Fase 10: a frase do Geral saiu do pé do painel e foi para o "?" ao
    // lado de "Membros" — fechado, ele é um botão com nome; a frase inteira
    // continua no fonte, dentro dele.
    expect(painel).toContain('aria-label="Explicar: o grupo Geral"');
    expect(painel).not.toContain('ch-painel-grupo-nota');
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'PainelDoGrupo.tsx'), 'utf8');
    expect(fonte).toContain('O Geral é de toda a equipe. Não se renomeia, não se sai e ninguém gerencia a lista.');
    expect(painel).not.toContain('Sair do grupo');
    expect(painel).not.toContain('>Renomear<');
  });

  /* F33 — o balão dizia "Nova conversa" duas vezes: o `rotulo` do `Balao` e um
     `cu-balao-titulo` escrito à mão logo abaixo. Um título só. */
  it('as caixas NovoGrupo e NovaDireta têm um título só', async () => {
    const { NovoGrupo } = await import('@/chat/NovoGrupo');
    const { NovaDireta } = await import('@/chat/NovaDireta');
    const pessoas = [{ id: 'u2', name: 'Bia' }];
    const grupo = renderToStaticMarkup(
      createElement(NovoGrupo, {
        pessoas,
        euId: 'u1',
        salvando: false,
        aoFechar: () => {},
        aoCriar: async () => {},
      }),
    );
    const direta = renderToStaticMarkup(
      createElement(NovaDireta, {
        pessoas,
        euId: 'u1',
        salvando: false,
        aoFechar: () => {},
        aoAbrir: async () => {},
      }),
    );
    expect(grupo.split('>Novo grupo<').length - 1).toBe(1);
    expect(grupo.split('cu-balao-titulo').length - 1).toBe(1);
    expect(direta.split('>Nova conversa<').length - 1).toBe(1);
    expect(direta.split('cu-balao-titulo').length - 1).toBe(1);
  });

  /* F33 — preso ao botão, o balão morava dentro da `.ch-lista` (`overflow:
     auto`) e era cortado por ela. A tela passa o botão como âncora, e o
     balão vai para `document.body` (o portal não roda sem navegador; a prova
     no Chrome é o cenário C13 de `scripts/e2e/chat.mjs`). */
  it('o fonte ancora os dois balões no botão que os abre', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const fonte = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Chat.tsx'),
      'utf8',
    );
    expect(fonte).toContain('ancora={botaoGrupo}');
    expect(fonte).toContain('ancora={botaoDireta}');
    expect(fonte).toContain('ref={setBotaoGrupo}');
    expect(fonte).toContain('ref={setBotaoDireta}');
  });
});

describe('os balões por autoria no painel', () => {
  const fala = (p: Partial<MensagemParaPainel> & { id: string }): MensagemParaPainel => ({
    authorId: 'u1',
    body: 'bom dia',
    kind: 'person',
    createdAt: '2026-09-21T15:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    clientKey: null,
    ...p,
  });

  it('monta separador, minha fala e lápide', () => {
    const blocos = montarPainel(
      [
        fala({ id: '1', body: 'bom dia' }),
        fala({
          id: '2',
          body: '',
          deletedAt: '2026-09-21T15:01:00.000Z',
          createdAt: '2026-09-21T15:01:00.000Z',
        }),
        fala({
          id: '3',
          kind: 'system',
          authorId: null,
          body: 'Ana entrou',
          createdAt: '2026-09-21T15:02:00.000Z',
        }),
      ],
      new Date('2026-09-21T18:00:00.000Z'),
    );
    expect(blocos.some((b) => b.tipo === 'dia')).toBe(true);
    expect(blocos.some((b) => b.tipo === 'fala')).toBe(true);
    expect(blocos.some((b) => b.tipo === 'sistema')).toBe(true);

    // Espelho do HTML: data-minha e lápide — as classes da conversa da tarefa.
    const html = renderToStaticMarkup(
      createElement(
        'div',
        { className: 'c-fio' },
        blocos.map((b) => {
          if (b.tipo === 'dia') {
            return createElement('div', { key: b.chave, className: 'ch-dia' }, b.rotulo);
          }
          if (b.tipo === 'sistema') {
            return createElement('p', { key: b.mensagem.id, className: 'ch-sistema' }, b.mensagem.body);
          }
          const minha = b.mensagem.authorId === 'u1';
          return createElement(
            'div',
            {
              key: b.mensagem.id,
              className: 'c-fala',
              'data-minha': minha,
            },
            b.mensagem.deletedAt
              ? createElement('p', { className: 'ch-lapide' }, 'Mensagem apagada')
              : createElement('div', { className: 'c-texto' }, b.mensagem.body),
          );
        }),
      ),
    );
    expect(html).toContain('data-minha="true"');
    expect(html).toContain('Mensagem apagada');
    expect(html).toContain('Ana entrou');
    expect(html).toContain('bom dia');
  });
});

/* ─────────────── F08 do plano UX: rail + Conversas + conversa ─────────────── */
describe('F08: a composição dedicada do chat', () => {
  it('o título da página segue sendo o h1, mas não gasta faixa; Conversas é o cabeçalho visível', () => {
    const html = desenhar('/chat');
    expect(html).toMatch(/<header class="o-topo[^"]*\bch-topo\b[^"]*"[^>]*id="conteudo"/);
    expect(html).toMatch(/<h1 class="o-titulo">Chat<\/h1>/);
    expect(html).toMatch(/<aside class="ch-lista" aria-labelledby="ch-lista-titulo">/);
    expect(html).toMatch(/<h2 class="ch-lista-titulo" id="ch-lista-titulo">Conversas<\/h2>/);
    // "+ Conversa" à vista; o nome inteiro é o acessível e contém o visível.
    expect(html).toMatch(/aria-label="Nova conversa"[^>]*>.*?<span>Conversa<\/span>/);
    expect(html).toMatch(/aria-label="Novo grupo"[^>]*>.*?<span>Grupo<\/span>/);
    expect(html).toContain('<nav class="ch-lista-itens" aria-label="Lista de conversas">');
  });

  it('o chat pede o contexto "chat" à moldura (rail + Conversas)', () => {
    const html = desenhar('/chat');
    expect(html).toContain('data-contexto="chat"');
  });

  it('as faixas do módulo: uma < 720, duas < 1040, larga daí em diante', async () => {
    const { faixaDoChat } = await import('@/chat/faixa');
    expect(faixaDoChat(296)).toBe('uma');
    expect(faixaDoChat(719)).toBe('uma');
    expect(faixaDoChat(720)).toBe('duas');
    expect(faixaDoChat(920)).toBe('duas'); // 1024 com rail
    expect(faixaDoChat(1039)).toBe('duas');
    expect(faixaDoChat(1040)).toBe('larga');
    expect(faixaDoChat(1176)).toBe('larga'); // 1280 com rail
  });

  it('a linha da conversa diz tipo, horário, não lidas, nome inteiro e a seleção', async () => {
    const { readFile } = await import('node:fs/promises');
    const fonte = await readFile(new URL('../pages/Chat.tsx', import.meta.url), 'utf8');
    expect(fonte).toContain("aria-current={atual ? 'page' : undefined}");
    expect(fonte).toContain('title={nome}');
    expect(fonte).toContain('<RostoDaConversa conversa={c} />');
    expect(fonte).toContain('horarioDaConversa(c.lastMessage?.at)');
    expect(fonte).toContain('seloDeNaoLidas(c.unreadCount)');
    expect(fonte).toContain('sobreAConversa(aberta)');
    // Membros: foco volta ao botão; Esc fecha; painel apontado pelo botão.
    expect(fonte).toContain('botaoMembrosRef.current?.focus()');
    expect(fonte).toContain("aria-controls={painelMembros ? 'ch-membros' : undefined}");
    expect(fonte).toContain('sobreposto={membrosSobrepostos}');
  });

  it('o painel de membros é alvo de foco e diz quando está por cima da leitura', async () => {
    const { PainelDoGrupo } = await import('@/chat/PainelDoGrupo');
    const props = {
      kind: 'group' as const,
      nome: 'Campanha Primavera — aprovação com cliente',
      members: [
        { id: 'u1', name: 'Ana', role: 'owner' as const, isActive: true },
        { id: 'u2', name: 'Bia', role: 'member' as const, isActive: true },
      ],
      myRole: 'owner' as const,
      euId: 'u1',
      isSuperadmin: false,
      diretorio: [],
      salvando: false,
      aoFechar: () => {},
      aoRenomear: async () => {},
      aoAdicionar: async () => {},
      aoRemover: async () => {},
      aoSair: async () => {},
      aoPassarPosse: async () => {},
    };
    const sobre = renderToStaticMarkup(createElement(PainelDoGrupo, { ...props, sobreposto: true }));
    expect(sobre).toMatch(/<aside class="ch-painel-grupo" id="ch-membros" tabindex="-1" aria-label="Membros da conversa" data-sobreposto="true">/);
    expect(sobre).toContain('2 pessoas');
    expect(sobre).toContain('title="Campanha Primavera — aprovação com cliente"');
    const aoLado = renderToStaticMarkup(createElement(PainelDoGrupo, props));
    expect(aoLado).not.toContain('data-sobreposto');
  });

  it('o CSS da composição só usa token que existe e nunca impõe min-width de 480', async () => {
    const { readFile } = await import('node:fs/promises');
    const css = await readFile(new URL('./chat.css', import.meta.url), 'utf8');
    const i = css.indexOf('A COMPOSIÇÃO DO CHAT — F08');
    const bloco = css.slice(i, css.indexOf('.ch-painel-corpo {', i));
    expect(bloco.length).toBeGreaterThan(500);
    expect(bloco).not.toMatch(/min-width:\s*(480px|30rem)/);
    const tokens = new Set([...bloco.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const fontes = await Promise.all(
      ['../ui/obsidian.css', '../ui/acabamento.css', '../ui/cores-do-tema.css'].map((f) =>
        readFile(new URL(f, import.meta.url), 'utf8'),
      ),
    );
    for (const t of tokens) expect(fontes.some((f) => f.includes(`${t}:`)), t).toBe(true);
  });
});

describe('leitura, compositor e estados — F09', () => {
  const fonteDe = async (rel: string) => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
  };

  it('Enter respeita o IME (isComposing e o 229 do Safari) e Shift+Enter quebra linha', async () => {
    const fonte = await fonteDe('../pages/Chat.tsx');
    expect(fonte).toMatch(/e\.key === 'Enter' &&\s*!e\.shiftKey &&\s*!e\.nativeEvent\.isComposing &&\s*e\.nativeEvent\.keyCode !== 229/);
  });

  it('a resposta de envio, edição, apagar e imagem não entra em outra conversa', async () => {
    const fonte = await fonteDe('../pages/Chat.tsx');
    expect(fonte).toContain('if (!mesmaConversa()) return;');
    expect(fonte).toContain('if (sessaoHistoricoRef.current !== sessaoDaEdicao) return;');
    expect(fonte).toContain('if (sessaoHistoricoRef.current !== sessaoDoApagar) return;');
    expect(fonte).toContain('if (conversaAbertaRef.current !== origem) return;');
  });

  it('a falha fica junto da bolha com Tentar de novo; enviando aparece no pé', async () => {
    const fonte = await fonteDe('../pages/Chat.tsx');
    expect(fonte).toContain('data-falha="envio" role="alert"');
    expect(fonte).toContain('onClick={() => tentarDeNovo(m)}');
    expect(fonte).toContain('data-envio="pendente"');
  });

  it('o histórico tem estados próprios: carregando, vazio, sem acesso e erro com Tentar de novo', async () => {
    const fonte = await fonteDe('../pages/Chat.tsx');
    expect(fonte).toContain('titulo="Carregando mensagens…"');
    expect(fonte).toContain("'Nenhuma mensagem por aqui ainda'");
    expect(fonte).toContain('titulo="Você não tem mais acesso a esta conversa"');
    expect(fonte).toContain("acao={{ rotulo: 'Tentar de novo', aoClicar: () => void lerHistorico(aberta.id) }}");
    expect(fonte).toMatch(/e\.status === 403 \|\| e\.status === 404/);
  });

  it('o retorno de conexão lê o estado real do gerente e espera antes de aparecer', async () => {
    const fonte = await fonteDe('../pages/Chat.tsx');
    expect(fonte).toContain('useReconectandoVisivel(live.status)');
    expect(fonte).toContain("if (status !== 'reconectando')");
  });

  it('com o chat desligado, o estado de sem acesso diz para onde ir', () => {
    definirModoDoChat('desligado');
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/chat'] },
        createElement(Routes, null, createElement(Route, { path: '/chat', element: createElement(Chat) })),
      ),
    );
    expect(html).toContain('data-estado="sem-acesso"');
    expect(html).toContain('O chat não está disponível para você');
    expect(html).toContain('href="/meu-trabalho"');
  });

  it('o CSS do F09 mora sob o chat, não reserva altura para as ações e põe clipe e Enviar na linha do campo', async () => {
    const css = await fonteDe('chat.css');
    const bloco = css.slice(css.indexOf('LEITURA E ESCRITA — F09'));
    // Ações flutuam: posição absoluta; escondidas não recebem clique (nem com
    // ponteiro, nem no toque) — só o hover da PRÓPRIA bolha, com ponteiro, as liga.
    expect(bloco).toMatch(/\.ch-fio \.c-fala \.c-acoes \{[^}]*position: absolute;/);
    expect(bloco).toMatch(/^\.ch-fio \.c-fala \.c-acoes \{ pointer-events: none; \}/m);
    expect(bloco).toMatch(/@media \(hover: hover\) \{\s*\.ch-fio \.c-fala:hover \.c-acoes \{ pointer-events: auto; \}/);
    expect(bloco).not.toMatch(/@media \(hover: none\)[^{]*\{\s*\.ch-fio \.c-fala \.c-acoes/);
    expect(bloco).toMatch(/\.ch-fio \.c-fala\[data-ativa='true'\] \.c-acoes/);
    // Uma linha só, sem quebra: clipe · campo · Enviar.
    expect(bloco).toMatch(/\.ch-compositor-linha \{[^}]*display: flex;[^}]*align-items: flex-end;/);
    expect(bloco).not.toMatch(/\.ch-compositor-linha \{[^}]*flex-wrap: wrap/);
    // Nenhuma regra nova sai do escopo do chat para a conversa da tarefa.
    for (const r of bloco.matchAll(/^(\.c-[a-z-]+)[^{]*\{/gm)) {
      throw new Error(`regra sem escopo do chat: ${r[1]}`);
    }
  });
});
