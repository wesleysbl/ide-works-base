/**
 * Isolamento de rede da suíte de testes — etapa F0.4.
 *
 * POR QUE ISTO EXISTE
 *   A configuração da suíte do sistema legado registra, em comentário próprio:
 *
 *       "A suite de seguranca faz round-trips reais contra o projeto de producao."
 *
 *   Ou seja: rodar os testes lá encostava no banco com os 91 clientes reais. E
 *   agora o IDE Works divide o mesmo projeto de banco (decisão D8), então o
 *   risco não diminuiu — aumentou.
 *
 *   Este arquivo é o comentário oposto. Se algum teste tentar falar com um
 *   servidor remoto, ele falha nomeando o destino, em vez de silenciosamente
 *   alcançar produção.
 *
 * LIMITE HONESTO DESTA TRAVA
 *   Ela cobre `fetch`, que é por onde tudo passa neste projeto. Um teste que
 *   abrisse conexão por outro caminho (soquete cru, driver de banco por TCP)
 *   escaparia. Quando existir teste assim, esta trava precisa crescer junto —
 *   e é melhor estar escrito aqui do que descoberto depois.
 */

const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

export class RemoteNetworkBlocked extends Error {
  constructor(destino: string) {
    super(
      `Teste bloqueado ao tentar alcançar "${destino}". ` +
        'A suíte não fala com servidor remoto. O sistema legado fazia isso contra ' +
        'produção, e o IDE Works divide o mesmo banco. ' +
        'Se este teste precisa mesmo de rede, ele não é teste de unidade — ' +
        'mova-o e justifique por escrito.',
    );
    this.name = 'RemoteNetworkBlocked';
  }
}

function destinoDe(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === 'object' && 'url' in input) return String((input as Request).url);
  return String(input);
}

export function installNetworkGuard(): void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const destino = destinoDe(input);

    let host: string | null = null;
    try {
      host = new URL(destino).hostname;
    } catch {
      // Endereço relativo só existe em navegador; em teste não há origem.
      host = null;
    }

    // Promessa rejeitada, nunca `throw` síncrono. O `fetch` de verdade rejeita
    // em erro de rede — quem escreve `fetch(...).catch(...)` continua
    // funcionando. Lançar de forma síncrona mudaria a semântica e faria a trava
    // se comportar diferente do que ela substitui.
    if (host === null || !LOCAL.has(host)) {
      return Promise.reject(new RemoteNetworkBlocked(destino));
    }

    return original(input as RequestInfo, init as RequestInit);
  }) as typeof fetch;
}

installNetworkGuard();
