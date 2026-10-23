/**
 * O painel do perfil do Instagram — etapas F9e/F9f/F9g.
 *
 * As três abas são as do app: Visão geral, Conteúdo, Público. Isso é cópia
 * deliberada, e não falta de imaginação — quem cuida da conta já lê aquele
 * painel todo dia, e trocar a arrumação obrigaria a reaprender onde as coisas
 * estão em troca de nada.
 *
 * O QUE NÃO DÁ PARA COPIAR, E A TELA DIZ ISSO
 *   "Horários de atividade dos seguidores" existe no app e NÃO existe na API.
 *   `online_followers` responde, mas com valor vazio — medido em dois perfis,
 *   em dias diferentes. A aba Público diz isso em uma linha, em vez de deixar
 *   um buraco onde a pessoa vai procurar.
 *
 * O QUE ESTA TELA SE RECUSA A SOMAR
 *   Alcance e contas engajadas contam PESSOAS DISTINTAS: somar dias infla. Onde
 *   caberia um total, aparece média por dia e melhor dia. Ver o cabeçalho de
 *   `meta/relatorio.ts`.
 */

import { dinheiro } from '@/meta/formato';
import { useMemo, useState } from 'react';

import {
  type Dimensao,
  type Faixa,
  ROTULO_DA_DIMENSAO,
  faixaDominante,
  ordenarFaixas,
  percentuais,
  rotularBucket,
} from '@/meta/demografia';
import {
  type Criterio,
  type Formato,
  type Publicacao,
  ROTULO_DO_FORMATO,
  filtrarPorFormato,
  formatoDa,
  ordenar,
  porFormato,
  resumoDaLegenda,
  taxaDeEngajamento,
} from '@/meta/publicacoes';
import { dataCurtaDoInstante } from '@/ui/grade-do-mes';
import { Contagem, Metrica, Pilula, Selo } from '@/ui/primitivos';

export type LinhaDeQuebra = {
  day: string;
  metric: string;
  dimension: string;
  bucket: string;
  value: number;
};

export type LinhaDeDemografia = {
  day: string;
  dimension: string;
  bucket: string;
  value: number;
};

const TRACO = '—';
const inteiro = (v: number | null) =>
  v === null ? TRACO : Math.round(v).toLocaleString('pt-BR');
const percentual = (v: number | null, casas = 1) =>
  v === null ? TRACO : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;

/**
 * A barra horizontal com rótulo e percentual — a forma do app.
 *
 * A largura sai da fração sobre o MAIOR da lista, não sobre o total: com 45
 * cidades, a maior tem 9% e todas as barras ficariam invisíveis se a escala
 * fosse o total. O número ao lado continua sendo o percentual de verdade.
 */
