/**
 * A TRILHA — de onde se veio, em todas as telas do Pilar B. Etapa F17.25.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE O USUÁRIO PEDIU
 *
 *   *"no topo das abas, seja em espaço, tarefa ou algo do tipo, deve ter a
 *   trilha de onde foi clicado para acessar cada parte (…) as imagens com o `>`
 *   indicando o caminho seguido — mandei um exemplo do explorador de
 *   arquivos."*
 *
 *   As referências dele:
 *
 *     Compartilhado comigo  /  📁 Academia Movimento
 *     Compartilhado comigo  /  📁 FIORART  /  ✓≡ Fiorart (setup)
 *     Área de Trabalho  >  Agentes IA  >  ideal marketing places  >  .claude
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O QUE JÁ HAVIA, MEDIDO NO CHROME ANTES DE ESCREVER
 *
 *   | tela              | trilha                                   | clicável |
 *   |-------------------|------------------------------------------|----------|
 *   | `/quadro/:id`     | `Ide · Demandas / Todas as demandas`     | **não**  |
 *   | `/tarefa/:id`     | `Ide · Demandas / Todas as demandas`     | **não**  |
 *   | `/meu-trabalho`   | nenhuma no topo (só dentro de cada linha) | —       |
 *   | `/tarefas`        | nenhuma no topo (só dentro do cartão)     | —       |
 *
 *   Três separadores diferentes conviviam (`·`, `/`, e nada), nenhum degrau
 *   clicava, e nenhum tinha ícone. As duas telas de trabalho não diziam onde
 *   estavam.
 *
 * ⚠️ A PROFUNDIDADE É LIMITADA PELO MODELO, E ISSO DECIDE O ENCURTAMENTO
 *   São no máximo CINCO degraus, e o quinto só existe na ficha:
 *
 *     Compartilhado comigo › espaço › pasta › lista › tarefa
 *
 *   Até a F31 eram seis: a empresa vinha entre a raiz e o espaço. Ela saiu da
 *   trilha em 25/09 — o sistema "será apenas Ide" (Wesley), e um degrau que
 *   diz `Ide` em toda tela de toda pessoa não informa nada. A empresa continua
 *   decidindo quem vê o espaço; só deixou de ser lida no caminho.
 *
 *   Não há sétimo: pasta não aninha (a F17.1 mediu, e o ClickUp não permite).
 *   Então o que estoura a largura NÃO é a quantidade de degraus — é o
 *   COMPRIMENTO DOS NOMES. `Etapa 1: Organização Estratégica Inicial` sozinho
 *   passa de 300 px.
 *
 *   Por isso o encurtamento é em duas camadas, e nesta ordem:
 *
 *     1. **Cada nome trunca com reticências** (CSS), e o ÚLTIMO degrau — o
 *        lugar onde a pessoa está — ganha o dobro de espaço dos outros. É a
 *        resposta para o caso comum.
 *     2. **O meio vira `…`** quando a trilha inteira NÃO CABE na caixa, e o `…`
 *        é um botão que a devolve inteira. Some o MEIO, e não o começo, por
 *        dois motivos: o primeiro degrau é o único que nunca muda e é o
 *        caminho de volta; os últimos são a resposta de "onde estou". O meio é
 *        justamente o que a árvore da barra lateral mostra aberta, ao lado.
 *
 *   ⚠️ **"NÃO CABE" É MEDIDO, NÃO CONTADO.** A primeira versão encurtava acima
 *   de cinco degraus, e no Chrome de 1440 px a ficha apareceu como
 *   `Compartilhado comigo › … › Setembro › 01/09` com metade da largura
 *   sobrando — escondendo empresa, espaço e pasta por nada. Quem mede é
 *   `TrilhaDoLugar`, comparando a largura da trilha inteira com a da caixa.
 *
 * ESPAÇO E PASTA SÃO ENDEREÇOS — E O DEGRAU DELES LEVA ATÉ LÁ (28/09)
 *   Lista (`/quadro/:id`), tarefa (`/tarefa/:id`), espaço (`/quadro/espaco/:id`,
 *   F17.26) e pasta (`/quadro/pasta/:id`, F17.64) têm tela. Até 28/09 o degrau
 *   de espaço e o de pasta, no quadro da lista, só REVELAVAM o nó na árvore
 *   ao lado — e isso estava escrito aqui como dívida. Com o shell novo (F02) a
 *   árvore quase sempre está recolhida no trilho ou na gaveta, e revelar não
 *   mostrava nada: o Wesley clicou em `TIME HELENA` no quadro de `Jobs
 *   Antonelli` e "não atualiza e nem vai". A dívida foi paga: em TODAS as
 *   trilhas o degrau de pasta leva a `/quadro/pasta/<id>` (as tarefas da pasta
 *   juntas) e o de espaço a `/quadro/espaco/<id>` (a visão geral dele).
 *
 *   `no` continua indo junto (`space:<id>`, `folder:<id>` — a mesma chave que
 *   `@/ui/lugar` guarda como recolhida): o clique também ABRE aquele nó na
 *   árvore, para a barra acompanhar quando for aberta. O botão
 *   `Mostrar … na barra lateral` ficou só para degrau que tem nó e não tem
 *   endereço — o que hoje só acontece quando falta o id.
 *
 *   O degrau que é ONDE SE ESTÁ continua sem destino e sem nó (`trilhaDoEspaco`,
 *   `trilhaDaPasta`, `trilhaDoQuadro` zeram o último).
 *
 *   A empresa não tem nem tela nem nó, e desde a F31 nem degrau (ver acima).
 */

