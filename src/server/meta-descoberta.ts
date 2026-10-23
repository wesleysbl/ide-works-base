/**
 * Descobrir o que o token enxerga — etapa F7b.
 *
 * POR QUE ISTO EXISTE
 *   A primeira versão da tela de conexões pedia o identificador da conta,
 *   digitado ou colado da URL. Na prática isso não funciona: a URL do perfil
 *   (`instagram.com/agencia.ide`) **não contém** o identificador — ele é
 *   numérico e não aparece em lugar nenhum que a pessoa costume abrir.
 *
 *   Se o token já enxerga o portfólio, quem tem que listar as contas é o
 *   sistema. Fazer a pessoa caçar ID era transferir para ela um trabalho que a
 *   API faz numa chamada.
 *
 * SEM PERMISSÃO NOVA
 *   Isto sai das mesmas cinco permissões já escolhidas:
 *     `/me/adaccounts`  → `ads_read`
 *     `/me/accounts`    → `pages_show_list`, e o campo do Instagram vem com
 *                         `instagram_basic`
 *
 *   `business_management` continua fora — ela seria necessária para enumerar
 *   ativos de uma BM inteira, e não é o que fazemos aqui.
 *
 * UMA FALHA NÃO DERRUBA A OUTRA
 *   Conta de anúncio e Instagram vêm de chamadas diferentes, com permissões
 *   diferentes. Se `ads_read` não tiver sido concedida, ainda assim queremos
 *   listar o Instagram — e dizer o que faltou, em vez de devolver lista vazia
 *   sem explicação.
 *
 *   Essa regra vale DENTRO de cada chamada também, e foi onde eu a quebrei: a
 *   Meta recusa a requisição inteira quando um único campo pedido exige
 *   permissão que o token não tem. Ver `CAMPOS_DA_CONTA` abaixo.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

export type ContaDescoberta = {
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  /** De onde ela veio — para o Instagram, a página a que está ligado. */
  via: string | null;

  /**
   * A estrutura que a Meta JÁ SABE, e que não se digita nem se adivinha.
   *
   * Conta de anúncio pertence a uma BM; conta do Instagram pende de uma página.
   * É por isso que a área Meta consegue se organizar sozinha por gerenciador,
   * sem depender de ninguém dizer o que é de quem.
   */
  businessId: string | null;
  businessName: string | null;
  pageId: string | null;
  pageName: string | null;
};

export type Descoberta = {
  contas: ContaDescoberta[];
  /** O que não deu para buscar, e por quê. Nunca engole a falha. */
  avisos: string[];

  /**
   * DE QUEM É O TOKEN — F19f.
   *
   * A tela listava o que o token alcança e nunca dizia QUEM ele é. Sem isso,
   * "meu cliente não aparece aqui" não tem como ser respondido por quem olha:
   * a lista é a resposta de uma pergunta cujo sujeito está escondido.
   *
   * E o sujeito é o que decide o conserto. `/me/adaccounts` devolve as contas
   * em que o USUÁRIO DO SISTEMA tem papel. Atribuir a conta ao **app** nas
   * Configurações do Negócio é outra atribuição, e sozinha ela não faz a conta
   * aparecer aqui — sem o nome do usuário do sistema na tela, não há como
   * saber a quem atribuir.
   *
   * Nulo quando a Meta recusa `/me`; vira aviso e a listagem continua, pela
   * mesma regra de "uma falha não derruba a outra".
   */
  identidade: { id: string; nome: string | null } | null;
};

/**
 * Percorre a coleção INTEIRA, seguindo `paging.next` — F19g.
 *
 * A descoberta pedia `limit=200` e lia UMA página, na conta de que 200 cobre
 * qualquer portfólio nosso. A conta está certa hoje e o raciocínio está errado:
 * a Meta pagina pelo tamanho da RESPOSTA, não pelo que se pediu. Medido contra
 * a API em 25/08/2026, com o portfólio da Alma Nove:
 *
 *   limit=200 → 43 itens, 1 página, sem `next`
 *   limit=25  → 25 itens e `next`; seguindo, 43
 *   limit=5   →  5 itens e `next`; seguindo, 43
 *
 * Ou seja: `next` existe e nós o ignorávamos. Enquanto a resposta couber, não
 * dá diferença; no dia em que não couber — mais contas, campo mais gordo,
 * mudança de política da Meta — a lista encolhe SEM ERRO NENHUM, e conta que
 * some sem erro é a falha mais cara desta área. Foi assim que 20 contas de
 * anúncio já sumiram uma vez, na F7d.
 *
 * O teto de páginas existe para `next` circular não virar laço infinito. Se
 * bater no teto, isso vira AVISO: parar caladinho seria repetir o defeito.
 */
