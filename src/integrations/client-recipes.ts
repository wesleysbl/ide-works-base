/**
 * RECEITAS DE CONEXÃO POR CLIENTE — etapa F21.4.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE NÃO É UM BOTÃO "CONECTAR"
 *
 *   Nenhum cliente de agente deixa um site de terceiro registrar um servidor
 *   por conta própria. O fluxo SEMPRE começa dentro do cliente, e a autorização
 *   sempre passa pelo navegador. Não existe esquema de URL que registre um
 *   servidor remoto em um clique. Por isso a tela não promete um clique: ela
 *   entrega a RECEITA de cada cliente — o texto a copiar e o passo a passo —
 *   e diz a fricção real de cada caminho.
 *
 * ⚠️ NADA AQUI FOI TESTADO CONTRA UM CLIENTE REAL.
 *
 *   O projeto já registrou compatibilidade não verificada como se fosse
 *   verificada, e isso custou caro (ver `docs/CONTEXTO/f16-prova-compatibilidade.md`,
 *   que separa "testado" de "documentado" de "pendente"). Aqui a disciplina é a
 *   mesma: toda receita nasce com `status: 'nao-testado'` e a tela desenha esse
 *   selo. Quem conectar de verdade troca o status E anota a data — não antes.
 *
 * O ENDEREÇO DO SERVIDOR
 *
 *   Ele não é escrito à mão em cada receita. `serverAddresses()` deriva do
 *   endereço em que a própria tela está aberta (`window.location.origin`), que
 *   é, por definição, o endereço que a pessoa acabou de usar para chegar aqui.
 *   Em desenvolvimento (localhost, http) isso daria uma receita que não conecta
 *   de fora, então nesse caso — e só nesse — cai no endereço publicado.
 */

import { INSTALACAO } from '@/config/instalacao';

/**
 * O endereço publicado. Último recurso: só quando a tela roda em localhost.
 * Vem de `INSTALACAO.enderecoPublicado` (`src/config/instalacao.ts`).
 */
export const PUBLISHED_ORIGIN: string = INSTALACAO.enderecoPublicado;

export type ServerAddresses = {
  /** Origem efetiva, sem barra no fim. */
  origin: string;
  /** Endereço do servidor de agentes (o que se cola no cliente). */
  mcp: string;
  /** Endereço da API HTTP versionada (automação, script, n8n). */
  http: string;
};

function isLocal(origin: string): boolean {
  return (
    origin.startsWith('http://') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  );
}

export function serverAddresses(currentOrigin?: string | null): ServerAddresses {
  const bruto = (currentOrigin ?? '').trim().replace(/\/+$/, '');
  const origin = bruto && !isLocal(bruto) ? bruto : PUBLISHED_ORIGIN;
  return {
    origin,
    mcp: `${origin}/mcp`,
    http: `${origin}/api/integrations/v1`,
  };
}

/** Nome sugerido da conexão dentro do cliente. Curto, sem espaço, previsível. */
export const CONNECTION_HANDLE = 'ide-works';

export type RecipeStatus = 'nao-testado' | 'testado';

export type RecipeCopy = {
  /** O que este texto é, em português de tela. */
  label: string;
  /** O texto exato que o botão copia — é também o que a receita mostra. */
  text: string;
};

export type ClientRecipe = {
  id: string;
  /** Nome do cliente como a pessoa o conhece. */
  label: string;
  /** Uma linha: para quem é este caminho. */
  summary: string;
  /** O que copiar, na ordem de uso. */
  copies: RecipeCopy[];
  /** Passo a passo, incluindo o que só se resolve dentro do cliente. */
  steps: string[];
  /** A fricção real — o que vai dar trabalho, dito antes de dar. */
  friction: string;
  status: RecipeStatus;
  /** O que falta para o status virar "testado". */
  pending: string;
};

/**
 * As cinco receitas. Texto de tela em português; nomes técnicos em inglês.
 */
