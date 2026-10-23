/**
 * O calendário editorial de todos — etapa F5.1; desde a F43 (Fase 4), a
 * terceira visão do Planejamento.
 *
 * A MESMA TABELA, OUTRA LENTE
 *   Não há dado próprio aqui. Cada quadradinho mostra os itens de conteúdo que
 *   têm data naquele dia — os mesmos que a tela do cliente lista e que o medidor
 *   conta. Marcar concluído aqui ou lá dá no mesmo, porque é a mesma linha.
 *
 *   No Sistema IDE são duas tabelas, e os mesmos conteúdos aparecem cadastrados
 *   duas vezes em 29 dos 30 clientes que usam o calendário.
 *
 * A GRADE NÃO MORA AQUI — F17.40
 *   Ela é `@/ui/GradeDoMes`, porque a ficha do cliente tem o mês dele. Esta é
 *   a lente `de-todos`: o conteúdo diz de QUEM é. A aba do cliente é a mesma
 *   peça com a outra lente. A BUSCA mora em `@/ui/conteudos-do-mes` — lá está
 *   medido por que ela saiu da tela: a versão antiga deixava a resposta
 *   atrasada de um mês sobrescrever a do mês pedido, em silêncio.
 *
 * DE TELA PARA VISÃO — F43, Fase 4
 *   Até aqui isto era a página `/calendario`, com mês próprio. As críticas
 *   ("não sabem onde começa ou termina algo") passavam por aí: o mesmo mês
 *   planejado em cinco telas, cada uma com o seu. Agora o MÊS VEM DE FORA — é o
 *   do Planejamento, o mesmo das visões Contrato e Semanas, e trocar de visão
 *   não o perde. `/calendario` continua funcionando e leva para cá.
 *
 *   ⚠️ UM CONTROLE DE MÊS SÓ NA TELA. Nesta visão o Planejamento esconde o mês
 *   do topo e fica a barra daqui (‹ › e o campo "Mês do calendário", Hoje, o
 *   período, Mês/Agenda): é ela que o calendário sempre teve, com o "Hoje" e o
 *   campo que o topo não tem. Dois "Próximo mês" na mesma tela seriam dois
 *   botões com o mesmo nome — para o leitor de tela, uma charada.
 *
 *   O `+ Marcar` do topo é o do Planejamento (um botão só na tela, que nesta
 *   visão se chama `+ Marcar`, como sempre se chamou aqui). Clicar numa peça
 *   ou no `+` de um dia pede a mesma janela a quem a mostra (`aoMarcar`).
 */

import { type CSSProperties, useMemo, useState } from 'react';

import { AlternadorDeVista } from '@/ui/AlternadorDeVista';
import { AgendaDoMes, type FocoNoDia, GradeDoMes, IconeDoTipoDeConteudo } from '@/ui/GradeDoMes';
import { IconeDireita, IconeEsquerda } from '@/ui/Icones';
import { type AlvoDaMarcacao } from '@/ui/MarcarNoDia';
import { useConteudosDoMes } from '@/ui/conteudos-do-mes';
import {
  COR_DO_COMPROMISSO,
  TIPO_COR,
  TIPO_ROTULO,
  deslocarMes,
  ehCompromisso,
  FORMAS_DO_CALENDARIO,
  type FormaDoCalendario,
  formaInicial,
  janelaDoMes,
} from '@/ui/grade-do-mes';
import { mesValido } from '@/painel/visoes-do-planejamento';
import { Aviso } from '@/ui/primitivos';
import { type Periodo, SeletorDePeriodo } from '@/ui/SeletorDePeriodo';

