/**
 * Valores escritos NO TEXTO da consulta, em vez de parâmetro — perf do servidor, 08/10/2026.
 *
 * Mora aqui, e não em `db.ts`, por causa do pacote do navegador: alguns módulos
 * de `src/server` (a regra do cliente cancelado, a do tipo da tarefa) são
 * importados também pela tela, e `db.ts` puxa o driver do Postgres, que não vai
 * para o navegador. Este arquivo não importa o driver — só os TIPOS dele — e por
 * isso pode ser importado de qualquer lugar. `db.ts` reexporta tudo daqui.
 *
 * A REGRA DE TODOS OS AUXILIARES
 *   Só vira texto o que tem formato conhecido e SEM aspa possível; o resto volta
 *   como o próprio valor, que dentro de um template é parâmetro, como sempre foi.
 *   Dublê de teste (uma função sem `unsafe`) nunca recebe texto direto.
 */
import type { Sql, Tx } from '@/server/db';

/**
 * UUID no formato canônico, e nada além disso.
 *
 * É a trava de tudo que for embutido no texto SQL (ver `inlineUuid`): só
 * hexadecimal e hífen passam, então não há aspa, ponto e vírgula nem comentário
 * que consiga sair de dentro do literal.
 */
export const UUID_ESTRITO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O INTERRUPTOR — `IDEWORKS_SQL_TEXTO_DIRETO`, lido em `connect`.
 *
 * O ganho foi medido com o driver real contra um servidor de fio de teste, e
 * não contra o Hyperdrive. Se em produção algo estranhar, "desligado" (ou
 * "false") no wrangler.toml ou no painel da Cloudflare faz TUDO voltar ao
 * parâmetro de sempre — inclusive a declaração do ator em `withActor`, que
 * volta a esperar a resposta — sem mudar uma linha de código. Ausente = ligado.
 */
let textoDiretoLigado = true;

export function definirTextoDireto(valor: string | undefined): void {
  const v = (valor ?? '').trim().toLowerCase();
  textoDiretoLigado = !(v === 'desligado' || v === 'false');
}

/** Há como embutir um literal? Só no cliente real — o dublê de teste é uma função sem `unsafe` — e com o interruptor ligado. */
export function aceitaTextoDireto(conexao: Sql | Tx): boolean {
  return textoDiretoLigado && typeof (conexao as { unsafe?: unknown }).unsafe === 'function';
}

/**
 * O id escrito DENTRO do texto da consulta, em vez de viajar como parâmetro.
 *
 * POR QUE ISTO EXISTE — MEDIDO COM O DRIVER REAL, 08/10/2026
 *   Com `prepare: false` (o Hyperdrive agrupa em modo transação), o postgres.js
 *   só sabe os tipos de um parâmetro perguntando ao servidor: toda consulta com
 *   `${valor}` faz DUAS idas — `Parse+Describe`, espera, e só então `Bind+Execute`
 *   —, e, pior, trava o pipeline: as consultas seguintes da transação ficam em
 *   fila local e saem uma por vez, mesmo dentro de `Promise.all`. Sem parâmetro
 *   a consulta sai inteira numa ida só e as vizinhas viajam juntas na mesma
 *   escrita no soquete. Uma tela de oito consultas com id caía em 16 idas;
 *   com o id no texto, em 1 (ver `db-idas.test.ts`, que conta no fio).
 *
 * POR QUE É SEGURO
 *   Só um UUID no formato canônico vira literal; hex e hífen não conseguem
 *   fechar aspa. Qualquer outra coisa — inclusive uma tentativa de injeção —
 *   cai no parâmetro de sempre, que continua correto (só mais lento). O tipo
 *   do literal é o de um parâmetro sem tipo (`'…'` sem `::`): o servidor o
 *   resolve pelo contexto exatamente como resolveria o `$1`, então quem já
 *   escreve `${id}::uuid` continua escrevendo igual.
 *
 * ONDE USAR
 *   Em leitura que roda muito e junta várias consultas por id. Não é para
 *   espalhar: consulta de uma ida só (um parâmetro, sem vizinha) ganha uma ida,
 *   mas o ganho grande é quando o texto inteiro fica sem parâmetro.
 */
export function inlineUuid(conexao: Sql | Tx, valor: string) {
  if (aceitaTextoDireto(conexao) && UUID_ESTRITO.test(valor)) {
    return conexao.unsafe(`'${valor.toLowerCase()}'`);
  }
  // O próprio valor: dentro de um template ele vira parâmetro, como sempre foi.
  // (Não é `conexao\`${valor}\``: num dublê de teste isso EXECUTARIA a consulta.)
  return valor;
}

/**
 * Um instante escrito no texto da consulta — o par de `inlineUuid` para `Date`.
 *
 * `toISOString()` só produz dígitos, `-`, `:`, `.`, `T` e `Z`; não há como sair
 * dali uma aspa. Data inválida (sem ISO) e dublê de teste voltam como o próprio
 * valor, isto é, parâmetro, que é o que sempre foram.
 */
export function inlineTimestamp(conexao: Sql | Tx, valor: Date) {
  if (aceitaTextoDireto(conexao) && valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return conexao.unsafe(`'${valor.toISOString()}'`);
  }
  return valor;
}

