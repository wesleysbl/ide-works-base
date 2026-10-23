/**
 * Diagnóstico do token da Meta.
 *
 * Responde três perguntas, nesta ordem — e a terceira é a que decide se a
 * Análise do App é inevitável:
 *
 *   1. O token está vivo? (quem é ele, e quando vence)
 *   2. O que ele LISTA? (contas de anúncio, páginas, Instagram)
 *   3. O que ele consegue LER? — listar uma conta e conseguir métrica dela são
 *      coisas diferentes. É aqui que a diferença entre acesso padrão e avançado
 *      aparece.
 *
 * O TOKEN NUNCA É IMPRESSO
 *   Ele é lido de `.dev.vars` e usado; nada dele sai na saída, nem em pedaço.
 *   Se algum dia isto precisar rodar em produção, o token vem do mesmo lugar
 *   que o Worker usa, e continua sem aparecer.
 *
 * QUAL TOKEN, DAS DUAS EMPRESAS
 *   Cada empresa tem o seu app na Meta, e portanto o seu System User e o
 *   seu token. Um segundo script seria a mesma coisa duas vezes, e as duas
 *   cópias divergiriam no primeiro conserto — o nome da variável vira
 *   argumento.
 *
 * USO
 *   node scripts/conferir-token-meta.mjs                            # Ide
 *   node scripts/conferir-token-meta.mjs IDEWORKS_META_TOKEN_ALMA9  # Alma Nove
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = 'https://graph.facebook.com/v21.0';

const VARIAVEL = process.argv[2] ?? 'IDEWORKS_META_TOKEN';

// O sinal de igual no fim do prefixo nao e enfeite: sem ele o nome curto
// casaria com a linha do IDEWORKS_META_TOKEN_ALMA9, e o diagnostico
// conferiria um token jurando que era o outro.
const linha = readFileSync(join(RAIZ, '.dev.vars'), 'utf8')
  .split('\n')
  .find((l) => l.startsWith(VARIAVEL + '='));

const TOKEN = (linha ?? '').slice(VARIAVEL.length + 1).trim();
if (TOKEN === '') {
  console.error('Sem ' + VARIAVEL + ' em .dev.vars.');
  process.exit(1);
}

const auth = `access_token=${encodeURIComponent(TOKEN)}`;

const ok = (t, d) => console.log(`  ✓ ${t}${d ? ` — ${d}` : ''}`);
const falha = (t, d) => console.log(`  ✗ ${t} — ${d}`);

async function pedir(caminho) {
  const r = await fetch(`${GRAPH}/${caminho}${caminho.includes('?') ? '&' : '?'}${auth}`);
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok || corpo.error) {
    const e = new Error(corpo.error?.message ?? `HTTP ${r.status}`);
    e.code = corpo.error?.code;
    throw e;
  }
  return corpo;
}

console.log('\n=== Diagnóstico do token da Meta ===\n');

/* --- 1. o token está vivo? ------------------------------------------------- */
console.log('— quem é este token —');
try {
  const eu = await pedir('me?fields=id,name');
  ok('o token responde', `${eu.name ?? '(sem nome)'} · id ${eu.id}`);
} catch (e) {
  falha('o token não responde', e.message);
  process.exit(1);
}

/* --- 2. o que ele lista? --------------------------------------------------- */
console.log('\n— o que ele LISTA —');

let contaDeAnuncio = null;
let contaDeInstagram = null;

try {
  const r = await pedir('me/adaccounts?fields=id,name&limit=200');
  const contas = r.data ?? [];
  contaDeAnuncio = contas[0] ?? null;
  ok('contas de anúncio', `${contas.length}`);
} catch (e) {
  falha('contas de anúncio', `${e.message} (código ${e.code ?? '?'})`);
}

try {
  const r = await pedir(
    'me/accounts?fields=id,name,instagram_business_account{id,username}&limit=200',
  );
  const paginas = r.data ?? [];
  const comIg = paginas.filter((p) => p.instagram_business_account?.id);
  contaDeInstagram = comIg[0]?.instagram_business_account ?? null;
  ok('páginas', `${paginas.length}`);
  ok('destas, com Instagram vinculado', `${comIg.length}`);
} catch (e) {
  falha('páginas e Instagram', `${e.message} (código ${e.code ?? '?'})`);
}

/* --- 3. o que ele consegue LER? -------------------------------------------- */
// A pergunta que decide se a Análise do App é inevitável. Listar uma conta usa
// uma permissão; ler a MÉTRICA dela usa outra, e é onde acesso padrão x
// avançado se separa.
console.log('\n— o que ele consegue LER (o teste que decide a Análise) —');

const ontem = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const semanaPassada = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

if (contaDeInstagram) {
  try {
    // SO `reach`, e nao por economia: ela e a UNICA metrica do Instagram que
    // aceita `period=day`. Todas as outras exigem `metric_type=total_value`, e
    // pedi-las aqui devolve erro 100 — um ✗ que parece token quebrado quando o
    // token esta perfeito. O motor sabe disso; este diagnostico precisava saber
    // tambem.
    const r = await pedir(
      `${contaDeInstagram.id}/insights?metric=reach&period=day` +
        `&since=${semanaPassada}&until=${ontem}`,
    );
    const metricas = (r.data ?? []).map((m) => m.name).join(', ');
    const pontos = (r.data ?? []).reduce((n, m) => n + (m.values?.length ?? 0), 0);
    ok(
      `MÉTRICA DO INSTAGRAM de @${contaDeInstagram.username ?? contaDeInstagram.id}`,
      `${metricas || '(vazio)'} · ${pontos} ponto(s) de série`,
    );
  } catch (e) {
    falha(
      `métrica do Instagram de @${contaDeInstagram.username ?? contaDeInstagram.id}`,
      `${e.message} (código ${e.code ?? '?'})`,
    );
  }
} else {
  console.log('  – sem conta de Instagram para testar');
}

if (contaDeAnuncio) {
  try {
    const r = await pedir(
      `${contaDeAnuncio.id}/insights?level=campaign&fields=campaign_id,campaign_name,spend,reach` +
        `&time_increment=1&time_range=${encodeURIComponent(
          JSON.stringify({ since: semanaPassada, until: ontem }),
        )}&limit=5`,
    );
    const linhas = r.data ?? [];
    ok(
      `MÉTRICA DE ANÚNCIO de "${contaDeAnuncio.name}"`,
      linhas.length === 0
        ? 'a chamada passou, mas não houve veiculação no período'
        : `${linhas.length} linha(s) · ex.: ${linhas[0].campaign_name ?? '(sem nome)'}`,
    );
  } catch (e) {
    falha(
      `métrica de anúncio de "${contaDeAnuncio.name}"`,
      `${e.message} (código ${e.code ?? '?'})`,
    );
  }
} else {
  console.log('  – sem conta de anúncio para testar');
}

console.log('');