import {
  type ItemDaBarra,
  ROTULO_DA_SECAO,
  ROTULO_DO_ITEM,
  SECAO_DO_ITEM,
} from '@/ui/preferencias';

/** Que nível cada degrau é. É ele que escolhe o ícone. */
export type TipoDeDegrau = 'raiz' | 'espaco' | 'pasta' | 'lista' | 'tarefa' | 'tela';

export type Degrau = {
  tipo: TipoDeDegrau;
  nome: string;
  /** Endereço para onde o degrau leva. Nulo = não leva a lugar nenhum. */
  destino: string | null;
  /** A chave do nó na árvore. Nulo quando o degrau não é nó. */
  no: string | null;
  /** A cor do espaço, quando a origem a manda. Só o degrau de espaço a usa. */
  cor?: string | null;
};

/**
 * O teto de degraus, para quem NÃO pode medir a tela.
 *
 * ⚠️ A TELA MEDE. `TrilhaDoLugar` compara a largura da trilha inteira com a da
 * caixa e passa `0` aqui quando não cabe — encurtar por contagem numa janela de
 * 1440 px escondia empresa, espaço e pasta com metade da largura sobrando, e
 * foi medido no Chrome antes de virar isto.
 *
 * O valor continua existindo porque `encurtar` é pura e precisa de um padrão
 * defensável para quem a chamar sem régua: quatro é o quadro inteiro
 * (`raiz › espaço › pasta › lista`), e o quinto só aparece na ficha. Era cinco
 * até a F31, quando a empresa saiu da trilha: o teto desceu junto para a ficha
 * continuar sendo a única que encurta por contagem.
 */
export const TETO = 4;

/** O que fica no lugar do meio encurtado. */
export const RETICENCIAS = '…';

export type Encurtada =
  | { tipo: 'degrau'; degrau: Degrau; posicao: number }
  | { tipo: 'reticencias'; escondidos: number };

/**
 * A trilha na largura de tela.
 *
 * Guarda o PRIMEIRO e os dois ÚLTIMOS, sempre. Com `TETO` 4, a ficha da tarefa
 * (cinco degraus) encurta e o quadro (quatro) não.
 */
