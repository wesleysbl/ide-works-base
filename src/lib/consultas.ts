/**
 * O PROVEDOR DE CONSULTAS — a leitura que as telas dividem. Etapa F17.CARGA02.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DÍVIDA QUE ELE PAGA
 *
 *   A F17.67 registrou, contando: a árvore é buscada de novo ao montar CADA UMA
 *   das dezessete telas que desenham a barra lateral. E `useSessao` fazia um
 *   `/auth/me` POR USO — na ficha da tarefa há dois usos na mesma tela, a
 *   página e a barra, e portanto duas chamadas iguais lado a lado.
 *
 *   Ir ao quadro, abrir a tarefa e voltar pagava a árvore três vezes e a sessão
 *   seis, para ver os mesmos dados. O estado morava nos componentes, e componente
 *   que desmonta leva o que sabia junto.
 *
 *   O `@tanstack/react-query` estava instalado desde o começo e não era usado em
 *   lugar nenhum — a dívida 3 daquela etapa. Este arquivo é onde ele entra.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ OS PADRÕES DA BIBLIOTECA NÃO SÃO O COMPORTAMENTO DESEJADO
 * ═══════════════════════════════════════════════════════════════════════════
 *   Isto não é zelo: é a armadilha que a documentação dela mesma nomeia em
 *   *Important Defaults*. De fábrica, `staleTime` é ZERO — todo dado nasce
 *   vencido, e cada montagem, cada foco de janela e cada reconexão relê. Ligar
 *   a biblioteca e não configurar nada trocaria dezessete leituras por
 *   dezessete leituras, com uma dependência a mais no meio.
 *
 *   E `retry` é TRÊS, com espera crescente. Sobre uma camada de API que JÁ
 *   repete falha passageira uma vez (`getBoard`, em `@/lib/api`), três vezes
 *   três é o que a equipe sentiria como "travou": oito idas ao banco para uma
 *   leitura que falhou uma vez. Por isso `retry: false` — quem repete é a API,
 *   uma vez, onde a repetição sabe distinguir 503 de 401.
 *
 *   Cada valor abaixo está escrito de propósito. Nenhum é herdado.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ MEMÓRIA, E SÓ MEMÓRIA — decisão 2 do plano
 * ═══════════════════════════════════════════════════════════════════════════
 *   Nada daqui é persistido. Não há `localStorage`, não há `sessionStorage`,
 *   não há cache de HTTP público. O que este cache guarda é a árvore de quem
 *   está olhando — nomes de cliente, o que cada pessoa alcança — e isso não
 *   sobrevive à aba pela mesma razão que o rascunho não sobrevive (ver o
 *   cabeçalho de `@/ui/rascunho.ts`): máquina de escritório é compartilhada.
 *
 *   F5 começa com o cache vazio, e isso é o desenho, não uma limitação a
 *   consertar depois.
 *
 * ⚠️ ISTO NÃO É PERMISSÃO — a mesma advertência de `@/ui/sessao.ts`
 *   Guardar a árvore por trinta segundos não guarda AUTORIZAÇÃO por trinta
 *   segundos. Toda operação continua sendo autorizada no servidor, a cada
 *   chamada. O que se reaproveita é o desenho da navegação; quem recusa é o
 *   banco, sempre.
 *
 * O CLIENTE NASCE UMA VEZ, como o roteador
 *   Mesma razão de `App.tsx`: dois clientes seriam dois caches, e a tela que
 *   caísse no segundo pagaria de novo tudo o que o primeiro já sabia. Ele é de
 *   módulo, e `criarClienteDeConsultas` existe para que a suíte tenha o seu,
 *   isolado, sem tocar no do sistema.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type Query, QueryClient, QueryClientContext } from '@tanstack/react-query';
import { useContext } from 'react';

/**
 * QUANTO TEMPO UMA LEITURA VALE — 30 segundos, e é um PONTO DE PARTIDA.
 *
 * O plano manda ajustar pela medição da fase 1, que ainda não tem linha de base
 * autenticada. Trinta segundos é o que cobre o percurso que a equipe faz
 * seguido — quadro → tarefa → voltar → outra lista — sem esticar a janela em
 * que outra pessoa edita e este navegador não fica sabendo.
 *
 * ⚠️ Isto NÃO é colaboração instantânea, e o plano diz isso com todas as
 * letras: dentro da validade, a edição de outra pessoa só aparece quando algo
 * invalidar. O que garante a atualização depois de um GESTO NOSSO é a
 * invalidação explícita, e não o relógio.
 */
