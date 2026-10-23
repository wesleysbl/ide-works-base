/**
 * Conferência de schema — a resposta à dívida 8.3 do legado.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   O Sistema IDE tem 117 arquivos de migration e 103 registros aplicados, e a
 *   diferença é **inconciliável**: os nomes de arquivo não batem com as versões
 *   gravadas, então não há como saber o que rodou. Uma migration ficou pelo
 *   caminho e ninguém percebeu.
 *
 *   Comparar nome de arquivo com nome de registro é frágil. O que importa não é
 *   qual arquivo rodou — é **como o schema ficou**.
 *
 * O QUE ESTE SCRIPT FAZ
 *   Lê o estado real do schema `ideworks` — tabelas, colunas, tipos,
 *   obrigatoriedade, restrições, políticas, índices — e compara com o retrato
 *   versionado em `supabase/schema-esperado.json`.
 *
 *   Qualquer diferença é falha, nos dois sentidos: algo no banco que não está no
 *   retrato, ou algo no retrato que sumiu do banco.
 *
 * POR QUE A REGRA DE ACESSO PASSOU A ENTRAR — F17.2c
 *   Até a F17.2b o retrato guardava de política apenas `tabela|nome|comando`. A
 *   F17.2b **substituiu duas políticas inteiras** — `status_sets_write` e
 *   `statuses_write` deixaram de repetir a expressão e passaram a chamar
 *   `ideworks.can_write_owner` — e o `git diff --numstat` do retrato saiu
 *   **vazio**. Zero linhas. A rede não viu nada, porque os nomes não mudaram.
 *
 *   Pior: não havia consulta nenhuma a `pg_proc`. `ideworks.can_write_owner`,
 *   cujo corpo **é** a regra de acesso daquelas duas tabelas, podia ter o corpo
 *   trocado por `select true` — ou ser apagada — e este script seguia
 *   imprimindo `0 falha(s)`.
 *
 *   A cobertura inteira dessas regras morava no `provar-esteiras.mjs`, que
 *   exige banco vivo e credenciais e não roda no `npm test`. Rede de uma perna
 *   só, bem na véspera da F17.3, que reescreve a segurança por linha da tarefa.
 *
 *   Então o retrato passou a guardar também:
 *     • a EXPRESSÃO de cada política — `using`, `with check` e a quem ela se
 *       aplica;
 *     • as FUNÇÕES do schema — assinatura, retorno, `security definer`,
 *       volatilidade, dono, quem pode executar, `search_path` e o corpo;
 *     • os GATILHOS, com a definição inteira e se estão ligados;
 *     • as VIEWS, com as opções (é ali que mora o `security_invoker`) e a
 *       definição.
 *
 *   Cada um desses é superfície de acesso. Tirar o `security_invoker` de uma
 *   view a faz rodar com os poderes do dono, e a RLS de quem consulta deixa de
 *   valer; um `grant execute` a mais numa função `security definer` entrega o
 *   poder dela a mais gente; um gatilho desligado à mão desfaz a restrição que
 *   ele representava. Nada disso muda um nome, e por isso nada disso aparecia.
 *
 * ESPAÇO EM BRANCO É NORMALIZADO, E ISSO É DE PROPÓSITO
 *   Corpo de função guarda a indentação com que foi escrito. Reindentar uma
 *   função sem mudar uma vírgula do que ela faz não é mudança de regra de
 *   acesso — mas acusaria diferença, e retrato que grita à toa é retrato que
 *   todo mundo aprende a ignorar, o que é pior do que não ter retrato. Por
 *   isso toda sequência de espaço vira um espaço só antes de comparar.
 *
 *   O preço: uma mudança que mexa SÓ em espaço dentro de um literal de texto
 *   passa batido. Para função de permissão, que é o alvo desta rede, o risco é
 *   teórico, e vale o silêncio que compra.
 *
 *   Advertência irmã: `pg_get_expr`, `pg_get_viewdef` e `pg_get_triggerdef`
 *   reconstroem o texto a partir da árvore de análise, e uma versão nova do
 *   PostgreSQL pode reconstruir com outra pontuação. Se um dia o retrato
 *   acusar diferença em massa logo depois de uma subida de versão do banco, é
 *   isso — confira uma a uma e regrave.
 *
 * O QUE ELE AINDA NÃO ENXERGA
 *   `relforcerowsecurity` (o dono da tabela segue driblando a RLS sem ele) e as
 *   permissões de tabela e de schema. O papel do app é `ideworks_app`, que não
 *   é dono de nada, então o buraco é teórico hoje — mas está escrito aqui para
 *   não virar surpresa.
 *
 * USO
 *   node scripts/conferir-schema.mjs            confere
 *   node scripts/conferir-schema.mjs --gravar   regrava o retrato (uso deliberado)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RETRATO = join(RAIZ, 'supabase', 'schema-esperado.json');

const env = Object.fromEntries(
  readFileSync(join(RAIZ, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const ref = env.IDEWORKS_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0];
const sql = postgres({
  host: env.IDEWORKS_SERVER_DB_HOST || 'aws-0-sa-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  username: `${env.IDEWORKS_SERVER_DB_USER}.${ref}`,
  password: env.IDEWORKS_SERVER_DB_PASSWORD,
  ssl: 'require',
  prepare: false,
});

/**
 * Espaço em branco vira um espaço só, e o texto volta sem sobra nas pontas.
 *
 * É o que impede o retrato de acusar diferença fantasma quando alguém só
 * reindenta uma função. Ver o cabeçalho: silêncio comprado de propósito.
 */
