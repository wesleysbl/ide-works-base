/**
 * Substitui `cloudflare:workers` na suíte. O Vitest roda em Node, e o
 * provedor OAuth da Cloudflare importa essa classe só para distinguir
 * handlers-objeto de `WorkerEntrypoint`. Sem o stub, o import quebra
 * antes de qualquer prova.
 *
 * `DurableObject` entrou na F20.4 (central do chat). A suíte não instancia
 * a central; só precisa do símbolo para o módulo carregar.
 */
export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  ctx: { props?: Props };
  env: Env;

  constructor(ctx: { props?: Props }, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class DurableObject<Env = unknown> {
  // Contexto tipado frouxo de propósito: o stub não emula hibernação.
  ctx: { acceptWebSocket?: unknown; getWebSockets?: unknown };
  env: Env;

  constructor(ctx: DurableObject['ctx'], env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
