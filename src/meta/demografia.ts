/**
 * O retrato do público — etapa F9e.
 *
 * A ORDEM DE CADA QUEBRA É DIFERENTE, E NÃO É DETALHE
 *   Idade tem ordem NATURAL: 13-17 vem antes de 18-24, sempre. Ordenar faixa
 *   etária por tamanho embaralha a leitura — a pergunta ali é "onde está o
 *   pico da curva", e curva com o eixo fora de ordem não é curva.
 *
 *   Cidade e país não têm ordem natural nenhuma. Ali a pergunta é "quem são os
 *   maiores", então ordena-se por tamanho e corta-se a cauda.
 *
 *   Gênero tem ordem convencional pequena e fixa.
 *
 *   Uma função só, ordenando tudo igual, erraria em duas das três.
 *
 * A CAUDA VIRA "OUTRAS", E NÃO SOME
 *   45 cidades numa tela é ilegível; mostrar 8 e descartar 37 mente sobre o
 *   total. As 37 viram uma linha somada — o percentual continua fechando em
 *   100%, e ninguém conclui que o público está concentrado quando não está.
 */

export type Dimensao = 'age' | 'gender' | 'city' | 'country' | 'age_gender';

export type Faixa = { bucket: string; value: number };

export const ROTULO_DA_DIMENSAO: Record<Dimensao, string> = {
  age: 'Faixa etária',
  gender: 'Gênero',
  city: 'Cidade',
  country: 'País',
  age_gender: 'Faixa etária por gênero',
};

/**
 * A ordem natural das faixas etárias da Meta.
 *
 * Vem da API, medida em 2026-08-20: 13-17, 18-24, 25-34, 35-44, 45-54, 55-64,
 * 65+. Faixa desconhecida cai no fim em vez de sumir — a Meta pode acrescentar.
 */
const ORDEM_DA_IDADE = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

const ROTULO_DO_GENERO: Record<string, string> = {
  F: 'Feminino',
  M: 'Masculino',
  U: 'Não informado',
};

const ORDEM_DO_GENERO = ['F', 'M', 'U'];

export const rotularBucket = (dimensao: Dimensao, bucket: string): string => {
  if (dimensao === 'gender') return ROTULO_DO_GENERO[bucket] ?? bucket;
  if (dimensao === 'age_gender') {
    // '13-17, F' vira '13-17 · Feminino'. A sigla sozinha não é rótulo de tela.
    const [idade = '', genero = ''] = bucket.split(',').map((x) => x.trim());
    return `${idade} · ${ROTULO_DO_GENERO[genero] ?? genero}`;
  }
  return bucket;
};

/**
 * Ordena a quebra do jeito que ELA pede. Ver o cabeçalho.
 *
 * `topo` só vale para cidade e país: cortar faixa etária destruiria a curva.
 */
export function ordenarFaixas(
  dimensao: Dimensao,
  faixas: readonly Faixa[],
  topo = 8,
): { visiveis: Faixa[]; outras: Faixa | null } {
  // A quebra cruzada tem ordem composta: primeiro a faixa etária, que é
  // natural, e dentro dela o gênero. Ordenar por tamanho embaralharia a curva
  // do mesmo jeito que embaralharia a idade sozinha.
  //
  // Os rótulos chegam como '13-17, F' — a Meta junta os dois valores da quebra.
  if (dimensao === 'age_gender') {
    const partes = (b: string) => {
      const [idade = '', genero = ''] = b.split(',').map((x) => x.trim());
      const i = ORDEM_DA_IDADE.indexOf(idade);
      const g = ORDEM_DO_GENERO.indexOf(genero);
      return [i === -1 ? ORDEM_DA_IDADE.length : i, g === -1 ? ORDEM_DO_GENERO.length : g];
    };
    return {
      visiveis: [...faixas].sort((a, b) => {
        const [ai, ag] = partes(a.bucket);
        const [bi, bg] = partes(b.bucket);
        return ai - bi || ag - bg || a.bucket.localeCompare(b.bucket);
      }),
      outras: null,
    };
  }

  if (dimensao === 'age' || dimensao === 'gender') {
    const ordem = dimensao === 'age' ? ORDEM_DA_IDADE : ORDEM_DO_GENERO;
    const posicao = (b: string) => {
      const i = ordem.indexOf(b);
      // Desconhecido no fim, e não no começo: `indexOf` devolve -1, que
      // ordenaria antes de tudo.
      return i === -1 ? ordem.length : i;
    };
    return {
      visiveis: [...faixas].sort(
        (a, b) => posicao(a.bucket) - posicao(b.bucket) || a.bucket.localeCompare(b.bucket),
      ),
      outras: null,
    };
  }

  const ordenadas = [...faixas].sort(
    (a, b) => b.value - a.value || a.bucket.localeCompare(b.bucket, 'pt-BR'),
  );
  if (ordenadas.length <= topo) return { visiveis: ordenadas, outras: null };

  const cauda = ordenadas.slice(topo);
  return {
    visiveis: ordenadas.slice(0, topo),
    outras: {
      bucket: `outras ${cauda.length}`,
      value: cauda.reduce((s, f) => s + f.value, 0),
    },
  };
}

/**
 * A fração de cada faixa sobre o total da quebra.
 *
 * Total zero devolve `null` em vez de dividir por zero — e `null` desenha
 * travessão, não 0%.
 */
export function percentuais(faixas: readonly Faixa[]): Map<string, number | null> {
  const total = faixas.reduce((s, f) => s + f.value, 0);
  return new Map(faixas.map((f) => [f.bucket, total === 0 ? null : f.value / total]));
}

/**
 * A faixa dominante — a frase que a tela diz em uma linha.
 *
 * Empate fica com a primeira na ordem natural: com duas faixas etárias
 * empatadas, dizer "o público é 45-54" quando 35-44 empata seria escolher por
 * sorteio.
 */
export function faixaDominante(dimensao: Dimensao, faixas: readonly Faixa[]): Faixa | null {
  if (faixas.length === 0) return null;
  const { visiveis } = ordenarFaixas(dimensao, faixas, faixas.length);

  let melhor = visiveis[0];
  for (const f of visiveis) if (f.value > melhor.value) melhor = f;
  return melhor;
}
