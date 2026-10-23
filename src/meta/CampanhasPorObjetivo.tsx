/**
 * As campanhas agrupadas pelo que elas foram buscar — etapa F10g.
 *
 * O QUE ISTO SUBSTITUI
 *   Uma tabela com colunas fixas, e uma delas chamada "Resultados". Ali, 11
 *   compras e 11 conversas iniciadas apareciam idênticas — e uma campanha de
 *   alcance mostrava travessão, como se tivesse fracassado.
 *
 *   Uma coluna que significa coisas diferentes em cada linha não é uma coluna:
 *   é um convite ao erro de leitura.
 *
 * POR QUE AGRUPAR, E NÃO SÓ ACRESCENTAR UMA COLUNA
 *   Porque a comparação entre linhas só faz sentido dentro do grupo. Ordenar
 *   por "resultado" uma lista que mistura conversas, compras e curtidas
 *   ordenaria por unidades diferentes — o número maior venceria sempre, e o
 *   maior costuma ser o do objetivo mais barato de entregar.
 *
 *   Dentro de cada grupo, a ordem é o gasto: a pergunta que abre a tela é para
 *   onde foi o dinheiro.
 *
 * CUSTO POR RESULTADO É A COLUNA QUE FALTAVA
 *   "42 conversas" não diz se foi caro. E o nome da unidade muda com o
 *   objetivo — "custo por conversa", "custo por lead" —, porque "custo por
 *   resultado" obriga a lembrar de qual resultado se falava.
 */

import { AnunciosDaCampanha } from '@/meta/AnunciosDaCampanha';
import { dinheiro } from '@/meta/formato';
import { catalogoDe, valorDaMetrica } from '@/meta/metricas';
import { useMetricas } from '@/meta/metricas-escolhidas';
import { SeletorDeMetricas } from '@/meta/SeletorDeMetricas';
import { Fragment, useMemo, useState } from 'react';

import {
  type Familia,
  RESULTADO_DA_FAMILIA,
  ROTULO_DA_FAMILIA,
  familiaDoObjetivo,
  resultadoDe,
} from '@/meta/objetivos';
import { somar } from '@/meta/relatorio';
import { Selo } from '@/ui/primitivos';

export type CampanhaComObjetivo = {
  campaignId: string;
  nome: string | null;
  objetivo: string | null;
  situacao: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  linkClicks: number | null;
  alcanceAprox: number | null;
  criativos: number;
  dias: number;
  acoes: { action_type: string; value: number }[];
};

const TRACO = '—';
const inteiro = (v: number | null) =>
  v === null ? TRACO : Math.round(v).toLocaleString('pt-BR');
const percentual = (v: number | null) =>
  v === null ? TRACO : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

const dividir = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : a / b;

