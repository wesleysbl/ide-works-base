/**
 * Casar conta da Meta com cliente — etapa F7c.
 *
 * O PROBLEMA DE VERDADE DESTA TELA
 *   Não é "cadastrar uma conexão". É **casar 41 contas com 91 clientes**. A
 *   primeira versão pedia para a pessoa ir cliente por cliente procurando a
 *   conta na lista: 91 buscas manuais, cada uma num campo diferente.
 *
 *   Só que os nomes já se parecem — `@valentini.oficial` é a Valentini,
 *   "Canguru Print e Decor Anúncios" é a Canguru Print. O sistema consegue
 *   propor, e a pessoa só confirma. Isso troca 91 buscas por 41 confirmações,
 *   e as confirmações são rápidas porque o par certo está escrito ao lado.
 *
 * POR QUE PROPOR, E NÃO LIGAR SOZINHO
 *   Ligar a conta errada é pior que não ligar: passa a coletar dado de um
 *   cliente e mostrar no painel de outro, e ninguém desconfia porque o número
 *   existe e parece plausível. Proposta errada, a pessoa vê e ignora; ligação
 *   errada, ninguém vê.
 *
 * A REGRA É CONSERVADORA DE PROPÓSITO
 *   Só propõe quando há **um** candidato claramente melhor que os outros.
 *   Empate não vira proposta — vira trabalho manual, que é o certo quando o
 *   sistema não sabe.
 */

export type ContaParaParear = {
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  via: string | null;
};

export type ClienteParaParear = { id: string; name: string };

export type Sugestao = {
  conta: ContaParaParear;
  cliente: ClienteParaParear;
  /** 0 a 100. Acima de 90 é praticamente certeza. */
  confianca: number;
  motivo: string;
};

/**
 * Palavras que aparecem no nome da conta e não no do cliente.
 *
 * Vêm do dado real do Grupo Ideal, medido em 2026-08-20: "Canguru Print e
 * Decor **Anúncios**", "**CA** - Ana Prado Odontologia", "**Conta 01** -
 * Bairro Decora", "RAIZ **ADS**", "@valentini.**oficial**".
 *
 * Tirar essas palavras antes de comparar é o que faz o par aparecer.
 */
const RUIDO = new Set([
  'ads',
  'ad',
  'anuncios',
  'anuncio',
  'conta',
  'contas',
  'oficial',
  'official',
  'ca',
  'br',
  'com',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'ltda',
  'me',
  'mei',
  'eireli',
  'grupo',
  'loja',
  'perfil',
  'novo',
  'nova',
  'principal',
]);

/** Tira acento, caixa, pontuação e as palavras de ruído. */
export function normalizar(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((p) => p !== '' && !RUIDO.has(p))
    // Número solto ("01", "02") separa contas do MESMO cliente, e por isso não
    // ajuda a achar o cliente. Fica de fora da comparação.
    .filter((p) => !/^\d+$/.test(p));
}

/**
 * Quanto dois nomes se parecem, de 0 a 100.
 *
 * Não é distância de edição: é sobreposição de palavras. Nome de empresa erra
 * por palavra inteira ("Bairro Decora" vs "Vila Home Decor"), não por letra
 * — e distância de edição daria nota alta para nomes curtos e diferentes.
 */
export function semelhanca(a: string, b: string): number {
  const pa = normalizar(a);
  const pb = normalizar(b);
  if (pa.length === 0 || pb.length === 0) return 0;

  const setA = new Set(pa);
  const setB = new Set(pb);

  let iguais = 0;
  let parciais = 0;

  for (const p of setA) {
    if (setB.has(p)) {
      iguais += 1;
      continue;
    }
    // "valentini" dentro de "valentinioficial", ou o contrário. Só para palavras
    // com 4 letras ou mais: abaixo disso qualquer coisa cabe em qualquer coisa.
    if (p.length >= 4 && [...setB].some((q) => q.includes(p) || (q.length >= 4 && p.includes(q)))) {
      parciais += 1;
    }
  }

  // Divide pelo MENOR dos dois conjuntos: "Canguru Print" casar inteiro dentro
  // de "Canguru Print e Decor Anúncios" é um par bom, e dividir pelo maior
  // puniria o nome mais descritivo.
  const denominador = Math.min(setA.size, setB.size);
  return Math.round(((iguais + parciais * 0.6) / denominador) * 100);
}

/** Abaixo disto não se propõe nada. */
export const CONFIANCA_MINIMA = 60;

/** O melhor candidato precisa ganhar do segundo por esta margem. */
export const MARGEM_MINIMA = 15;

/**
 * Propõe pares, um por conta.
 *
 * Ignora conta já conectada — a lista existe para mostrar o que falta, e
 * repetir o que já foi feito é ruído que esconde o trabalho restante.
 */
export function sugerirPares(
  contas: readonly ContaParaParear[],
  clientes: readonly ClienteParaParear[],
  jaConectadas: ReadonlySet<string>,
): Sugestao[] {
  const sugestoes: Sugestao[] = [];

  for (const conta of contas) {
    if (jaConectadas.has(conta.externalId)) continue;

    // O nome de exibição é o melhor sinal; a página de origem serve de reserva
    // para o Instagram, cujo `@` às vezes é mais curto que o nome real.
    const candidatosDeNome = [conta.displayName, conta.via].filter(
      (n): n is string => typeof n === 'string' && n.trim() !== '',
    );
    if (candidatosDeNome.length === 0) continue;

    const notas = clientes
      .map((cliente) => ({
        cliente,
        nota: Math.max(...candidatosDeNome.map((n) => semelhanca(n, cliente.name))),
      }))
      .sort((x, y) => y.nota - x.nota);

    const melhor = notas[0];
    const segundo = notas[1];
    if (!melhor || melhor.nota < CONFIANCA_MINIMA) continue;

    // Empate não vira proposta. Quando o sistema não sabe, quem decide é a
    // pessoa — e uma proposta ambígua custa mais atenção do que campo vazio.
    if (segundo && melhor.nota - segundo.nota < MARGEM_MINIMA) continue;

    sugestoes.push({
      conta,
      cliente: melhor.cliente,
      confianca: melhor.nota,
      motivo:
        melhor.nota >= 100
          ? 'o nome bate inteiro'
          : melhor.nota >= 80
            ? 'o nome bate quase todo'
            : 'os nomes se parecem',
    });
  }

  // Mais confiáveis primeiro: quem revisa cansa, e o topo da lista é onde a
  // atenção está inteira.
  return sugestoes.sort((a, b) => b.confianca - a.confianca);
}

/** Contas que sobraram: nem conectadas, nem com proposta. */
export function contasOrfas(
  contas: readonly ContaParaParear[],
  sugestoes: readonly Sugestao[],
  jaConectadas: ReadonlySet<string>,
): ContaParaParear[] {
  const propostas = new Set(sugestoes.map((s) => s.conta.externalId));
  return contas.filter((c) => !jaConectadas.has(c.externalId) && !propostas.has(c.externalId));
}
