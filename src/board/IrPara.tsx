/**
 * "IR PARA…" — F43, Fase 9: o gatilho no alto da barra e a janela da busca.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS DUAS PEÇAS
 *
 *   `GatilhoDoIrPara` — o campo "Buscar ou ir para…" logo abaixo da marca, com
 *     a tecla escrita ao lado (`Ctrl K`, ou `⌘K` no Mac). É um BOTÃO com cara de
 *     campo, e não um campo: digitar ali não faria nada que a janela não faça
 *     melhor, e um campo de verdade roubaria o `Tab` da barra a cada passagem.
 *     Em `Somente ícones` vira só a lupa, com o nome no `aria-label` e no
 *     `title` — a mesma regra dos itens da barra.
 *
 *   `JanelaDoIrPara` — a janela que abre por cima, no alto da tela. Um campo e
 *     a lista dos destinos agrupados (Telas, Clientes, Listas e, por último,
 *     "Procurar tarefas com …"). As regras — o que entra, em que ordem, o teto
 *     de cada grupo — moram em `@/board/ir-para`, puras e provadas lá.
 *
 * O TECLADO É O DE UMA CAIXA DE COMBINAÇÃO (o padrão "combobox" da W3C)
 *   O foco fica SEMPRE no campo; `↑`/`↓` mudam a opção ativa, que o leitor de
 *   tela ouve por `aria-activedescendant`; `Enter` vai; `Esc` fecha e devolve o
 *   foco a quem abriu. As opções não recebem foco — se recebessem, cada seta
 *   tiraria o cursor do campo e a próxima letra digitada iria para lugar
 *   nenhum. O mouse faz o mesmo: passar acende, clicar vai.
 *
 * A JANELA É A `Janela` (F17.33), EM PORTAL
 *   O mesmo `Esc`, o mesmo clique fora testado pelo alvo e o mesmo foco que
 *   volta (`devolverFoco`). Em portal no `body` pela razão de `Personalizar` e
 *   do `PainelLateral`: a barra é `sticky` (e, no celular, a gaveta), e sticky
 *   prende o `fixed` no contexto dela — a janela ficaria por baixo do
 *   conteúdo. Sem DOM (a suíte desenha no servidor) ela sai no lugar.
 *
 * NAVEGA PELO ROTEADOR
 *   Quem decide o destino é quem abriu (`aoIr`, na `BarraLateral`), com o
 *   `navigate` do roteador — e é isso que faz a guarda de saída da ficha
 *   (`Moldura`, "Sair sem salvar?") perguntar antes, como pergunta para a barra.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type KeyboardEvent, useEffect, useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { buildFullTree } from '@/board/arvore';
import { useArvoreCompleta } from '@/board/arvore-compartilhada';
import { TETO_DA_BUSCA } from '@/board/filtro';
import { type Destino, destinosDaArvore, moverAtivo, resultadosDoIrPara } from '@/board/ir-para';
import { prenderOTab } from '@/ui/foco';
import { IconeBusca } from '@/ui/Icones';
import { BotaoDeFechar, Janela } from '@/ui/janela';
import '@/ui/ir-para.css';

/** O nome do gatilho e da janela — um só, para quem procura pelo nome achar os dois. */
const NOME = 'Buscar ou ir para…';

/* ───────────────────────────── o gatilho ───────────────────────────── */

export function GatilhoDoIrPara({
  soIcones,
  tecla,
  aberto,
  aoAbrir,
}: {
  /** A barra em `Somente ícones`: só a lupa, o nome vai para o `aria-label`. */
  soIcones: boolean;
  /** Como a tecla se escreve aqui — `teclaDoAtalho`. */
  tecla: string;
  aberto: boolean;
  aoAbrir: () => void;
}) {
  return (
    <button
      type="button"
      className="bl-ir"
      onClick={aoAbrir}
      aria-haspopup="dialog"
      aria-expanded={aberto}
      /* O atalho dito ao leitor de tela, pelo atributo que existe para isso —
         e não no nome, que ficaria "Buscar ou ir para… Ctrl K". */
      aria-keyshortcuts="Control+K Meta+K"
      aria-label={soIcones ? NOME : undefined}
      title={`${NOME} (${tecla})`}
    >
      <IconeBusca className="h-4 w-4 bl-ir-lupa" />
      {!soIcones && (
        <>
          <span className="bl-ir-texto">{NOME}</span>
          {/* Desenho, e não nome: `aria-hidden`, o atalho já está em
              `aria-keyshortcuts`. */}
          <kbd className="bl-ir-tecla" aria-hidden>
            {tecla}
          </kbd>
        </>
      )}
    </button>
  );
}

