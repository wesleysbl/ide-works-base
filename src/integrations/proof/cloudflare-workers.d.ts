/**
 * O `@cloudflare/workers-oauth-provider` importa `cloudflare:workers`.
 * Esse módulo existe no runtime do Worker; no `tsc` da aplicação não.
 * A implementação de teste mora em `test/setup/cloudflare-workers-stub.ts`.
 */
declare module 'cloudflare:workers' {
  export class WorkerEntrypoint<Env = unknown, Props = unknown> {
    constructor(ctx: { props?: Props }, env: Env);
    ctx: { props?: Props };
    env: Env;
  }
}
