/**
 * ACHAR A TAREFA, E ACHAR O QUE É MEU — etapa F17.55.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   *"você consegue colocar uma opção de buscar uma tarefa específica e também
 *   responsável específico?"* — apontando a lupa e o botão `Responsável` da
 *   barra do ClickUp.
 *
 * POR QUE VIROU NECESSIDADE
 *   A F17.49 trouxe 1.797 tarefas. `ATENDIMENTO` tem 1.070, e a coluna mostra
 *   50 por vez (F17.50). Sem busca, achar uma tarefa específica ali é
 *   impossível — e achar o que é seu, também: 1.015 das 1.070 daquela lista não
 *   têm ninguém. Por isso `sem responsável` é uma escolha de filtro, e não um
 *   caso de borda: hoje ela é a maioria esmagadora.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ESTE ARQUIVO NÃO SABE O QUE É UM QUADRO, E NÃO FALA COM NINGUÉM
 *   Ele é o MODELO do filtro — o que a tela guarda, o que o endereço carrega, e
 *   o que a consulta recebe. As três telas que filtram (o quadro, `Todas as
 *   tarefas` e o que vier) leem daqui, e por isso não conseguem discordar sobre
 *   o que significa "sem responsável".
 *
 * ⚠️ O RECORTE DE ACESSO NÃO MORA AQUI, E NUNCA VAI MORAR
 *   Quem a pessoa alcança é decisão da política de linha de `tasks`, avaliada
 *   DENTRO da consulta. Este filtro é uma segunda peneira, sobre o que já
 *   passou pela primeira — e as duas se compõem na mesma cláusula. Uma busca
 *   que filtrasse em JavaScript, depois da resposta, teria de receber o que a
 *   pessoa não alcança para poder descartar. Ver `server/board.ts`.
 *
 * ⚠️ O ACENTO SE TIRA DOS DOIS LADOS, COM A MESMA TABELA
 *   `unaccent` não está instalado neste banco (conferido em 2026-09-02), e
 *   pedir uma extensão para uma busca por título seria uma migration por
 *   conveniência. O que a consulta faz é `translate(lower(title), DE, PARA)`,
 *   passando as duas tabelas como PARÂMETRO — as mesmas constantes que este
 *   arquivo exporta e que `semAcento` usa aqui.
 *
 *   As duas pontas partem da mesma string, então elas não têm como divergir:
 *   se alguém acrescentar uma letra a `ACENTOS_DE`, o banco e o navegador
 *   passam a dobrar a mesma letra na mesma hora. É o motivo de a tabela ser
 *   dado, e não texto escrito dentro do SQL.
 *
 *   Sem isso, procurar `documentario` não acha `[A] FOR HIM - THUMB
 *   DOCUMENTÁRIO`, que é um título real desta base.
 */

/** O valor de `responsavel` que quer dizer "as que não têm ninguém". */
export const SEM_RESPONSAVEL = 'sem';

/**
 * Quem se procura.
 *
 * `null` é "qualquer um" — a ausência de filtro, e não uma escolha. É diferente
 * de `SEM_RESPONSAVEL`, que é uma escolha e das mais usadas: ela é o que
 * devolve as 1.015 tarefas órfãs da `ATENDIMENTO`.
 */
export type EscolhaDeResponsavel = string | null;

export type FiltroDeTarefas = {
  /** O que se procura no título. Vazio é não procurar nada. */
  texto: string;
  responsavel: EscolhaDeResponsavel;
};

export const SEM_FILTRO: FiltroDeTarefas = { texto: '', responsavel: null };

/**
 * O teto do texto procurado.
 *
 * Um título tem 255 caracteres; procurar por mais do que isso é procurar por
 * nada, e uma caixa sem teto é um jeito de mandar um quilobyte por tecla
 * digitada para o banco. O corte acontece na LEITURA, e não na digitação: a
 * caixa também tem `maxLength`, mas o endereço pode ser montado à mão.
 */
export const TETO_DA_BUSCA = 120;

/** As duas tabelas de `translate`. Ver o cabeçalho: elas vão como parâmetro. */
export const ACENTOS_DE = 'áàâãäéèêëíìîïóòôõöúùûüçñ';
export const ACENTOS_PARA = 'aaaaaeeeeiiiiooooouuuucn';

const DOBRA = new Map([...ACENTOS_DE].map((letra, i) => [letra, ACENTOS_PARA[i]]));