const normalizar = (texto) => (texto ?? '').replace(/\s+/g, ' ').trim();

/** `provolatile` do `pg_proc` é uma letra só; aqui ela vira palavra legível. */
const VOLATILIDADE = { i: 'immutable', s: 'stable', v: 'volatile' };

async function retratarSchema(db) {
  const colunas = await db`
    select table_name, column_name, data_type, udt_name, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'ideworks'
     order by table_name, column_name`;

  const politicas = await db`
    select tablename, policyname, cmd
      from pg_policies where schemaname = 'ideworks'
     order by tablename, policyname`;

  // A expressão da política, em seção própria — e não acrescentada à seção
  // acima — para que a entrada desta rede no retrato fosse só inserção, sem
  // reescrever as 72 linhas que já estavam certas.
  const politicasExpressao = await db`
    select tablename, policyname, cmd,
           (select string_agg(r, ',' order by r) from unnest(roles::text[]) r) as papeis,
           coalesce(qual, '') as usando,
           coalesce(with_check, '') as conferindo
      from pg_policies where schemaname = 'ideworks'
     order by tablename, policyname`;

  // F44, Fase 5 — as RESTRITIVAS, à parte. `pg_policies.permissive` não entra
  // nas duas seções acima, e a F44_2 trouxe políticas cujo texto só é seguro
  // como restritiva (`… is not null or …`): recriada como permissiva, ela vira
  // um `or true` para toda a tela, e nem o nome nem a expressão mudariam. Seção
  // própria — e não uma coluna nova acima — para a entrada desta rede no
  // retrato ser só inserção. Banco sem restritiva = seção vazia, sem falha.
  const politicasRestritivas = await db`
    select tablename, policyname, cmd
      from pg_policies where schemaname = 'ideworks' and permissive = 'RESTRICTIVE'
     order by tablename, policyname`;

  // Não basta o nome: o corpo de `can_write_owner` É a regra de escrita de duas
  // tabelas. `prosecdef` e `proconfig` porque uma função `security definer` sem
  // `search_path` fixo é caminho de escalada; `proacl` porque um `grant execute`
  // a mais entrega o poder dela a mais gente.
  const funcoes = await db`
    select p.proname as nome,
           pg_get_function_identity_arguments(p.oid) as argumentos,
           pg_get_function_result(p.oid) as retorno,
           p.prosecdef as definer,
           p.provolatile as volatilidade,
           pg_get_userbyid(p.proowner) as dono,
           coalesce(
             (select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a),
             '(padrão)') as permissoes,
           coalesce(array_to_string(p.proconfig, ','), '') as config,
           p.prosrc as corpo
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'ideworks' and p.prokind in ('f', 'p')
     order by 1, 2`;

  // O gatilho de restrição já aparecia em `restricoes`, mas só pelo nome: trocar
  // o evento que dispara, ou desligar o gatilho, não mexe no nome.
  const gatilhos = await db`
    select rel.relname as tabela, t.tgname as gatilho, t.tgenabled as ligado,
           pg_get_triggerdef(t.oid) as definicao
      from pg_trigger t
      join pg_class rel on rel.oid = t.tgrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'ideworks' and not t.tgisinternal
     order by 1, 2`;

  // `reloptions` é onde mora o `security_invoker`. Sem ele a view roda com os
  // poderes do dono e a segurança por linha de quem consulta deixa de valer.
  const views = await db`
    select c.relname as nome, c.relkind as tipo,
           coalesce(
             (select string_agg(o, ',' order by o) from unnest(c.reloptions) o),
             '(sem opção)') as opcoes,
           pg_get_viewdef(c.oid) as definicao
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ideworks' and c.relkind in ('v', 'm')
     order by 1`;

  const indices = await db`
    select tablename, indexname
      from pg_indexes where schemaname = 'ideworks'
     order by tablename, indexname`;

  const restricoes = await db`
    select rel.relname as tabela, con.conname as restricao, con.contype as tipo
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'ideworks'
     order by 1, 2`;

  const tiposEnum = await db`
    select t.typname as tipo, string_agg(e.enumlabel, ',' order by e.enumsortorder) as valores
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'ideworks'
     group by 1 order by 1`;

  const rlsLigada = await db`
    select c.relname as tabela, c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ideworks' and c.relkind = 'r'
     order by 1`;

  return {
    colunas: colunas.map((c) =>
      [c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default ?? ''].join('|'),
    ),
    politicas: politicas.map((p) => [p.tablename, p.policyname, p.cmd].join('|')),
    politicas_restritivas: politicasRestritivas.map((p) => [p.tablename, p.policyname, p.cmd].join('|')),
    politicas_expressao: politicasExpressao.map((p) =>
      [
        p.tablename,
        p.policyname,
        p.cmd,
        p.papeis ?? '',
        normalizar(p.usando),
        normalizar(p.conferindo),
      ].join('|'),
    ),
    funcoes: funcoes.map((f) =>
      [
        `${f.nome}(${f.argumentos})`,
        f.retorno ?? '',
        f.definer ? 'definer' : 'invoker',
        VOLATILIDADE[f.volatilidade] ?? f.volatilidade,
        f.dono,
        f.permissoes,
        f.config,
        normalizar(f.corpo),
      ].join('|'),
    ),
    gatilhos: gatilhos.map((g) =>
      [g.tabela, g.gatilho, g.ligado, normalizar(g.definicao)].join('|'),
    ),
    views: views.map((v) => [v.nome, v.tipo, v.opcoes, normalizar(v.definicao)].join('|')),
    indices: indices.map((i) => [i.tablename, i.indexname].join('|')),
    restricoes: restricoes.map((r) => [r.tabela, r.restricao, r.tipo].join('|')),
    enums: tiposEnum.map((t) => [t.tipo, t.valores].join('|')),
    rls: rlsLigada.map((t) => [t.tabela, t.rls].join('|')),
  };
}

