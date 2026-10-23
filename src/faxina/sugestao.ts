/**
 * SUGESTÃO DE CLIENTE PELO TÍTULO — F38, Fase 8 (faxina do histórico).
 *
 * O time escreve o título da tarefa com o cliente na frente: "[A] FONSECA
 * MARTINS - MITOS SOBRE A CASA PRÓPRIA", "ZETA - MAQUINA NOVA". Este módulo lê
 * esse prefixo e diz a qual cliente ele aponta, e com que certeza. É puro: sem
 * banco, sem rede, testável.
 *
 * A REGRA (a mesma que a planilha documenta)
 *   1. PREFIXO: tira as etiquetas do começo (`[A]`, `[V]`, `[F]`…) e pega o que
 *      vem antes do primeiro " - " (também " – " e " — "). Título sem esse
 *      separador, ou cujo prefixo não tem letra (data, número), não tem prefixo.
 *   2. COMPARAÇÃO: tudo normalizado (sem acento, minúsculo, só letras e números,
 *      espaços colapsados). Do nome do cliente saem as palavras de empresa
 *      (ltda, me, eireli, epp). Clientes ativos E cancelados entram.
 *   3. GRAU
 *        exato    o prefixo é o nome inteiro do cliente, OU é o COMEÇO do nome
 *                 em palavras inteiras ("fonseca", "fonseca moura") e só um
 *                 cliente começa assim (apelido inequívoco; mínimo 3 letras);
 *        parecido o nome do cliente é o começo do prefixo ("clinica vitta
 *                 ibitinga"), OU a distância de edição entre o prefixo e o
 *                 começo do nome é pequena (1 letra de 7 a 13 caracteres, 2 de 14 em diante;
 *                 prefixo menor que 7 não entra: "cartas" não é "cartao"; e "ve enxovais"
 *                 não é "km enxovais": duas letras numa palavra curta é outro nome), e um só cliente chega lá;
 *        nenhum   nada bate, ou mais de um cliente bate no mesmo nível (ambíguo:
 *                 não se chuta; os candidatos vão em `candidatos`).
 *      O primeiro nível que tem resposta decide; dentro dele, mais de um
 *      candidato é ambiguidade.
 */

export type ClienteRef = {
  id: string;
  name: string;
  isActive: boolean;
  inactiveAt?: string | null;
};

export type Grau = 'exato' | 'parecido' | 'nenhum';

export type Sugestao = {
  grau: Grau;
  /** O cliente sugerido; nulo quando o grau é "nenhum". */
  cliente: ClienteRef | null;
  /** O prefixo como estava escrito, ou nulo quando o título não tem. */
  prefixo: string | null;
  /** Mais de um cliente bateu no mesmo nível: quais. Vazio nos demais casos. */
  candidatos: ClienteRef[];
  motivo: string;
};

/** Palavras de empresa que não ajudam a reconhecer um cliente. */
const RUIDO = new Set(['ltda', 'me', 'eireli', 'epp']);

/** Minúsculo, sem acento, só letras e números separados por um espaço. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const palavras = (normalizado: string): string[] => (normalizado === '' ? [] : normalizado.split(' '));

/** As palavras do nome do cliente, sem as de empresa. */
export function palavrasDoCliente(nome: string): string[] {
  return palavras(normalizar(nome)).filter((p) => !RUIDO.has(p));
}

/** "[A] FONSECA MOURA - X" → "FONSECA MOURA". Nulo quando não há prefixo. */
export function extrairPrefixo(titulo: string): string | null {
  const semEtiquetas = titulo.replace(/^\s*(\[[^\]]*\]\s*)+/, '');
  const corte = /\s[-–—]\s/.exec(semEtiquetas);
  if (!corte) return null;
  const prefixo = semEtiquetas.slice(0, corte.index).trim();
  // Sem letra (data, número de peça) não aponta cliente.
  if (!/\p{L}/u.test(prefixo)) return null;
  return prefixo === '' ? null : prefixo;
}

/** Distância de edição (Levenshtein). */
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min((anterior[j] ?? 0) + 1, (atual[j - 1] ?? 0) + 1, (anterior[j - 1] ?? 0) + custo);
    }
    anterior = atual;
  }
  return anterior[b.length] ?? 0;
}

const comecaCom = (inteiro: string[], inicio: string[]): boolean =>
  inicio.length > 0 && inicio.length <= inteiro.length && inicio.every((p, i) => p === inteiro[i]);

const nenhum = (prefixo: string | null, motivo: string, candidatos: ClienteRef[] = []): Sugestao => ({
  grau: 'nenhum',
  cliente: null,
  prefixo,
  candidatos,
  motivo,
});

export function sugerirCliente(titulo: string, clientes: readonly ClienteRef[]): Sugestao {
  const prefixo = extrairPrefixo(titulo);
  if (prefixo === null) return nenhum(null, 'o título não tem prefixo de cliente');

  const p = palavras(normalizar(prefixo));
  const pTexto = p.join(' ');
  if (pTexto.length < 3) return nenhum(prefixo, 'prefixo curto demais para comparar');

  const lidos = clientes.map((c) => ({ c, w: palavrasDoCliente(c.name) })).filter((x) => x.w.length > 0);

  const decidir = (grau: Exclude<Grau, 'nenhum'>, achados: ClienteRef[], motivo: string): Sugestao | null => {
    if (achados.length === 0) return null;
    if (achados.length > 1) return nenhum(prefixo, `ambíguo: o prefixo bate com mais de um cliente (${motivo})`, achados);
    return { grau, cliente: achados[0] ?? null, prefixo, candidatos: [], motivo };
  };

  // 1. exato: o nome inteiro, ou o começo do nome em palavras inteiras.
  const inteiros = lidos.filter((x) => x.w.join(' ') === pTexto).map((x) => x.c);
  const exatoInteiro = decidir('exato', inteiros, 'nome inteiro');
  if (exatoInteiro) return exatoInteiro;

  const comecos = lidos.filter((x) => x.w.length > p.length && comecaCom(x.w, p)).map((x) => x.c);
  const exatoApelido = decidir('exato', comecos, 'começo do nome');
  if (exatoApelido) return exatoApelido;

  // 2. parecido: o nome do cliente é o começo do prefixo.
  const estendidos = lidos.filter((x) => x.w.join(' ').length >= 4 && comecaCom(p, x.w)).map((x) => x.c);
  const parecidoEstendido = decidir('parecido', estendidos, 'prefixo mais longo que o nome');
  if (parecidoEstendido) return parecidoEstendido;

  // 3. parecido: poucas letras de diferença do começo do nome.
  if (pTexto.length >= 7) {
    const limite = pTexto.length < 14 ? 1 : 2;
    const perto = lidos
      .filter((x) => {
        const inicio = x.w.slice(0, p.length).join(' ');
        return distancia(pTexto, inicio) <= limite || distancia(pTexto, x.w.join(' ')) <= limite;
      })
      .map((x) => x.c);
    const parecidoPerto = decidir('parecido', perto, 'poucas letras de diferença');
    if (parecidoPerto) return parecidoPerto;
  }

  return nenhum(prefixo, 'nenhum cliente com esse nome');
}

/** O nome como a planilha mostra: cliente cancelado vem sinalizado. */
export function rotuloDoCliente(c: ClienteRef): string {
  return c.isActive ? c.name : `${c.name} (cancelado)`;
}

/** Tira o sinal de cancelado que a planilha põe, para casar o que o atendimento copiou. */
export function semSinalDeCancelado(texto: string): string {
  return texto.replace(/\s*\(cancelado\)\s*$/i, '').trim();
}