export const VALIDADE_DA_LEITURA = 30_000;

/**
 * QUANDO O DADO SEM DONO VAI EMBORA — cinco minutos sem nenhuma tela olhando.
 *
 * Não é o mesmo que a validade: vencido continua na memória e continua servindo
 * de primeiro quadro enquanto revalida. Isto é o descarte de quem ninguém
 * observa há cinco minutos — o teto de quanto dado privado fica parado numa aba
 * esquecida.
 */
export const DESCARTE_DO_INATIVO = 5 * 60_000;

/**
 * Um cliente novo, com a política inteira escrita.
 *
 * A suíte chama isto para ter o seu; o sistema chama uma vez, abaixo.
 */
export function criarClienteDeConsultas(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: VALIDADE_DA_LEITURA,
        gcTime: DESCARTE_DO_INATIVO,

        /* ⚠️ A REPETIÇÃO É DA API, E É UMA SÓ. `getBoard` já repete falha
           passageira (500/502/503/504 e rede caída) uma vez, e já renova a
           sessão uma vez no 401, com promessa compartilhada. A repetição da
           biblioteca por cima disso MULTIPLICA: cada tentativa dela carrega a
           repetição interna junto. Ver o cabeçalho de `@/lib/api`. */
        retry: false,
        /* E uma consulta que falhou não tenta de novo só porque outra tela
           montou. Quem decide tentar de novo é a pessoa, no botão que a tela
           oferece — a mesma regra da F17.AUD04. */
        retryOnMount: false,

        /* AS TRÊS REVALIDAÇÕES QUE O PLANO PEDE, e nenhuma a mais. Todas as
           três só agem sobre dado VENCIDO — é o que as torna baratas:
             · montar/navegar → a tela nova reaproveita o que ainda vale;
             · voltar à aba   → quem ficou uma hora no e-mail vê o atual;
             · reconectar     → o que falhou com o wi-fi fora se recompõe. */
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,

        /* ⚠️ NENHUM POLLING NESTA ENTREGA, e é decisão do plano. Um intervalo
           geral trocaria dezessete leituras por uma leitura a cada N segundos
           em toda tela aberta — que é a dívida de novo, com relógio. */
        refetchInterval: false,
      },
      /* Escrita não se repete sozinha: um `POST` que "falhou" pode ter chegado.
         É a mesma razão pela qual `chamar` não refaz falha de transporte. */
      mutations: { retry: false },
    },
  });
}

/**
 * O cliente do sistema. Um só, com a vida da aplicação.
 *
 * ⚠️ Nasce na IMPORTAÇÃO, e não no primeiro desenho como o roteador: o
 * construtor não ouve evento nenhum (quem ouve foco e rede é `mount()`, que o
 * provedor chama), então não há roteador órfão possível aqui.
 */
export const clienteDeConsultas = criarClienteDeConsultas();

