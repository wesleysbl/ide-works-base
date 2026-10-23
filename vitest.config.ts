import path from 'node:path';

import { defineConfig } from 'vitest/config';

// Config dedicada ao vitest, separada da de build de proposito: a suite nao
// precisa dos plugins de empacotamento, e misturar as duas foi o que deixou a
// configuracao do legado dificil de auditar.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // O provedor OAuth importa `cloudflare:workers`. No Vitest isso não existe.
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './test/setup/cloudflare-workers-stub.ts',
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    alias: {
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './test/setup/cloudflare-workers-stub.ts',
      ),
    },
    // Sem isto o Node carrega o pacote OAuth cru e o import `cloudflare:`
    // explode antes do alias do Vite.
    server: { deps: { inline: ['@cloudflare/workers-oauth-provider'] } },

    // O isolamento de rede da F0.4. Carregado ANTES de qualquer teste, para que
    // nenhum consiga alcancar servidor remoto — o legado alcancava producao.
    setupFiles: [path.resolve(import.meta.dirname, 'test/setup/network-guard.ts')],
  },
});
