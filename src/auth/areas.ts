/**
 * Que parte do sistema cada rota é — etapa F13.
 *
 * O PEDIDO
 *   "Cada funcionário poderá ver alguma parte em específico." A carteira já
 *   dizia QUAIS CLIENTES a pessoa alcança; isto diz QUAIS PARTES.
 *
 *   São coisas diferentes e as duas são necessárias: o social media cuida de
 *   dez clientes e não precisa do gerenciador de anúncios; o gestor de tráfego
 *   cuida dos mesmos dez e vive na Meta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROTA DESCONHECIDA É ROTA NEGADA, E ESSA É A DECISÃO QUE IMPORTA
 *
 *   `areaDaRota` devolve `null` para o que não reconhece, e `null` significa
 *   RECUSA. A alternativa — deixar passar o que não está no mapa — faria toda
 *   rota nova nascer sem proteção, em silêncio, e ninguém descobriria até
 *   alguém tentar.
 *
 *   O custo é conhecido e é o certo: acrescentar rota sem classificá-la a
 *   quebra na hora, no teste, e não meses depois em produção. É o mesmo
 *   princípio da lista fechada de rotas públicas da F1.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `livre` NÃO É `null`
 *   Algumas rotas são de qualquer pessoa autenticada: login, sair, saber quem
 *   sou, e o diretório de nomes que a lista de responsáveis usa. Elas são
 *   classificadas explicitamente como `livre` — dizer "não pertence a área
 *   nenhuma" é diferente de "esqueci de dizer".
 */

export const AREAS = ['entrega', 'quadro', 'meta', 'catalogos', 'pessoas'] as const;
export type Area = (typeof AREAS)[number];

export const ROTULO_DA_AREA: Record<Area, string> = {
  entrega: 'Entrega',
  quadro: 'Quadro',
  meta: 'Meta',
  catalogos: 'Catálogos',
  pessoas: 'Pessoas',
};

export const DESCRICAO_DA_AREA: Record<Area, string> = {
  entrega: 'Painel, clientes, semanal, calendário e planejamento',
  quadro: 'Quadro, visão do espaço, minhas tarefas, todas as tarefas e a ficha',
  meta: 'Contas, relatórios de campanha e de Instagram, ranking de criativos',
  catalogos: 'Planos, unidades de negócio e etiquetas — a estrutura que os clientes usam',
  pessoas: 'Convidar, mudar papel, definir carteira e áreas',
};

/** Rota de qualquer pessoa autenticada. Ver o cabeçalho: não é o mesmo que nula. */
export type Livre = 'livre';

type Regra = { metodo?: string; padrao: RegExp; area: Area | Livre };

/**
 * As regras, em ordem. A PRIMEIRA que casar ganha.
 *
 * A ordem é regra de verdade e não estilo: `/catalogs/manage` precisa vir antes
 * de `/catalogs`, senão a gestão de planos cairia em `entrega` e qualquer
 * pessoa poderia apagar um plano usado por trinta clientes.
 */
