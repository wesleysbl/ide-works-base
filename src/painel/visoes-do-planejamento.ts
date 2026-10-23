/**
 * As visões do Planejamento e o mês dos dados — F43, Fase 2 (regra pura).
 *
 * TRÊS JEITOS DE VER O MESMO MÊS
 *   Contrato (a carteira com o contrato de cada tipo, a tela inicial), Semanas
 *   (a grade da F35) e Calendário (o calendário editorial de todos, que até a
 *   Fase 4 era a tela `/calendario`). A visão mora no endereço (`?visao=`),
 *   como toda escolha de tela (`@/ui/endereco`): o link colado num comentário
 *   abre o que quem colou estava vendo.
 *
 * O MÊS TAMBÉM MORA NO ENDEREÇO — Fase 4
 *   `?mes=AAAA-MM`. Com o Calendário dentro do Planejamento, o mês é um só
 *   para as três visões, e o link colado ("o calendário de dezembro", "o
 *   contrato de novembro da Carla" com `?cliente=`) precisa abrir no mês de
 *   quem colou — sem ele, abriria no mês de hoje de quem recebeu.
 *
 * O ENDEREÇO ANTIGO CONTINUA LEVANDO AONDE LEVAVA
 *   Antes da F43 a escolha era `?aba=mes|semana` (F35), e esse endereço pode
 *   estar colado em comentário. `?aba=semana` abre Semanas; `?aba=mes` abre
 *   Contrato, que é onde o mês do cliente agora mora. Quando as duas chaves
 *   vêm juntas, `visao` manda — é a escrita mais nova. Escolher uma visão
 *   apaga o `aba`, para o endereço não carregar as duas para sempre.
 *
 * O MÊS DOS DADOS (a regra da F35 contra o mês errado na tela)
 *   A leitura guarda o mês de que é. Trocou o mês e a resposta ainda não
 *   chegou? Não há número na tela — "carregando", e não os números do mês
 *   anterior embaixo do nome do mês novo. O erro também é do mês dele: o de
 *   novembro não fica sobre os números de outubro quando se volta.
 */

import { aplicarMudancas, escolhaValida } from '@/ui/endereco';
import { nomeDoMes } from '@/ui/grade-do-mes';

/* ───────────────────────────── a visão no endereço ───────────────────────────── */

/** Na ordem das abas. `calendario` chegou na Fase 4, no fim: é a lente do dia a dia. */
export const VISOES = ['contrato', 'semanas', 'calendario'] as const;

export type Visao = (typeof VISOES)[number];

export const VISAO_PADRAO: Visao = 'contrato';

export const ROTULO_DA_VISAO: Record<Visao, string> = {
  contrato: 'Contrato',
  semanas: 'Semanas',
  calendario: 'Calendário',
};

/**
 * O ITEM DA BARRA ACESO EM CADA VISÃO — Fase 4.
 *
 * O item `Calendário` da barra continua existindo (o hábito da equipe e as
 * preferências guardadas o têm), mas agora leva a esta tela, na visão
 * Calendário. Quem chega por ele precisa ver ELE aceso — com `Planejamento`
 * aceso, a barra diria que se está noutro lugar do que se clicou. Nas outras
 * visões, o Planejamento.
 */
export function itemDaBarraDaVisao(visao: Visao): 'calendario' | 'planejamento' {
  return visao === 'calendario' ? 'calendario' : 'planejamento';
}

/** O `?aba=` de antes da F43 → a visão de agora. */
const DA_ABA_ANTIGA: Record<string, Visao> = { semana: 'semanas', mes: 'contrato' };

/**
 * A visão que o endereço pede. Tolerante: valor inventado vira Contrato
 * (`escolhaValida`), e o `?aba=` antigo só vale quando não há `visao` válida.
 */
export function visaoDoEndereco(parametros: URLSearchParams): Visao {
  const crua = parametros.get('visao');
  if (crua !== null) {
    const valida = escolhaValida<Visao | ''>(crua, VISOES, '');
    if (valida !== '') return valida;
  }
  const antiga = parametros.get('aba')?.trim().toLowerCase();
  return (antiga && DA_ABA_ANTIGA[antiga]) || VISAO_PADRAO;
}