export function encurtar(degraus: readonly Degrau[], teto = TETO): Encurtada[] {
  const inteira = (): Encurtada[] =>
    degraus.map((degrau, posicao) => ({ tipo: 'degrau', degrau, posicao }));

  // MENOS DE QUATRO DEGRAUS NÃO TÊM MEIO. O primeiro e os dois últimos já são
  // todos, e um `…` que esconde zero degraus é um botão que promete o que já
  // está à vista. Vale mesmo com `teto` 0 — que é o que a tela passa quando
  // mediu e a trilha não coube.
  if (degraus.length < 4) return inteira();
  if (degraus.length <= teto) return inteira();

  const fim = degraus.slice(-2);
  const escondidos = degraus.length - 3;
  return [
    { tipo: 'degrau', degrau: degraus[0], posicao: 0 },
    { tipo: 'reticencias', escondidos },
    ...fim.map((degrau, i) => ({
      tipo: 'degrau' as const,
      degrau,
      posicao: degraus.length - 2 + i,
    })),
  ];
}

/**
 * O DEGRAU ANTERIOR — para onde o VOLTAR leva quem chegou sem histórico.
 * Etapa F17.33.
 *
 * A trilha já sabe o caminho inteiro; quem chega por um link colado precisa do
 * penúltimo lugar dele que seja ENDEREÇO de verdade. Então: do fim para o
 * começo, pulando o último degrau (que é onde se está), o primeiro que tiver
 * `destino`.
 *
 * ⚠️ `no` NÃO SERVE AQUI, e isso não é esquecimento. Um degrau de pasta ou de
 * espaço sem `destino` só sabe ABRIR UM NÓ na árvore da barra lateral — e nas
 * telas onde essa árvore existe já se está dentro dela. Um voltar que expande
 * um galho não tirou ninguém de lugar nenhum.
 *
 * Devolve `null` quando não há nenhum: a tela então não desenha o botão, em vez
 * de desenhar um que não vai a lugar algum.
 */
export function destinoAcima(degraus: readonly Degrau[]): string | null {
  for (let i = degraus.length - 2; i >= 0; i -= 1) {
    const d = degraus[i].destino;
    if (d !== null) return d;
  }
  return null;
}

/* ═════════════════════════ os construtores ═════════════════════════ */

/** A raiz das telas que moram na árvore. É o nome que a barra lateral usa. */
const raiz = (): Degrau => ({
  tipo: 'raiz',
  nome: ROTULO_DA_SECAO.arvore,
  // `/quadro` sem id abre a última lista que a pessoa tinha aberto (F17.24) —
  // que é o mais perto de "a árvore inteira" que existe como endereço.
  destino: '/quadro',
  no: null,
});

/**
 * O que a trilha precisa saber sobre um lugar da árvore.
 *
 * Sem `categoryName` desde a F31: a empresa saiu da trilha. Quem passa a linha
 * inteira (`WorkRow`, o cabeçalho do quadro) continua podendo — o campo a mais
 * só não é lido.
 */
export type Lugar = {
  spaceId?: string | null;
  spaceName?: string | null;
  spaceColor?: string | null;
  folderId?: string | null;
  folderName?: string | null;
  listId?: string | null;
  listName?: string | null;
};

/**
 * Os degraus da árvore — espaço, pasta, lista. Sem a empresa desde a F31.
 *
 * O que falta some, em vez de virar buraco: lista solta no espaço não tem
 * pasta, e tarefa criada pelo Pilar A′ pode não ter lista nenhuma. É a mesma
 * regra que `trilha()` de `@/board/meu-trabalho` já seguia.
 */
