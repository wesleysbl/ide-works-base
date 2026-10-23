/**
 * `Caixa de entrada` — o que chegou para você. Etapa F17.46.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PERGUNTA DO USUÁRIO, E A CORREÇÃO DELE
 *
 *   *"se a Carla deve cuidar, isso não deveria notificar a Carla em Minhas
 *   tarefas ou algo do gênero?"* — e logo depois: *"não só a Carla, dei o nome
 *   como exemplo por conta da imagem, mas no caso de cada pessoa para qual a
 *   automação for criada."*
 *
 *   Não há pessoa especial em lugar nenhum desta tela. Ela desenha o que o
 *   servidor respondeu para QUEM ESTÁ LENDO.
 *
 * O QUE FALTAVA, MEDIDO
 *   A tarefa já APARECE em `Minhas tarefas` de quem recebeu — a F17.41 mediu
 *   `Carla 0→1`. O que não existia era notificação: nenhuma, em lugar nenhum do
 *   sistema. Então a tarefa caía na tela da pessoa e ela descobria quando
 *   abrisse. Para quem não fica olhando o quadro, é a tarefa parada esperando
 *   alguém reparar — que é o que a automação veio evitar.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança o quê. As políticas de `task_events` e de `tasks` recortam
 *   antes de a resposta sair do banco, e por isso quem perde o acesso a uma
 *   tarefa perde o aviso dela junto. Se aparecer um filtro de alcance aqui, é
 *   defeito.
 *
 * A PASTILHA DA BARRA VEM DAQUI ENQUANTO ESTA TELA ESTÁ ABERTA
 *   `naoVistos` é passado para a barra lateral de propósito: marcar um aviso e
 *   ver o número velho ao lado, na mesma tela, ensinaria que o número não é de
 *   confiança. Nas outras telas ninguém sabe o número, e a barra pergunta
 *   sozinha.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type Aviso, filtrarAvisos } from '@/board/avisos';
import { TelaComBarra } from '@/board/TelaComBarra';
import { today } from '@/board/board';
import { ListaDeAvisos } from '@/board/ListaDeAvisos';
import { useChatLive } from '@/chat/useChatLive';
import { ApiError, api, semSessao } from '@/lib/api';
import { useEscolhaNoEndereco } from '@/ui/endereco';
import { idDaAba } from '@/ui/abas';
import { Abas } from '@/ui/AlternadorDeVista';
import { EstadoDaPagina } from '@/ui/EstadoDaPagina';
import { Aviso as Faixa, PaginaLarga } from '@/ui/primitivos';
import { ROTULO_DO_ITEM } from '@/ui/preferencias';
import { Topo } from '@/ui/Topo';
import '@/ui/quadro.css';
import '@/ui/clickup.css';

/** As duas vistas da caixa. `novos` é o padrão: o que já foi visto sai da frente. */
const VISTAS = ['novos', 'vistos'] as const;
type Vista = (typeof VISTAS)[number];

const ROTULO_DA_VISTA: Record<Vista, string> = {
  novos: 'Novos',
  vistos: 'Já vistos',
};

/** O desfecho de uma marcação, dito ao leitor de tela sem interromper. */
const FRASE_MARCADO: Record<'visto' | 'devolvido', string> = {
  visto: 'Marcado como visto. Está em Já vistos.',
  devolvido: 'Devolvido para Novos.',
};