/**
 * O cliente que esta tela usa.
 *
 * ⚠️ ELE NÃO LANÇA QUANDO NÃO HÁ PROVEDOR, e o `useQueryClient` da biblioteca
 *   lança. A diferença é deliberada, e a razão é a suíte: 2.699 provas montam
 *   telas com `renderToStaticMarkup`, fora do `App` e portanto fora do
 *   provedor. Com o gancho da biblioteca, ligar o cache faria dezenas de telas
 *   que não têm nada a ver com isto explodirem com "No QueryClient set" — e o
 *   conserto seria enfiar um provedor em cada arquivo de teste, que é ruído
 *   escondendo o que cada um prova.
 *
 *   Fora do provedor, o cliente é o MESMO do sistema. Não há segundo cache
 *   possível: o de módulo é único, e quem quiser outro (a suíte, que precisa de
 *   isolamento) monta um `QueryClientProvider` com o seu — e o contexto vence.
 *
 * ⚠️ E O PROVEDOR NÃO É FORMALIDADE: é ele que chama `client.mount()`, que é
 *   quem assina o foco da janela e a volta da rede. Sem provedor há cache e
 *   compartilhamento, mas não há revalidação ao voltar para a aba.
 */
export function useClienteDeConsultas(): QueryClient {
  return useContext(QueryClientContext) ?? clienteDeConsultas;
}

/* ─────────────────────────── as chaves ─────────────────────────── */

/**
 * A CHAVE É O QUE FAZ DUAS TELAS DIVIDIREM UMA LEITURA. Ela mora aqui, e não
 * em cada tela, porque duas grafias da mesma chave seriam dois caches — e o
 * defeito apareceria como "às vezes ele busca duas vezes".
 */
export const CHAVE_DA_SESSAO = ['sessao'] as const;
export const CHAVE_DA_ARVORE = ['arvore', 'completa'] as const;

/**
 * O DIRETÓRIO DE QUEM PODE RECEBER TAREFA — F17.CARGA03.
 *
 * ⚠️ POR QUE A CHAVE NÃO CARREGA O USUÁRIO, SENDO QUE O DADO É POR USUÁRIO
 *   `/team` é `ideworks.team_directory()`, e ela responde "a quem EU posso
 *   atribuir" — a lista MUDA conforme quem pergunta. Mesmo assim a chave é
 *   fixa, pela mesma razão de `CHAVE_DA_ARVORE`, que também é por usuário e
 *   também é fixa: quem separa os donos aqui não é a chave, é `consultasSaoDe`.
 *   Confirmar uma identidade diferente RESETA tudo o que não é a sessão, e o
 *   diretório do anterior morre junto com a árvore dele.
 *
 *   Pôr o `userId` na chave seria uma segunda resposta para a mesma pergunta —
 *   e a segunda é a que fica para trás: bastaria uma tela montar antes de
 *   `/auth/me` responder para nascer uma chave `['equipe', null]` que ninguém
 *   invalida e que serve dado a quem não é dono dele.
 *
 * ⚠️ E ISTO NÃO É A LISTA DE RESPONSÁVEIS ELEGÍVEIS DE UMA TAREFA.
 *   `GET /board/tasks/:id/assignable` responde outra pergunta — "quem alcança
 *   ESTA tarefa" — e ela depende da lista e do cliente de cada uma. Guardar
 *   aquela sob uma chave compartilhada ofereceria, numa tarefa, gente que o
 *   banco recusaria nela. O plano proíbe com todas as letras, e a proibição
 *   está escrita aqui porque é aqui que alguém seria tentado.
 */
export const CHAVE_DA_EQUIPE = ['equipe'] as const;

/**
 * Tudo o que NÃO é a sessão.
 *
 * A sessão é a única consulta que sobrevive a uma limpeza, e por um motivo
 * exato: é ela que diz que a limpeza precisava acontecer. Apagá-la junto
 * deixaria a tela montada sem saber que a pessoa mudou — e a tela precisa
 * saber para redesenhar sem os dados de quem saiu.
 */
const naoEhSessao = (consulta: Query) => consulta.queryKey[0] !== CHAVE_DA_SESSAO[0];

/* ────────────────────── de quem são estes dados ────────────────────── */