export function degrausDaArvore(lugar: Lugar): Degrau[] {
  const degraus: Degrau[] = [];

  if (lugar.spaceName) {
    degraus.push({
      tipo: 'espaco',
      nome: lugar.spaceName,
      destino: lugar.spaceId ? `/quadro/espaco/${lugar.spaceId}` : null,
      no: lugar.spaceId ? `space:${lugar.spaceId}` : null,
      cor: lugar.spaceColor ?? null,
    });
  }
  if (lugar.folderName) {
    degraus.push({
      tipo: 'pasta',
      nome: lugar.folderName,
      destino: lugar.folderId ? `/quadro/pasta/${lugar.folderId}` : null,
      no: lugar.folderId ? `folder:${lugar.folderId}` : null,
    });
  }
  if (lugar.listName) {
    degraus.push({
      tipo: 'lista',
      nome: lugar.listName,
      destino: lugar.listId ? `/quadro/${lugar.listId}` : null,
      no: null,
    });
  }

  return degraus;
}

/**
 * A trilha do quadro de uma lista.
 *
 * O último degrau é a lista, e ele é ONDE SE ESTÁ — por isso não leva a lugar
 * nenhum: um link para a tela que já está aberta é um link que não faz nada.
 */
export function trilhaDoQuadro(lugar: Lugar): Degrau[] {
  const degraus = degrausDaArvore(lugar);
  const ultimo = degraus[degraus.length - 1];
  if (ultimo?.tipo === 'lista') ultimo.destino = null;
  // ⚠️ A RAIZ NÃO CLICA AQUI (28/09). `/quadro` sem id abre a ÚLTIMA LISTA
  // aberta — que, no quadro de uma lista, é esta mesma. O link ia e voltava
  // para a própria tela: o mesmo "não vai" que o Wesley viu no espaço e na
  // pasta. Nas outras trilhas (pasta, espaço, ficha) ela continua levando.
  return [{ ...raiz(), destino: null }, ...degraus];
}

/**
 * A trilha da VISÃO GERAL DO ESPAÇO — F17.26.
 *
 * Um degrau depois da raiz: o espaço, que é ONDE SE ESTÁ. (Até a F31 a empresa
 * vinha antes dele, sem clique.)
 *
 * ⚠️ O `no` DO ESPAÇO É ZERADO AQUI, e isso não é detalhe. Com ele, `Trilha`
 * desenharia um botão `Mostrar … na barra lateral` para o nó cuja tela já está
 * aberta — o equivalente de um link para a própria página, com um rótulo que
 * promete ir a outro lugar.
 */
export function trilhaDoEspaco(lugar: Lugar): Degrau[] {
  const degraus = degrausDaArvore(lugar);
  const ultimo = degraus[degraus.length - 1];
  if (ultimo?.tipo === 'espaco') {
    ultimo.destino = null;
    ultimo.no = null;
  }
  return [raiz(), ...degraus];
}

/**
 * A trilha do QUADRO DA PASTA — F17.64.
 *
 * Dois degraus depois da raiz: o espaço — que leva à visão geral dele
 * (`/quadro/espaco/:id`) — e a pasta, que é ONDE SE ESTÁ. (Até a F31
 * a empresa vinha antes deles, sem clique.)
 *
 * ⚠️ O `no` DA PASTA É ZERADO AQUI, pelo mesmo motivo que o do espaço é zerado
 * em `trilhaDoEspaco`: com ele, `Trilha` desenharia um botão
 * `Mostrar … na barra lateral` para o nó cuja tela já está aberta.
 */
export function trilhaDaPasta(lugar: Lugar): Degrau[] {
  const degraus = degrausDaArvore(lugar);
  const ultimo = degraus[degraus.length - 1];
  if (ultimo?.tipo === 'pasta') {
    ultimo.destino = null;
    ultimo.no = null;
  }
  return [raiz(), ...degraus];
}

/**
 * A trilha da ficha da tarefa.
 *
 * Espaço e pasta levam às telas deles, como em toda trilha (28/09). Até ali,
 * aqui os dois levavam ao quadro DA LISTA da tarefa — o que fazia `TIME HELENA`
 * e `AGÊNCIA IDE` abrirem a mesma coisa que o degrau da lista.
 */
export function trilhaDaTarefa(
  tarefa: Lugar & { title: string },
): Degrau[] {
  return [
    raiz(),
    ...degrausDaArvore(tarefa),
    { tipo: 'tarefa', nome: tarefa.title, destino: null, no: null },
  ];
}