const REGRAS: Regra[] = [
  // --- livres: identidade e o diretório de nomes ----------------------------
  { padrao: /^\/health$/, area: 'livre' },
  // A configuração que o navegador precisa para abrir — hoje, só os hospedeiros
  // de imagem confiáveis desta instalação (F17.22). Vizinha de `/health` pelo
  // mesmo motivo: não fala do trabalho de ninguém, e o sistema a lê antes de
  // existir sessão. Ver a rota no Worker.
  { padrao: /^\/config$/, area: 'livre' },
  { padrao: /^\/auth\//, area: 'livre' },
  // O diretório é só nome e id de quem existe. A aba Checklist depende dele
  // para mostrar responsável — sem isso, ela mostraria identificadores.
  { padrao: /^\/team$/, area: 'livre' },
  // Gestão das próprias conexões de agente — F16.9b. Qualquer autenticado
  // consulta, emite credencial e revoga o que é dele. O handler exige sessão
  // humana; token de agente não entra. Superfície `/api` + este prefixo.
  { padrao: /^\/integrations(\/|$)/, area: 'livre' },
  // Chat da equipe — F20.3 / D26. Livre: qualquer autenticado. A chave
  // IDEWORKS_CHAT (desligado|piloto|ligado) é o freio; não há área própria.
  // Token de integração continua recusado na borda da API humana.
  { padrao: /^\/chat(\/|$)/, area: 'livre' },
  // A aprovação do cliente por link — F42. Sem sessão: o cliente não tem conta,
  // e a rota nem chama `resolveActor` (o link é a credencial). Classificada
  // como livre só para o mapa ficar completo. Ver `PUBLIC_ROUTES`.
  { padrao: /^\/public\//, area: 'livre' },

  // --- pessoas: administração ----------------------------------------------
  // F40 — o painel de controle da semana. A área `pessoas` só abre a porta; quem
  // decide é o papel: a leitura recusa com 403 quem não é admin/super_admin.
  { padrao: /^\/admin\/semana$/, area: 'pessoas' },
  // F40, Fase 6 — o OK (liberar a demanda). Mesma porta; o 403 do papel mora no módulo.
  { padrao: /^\/admin\/semana\/liberar$/, area: 'pessoas' },
  { padrao: /^\/admin\//, area: 'pessoas' },

  // --- catálogos: a estrutura, antes da leitura dela ------------------------
  { padrao: /^\/catalogs\/manage/, area: 'catalogos' },
  // GET /catalogs é LEITURA, e o formulário de cliente depende dela para
  // oferecer plano, categoria e etiqueta. Ela pertence à entrega.
  { padrao: /^\/catalogs$/, area: 'entrega' },
  // A ESCRITA do catálogo não mora sob `/catalogs`: planos, unidades de negócio
  // e etiquetas são salvos, apagados e fundidos em `/plans`, `/categories` e
  // `/tags` (e `/categories/:id/default`, `/tags/:id/merge`). Sem esta regra o
  // mapa devolvia `null` — que é recusa, para o super admin também — e a tela de
  // Catálogos não salvava nada. Quem escreve de verdade é o banco: as políticas
  // `plans_write`, `categories_write` e `tags_write` exigem administrador.
  { padrao: /^\/(plans|categories|tags)(\/|$)/, area: 'catalogos' },

  // --- meta -----------------------------------------------------------------
  { padrao: /^\/meta\//, area: 'meta' },
  { padrao: /^\/meta-assets\//, area: 'meta' },

  // --- quadro: o Pilar B ----------------------------------------------------
  //
  // ATÉ A F17.36 ISTO ERA `entrega`, e o comentário aqui dizia por quê: o
  // quadro lê e escreve a MESMA tabela `tasks` que as demandas, e uma área
  // própria custaria mexer na lista de áreas de TODA pessoa já cadastrada — o
  // primeiro efeito seria a equipe inteira abrir o quadro e levar 403. A
  // separação ficava para quando o Pilar B tivesse superfície própria.
  //
  // Ele tem: quadro, visão do espaço, minhas tarefas, todas as tarefas e a
  // ficha da tarefa. E o usuário pediu a caixinha na tela de pessoas. Então a
  // separação aconteceu — e o 403 previsto foi pago pela migration F17.36b,
  // que deu `quadro` a todo perfil que tinha `entrega`, antes de esta linha
  // mudar. Quem separar as duas de verdade faz isso pessoa por pessoa, na tela.
  //
  // A tabela continua sendo uma só, e isso continua certo: área é sobre QUAL
  // TELA se alcança, não sobre onde o dado mora.
  { padrao: /^\/board/, area: 'quadro' },

  // --- entrega: o Sistema IDE ----------------------------------------------
  { padrao: /^\/clients/, area: 'entrega' },
  { padrao: /^\/items/, area: 'entrega' },
  { padrao: /^\/calendar/, area: 'entrega' },
  // F17.44 — o compromisso é a outra coisa que cai no calendário. Ele NÃO conta
  // na cota do mês, mas quem o marca é quem opera a agenda do cliente: é a
  // mesma tela, o mesmo alcance e a mesma área.
  { padrao: /^\/appointments/, area: 'entrega' },
  { padrao: /^\/planning/, area: 'entrega' },
  { padrao: /^\/tasks/, area: 'entrega' },
  { padrao: /^\/history/, area: 'entrega' },
  { padrao: /^\/mural/, area: 'entrega' },
  { padrao: /^\/captures/, area: 'entrega' },
];

/**
 * A área de um caminho da API. `null` quando não se reconhece — e `null` recusa.
 *
 * O caminho é o que vem DEPOIS de `/api`, como o Worker já o corta.
 */
export function areaDaRota(caminho: string): Area | Livre | null {
  for (const r of REGRAS) {
    if (r.padrao.test(caminho)) return r.area;
  }
  return null;
}

/** Se um ator com estas áreas pode chamar este caminho. */
export function podeChamar(
  caminho: string,
  areas: readonly Area[],
  isSuperadmin: boolean,
): boolean {
  const area = areaDaRota(caminho);
  if (area === null) return false;
  if (area === 'livre') return true;
  // Administrador ignora áreas. Não é atalho: quem administra pessoas se dá
  // qualquer área em dois cliques, então negar seria teatro — e teatro de
  // permissão ensina a procurar contorno.
  return isSuperadmin || areas.includes(area);
}

/** A frase que a recusa devolve. Diz a área, para o pedido a quem administra ser específico. */
export const recusaDeArea = (caminho: string): string => {
  const area = areaDaRota(caminho);
  return area === null || area === 'livre'
    ? 'Você não tem acesso a esta parte do sistema.'
    : `Você não tem acesso à área ${ROTULO_DA_AREA[area]}. Peça a um administrador.`;
};
