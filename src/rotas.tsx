/**
 * A TABELA DE ROTAS do IDE Works — etapa F1.9, movida para cá na F17.AUD03.
 *
 * Quatro rotas públicas, e nenhuma a mais — a quarta é a página do cliente
 * (`/aprovar/:token`, F42), irmã da moldura. Repare no que NÃO está aqui:
 *
 *   - não há "/solicitar-acesso": ninguém se cadastra sozinho;
 *   - não há "/aprovacao": sem autocadastro, não há fila para aprovar.
 *
 * O Sistema IDE tem as duas. São remoções deliberadas, e o teste da lista
 * fechada de rotas públicas quebra se alguém acrescentar uma sem revisão —
 * no servidor (`PUBLIC_ROUTES`, em `auth/authorization.ts`) e aqui
 * (`rotas.test.ts`, pelo carimbo `handle.publica`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A TABELA SAIU DE `App.tsx` — F17.AUD03
 *
 *   O bloqueio de navegação (`useBlocker`) que protege o texto por salvar da
 *   tarefa só existe no ROTEADOR DE DADOS da biblioteca — `createBrowserRouter`
 *   + `RouterProvider` —, e não em `<BrowserRouter><Routes>`. A composição
 *   mudou de forma; os endereços, não. Esta tabela é o objeto que o roteador
 *   recebe, e `rotas.test.ts` prova que os vinte e dois caminhos continuam
 *   os mesmos. A F16.9b acrescentou `/conexoes`: passaram a ser vinte e três.
 *
 *   Ela mora num arquivo sem componente por uma regra do `eslint`: um arquivo
 *   que define componentes não deve exportar mais nada, senão o recarregamento
 *   rápido do Vite perde o fio. A moldura raiz — o que antes ficava "dentro
 *   do `BrowserRouter` e fora das `Routes`" — é `@/ui/Moldura`; `App.tsx`
 *   exporta o componente que monta o roteador; este arquivo exporta a tabela.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Suspense, lazy } from 'react';
import { type RouteObject } from 'react-router-dom';

import { CalendarioAntigo } from '@/painel/CalendarioAntigo';
import { ErroDeRota } from '@/ui/ErroDeRota';
import { Moldura } from '@/ui/Moldura';

// A tela de entrada NÃO é adiada: ela é a primeira coisa que se vê, e adiá-la
// trocaria uma requisição a menos por uma requisição a mais no caminho crítico.
import Entrar from '@/pages/Entrar';

/* ─────────────────────────── as telas, sob demanda — F17.20 ───────────────────────────

   O PACOTE ERA UM ARQUIVO SÓ DE 560 kB, e o `build` avisava disso a cada
   execução. Dezesseis telas dentro dele: quem abre `/meu-trabalho` baixava o
   relatório da Meta, o calendário, o cockpit e a ficha de cliente antes de
   desenhar a primeira linha do próprio trabalho.

   `lazy` parte o pacote por ROTA. Não muda nada do que cada tela faz — é a
   mesma tela, buscada quando alguém vai olhá-la. É o ganho maior pelo risco
   menor entre as três dívidas de desempenho registradas no plano: as outras
   duas mexem em consulta com dado real dentro.
   ─────────────────────────────────────────────────────────────────────────────── */

