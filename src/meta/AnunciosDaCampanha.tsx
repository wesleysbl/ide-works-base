/**
 * Os anúncios de uma campanha — etapa F10i.
 *
 * POR QUE ISTO FALTAVA
 *   A tela de campanhas mostrava quanto cada uma gastou e quantos criativos
 *   tinha — e o número de criativos não levava a lugar nenhum. Mas a decisão
 *   que a equipe toma não é sobre a campanha: é sobre QUAL CRIATIVO funcionou,
 *   para repetir o que deu certo.
 *
 * O ANÚNCIO DESLIGADO É O MAIS IMPORTANTE DA LISTA
 *   Filtrar por ativo devolveria só o que está rodando agora — que é
 *   exatamente o que a pessoa já sabe. O criativo que rendeu e foi pausado é a
 *   resposta que ela veio buscar.
 *
 * E POR ISSO A LISTA DIZ QUANDO ELE RODOU
 *   Um anúncio desligado há duas semanas mostra número baixo numa janela de 28
 *   dias, e o número baixo é lido como fracasso. Dizendo "rodou de 12/07 a
 *   28/07, 16 dias", o MESMO número passa a ser o resultado do tempo em que ele
 *   existiu — e o custo por resultado, que é o que se compara, não muda.
 *
 * O RESULTADO É O DA FAMÍLIA DA CAMPANHA
 *   Um anúncio de campanha de mensagem tem "conversas" como resultado; um de
 *   vendas tem "compras". A mesma regra da tabela de cima, aplicada linha a
 *   linha — comparar conversa com compra é o erro que a área inteira existe
 *   para não cometer.
 */

