import React from 'react';
import ReactDOM from 'react-dom/client';

import App from '@/App';
import { definirHospedeirosConfiaveis } from '@/board/previa-de-link';
import { definirModoDoChat } from '@/chat/chave';
import { api } from '@/lib/api';
import { instalarRecargaPorPacoteNovo } from '@/ui/recarga-por-pacote-novo';
import '@/index.css';

/**
 * A LISTA DE SERVIDORES CONFIÁVEIS CHEGA ANTES DA PRIMEIRA TELA — F17.22.
 *
 * POR QUE ANTES, E NÃO "QUANDO CHEGAR"
 *   `lerLink` é síncrona e não fala com ninguém: ela lê a lista de uma variável
 *   de módulo. React não redesenha por causa de variável de módulo. Então uma
 *   lista que chegasse DEPOIS da primeira pintura não teria efeito nenhum
 *   naquela tela — o cartão do Nextcloud ficaria sem imagem até alguém mexer em
 *   algo, e o defeito seria intermitente, que é o pior tipo.
 *
 *   É o mesmo raciocínio que `Meu trabalho` já tinha usado para a aba inicial:
 *   estado no primeiro quadro, e não um efeito que corrige depois à vista de
 *   todo mundo.
 *
 * O TETO DE ESPERA É A TRAVA DE SEGURANÇA
 *   Bloquear a abertura do sistema num pedido de rede é aceitável por
 *   milissegundos e inaceitável por minutos. A rota `/config` não toca no banco
 *   — ela é a mais rápida que existe aqui —, mas rede é rede: com portal
 *   cativo, com proxy travado, uma requisição pode nunca voltar.
 *
 *   Passado o teto, o sistema abre com a lista VAZIA, que é exatamente o
 *   comportamento anterior a esta etapa: nenhum hospedeiro ganha imagem
 *   automática. Falhar para o lado fechado.
 *
 * ⚠️ NADA AQUI PODE IMPEDIR A TELA DE APARECER
 *   Esta função é a PRIMEIRA coisa que roda no sistema. Se ela lançar, o
 *   `.then` de baixo nunca corre e o que a pessoa vê é uma página em branco —
 *   por causa de uma lista de hospedeiros. Por isso ela engole tudo: recusa de
 *   rede, resposta fora do formato, corpo sem o campo. O pior caso é abrir sem
 *   a lista; nunca é não abrir.
 */
const TETO_DA_ESPERA = 1200;

/**
 * O PEDIDO QUE O `index.html` JÁ FEZ — perf-front, 08/10/2026.
 *
 * O `<head>` dispara `fetch('/api/config')` no primeiro byte do HTML, em
 * paralelo com o download desta entrada (ver o comentário lá). Aqui se pega essa
 * resposta, UMA vez: `Response.json()` só lê o corpo uma vez, e um segundo uso
 * (recarga a quente do Vite, por exemplo) cairia em erro — então a promessa é
 * esquecida depois de lida e o próximo uso volta a pedir pela API.
 *
 * Resposta fora de 2xx, corpo que não é JSON, rede caída: tudo vira `null`, o
 * mesmo que `api.configuracao().catch(() => null)` já fazia.
 */
function configAntecipada(): Promise<unknown> | null {
  const w = window as unknown as { __ideConfig?: Promise<Response> };
  const antecipada = w.__ideConfig;
  w.__ideConfig = undefined;
  if (antecipada === undefined) return null;
  return antecipada.then((r) => (r.ok ? (r.json() as Promise<unknown>) : null)).catch(() => null);
}

async function lerConfiaveis(): Promise<void> {
  try {
    const comTeto = new Promise<null>((ok) => setTimeout(() => ok(null), TETO_DA_ESPERA));
    const pedido: Promise<unknown> = configAntecipada() ?? api.configuracao().catch(() => null);
    const resposta = await Promise.race([pedido, comTeto]);
    // `typeof`, e não confiança no tipo: o tipo é uma promessa do nosso lado, e
    // do outro lado há uma resposta HTTP que pode vir de qualquer coisa.
    const lista = (resposta as { trustedImageHosts?: unknown } | null)?.trustedImageHosts;
    definirHospedeirosConfiaveis(typeof lista === 'string' ? lista : '');
    definirModoDoChat((resposta as { chat?: unknown } | null)?.chat);
  } catch {
    /* Lista vazia: ninguém é confiável até alguém dizer que é. */
  }
}

/**
 * A PÁGINA DO CLIENTE (`/aprovar/:token`, F42) NÃO PERGUNTA NADA ANTES — ela
 * não tem prévia de link nem chat, e o cliente da agência não deve esperar o
 * teto de 1,2 s nem fazer pedido nenhum fora de `/api/public/aprovacao/…`.
 */
const paginaDoCliente = window.location.pathname.startsWith('/aprovar/');

// Aba aberta desde antes de uma publicação: o pedaço pedido já foi trocado, e a
// aba se recarrega uma vez em vez de mostrar a tela de erro (ver o módulo).
instalarRecargaPorPacoteNovo();

/* `.then`, e não `await` de topo: o alvo de construção do Vite inclui
   navegadores sem `top-level await`, e o empacotador recusa a construção. */
void (paginaDoCliente ? Promise.resolve() : lerConfiaveis()).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
