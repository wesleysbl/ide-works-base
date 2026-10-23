/**
 * O nome da pessoa convidada — etapa F17.29.
 *
 * O ACHADO
 *   A tela de convite não tinha onde escrever o nome. Nem ela, nem a de
 *   ativação, nem nada no percurso. `profiles.full_name` existia e nada o
 *   preenchia: quem entrasse pelo convite apareceria pelo e-mail na lista de
 *   responsáveis, nos avatares do cartão, nos comentários e em quem observa.
 *
 * OS DOIS LUGARES, E POR QUE DOIS
 *   Quem convida **sugere**; quem ativa **confirma ou corrige**. Cada metade
 *   cobre o risco da outra: só no convite, alguém escreve errado o nome de
 *   outra pessoa e ela não tem como consertar; só na ativação, a pessoa pula o
 *   campo e o nome fica vazio de novo.
 *
 * ONDE CADA UMA APERTA
 *   No convite o nome é **obrigatório** — quem convida sabe quem está
 *   convidando, e é o único momento em que o vazio ainda pode ser impedido de
 *   graça. Na ativação ele **não** é obrigatório: convite criado antes desta
 *   etapa não tem sugestão nenhuma, e cobrar o nome ali transformaria uma
 *   ausência antiga em porta trancada.
 *
 * POR QUE A SUGESTÃO VIAJA NO ENDEREÇO, E NÃO NUMA CONSULTA
 *   Para a tela de ativação pré-preencher o nome, ela precisaria perguntá-lo ao
 *   servidor ANTES de a pessoa provar que tem o código — e uma rota que
 *   responde "existe convite para este e-mail" é exatamente a enumeração de
 *   usuários que `activation.ts` gasta uma seção inteira para impedir.
 *
 *   Então a sugestão viaja dentro da mensagem que quem convidou já manda para
 *   aquela pessoa, no próprio endereço de ativação. Quem abre o link vê o nome
 *   preenchido; quem digita o endereço à mão vê o campo vazio — e aí a
 *   sugestão guardada no convite entra como reserva, no servidor. A garantia
 *   mora no servidor; a comodidade, no link.
 */

/**
 * O teto. Não é regra de negócio, é limite de campo de texto: sem ele, um nome
 * de dez mil caracteres entraria no banco e sairia deformando toda lista que o
 * mostra.
 */
export const NAME_MAX_LENGTH = 120;

/** O nome do parâmetro no endereço. Em português porque quem lê o link é gente. */
export const NAME_PARAM = 'nome';

/**
 * Tira o espaço de sobra e junta o que ficou.
 *
 * Só espaço em branco vira texto vazio, de propósito: um campo com um espaço
 * dentro seria um nome de exibição invisível — pior que vazio, porque quem
 * exibe acharia que há nome e deixaria de mostrar o e-mail.
 */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim();
}

export type NameCheck = { ok: true; value: string } | { ok: false; message: string };

/** A recusa diz o que fazer, e não o que houve. */
export const NAME_REQUIRED = 'Escreva o nome de quem vai receber o acesso.';
export const NAME_TOO_LONG = `Escreva o nome em até ${NAME_MAX_LENGTH} caracteres.`;

/**
 * O nome que o convite exige. A MESMA conferência roda na tela e no servidor —
 * a tela avisa antes de enviar, e o servidor nunca confia em quem chama.
 */
export function checkInvitedName(raw: unknown): NameCheck {
  const value = normalizeName(raw);
  if (value === '') return { ok: false, message: NAME_REQUIRED };
  if (value.length > NAME_MAX_LENGTH) return { ok: false, message: NAME_TOO_LONG };
  return { ok: true, value };
}

/**
 * A sugestão que chegou pelo endereço, pronta para preencher o campo.
 *
 * Corta no teto em vez de recusar: quem abriu o link não escreveu nada, e
 * recusar aqui seria culpar a pessoa por um endereço que ela só clicou.
 */
export function suggestedName(raw: unknown): string {
  return normalizeName(raw).slice(0, NAME_MAX_LENGTH);
}

/**
 * O endereço de ativação com a sugestão dentro. Sem nome, devolve o endereço
 * como veio — link com parâmetro vazio é ruído em mensagem que alguém vai ler.
 */
export function activationUrlWithName(activationUrl: string, name: unknown): string {
  const limpo = suggestedName(name);
  if (limpo === '') return activationUrl;
  const separador = activationUrl.includes('?') ? '&' : '?';
  return `${activationUrl}${separador}${NAME_PARAM}=${encodeURIComponent(limpo)}`;
}
