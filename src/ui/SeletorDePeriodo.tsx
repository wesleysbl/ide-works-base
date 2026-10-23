/**
 * Seletor de período — etapa F4.2.
 *
 * POR QUE UM CALENDÁRIO, E NÃO DOIS CAMPOS DE DATA
 *   Dois campos soltos obrigam a pessoa a saber a data que quer **antes** de
 *   abrir a tela. Um calendário deixa ela *ver* o mês e escolher olhando — que é
 *   como se pensa sobre produção de conteúdo: "daquela terça até o fim da
 *   semana", não "de 12/08 a 17/08".
 *
 * COMO SE USA
 *   Clique no dia inicial, depois no final. Clicar de novo recomeça.
 *   Um clique só, sem o segundo, seleciona aquele dia sozinho.
 *
 * TUDO EM DIA CIVIL, SEM FUSO
 *   As datas aqui são `AAAA-MM-DD` como texto, nunca objetos de data com hora.
 *   Data com hora atravessa a virada do dia dependendo do fuso, e o dia 1º vira
 *   dia 31 do mês anterior sem ninguém entender por quê.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { type Day, parseDay } from '@/board/board';
import { nomeDoDia } from '@/board/calendario';
import { hojeNaAgencia } from '@/ui/grade-do-mes';
import { deslocamentoParaCaber } from '@/ui/teto';

export type Periodo = { de: string; ate: string };

const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MESES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** `AAAA-MM-DD` a partir de ano, mês (1-12) e dia — sem passar por fuso. */
const iso = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

const diasNoMes = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const primeiroDiaSemana = (ano: number, mes: number) =>
  new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();

