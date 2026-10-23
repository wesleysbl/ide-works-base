/**
 * De onde veio um pedido que MUDA estado — revisão de segurança de 09/10/2026.
 *
 * POR QUE `SameSite=Strict` NÃO BASTA
 *   O cookie da sessão não viaja em pedido vindo de OUTRO SITE, e isso fecha o
 *   pedido forjado clássico. Mas "mesmo site" é o domínio registrável inteiro:
 *   uma página em qualquer outro subdomínio de `exemplo.com.br` — um irmão de
 *   `works.` publicado por engano, um subdomínio tomado — é do mesmo site, e o
 *   navegador manda o cookie. O Worker lê o corpo com `request.json()` sem olhar
 *   o `Content-Type`, então um formulário `text/plain` (que não pede
 *   pré-verificação de CORS) carrega JSON e executa a rota. A resposta não se
 *   lê, mas a escrita acontece.
 *
 *   O navegador diz de onde o pedido saiu no cabeçalho `Origin`, em todo POST,
 *   PUT, PATCH e DELETE, e página nenhuma consegue trocá-lo. É a segunda trava,
 *   barata e independente do cookie.
 *
 * O QUE ELA NÃO FAZ
 *   · Leitura (`GET`, `HEAD`, `OPTIONS`) passa: não muda nada, e o navegador não
 *     entrega a resposta a outra origem (a API não abre CORS).
 *   · Pedido SEM `Origin` passa: não vem de página — é script, verificação,
 *     `curl` —, que não tem cookie de navegador para ser abusado. Quem chama
 *     assim leva o próprio crachá no cabeçalho `Authorization`.
 *   · `Origin: null` NÃO passa: é como o navegador se apresenta numa página
 *     `data:` ou num iframe com `sandbox`, que é exatamente o que um atacante
 *     monta.
 *   · Em desenvolvimento o front (:8080) fala com o Worker (:8787) por proxy, e
 *     `localhost` com `127.0.0.1` valem como a mesma máquina — a mesma folga de
 *     `origemDaPaginaConfere`.
 */

import { origemLocalDeDev } from '@/server/chat-live';

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

export const FRASE_OUTRA_ORIGEM_DO_PEDIDO = 'Pedido recusado: ele não veio da página do IDE Works.';

/** O pedido muda estado e o navegador diz que saiu de outra página? */
export function pedidoVeioDeOutraOrigem(request: Request): boolean {
  if (METODOS_DE_LEITURA.has(request.method.toUpperCase())) return false;

  const origem = request.headers.get('Origin');
  if (origem === null) return false;

  const esperada = new URL(request.url).origin;
  let recebida: string;
  try {
    recebida = new URL(origem).origin;
  } catch {
    return true; // `null`, ou lixo: não é uma origem
  }
  if (recebida === esperada) return false;
  if (origemLocalDeDev(esperada) && origemLocalDeDev(recebida)) return false;
  return true;
}