const Ativar = lazy(() => import('@/pages/Ativar'));
const Cliente = lazy(() => import('@/pages/Cliente'));
const Contas = lazy(() => import('@/pages/Contas'));
const Catalogos = lazy(() => import('@/pages/Catalogos'));
const MetaContas = lazy(() => import('@/pages/MetaContas'));
const MetaRanking = lazy(() => import('@/pages/MetaRanking'));
const MetaRelatorio = lazy(() => import('@/pages/MetaRelatorio'));
const Painel = lazy(() => import('@/pages/Painel'));
const Pessoas = lazy(() => import('@/pages/Pessoas'));
const Conexoes = lazy(() => import('@/pages/Conexoes'));
const ControleDaSemana = lazy(() => import('@/pages/ControleDaSemana'));
const Planejamento = lazy(() => import('@/pages/Planejamento'));
const Quadro = lazy(() => import('@/pages/Quadro'));
const Redefinir = lazy(() => import('@/pages/Redefinir'));
const Espaco = lazy(() => import('@/pages/Espaco'));
const Pasta = lazy(() => import('@/pages/Pasta'));
const CaixaDeEntrada = lazy(() => import('@/pages/CaixaDeEntrada'));
const Chat = lazy(() => import('@/pages/Chat'));
const MeuTrabalho = lazy(() => import('@/pages/MeuTrabalho'));
const TodasAsTarefas = lazy(() => import('@/pages/TodasAsTarefas'));
const Tarefa = lazy(() => import('@/pages/Tarefa'));
const NaoEncontrado = lazy(() => import('@/pages/NaoEncontrado'));
// A página do CLIENTE da agência — F42, Fase 6. Ver o comentário na tabela.
const PaginaDoCliente = lazy(() => import('@/aprovacao/PaginaDoCliente'));

/** O carimbo de rota pública. `rotas.test.ts` conta quantas há. */
const PUBLICA = { publica: true } as const;

/**
 * A TELA DE ERRO EM CADA ROTA — conferência de 09/10/2026.
 *
 * Sem `errorElement`, uma tela que estoura ao desenhar faz o roteador trocar o
 * app inteiro pelo "Unexpected Application Error!" dele, com a pilha crua. Aqui
 * cada rota ganha a `ErroDeRota` (`@/ui/ErroDeRota`).
 *
 * ⚠️ NA FILHA E NA MÃE, e a diferença é o que se perde. A fronteira de erro do
 * roteador vale para a rota que a declara: no `errorElement` da filha só a TELA
 * é trocada, e a moldura (tema, rolagem, guarda de saída, conexão do chat)
 * continua de pé; o da moldura é a rede de baixo, para o que estourar nela
 * mesma (o gerente do chat, a ficha ao lado). Declarar só na moldura trocaria
 * tudo, que é o defeito. Feito aqui, num lugar só, para a próxima rota não
 * nascer sem — `erro-de-rota.test.ts` confere que nenhuma nasce.
 */
function comTelaDeErro(rotas: RouteObject[]): RouteObject[] {
  const comErro = (rota: RouteObject): RouteObject => ({ ...rota, errorElement: <ErroDeRota /> }) as RouteObject;
  return rotas.map((rota) =>
    rota.children === undefined ? comErro(rota) : ({ ...comErro(rota), children: rota.children.map(comErro) } as RouteObject),
  );
}

/**
 * A tabela. Uma rota-mãe sem caminho — a moldura — e as telas
 * como filhas (mais o chat da F20.5).
 */
