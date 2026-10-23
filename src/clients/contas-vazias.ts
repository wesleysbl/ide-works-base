/**
 * Por que o bloco de contas está vazio — F19e.
 *
 * SEPARADO DA TELA DE PROPÓSITO
 *   1. Esta frase faz uma AFIRMAÇÃO SOBRE O MUNDO: "a conta de anúncio deste
 *      cliente não chegou da Meta". Errar nela manda alguém procurar no lugar
 *      errado — então ela precisa de teste, e teste precisa de módulo.
 *   2. Exportar função de um arquivo de componente derruba o recarregamento
 *      rápido do Vite. Mesma lição do `SeletorDeMetricas`.
 */

import { semelhanca } from '@/meta/pareamento';

export type ContaDaMeta = {
  id: string;
  kind: 'ad_account' | 'instagram_account';
  externalId: string;
  displayName: string | null;
  businessName: string | null;
  pageName: string | null;
  lastError: string | null;
  client: { id: string; name: string } | null;
  diasColetados: number;
};

/**
 * A mesma nota que ordena a gaveta. Abaixo disto, o nome não lembra o cliente.
 *
 * 60 foi medido contra o dado real em 24/08/2026: pega `@proformaequipamentos`
 * para "Pró Forma" e `@raiz.imob` para "Raiz", e deixa Jatobá com zero
 * gerenciadores — que é a resposta certa, porque a conta dele não existe aqui.
 */
const PARECIDO = 60;

/**
 * Por que o bloco está vazio — ver o cabeçalho do `Bloco`.
 *
 * Fica FORA do componente, e num arquivo que o teste alcança, porque esta
 * frase faz uma afirmação sobre o mundo: "a conta deste cliente não chegou da
 * Meta". Errar nela manda alguém procurar no lugar errado.
 *
 * `parecidas` usa a MESMA semelhança que ordena a gaveta, para a frase não
 * contradizer a lista que a pessoa vai abrir em seguida.
 */
export function porQueVazio(
  contas: ContaDaMeta[],
  clienteNome: string,
  kind: ContaDaMeta['kind'],
  oQueE: string,
  plural: string,
  perde: string,
): { forte: string; resto: string } {
  const livres = contas.filter((c) => c.client === null && c.kind === kind);
  const parecidas = livres.filter(
    (c) => semelhanca(clienteNome, c.displayName ?? c.businessName ?? c.pageName ?? '') >= PARECIDO,
  ).length;

  if (livres.length === 0) {
    return {
      forte: `Não há ${oQueE} livre para ligar.`,
      resto: `Nenhum ${oQueE} sem dono chegou da Meta — nem deste cliente, nem de outro. ${perde}`,
    };
  }

  if (parecidas === 0) {
    // O CASO JATOBÁ. A conta não está esperando ligação: ela não chegou.
    return {
      forte: `Nenhum ligado, e nenhum dos ${livres.length} ${plural} livres tem nome parecido com ${clienteNome}.`,
      resto:
        // NÃO CHUTAR A CAUSA — F19f.
        //
        // A primeira versão dizia "provavelmente não foi compartilhada com a
        // BM". É UMA das causas, e apontá-la sozinha mandou o usuário fazer a
        // atribuição errada: ele atribuiu a conta ao app, que é outra coisa, e
        // ela continuou sem aparecer.
        //
        // Quem sabe a resposta é a área Meta, que enxerga o token e o usuário
        // do sistema dele. Aqui se diz o fato — não chegou — e se aponta para
        // onde a resposta mora.
        kind === 'ad_account'
          ? 'Conta de anúncio e página são permissões separadas na Meta, e liberar uma sem a outra é ' +
            'comum — é o que faz o Instagram entrar e o gerenciador não. A área Meta diz de qual ' +
            'usuário do sistema é o nosso token, e é a ele que a conta precisa estar atribuída. ' +
            `Vale abrir a gaveta assim mesmo: o nome na Meta pode não lembrar o do cliente. ${perde}`
          : 'Ou o perfil não é uma conta profissional, ou a página dele não está compartilhada com a ' +
            'agência — nesta arquitetura o Instagram é alcançado através da página. A área Meta diz o ' +
            `que o nosso token alcança. Vale abrir a gaveta assim mesmo: o @ pode não lembrar o nome do cliente. ${perde}`,
    };
  }

  return {
    forte:
      `Nenhum ligado, e ${parecidas} ` +
      `${parecidas > 1 ? `${plural} livres têm` : `${oQueE} livre tem`} ` +
      `nome parecido com ${clienteNome}.`,
    resto: `Abra “Ligar conta” e marque. ${perde}`,
  };
}

/**
 * O VÍNCULO EM UMA LINHA — F11B do plano UX.
 *
 * A ficha abria com um cartão inteiro de contas da Meta antes da produção,
 * mesmo quando nada estava ligado (a situação de quase toda a carteira). O
 * cartão foi para "Dados do cliente"; o que fica à vista é esta frase curta,
 * que diz o estado sem ocupar a tela. `null` enquanto as contas não chegaram:
 * "nada ligado" antes da leitura seria uma afirmação que ninguém fez.
 */
export function resumoDaMeta(contas: ContaDaMeta[] | null, clienteId: string): string | null {
  if (contas === null) return null;
  const minhas = contas.filter((c) => c.client?.id === clienteId);
  const g = minhas.filter((c) => c.kind === 'ad_account').length;
  const p = minhas.filter((c) => c.kind === 'instagram_account').length;
  if (g === 0 && p === 0) return 'Meta: nenhuma conta ligada';
  const partes = [
    g > 0 ? `${g} ${g === 1 ? 'gerenciador' : 'gerenciadores'}` : null,
    p > 0 ? `${p} ${p === 1 ? 'perfil' : 'perfis'}` : null,
  ].filter(Boolean);
  return `Meta: ${partes.join(' e ')}`;
}