/**
 * DE QUEM É O CACHE — F17.CARGA02, sobre a máquina da F17.AUD02.
 *
 * O rascunho local aprendeu isso na auditoria de 09/09/2026: guardar dado
 * privado sem dizer de quem ele é acaba oferecendo o CNPJ de um cliente à
 * próxima pessoa que sentar. O cache em memória é a mesma coisa, com a mesma
 * armadilha e um agravante — a árvore de quem saiu continuaria DESENHADA.
 *
 * ⚠️ POR QUE UM `WeakMap`, E NÃO UMA VARIÁVEL DE MÓDULO
 *   A suíte cria um cliente por teste. Com um dono de módulo, o dono de um
 *   teste vazaria para o seguinte, e a prova mais importante desta etapa —
 *   "trocar de conta não mostra o que era do outro" — passaria ou falharia
 *   conforme a ORDEM dos testes. O dono é do cliente, e morre com ele.
 */
const donos = new WeakMap<QueryClient, string>();

/** O dono confirmado deste cliente, ou `null` — ninguém confirmou ainda. */
export const donoDasConsultas = (cliente: QueryClient = clienteDeConsultas): string | null =>
  donos.get(cliente) ?? null;

/**
 * `/auth/me` respondeu: o que está em memória é DESTE usuário.
 *
 * Idempotente e barato — é chamado a cada resposta da sessão, como
 * `assumirDono` do rascunho.
 *
 * ⚠️ E QUANDO A PESSOA MUDOU, `resetQueries` — não `clear`, e a diferença é o
 *   critério mais perigoso desta fase. `clear` esvazia o cache, mas deixa as
 *   telas MONTADAS presas ao que já tinham: elas só descobririam o vazio no
 *   próximo desenho, que pode não vir. `resetQueries` faz as três coisas de
 *   uma vez — descarta o dado, cancela em silêncio o que estava no ar (a
 *   resposta antiga chega e não encontra mais onde entrar) e relê AGORA, já
 *   com o crachá novo. Medido: o observador passa de "dado do anterior" a
 *   "carregando" no mesmo instante, e nunca ao contrário.
 */
export function consultasSaoDe(usuario: string, cliente: QueryClient = clienteDeConsultas): void {
  const anterior = donos.get(cliente) ?? null;
  if (anterior === usuario) return;
  donos.set(cliente, usuario);
  // Na PRIMEIRA confirmação não há nada de ninguém para apagar — e resetar aqui
  // jogaria fora a árvore que acabou de chegar junto com a sessão.
  if (anterior !== null) void cliente.resetQueries({ predicate: naoEhSessao });
}

/**
 * Não há mais ninguém: saiu, ou outra aba avisou que saiu.
 *
 * ⚠️ `reset()` NÓ A NÓ, E NENHUMA LEITURA NOVA. Aqui não se relê por um motivo
 * simples: não há como quem ler. Um `resetQueries` mandaria a tela inteira
 * pedir de novo sem crachá, e o que voltaria seriam 401 em série. O dado some
 * das telas montadas no mesmo instante (o `reset` avisa quem observa) e nada é
 * pedido — a tela já manda para o login por conta própria.
 *
 * O que estava no ar é cancelado em silêncio, e é isso que fecha a porta do
 * caso mais traiçoeiro: a resposta em voo da conta anterior chegando DEPOIS da
 * limpeza e repovoando um cache que acabou de ser esvaziado.
 */
export function esquecerConsultas(cliente: QueryClient = clienteDeConsultas): void {
  donos.delete(cliente);
  for (const consulta of cliente.getQueryCache().findAll({ predicate: naoEhSessao })) {
    consulta.reset();
  }
}

