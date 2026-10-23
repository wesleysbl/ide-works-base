/**
 * A MOLDURA RAIZ, E A GUARDA DA SAÍDA QUE MORA NELA — etapa F17.AUD03.
 *
 * A MOLDURA
 *   É a rota-mãe de todas as telas (`src/rotas.tsx`), sem caminho. O que antes
 *   ficava "dentro do `BrowserRouter` e fora das `Routes`" está aqui: o tema,
 *   a memória de rolagem (F17.24) e a guarda da saída. As
 *   telas entram pelo `Outlet`, sob demanda, com a mesma espera vazia de
 *   antes (F17.20).
 *
 *   `LembrarRolagem` continua sendo a nossa, e não a `ScrollRestoration` da
 *   biblioteca: a dela restaura cedo demais, que é o defeito medido no
 *   cabeçalho dela.
 *
 * A GUARDA — ONDE ELA MORA, E POR QUÊ
 *   Uma vez só, aqui, dentro do `RouterProvider` e fora das telas. `useBlocker`
 *   é do roteador de DADOS e só existe dentro dele; e o roteador aceita UM
 *   bloqueio por vez. A tela que tem texto por salvar não bloqueia nada — ela
 *   registra uma porta em `@/ui/saida`, e é esta peça que a lê na hora em que
 *   alguém tenta ir embora.
 *
 *   É assim que um bloqueio só cobre todas as saídas internas da tarefa: o X,
 *   o `‹ Voltar`, o botão do navegador, a barra lateral, a trilha, os links
 *   para a mãe e para as subtarefas. Todos navegam pelo roteador, e o
 *   roteador pergunta aqui antes.
 *
 * A JANELA É A MESMA DAS OUTRAS
 *   `Janela` da F17.33 — com o foco que faz o `Esc` existir, o clique fora
 *   testado pelo alvo e o `X` com nome. Nenhum dos três descarta nada: fechar
 *   é `Continuar editando`. As três respostas e a garantia de que cada uma
 *   conclui uma vez só estão em `criarDecisaoDeSaida`, que tem teste.
 *
 * O AVISO NATIVO
 *   Recarregar e fechar a aba não passam pelo roteador. Para esses o navegador
 *   tem o aviso dele, e a guarda o liga só enquanto a porta disser que há
 *   alteração — `aoAbandonarDocumento` decide, e é puro.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Outlet, useBlocker, useLocation } from 'react-router-dom';

import { AplicarAparencia } from '@/ui/AplicarAparencia';
import { GerenteDeConexao } from '@/chat/GerenteDeConexao';
import { fichaAoLadoDe } from '@/ui/ficha-ao-lado';
import { Janela } from '@/ui/janela';
import { LembrarRolagem } from '@/ui/LembrarRolagem';
import { LembrarRolagemInterna } from '@/ui/LembrarRolagemInterna';
import {
  type DecisaoDeSaida,
  aoAbandonarDocumento,
  criarDecisaoDeSaida,
  deveBloquear,
  portaDeSaida,
} from '@/ui/saida';

function GuardaDeSaida() {
  // A porta é lida NA HORA da pergunta, e não guardada: a função é estável, e
  // o que muda é quem está registrado.
  const bloqueio = useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        // O ESTADO entra junto do caminho — F43, Fase 7: fechar a ficha ao lado
        // não muda o caminho, só tira a ficha do estado. Ver `deveBloquear`.
        currentLocation: { pathname: string; state: unknown };
        nextLocation: { pathname: string; state: unknown };
      }) => deveBloquear(portaDeSaida(), currentLocation, nextLocation),
      [],
    ),
  );

  const [decisao, setDecisao] = useState<DecisaoDeSaida | null>(null);
  const [, redesenhar] = useState(0);

  useEffect(() => {
    if (bloqueio.state !== 'blocked') {
      setDecisao(null);
      return;
    }
    const porta = portaDeSaida();
    if (porta === null) {
      // A tela saiu de cena entre a pergunta e a resposta: não há o que proteger.
      bloqueio.proceed();
      return;
    }
    // ⚠️ A PRIMEIRA decisão fica. Se o navegador receber outro `voltar` com a
    // janela aberta, o roteador troca o destino do bloqueio — mas a decisão em
    // curso continua sendo uma, com o destino ORIGINAL, e conclui uma vez.
    setDecisao(
      (atual) =>
        atual ??
        criarDecisaoDeSaida(porta, { prosseguir: bloqueio.proceed, ficar: bloqueio.reset }, () =>
          redesenhar((n) => n + 1),
        ),
    );
  }, [bloqueio]);

  useEffect(() => {
    const aoDescarregar = (e: BeforeUnloadEvent) => {
      aoAbandonarDocumento(portaDeSaida(), e);
    };
    window.addEventListener('beforeunload', aoDescarregar);
    return () => window.removeEventListener('beforeunload', aoDescarregar);
  }, []);

  if (bloqueio.state !== 'blocked' || decisao === null || decisao.concluida()) return null;

  const salvando = decisao.salvando();
  const continuar = () => void decisao.escolher('continuar');

  return (
    <Janela rotulo="Sair sem salvar?" aoFechar={continuar}>
      <header>
        <div className="eyebrow">Alterações por salvar</div>
        <h2 className="o-titulo text-lg">Sair sem salvar?</h2>
      </header>
      <p className="o-dica mt-2">
        O que você escreveu ainda não foi gravado. Salvar grava e sai; descartar sai e
        abandona o texto.
      </p>
      <footer className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="o-btn o-btn-fantasma" disabled={salvando} onClick={continuar}>
          Continuar editando
        </button>
        <button
          type="button"
          className="o-btn o-btn-vidro"
          disabled={salvando}
          onClick={() => void decisao.escolher('descartar')}
        >
          Descartar e sair
        </button>
        <button
          type="button"
          className="o-btn o-btn-primario"
          disabled={salvando}
          onClick={() => void decisao.escolher('salvar')}
        >
          {salvando ? 'salvando…' : 'Salvar e sair'}
        </button>
      </footer>
    </Janela>
  );
}

/*
  A FICHA AO LADO — F43, Fase 7. Sob demanda, como as telas (F17.20): a ficha
  traz o editor rico, a conversa e os anexos, e quem só abre o Painel não deve
  baixá-los. É o mesmo código da página `/tarefa/:id` (`FichaDaTarefa`), que o
  empacotador divide entre as duas.
*/
const FichaAoLado = lazy(() => import('@/board/FichaAoLado'));