/**
 * Minúsculas e sem acento, pela MESMA tabela que a consulta usa.
 *
 * `normalize('NFC')` primeiro porque o teclado do macOS entrega `á` como `a` +
 * acento combinante, e nessa forma a letra não está na tabela — a busca
 * digitada num Mac não acharia o que a mesma busca digitada no Windows acha.
 */
export function semAcento(texto: string): string {
  let saida = '';
  for (const letra of texto.normalize('NFC').toLowerCase()) {
    saida += DOBRA.get(letra) ?? letra;
  }
  return saida;
}

/** Há alguma peneira ligada? */
export const temFiltro = (f: FiltroDeTarefas): boolean =>
  f.texto.trim() !== '' || f.responsavel !== null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O filtro que veio do endereço, ou de qualquer outro lugar de fora.
 *
 * TOLERANTE, pela mesma razão de `escolhaValida` (F17.24): o parâmetro vem da
 * barra de endereço, e ali qualquer coisa pode ser digitada. `?responsavel=eu`
 * não estoura e não devolve tela vazia — vira "qualquer um".
 */
export function lerFiltro(
  texto: string | null | undefined,
  responsavel: string | null | undefined,
): FiltroDeTarefas {
  const cru = (responsavel ?? '').trim().toLowerCase();
  return {
    texto: (texto ?? '').slice(0, TETO_DA_BUSCA),
    responsavel: cru === SEM_RESPONSAVEL ? SEM_RESPONSAVEL : UUID.test(cru) ? cru : null,
  };
}

/**
 * O filtro como a consulta o quer: três parâmetros, cada um podendo ser nulo.
 *
 * ⚠️ OS TRÊS SÃO SEPARADOS DE PROPÓSITO, e o do meio não carrega sentinela.
 * Mandar a string `'sem'` na mesma variável do identificador obrigaria a
 * consulta a escrever `${responsavel}::uuid` num ramo que às vezes recebe
 * `'sem'` — e o Postgres resolve o molde do parâmetro ANTES de decidir qual
 * ramo do `or` executar, então a consulta estouraria com "invalid input syntax
 * for type uuid" justamente na escolha mais usada da tela.
 */
export type FiltroParaConsulta = {
  /** Já em minúsculas e sem acento. Nulo quando não há busca. */
  texto: string | null;
  /** O identificador de quem se procura, ou nulo. Nunca a sentinela. */
  responsavel: string | null;
  semResponsavel: boolean;
};

export function paraConsulta(f: FiltroDeTarefas): FiltroParaConsulta {
  const texto = semAcento(f.texto.trim().slice(0, TETO_DA_BUSCA));
  return {
    texto: texto === '' ? null : texto,
    responsavel: f.responsavel === null || f.responsavel === SEM_RESPONSAVEL ? null : f.responsavel,
    semResponsavel: f.responsavel === SEM_RESPONSAVEL,
  };
}

/**
 * O filtro no endereço — F17.24.
 *
 * Só escreve o que está ligado: um endereço com `?busca=&responsavel=` seria
 * ruído colado em comentário, e a tela sem filtro deve ter o endereço limpa
 * que sempre teve.
 */
export function paraEndereco(f: FiltroDeTarefas): Record<string, string> {
  const saida: Record<string, string> = {};
  const texto = f.texto.trim();
  if (texto !== '') saida.busca = texto;
  if (f.responsavel !== null) saida.responsavel = f.responsavel;
  return saida;
}

/**
 * O nome de quem está no filtro, para a tela poder DIZER o que filtrou.
 *
 * A pessoa pode não estar mais na lista de opções — ela perdeu a última tarefa
 * dali enquanto a aba estava aberta, ou o endereço foi colado de outro quadro.
 * Nesse caso o nome é honesto sobre não saber, em vez de mostrar o
 * identificador cru, que não diz nada a ninguém.
 */
export function nomeDoResponsavel(
  f: FiltroDeTarefas,
  opcoes: readonly { id: string; name: string }[],
): string | null {
  if (f.responsavel === null) return null;
  // Com maiúscula porque este texto é o RÓTULO DO BOTÃO. Ele também aparece no
  // meio de frase, e ali a maiúscula depois de um `·` não incomoda; o contrário
  // — um botão começando em minúscula, no meio de uma barra de botões — sim.
  if (f.responsavel === SEM_RESPONSAVEL) return 'Sem responsável';
  return opcoes.find((o) => o.id === f.responsavel)?.name ?? 'alguém que não está nesta lista';
}
