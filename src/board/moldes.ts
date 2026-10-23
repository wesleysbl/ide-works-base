/**
 * OS MOLDES DE ESTEIRA — as etapas oferecidas na CRIAÇÃO. Etapa F17.16.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE FALTAVA NÃO ERA A CAPACIDADE, ERA O MOMENTO
 *
 *   *"dentro da lista deve ser personalizável as etapas, e não ser apenas a
 *   fazer e concluídas, na criação desse processo deve ser organizado."*
 *   — o usuário, 2026-08-26.
 *
 *   `status_sets` e `statuses` existem desde a F17.2, com dono em espaço, pasta
 *   ou lista; a F17.14 pôs o editor no `···` da lista → `Esteira…`. Dava para
 *   personalizar — DEPOIS. A lista nascia com `a fazer` / `concluída` e alguém
 *   tinha que lembrar de voltar lá. Ninguém lembra.
 *
 *   Então a escolha sobe para o momento da criação, e vem com molde: as quatro
 *   esteiras que a equipe usa todo dia, medidas no ClickUp deles, mais a
 *   simples de dois estados que é o padrão de hoje.
 *
 * ⚠️ `desing de capa` ESTÁ ESCRITO ERRADO, E É ASSIM DE PROPÓSITO
 *
 *   O certo seria `design de capa`. No ClickUp da Ide está `desing`, com as
 *   letras trocadas, e é essa a palavra que a equipe lê todo dia no quadro de
 *   vídeo. **Decisão D21 do roteiro mestre: o que existe lá é copiado como
 *   está.**
 *
 *   Corrigir a grafia aqui produziria duas verdades — a coluna do ClickUp e a
 *   coluna do IDE Works com nomes diferentes — bem na semana em que os dois vão
 *   rodar lado a lado. Quem for "consertar" isto: não é erro de digitação
 *   desta base, é a palavra da origem. Há teste que falha se alguém arrumar
 *   (`moldes.test.ts`).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EXATAMENTE UM STATUS QUE FECHA, EM TODOS OS MOLDES
 *   `ideworks.create_status_set` recusa esteira com zero ou dois `closed`, com
 *   frase própria — *"é ele que faz o quadro saber onde é o fim"*. Em todos os
 *   moldes abaixo o ÚLTIMO é o que fecha, e `conferirEsteira` de `arvore.ts` é
 *   quem confere isso na tela antes de gastar a ida ao banco. O teste desta
 *   etapa passa os cinco moldes por ela.
 *
 * A PRIMEIRA COLUNA É `open` EM TODOS OS MOLDES, E ISSO DECIDE ONDE A TAREFA CAI
 *   `ideworks.first_open_status` ordena por "não é `open`" e depois por
 *   `sort_order`: quem manda é o PRIMEIRO `open` da esteira. É ele que recebe a
 *   tarefa criada sem status escolhido, e é ele que recebe a tarefa que muda para
 *   uma esteira onde o status antigo não existe.
 *
 *   Por isso nenhum molde usa `unstarted` na cabeça: `idéias`, `ideia inicial` e
 *   `configurações da conta` são a PRIMEIRA coluna do quadro no ClickUp, e é
 *   nelas que a tarefa nova aparece lá. Marcá-las `unstarted` faria a tarefa
 *   nascer na segunda coluna aqui — divergência silenciosa entre os dois
 *   sistemas, justamente no gesto mais repetido do dia.
 *
 * A COR NÃO É LITERAL DE TAILWIND — É DADO
 *   `statuses.color` é coluna do banco e vem da origem como `#d3d3d3`. Ela viaja
 *   como valor e chega à tela por variável no elemento (`--cor-status`), nunca
 *   como classe. Decisão D10.
 */

import { ESTEIRA_PADRAO, type StatusEmEdicao } from '@/board/arvore';

/* ───────────────────────────── a paleta dos moldes ───────────────────────── */

/**
 * Os tons por PAPEL na esteira, e não por nome de cor.
 *
 * O ClickUp guarda uma cor por status e a equipe lê o quadro pela cor antes de
 * ler o texto. Aqui os tons seguem o significado: cinza para o que não começou,
 * azul para o que anda, âmbar para o que espera gente de fora, vermelho para o
 * que voltou, verde para o que fechou.
 */
const CINZA = '#d3d3d3';
const AZUL = '#4a90e2';
const ROXO = '#8b6ee8';
const AMBAR = '#e5a53f';
const VERMELHO = '#e05252';
const VERDE = '#6bc950';
const TEAL = '#3fb8af';

/* ───────────────────────────── os moldes ───────────────────────────── */

export type MoldeDeEsteira = {
  chave: string;
  /** O nome que vai para `status_sets.name`, e o que a tela mostra. */
  nome: string;
  /** Uma linha explicando para que serve — a tela põe no `title`. */
  resumo: string;
  statuses: StatusEmEdicao[];
};

