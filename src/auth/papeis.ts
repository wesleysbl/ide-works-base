/**
 * A hierarquia de quem usa o sistema — etapa F14.
 *
 * TRÊS NÍVEIS, E CADA UM EXISTE POR UM MOTIVO
 *
 *   `super_admin`   O topo. Só ele cria outro super admin e apaga pessoa, e
 *                   é o único que reparte QUALQUER unidade (empresa). É o dono
 *                   do sistema, e a lista dele é curta de propósito.
 *
 *   `admin`         Administra o dia a dia: convida, define carteira e áreas,
 *                   ativa e desativa. Desde a F17.36c também reparte unidades
 *                   — mas só as que ele mesmo tem (`can_grant_categories`), e
 *                   nunca as próprias. Não mexe em super admin e não apaga
 *                   ninguém.
 *
 *   `funcionario`   Trabalha. Não administra ninguém.
 *
 * POR QUE O SUPER ADMIN NÃO É SÓ "UM ADMIN COM MAIS BOTÕES"
 *   As coisas que só ele faz são as irreversíveis ou as que mudam o alcance
 *   de uma pessoa inteira de uma vez: apagar não tem volta, criar super admin
 *   cria um par, e dar uma unidade que quem administra não tem abriria uma
 *   carteira que ninguém abaixo dele alcança. (Até a F17.36c "mudar empresa"
 *   era só dele; hoje o administrador reparte o que tem.)
 *
 * A PRIMEIRA CONTA SÓ NASCE POR MIGRATION
 *   Só super admin cria super admin — então o primeiro não pode nascer pela
 *   tela. Ele vem de uma migration, e isso é a resposta honesta ao problema do
 *   ovo e da galinha, não um esquecimento.
 */

export const PAPEIS = ['super_admin', 'admin', 'funcionario'] as const;
export type Papel = (typeof PAPEIS)[number];

export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  super_admin: 'Super admin',
  admin: 'Administrador',
  funcionario: 'Funcionário',
};

export const DESCRICAO_DO_PAPEL: Record<Papel, string> = {
  super_admin: 'Cria outros super admins, apaga pessoas e reparte qualquer unidade',
  admin: 'Convida, define carteira, áreas e as unidades que tem, ativa e desativa',
  funcionario: 'Trabalha nas áreas e clientes que recebeu',
};

/** Quem administra: os dois primeiros níveis. */
export const administra = (p: Papel): boolean => p === 'super_admin' || p === 'admin';

/**
 * Se quem age pode mexer no papel do alvo.
 *
 * A tela usa para não oferecer o que o banco vai recusar — a regra de verdade
 * está em `set_user_role`, e vale para qualquer caminho.
 */
export function podeMexerNoPapel(
  quemAge: Papel,
  alvo: Papel,
  ehEleMesmo: boolean,
): boolean {
  if (ehEleMesmo) return false;
  if (!administra(quemAge)) return false;
  // Administrador não mexe em super admin — senão rebaixaria o dono e tomaria
  // o lugar.
  if (alvo === 'super_admin') return quemAge === 'super_admin';
  return true;
}

/** Se quem age pode ATRIBUIR este papel. */
export const podeAtribuir = (quemAge: Papel, novo: Papel): boolean =>
  novo === 'super_admin' ? quemAge === 'super_admin' : administra(quemAge);
