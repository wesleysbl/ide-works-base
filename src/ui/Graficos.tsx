/**
 * Os gráficos — etapa F9.
 *
 * A conta está toda em `@/ui/grafico.ts`, que é puro e tem teste. Aqui só se
 * desenha o que ela devolveu.
 *
 * `preserveAspectRatio="none"` estica o desenho para a largura disponível, e é
 * por isso que todo traço leva `vector-effect="non-scaling-stroke"`: sem ele a
 * linha engordaria horizontalmente junto com o esticão e ficaria uma mancha
 * torta em tela larga.
 *
 * A cor entra por variável, nunca literal — regra D10 do roteiro.
 *
 * O nome é `Graficos` no plural por um motivo chato e real: Windows e macOS não
 * distinguem maiúscula de minúscula no nome do arquivo, então `Grafico.tsx` e
 * `grafico.ts` na mesma pasta são o MESMO arquivo para o resolvedor — e ele
 * escolhe um. Escrito assim depois de o build escolher o errado e o teste de
 * empacotamento pegar; agora o teste de fontes íntegras barra o par.
 */

import { type ReactNode, useId, useState } from 'react';

import {
  type Ponto,
  caminho,
  caminhoDeArea,
  limites,
  marcasDoEixo,
  posicionar,
  resumoDaSerie,
  segmentos,
} from '@/ui/grafico';

const CAIXA = { largura: 100, altura: 42 };

const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export function LinhaDoTempo({
  pontos,
  cor = 'var(--luz)',
  formatar = (v: number) => v.toLocaleString('pt-BR'),
  rodape,
  titulo,
}: {
  pontos: Ponto[];
  cor?: string;
  formatar?: (v: number) => string;
  /** Frase sob o gráfico. É onde a tela avisa quando a curva é aproximada. */
  rodape?: ReactNode;
  /**
   * O nome do gráfico ("Investimento por dia"). Com ele, a curva ganha nome
   * acessível com o resumo e a tabela dos dias ("Ver os números de …").
   */
  titulo?: string;
}) {
  const [sob, setSob] = useState<number | null>(null);
  /* UM DEGRADÊ POR GRÁFICO — F14. O id era fixo (`oGrad`): com três curvas na
     tela, as três pintavam a área com o degradê da PRIMEIRA, na cor dela. */
  const idDoDegrade = `o-grad-${useId().replace(/:/g, '')}`;

  const lim = limites(pontos);
  const pos = posicionar(pontos, CAIXA, lim);
  const trechos = segmentos(pos);
  const marcas = marcasDoEixo(pontos, 5);
  const temDado = trechos.length > 0;

  const apontado = sob === null ? null : pos[sob];

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CAIXA.largura} ${CAIXA.altura}`}
          preserveAspectRatio="none"
          className="block h-32 w-full"
          role="img"
          aria-label={titulo ? `${titulo}: ${resumoDaSerie(pontos, formatar)}` : 'série diária'}
        >
          <defs>
            <linearGradient id={idDoDegrade} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={cor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {trechos.map((t, i) => (
            <path key={`a${i}`} d={caminhoDeArea(t, CAIXA)} fill={`url(#${idDoDegrade})`} />
          ))}
          {trechos.map((t, i) => (
            <path
              key={`l${i}`}
              d={caminho(t)}
              fill="none"
              stroke={cor}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {apontado?.y !== null && apontado !== null && (
            <>
              <line
                x1={apontado.x}
                y1="0"
                x2={apontado.x}
                y2={CAIXA.altura}
                stroke="var(--hair-3)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <circle cx={apontado.x} cy={apontado.y} r="2.5" fill={cor} />
            </>
          )}

          {/* Uma fatia invisível por dia: é o que torna o gráfico legível em
              vez de decorativo. */}
          {pontos.map((p, i) => (
            <rect
              key={p.dia}
              x={(i / Math.max(1, pontos.length)) * CAIXA.largura}
              y="0"
              width={CAIXA.largura / Math.max(1, pontos.length)}
              height={CAIXA.altura}
              fill="transparent"
              onMouseEnter={() => setSob(i)}
              onMouseLeave={() => setSob((s) => (s === i ? null : s))}
            />
          ))}
        </svg>

        {apontado && (
          <div
            className="o-mono pointer-events-none absolute right-0 top-0 rounded px-1.5 py-0.5 text-[0.70rem]"
            style={{ background: 'var(--ink-2)', border: '1px solid var(--hair-3)' }}
          >
            <span className="text-mute">{diaCurto(apontado.ponto.dia)}</span>{' '}
            <span style={{ color: apontado.ponto.valor === null ? 'var(--mute)' : cor }}>
              {apontado.ponto.valor === null ? 'sem coleta' : formatar(apontado.ponto.valor)}
            </span>
          </div>
        )}

        {!temDado && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[0.72rem] text-mute">Sem dado no período.</span>
          </div>
        )}
      </div>

      <div className="o-mono mt-1 flex justify-between text-[0.72rem] text-mute">
        {marcas.map((i) => (
          <span key={i}>{diaCurto(pontos[i].dia)}</span>
        ))}
      </div>

      {rodape && <div className="mt-1 text-[0.72rem] leading-snug text-mute">{rodape}</div>}

      {titulo && pontos.length > 0 && (
        <details className="o-grafico-numeros">
          <summary>Ver os números de {titulo}</summary>
          <div className="o-grafico-numeros-caixa">
            <table>
              <caption className="sr-only">{titulo}</caption>
              <thead>
                <tr>
                  <th scope="col">Dia</th>
                  <th scope="col">Valor</th>
                </tr>
              </thead>
              <tbody>
                {pontos.map((p) => (
                  <tr key={p.dia}>
                    <th scope="row">{diaCurto(p.dia)}</th>
                    <td data-nulo={p.valor === null || undefined}>{p.valor === null ? 'sem coleta' : formatar(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * A barra que mora dentro da linha da tabela.
 *
 * Comparar campanhas por número escrito exige ler quinze algarismos; a barra
 * responde "quem levou o dinheiro" antes da leitura.
 */
export function BarraNaLinha({ fracao, cor = 'var(--luz)' }: { fracao: number; cor?: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{
        width: `${Math.max(0, Math.min(1, fracao)) * 100}%`,
        background: cor,
        opacity: 0.1,
      }}
    />
  );
}