const TETO_DE_PAGINAS = 25;

async function buscarTudo(
  primeira: string,
  avisos: string[],
  oQue: string,
): Promise<unknown[]> {
  const itens: unknown[] = [];
  let url: string | null = primeira;
  let paginas = 0;

  while (url !== null) {
    const corpo = (await buscar(url)) as { data?: unknown[]; paging?: { next?: string } };
    itens.push(...(corpo.data ?? []));
    paginas += 1;
    if (paginas >= TETO_DE_PAGINAS) {
      if (typeof corpo.paging?.next === 'string') {
        avisos.push(
          `A lista de ${oQue} passou de ${TETO_DE_PAGINAS} páginas e foi cortada em ` +
            `${itens.length} item(ns). O que veio está correto; pode faltar coisa.`,
        );
      }
      break;
    }
    url = typeof corpo.paging?.next === 'string' ? corpo.paging.next : null;
  }

  return itens;
}

async function buscar(url: string): Promise<unknown> {
  const resposta = await fetch(url);
  const corpo = (await resposta.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number };
  };
  if (!resposta.ok || corpo.error) {
    throw new Error(corpo.error?.message ?? `A Meta respondeu ${resposta.status}.`);
  }
  return corpo;
}

/**
 * Os campos da conta de anúncio, do mais rico ao mínimo.
 *
 * POR QUE ISTO É UMA LISTA COM RECUO, E NÃO UMA CHAMADA SÓ
 *   A Meta não ignora campo que o token não pode ler: ela **recusa a chamada
 *   inteira**, com erro 100. Um campo privilegiado a mais não custa aquele
 *   campo — custa a listagem toda.
 *
 *   Foi o que aconteceu. A F7d pediu `business{id,name}` para saber de qual
 *   gerenciador a conta era; esse campo exige `business_management`, que o
 *   token não tem de propósito. Resultado: as 20 contas de anúncio viraram
 *   zero, a falha virou um aviso na tela, e a área Meta ficou só com Instagram.
 *   Medido em 2026-08-20, com o usuário apontando que faltavam os gerenciadores.
 *
 *   `business_name` — achatado, sem subcampo — dá o nome da BM sem exigir nada
 *   além do que o token já tem. É o que a tela usa para agrupar. O ID da BM
 *   continua fora, e não faz falta: ninguém agrupa por número.
 *
 *   O recuo existe para a próxima vez: se algum destes campos passar a exigir
 *   permissão nova, perde-se o campo e não as contas.
 */
const CAMPOS_DA_CONTA = ['id,name,business_name', 'id,name'] as const;

async function listarContasDeAnuncio(auth: string, avisos: string[]): Promise<unknown[]> {
  let ultimoErro: unknown = null;

  for (const [i, campos] of CAMPOS_DA_CONTA.entries()) {
    try {
      const r = await buscarTudo(
        `${GRAPH}/me/adaccounts?fields=${campos}&limit=200&${auth}`,
        avisos,
        'contas de anúncio',
      );
      if (i > 0) {
        avisos.push(
          `As contas de anúncio vieram sem o nome do gerenciador — a Meta recusou o campo: ` +
            `${(ultimoErro as Error).message} As contas aparecem, mas sem agrupamento por BM.`,
        );
      }
      return r;
    } catch (erro) {
      ultimoErro = erro;
    }
  }
  throw ultimoErro;
}

/**
 * Quem é o dono do token.
 *
 * `/me?fields=id,name` não exige permissão nenhuma além de o token estar vivo
 * — conferido contra a Meta em 25/08/2026 com um token de usuário do sistema.
 */