export const ROTAS: RouteObject[] = comTelaDeErro([
  {
    element: <Moldura />,
    children: [
      { path: '/', element: <Entrar />, handle: PUBLICA },
      { path: '/ativar', element: <Ativar />, handle: PUBLICA },
      // A senha nova, com o codigo entregue a mao — F17.31. Publica pelo
      // mesmo motivo do login: quem perdeu a senha nao tem cracha.
      { path: '/redefinir', element: <Redefinir />, handle: PUBLICA },
      { path: '/painel', element: <Painel /> },
      { path: '/cliente/:id', element: <Cliente /> },
      // O CALENDÁRIO VIROU VISÃO DO PLANEJAMENTO — F43, Fase 4. O endereço
      // fica na tabela (favoritos, comentários, preferências guardadas) e leva
      // a `/planejamento?visao=calendario`, com o resto da consulta junto. Não
      // é adiado: é só um desvio, e adiá-lo buscaria um pedaço para nada.
      { path: '/calendario', element: <CalendarioAntigo /> },
      { path: '/planejamento', element: <Planejamento /> },
      // O CONTROLE DA SEMANA — F40, Fase 7. Só admin: o item da barra some para
      // os outros, e a rota direta mostra "sem acesso". `/admin/semana` (API)
      // é quem recusa de verdade. Rota de SPA: não entra em `run_worker_first`.
      { path: '/controle-da-semana', element: <ControleDaSemana /> },
      // O quadro do Pilar B — F17.9a. Sem lista escolhida ele abre a
      // primeira que a pessoa alcança: a etapa existe para ser vista.
      { path: '/quadro', element: <Quadro /> },
      // A VISÃO GERAL DO ESPAÇO — F17.26. Vem ANTES de `/quadro/:listaId`
      // por leitura, e não por necessidade: o roteador casa o trecho fixo
      // `espaco` antes do parâmetro, e as duas rotas têm contagens de
      // segmentos diferentes.
      { path: '/quadro/espaco/:espacoId', element: <Espaco /> },
      // O QUADRO DA PASTA — F17.64. Todos os clientes da pasta numa
      // grade só. Mesma leitura de endereço do espaço, um nível abaixo:
      // o trecho fixo `pasta` casa antes do parâmetro.
      { path: '/quadro/pasta/:pastaId', element: <Pasta /> },
      { path: '/quadro/:listaId', element: <Quadro /> },
      // As duas telas da PESSOA — F17.18. O quadro é a visão de quem
      // organiza; estas duas respondem "o que é meu" e "o que existe ao meu
      // alcance", que é o que a barra lateral do ClickUp entrega ao
      // funcionário.
      { path: '/meu-trabalho', element: <MeuTrabalho /> },
      { path: '/tarefas', element: <TodasAsTarefas /> },
      // A CAIXA DE ENTRADA — F17.46. Terceira tela da pessoa, e a que
      // responde à pergunta que as outras duas não respondiam: não "o que é
      // meu", mas "o que CHEGOU para mim enquanto eu não estava olhando".
      // Sem ela, a tarefa que a automação passa fica esperando alguém
      // reparar — que é o que a automação veio evitar.
      { path: '/avisos', element: <CaixaDeEntrada /> },
      // Chat da equipe — F20.5. Lista + conversa; link direto por id.
      { path: '/chat', element: <Chat /> },
      { path: '/chat/:conversationId', element: <Chat /> },
      // A ficha da tarefa — F17.10. Rota própria, e não um painel dentro do
      // quadro: o endereço de uma tarefa precisa poder ser colado num
      // comentário, que é como a equipe já trabalha hoje no ClickUp.
      // F43, Fase 7: o card agora TAMBÉM abre num painel ao lado do Quadro —
      // e esta rota continua sendo o endereço. O painel não é rota: é a tela
      // de trás com o endereço mascarado como `/tarefa/:id` (`@/ui/ficha-ao-lado`);
      // colar, abrir em aba nova e os avisos chegam aqui, na página cheia.
      { path: '/tarefa/:tarefaId', element: <Tarefa /> },
      { path: '/catalogos', element: <Catalogos /> },
      { path: '/meta', element: <MetaContas /> },
      { path: '/meta/ranking', element: <MetaRanking /> },
      { path: '/meta/:id', element: <MetaRelatorio /> },
      { path: '/contas', element: <Contas /> },
      { path: '/pessoas', element: <Pessoas /> },
      // Gestão das conexões de agente — F16.9b. Qualquer autenticado gerencia
      // as próprias concessões; a API é `livre` em `auth/areas.ts`.
      { path: '/conexoes', element: <Conexoes /> },
      { path: '*', element: <NaoEncontrado /> },
    ],
  },
  // A APROVAÇÃO DO CLIENTE POR LINK — F42, Fase 6. Pública, e FORA da moldura:
  // a moldura monta o gerente do chat, que pergunta a sessão (`/auth/me`) e
  // renova o crachá num 401. O cliente da agência não tem conta — o token do
  // endereço é a credencial, e a página fala só com `/api/public/aprovacao/…`.
  // Navegação para `/aprovar/...` cai na SPA (não está em `run_worker_first`).
  {
    path: '/aprovar/:token',
    element: (
      <Suspense fallback={null}>
        <PaginaDoCliente />
      </Suspense>
    ),
    handle: PUBLICA,
  },
]);
