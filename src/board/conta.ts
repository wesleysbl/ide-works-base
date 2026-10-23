/**
 * O que o chip da conta diz, sem desenho — F29.
 *
 * Fora de `ContaNoPe.tsx` pelo mesmo motivo de `secao-recolhivel.ts` ao lado de
 * `BarraLateral`: arquivo de componente que exporta função comum perde o
 * recarregamento rápido do Vite (`react-refresh/only-export-components`), e a
 * suíte confere estas regras sem desenhar nada.
 */

import { ROTULO_DO_PAPEL } from '@/auth/papeis';
import { INSTALACAO } from '@/config/instalacao';
import { type Sessao } from '@/ui/sessao';
import { type Tema } from '@/ui/tema';

/**
 * Quem está no chip, por escrito.
 *
 * O NOME É O DO PERFIL, E SEM ELE O E-MAIL — F29. `/auth/me` devolve o
 * `full_name` que a tela de Pessoas mostra; dos perfis ativos, a maioria ainda
 * não tem nome, e para esses o chip continua no e-mail, como o resto do sistema
 * (o diretório da equipe devolve `coalesce(full_name, email)` — ver
 * `MenuDePessoas`). É a MESMA regra, e por isso as iniciais do chip saem de
 * `nome` pelo `Avatar`, a peça dos cartões: a mesma pessoa tem a mesma cara nos
 * dois lugares.
 *
 * O PAPEL É O RÓTULO DE `Pessoas` (`ROTULO_DO_PAPEL`): "Super admin",
 * "Administrador", "Funcionário". Um rótulo próprio para o chip seria o mesmo
 * papel com dois nomes no mesmo sistema.
 */
export function quemEsta(sessao: Sessao | null): { nome: string; papel: string | null } {
  if (sessao === null) return { nome: 'Sua conta', papel: null };
  return {
    nome: sessao.nome ?? sessao.email,
    papel: sessao.papel === null ? null : ROTULO_DO_PAPEL[sessao.papel],
  };
}

/**
 * O nome acessível do chip — o `aria-label` e o `title`.
 *
 * DIZ TUDO, EM QUALQUER APARÊNCIA: em `Somente ícones` o nome e o papel saem do
 * desenho, e só o leitor de tela e o `title` continuam a dizê-los. E o E-MAIL
 * FICA mesmo quando há nome (F29): é por ele que a pessoa entra, e é o que
 * distingue duas contas de mesmo nome — o chip desenhado mostra só o nome.
 */
export function rotuloDaConta(sessao: Sessao | null, carregando: boolean): string {
  if (carregando || sessao === null) return 'Sua conta e configurações';
  const { nome, papel } = quemEsta(sessao);
  const email = nome === sessao.email ? '' : ` (${sessao.email})`;
  return `Sua conta e configurações — ${nome}${email}${papel === null ? '' : `, ${papel}`}`;
}

/** O tema para onde o item `Tema` leva: o contrário do que está na tela. */
export const temaDeDestino = (agora: Tema): Tema => (agora === 'escuro' ? 'claro' : 'escuro');

/**
 * O sistema de ponto — o item `Já bateu seu ponto hoje?` do menu (F30).
 *
 * É UM LINK PARA FORA, E NÃO UMA TELA DAQUI: aponta para um sistema de ponto
 * que use as mesmas contas. O endereço vem de `INSTALACAO.enderecoDoPonto`
 * (`src/config/instalacao.ts`); sem ele (o padrão), o item não aparece no menu.
 *
 * Lido na hora de desenhar, e não no carregamento do módulo, para o teste
 * poder ligar e desligar o item.
 */
export function enderecoDoPonto(): string | null {
  const valor = (INSTALACAO.enderecoDoPonto ?? '').trim();
  return /^https:\/\/[^/\s]+(\/\S*)?$/.test(valor) ? valor : null;
}

/** O domínio sem o `https://`, como a linha miúda do item o escreve. */
export const dominioDoPonto = (endereco: string): string => new URL(endereco).host;