/**
 * O CARD AO LADO DA TELA — F43, Fase 7.
 *
 * Mora aqui, ao lado do `Outlet`, e não dentro do Quadro: a tela de trás
 * continua sendo a mesma rota (o endereço só está MASCARADO como
 * `/tarefa/:id`, ver `@/ui/ficha-ao-lado`), e o painel é da moldura — como a
 * guarda de saída. Assim um só lugar desenha o card para as cinco telas, e
 * os eventos do painel não sobem pela árvore do cartão (o `<li>` que anda de
 * coluna com as setas, F17.63).
 *
 * ⚠️ COM A PRÓPRIA ESPERA. Se o pedaço da ficha ainda está chegando, quem
 * espera é só ele: sem esta `Suspense`, a de baixo trocaria a tela INTEIRA
 * pelo vazio enquanto baixa — o Quadro sumiria e a rolagem dele iria junto.
 */
function FichaAoLadoDaTela() {
  const { state } = useLocation();
  const id = fichaAoLadoDe(state);
  if (id === null) return null;
  return (
    <Suspense fallback={null}>
      <FichaAoLado id={id} />
    </Suspense>
  );
}

export function Moldura() {
  return (
    <>
      {/* `AplicarAparencia` nao desenha nada: ela CARIMBA o tema e a cor do tema
          (F17.18) no elemento raiz. Fica fora das telas porque a cor vale para
          o sistema, e uma tela que nao a aplicasse seria a unica pagina verde
          num sistema roxo.

          ⚠️ AQUI MORAVA O BOTAO FLUTUANTE DE TEMA, e ele saiu em 2026-09-11.
          Fixo no canto de baixo, ele cobria texto das telas. A escolha mora
          na aba `Temas` do `Personalizar a barra lateral`, que toda tela
          logada alcanca. Nas publicas (entrar, ativar, redefinir) vale a
          escolha guardada ou, sem ela, o aparelho. */}
      <AplicarAparencia />
      {/* A rolagem volta para onde estava depois do F5 — F17.24. Aqui, e não
          em cada tela: a rolagem é do documento, e dezesseis cópias seriam
          dezesseis lugares para a regra divergir. Ver `LembrarRolagem`. */}
      <LembrarRolagem />
      {/* E as caixas que rolam POR DENTRO — o corpo de cada coluna do quadro e
          a faixa de lado — F32, relato de 25/09: "abre um card lá do final de
          uma lista e fecha, (…) ele volta no início da lista". O documento é
          da de cima; estas são desta. Mesmas travas. Ver
          `LembrarRolagemInterna`. */}
      <LembrarRolagemInterna />
      <GuardaDeSaida />
      {/* A espera é VAZIA de propósito. Um "carregando…" no lugar da tela
          inteira, por 40ms, pisca mais do que informa — e cada tela já tem o
          próprio aviso de carregamento para a espera que importa, que é a do
          banco. */}
      <Suspense fallback={null}>
        <GerenteDeConexao>
          <Outlet />
          <FichaAoLadoDaTela />
        </GerenteDeConexao>
      </Suspense>
    </>
  );
}