import { useEffect, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { dinheiro } from '@/meta/formato';
import { type Metrica, catalogoDe, valorDaMetrica } from '@/meta/metricas';
import { type Familia, RESULTADO_DA_FAMILIA, resultadoDe } from '@/meta/objetivos';
import { useMetricas } from '@/meta/metricas-escolhidas';
import { SeletorDeMetricas } from '@/meta/SeletorDeMetricas';
import { Aviso, Selo } from '@/ui/primitivos';

export type AnuncioDaCampanha = {
  adId: string;
  nome: string | null;
  conjunto: string | null;
  miniatura: string | null;
  situacao: string | null;
  instagramPermalink: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  primeiroDia: string | null;
  ultimoDia: string | null;
  dias: number;
  acoes: { action_type: string; value: number }[];
};

const TRACO = '—';
const inteiro = (v: number | null) => (v === null ? TRACO : Math.round(v).toLocaleString('pt-BR'));
const percentual = (v: number | null) =>
  v === null ? TRACO : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const dividir = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : a / b;

const dia = (iso: string | null) => (iso === null ? null : iso.slice(5).split('-').reverse().join('/'));

/** "12/07 → 28/07 · 16 dias", ou o que der para dizer. */
function periodo(a: AnuncioDaCampanha): string {
  if (a.primeiroDia === null) return 'sem entrega no período';
  if (a.primeiroDia === a.ultimoDia) return `${dia(a.primeiroDia)} · 1 dia`;
  return `${dia(a.primeiroDia)} → ${dia(a.ultimoDia)} · ${a.dias} dias`;
}

/**
 * A segunda linha da primeira coluna: quando o anúncio rodou e em que conjunto.
 *
 * Vira UMA string porque ela é escrita duas vezes — na célula e no `title` que
 * devolve o que as reticências cortaram. Duas montagens divergiriam.
 */
const legenda = (a: AnuncioDaCampanha): string =>
  a.conjunto === null ? periodo(a) : `${periodo(a)} · ${a.conjunto}`;

export function AnunciosDaCampanha({
  assetId,
  campaignId,
  familia,
  de,
  ate,
  catalogoDaConta,
}: {
  assetId: string;
  campaignId: string;
  familia: Familia;
  de: string;
  ate: string;
  /**
   * O catalogo da CONTA INTEIRA, e nao o desta campanha — F10j.
   *
   * Montado so com os anuncios desta campanha, ele encolhia para meia duzia
   * de metricas: uma campanha sozinha mede muito menos que a conta. E como a
   * escolha de colunas e compartilhada entre as campanhas, a coluna escolhida
   * SUMIA ao abrir a campanha seguinte — a tabela mudava de forma sem ninguem
   * ter mexido nela.
   *
   * A regra de "so oferecer o que tem dado" continua valendo, so que no
   * escopo certo: o que a CONTA mediu. Uma coluna que esta campanha nao gerou
   * mostra zero, e zero aqui e verdade — foi a pessoa que escolheu ve-la.
   */
  catalogoDaConta: Metrica[];
}) {
  const { escolhidas, alternar, limpar } = useMetricas('anuncios');
  const [anuncios, setAnuncios] = useState<AnuncioDaCampanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    setAnuncios(null);
    void (async () => {
      try {
        const r = await api.anunciosDaCampanha(assetId, campaignId, de, ate);
        if (vivo) setAnuncios(r.anuncios as AnuncioDaCampanha[]);
      } catch (e) {
        if (vivo) setErro(e instanceof ApiError ? e.message : 'Não foi possível abrir os anúncios.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [assetId, campaignId, de, ate]);

  const def = RESULTADO_DA_FAMILIA[familia];
  const desligados = (anuncios ?? []).filter(
    (a) => a.situacao !== null && a.situacao !== 'ACTIVE',
  ).length;
  // O catalogo sai DAS LINHAS que estao na tela — ver `meta/metricas.ts`.
  // Une o da conta com o que estes anuncios trazem: a uniao cobre o caso de
  // uma acao existir no anuncio e nao aparecer no agregado da campanha.
  const doAnuncio = catalogoDe(anuncios ?? []);
  const catalogo = [
    ...catalogoDaConta,
    ...doAnuncio.filter((m) => !catalogoDaConta.some((x) => x.chave === m.chave)),
  ];
  const colunas = catalogo.filter((m) => escolhidas.includes(m.chave));

  const mostrar = (m: { formato: string }, v: number | null) =>
    m.formato === 'dinheiro' ? dinheiro(v) : m.formato === 'percentual' ? percentual(v) : inteiro(v);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (anuncios === null) return <p className="px-3 py-2 text-[0.75rem] text-mute">Abrindo…</p>;
  if (anuncios.length === 0) {
    return (
      <p className="px-3 py-2 text-[0.75rem] text-mute">
        Esta campanha não tem anúncio coletado. Pode ser que ela seja mais antiga que a janela de
        28 dias que a coleta mantém.
      </p>
    );
  }

  return (
    <>
      {/* O seletor fica AQUI, colado na tabela que ele muda. Num canto da
          pagina, ninguem ligaria uma coisa a outra.

          E fica FORA do quadro que rola — F19h. O balão dele é posicionado
          por cima do conteúdo, e caixa com `overflow` corta o que sai dela:
          dentro, o menu que escolhe as colunas apareceria cortado pela
          própria tabela que ele configura. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="eyebrow">
          Anúncios desta campanha
          <span className="tnum ml-2 normal-case">{anuncios.length}</span>
          {desligados > 0 && (
            <span className="ml-2 normal-case text-mute">· {desligados} desligado(s)</span>
          )}
        </span>
        <SeletorDeMetricas
          catalogo={catalogo}
          escolhidas={escolhidas}
          aoAlternar={alternar}
          aoLimpar={limpar}
        />
      </div>

    {/* Rola nos dois eixos, com o cabeçalho grudado — F19h. 141 anúncios
        empurrando a página inteira para baixo é o mesmo defeito de outro
        jeito: perde-se a campanha de vista para poder ver o criativo dela. */}
    <div className="o-tab-caixa">
    <table
      // O PISO É O MAIOR DOS DOIS — F17.47. `min-w-[46rem]` sozinho vencia o
      // `min-width: 100%` do `.o-tab-rola` (mesma força, e a folha do Tailwind
      // vem depois), e a tabela parava a 862px dentro de um quadro de 1336:
      // sobrava faixa vazia à direita, e o quadro deixava de ser o piso que o
      // comentário do CSS diz que ele é. Em tela estreita continua valendo o
      // piso em `rem`, que é o que impede a coluna espremida no telefone.
      className="o-tab-fixa o-tab-rola min-w-[max(46rem,100%)] text-[0.82rem]"
      // A tabela de dentro vive numa superficie mais escura que a de fora.
      style={{ ['--fundo-fixo' as string]: 'var(--ink-0)' } as React.CSSProperties}
    >
      <thead>
        <tr className="eyebrow" style={{ borderBottom: '1px solid var(--hair)' }}>
          <th className="px-3 py-1.5 text-left font-normal">Anúncio</th>
          {/* O RESULTADO DA FAMILIA E FIXO, e nao escolhivel: e a pergunta que
              a propria campanha foi buscar. Deixar removivel permitiria montar
              uma tabela de campanha de mensagem sem a coluna de conversas. */}
          <th className="px-3 py-1.5 text-right font-normal">{def.rotulo}</th>
          <th className="px-3 py-1.5 text-right font-normal">Custo/{def.unidade}</th>
          {colunas.map((m) => (
            <th key={m.chave} className="px-3 py-1.5 text-right font-normal" title={m.origem}>
              {m.rotulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {anuncios.map((a) => {
          const r = resultadoDe(familia, a.acoes, {
            reach: a.alcanceAprox,
            impressions: a.impressions,
            clicks: a.clicks,
            linkClicks: a.linkClicks,
          });
          const custo = r.valor === null || r.valor === 0 ? null : dividir(a.spend, r.valor);
          const desligado = a.situacao !== null && a.situacao !== 'ACTIVE';

          return (
            <tr key={a.adId} style={{ borderBottom: '1px solid var(--hair)' }}>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  {a.miniatura !== null && (
                    <img
                      src={a.miniatura}
                      alt=""
                      loading="lazy"
                      className="h-8 w-8 shrink-0 rounded object-cover"
                      style={{ border: '1px solid var(--hair)' }}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-plat">{a.nome ?? a.adId}</span>
                      {/* O DESLIGADO NÃO É UM AVISO, É CONTEXTO.
                          Ele explica por que o número é menor sem sugerir que
                          algo está errado — o criativo fez o que fez enquanto
                          existiu. */}
                      {desligado && <Selo tom="neutro">desligado</Selo>}
                      {a.instagramPermalink !== null && (
                        <a
                          href={a.instagramPermalink}
                          target="_blank"
                          rel="noreferrer"
                          className="o-mono text-[0.66rem] underline"
                          style={{ color: 'var(--luz-agencia)' }}
                        >
                          post
                        </a>
                      )}
                    </span>
                    {/* A LEGENDA CORTA — F17.47. "11/08 → 31/08 · 18 dias ·
                        PPT - Itaverde | Ibitinga | Vale Azul | Bela Vista |
                        Serra Alta — CRM" tem 93 caracteres e atravessava as colunas
                        de número. O texto inteiro continua alcançável no
                        `title`. */}
                    <span
                      className="o-tab-legenda o-mono text-[0.70rem] text-mute"
                      title={legenda(a)}
                    >
                      {legenda(a)}
                    </span>
                  </span>
                </span>
              </td>
              <td className="tnum px-3 py-2 text-right" style={{ color: 'var(--luz-texto)' }}>
                {inteiro(r.valor)}
              </td>
              <td className="tnum px-3 py-2 text-right">{dinheiro(custo)}</td>
              {colunas.map((m) => (
                <td key={m.chave} className="tnum px-3 py-2 text-right">
                  {mostrar(m, valorDaMetrica(m.chave, a))}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
    </>
  );
}