// `pg_get_viewdef`, `pg_get_triggerdef` e `pg_get_expr` reconstroem o texto
// qualificando nome conforme o `search_path` de QUEM CONSULTA: o mesmo banco
// devolve `lists` para um usuário e `ideworks.lists` para outro. Sem fixar isso,
// o retrato mudaria de cara conforme a credencial de quem regravou — diferença
// fantasma garantida, do tipo que ninguém consegue explicar.
//
// Isso já valia antes desta etapa, sem ninguém ter notado: `column_default`, no
// `information_schema`, também é texto reconstruído — `'paz'::urgency_level` de
// um lado, `'paz'::ideworks.urgency_level` do outro. O valor fixado aqui é o
// mesmo que o papel do app já usava (medido: `ideworks`), então o retrato não
// se mexe; o que muda é que agora ele não depende mais de quem rodou.
//
// `set local` dentro de transação porque o pooler é de transação: solto, o `set`
// não sobrevive à consulta seguinte.
const atual = await sql.begin(async (tx) => {
  await tx`set local search_path = ideworks`;
  return retratarSchema(tx);
});
await sql.end({ timeout: 5 });

if (process.argv.includes('--gravar')) {
  writeFileSync(RETRATO, `${JSON.stringify(atual, null, 2)}\n`);
  console.log(`retrato gravado: ${RETRATO}`);
  console.log('Confira o diff antes de commitar — este comando aceita qualquer estado.');
  process.exit(0);
}

let esperado;
try {
  esperado = JSON.parse(readFileSync(RETRATO, 'utf8'));
} catch {
  console.error(`Retrato não encontrado. Gere com: node scripts/conferir-schema.mjs --gravar`);
  process.exit(2);
}

let falhas = 0;
for (const secao of Object.keys(atual)) {
  const noBanco = new Set(atual[secao]);
  const noRetrato = new Set(esperado[secao] ?? []);

  const sobrando = [...noBanco].filter((x) => !noRetrato.has(x));
  const faltando = [...noRetrato].filter((x) => !noBanco.has(x));

  if (sobrando.length === 0 && faltando.length === 0) {
    console.log(`  OK    ${secao} — ${noBanco.size} item(ns)`);
    continue;
  }

  falhas += 1;
  console.log(`  FALHA ${secao}`);
  for (const x of sobrando) console.log(`          no banco, fora do retrato:  ${x}`);
  for (const x of faltando) console.log(`          no retrato, fora do banco:  ${x}`);
}

// Toda tabela precisa de segurança por linha. Regra 5 do roteiro, sem exceção.
const semRls = atual.rls.filter((l) => !l.endsWith('|true'));
if (semRls.length > 0) {
  falhas += 1;
  console.log('  FALHA tabela sem segurança por linha:');
  for (const t of semRls) console.log(`          ${t.split('|')[0]}`);
} else {
  console.log(`  OK    toda tabela tem segurança por linha — ${atual.rls.length} tabela(s)`);
}

console.log(`\n===== RESULTADO: ${falhas} falha(s) =====\n`);
process.exit(falhas === 0 ? 0 : 1);
