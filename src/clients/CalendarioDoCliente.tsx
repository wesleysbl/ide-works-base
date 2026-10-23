/**
 * A aba Calendário da ficha do cliente — etapa F17.40.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   *"Tudo bem existir um principal, mas em painel, cada cliente deve ter o
 *   próprio calendário mensal com seletor de intervalo de data e mostrando como
 *   se fosse o calendário do mês mesmo."*
 *
 *   Antes desta aba, quem quisesse ver o mês de um cliente abria o calendário
 *   geral — de todos os clientes juntos — e procurava.
 *
 * A GRADE É A MESMA PEÇA, E A CONSULTA É A MESMA CONSULTA
 *   O desenho vem de `@/ui/GradeDoMes`, o mesmo que o calendário geral usa; a
 *   diferença é a lente. E o dado vem de `GET /calendar` com o cliente no
 *   filtro — a MESMA rota do calendário geral, que já passa por `withActor` e
 *   portanto por `can_see_client`.
 *
 *   Isso importa: a F17.32 corrigiu o alcance por empresa depois de 61 contas
 *   da Alma 9 aparecerem para quem era da Ide. Uma consulta nova aqui seria uma
 *   segunda chance de errar a mesma coisa.
 *
 *   A busca em si é `useConteudosDoMes`, a mesma do calendário geral — e é lá
 *   que mora a guarda contra a resposta que chega tarde e reescreve o mês certo
 *   com o mês anterior.
 *
 * O MÊS E O PERÍODO SÃO OS DA FICHA, NÃO DESTA ABA
 *   A ficha inteira já se move num mês — o medidor de entrega, o ritual, os
 *   extras. Se a aba tivesse mês próprio, olhar agosto no calendário enquanto o
 *   medidor mostra setembro seria a tela discordando dela mesma.
 *
 *   Então navegar de mês pelos `‹ ›` da ficha move o calendário junto, e a aba
 *   continua aberta — ela é estado da tela, e não da rota.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * E AGORA ELA MARCA — F17.44
 *   *"Sendo que eles não possuem botão de +? Onde são adicionadas essas
 *   entregas? Compromissos?"* A aba era visor: o conteúdo nascia em `Conteúdos`
 *   e no `Semanal`, e aqui só se desenhava.
 *
 *   Aqui o cliente já se sabe, então a janela de marcar não pergunta de quem é
 *   — `clienteFixo` responde por ela, e uma pergunta a menos é uma chance a
 *   menos de marcar no cliente errado.
 *
 *   ⚠️ `aoMudar` recarrega a FICHA INTEIRA, e não só esta aba. Entrega criada
 *   aqui entra na cota do mês, e o medidor de entrega e a grade semanal ficam
 *   na mesma tela: recarregar só o calendário deixaria os três números da ficha
 *   discordando entre si até alguém trocar de mês.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo, useState } from 'react';

import { AlternadorDeVista } from '@/ui/AlternadorDeVista';
import { AgendaDoMes, type FocoNoDia, GradeDoMes } from '@/ui/GradeDoMes';
import { type AlvoDaMarcacao, MarcarNoDia } from '@/ui/MarcarNoDia';
import { useConteudosDoMes } from '@/ui/conteudos-do-mes';
import {
  type EntradaDoMes,
  FORMAS_DO_CALENDARIO,
  type FormaDoCalendario,
  formaInicial,
  hojeNaAgencia,
  janelaDoMes,
} from '@/ui/grade-do-mes';
import { IconeCalendario } from '@/ui/Icones';
import { Aviso } from '@/ui/primitivos';
import { type Periodo, SeletorDePeriodo } from '@/ui/SeletorDePeriodo';

export function CalendarioDoCliente({
  clienteId,
  mes,
  periodo,
  aoMudarPeriodo,
  aoMudar,
}: {
  clienteId: string;
  /** `AAAA-MM` — o mês que a ficha inteira está mostrando. */
  mes: string;
  periodo: Periodo | null;
  aoMudarPeriodo: (p: Periodo | null) => void;
  /** Recarrega a ficha inteira depois de marcar, corrigir ou apagar. */
  aoMudar: () => Promise<unknown> | void;
}) {
  const janela = useMemo(() => janelaDoMes(mes, periodo), [mes, periodo]);
  const [vez, setVez] = useState(0);
  const { entradas, erro, carregando, tentarDeNovo } = useConteudosDoMes(janela, clienteId, vez);
  const [alvo, setAlvo] = useState<AlvoDaMarcacao | null>(null);
  // A MESMA escolha de forma do calendário geral — F12: agenda no celular,
  // mês no desktop, e as duas com as mesmas entradas e o mesmo clique.
  const [forma, setForma] = useState<FormaDoCalendario>(formaInicial);
  const [foco, setFoco] = useState<FocoNoDia | null>(null);
  const hoje = hojeNaAgencia();
  const alcas = {
    aoMarcarNoDia: (dia: string) => setAlvo({ modo: 'novo', dia }),
    aoAbrirEntrada: (entrada: EntradaDoMes) => setAlvo({ modo: 'existente', entrada }),
  };

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="eyebrow">Calendário</h2>
        <div className="flex flex-wrap items-center gap-2">
          <IconeCalendario className="h-4 w-4 text-mute" />
          <AlternadorDeVista
            rotulo="Forma de ver o calendário"
            opcoes={FORMAS_DO_CALENDARIO}
            valor={forma}
            aoEscolher={setForma}
            className="cal-forma"
          />
          <SeletorDePeriodo
            valor={periodo}
            mesDeReferencia={`${mes}-01`}
            aoMudar={aoMudarPeriodo}
          />
          {/*
            O `+` do cabeçalho abre a janela SEM dia escolhido: ninguém apontou
            um. É a mesma decisão da F17.42 — nada nasce marcado, porque padrão
            pré-marcado faz aceitar sem olhar.
          */}
          <button
            type="button"
            className="o-btn o-btn-vidro"
            aria-haspopup="dialog"
            onClick={() => setAlvo({ modo: 'novo', dia: null })}
          >
            + Marcar
          </button>
        </div>
      </div>

      {erro && (
        <div className="mt-3">
          <Aviso tipo="erro" acao={{ rotulo: 'Tentar de novo', aoClicar: tentarDeNovo }}>
            {erro}
          </Aviso>
        </div>
      )}

      {/*
        Mês sem nada nenhum abre como um mês: trinta casas vazias e o número do
        dia em cada uma. Não há frase avisando que está vazio — a grade desenhada
        já diz que o calendário funcionou, e a F17.37 cortou treze parágrafos que
        existiam só para dizer o que a tela ao lado já mostrava.
      */}
      <div className="mt-3 pb-10" data-forma={forma}>
        {forma === 'mes' ? (
          <GradeDoMes
            mes={mes}
            janela={janela}
            entradas={entradas}
            lente="de-um-cliente"
            hoje={hoje}
            foco={foco}
            aoVerDia={(dia) => {
              setForma('agenda');
              setFoco((f) => ({ dia, n: (f?.n ?? 0) + 1 }));
            }}
            {...alcas}
          />
        ) : (
          <AgendaDoMes
            mes={mes}
            janela={janela}
            entradas={entradas}
            lente="de-um-cliente"
            hoje={hoje}
            foco={foco}
            carregando={carregando}
            {...alcas}
          />
        )}
      </div>

      {alvo && (
        <MarcarNoDia
          alvo={alvo}
          clienteFixo={clienteId}
          clientes={[]}
          aoFechar={() => setAlvo(null)}
          aoMudar={async () => {
            // Duas coisas, e as duas precisam acontecer: a grade relê o mês
            // (o `vez` obriga a busca a recomeçar mesmo com a janela igual) e a
            // ficha relê o resto — medidor, semanal, extras.
            setVez((v) => v + 1);
            await aoMudar();
          }}
        />
      )}
    </section>
  );
}