export default function CaixaDeEntrada() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  /** Nulo até a primeira leitura: um "0" antes de saber seria mentira (§6). */
  const [naoVistos, setNaoVistos] = useState<number | null>(null);
  const [capado, setCapado] = useState(false);
  /** Falha da LEITURA. Sem nada na tela vira o estado de erro; com a lista já
   *  desenhada, uma faixa acima dela — a lista antiga continua valendo. */
  const [erroDeLeitura, setErroDeLeitura] = useState<string | null>(null);
  /** Falha de uma MARCAÇÃO: a linha já voltou ao que era, e isto diz qual. */
  const [erroDeMarcar, setErroDeMarcar] = useState<string | null>(null);
  const [emVoo, setEmVoo] = useState<ReadonlySet<string>>(() => new Set());
  const [anuncio, setAnuncio] = useState('');
  const painelRef = useRef<HTMLDivElement>(null);

  /**
   * A VISTA MORA NO ENDEREÇO — F17.24, a mesma decisão de `Minhas tarefas`.
   *
   * Um F5 em `Já vistos` voltando para `Novos` é o defeito que o usuário
   * descreveu como *"recarregar rebobina a página ao começo"*.
   */
  const [vista, setVista] = useEscolhaNoEndereco<Vista>('ver', VISTAS, 'novos');

  // "Hoje" fixado uma vez por montagem: recalcular a cada desenho faria
  // "Vence hoje" virar "Venceu ontem" no meio de uma leitura que atravessa a
  // meia-noite. Mesma decisão de `MeuTrabalho`.
  const hoje = useRef(today()).current;
  const live = useChatLive();

  /**
   * Marcações em voo. Uma leitura periódica que chega no meio de uma escrita
   * devolveria o estado ANTERIOR ao clique e faria a linha piscar de volta;
   * enquanto houver escrita pendente, a leitura de fundo não sobrescreve.
   */
  const pendentesRef = useRef(0);
  /** A vista de AGORA — a resposta de uma escrita pedida na outra aba não vale aqui. */
  const vistaRef = useRef(vista);
  vistaRef.current = vista;

  /**
   * A LEITURA PEDE OS VISTOS SÓ QUANDO A VISTA OS MOSTRA.
   *
   * Não é economia de bytes: é o que faz `Novos` ser exatamente o que o
   * servidor considera não visto, sem esta tela precisar concordar com ele
   * sobre o que "novo" quer dizer.
   */
  const ler = useCallback(async (comVistos: boolean) => {
    try {
      const r = await api.avisos(comVistos);
      if (pendentesRef.current > 0) return;
      // A RESPOSTA DE OUTRA VISTA NÃO VALE. A leitura sai com a vista do momento
      // do pedido; se a pessoa trocou de aba no meio, a resposta de Novos que
      // chega depois da de Já vistos trocava a lista inteira e deixava a aba
      // vazia até a próxima leitura (30 s).
      if (vistaRef.current !== (comVistos ? 'vistos' : 'novos')) return;
      setAvisos(r.notices.notices);
      setNaoVistos(r.notices.unread);
      setCapado(r.notices.capped === true);
      setErroDeLeitura(null);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      // A lista que já estava na tela CONTINUA: uma atualização que falhou
      // não transforma a caixa em vazia (antes: `setAvisos([])` + "Nada novo.").
      setErroDeLeitura(e instanceof ApiError ? e.message : 'Não foi possível carregar as suas notificações.');
    }
  }, []);

  useEffect(() => {
    const atualizar = () => { if (document.visibilityState !== 'hidden') void ler(vista === 'vistos'); };
    atualizar(); const timer = window.setInterval(atualizar, 30000);
    window.addEventListener('focus', atualizar);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', atualizar); };
  }, [ler, vista]);

  /* Menção no chat — F20.8: a caixa atualiza na hora com o evento ao vivo. */
  useEffect(() => {
    return live.aoEvento((evento) => {
      if (evento.type !== 'chat_mention') return;
      void ler(vista === 'vistos');
    });
  }, [live, ler, vista]);

  /**
   * MARCAR — F10: a linha muda NA HORA, e volta se o servidor recusar.
   *
   * O contador anda junto (é o mesmo número na aba e na barra). Na falha, SÓ
   * esta linha e SÓ a parte dela no contador voltam — outra marcação feita no
   * mesmo segundo não é desfeita junto. Com sucesso, a caixa relida que volta
   * da escrita é quem vale (o desenho de toda escrita desde a F17.10).
   */
  const marcar = useCallback(
    async (aviso: Aviso, visto: boolean) => {
      if (emVoo.has(aviso.key)) return;
      const delta = aviso.seen === visto ? 0 : visto ? -1 : 1;

      // Para onde vai o foco quando a linha sai da vista (Novos → marcar,
      // Já vistos → trazer de volta):
      // o botão da linha seguinte, ou a anterior, ou o painel.
      const linhas = Array.from(painelRef.current?.querySelectorAll<HTMLElement>('[data-aviso]') ?? []);
      const i = linhas.findIndex((el) => el.dataset.aviso === aviso.key);
      const vizinha = linhas[i + 1] ?? linhas[i - 1] ?? null;
      const chaveVizinha = vizinha?.dataset.aviso ?? null;
      const saiDaVista = (vista === 'novos') === visto;
      const comVistos = vista === 'vistos';

      pendentesRef.current += 1;
      setEmVoo((atual) => new Set(atual).add(aviso.key));
      setErroDeMarcar(null);
      setAvisos((atual) => atual?.map((a) => (a.key === aviso.key ? { ...a, seen: visto } : a)) ?? atual);
      setNaoVistos((n) => (n === null ? n : Math.max(0, n + delta)));

      if (saiDaVista) {
        window.requestAnimationFrame(() => {
          const painel = painelRef.current;
          const alvo = chaveVizinha
            ? painel?.querySelector<HTMLElement>(`[data-aviso="${CSS.escape(chaveVizinha)}"] .av-botao`)
            : null;
          (alvo ?? painel)?.focus();
        });
      }

      try {
        const r = await api.marcarAviso(aviso.key, visto, comVistos);
        pendentesRef.current -= 1;
        if (pendentesRef.current === 0 && vistaRef.current === (comVistos ? 'vistos' : 'novos')) {
          setAvisos(r.notices.notices);
          setNaoVistos(r.notices.unread);
          setCapado(r.notices.capped === true);
        }
        setAnuncio(FRASE_MARCADO[visto ? 'visto' : 'devolvido']);
      } catch (e) {
        pendentesRef.current -= 1;
        if (semSessao(e)) {
          window.location.replace('/');
          return;
        }
        // A VOLTA: a linha e a parte dela no contador — nada mais.
        setAvisos((atual) => atual?.map((a) => (a.key === aviso.key ? { ...a, seen: aviso.seen } : a)) ?? atual);
        setNaoVistos((n) => (n === null ? n : Math.max(0, n - delta)));
        const motivo = e instanceof ApiError ? e.message : 'O servidor não respondeu.';
        setErroDeMarcar(
          `Não foi possível ${visto ? 'marcar como visto' : 'trazer de volta'} “${aviso.taskTitle}”. ${motivo} ` +
            `A notificação continua em ${aviso.seen ? 'Já vistos' : 'Novos'}.`,
        );
      } finally {
        setEmVoo((atual) => {
          const novo = new Set(atual);
          novo.delete(aviso.key);
          return novo;
        });
      }
    },
    [vista, emVoo],
  );

  const daVista = useMemo(
    () => filtrarAvisos(avisos ?? [], vista === 'vistos'),
    [avisos, vista],
  );

  const vazio =
    vista === 'novos' ? (
      <EstadoDaPagina
        tipo="vazio"
        titulo="Nada novo."
        acao={{ rotulo: 'Ver já vistos', aoClicar: () => setVista('vistos') }}
      >
        Menções, tarefas que chegarem para você e prazos virando aparecem aqui.
      </EstadoDaPagina>
    ) : (
      <EstadoDaPagina tipo="vazio" titulo="Nenhuma notificação vista ainda.">
        O que você marcar como visto fica guardado nesta aba.
      </EstadoDaPagina>
    );

  return (
    <PaginaLarga>
      {/* A MOLDURA COMUM — F04: a grade à mão virou a peça das outras telas;
          o contador de não vistos segue para a barra pela mesma prop (antes da
          primeira leitura, a barra pergunta sozinha). */}
      <TelaComBarra atual="avisos" naoVistos={naoVistos ?? undefined} classeDoConteudo="iw-avisos">
        {/* O TOPO — F29 (Fase 4). Tela principal: só o título, o nome do
            item da barra. */}
        <Topo titulo={ROTULO_DO_ITEM.avisos} />

        {/* F03: abas de verdade (UX09) — um painel, foco móvel, ←/→,
            Home/End. A contagem só aparece quando se sabe (F10). */}
        <Abas
          rotulo="Quais notificações"
          base="av-vista"
          idDoPainel="av-painel"
          className="cu-abas av-abas"
          classeDaAba="cu-aba"
          valor={vista}
          aoEscolher={setVista}
          opcoes={VISTAS.map((v) => ({
            valor: v,
            rotulo: ROTULO_DA_VISTA[v],
            contagem: v === 'novos' && naoVistos !== null ? naoVistos : undefined,
          }))}
        />

        {/* Anúncio educado do desfecho de uma marcação (sr-only). */}
        <p className="sr-only" role="status" aria-live="polite">{anuncio}</p>

        <div
          role="tabpanel"
          id="av-painel"
          aria-labelledby={idDaAba('av-vista', vista)}
          ref={painelRef}
          tabIndex={-1}
          className="av-painel"
        >
          {/* F04: o erro mora na coluna, abaixo do título — aqui, logo acima
              da lista que ele explica. */}
          {erroDeMarcar && (
            <div className="av-faixa">
              <Faixa tipo="erro">{erroDeMarcar}</Faixa>
            </div>
          )}
          {erroDeLeitura && avisos !== null && (
            <div className="av-faixa">
              <Faixa
                tipo="erro"
                acao={{ rotulo: 'Tentar de novo', aoClicar: () => void ler(vista === 'vistos') }}
              >
                {erroDeLeitura} A lista abaixo é a da última leitura.
              </Faixa>
            </div>
          )}

          {avisos === null && erroDeLeitura === null && <EstadoDaPagina tipo="carregando" />}
          {avisos === null && erroDeLeitura !== null && (
            <EstadoDaPagina
              tipo="erro"
              titulo={erroDeLeitura}
              acao={{ rotulo: 'Tentar de novo', aoClicar: () => void ler(vista === 'vistos') }}
            />
          )}

          {avisos !== null && (
            <ListaDeAvisos
              avisos={daVista}
              hoje={hoje}
              aoMarcar={(a, visto) => void marcar(a, visto)}
              ocupado={emVoo}
              vazio={vazio}
            />
          )}

          {avisos !== null && capado && daVista.length > 0 && (
            <p className="av-capado">Mostrando as notificações mais recentes.</p>
          )}
        </div>
      </TelaComBarra>
    </PaginaLarga>
  );
}