/** Soma dias a uma data civil, sem hora e sem fuso. */
function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const curto = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(2, 4)}`;

export function SeletorDePeriodo({
  valor,
  mesDeReferencia,
  aoMudar,
}: {
  valor: Periodo | null;
  /** `AAAA-MM-01`. Define onde o calendário abre e o que "Mês todo" significa. */
  mesDeReferencia: string;
  aoMudar: (p: Periodo | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [visivel, setVisivel] = useState(mesDeReferencia.slice(0, 7));
  const [inicioParcial, setInicioParcial] = useState<string | null>(null);

  /**
   * O BALÃO CABE NA TELA — F27.
   *
   * Ele abre preso à direita do botão, e no celular isso o jogava 93px para
   * fora da borda esquerda. A medida empurra o balão para dentro só o que
   * falta; onde já cabe (o desktop) o deslocamento é 0 e nada muda.
   *
   * `null` = ainda não medido, e o balão fica invisível nesse primeiro quadro
   * para não piscar fora da tela antes de voltar. `useEffect`, e não
   * `useLayoutEffect`, pela mesma razão de `usePendura`: a suíte desenha no
   * servidor. A conta mora em `@/ui/teto`, onde se prova sem navegador.
   */
  const caixa = useRef<HTMLDivElement>(null);
  const balao = useRef<HTMLDivElement>(null);
  const gatilho = useRef<HTMLButtonElement>(null);
  const [deslocamento, setDeslocamento] = useState<number | null>(null);

  /* FECHAR DEVOLVE O FOCO AO BOTÃO — acessibilidade, WCAG 2.4.3. O balão não
     fechava com `Esc` nem com o clique fora, e escolher um dia (ou "Mês todo")
     fechava e deixava o foco no `<body>`, porque o botão do dia sumia. Fechar por
     clique fora não devolve nada: quem clicou fora escolheu outro lugar. */
  const fechar = (devolverFoco = true) => {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  };

  // Aberto, o foco entra no balão (que tem nome): o leitor de tela anuncia o
  // diálogo e o `Tab` seguinte cai no mês anterior.
  //
  // ⚠️ SÓ DEPOIS DE MEDIDO (`deslocamento !== null`): até lá o balão sai com
  // `visibility: hidden`, e elemento escondido não recebe foco — o `focus()`
  // falhava calado. E uma vez só por abertura: a medida refaz a cada redimensão,
  // e o foco não pode voltar ao balão toda vez que a janela mexe.
  const focadoNestaAbertura = useRef(false);
  useEffect(() => {
    if (!aberto) {
      focadoNestaAbertura.current = false;
      return;
    }
    if (deslocamento === null || focadoNestaAbertura.current) return;
    focadoNestaAbertura.current = true;
    balao.current?.focus();
  }, [aberto, deslocamento]);

  useEffect(() => {
    if (!aberto) return;
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    // No documento, e não no balão: com o foco de volta no botão (que mora fora
    // dele) o `Esc` também precisa fechar — o mesmo desenho de `Menu` e `Gaveta`.
    const noEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAberto(false);
      gatilho.current?.focus();
    };
    document.addEventListener('mousedown', foraDaCaixa);
    document.addEventListener('keydown', noEsc);
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa);
      document.removeEventListener('keydown', noEsc);
    };
  }, [aberto]);

  useEffect(() => {
    if (!aberto) {
      setDeslocamento(null);
      return;
    }
    const medir = () => {
      const c = caixa.current;
      const b = balao.current;
      if (c === null || b === null) return;
      // `offsetWidth` não enxerga o `transform`, e `right` da caixa é a ponta
      // do botão: a medida não se alimenta do próprio deslocamento.
      setDeslocamento(
        deslocamentoParaCaber(
          c.getBoundingClientRect().right,
          b.offsetWidth,
          document.documentElement.clientWidth,
        ),
      );
    };
    medir();
    window.addEventListener('resize', medir);
    // O primeiro clique num dia troca o rótulo do botão ("Mês todo" vira
    // "06/09/26 – 06/09/26"): o botão cresce e, no celular, desce de linha.
    // Medido só ao abrir, o balão ficava preso à ponta ANTIGA e saía 90px
    // pela esquerda em /calendario a 390px — o dia final ficava fora da tela.
    // Observar a caixa refaz a conta quando o botão muda de tamanho.
    const observador =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    if (caixa.current) observador?.observe(caixa.current);
    return () => {
      window.removeEventListener('resize', medir);
      observador?.disconnect();
    };
  }, [aberto]);

  const [ano, mes] = visivel.split('-').map(Number);

  const grade = useMemo(() => {
    const vazios = primeiroDiaSemana(ano, mes);
    const total = diasNoMes(ano, mes);
    return [
      ...Array.from({ length: vazios }, () => null),
      ...Array.from({ length: total }, (_, i) => iso(ano, mes, i + 1)),
    ];
  }, [ano, mes]);

  function clicarNoDia(dia: string) {
    if (inicioParcial === null) {
      setInicioParcial(dia);
      // Um clique só já é um período válido: aquele dia. Esperar o segundo
      // clique para mostrar qualquer coisa faria o primeiro parecer ignorado.
      aoMudar({ de: dia, ate: dia });
      return;
    }
    const [de, ate] = dia < inicioParcial ? [dia, inicioParcial] : [inicioParcial, dia];
    setInicioParcial(null);
    aoMudar({ de, ate });
    fechar();
  }

  function atalho(dias: number) {
    // Hoje em São Paulo: pelo dia UTC, "Últimos 7 dias" terminava amanhã a partir das 21h.
    const fim = hojeNaAgencia();
    setInicioParcial(null);
    aoMudar({ de: somarDias(fim, -(dias - 1)), ate: fim });
    fechar();
  }

  function mesTodo() {
    const [a, m] = mesDeReferencia.split('-').map(Number);
    setInicioParcial(null);
    aoMudar({ de: iso(a, m, 1), ate: iso(a, m, diasNoMes(a, m)) });
    fechar();
  }

  function mudarMes(passo: number) {
    const d = new Date(`${visivel}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + passo);
    setVisivel(d.toISOString().slice(0, 7));
  }

  const rotulo = valor ? `${curto(valor.de)} – ${curto(valor.ate)}` : 'Mês todo';

  const estadoDoDia = (dia: string) => {
    if (inicioParcial === dia) return 'ponta';
    if (!valor) return 'fora';
    if (dia === valor.de || dia === valor.ate) return 'ponta';
    if (dia > valor.de && dia < valor.ate) return 'dentro';
    return 'fora';
  };

  return (
    <div ref={caixa} className="relative inline-block">
      {/* O FIO NÃO É VERDE — F43 Fase 10. Era `border-luz`: no topo do Painel
          e do cliente, o período ficava verde ao lado do "Novo cliente", e
          duas coisas verdes lado a lado não dizem qual é a ação principal.
          Verde é só do botão principal e do lugar atual; o período é uma
          escolha, e leva o fio de campo (como os campos da camada calma). */}
      <button
        ref={gatilho}
        type="button"
        onClick={() => setAberto((a) => !a)}
        // O balão aberto era só desenho: o botão não dizia que abre nem se está aberto.
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="flex items-center gap-2 rounded-full border border-hair-2 px-3 py-1.5 text-sm
                   text-plat transition hover:border-hair-3"
      >
        <span aria-hidden>▦</span>
        {rotulo}
      </button>

      {aberto && (
        /*
          O BALÃO PRECISA SUBIR NA ESCADA DE SUPERFÍCIES.
          Ele nasceu com o fundo em `--ink-0`, que é EXATAMENTE o fundo da
          página: opaco, e ainda assim indistinguível — com borda quase
          invisível e sombra preta sobre preto, lia-se como transparente.

          Painel flutuante fica em `--ink-2`, com fio mais forte e a elevação
          `--e-3` do design system, que é a única desenhada para o escuro (ela
          traz um fio de luz por dentro, além da sombra).
        */
        <div
          ref={balao}
          role="dialog"
          aria-label="Escolher o período"
          tabIndex={-1}
          className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1rem)] rounded-xl border p-3"
          style={{
            background: 'var(--ink-2)',
            borderColor: 'var(--hair-3)',
            boxShadow: 'var(--e-3)',
            transform: deslocamento ? `translateX(${deslocamento}px)` : undefined,
            visibility: deslocamento === null ? 'hidden' : undefined,
          }}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => mudarMes(-1)}
              aria-label="mês anterior"
              className="h-7 w-7 rounded-md border border-hair-2 text-plat-dim hover:text-plat"
            >
              ‹
            </button>
            <div className="text-sm font-medium">
              {MESES[mes - 1]} de {ano}
            </div>
            <button
              type="button"
              onClick={() => mudarMes(1)}
              aria-label="próximo mês"
              className="h-7 w-7 rounded-md border border-hair-2 text-plat-dim hover:text-plat"
            >
              ›
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-mute">
            {DIAS_DA_SEMANA.map((d, i) => (
              <div key={i}>{d}</div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {grade.map((dia, i) =>
              dia === null ? (
                <div key={`vazio-${i}`} />
              ) : (
                <button
                  key={dia}
                  type="button"
                  onClick={() => clicarNoDia(dia)}
                  /* O NOME E O ESTADO DO DIA — WCAG 4.1.2 e 1.4.1. O botão dizia
                     só "15", e o início, o fim e o miolo do período existiam
                     como cor. Agora: a data por extenso, e `aria-pressed` para
                     o que está dentro do período escolhido. */
                  aria-label={nomeDoDia(parseDay(dia) as Day)}
                  aria-pressed={estadoDoDia(dia) !== 'fora'}
                  className={
                    'h-8 rounded-md text-sm transition ' +
                    {
                      ponta: 'bg-plat font-semibold text-ink-0',
                      dentro: 'bg-luz-soft text-luz',
                      // O balão agora é `--ink-2`; o realce ao passar o mouse
                      // precisa subir junto, senão ele some no próprio fundo.
                      fora: 'text-plat-dim hover:bg-ink-3',
                    }[estadoDoDia(dia)]
                  }
                >
                  {Number(dia.slice(8, 10))}
                </button>
              ),
            )}
          </div>

          <p className="mt-3 text-center text-xs text-mute">
            {inicioParcial ? 'agora clique no dia final' : 'clique no dia inicial e depois no final'}
          </p>

          <div className="mt-3 flex justify-center gap-2">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => atalho(d)}
                className="rounded-full border border-hair-2 px-3 py-1 text-xs text-plat-dim
                           hover:border-hair-3"
              >
                {d}d
              </button>
            ))}
            <button
              type="button"
              onClick={mesTodo}
              className="rounded-full border border-hair-2 px-3 py-1 text-xs text-plat-dim
                         hover:border-hair-3"
            >
              Mês todo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
