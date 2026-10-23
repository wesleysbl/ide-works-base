/**
 * ESCOLHER O DIA — etapa F17.42.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTAVA ERRADO, E ERA UMA SUPOSIÇÃO ESCRITA NO CÓDIGO
 *
 *   A grade semanal criava conteúdo com o dia de HOJE quando hoje caía dentro
 *   da semana clicada. O comentário dizia que era "o que a pessoa quer dizer".
 *   Não era: quem opera esta tela está **lançando o que já aconteceu**, muitas
 *   vezes com atraso — atualização pura, como no Sistema IDE legado. Hoje é
 *   justamente o dia que quase nunca é o certo.
 *
 *   E o efeito não é cosmético. A semana SAI DA DATA (ver `delivery/semanas`):
 *   dia errado põe o conteúdo na semana errada, e o medidor do mês erra junto.
 *
 * NENHUM DIA NASCE MARCADO — E ISSO É A DECISÃO DESTA PEÇA
 *   A primeira versão desta etapa deixava a sugestão pré-marcada, "para se
 *   trocar num clique". O usuário recusou: *"nem tem essa de um clique"*. Um
 *   padrão pré-marcado faz aceitar sem olhar, e produziria em silêncio
 *   exatamente o erro que a etapa veio consertar.
 *
 *   Então `valor` só vem preenchido quando o item JÁ TEM data — ali o marcado
 *   é fato, e não palpite. Ao criar, o seletor abre sem escolha nenhuma, e
 *   nada é gravado enquanto ninguém clicar num dia.
 *
 * O PASSADO CUSTA O MESMO QUE O FUTURO
 *   Um toque em `‹` e o mês anterior está aberto. Não há dia desabilitado nem
 *   aviso de data retroativa: retroativo é o caso comum aqui, não o desvio.
 *
 * A GRADE É A DA F17.40, E A ARITMÉTICA TAMBÉM
 *   As casas saem de `casasDoMes` (`@/ui/grade-do-mes`), que faz dia civil em
 *   número inteiro e tem teste próprio. Não há `new Date(x).toISOString()`
 *   sobre data vinda de fora em lugar nenhum deste arquivo — existe tarefa real
 *   com prazo `82025-08-07`, e `toISOString` devolve `+082025-08-07`, que todo
 *   `slice(0, 10)` cortaria errado.
 *
 *   O DESENHO é o das classes `.cu-cal-*`, as mesmas do seletor de data da
 *   tarefa. Pixel por pixel a mesma peça — e nenhuma cor literal: tudo em
 *   `var()`.
 *
 * ⚠️ DÍVIDA CONHECIDA
 *   `MenuDeData`, em `src/board/menus.tsx`, desenha esta mesma grade em JSX
 *   próprio. Ela deveria chamar `CalendarioDeUmMes` daqui — são quatro linhas —,
 *   mas `src/board/` estava com outra etapa em andamento quando esta foi
 *   escrita, e mexer lá seria trombar com ela. A aritmética e o estilo já são
 *   comuns; sobrou o JSX.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react';

import { type Day, parseDay, today } from '@/board/board';
import { MESES, iso, mesVizinho, nomeDoDia } from '@/board/calendario';
import { Balao } from '@/board/menus';
import { IconeEsquerda, IconeDireita } from '@/ui/Icones';
import { DIAS_DA_SEMANA, casasDoMes } from '@/ui/grade-do-mes';
import type { Lado } from '@/ui/teto';

/**
 * ⚠️ A FOLHA VEM COM A PEÇA, e isto foi MEDIDO na tela.
 *
 * `clickup.css` é importada pelas páginas do quadro (`Quadro`, `Espaco`,
 * `MeuTrabalho`, `ModalDeTarefa`), e a ficha do cliente não é uma delas. Sem
 * este `import`, o calendário abria na aba semanal com as classes certas e
 * NENHUMA regra: sem grade de sete colunas, os dias saíam em fila corrida
 * (`123456789101112…`), e o balão sem fundo nem borda, por cima do texto da
 * página. A captura `02-o-mais-pergunta-o-dia.png` da primeira rodada mostra.
 *
 * De quebra o `?` da própria aba semanal — que é `Ajuda`, do mesmo módulo —
 * abria assim desde que a aba existe. Quem pede as classes passa a trazer a
 * folha junto, e o defeito não volta por esquecimento de uma tela nova.
 */
import '@/ui/clickup.css';

/** Um intervalo de orientação — a semana que abriu o seletor, por exemplo. */
export type Faixa = { de: string; ate: string };

/**
 * O calendário de um mês, sem balão em volta.
 *
 * Separado do balão porque o balão é o jeito de aparecer, e não a peça: quem
 * quiser o mesmo calendário embutido numa tela pede este pedaço.
 */