/**
 * O que gravar no endereço ao escolher uma visão — para `useParametrosNoEndereco`
 * (valor vazio TIRA a chave). A visão é escrita mesmo quando é a padrão: é o que
 * faz o endereço colado valer para quem chegou por `?aba=semana`.
 */
export function mudancasDaVisao(visao: Visao): Record<string, string> {
  return { visao, aba: '' };
}

/* ───────────────────────────── o mês no endereço — Fase 4 ───────────────────────────── */

/**
 * Um mês que a tela aceita: `AAAA-MM`, de 1900 a 2099. Fora disso é
 * digitação (`?mes=2026-13`, `?mes=banana`) ou um ano que ninguém planeja — e
 * o mês vai para a leitura do servidor e para o nome por extenso na tela.
 */
const FORMA_DO_MES = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

/** O mês limpo, ou `null` quando não é um mês que a tela aceita. Tolerante a espaço. */
export function mesValido(cru: string | null | undefined): string | null {
  const limpo = cru?.trim() ?? '';
  return FORMA_DO_MES.test(limpo) ? limpo : null;
}

/**
 * O mês que o endereço pede, ou `padrao` (o mês de hoje, fixado por quem
 * chama ao abrir a tela). Inválido vale o padrão — tela com o mês de hoje, e
 * não tela vazia.
 */
export function mesDoEndereco(parametros: URLSearchParams, padrao: string): string {
  return mesValido(parametros.get('mes')) ?? padrao;
}

/**
 * O que gravar ao escolher um mês. Escrito mesmo quando é o de hoje — é o que
 * faz o link colado valer no mês seguinte para quem o recebe (a mesma regra
 * da visão).
 */
export function mudancasDoMes(mes: string): Record<string, string> {
  return { mes };
}

/**
 * Para onde `/calendario` leva — Fase 4. O Calendário virou a terceira visão
 * do Planejamento, e o endereço antigo pode estar nos favoritos e colado em
 * comentário: ele continua funcionando e leva à visão. O resto da consulta
 * vem junto (um `?mes=` colado vale lá também); `visao` e o `aba` antigo, não
 * — o destino é o Calendário.
 */
export function enderecoDoCalendarioAntigo(busca: string): string {
  const resto = new URLSearchParams(busca);
  resto.delete('visao');
  resto.delete('aba');
  const proximos = new URLSearchParams({ visao: 'calendario' });
  for (const [chave, valor] of resto) proximos.append(chave, valor);
  return `/planejamento?${proximos.toString()}`;
}

/* ───────────────────────────── o cliente no endereço — Fase 3 ───────────────────────────── */

/**
 * O PAINEL DO CLIENTE TAMBÉM MORA NO ENDEREÇO (`?cliente=<id>`)
 *   O link colado num comentário abre o Planejamento com o mês daquele
 *   cliente ao lado — é a mesma regra da visão. Abrir e fechar gravam com
 *   `replace`, como toda escolha de tela: o VOLTAR sai do Planejamento, e não
 *   "desfaz" o painel.
 *
 * TOLERANTE NA LEITURA, COMO A VISÃO
 *   O id vem da barra de endereço, onde qualquer coisa pode ser digitada, e
 *   vai parar num link (`/cliente/<id>`). Só passa o que tem forma de id —
 *   letras, números, hífen e sublinhado, até 64 —; o resto é "sem painel".
 */
const FORMA_DO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** O cliente cujo painel o endereço pede, ou `null`. */
export function clienteDoEndereco(parametros: URLSearchParams): string | null {
  const cru = parametros.get('cliente')?.trim() ?? '';
  return FORMA_DO_ID.test(cru) ? cru : null;
}

/** O que gravar para abrir (`id`) ou fechar (`null`) o painel — valor vazio TIRA a chave. */
export function mudancasDoPainel(id: string | null): Record<string, string> {
  return { cliente: id ?? '' };
}

