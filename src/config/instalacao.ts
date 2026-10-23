/**
 * OS ENDEREÇOS DESTA INSTALAÇÃO: o que muda de uma empresa para outra.
 *
 * Quem monta o próprio IdeWorks troca os valores aqui (e o domínio também em
 * `IDEWORKS_PUBLIC_ORIGIN`, no `wrangler.toml`, que é o que o servidor lê).
 * Ver `docs/tutoriais/05-publicar-na-cloudflare.md`.
 */
export const INSTALACAO: {
  /**
   * O endereço publicado do sistema, sem barra no fim. Só é usado quando a tela
   * roda em `localhost`: as receitas de conexão de agentes de IA precisam de um
   * endereço que funcione de fora.
   */
  enderecoPublicado: string;
  /**
   * O link "Já bateu seu ponto hoje?" do menu da conta, para um sistema de ponto
   * que use as mesmas contas. `null` esconde o item.
   */
  enderecoDoPonto: string | null;
} = {
  enderecoPublicado: 'https://seu-dominio.exemplo.com.br',
  enderecoDoPonto: null,
};