async function identificarToken(
  auth: string,
  avisos: string[],
): Promise<{ id: string; nome: string | null } | null> {
  try {
    const r = (await buscar(`${GRAPH}/me?fields=id,name&${auth}`)) as {
      id?: string;
      name?: string;
    };
    if (typeof r.id !== 'string') return null;
    return { id: r.id, nome: typeof r.name === 'string' ? r.name : null };
  } catch (erro) {
    avisos.push(`Não consegui identificar o dono do token: ${(erro as Error).message}`);
    return null;
  }
}

export async function descobrirContas(token: string): Promise<Descoberta> {
  if (token.trim() === '') {
    throw new Error('Sem token da Meta: defina IDEWORKS_META_TOKEN no Worker.');
  }
  const auth = `access_token=${encodeURIComponent(token)}`;
  const contas: ContaDescoberta[] = [];
  const avisos: string[] = [];

  // Primeiro QUEM, depois O QUÊ — é o dono do token que explica a lista.
  const identidade = await identificarToken(auth, avisos);

  // --- contas de anúncio ------------------------------------------------------
  try {
    const encontradas = (await listarContasDeAnuncio(auth, avisos)) as Array<{
      id?: string;
      name?: string;
      business_name?: string;
    }>;

    for (const c of encontradas) {
      if (typeof c.id !== 'string') continue;
      const bm = typeof c.business_name === 'string' && c.business_name.trim() !== ''
        ? c.business_name.trim()
        : null;
      contas.push({
        kind: 'ad_account',
        // A Meta já devolve com o prefixo `act_` aqui.
        externalId: c.id,
        displayName: typeof c.name === 'string' ? c.name : null,
        via: bm,
        // O ID da BM fica de fora: só `business{id}` o entrega, e esse campo
        // exige `business_management`. O NOME basta para agrupar, que é para
        // isso que a área Meta usa.
        businessId: null,
        businessName: bm,
        pageId: null,
        pageName: null,
      });
    }
  } catch (erro) {
    avisos.push(
      `Não consegui listar contas de anúncio: ${(erro as Error).message} ` +
        '(costuma ser a permissão ads_read faltando no token).',
    );
  }

  // --- Instagram, pelas páginas -----------------------------------------------
  // O Instagram profissional não se lista sozinho: ele pendura na página do
  // Facebook a que está vinculado. É a mesma razão pela qual esta arquitetura
  // exige a página — ver `CONTEXTO/meta-configuracao-do-app.md`.
  try {
    const paginas = (await buscarTudo(
      `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}` +
        `&limit=200&${auth}`,
      avisos,
      'páginas',
    )) as Array<{
      id?: string;
      name?: string;
      instagram_business_account?: { id?: string; username?: string };
    }>;
    let comInstagram = 0;

    for (const p of paginas) {
      const ig = p.instagram_business_account;
      if (!ig || typeof ig.id !== 'string') continue;
      comInstagram += 1;
      contas.push({
        kind: 'instagram_account',
        externalId: ig.id,
        displayName: typeof ig.username === 'string' ? `@${ig.username}` : null,
        via: typeof p.name === 'string' ? p.name : null,
        businessId: null,
        businessName: null,
        pageId: typeof p.id === 'string' ? p.id : null,
        pageName: typeof p.name === 'string' ? p.name : null,
      });
    }

    if (paginas.length > 0 && comInstagram === 0) {
      avisos.push(
        `Encontrei ${paginas.length} página(s), mas nenhuma com conta do Instagram vinculada. ` +
          'Nesta arquitetura o Instagram é alcançado através da página — sem o vínculo, ' +
          'a conta não aparece aqui.',
      );
    }
    if (paginas.length === 0) {
      avisos.push(
        `O token não enxerga página nenhuma. Confira se o usuário do sistema` +
          `${identidade?.nome ? ` «${identidade.nome}»` : ''} recebeu acesso aos ativos ` +
          `nas Configurações do Negócio.`,
      );
    }
  } catch (erro) {
    avisos.push(
      `Não consegui listar páginas e Instagram: ${(erro as Error).message} ` +
        '(costuma ser pages_show_list ou instagram_basic faltando no token).',
    );
  }

  return { contas, avisos, identidade };
}