/**
 * E A SESSÃO TAMBÉM — só na porta de ENTRADA.
 *
 * ⚠️ POR QUE ISTO É UMA FUNÇÃO SEPARADA, E NÃO PARTE DE `esquecerConsultas`
 *   `esquecerConsultas` poupa a sessão de propósito: quem a chama por causa de
 *   um 401 precisa que a consulta continue existindo para receber o `null` que
 *   manda a tela ao login. Apagá-la lá desfaria isso.
 *
 *   Mas ENTRAR é o caso oposto, e ele tem um caminho de navegação de aplicação:
 *   quem está dentro cai num endereço inexistente, clica no `Voltar para a
 *   entrada` de `NaoEncontrado` (um `Link`, sem F5) e entra com OUTRA conta. Aí
 *   o cache em memória atravessa, e a consulta de sessão da conta anterior
 *   ainda VALE por trinta segundos — a tela seguinte leria o `userId`, o
 *   e-mail e as áreas de quem saiu, e a ficha da tarefa abriria o rascunho
 *   daquela pessoa. Medido: sem esta linha, entrar como `bia` devolve `ana`.
 *
 * ⚠️ `removeQueries`, E AQUI ELE É SEGURO. Remover uma consulta com observador
 *   vivo a faz nascer de novo e pedir — e é exatamente o que se quer nesta
 *   porta. Além disso, a tela de entrada não observa a sessão: quando esta
 *   linha roda, não há ninguém olhando.
 */
export function esquecerSessao(cliente: QueryClient = clienteDeConsultas): void {
  cliente.removeQueries({ queryKey: CHAVE_DA_SESSAO });
}

/* ─────────────────────────── invalidar ─────────────────────────── */

/**
 * A ÁRVORE MUDOU: releia.
 *
 * Vale para os gestos que mexem nos nós dela — criar, renomear, arquivar,
 * desarquivar, mover, trocar acesso — e para os que mexem nas CONTAGENS que ela
 * carrega, que são as tarefas: criar, mover, concluir, arquivar.
 *
 * ⚠️ UM PEDIDO, NÃO UM POR TELA. Este é o agrupamento que o plano pede, e ele
 * sai de graça da chave compartilhada: a página e a barra observam a MESMA
 * consulta, então invalidar uma vez produz uma leitura só, que chega às duas.
 * Antes, o mesmo gesto relia a árvore da página e deixava a da barra mentindo
 * — ou relia as duas, em dois pedidos.
 *
 * Devolve a promessa da releitura: quem quiser esperar antes de continuar
 * (`await lerArvore()`, como o quadro faz depois de mover) continua podendo.
 */
export function invalidarArvore(cliente: QueryClient = clienteDeConsultas): Promise<void> {
  return cliente.invalidateQueries({ queryKey: CHAVE_DA_ARVORE });
}

/**
 * AS PESSOAS MUDARAM: releia o diretório — F17.CARGA03.
 *
 * Vale para os gestos da tela `Pessoas` que mexem em QUEM existe e em QUEM
 * alcança o quê: aprovar quem estava na fila, trocar papel, desativar,
 * apagar, mudar as empresas ou a carteira. Todos passam por `mudar()` lá, e é
 * de lá que esta função é chamada — um lugar só, e não seis.
 *
 * ⚠️ SEM ISTO, O SELETOR DE RESPONSÁVEL MENTIRIA POR ATÉ CINCO MINUTOS.
 *   Enquanto cada tela relia `/team` ao montar, desativar alguém e abrir uma
 *   tarefa já mostrava a lista nova por acidente. Com a leitura compartilhada,
 *   quem muda avisa — é a mesma regra que `invalidarArvore` escreve para as
 *   contagens, e a mesma armadilha que ela evita.
 *
 * ⚠️ E O CONTRÁRIO TAMBÉM: a invalidação é do GESTO, não da montagem. Chamar
 *   isto ao abrir a tela `Pessoas` faria toda visita àquela tela pagar uma
 *   leitura de diretório que ninguém pediu.
 */
export function invalidarEquipe(cliente: QueryClient = clienteDeConsultas): Promise<void> {
  return cliente.invalidateQueries({ queryKey: CHAVE_DA_EQUIPE });
}