/**
 * A trilha das telas que não moram na árvore — `Minhas tarefas`, `Todas as
 * tarefas`.
 *
 * ⚠️ F29.5b: o quadro sem lista escolhida (e pasta e espaço em carga) saiu
 * daqui para `trilhaEmEspera` — ele MORA na árvore. E desde a F29 (Fase 4)
 * `Minhas tarefas` e `Todas as tarefas` são telas principais, só com o título:
 * nenhuma tela chama esta função hoje. Ela fica pela suíte que a descreve, e
 * sai quando alguém confirmar que nenhuma tela de seção vai querer trilha.
 *
 * O primeiro degrau é a SEÇÃO da barra lateral, e ele não clica: seção não é
 * lugar, é um título. O segundo é a tela, e é onde se está.
 */
export function trilhaDaTela(item: ItemDaBarra): Degrau[] {
  return [
    { tipo: 'raiz', nome: ROTULO_DA_SECAO[SECAO_DO_ITEM[item]], destino: null, no: null },
    { tipo: 'tela', nome: ROTULO_DO_ITEM[item], destino: null, no: null },
  ];
}

/**
 * A trilha do quadro, da pasta e do espaço ENQUANTO O LUGAR NÃO CHEGOU — em
 * carga ou com erro de leitura. F29.5b.
 *
 * Até aqui essas três telas caíam em `trilhaDaTela('quadro')`, que dizia
 * `Meu trabalho › Quadro` sem degrau nenhum clicável: a tela da ÁRVORE se
 * apresentava como de outra seção, e com a leitura falhando não havia saída
 * pela trilha. Agora o primeiro degrau é a MESMA raiz das trilhas carregadas
 * (`Compartilhado comigo`, leva a `/quadro`), e o segundo é a tela onde se
 * está, sem clique. Quando o lugar chega, só entram os degraus do meio — o
 * primeiro e o nome da tela não mudam de lugar.
 */
export function trilhaEmEspera(tela: 'Quadro' | 'Pasta' | 'Espaço'): Degrau[] {
  return [raiz(), { tipo: 'tela', nome: tela, destino: null, no: null }];
}

/**
 * A trilha das telas que são DETALHE de outra fora da árvore — F29 (Fase 5a).
 *
 * `Painel › Jatobá` (a ficha do cliente), `Meta › Ranking de criativos`,
 * `Meta › <conta>`, `Pessoas › Convidar`. Dois degraus: o PAI, com endereço e
 * nome — é a saída que o `‹ Voltar` da F17.33 fazia sem dizer para onde —, e o
 * lugar onde se está, que não clica.
 *
 * ⚠️ O PAI É SEMPRE O MESMO, E ISSO É O QUE O VOLTAR NÃO TINHA. O Voltar
 *   fazia "anterior" quando havia histórico: a ficha do cliente aberta pela
 *   árvore voltava ao quadro; aberta pelo painel, ao painel. A trilha diz o
 *   lugar ACIMA, pelo nome, e leva sempre a ele — quem quer o anterior tem o
 *   botão do navegador, que nunca prometeu outra coisa.
 */
export function trilhaDeDetalhe(pai: { nome: string; destino: string }, aqui: string): Degrau[] {
  return [
    { tipo: 'tela', nome: pai.nome, destino: pai.destino, no: null },
    { tipo: 'tela', nome: aqui, destino: null, no: null },
  ];
}

/**
 * A trilha curta de uma LINHA de lista — a de `Minhas tarefas` e a do cartão de
 * `Todas as tarefas`.
 *
 * Sem raiz e sem a própria tarefa: ali a pergunta é "de onde é este trabalho",
 * e o título está logo acima. Só a lista clica — ver `Trilha` para o porquê de
 * a versão curta não trazer ícone.
 */
export function trilhaDaLinha(lugar: Lugar): Degrau[] {
  return degrausDaArvore(lugar);
}