/* ───────────────────────────── a janela ───────────────────────────── */

export function JanelaDoIrPara({
  telas,
  podeVerClientes,
  procurarTarefasOk,
  aoIr,
  aoFechar,
  consultaInicial = '',
}: {
  /** As telas que a sessão alcança — `telasDoIrPara`, calculado pela barra. */
  telas: readonly Destino[];
  /** A área `entrega` (a ficha do cliente). Sem ela, nenhum cliente é oferecido. */
  podeVerClientes: boolean;
  /** A área `quadro` (`Todas as tarefas`). Sem ela, "Procurar tarefas" não aparece. */
  procurarTarefasOk: boolean;
  aoIr: (destino: Destino) => void;
  aoFechar: () => void;
  /** Só para a suíte desenhar a janela já com algo digitado. */
  consultaInicial?: string;
}) {
  const [consulta, setConsulta] = useState(consultaInicial);
  const [ativo, setAtivo] = useState(0);
  const base = useId();

  /* A MESMA árvore da barra: consulta compartilhada, e dentro da validade não
     pede nada de novo (`useArvoreCompleta`, F17.CARGA02). */
  const { linhas, estado } = useArvoreCompleta();
  const daArvore = useMemo(
    () => destinosDaArvore(linhas === null ? [] : buildFullTree(linhas), podeVerClientes),
    [linhas, podeVerClientes],
  );
  const grupos = useMemo(
    () =>
      resultadosDoIrPara(consulta, {
        telas,
        clientes: daArvore.clientes,
        lugares: daArvore.lugares,
        procurarTarefasOk,
      }),
    [consulta, telas, daArvore, procurarTarefasOk],
  );
  const opcoes = useMemo(() => grupos.flatMap((g) => g.itens), [grupos]);
  /* Onde cada grupo começa na lista corrida: a seta anda pela lista inteira,
     atravessando os grupos, e cada opção precisa do seu número nela. */
  const inicios = useMemo(() => {
    let n = 0;
    return grupos.map((g) => {
      const inicio = n;
      n += g.itens.length;
      return inicio;
    });
  }, [grupos]);

  /* A lista pode encolher por baixo da opção ativa (a árvore chegou, a
     consulta mudou): a ativa nunca aponta para fora dela. */
  const ativa = opcoes.length === 0 ? -1 : Math.min(ativo, opcoes.length - 1);
  const idDaLista = `${base}-lista`;
  const idDaOpcao = (i: number) => `${base}-opcao-${i}`;
  const idAtivo = ativa < 0 ? undefined : idDaOpcao(ativa);

  /* A opção ativa sempre à vista: com a lista rolada, `↓` acenderia uma linha
     escondida embaixo da borda. `nearest` não mexe quando ela já aparece. Os
     grupos entram na conta porque uma consulta nova devolve a ativa ao
     primeiro achado — o mesmo `id` de antes, numa lista que pode estar rolada. */
  useEffect(() => {
    if (idAtivo === undefined) return;
    document.getElementById(idAtivo)?.scrollIntoView({ block: 'nearest' });
  }, [idAtivo, grupos]);

  const aoTeclarNoCampo = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo(moverAtivo(ativa, opcoes.length, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      // O `Enter` que fecha uma sugestão do teclado de acentos não é escolha.
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      const destino = opcoes[ativa];
      if (destino) aoIr(destino);
    }
  };

  /* Na caixa inteira (campo e `X`): a mesma tecla que abriu, fecha — o atalho
     global não dispara com o foco aqui dentro (`ehAtalhoDaBusca`), e sem isto
     o `Ctrl + K` cairia no navegador, que no Chrome leva à barra de endereço.
     E o `Tab` não sai da janela para a página coberta pelo véu. */
  const aoTeclarNaCaixa = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      aoFechar();
      return;
    }
    prenderOTab(e, e.currentTarget.closest<HTMLElement>('[role="dialog"]'));
  };

  const texto = consulta.trim();

  const janela = (
    <Janela rotulo="Buscar ou ir para" largura="max-w-xl ir-janela" aoFechar={aoFechar} devolverFoco>
      <div className="ir-caixa" onKeyDown={aoTeclarNaCaixa}>
        <div className="ir-campo">
          <IconeBusca className="h-4 w-4 ir-lupa" />
          <input
            // O foco nasce no campo: quem abriu a janela veio digitar. E nasce
            // antes do efeito da `Janela`, que então não o rouba para a caixa.
            autoFocus
            type="text"
            role="combobox"
            aria-label="Buscar telas, clientes e listas"
            aria-expanded="true"
            aria-controls={idDaLista}
            aria-activedescendant={idAtivo}
            aria-autocomplete="list"
            placeholder="Tela, cliente, lista ou tarefa…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={TETO_DA_BUSCA}
            value={consulta}
            onChange={(e) => {
              setConsulta(e.target.value);
              // Consulta nova, lista nova: a ativa volta ao primeiro achado.
              setAtivo(0);
            }}
            onKeyDown={aoTeclarNoCampo}
          />
          <BotaoDeFechar aoFechar={aoFechar} />
        </div>

        <div id={idDaLista} role="listbox" aria-label="Destinos" className="ir-resultados">
          {grupos.map((g, n) => {
            const idDoTitulo = `${base}-grupo-${g.chave}`;
            return (
              <div key={g.chave} role="group" aria-labelledby={idDoTitulo} className="ir-grupo">
                <div id={idDoTitulo} role="presentation" className="ir-grupo-titulo">
                  {g.rotulo}
                </div>
                {g.itens.map((d, j) => {
                  const i = inicios[n] + j;
                  const eAtiva = i === ativa;
                  return (
                    <div
                      key={d.chave}
                      id={idDaOpcao(i)}
                      role="option"
                      aria-selected={eAtiva}
                      className="ir-opcao"
                      data-ativa={eAtiva ? 'true' : undefined}
                      data-tipo={d.tipo}
                      /* O clique não tira o foco do campo: sem isto, o
                         `mousedown` focaria a linha e o `Enter` seguinte não
                         teria campo para ouvir. */
                      onMouseDown={(e) => e.preventDefault()}
                      /* `mousemove`, e não `mouseenter`: a lista rolando sob
                         um mouse parado não deve trocar a ativa sozinha. */
                      onMouseMove={() => {
                        if (!eAtiva) setAtivo(i);
                      }}
                      onClick={() => aoIr(d)}
                    >
                      <span className="ir-opcao-nome">{d.rotulo}</span>
                      {d.detalhe && <span className="ir-opcao-onde">{d.detalhe}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {opcoes.length === 0 && (
          <p className="ir-nota">
            {texto === '' ? 'Nenhuma tela ao seu alcance.' : `Nada encontrado com “${texto}”.`}
          </p>
        )}
        {/* A árvore ainda no ar, ou recusada: a busca diz o que falta, em vez
            de deixar a ausência de clientes e listas parecer um "não existe". */}
        {texto !== '' && estado === 'carregando' && (
          <p className="ir-nota">Carregando clientes e listas…</p>
        )}
        {texto !== '' && estado === 'recusada' && (
          <p className="ir-nota">Clientes e listas não carregaram agora — a busca mostra só as telas.</p>
        )}

        {/* O que o olho já vê pela lista, dito ao leitor de tela. */}
        <p className="sr-only" role="status">
          {opcoes.length === 1 ? '1 destino' : `${opcoes.length} destinos`}
        </p>
        <p className="ir-dica" aria-hidden>
          <kbd>↑</kbd> <kbd>↓</kbd> escolher · <kbd>Enter</kbd> abrir · <kbd>Esc</kbd> fechar
        </p>
      </div>
    </Janela>
  );

  return typeof document === 'undefined' ? janela : createPortal(janela, document.body);
}
