import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // .wrangler guarda o pacote gerado pelo Worker. Ja estava fora do git; faltava
  // sair daqui tambem — o mesmo descuido, duas vezes.
  //
  // `**/*.local` e o mesmo descuido uma TERCEIRA vez. O `.gitignore` ja tira
  // `*.local` na linha 11, mas o lint continuava entrando em
  // `recuperacao-producao.local/worker-publicado/index.js` — codigo BAIXADO da
  // Cloudflare para recuperacao, que ninguem edita aqui. Ele rendia uma
  // advertencia permanente ("Unused eslint-disable directive") sobre um arquivo
  // que nem e do projeto, e advertencia que ninguem pode resolver e ruido: a
  // proxima, que importa, chega no meio dela.
  { ignores: ['dist', 'node_modules', '.wrangler', 'coverage', '**/*.local'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