export function clientRecipes(addresses: ServerAddresses): ClientRecipe[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code (terminal)',
      summary: 'Para quem já usa o Claude no terminal do computador.',
      copies: [
        {
          label: 'Comando para colar no terminal',
          text: `claude mcp add --transport http ${CONNECTION_HANDLE} ${addresses.mcp}`,
        },
      ],
      steps: [
        'Abra o terminal, na pasta em que você costuma usar o Claude Code.',
        'Cole o comando acima e dê enter.',
        'O Claude vai abrir o navegador para você entrar com sua conta do IDE Works e autorizar. Essa parte só acontece dentro do navegador — não dá para pular.',
        'Na tela de autorização, marque só o que o agente precisa. Comentar e ler já resolvem quase tudo; mover card é a permissão que mexe no quadro dos outros.',
        'De volta ao terminal, peça algo simples ao agente (por exemplo, o relatório de entrega) para confirmar que ele enxerga o IDE Works.',
      ],
      friction: 'Exige terminal e uma passagem obrigatória pelo navegador para autorizar. Não é um clique.',
      status: 'nao-testado',
      pending: 'Ninguém conectou o Claude Code ao IDE Works ainda. O comando vem da documentação, não de um teste nosso.',
    },
    {
      id: 'claude-web',
      label: 'Claude no site ou no aplicativo',
      summary: 'Para quem usa o Claude pelo navegador, pelo aplicativo do computador ou do celular.',
      copies: [
        { label: 'Endereço do servidor', text: addresses.mcp },
        { label: 'Nome sugerido da conexão', text: 'IDE Works' },
      ],
      steps: [
        'No Claude, abra Configurações e procure a seção de conectores.',
        'Escolha adicionar um conector personalizado.',
        'Cole o endereço do servidor no campo do endereço e o nome sugerido no campo do nome.',
        'Salve e clique em conectar: o Claude abre a tela do IDE Works para você entrar e autorizar.',
        'Na tela de autorização, marque só o que o agente precisa.',
      ],
      friction:
        'O caminho é todo dentro do Claude, à mão. Em conta de time ou empresa, só quem é dono da conta consegue adicionar um conector; na conta gratuita cabe apenas um conector personalizado.',
      status: 'nao-testado',
      pending:
        'Não conectamos o IDE Works ao Claude na web ainda. Circula um endereço que abriria essa janela já preenchida — nós NÃO conseguimos confirmar que ele funciona, então ele não vira botão aqui.',
    },
    {
      id: 'chatgpt',
      label: 'ChatGPT',
      summary: 'Para quem usa o ChatGPT e tem plano que libera conector próprio.',
      copies: [{ label: 'Endereço do servidor', text: addresses.mcp }],
      steps: [
        'No ChatGPT, abra Configurações e ligue o modo de desenvolvedor — sem ele a opção de conector próprio não aparece.',
        'Adicione um conector novo e cole o endereço do servidor.',
        'Autorize com sua conta do IDE Works quando o navegador abrir.',
        'Confirme numa conversa que o ChatGPT consegue ler algo do IDE Works antes de pedir qualquer coisa que escreva.',
      ],
      friction:
        'Depende do plano: nos planos de empresa o conector costuma ler e escrever; em plano pessoal ele costuma só ler. Não prometa escrita antes de testar na conta que vai ser usada.',
      status: 'nao-testado',
      pending: 'Nenhuma conta de ChatGPT foi conectada ao IDE Works. Regras de plano mudam com frequência — confirme na sua conta.',
    },
    {
      id: 'codex',
      label: 'Codex (terminal)',
      summary: 'Para quem usa o Codex da OpenAI no terminal.',
      copies: [
        {
          label: 'Comando para adicionar',
          text: `codex mcp add ${CONNECTION_HANDLE} --url ${addresses.mcp}`,
        },
        { label: 'Comando para entrar na conta', text: `codex mcp login ${CONNECTION_HANDLE}` },
      ],
      steps: [
        'Abra o terminal e cole o primeiro comando, que só registra o endereço.',
        'Cole o segundo comando: ele abre o navegador para você entrar no IDE Works e autorizar.',
        'Na tela de autorização, marque só o que o agente precisa.',
        'Peça uma leitura simples ao Codex para confirmar a ligação.',
      ],
      friction:
        'Dois comandos e uma passagem pelo navegador. O nome exato dos parâmetros muda de versão para versão — se o comando reclamar, rode `codex mcp add --help` e ajuste o endereço na mão.',
      status: 'nao-testado',
      pending: 'Não conectamos o Codex ao IDE Works. Os comandos vêm da documentação da OpenAI, não de um teste nosso.',
    },
    {
      id: 'automacao',
      label: 'Automação (n8n, script)',
      summary: 'Para um fluxo automático que roda sozinho, sem ninguém na frente da tela.',
      copies: [
        { label: 'Endereço do servidor', text: addresses.mcp },
        { label: 'Endereço para chamada HTTP direta', text: addresses.http },
        { label: 'Cabeçalho de autenticação', text: 'Authorization: Bearer <segredo>' },
      ],
      steps: [
        'Autorize a conexão uma vez, como pessoa, e ela aparecerá na lista desta tela.',
        'Nessa conexão, clique em «Emitir / rotacionar credencial». O segredo aparece UMA ÚNICA VEZ: copie e guarde no cofre de senhas antes de fechar a janela.',
        'No n8n, use o nó de cliente MCP com o endereço do servidor; em script, chame o endereço HTTP direto.',
        'Coloque o segredo no cabeçalho de autenticação, no lugar de <segredo>.',
        'Se o segredo vazar ou sumir, emita outro aqui: o anterior deixa de valer.',
      ],
      friction:
        'A automação não consegue autorizar sozinha — alguém precisa autorizar e emitir a credencial nesta tela antes. E o segredo não é recuperável: perdeu, emite outro.',
      status: 'nao-testado',
      pending:
        'A emissão da credencial funciona e é usada aqui, mas nenhum fluxo de n8n foi ligado ao IDE Works de ponta a ponta ainda.',
    },
  ];
}