/**
 * Um dia (`AAAA-MM-DD`) escrito no texto da consulta — para o mês de referência
 * e as janelas que o servidor mesmo calcula. Só dígitos e hífens, nesse formato;
 * qualquer outra coisa continua parâmetro. Não valida o calendário: dia
 * impossível (`2026-02-31`) chega ao Postgres como chegava, e ele recusa igual.
 */
export function inlineDate(conexao: Sql | Tx, valor: string) {
  if (aceitaTextoDireto(conexao) && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return conexao.unsafe(`'${valor}'`);
  }
  return valor;
}

/**
 * Uma lista de UUID no texto — `array['…','…']`. O chamador mantém o `::uuid[]`
 * que já escrevia (`= any(${inlineUuidList(tx, ids)}::uuid[])`), então o tipo é o
 * mesmo nos dois caminhos. Lista vazia, grande demais (acima de 500) ou com UM
 * valor fora do formato volta como o próprio array, isto é, parâmetro.
 *
 * O teto existe para o texto não crescer sem limite: 500 ids são ~19 KB, e a
 * ida deixaria de ser a de uma consulta pequena.
 */
export function inlineUuidList(conexao: Sql | Tx, valores: readonly string[]) {
  if (
    aceitaTextoDireto(conexao) &&
    valores.length > 0 &&
    valores.length <= 500 &&
    valores.every((v) => UUID_ESTRITO.test(v))
  ) {
    return conexao.unsafe(`array[${valores.map((v) => `'${v.toLowerCase()}'`).join(',')}]`);
  }
  return [...valores];
}

/** Uma lista de dias (`AAAA-MM-DD`) no texto — o par de `inlineUuidList` para `date[]`. */
export function inlineDateList(conexao: Sql | Tx, valores: readonly string[]) {
  if (
    aceitaTextoDireto(conexao) &&
    valores.length > 0 &&
    valores.length <= 500 &&
    valores.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
  ) {
    return conexao.unsafe(`array[${valores.map((v) => `'${v}'`).join(',')}]`);
  }
  return [...valores];
}

/**
 * Um texto CURTO e SEM aspas escrito no texto da consulta — para o que o código
 * mesmo escolhe (o fuso da agência, um rótulo de lista fechada). Só letras,
 * dígitos e `_ / + . : -`, até 64 caracteres; qualquer outra coisa vira
 * parâmetro. Não é para texto digitado por pessoa: nome, busca e título não
 * passam por aqui.
 */
export function inlineText(conexao: Sql | Tx, valor: string) {
  if (aceitaTextoDireto(conexao) && /^[A-Za-z0-9_/+.:-]{1,64}$/.test(valor)) {
    return conexao.unsafe(`'${valor}'`);
  }
  return valor;
}

/** Um inteiro seguro no texto; qualquer outra coisa volta como o próprio valor (parâmetro). */
export function inlineInt(conexao: Sql | Tx, valor: number) {
  if (aceitaTextoDireto(conexao) && Number.isSafeInteger(valor)) {
    return conexao.unsafe(String(valor));
  }
  return valor;
}

/**
 * Uma palavra de uma lista fechada escrita no texto — o par de `inlineUuid` para
 * valores que o CÓDIGO escolhe (`'grant'`, `'owner'`), nunca para o que vem de
 * fora. Fora da lista, vira parâmetro.
 */
export function inlineWord(conexao: Sql | Tx, valor: string, permitidas: readonly string[]) {
  if (aceitaTextoDireto(conexao) && permitidas.includes(valor) && /^[a-z_]{1,32}$/.test(valor)) {
    return conexao.unsafe(`'${valor}'`);
  }
  return valor;
}

/**
 * Um resumo SHA-256 em hexadecimal (64 caracteres) escrito no texto da consulta —
 * o verificador da credencial de automação. Só `[0-9a-f]{64}` passa.
 */
export function inlineSha256(conexao: Sql | Tx, valor: string) {
  if (aceitaTextoDireto(conexao) && /^[0-9a-f]{64}$/.test(valor)) {
    return conexao.unsafe(`'${valor}'`);
  }
  return valor;
}

/** Um booleano no texto (`true`/`false`); qualquer outra coisa volta como o próprio valor (parâmetro). */
export function inlineBool(conexao: Sql | Tx, valor: boolean) {
  if (aceitaTextoDireto(conexao) && typeof valor === 'boolean') {
    return conexao.unsafe(valor ? 'true' : 'false');
  }
  return valor;
}

/**
 * Uma tabela de letras do CÓDIGO (as de `translate` da busca sem acento) escrita
 * no texto da consulta. Só letras latinas, com ou sem acento (`a-z` e `à-ÿ`), até
 * 64 — aspa, barra invertida, espaço e controle não passam, então não há como
 * fechar o literal. Vale só para constante do próprio código, como
 * `ACENTOS_DE`/`ACENTOS_PARA`; texto digitado por pessoa nunca passa por aqui.
 * Fora do formato, vira parâmetro.
 */
export function inlineLetras(conexao: Sql | Tx, valor: string) {
  if (aceitaTextoDireto(conexao) && /^[a-zà-ÿ]{1,64}$/i.test(valor)) {
    return conexao.unsafe(`'${valor}'`);
  }
  return valor;
}