export function CalendarioGeral({
  mes,
  aoMudarMes,
  hoje,
  recarga,
  aoMarcar,
}: {
  /** `AAAA-MM` — o mês do Planejamento. */
  mes: string;
  /** Troca o mês da PÁGINA (todas as visões), e não só o daqui. */
  aoMudarMes: (mes: string) => void;
  /** `AAAA-MM-DD`, no fuso da agência (F12). */
  hoje: string;
  /** Muda depois de gravar (aqui ou noutra visão): o mês relê. */
  recarga: number;
  /** Abre a janela de marcar — num dia, numa peça. Quem a mostra é a página. */
  aoMarcar: (alvo: AlvoDaMarcacao) => void;
}) {
  /* O PERÍODO É DO MÊS EM QUE FOI ESCOLHIDO — a mesma regra da F35 para os
     dados. O mês pode mudar por fora (o painel do cliente troca o mês da
     página); um período de outubro aplicado sobre dezembro desenharia a
     grade de um mês embaixo do nome de outro. */
  const [periodoGuardado, setPeriodoGuardado] = useState<{ mes: string; periodo: Periodo } | null>(null);
  const periodo = periodoGuardado?.mes === mes ? periodoGuardado.periodo : null;
  const [forma, setForma] = useState<FormaDoCalendario>(formaInicial);
  const [foco, setFoco] = useState<FocoNoDia | null>(null);
  const janela = useMemo(() => janelaDoMes(mes, periodo), [mes, periodo]);
  const { entradas, erro, carregando, tentarDeNovo } = useConteudosDoMes(janela, undefined, recarga);

  const quantos = useMemo(
    () => ({
      entregas: entradas.filter((e) => !ehCompromisso(e)).length,
      compromissos: entradas.filter(ehCompromisso).length,
      concluidas: entradas.filter((e) => !ehCompromisso(e) && e.isCompleted).length,
    }),
    [entradas],
  );

  /* Trocar de mês apaga o período, como sempre fez — mesmo quando o mês é o
     mesmo (o `Hoje` no mês de hoje volta ao mês todo). */
  const irParaMes = (novo: string) => {
    setPeriodoGuardado(null);
    aoMudarMes(novo);
  };

  /* "Hoje" leva ao mês de hoje E ao dia de hoje — na grade, a casa entra na
     tela; na agenda, o dia recebe o foco. `n` repete o pedido a cada clique. */
  const irParaHoje = () => {
    irParaMes(hoje.slice(0, 7));
    setFoco((f) => ({ dia: hoje, n: (f?.n ?? 0) + 1 }));
  };

  /* No celular, tocar numa casa da grade leva ao dia na agenda. */
  const verDia = (dia: string) => {
    setForma('agenda');
    setFoco((f) => ({ dia, n: (f?.n ?? 0) + 1 }));
  };

  const alcas = {
    aoMarcarNoDia: (dia: string) => aoMarcar({ modo: 'novo', dia }),
    aoAbrirEntrada: (entrada: (typeof entradas)[number]) => aoMarcar({ modo: 'existente', entrada }),
  };

  return (
    <div className="w-full min-w-0" data-visao="calendario">
      {/* O MÊS, O PERÍODO, HOJE E A FORMA DE VER — numa barra só, logo abaixo
          do topo (F12): no topo, cinco controles de alturas diferentes
          quebravam em três linhas no celular. */}
      <div className="cal-barra" role="toolbar" aria-label="Mês e forma de ver o calendário">
        <div className="cal-mes-nav">
          <button
            type="button"
            className="cal-nav-botao"
            aria-label="Mês anterior"
            title="Mês anterior"
            onClick={() => irParaMes(deslocarMes(mes, -1))}
          >
            <IconeEsquerda />
          </button>
          {/* O campo nativo continua: ele escreve o mês por extenso no
              idioma do navegador e abre o seletor do sistema no toque. Só
              passa o mês que o endereço também aceita (`mesValido`): o que
              vai para a tela é o que volta no link colado. */}
          <input
            type="month"
            className="cal-mes-campo tnum"
            value={mes}
            aria-label="Mês do calendário"
            onChange={(e) => {
              const novo = mesValido(e.target.value);
              if (novo) irParaMes(novo);
            }}
          />
          <button
            type="button"
            className="cal-nav-botao"
            aria-label="Próximo mês"
            title="Próximo mês"
            onClick={() => irParaMes(deslocarMes(mes, 1))}
          >
            <IconeDireita />
          </button>
        </div>
        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm cal-hoje"
          aria-label={`Hoje, ${hoje.split('-').reverse().join('/')}`}
          onClick={irParaHoje}
        >
          Hoje
        </button>
        <SeletorDePeriodo
          valor={periodo}
          mesDeReferencia={`${mes}-01`}
          aoMudar={(p) => setPeriodoGuardado(p ? { mes, periodo: p } : null)}
        />
        <AlternadorDeVista
          rotulo="Forma de ver o calendário"
          opcoes={FORMAS_DO_CALENDARIO}
          valor={forma}
          aoEscolher={setForma}
          className="cal-forma"
        />
      </div>

      {/* A CONTAGEM E A LEGENDA JUNTAS, LOGO ACIMA DO QUE ELAS EXPLICAM —
          R06. A legenda morava debaixo da grade: com 117 conteúdos, ela
          ficava a uma tela inteira de distância do que explicava.

          ⚠️ DUAS CONTAGENS, E NÃO UMA — F17.44. Compromisso não é
          conteúdo; somar as duas coisas na tela é o primeiro passo para
          somá-las na cota. */}
      <div className="cal-resumo-linha">
        <p className="cal-contagem" role="status">
          {carregando
            ? 'Carregando…'
            : erro !== null
              ? // Sem leitura, sem contagem: "0 conteúdo(s)" seria afirmar o que não se sabe.
                'Sem a leitura deste mês.'
              : [
                  `${quantos.entregas} conteúdo(s) agendado(s)`,
                  quantos.entregas > 0 ? `${quantos.concluidas} concluído(s)` : null,
                  quantos.compromissos > 0 ? `${quantos.compromissos} compromisso(s) — fora da cota` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
        </p>
        {/* A legenda explica cor e sinal da GRADE; a agenda escreve o tipo e
            o estado por extenso, e não precisa dela.
            F43 Fase 5: o quadradinho de cor virou o ÍCONE do tipo na cor
            dele — o mesmo desenho da pastilha, que agora só tem cor ali. */}
        {forma === 'mes' && (
          <ul className="cal-legenda" aria-label="Legenda">
            {Object.entries(TIPO_ROTULO).map(([tipo, rotulo]) => (
              <li key={tipo} style={{ '--cal-cor': TIPO_COR[tipo] } as CSSProperties}>
                <IconeDoTipoDeConteudo tipo={tipo} />
                {rotulo}
              </li>
            ))}
            {/* A quinta luz do prisma, que nenhum tipo usa: a cor não diz
                "mais um tipo", diz "isto não é conteúdo". */}
            <li style={{ '--cal-cor': COR_DO_COMPROMISSO } as CSSProperties}>
              <IconeDoTipoDeConteudo tipo="compromisso" />
              Compromisso
            </li>
            <li>
              <span className="cal-legenda-visto" data-ok aria-hidden="true">
                ✓
              </span>
              concluído
            </li>
            <li>
              <span className="cal-legenda-visto" aria-hidden="true">
                +
              </span>
              extra
            </li>
          </ul>
        )}
      </div>

      {erro && (
        <div className="mt-3">
          <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: tentarDeNovo }}>
            {erro}
          </Aviso>
        </div>
      )}

      <div className="mt-3" data-forma={forma}>
        {forma === 'mes' ? (
          <GradeDoMes
            mes={mes}
            janela={janela}
            entradas={entradas}
            lente="de-todos"
            hoje={hoje}
            foco={foco}
            aoVerDia={verDia}
            {...alcas}
          />
        ) : (
          <AgendaDoMes
            mes={mes}
            janela={janela}
            entradas={entradas}
            lente="de-todos"
            hoje={hoje}
            foco={foco}
            carregando={carregando}
            {...alcas}
          />
        )}
      </div>

      {/* Dentro do Planejamento, as peças sem dia têm onde aparecer: a barra
          de cada tipo na visão Contrato e o painel do cliente. */}
      <p className="cal-nota">
        Só aparece aqui o conteúdo que tem data. Os planejados ainda sem data existem, contam
        para o contrato do mês e aparecem como “sem dia” na visão Contrato e no painel de cada
        cliente. Compromisso ocupa o dia e não conta para o contrato.
      </p>
    </div>
  );
}