/**
 * O `href` que abre o painel de `id` sem perder o resto do endereço (a
 * visão). É um link de verdade — o clique do meio abre o mesmo painel numa
 * aba nova —, só a consulta: o caminho é o da tela em que ele está.
 */
export function enderecoDoPainel(parametros: URLSearchParams, id: string): string {
  return `?${aplicarMudancas(parametros, mudancasDoPainel(id)).toString()}`;
}

/* ───────────────────────────── o mês dos dados ───────────────────────────── */

/** O que se leu de um mês. `T` é a forma das duas leituras juntas. */
export type LeituraGuardada<T> = { mes: string; valor: T };
export type FalhaGuardada = { mes: string; texto: string };

/**
 * O que a tela pode mostrar de `mes`, a partir do que está guardado.
 *
 *   dados       só se forem DESTE mês;
 *   erro        só se for DESTE mês;
 *   carregando  nada deste mês ainda — nem dado, nem erro.
 *
 * Releitura do MESMO mês (depois de gravar) mantém os dados na tela: o mês é
 * o mesmo, e a grade não pisca.
 */
export function leituraDoMes<T>(
  guardada: LeituraGuardada<T> | null,
  falha: FalhaGuardada | null,
  mes: string,
): { dados: T | null; erro: string | null; carregando: boolean } {
  const dados = guardada?.mes === mes ? guardada.valor : null;
  const erro = falha?.mes === mes ? falha.texto : null;
  return { dados, erro, carregando: dados === null && erro === null };
}

/**
 * A RELEITURA QUE SE PODE ESPERAR — revisão pós-F43.
 *
 * O `recarregar` da página só aumentava um número e devolvia `void`. A grade
 * `Semanal` do painel do cliente faz `await aoMudar()` depois de cada gesto,
 * para não deixar dois cliques correrem juntos e para o próximo `+` contar
 * `naBase` com o mês já relido (é com essa conta que a peça nasce extra ou
 * não). Com `void` o `await` passava na hora: o segundo `+` saía com a conta
 * velha.
 *
 * Aqui, a conta de quem espera. Cada leitura que COMEÇA ganha uma geração; a
 * espera pedida antes dela só termina quando chega uma leitura de geração
 * maior — a que o pedido disparou (ou uma posterior: trocar de mês também
 * serve). A leitura que já estava em voo quando se pediu não atende: ela traz
 * o mês de antes da escrita. Falha também termina a espera — a tela já mostra
 * a falha do mês, e quem espera só precisa saber que a leitura assentou.
 */
export function criarEsperaDaReleitura(): {
  /** Uma leitura começou; devolve a geração dela. */
  comecou: () => number;
  /** A leitura `geracao` chegou (com dado ou com falha) e ainda vale. */
  chegou: (geracao: number) => void;
  /** Termina quando chegar uma leitura que comece DEPOIS desta chamada. */
  proxima: () => Promise<void>;
} {
  let geracao = 0;
  let esperando: { depoisDe: number; soltar: () => void }[] = [];
  return {
    comecou: () => {
      geracao += 1;
      return geracao;
    },
    chegou: (g) => {
      const prontas = esperando.filter((e) => e.depoisDe < g);
      esperando = esperando.filter((e) => e.depoisDe >= g);
      for (const e of prontas) e.soltar();
    },
    proxima: () =>
      new Promise<void>((soltar) => {
        esperando.push({ depoisDe: geracao, soltar });
      }),
  };
}

/**
 * A frase da falha, com o mês a que ela se refere — sem o mês, "não foi
 * possível carregar" logo depois de trocar de mês deixa a dúvida de qual dos
 * dois falhou. A frase do servidor vem inteira, depois.
 */
export function fraseDaFalha(mes: string, texto: string | null): string {
  const doServidor = texto?.trim();
  return `O planejamento de ${nomeDoMes(mes)} não carregou.${doServidor ? ` ${doServidor}` : ''}`;
}