/**
 * As quatro esteiras reais da casa, mais a simples.
 *
 * MEDIDAS NO CLICKUP DELES, não inventadas. Os nomes vêm em minúsculas porque é
 * assim que a origem os guarda; a tela é quem escreve em caixa alta (o quadro
 * já faz isso com `text-transform`).
 */
export const MOLDES_DE_ESTEIRA: readonly MoldeDeEsteira[] = [
  {
    chave: 'conteudo',
    nome: 'Conteúdo',
    resumo: 'A esteira do conteúdo: da ideia à publicação, com aprovação do cliente.',
    statuses: [
      { name: 'idéias', type: 'open', color: CINZA },
      { name: 'a fazer', type: 'open', color: CINZA },
      { name: 'em andamento', type: 'custom', color: AZUL },
      { name: 'refação', type: 'custom', color: VERMELHO },
      { name: 'revisão interna', type: 'custom', color: ROXO },
      { name: 'em aprovação do cliente', type: 'custom', color: AMBAR },
      { name: 'publicar/agendar', type: 'done', color: TEAL },
      { name: 'concluído', type: 'closed', color: VERDE },
    ],
  },
  {
    chave: 'video',
    nome: 'Vídeo',
    resumo: 'A esteira do vídeo: roteiro, captação, edição, capa e aprovação.',
    statuses: [
      { name: 'ideia inicial', type: 'open', color: CINZA },
      { name: 'roteiro em progresso', type: 'custom', color: AZUL },
      { name: 'aprovação do roteiro', type: 'custom', color: AMBAR },
      { name: 'em captação', type: 'custom', color: AZUL },
      { name: 'em edição', type: 'custom', color: AZUL },
      // ⚠️ `desing` — a grafia da origem. Ver o cabeçalho: D21, e há teste.
      { name: 'desing de capa', type: 'custom', color: ROXO },
      { name: 'revisão interna', type: 'custom', color: ROXO },
      { name: 'em aprovação do cliente', type: 'custom', color: AMBAR },
      { name: 'publicar/agendar', type: 'done', color: TEAL },
      { name: 'concluído', type: 'closed', color: VERDE },
    ],
  },
  {
    chave: 'ads',
    nome: 'ADS',
    resumo: 'A esteira de tráfego pago: conta, verba, criativo, no ar e acompanhamento.',
    statuses: [
      { name: 'configurações da conta', type: 'open', color: CINZA },
      { name: 'aguardando verba', type: 'custom', color: AMBAR },
      { name: 'aguardando criativo', type: 'custom', color: AMBAR },
      { name: 'pausada', type: 'custom', color: VERMELHO },
      { name: 'revisão interna', type: 'custom', color: ROXO },
      { name: 'em aprovação do cliente', type: 'custom', color: AMBAR },
      { name: 'publicar/agendar', type: 'custom', color: AZUL },
      { name: 'ativo (acompanhamento)', type: 'done', color: TEAL },
      { name: 'concluído', type: 'closed', color: VERDE },
    ],
  },
  {
    chave: 'demanda',
    nome: 'Demanda',
    resumo: 'A esteira das demandas avulsas, com a fila por tipo e o envio ao cliente.',
    statuses: [
      { name: 'a fazer', type: 'open', color: CINZA },
      { name: 'a fazer video', type: 'open', color: CINZA },
      { name: 'a fazer arte', type: 'open', color: CINZA },
      { name: 'atribuir demanda', type: 'open', color: CINZA },
      { name: 'stand-by', type: 'custom', color: AMBAR },
      { name: 'em andamento', type: 'custom', color: AZUL },
      { name: 'aprovação', type: 'custom', color: ROXO },
      { name: 'enviar para cliente', type: 'custom', color: AMBAR },
      { name: 'enviado para cliente', type: 'custom', color: TEAL },
      { name: 'refação', type: 'custom', color: VERMELHO },
      { name: 'agendar postagem', type: 'done', color: TEAL },
      { name: 'demanda concluída', type: 'closed', color: VERDE },
    ],
  },
  {
    chave: 'simples',
    nome: 'Simples',
    resumo: 'Dois estados — o que a lista ganhava sozinha até aqui.',
    // A MESMA lista de `arvore.ts`, e não uma cópia: dois lugares dizendo qual é
    // a esteira padrão dariam duas respostas na primeira vez que uma mudasse.
    statuses: [...ESTEIRA_PADRAO],
  },
];

/** O molde de uma chave, ou nulo. A tela guarda a chave, nunca o vetor inteiro. */
export function moldePorChave(chave: string): MoldeDeEsteira | null {
  return MOLDES_DE_ESTEIRA.find((m) => m.chave === chave) ?? null;
}

/**
 * A chave que significa "não crie esteira nenhuma".
 *
 * NÃO é um molde vazio: para a LISTA, herdar é o padrão de hoje e continua
 * sendo — a lista sem conjunto próprio resolve pela pasta e pelo espaço, e é
 * assim que as duas listas reais funcionam. O molde só entra quando alguém
 * escolhe um.
 */
export const HERDAR = 'herdar';