function BarraDeFaixa({
  rotulo,
  valor,
  fracaoDoTotal,
  fracaoDaMaior,
  cor = 'var(--luz)',
}: {
  rotulo: string;
  valor: number;
  fracaoDoTotal: number | null;
  fracaoDaMaior: number;
  cor?: string;
}) {
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.80rem] text-plat">{rotulo}</span>
        <span className="tnum shrink-0 text-[0.72rem] text-mute">
          {percentual(fracaoDoTotal)}
          <span className="ml-2 text-mute">{inteiro(valor)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--ink-2)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(1, fracaoDaMaior * 100)}%`, background: cor }}
        />
      </div>
    </div>
  );
}

function QuebraDemografica({
  dimensao,
  faixas,
  cor,
}: {
  dimensao: Dimensao;
  faixas: Faixa[];
  cor?: string;
}) {
  const { visiveis, outras } = ordenarFaixas(dimensao, faixas);
  const todas = outras === null ? visiveis : [...visiveis, outras];
  const pct = percentuais(faixas);
  const maior = Math.max(1, ...todas.map((f) => f.value));
  const dominante = faixaDominante(dimensao, faixas);

  return (
    <div className="o-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="eyebrow">{ROTULO_DA_DIMENSAO[dimensao]}</h3>
        {dominante && (
          <span className="text-[0.70rem] text-mute">
            maioria em {rotularBucket(dimensao, dominante.bucket)}
          </span>
        )}
      </div>

      <div className="mt-2">
        {todas.map((f) => (
          <BarraDeFaixa
            key={f.bucket}
            rotulo={rotularBucket(dimensao, f.bucket)}
            valor={f.value}
            // A linha "outras N" não está no mapa de percentuais: ela é soma.
            fracaoDoTotal={
              pct.get(f.bucket) ??
              (todas.reduce((s, x) => s + x.value, 0) === 0
                ? null
                : f.value / faixas.reduce((s, x) => s + x.value, 0))
            }
            fracaoDaMaior={f.value / maior}
            cor={cor}
          />
        ))}
        {todas.length === 0 && (
          <p className="py-2 text-[0.75rem] text-mute">Sem dado nesta quebra.</p>
        )}
      </div>
    </div>
  );
}

/* ─── aba Público ──────────────────────────────────────────────────────────── */

function AbaPublico({ demografia }: { demografia: LinhaDeDemografia[] }) {
  const [local, setLocal] = useState<'country' | 'city'>('country');

  const por = (d: string): Faixa[] =>
    demografia.filter((x) => x.dimension === d).map((x) => ({ bucket: x.bucket, value: x.value }));

  const dia = demografia[0]?.day ?? null;
  const idadePorGenero = por('age_gender');

  if (demografia.length === 0) {
    return (
      <div className="o-card mt-4 px-4 py-4">
        <p className="text-sm text-mute">
          Sem retrato do público para esta conta. A Meta exige um mínimo de seguidores para
          entregar demografia — abaixo dele, ela recusa em vez de devolver números, para proteger
          identidade em amostra pequena.
        </p>
      </div>
    );
  }

  return (
    <>
      {dia && (
        <p className="mt-3 text-[0.72rem] text-mute">
          Retrato de {dia.split('-').reverse().join('/')}. A Meta só responde “como está agora” —
          a série existe porque guardamos um retrato por coleta.
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <QuebraDemografica dimensao="gender" faixas={por('gender')} />
        <QuebraDemografica dimensao="age" faixas={por('age')} cor="var(--luz-ia)" />
      </div>

      {idadePorGenero.length > 0 && (
        <div className="mt-3">
          <QuebraDemografica
            dimensao="age_gender"
            faixas={idadePorGenero}
            cor="var(--luz-estudio)"
          />
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 flex items-center gap-1">
          <Pilula ativo={local === 'country'} aoClicar={() => setLocal('country')}>
            Países
          </Pilula>
          <Pilula ativo={local === 'city'} aoClicar={() => setLocal('city')}>
            Cidades
          </Pilula>
        </div>
        <QuebraDemografica dimensao={local} faixas={por(local)} cor="var(--luz-lives)" />
      </div>

      {/* A ausência dita em voz alta, em vez de um buraco onde a pessoa procura. */}
      <div className="o-card mt-3 px-4 py-3">
        <h3 className="eyebrow">Horários de atividade dos seguidores</h3>
        <p className="mt-1 text-[0.78rem] leading-snug text-mute">
          Isto existe no app do Instagram e <b className="text-mute">não existe na API</b>. A
          métrica <span className="o-mono">online_followers</span> responde, mas devolve valor
          vazio — conferido em dois perfis, em dias diferentes. Não é limitação da nossa coleta, e
          não há outro caminho que reconstrua o gráfico.
        </p>
      </div>
    </>
  );
}

/* ─── aba Conteúdo ─────────────────────────────────────────────────────────── */

const CRITERIOS: { chave: Criterio; rotulo: string }[] = [
  { chave: 'recentes', rotulo: 'Mais recentes' },
  { chave: 'alcance', rotulo: 'Alcance' },
  { chave: 'interacoes', rotulo: 'Interações' },
  { chave: 'engajamento', rotulo: 'Engajamento' },
];

function AbaConteudo({ publicacoes }: { publicacoes: Publicacao[] }) {
  const [formato, setFormato] = useState<Formato | null>(null);
  const [criterio, setCriterio] = useState<Criterio>('recentes');

  const resumo = useMemo(() => porFormato(publicacoes), [publicacoes]);
  const lista = useMemo(
    () => ordenar(filtrarPorFormato(publicacoes, formato), criterio),
    [publicacoes, formato, criterio],
  );

  if (publicacoes.length === 0) {
    return (
      <div className="o-card mt-4 px-4 py-4">
        <p className="text-sm text-mute">
          Nenhuma publicação guardada ainda para esta conta.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Qual formato rende mais — a pergunta que abre esta aba. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {resumo.map((r) => (
          <Metrica
            key={r.formato}
            rotulo={`${ROTULO_DO_FORMATO[r.formato]} · alcance mediano`}
            valor={inteiro(r.alcanceMediano)}
            detalhe={`${r.quantidade} publicação(ões) · melhor ${inteiro(r.melhorAlcance)} · engaj. ${percentual(r.engajamentoMediano)}`}
          />
        ))}
      </div>
      <p className="mt-1 text-[0.72rem] leading-snug text-mute">
        Mediana, e não média: um vídeo viral multiplica a média e faria os outros parecerem
        fracasso. A mediana é o que se pode esperar da próxima publicação.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <Pilula ativo={formato === null} aoClicar={() => setFormato(null)}>
          Tudo
          <Contagem>{publicacoes.length}</Contagem>
        </Pilula>
        {resumo.map((r) => (
          <Pilula
            key={r.formato}
            ativo={formato === r.formato}
            aoClicar={() => setFormato(r.formato)}
          >
            {ROTULO_DO_FORMATO[r.formato]}
            <Contagem>{r.quantidade}</Contagem>
          </Pilula>
        ))}

        <span className="ml-auto flex items-center gap-1">
          {CRITERIOS.map((c) => (
            <Pilula
              key={c.chave}
              ativo={criterio === c.chave}
              aoClicar={() => setCriterio(c.chave)}
            >
              {c.rotulo}
            </Pilula>
          ))}
        </span>
      </div>

      <div className="o-card mt-3 overflow-hidden">
        {lista.map((p) => (
          <LinhaDePublicacao key={p.id} p={p} />
        ))}
        {lista.length === 0 && (
          <p className="px-3 py-4 text-center text-mute">Nenhuma publicação nesse formato.</p>
        )}
      </div>
    </>
  );
}

function LinhaDePublicacao({ p }: { p: Publicacao }) {
  const [semImagem, setSemImagem] = useState(false);
  const formato = formatoDa(p);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
      style={{ borderBottom: '1px solid var(--hair)' }}
    >
      <div
        className="h-11 w-11 shrink-0 overflow-hidden rounded"
        style={{ background: 'var(--ink-2)', border: '1px solid var(--hair)' }}
      >
        {p.thumbnailUrl !== null && !semImagem && (
          <img
            src={p.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            // A miniatura vem do CDN da Meta e o endereço expira. Quando expira,
            // o quadro fica vazio em vez de mostrar ícone de imagem quebrada.
            onError={() => setSemImagem(true)}
          />
        )}
      </div>

      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom="neutro">{ROTULO_DO_FORMATO[formato]}</Selo>

          {/* IMPULSIONADA — F9n.
              Sem esta marca, um post pago aparece como um post orgânico que
              explodiu, e é justamente esse número que alguém olha para decidir
              "que tipo de conteúdo funciona". O selo não é enfeite: ele impede
              a comparação errada.

              O investimento vem junto porque "impulsionado com R$ 40" e
              "impulsionado com R$ 4.000" explicam coisas muito diferentes. */}
          {p.impulsionada && (
            <Selo tom="warn" titulo="Os números desta publicação incluem a entrega paga">
              impulsionada
              {typeof p.investido === 'number' && p.investido > 0 && (
                <span className="tnum ml-1 o-mono">{dinheiro(p.investido)}</span>
              )}
            </Selo>
          )}

          <span className="o-mono text-[0.70rem] text-mute">
            {p.postedAt === null ? '—' : dataCurtaDoInstante(p.postedAt)}
          </span>
        </div>
        <p className="mt-0.5 text-[0.78rem] leading-snug text-plat">
          {p.permalink === null ? (
            resumoDaLegenda(p.caption)
          ) : (
            <a href={p.permalink} target="_blank" rel="noreferrer" className="hover:underline">
              {resumoDaLegenda(p.caption)}
            </a>
          )}
        </p>
      </div>

      <div className="tnum flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.72rem] text-mute">
        <span title="Alcance — pessoas distintas">
          <span className="text-mute">alcance </span>
          {inteiro(p.reach)}
        </span>
        <span title="Visualizações">
          <span className="text-mute">views </span>
          {inteiro(p.views)}
        </span>
        <span title="Curtidas">♥ {inteiro(p.likes)}</span>
        <span title="Comentários">💬 {inteiro(p.comments)}</span>
        <span title="Salvos">🔖 {inteiro(p.saved)}</span>
        <span title="Interações sobre alcance">
          <span className="text-mute">engaj. </span>
          {percentual(taxaDeEngajamento(p))}
        </span>
      </div>
    </div>
  );
}

/* ─── as quebras da Visão geral ────────────────────────────────────────────── */

const ROTULO_DA_FAIXA: Record<string, string> = {
  FOLLOWER: 'Seguidores',
  NON_FOLLOWER: 'Não seguidores',
  UNKNOWN: 'Não identificados',
  POST: 'Posts',
  STORY: 'Stories',
  REEL: 'Reels',
  AD: 'Anúncios',
  CAROUSEL_CONTAINER: 'Carrosséis',
  DEFAULT_DO_NOT_USE: 'Sem classificação',
};

export function QuebraDoPeriodo({
  titulo,
  linhas,
  metric,
  dimension,
  cor,
}: {
  titulo: string;
  linhas: LinhaDeQuebra[];
  metric: string;
  dimension: string;
  cor?: string;
}) {
  // Soma os dias do período. Estas quebras são de EVENTOS (visualizações,
  // interações), que se somam — diferente de alcance, que conta pessoas.
  const somado = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const l of linhas) {
      if (l.metric !== metric || l.dimension !== dimension) continue;
      mapa.set(l.bucket, (mapa.get(l.bucket) ?? 0) + l.value);
    }
    return [...mapa.entries()]
      .map(([bucket, value]) => ({ bucket, value }))
      .sort((a, b) => b.value - a.value);
  }, [linhas, metric, dimension]);

  if (somado.length === 0) return null;

  const total = somado.reduce((s, f) => s + f.value, 0);
  const maior = Math.max(1, ...somado.map((f) => f.value));

  return (
    <div className="o-card px-4 py-3">
      <h3 className="eyebrow">{titulo}</h3>
      <div className="mt-2">
        {somado.map((f) => (
          <BarraDeFaixa
            key={f.bucket}
            rotulo={ROTULO_DA_FAIXA[f.bucket] ?? f.bucket}
            valor={f.value}
            fracaoDoTotal={total === 0 ? null : f.value / total}
            fracaoDaMaior={f.value / maior}
            cor={cor}
          />
        ))}
      </div>
    </div>
  );
}

export { AbaConteudo, AbaPublico };
