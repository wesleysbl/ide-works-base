/**
 * Para onde vai quem acabou de entrar — e, mais importante, COMO vai.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ `/oauth/authorize` NÃO É ROTA DO REACT ROUTER. É ROTA DO WORKER.
 * ═══════════════════════════════════════════════════════════════════════════
 *   O pedido de autorização do MCP começa no servidor: o Claude chama
 *   `GET /oauth/authorize?...`, o Worker guarda o pedido no cookie
 *   `ideworks_oauth_pedido` e manda a pessoa para `/?next=%2Foauth%2Fauthorize`
 *   para ela entrar. Depois do login o pedido precisa VOLTAR ao Worker.
 *
 *   `navigate('/oauth/authorize')` do react-router-dom NÃO faz isso. Ele é
 *   navegação de aplicação: mexe no histórico do navegador, procura o endereço
 *   entre as rotas de `src/rotas.tsx` — onde `/oauth/authorize` não existe,
 *   porque nunca foi uma tela — e desenha "Página não encontrada". Nenhuma
 *   requisição sai, o cookie do pedido nunca é enviado, e a conexão morre ali.
 *   Isso já custou duas tentativas de conexão em produção: a tela dizia 404
 *   enquanto o servidor estava inteiro do outro lado.
 *
 *   Para o Worker atender, a saída tem que ser navegação de DOCUMENTO — o
 *   navegador larga a aplicação e busca o endereço de verdade, levando o
 *   cookie junto. É o que `tipo: 'documento'` significa aqui.
 *
 *   Trocar TODAS as saídas por documento seria o exagero oposto: ir para
 *   `/painel` recarregando o pacote inteiro é mais lento e joga fora o cache em
 *   memória sem motivo. Por isso a decisão é por destino, e não global.
 *
 * ⚠️ E O `next` CONTINUA PRESO A UM ÚNICO VALOR
 *   Qualquer outro `next` vira `/painel`. Sem essa trava, o endereço da tela de
 *   login seria um redirecionamento aberto — e agora que a saída pode ser
 *   navegação de documento, seria um redirecionamento aberto para FORA do site.
 *   A trava vale dobrado depois desta mudança.
 */

/** Uma saída de aplicação atravessa o roteador; uma de documento sai do app. */
export type SaidaDoLogin =
  | { tipo: 'aplicacao'; destino: string }
  | { tipo: 'documento'; destino: string };

export function saidaDepoisDeEntrar(next: string | null): SaidaDoLogin {
  return next === '/oauth/authorize'
    ? { tipo: 'documento', destino: '/oauth/authorize' }
    : { tipo: 'aplicacao', destino: '/painel' };
}

/**
 * Executa a saída.
 *
 * `irParaDocumento` é injetável porque o Vitest deste projeto DESENHA NO
 * SERVIDOR: não há `window`, e mesmo que houvesse, mandar o navegador embora no
 * meio de um teste não é observável. Injetado, o teste vê o endereço exato que
 * teria sido pedido.
 *
 * ⚠️ `replace` NOS DOIS CAMINHOS, e pelo mesmo motivo (F17.33): entrar não é
 * uma navegação que se desfaz. Na saída de documento isso importa ainda mais —
 * com `assign`, o VOLTAR do navegador devolveria a pessoa à tela de login ainda
 * com `?next=/oauth/authorize` no endereço, refazendo o ciclo de autorização
 * com um pedido que o servidor já consumiu.
 */
export function sairDoLogin(
  saida: SaidaDoLogin,
  navigate: (destino: string, opcoes: { replace: boolean }) => void,
  irParaDocumento: (destino: string) => void = (destino) => {
    window.location.replace(destino);
  },
): void {
  if (saida.tipo === 'documento') irParaDocumento(saida.destino);
  else navigate(saida.destino, { replace: true });
}