export function CalendarioDeUmMes({
  mesInicial,
  valor,
  faixa,
  apenasNaFaixa = false,
  aoEscolher,
}: {
  /** `AAAA-MM` — onde o calendário abre. */
  mesInicial: string;
  /** O dia que o item já tem, ou `null`. NUNCA uma sugestão. */
  valor: string | null;
  /** Fundo claro nos dias deste intervalo. Orientação, não escolha. */
  faixa: Faixa | null;
  /**
   * A faixa deixa de orientar e passa a LIMITAR — F35. O `+` de uma célula da
   * aba Semana do Planejamento cria "na semana 2", e um dia fora dela poria a
   * peça noutra célula, longe de onde se clicou. Fora da faixa o dia fica
   * desabilitado. Ausente, nada muda: a grade semanal da ficha continua
   * deixando o passado e o resto do mês a um clique.
   */
  apenasNaFaixa?: boolean;
  aoEscolher: (dia: string) => void;
}) {
  const [visivel, setVisivel] = useState(() => (valor ?? mesInicial).slice(0, 7));
  const [ano, mes] = visivel.split('-').map(Number);

  const casas = useMemo(() => casasDoMes(visivel), [visivel]);
  // O relógio, e não dado de fora: `today()` lê ano, mês e dia do próprio
  // `Date` local, sem passar por texto. O anel de hoje é orientação — ele não
  // escolhe nada.
  const hoje = iso(today());

  const andarMes = (passo: number) => {
    const v = mesVizinho(ano, mes, passo);
    setVisivel(`${v.ano}-${String(v.mes).padStart(2, '0')}`);
  };

  return (
    <div className="cu-cal">
      <div className="cu-cal-topo">
        <button
          type="button"
          className="cu-icone-btn"
          aria-label="Mês anterior"
          onClick={() => andarMes(-1)}
        >
          <IconeEsquerda className="h-3.5 w-3.5" />
        </button>
        <span className="cu-cal-mes">
          {MESES[mes - 1]} {ano}
        </span>
        <button
          type="button"
          className="cu-icone-btn"
          aria-label="Próximo mês"
          onClick={() => andarMes(1)}
        >
          <IconeDireita className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="cu-cal-grade">
        {DIAS_DA_SEMANA.map((d, i) => (
          <div key={`cab-${i}`} className="cu-cal-cabecalho">
            {d}
          </div>
        ))}
        {casas.map((dia, i) =>
          dia === null ? (
            <div key={`vazio-${i}`} />
          ) : (
            <button
              key={dia}
              type="button"
              className="cu-cal-dia"
              /* O NOME E O ESTADO DO DIA — WCAG 4.1.2 e 1.4.1. Ver `nomeDoDia`. */
              aria-label={nomeDoDia(parseDay(dia) as Day)}
              aria-pressed={dia === valor}
              aria-current={dia === hoje ? 'date' : undefined}
              data-hoje={dia === hoje}
              data-escolhido={dia === valor}
              /* Nunca no dia já escolhido: a regra da faixa vem depois da do
                 escolhido na folha, e venceria o preenchimento dele. */
              data-faixa={
                dia !== valor && faixa !== null && dia >= faixa.de && dia <= faixa.ate
              }
              disabled={apenasNaFaixa && faixa !== null && (dia < faixa.de || dia > faixa.ate)}
              onClick={() => aoEscolher(dia)}
            >
              {Number(dia.slice(8, 10))}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * O calendário num balão preso ao botão que o abriu.
 *
 * O balão vem de `Balao`: dele saem o teto medido da F17.35 — ele cabe numa
 * janela de 720 —, o `Esc`, o clique fora e, porque tem título, o `X` da
 * F17.33. As três saídas sem escrever nenhuma delas de novo.
 */
export function SeletorDeDia({
  rotulo,
  mesInicial,
  valor = null,
  faixa = null,
  apenasNaFaixa = false,
  ancora,
  lado = 'baixo-direita',
  aoEscolher,
  aoFechar,
}: {
  /** O que se está escolhendo, em duas ou três palavras. Vira o título. */
  rotulo: string;
  mesInicial: string;
  valor?: string | null;
  faixa?: Faixa | null;
  /** Ver `CalendarioDeUmMes`. */
  apenasNaFaixa?: boolean;
  ancora: HTMLElement | null;
  lado?: Lado;
  aoEscolher: (dia: string) => void;
  aoFechar: () => void;
}) {
  return (
    <Balao lado={lado} ancora={ancora} papel="dialog" rotulo={rotulo} aoFechar={aoFechar}>
      <CalendarioDeUmMes
        mesInicial={mesInicial}
        valor={valor}
        faixa={faixa}
        apenasNaFaixa={apenasNaFaixa}
        aoEscolher={aoEscolher}
      />
    </Balao>
  );
}
