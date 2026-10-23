/**
 * O SISTEMA INTEIRO COM DADOS FICTÍCIOS — F16 do plano UX.
 *
 * Não é suíte (não está em `rodar.mjs`): é o servidor fictício que
 * `ux-transversal.mjs` usa para abrir QUALQUER rota com a forma real da
 * resposta. Cada família reaproveita as fixtures do cenário que a prova —
 * nada de resposta genérica fingindo ser página (o risco "fixture produz
 * falsa confiança" do plano):
 *
 *   Meta ............ `rotasDaMeta`           (meta-ux)
 *   Administração ... `rotasDaAdministracao`  (pessoas-convite)
 *   Calendário ...... `comCalendario(mesCheio)` (agenda-planejamento)
 *   Planejamento .... `comPlanejamento`       (agenda-planejamento)
 *   Quadros ......... `servidorLK`            (lista-kanban: espaço, pasta, lista, árvore)
 *   Clientes/Painel . `comFichas`             (cliente-ux: carteira, ficha e as sete áreas)
 *   Chat e avisos ... `criarEstado().handler` (chat)
 *   O resto ......... `respostaPadrao`        (comum, via `setup`)
 *
 * Nomes, e-mails e números são inventados. Nenhuma rota sai para a rede.
 */

import { comCalendario, comPlanejamento, mesCheio } from './agenda-planejamento.mjs';
import { BIA, GERAL, criarEstado, msgSeed } from './chat.mjs';
import { comFichas } from './cliente-ux.mjs';
import { rotasDoControle } from './controle-da-semana.mjs';
import { LK, novoEstadoLK, servidorLK } from './lista-kanban.mjs';
import { rotasDaMeta } from './meta-ux.mjs';
import { rotasDaAdministracao } from './pessoas-convite.mjs';

/** Um servidor novo (estado próprio) por contexto de navegador. */
export function servidorUX() {
  const meta = rotasDaMeta().handler;
  const admin = rotasDaAdministracao().handler;
  const controle = rotasDoControle().handler;
  const calendario = comCalendario(mesCheio);
  const planejamento = comPlanejamento();
  const quadros = servidorLK(novoEstadoLK(24));
  const clientes = comFichas();
  // O Geral com conversa (duas pessoas, falas de uma linha) — a régua de
  // ações e o histórico precisam de bolhas para serem vistos.
  const chat = criarEstado({
    iniciais: [
      { ...msgSeed('Bom dia! A proposta da campanha está pronta para revisão.', '2026-09-27T12:00:00.000Z'), authorId: BIA },
      msgSeed('Vou conferir as peças ainda hoje.', '2026-09-27T12:01:00.000Z'),
      { ...msgSeed('Combinado.', '2026-09-27T12:02:00.000Z'), authorId: BIA },
      msgSeed('ok', '2026-09-27T12:03:00.000Z'),
    ],
  }).handler;
  const ordem = [meta, admin, controle, calendario, planejamento, quadros, clientes, chat];
  return async (url, req) => {
    for (const h of ordem) {
      const r = await h(url, req);
      if (r) return r;
    }
    return null;
  };
}

/** O token da página do cliente na matriz (F42, Fase 6). */
export const TOKEN_UX = 'uxTokenDeExemplo0123456789abcdefghijklmnopq';

/**
 * A página pública do link (F42): uma chamada aberta e uma aprovada. Os itens
 * são PASTA — a lista não carrega mídia, e nada sai para o Dropbox de verdade.
 */
const paginaDoLinkUX = () => ({
  ok: true,
  cliente: { nome: 'Loja Exemplo' },
  chamadas: [
    {
      id: 'ux-r2', titulo: 'Reels — lançamento outubro', versao: 2, enviadaEm: '2026-10-07T17:32:00.000Z',
      legenda: 'A coleção de outubro chegou!', estado: 'aberta', decididaEm: null, comentarios: [],
      itens: [{ id: 'ux-i1', ordem: 1, tipo: 'other', nome: 'Pasta do Dropbox', forma: 'pasta', exibicao: null, abrirNoDropbox: 'https://www.dropbox.com/scl/fo/ux/AA?rlkey=ux&dl=0' }],
    },
    {
      id: 'ux-r1', titulo: 'Carrossel — Dia das Crianças', versao: 1, enviadaEm: '2026-10-03T12:00:00.000Z',
      legenda: null, estado: 'aprovada', decididaEm: '2026-10-03T18:00:00.000Z', comentarios: [], itens: [],
    },
  ],
});

/**
 * Sem sessão: a API inteira responde 401, como o servidor faz sem crachá. A
 * API pública do link de aprovação (F42) responde a página do `TOKEN_UX`.
 */
export const semSessao = (url) => {
  if (url.pathname === '/api/config') return null;
  if (url.pathname === `/api/public/aprovacao/${TOKEN_UX}`) return { body: paginaDoLinkUX() };
  return { status: 401, body: {} };
};

/**
 * AS 27 ENTRADAS da matriz de rotas (§5 de `02-auditoria-e-referencias.md`),
 * cada uma com um endereço concreto nas fixtures acima. A 27ª é a página do
 * cliente (F42, Fase 6): pública, e com o tema FIXO no escuro (a marca da Ide
 * é preta) — `temaFixo` diz à varredura que o tema pedido não vale ali.
 */
export const ROTAS = [
  { rota: '/', caminho: '/', publica: true },
  { rota: '/ativar', caminho: '/ativar', publica: true },
  { rota: '/redefinir', caminho: '/redefinir', publica: true },
  { rota: '/painel', caminho: '/painel' },
  { rota: '/cliente/:id', caminho: '/cliente/cx-1' },
  // F43 Fase 4: a rota fica na tabela e leva à visão Calendário do
  // Planejamento — abrir pelo endereço antigo é a prova de que ele não quebrou.
  { rota: '/calendario', caminho: '/calendario' },
  { rota: '/planejamento', caminho: '/planejamento' },
  { rota: '/controle-da-semana', caminho: '/controle-da-semana' },
  { rota: '/quadro', caminho: '/quadro' },
  { rota: '/quadro/espaco/:espacoId', caminho: `/quadro/espaco/${LK.espaco}` },
  { rota: '/quadro/pasta/:pastaId', caminho: `/quadro/pasta/${LK.timeA}` },
  { rota: '/quadro/:listaId', caminho: `/quadro/${LK.l1}` },
  { rota: '/meu-trabalho', caminho: '/meu-trabalho' },
  { rota: '/tarefas', caminho: '/tarefas' },
  { rota: '/avisos', caminho: '/avisos' },
  { rota: '/chat', caminho: '/chat' },
  { rota: '/chat/:conversationId', caminho: `/chat/${GERAL}` },
  { rota: '/tarefa/:tarefaId', caminho: '/tarefa/t-ux-1' },
  { rota: '/catalogos', caminho: '/catalogos' },
  { rota: '/meta', caminho: '/meta' },
  { rota: '/meta/ranking', caminho: '/meta/ranking' },
  { rota: '/meta/:id', caminho: '/meta/a-horizonte' },
  { rota: '/contas', caminho: '/contas' },
  { rota: '/pessoas', caminho: '/pessoas' },
  { rota: '/conexoes', caminho: '/conexoes' },
  { rota: '*', caminho: '/rota-que-nao-existe', publica: true },
  { rota: '/aprovar/:token', caminho: `/aprovar/${TOKEN_UX}`, publica: true, temaFixo: 'escuro' },
];