export function CampanhasPorObjetivo({
  campanhas,
  assetId,
  de,
  ate,
}: {
  campanhas: CampanhaComObjetivo[];
  /** Para abrir os anuncios da campanha — F10i. */
  assetId: string;
  de: string;
  ate: string;
}) {
  /**
   * Qual campanha esta aberta. UMA de cada vez, de proposito: abrir varias
   * empilharia tabelas dentro de tabelas e a pessoa perderia de vista qual
   * anuncio pertence a qual campanha.
   */
  const [aberta, setAberta] = useState<string | null>(null);
  const { escolhidas, alternar, limpar } = useMetricas('campanhas');

  // O catalogo sai DAS CAMPANHAS que estao na tela — ver `meta/metricas.ts`.
  const catalogo = catalogoDe(campanhas);
  const colunas = catalogo.filter((m) => escolhidas.includes(m.chave));
  const mostrar = (m: { formato: string }, v: number | null) =>
    m.formato === 'dinheiro' ? dinheiro(v) : m.formato === 'percentual' ? percentual(v) : inteiro(v);

  const grupos = useMemo(() => {
    const mapa = new Map<Familia, CampanhaComObjetivo[]>();
    for (const c of campanhas) {
      const f = familiaDoObjetivo(c.objetivo);
      mapa.set(f, [...(mapa.get(f) ?? []), c]);
    }
    // O grupo que mais consumiu vem primeiro: a pergunta que abre a tela é
    // para onde foi o dinheiro.
    return [...mapa.entries()]
      .map(([familia, lista]) => ({
        familia,
        lista: [...lista].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1)),
        // `somar`, e não `reduce` com `?? 0` — F14: o grupo que só tem gasto
        // desconhecido fica `null` (travessão); o que gastou zero de verdade
        // mostra R$ 0,00. Antes `gasto || null` apagava o zero medido.
        gasto: somar(lista.map((c) => c.spend)),
      }))
      .sort((a, b) => (b.gasto ?? 0) - (a.gasto ?? 0));
  }, [campanhas]);

  if (campanhas.length === 0) {
    return (
      <p className="o-card px-4 py-4 text-sm text-mute">
        Nenhuma campanha com veiculação neste período.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {/* UM seletor para a tela toda, e nao um por grupo de objetivo: as
          colunas sao as mesmas em todos, e um seletor por grupo faria a
          pessoa escolher a mesma coisa quatro vezes. */}
      <div className="o-card flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-[0.72rem] text-mute">
          <b className="text-plat">{campanhas.length}</b> {campanhas.length === 1 ? 'campanha' : 'campanhas'} ·{' '}
          <b className="text-plat">{colunas.length}</b> de {catalogo.length} métricas na tabela
        </span>
        <SeletorDeMetricas
          catalogo={catalogo}
          escolhidas={escolhidas}
          aoAlternar={alternar}
          aoLimpar={limpar}
        />
      </div>
      {grupos.map(({ familia, lista, gasto }) => {
        const def = RESULTADO_DA_FAMILIA[familia];

        // `min-w-0` na seção NÃO É ENFEITE — F17.47. Filho de grade nasce com
        // `min-width: auto`, e isso quer dizer "nunca menor que o conteúdo".
        // Com o seletor cheio, a tabela pedia 1908px, a seção crescia junto, o
        // cartão `overflow-x-auto` crescia com ela e nunca rolava: quem rolava
        // era a PÁGINA, 512px para o lado. E coluna presa dentro de um quadro
        // que não rola não fica presa em lugar nenhum.
        return (
          <section key={familia} className="min-w-0">
            <h3 className="eyebrow mb-2 flex flex-wrap items-baseline gap-2">
              {ROTULO_DA_FAMILIA[familia]}
              <span className="tnum">{lista.length}</span>
              <span className="text-[0.66rem] normal-case text-mute">
                mede <span className="text-mute">{def.rotulo.toLowerCase()}</span> ·{' '}
                {dinheiro(gasto)}
              </span>
            </h3>

            {/* O cartão é o PISO da largura da tabela, não o teto — F19h.
                Quem escolhe mais métricas quer mais tabela, não colunas mais
                finas. Sem teto de ALTURA aqui: a campanha é a lista curta, e
                um teto no cartão cortaria o balão do seletor de métricas. */}
            {/* A CAIXA É UMA REGIÃO COM NOME E FOCO — F14. Ela rola de lado
                (a tabela passa da largura no celular), e rolagem que o teclado
                não alcança é tabela cortada para quem não usa mouse. */}
            <div
              className="o-card o-tab-quadro overflow-x-auto"
              role="region"
              aria-label={`Campanhas de ${ROTULO_DA_FAMILIA[familia]}: ${def.rotulo.toLowerCase()}`}
              tabIndex={0}
            >
              {/* O piso é o maior dos dois — F17.47, ver `AnunciosDaCampanha`. */}
              <table className="o-tab-fixa o-tab-rola min-w-[max(48rem,100%)] text-sm">
                <caption className="sr-only">
                  Campanhas de {ROTULO_DA_FAMILIA[familia]}, do maior gasto para o menor. {def.rotulo} é o
                  resultado desta família; travessão é sem dado para calcular, e não zero.
                </caption>
                <thead>
                  <tr className="eyebrow" style={{ borderBottom: '1px solid var(--hair)' }}>
                    <th className="px-3 py-2 text-left font-normal">Campanha</th>
                    {/* O CABEÇALHO É O NOME DO RESULTADO DESTA FAMÍLIA, e não
                        "Resultados". É o que impede a leitura de comparar
                        conversas com compras. */}
                    <th className="px-3 py-2 text-right font-normal">{def.rotulo}</th>
                    <th className="px-3 py-2 text-right font-normal">
                      Custo/{def.unidade}
                    </th>
                    {colunas.map((m) => (
                      <th
                        key={m.chave}
                        className="px-3 py-2 text-right font-normal"
                        title={m.origem}
                      >
                        {m.rotulo}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-normal">Criativos</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const r = resultadoDe(familia, c.acoes, {
                      reach: c.alcanceAprox,
                      impressions: c.impressions,
                      clicks: c.clicks,
                      linkClicks: c.linkClicks,
                    });
                    const custo = r.valor === null || r.valor === 0 ? null : dividir(c.spend, r.valor);
                    const pausada = c.situacao !== null && c.situacao !== 'ACTIVE';

                    const estaAberta = aberta === c.campaignId;

                    return (
                      <Fragment key={c.campaignId}>
                      <tr
                        style={{ borderBottom: '1px solid var(--hair)' }}
                        // A LINHA INTEIRA ABRE. Um botãozinho de seta na ponta
                        // seria alvo de 16px numa linha de 900 — e a pessoa
                        // clicaria na linha esperando que abrisse.
                        className="cursor-pointer"
                        onClick={() => setAberta(estaAberta ? null : c.campaignId)}
                      >
                        <td className="px-3 py-2 text-plat">
                          {/* O CONTROLE QUE O TECLADO E O LEITOR DE TELA ALCANÇAM É
                              UM BOTÃO, E NÃO A LINHA — WCAG 4.1.2. A `<tr>` tinha
                              `tabindex="0"` e `aria-expanded`, que o papel `row` de
                              uma tabela comum não aceita (só o `treegrid` aceita), e
                              o leitor de tela ignorava o estado. O botão leva o nome
                              da campanha e o `aria-expanded`; o clique dele sobe
                              para a linha, que continua sendo toda clicável para o
                              ponteiro (decisão acima) — um único `onClick`, então
                              nada abre e fecha duas vezes. */}
                          <button
                            type="button"
                            aria-expanded={estaAberta}
                            className="flex max-w-full flex-wrap items-center gap-2 text-left"
                          >
                            <span
                              className="o-mono text-[0.66rem] text-mute"
                              aria-hidden
                            >
                              {estaAberta ? '▾' : '▸'}
                            </span>
                            <span className="truncate" title={c.nome ?? c.campaignId}>
                              {c.nome ?? c.campaignId}
                            </span>
                            {pausada && <Selo tom="neutro">pausada</Selo>}
                          </button>
                          {/* De ONDE veio o número. É o que torna a coluna
                              auditável contra o gerenciador. */}
                          {r.origem !== null && (
                            <span
                              className="o-tab-legenda o-mono text-[0.70rem] text-mute"
                              title={r.origem}
                            >
                              {r.origem}
                            </span>
                          )}
                        </td>
                        <td className="tnum px-3 py-2 text-right" style={{ color: 'var(--luz-texto)' }}>
                          {inteiro(r.valor)}
                        </td>
                        <td className="tnum px-3 py-2 text-right">{dinheiro(custo)}</td>
                        {colunas.map((m) => (
                          <td key={m.chave} className="tnum px-3 py-2 text-right">
                            {mostrar(m, valorDaMetrica(m.chave, c))}
                          </td>
                        ))}
                        <td className="tnum px-3 py-2 text-right text-mute">{c.criativos}</td>
                      </tr>

                      {estaAberta && (
                        <tr>
                          {/* Sem `o-card` dentro: cartao dentro de cartao vira
                              caixa dentro de caixa, e a leitura se perde em
                              molduras. O recuo e o fundo mais escuro bastam
                              para dizer que isto pertence a linha de cima. */}
                          {/* O NUMERO DE COLUNAS E CALCULADO: nome + resultado +
                              custo + as escolhidas + criativos. Estava fixo em 7,
                              e bastava escolher uma metrica a mais para a linha
                              aberta parar de cobrir a tabela. */}
                          <td
                            colSpan={4 + colunas.length}
                            className="p-0"
                            style={{ background: 'var(--ink-0)' }}
                          >
                            {/* A FAIXA DA ESQUERDA VIAJA COM O PAINEL — F17.47.
                                Ela diz "isto pertence à linha de cima", e por
                                isso mora onde o painel mora: presa na janela do
                                quadro, e não na borda de uma célula de 1908px
                                que sai da tela ao rolar de lado. */}
                            <div
                              className="o-tab-encaixe pl-4"
                              style={{ borderLeft: '2px solid var(--luz)' }}
                            >
                              <AnunciosDaCampanha
                                assetId={assetId}
                                campaignId={c.campaignId}
                                familia={familia}
                                de={de}
                                ate={ate}
                                catalogoDaConta={catalogo}
                              />
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
