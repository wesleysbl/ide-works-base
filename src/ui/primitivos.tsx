/**
 * Peças visuais do IDE Works — OBSIDIAN. Etapa F4.3.
 *
 * REGRA DESTE ARQUIVO
 *   Nenhuma cor literal. Nem `#00ff66`, nem `emerald-400`. Só `var(--…)` do
 *   design system. É o que permite trocar o espectro inteiro editando um CSS.
 *
 *   A exceção é o medidor: a escada de cor dele é interpolada em tempo de
 *   execução entre três tokens lidos do próprio DS — continua sem cor literal,
 *   só que calculada.
 *
 * Idioma: interface em português, identificadores em inglês só no schema e nas
 * chamadas. Ver CONVENCOES.md (decisão D5).
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Link } from 'react-router-dom';

import { IconeBusca, IconeEsquerda, IconeFechar, IconeOlho, IconeOlhoRiscado } from '@/ui/Icones';
import { Marca } from '@/ui/Marca';
import { useTituloDoDocumento } from '@/ui/titulo-do-documento';

/* ───────────────────────────── páginas ─────────────────────────────

   O VOLTAR MOROU AQUI DA F17.33 ATÉ A F29 — E SAIU.

     O pedido da F17.33 foi *"cada tela aberta precisa ter um voltar para
     anterior"*, e a contagem de antes era duas telas em dezenove. Pôr o botão
     nas duas molduras resolveu de uma vez: ele era o PRIMEIRO item da coluna
     de conteúdo em todas as telas, e não havia como esquecer.

     ⚠️ O QUE MUDOU NA F29, E POR QUÊ. O Wesley disse em 23/09 que o Voltar
     confundia: com histórico ele fazia "anterior", sem histórico fazia
     "acima", e o botão escrito `‹ Voltar` não dizia qual dos dois. Ele
     escolheu a opção A — **a trilha substitui o Voltar**: cada saída diz, pelo
     nome, para onde vai.

     Então nenhuma das duas molduras desenha saída nenhuma agora:
       · as telas COM SESSÃO desenham o `Topo` (`@/ui/Topo`) no alto da coluna
         de conteúdo — trilha + título + ações —, e a barra é a navegação
         entre as telas principais;
       · as telas SEM SESSÃO (ativar, redefinir) passam `saida` a `Pagina`: um
         link com o NOME do lugar, `‹ Entrada`, e não "voltar".
     Quem guarda a regra é `test/toda-tela-diz-onde-esta.test.ts`. O único
     resto do Voltar é o X da ficha da tarefa (`@/ui/Voltar`).
   ───────────────────────────────────────────────────────────────────── */

/**
 * Página estreita e centrada — as telas de acesso (entrar, ativar).
 *
 * `saida` — F29 (Fase 5a). Um link NOMEADO, e não o Voltar: `‹ Entrada` diz
 * para onde leva antes de a pessoa clicar, que é o que o Voltar não dizia. A
 * entrada (`/`) não passa nenhuma — ela É o começo —, e o 404 tem a dele no
 * texto (`Voltar para a entrada`, que já diz o lugar).
 */
export function Pagina({
  titulo,
  subtitulo,
  saida,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  /** Para onde a tela sai, com o nome do lugar. */
  saida?: { rotulo: string; para: string };
  children: ReactNode;
}) {
  /* A MOLDURA PÚBLICA — F15 do plano UX. Um cartão, sempre o mesmo:
       cabeça → a marca (na entrada ela É o título) e, à direita, a saída nomeada;
       título, frase e o formulário, lidos de cima para baixo;
     e fora dele, o pé: de quem é o sistema, e que o acesso é por convite.
     O fio verde no alto do cartão é a assinatura da marca.
     No celular o cartão perde a caixa e encosta no alto: com o teclado aberto
     (390 × 360) o campo e o botão sobem juntos, sem centro vertical que os
     empurre para fora. Regras em `.iw-publica*` (`layout-foco.css`). */
  const entrada = titulo === 'IDE Works';
  // O título da ABA acompanha o da tela — WCAG 2.4.2 (a entrada fica "IDE Works").
  useTituloDoDocumento(titulo);
  return (
    <main className="iw-publica">
      <div className="iw-publica-coluna">
        <section className="iw-publica-cartao">
          <div className="iw-publica-cabeca">
            {entrada ? (
              <h1 className="iw-publica-marca">
                <Marca className="iw-marca-entrada" />
              </h1>
            ) : (
              <Marca className="iw-marca-publica" />
            )}
            {saida && (
              // O desenho é o do Voltar da F17.33 — botão fantasma pequeno, seta e
              // uma palavra —, e a palavra agora é o LUGAR.
              <Link to={saida.para} className="o-btn o-btn-fantasma o-btn-sm gap-1">
                <IconeEsquerda className="h-3.5 w-3.5" />
                {saida.rotulo}
              </Link>
            )}
          </div>
          {!entrada && <h1 className="iw-publica-titulo">{titulo}</h1>}
          {subtitulo && <p className="iw-publica-subtitulo">{subtitulo}</p>}
          <div className="iw-publica-miolo">{children}</div>
        </section>
        <p className="iw-publica-pe">Grupo Ide · acesso exclusivo por convite</p>
      </div>
    </main>
  );
}

/**
 * O FIM FELIZ das telas sem sessão (ativar, redefinir) — F15.
 *
 * A frase diz o que aconteceu; o botão é o próximo passo, e recebe o foco: o
 * formulário que tinha o foco acabou de sumir, e sem isto ele cairia no
 * `<body>` — quem usa teclado ou leitor de tela recomeçaria do alto.
 */
export function ProntoParaEntrar({ children, nota }: { children: ReactNode; nota?: ReactNode }) {
  const botao = useRef<HTMLAnchorElement>(null);
  useEffect(() => botao.current?.focus(), []);
  return (
    <div className="iw-publica-feito">
      <Aviso tipo="ok">{children}</Aviso>
      <Link ref={botao} to="/" className="o-btn o-btn-solido">
        Entrar
      </Link>
      {nota && <p className="iw-publica-nota !mt-0">{nota}</p>}
    </div>
  );
}

/**
 * Página larga — as telas com sessão, que desenham a barra e o `Topo`.
 *
 * ⚠️ `comTopo` E `acima` SAÍRAM NA F29 (Fase 5a). A Fase 4 criou `comTopo`
 *   para as oito telas do quadro e do trabalho desligarem o Voltar da moldura
 *   enquanto as outras o mantinham; `acima` dizia ao Voltar o lugar acima que
 *   só a tela sabia. Com todas as telas no `Topo`, o modo com Voltar deixou de
 *   existir, e uma prop que só tem um valor é uma pergunta que ninguém faz.
 *
 * ⚠️ POR QUE A MOLDURA NÃO DESENHA O TOPO ELA MESMA. Ele mora DENTRO da grade
 *   (à direita da barra), e a grade é da tela — umas a montam à mão, outras
 *   por `TelaComBarra`. A moldura só dá a folga de cima que o topo pede.
 *
 * `altura` — F17.27, e ela existe por um defeito medido.
 *
 *   `natural` (o padrão, e o que todas as telas menos duas usam): a página tem
 *   a altura do que há nela. Nada mudou.
 *
 *   `tela`: a página vira uma CADEIA DE ALTURA. `min-h-screen` já dizia "pelo
 *   menos a janela inteira", mas essa altura morria aqui — o filho não a
 *   recebia, e uma região que quisesse "o que sobra da janela" não tinha de
 *   quem herdar. Com `flex` e `min-h-0` em cada degrau, a sobra desce até quem
 *   souber usá-la — ver `.q-tela[data-altura='tela']` em `ui/quadro.css`.
 *
 *   ⚠️ ERA `min-h-screen` E NÃO `h-screen`, E ISSO MUDOU NA F17.72.
 *   A F17.27 escreveu que travar em 100vh cortaria a árvore da barra lateral,
 *   que por decisão da F17.14 não rolava sozinha. A F17.50 desfez essa
 *   decisão — a barra cabe na janela e a árvore rola dentro de si — e o
 *   `min-` sobreviveu à razão dele. Enquanto sobreviveu, a cadeia era a sobra
 *   de um MÍNIMO: qualquer filho que pedisse mais do que sobrava esticava a
 *   página inteira, e um pedia. Ver o comentário no `className` abaixo, com o
 *   número medido. Acima de 1024px agora é `h-screen`; abaixo, `min-h-screen`
 *   sozinho, e lá a página cresce como sempre cresceu.
 *
 *   E o respiro de baixo encolhe: a barra de rolagem do quadro nasce na borda
 *   inferior da região, e 24px de folga embaixo dela seria de novo o "quase no
 *   fim" que o usuário reclamou.
 */
export function PaginaLarga({
  children,
  altura = 'natural',
  className = '',
}: {
  children: ReactNode;
  altura?: 'natural' | 'tela';
  className?: string;
}) {
  const deTela = altura === 'tela';
  return (
    <main
      className={
        'iw-app min-h-screen px-4 sm:px-6 lg:px-8' +
        /* F29: com o topo na coluna, a grade começa no alto da página — a barra
           e o título na mesma linha. `pt-3` é o `top` da barra que gruda
           (`0.75rem`, `ui/clickup.css`): parada ou rolada, ela fica no mesmo
           lugar. A folga de baixo é a de sempre — ou a da cadeia de altura,
           logo abaixo, que tem a dela (`pb-2`): duas classes de `pb` na mesma
           peça seriam decididas pela ordem da folha, e não por esta linha. */
        (deTela ? ' pt-3' : ' pt-3 pb-6') +
        /*
          ⚠️ `lg:h-screen` — F17.72, E ELE É A CAUSA QUE FALTAVA.

          A F17.27 escreveu que `min-h-screen` bastava, e que `h-screen`
          "cortaria a barra lateral, que não rola sozinha". ESSA RAZÃO
          MORREU NA F17.50: desde ela a barra cabe na janela e é a árvore
          que rola dentro de si. O `min-` ficou, e com ele a cadeia inteira
          era uma SOBRA DE UM MÍNIMO — ela só funcionava enquanto nenhum
          filho pedisse mais do que sobrava.

          Um filho pedia. MEDIDO no Chrome 1920×1080, quadro da pasta
          `TIME HELENA`: `.bl-barra` tem `max-height: calc(100vh - 1.5rem)`
          = 1056px, um teto escrito como se ela começasse no topo da
          janela. Ela começa em y=112 — abaixo do título e do voltar
          (era assim até a F29) —,
          então pedia 112+1056 = **1168px numa janela de 1080**. A linha da
          grade cresceu para 1056, `<main>` para 1176, o documento para
          1176: **96px de página além da janela**, e a base da coluna
          **78px abaixo da dobra**. O último cartão ficava fora da tela
          mesmo com a coluna rolada até o fim.

          Com `h-screen` a altura deixa de ser um mínimo e vira NÚMERO
          FIRME: a sobra que desce a cadeia é a sobra que existe.

          ⚠️ E O `lg:` CAIU NA F17.75 — a razão dele também morreu.
          A F17.27 restringiu a cadeia a 1024px porque abaixo disso a grade
          empilhava a BARRA em cima do quadro, e a sobra seria pouca demais
          para as duas coisas. Medido em 820×900, pasta `TIME HELENA`: o
          quadro só começava em y=1.627 — 1.515px de barra na frente dele —
          e a página inteira dava 2.593px numa janela de 900.

          Desde a F17.75 a barra é uma GAVETA abaixo de 1024px, fora do
          fluxo. Sem ela no caminho não há mais "duas coisas", e a cadeia
          serve em qualquer largura. É o mesmo movimento que a F17.72 fez
          com o `min-`: a regra tinha sobrevivido à razão dela.
        */
        (deTela ? ' flex h-screen flex-col pb-2' : '') + ' ' + className
      }
    >
      <div
        className={
          // A moldura acompanha a janela, inclusive em monitores ultrawide.
          // A largura explícita evita encolher enquanto o conteúdo carrega.
          'w-full min-w-0' +
          (deTela ? ' flex min-h-0 flex-1 flex-col' : '')
        }
      >
        {children}
      </div>
    </main>
  );
}

/* ───────────────────────────── formulário ───────────────────────────── */

/**
 * Dica embaixo do campo — vira a mensagem de erro quando há erro.
 *
 * O DESENHO SAIU DAQUI E FOI PARA `.o-dica` — F17.37.
 *   Era `mt-1 block font-mono text-[0.66rem]` com a cor num `style` embutido:
 *   quatro decisões de tipografia escritas dentro de um componente, longe da
 *   folha onde as outras moram. Enquanto estiveram aqui, ninguém as reviu —
 *   e eram exatamente elas que faziam a frase da tela `Convidar` sumir.
 *
 *   Agora o tamanho, a família, o tom e a folga vêm da régua do design system,
 *   e mudar a dica do sistema inteiro é editar uma regra.
 */
function Rodape({ dica, erro, id }: { dica?: string; erro?: string; id?: string }) {
  if (!erro && !dica) return null;
  return (
    /* O ERRO É ANUNCIADO — WCAG 3.3.1 e 4.1.3. O erro de campo aparece ao enviar
       o formulário, com o foco no botão: sem `role="alert"` o leitor de tela não
       ouvia nada, e a pessoa só descobria o que faltava navegando de campo em
       campo. A `key` troca o elemento quando a dica vira erro (e o contrário):
       uma região viva que já existia e só ganhou o papel junto com o texto não é
       anunciada de forma confiável. */
    <span
      key={erro ? 'erro' : 'dica'}
      id={id}
      className="o-dica"
      data-erro={erro ? 'true' : undefined}
      role={erro ? 'alert' : undefined}
    >
      {erro ?? dica}
    </span>
  );
}

const bordaDeErro = (erro?: string) =>
  erro ? { borderColor: 'var(--err)', boxShadow: '0 0 0 3px var(--err-soft)' } : undefined;

/**
 * O rótulo, e o `?` ao lado dele quando há o que explicar — F17.37.
 *
 * ⚠️ POR QUE O `?` CHEGA PRONTO, DE FORA
 *   A peça `Ajuda` mora em `@/board/menus`, junto com o balão que ela abre.
 *   Importá-la aqui inverteria a dependência: a primitiva de campo passaria a
 *   depender do quadro. Então quem chama monta o `?` e o entrega montado — este
 *   arquivo só sabe onde ele fica na linha.
 *
 * QUANDO É `dica` E QUANDO É `ajuda`
 *   `dica` é o que a pessoa lê TODA vez que preenche: formato, unidade,
 *   "opcional". `ajuda` é o que ela precisa saber UMA vez — a consequência, a
 *   regra, o que acontece depois. A F17.37 tirou da tela as segundas, que
 *   estavam escritas como se fossem as primeiras.
 */
function Rotulo({ rotulo, ajuda }: { rotulo: string; ajuda?: ReactNode }) {
  if (!ajuda) return <span className="o-rotulo">{rotulo}</span>;
  return (
    <span className="o-rotulo-linha">
      <span className="o-rotulo">{rotulo}</span>
      {ajuda}
    </span>
  );
}

/**
 * Um título de bloco com o `?` ao lado — o mesmo par, para os blocos que não
 * são campo: as pílulas de papel, as de área, as de empresa.
 */
export function RotuloDeBloco({ children, ajuda }: { children: ReactNode; ajuda?: ReactNode }) {
  return (
    <div className="o-rotulo-linha mb-1.5">
      <span className="eyebrow">{children}</span>
      {ajuda}
    </div>
  );
}

type Rotulado = { rotulo: string; dica?: string; erro?: string; ajuda?: ReactNode };

export function Campo({
  rotulo,
  dica,
  erro,
  ajuda,
  ...props
}: Rotulado & React.InputHTMLAttributes<HTMLInputElement>) {
  const gerado = useId();
  const id = props.id ?? gerado;
  const rodape = erro || dica ? `${id}-rodape` : undefined;
  /* COM O `?`, O RÓTULO APONTA PELO `htmlFor` — F13. O `<label>` que
     embrulhava tudo rotulava o PRIMEIRO controle de dentro, e o botão do `?`
     vem antes do campo: o campo ficava sem nome (o leitor de tela dizia só
     "caixa de texto") e o `?` ganhava o rótulo inteiro. Mesma saída do
     `CampoDeSenha`: o botão mora fora do `<label>`. */
  if (ajuda) {
    return (
      <div className="block">
        <span className="o-rotulo-linha">
          <label htmlFor={id} className="o-rotulo">
            {rotulo}
          </label>
          {ajuda}
        </span>
        <input
          {...props}
          id={id}
          className="o-campo"
          style={bordaDeErro(erro)}
          aria-invalid={!!erro}
          aria-describedby={rodape}
        />
        <Rodape dica={dica} erro={erro} id={rodape} />
      </div>
    );
  }
  return (
    <label className="block">
      <Rotulo rotulo={rotulo} ajuda={ajuda} />
      <input {...props} className="o-campo" style={bordaDeErro(erro)} aria-invalid={!!erro} aria-describedby={rodape} />
      <Rodape dica={dica} erro={erro} id={rodape} />
    </label>
  );
}

/**
 * Campo de senha com o botão que mostra o que foi digitado — F27.
 *
 * POR QUE O BOTÃO FICA FORA DO `<label>`
 *   O `Campo` embrulha tudo num `<label>`, e o nome acessível do campo sai do
 *   texto de dentro dele. Um botão lá dentro entraria no nome: o leitor de tela
 *   anunciaria "Senha Mostrar senha", e `getByLabel('Senha')` deixaria de
 *   achar o campo. Aqui o rótulo aponta para o campo por `htmlFor`, e o botão
 *   mora ao lado, só desenhado por cima da caixa.
 *
 * `type="button"`, E NÃO O PADRÃO
 *   Dentro de um `<form>` o padrão de `<button>` é `submit`: conferir a senha
 *   enviaria o formulário pela metade.
 */
export function CampoDeSenha({
  rotulo,
  dica,
  erro,
  ajuda,
  disabled,
  ...props
}: Rotulado & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const gerado = useId();
  const id = props.id ?? gerado;
  const rodape = erro || dica ? `${id}-rodape` : undefined;
  const [visivel, setVisivel] = useState(false);
  return (
    <div className="block">
      <label htmlFor={id} className="block">
        <Rotulo rotulo={rotulo} ajuda={ajuda} />
      </label>
      <div className="o-campo-com-adorno">
        <input
          {...props}
          id={id}
          type={visivel ? 'text' : 'password'}
          disabled={disabled}
          className="o-campo"
          style={bordaDeErro(erro)}
          aria-invalid={!!erro}
          aria-describedby={rodape}
        />
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-icone o-adorno"
          aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
          aria-pressed={visivel}
          disabled={disabled}
          onClick={() => setVisivel((v) => !v)}
        >
          {visivel ? <IconeOlhoRiscado /> : <IconeOlho />}
        </button>
      </div>
      <Rodape dica={dica} erro={erro} id={rodape} />
    </div>
  );
}

export function Area({
  rotulo,
  dica,
  erro,
  ajuda,
  ...props
}: Rotulado & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <Rotulo rotulo={rotulo} ajuda={ajuda} />
      <textarea
        {...props}
        className="o-campo min-h-[5rem] resize-y"
        style={bordaDeErro(erro)}
        aria-invalid={!!erro}
      />
      <Rodape dica={dica} erro={erro} />
    </label>
  );
}

export function Selecao({
  rotulo,
  dica,
  erro,
  ajuda,
  children,
  ...props
}: Rotulado & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <Rotulo rotulo={rotulo} ajuda={ajuda} />
      <select
        {...props}
        className="o-campo o-select"
        style={bordaDeErro(erro)}
        aria-invalid={!!erro}
      >
        {children}
      </select>
      <Rodape dica={dica} erro={erro} />
    </label>
  );
}

export function Botao({
  variante = 'solido',
  children,
  className = '',
  ...props
}: {
  variante?: 'solido' | 'primario' | 'vidro' | 'fantasma';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`o-btn o-btn-${variante} ${className}`}>
      {children}
    </button>
  );
}

/** Chave liga/desliga. Rotulada sempre — chave sem rótulo é adivinhação. */
export function Chave({
  rotulo,
  ligada,
  aoMudar,
  desativada,
}: {
  rotulo: string;
  ligada: boolean;
  aoMudar: (v: boolean) => void;
  desativada?: boolean;
}) {
  return (
    <label className="o-chave">
      <input
        type="checkbox"
        checked={ligada}
        disabled={desativada}
        onChange={(e) => aoMudar(e.target.checked)}
      />
      <span className="trilho" />
      <span className="text-sm text-plat-dim">{rotulo}</span>
    </label>
  );
}

/* ───────────────────────────── sinalização ───────────────────────────── */

const TOM_DO_AVISO = { erro: 'err', atencao: 'warn', ok: 'ok', info: 'info' } as const;

/**
 * Aviso.
 *
 * Fala sempre a frase que o servidor devolveu, sem tentar interpretá-la. As
 * recusas de identidade são deliberadamente idênticas entre si — reescrever
 * aqui para "ser mais útil" reabriria a porta que o servidor fechou.
 *
 * `acao` é o botão de uma falha PASSAGEIRA — F17.AUD04. "Não foi possível
 * renovar agora. Tente de novo." pede um lugar onde tentar; sem ele, a pessoa
 * recarrega a página e perde o que a tela segurava. O botão fica à direita da
 * frase, no mesmo desenho da oferta de rascunho da ficha da tarefa.
 */
export function Aviso({
  tipo,
  acao,
  children,
}: {
  tipo: keyof typeof TOM_DO_AVISO;
  acao?: { rotulo: string; aoClicar: () => void };
  children: ReactNode;
}) {
  return (
    // O conteúdo vai dentro de UM filho, e isso não é enfeite: `.o-alerta` é
    // `display: flex`, então cada filho vira item de coluna. Um `<b>` no meio
    // de uma frase virava uma coluna própria, e o texto aparecia embaralhado
    // na tela — foi assim que o aviso da tela de conexões saiu com "é feito
    // por / um único / da BM do Grupo Ideal".
    <div role="alert" className="o-alerta" data-tom={TOM_DO_AVISO[tipo]}>
      {acao ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span>{children}</span>
          <button type="button" className="o-btn o-btn-vidro o-btn-sm shrink-0" onClick={acao.aoClicar}>
            {acao.rotulo}
          </button>
        </div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}

/**
 * A CAIXA DE BUSCA — F03 do plano UX.
 *
 * O NOME NÃO MORA NO `placeholder`. O texto de exemplo some na primeira letra,
 * e com ele sumia a única pista do que a caixa busca ("nas tarefas
 * carregadas" ≠ "em todas"). O rótulo é um `<label>` de verdade, que envolve a
 * caixa — o leitor de tela o lê sempre, preenchida ou não; o olho vê a lupa e
 * o exemplo.
 *
 * LIMPAR: o X aparece com texto, e `Esc` limpa sem tirar o foco (o mesmo gesto
 * da `BarraDeFiltro` do quadro). O X devolve o foco à caixa — senão ele some
 * debaixo do dedo e o foco cai no `<body>`.
 *
 * O RESULTADO não é desta peça: quem sabe quantas achou é a tela. Ela o
 * anuncia com `useAnuncioModerado` (`@/ui/anuncio`), uma vez só quando a
 * digitação assenta.
 */
export function CampoDeBusca({
  rotulo,
  valor,
  aoMudar,
  exemplo,
  className = '',
}: {
  /** O nome da caixa, que diz ONDE se busca. */
  rotulo: string;
  valor: string;
  aoMudar: (texto: string) => void;
  /** O texto cinza de dentro. Por padrão, o próprio rótulo com reticências. */
  exemplo?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`iw-busca ${className}`.trim()} role="search">
      <label htmlFor={id} className="iw-busca-lupa">
        <IconeBusca className="h-4 w-4" />
        <span className="sr-only">{rotulo}</span>
      </label>
      <input
        id={id}
        type="search"
        value={valor}
        placeholder={exemplo ?? `${rotulo}…`}
        autoComplete="off"
        onChange={(e) => aoMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && valor !== '') {
            e.preventDefault();
            aoMudar('');
          }
        }}
      />
      {valor !== '' && (
        <button
          type="button"
          className="iw-busca-limpar"
          aria-label="Limpar busca"
          title="Limpar busca"
          onClick={(e) => {
            aoMudar('');
            (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
          }}
        >
          <IconeFechar className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Pílula de filtro — a aba com contagem.
 *
 * Nasceu no cockpit, para as unidades de negócio. Subiu para cá quando a área
 * Meta precisou da mesma coisa: duas telas com o mesmo gesto têm de ter o mesmo
 * botão, senão o sistema aprende dois vocabulários para uma ideia só.
 *
 * O estado ligado sai de `aria-pressed`, que é o atributo que o leitor de tela
 * já entende — e `.o-btn[aria-pressed='true']` pinta a partir dele. Um
 * `className` condicional daria o mesmo desenho e nenhuma acessibilidade.
 */
export function Pilula({
  ativo,
  aoClicar,
  titulo,
  children,
}: {
  ativo: boolean;
  aoClicar: () => void;
  titulo?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-pressed={ativo}
      onClick={aoClicar}
      className="o-btn o-btn-vidro o-btn-sm"
    >
      {children}
    </button>
  );
}

/** A contagem que acompanha a pílula. Discreta: ela informa, não compete. */
export function Contagem({ children }: { children: ReactNode }) {
  return (
    <span className="tnum ml-1 font-mono text-[0.70rem]">{children}</span>
  );
}

/**
 * A etiqueta do cliente, na cor que veio do banco — F17.37.
 *
 * A cor está no CONTORNO e no ponto, e nunca na letra. O porquê é medido e
 * está em `.o-etiqueta[data-cor]`, em `ui/obsidian.css`: cor escolhida por
 * quem cadastra não passa por régua nenhuma, e as do painel iam de 1,93 a 4,60
 * de contraste como texto. Trocá-las seria mentir sobre o dado; movê-las é só
 * desenhar.
 */
export function Etiqueta({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="o-etiqueta" data-cor style={{ ['--cor-etiqueta' as string]: cor }}>
      <i className="ponto" />
      {children}
    </span>
  );
}

export type Tom = 'neutro' | 'ok' | 'warn' | 'err';

/**
 * Selo — plano, urgência, estado.
 *
 * FUNDO SUAVE E LETRA, E SÓ — F43 Fase 5. Ele chegou a ter contorno colorido,
 * ponto na cor do tom e fundo tingido ao mesmo tempo: três marcas para uma
 * informação, repetidas em cada linha de cada lista. Era metade da "colcha de
 * retalhos" da queixa. Agora o tom pinta o fundo (soft) e a letra; nada mais.
 */
export function Selo({
  tom = 'neutro',
  estilo,
  titulo,
  children,
}: {
  tom?: Tom;
  /**
   * @deprecated O ponto saiu na F43 Fase 5 e a prop não desenha mais nada.
   * Ela continua aceita para as quatro telas que a passam (Checklist, Semanal,
   * Planejamento, Conexões) não mudarem junto — essas telas são reescritas em
   * outras fases do mesmo plano, e a limpeza vai com elas.
   */
  ponto?: boolean;
  /**
   * O que o selo quer dizer, ao parar o ponteiro em cima.
   *
   * Um selo e uma palavra sozinha — "impulsionada", "extra", "vencido" — e
   * palavra sozinha nem sempre diz a consequencia. Aqui cabe a frase que a
   * etiqueta nao comporta.
   */
  titulo?: string;
  /**
   * Cores vindas do banco (o selo do plano) entram por aqui: fundo, letra e
   * contorno. O selo do SISTEMA perdeu o contorno na F43 Fase 5 (era ruído);
   * o do PLANO é escolha da agência no Catálogo, e escolha de quem usa não se
   * apaga em silêncio — pedido do Wesley em 08/10: "não esconder nenhum botão
   * ou função sem querer". O contorno vira uma sombra interna de 1px, para não
   * mudar o tamanho do selo.
   */
  estilo?: Pick<CSSProperties, 'background' | 'color' | 'borderColor'>;
  children: ReactNode;
}) {
  return (
    <span
      className="o-selo"
      data-tom={tom === 'neutro' ? undefined : tom}
      style={
        estilo && {
          background: estilo.background,
          color: estilo.color,
          ...(estilo.borderColor ? { boxShadow: `inset 0 0 0 1px ${String(estilo.borderColor)}` } : {}),
        }
      }
      title={titulo}
    >
      {children}
    </span>
  );
}

/* ───────────────────────────── medidores ───────────────────────────── */

/**
 * Escada de cor do medidor: vermelho → âmbar → "ok", interpolada.
 *
 * F43 Fase 5: as três paradas eram RGB escritos à mão, e a de cima era o
 * `#00ff66` da marca — o anel cheio gritava como botão, não seguia o tema
 * claro e não acompanhou o "ok" quando ele ficou calmo. Agora as paradas são
 * os próprios tokens, e `color-mix` em sRGB é a mesma interpolação linear que
 * a conta à mão fazia.
 */
function corDaEntrega(pct: number): string {
  const v = Math.max(0, Math.min(100, pct));
  const [de, ate, t] = v <= 50 ? ['var(--err)', 'var(--warn)', v / 50] : ['var(--warn)', 'var(--ok)', (v - 50) / 50];
  return `color-mix(in srgb, ${ate} ${Math.round(t * 100)}%, ${de})`;
}

/**
 * Medidor circular do nível de entrega.
 *
 * TRÊS ESTADOS, NÃO DOIS
 *   Mês sem contrato aberto **não tem 0%**. Mostrar zero seria indistinguível
 *   de "nada foi entregue", que é uma acusação em vez de uma informação. Aqui
 *   ele mostra um traço, e a legenda diz por quê.
 *
 * DOIS ANÉIS, NÃO UM
 *   A base vai de 0 a 100 e para. O que passa disso é bônus, e desenha um
 *   segundo anel por cima, na luz das lives (laranja). É como 192% aparece
 *   sem mentir que a base foi além de cheia.
 */
export function Medidor({
  valor,
  tamanho = 76,
  espessura = 6,
  legenda,
}: {
  /** Percentual final (base + bônus). `null` = não mensurável. */
  valor: number | null;
  tamanho?: number;
  espessura?: number;
  legenda?: string;
}) {
  const raio = (tamanho - espessura) / 2;
  const volta = raio * 2 * Math.PI;

  const base = valor === null ? 0 : Math.min(valor, 100);
  const extra = valor === null ? 0 : Math.max(0, valor - 100);
  const cor = corDaEntrega(base);

  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg
        width={tamanho}
        height={tamanho}
        viewBox={`0 0 ${tamanho} ${tamanho}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="transparent"
          stroke="var(--ink-3)"
          strokeWidth={espessura}
        />
        {valor !== null && (
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={raio}
            fill="transparent"
            strokeWidth={espessura}
            strokeDasharray={`${volta} ${volta}`}
            strokeDashoffset={volta - (base / 100) * volta}
            strokeLinecap="round"
            /* A cor vai no `style`, e não no atributo: `color-mix()` é CSS, e
               é o CSS que a lê. O brilho em volta saiu (F43 Fase 5) — ele já
               não pintava nada: `rgb(…)55` não é cor válida, e o navegador
               descartava o filtro inteiro em silêncio. */
            style={{ stroke: cor, transition: 'stroke-dashoffset .5s var(--ease-out)' }}
          />
        )}
        {extra > 0 && (
          <circle
            cx={tamanho / 2}
            cy={tamanho / 2}
            r={raio}
            fill="transparent"
            stroke="var(--luz-lives)"
            strokeWidth={espessura - 1.5}
            strokeDasharray={`${volta} ${volta}`}
            strokeDashoffset={volta - (Math.min(extra, 100) / 100) * volta}
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 6px rgba(255,107,0,.5))' }}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className="tnum font-semibold"
          style={{ color: valor === null ? 'var(--mute)' : 'var(--plat)', fontSize: tamanho / 4.6 }}
        >
          {valor === null ? '—' : `${valor}%`}
        </span>
        {/* A legenda é 12px — F27 (era 10,6px). Numa linha só, "SEM MÊS" em
            12px mede 59px e atravessava o anel de 64 dos dois lados: a largura
            presa em 70% do medidor a quebra em duas palavras curtas, que cabem
            dentro do círculo. */}
        {legenda && (
          <span className="mt-0.5 max-w-[70%] text-center font-mono text-xs uppercase tracking-widest text-mute">
            {legenda}
          </span>
        )}
      </div>
    </div>
  );
}

/** Barra de progresso por tipo de conteúdo. */
export function Barra({
  pct,
  cor = 'var(--luz)',
}: {
  pct: number;
  cor?: string;
}) {
  return (
    <div className="o-barra" style={{ ['--bc' as string]: cor }}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/* ───────────────────────────── métrica ───────────────────────────── */

/** Cartão de número do topo do cockpit. */
export function Metrica({
  rotulo,
  valor,
  detalhe,
  tom,
  children,
}: {
  rotulo: string;
  valor?: ReactNode;
  detalhe?: ReactNode;
  tom?: Tom;
  children?: ReactNode;
}) {
  const cor =
    tom === 'ok' ? 'var(--ok)' : tom === 'warn' ? 'var(--warn)' : tom === 'err' ? 'var(--err)' : 'var(--plat)';

  return (
    <div className="o-card px-4 py-3">
      <div className="eyebrow">{rotulo}</div>
      {valor !== undefined && (
        <div className="tnum mt-1.5 text-2xl font-semibold leading-none" style={{ color: cor }}>
          {valor}
        </div>
      )}
      {/* MONOESPAÇADO SÓ ONDE É DADO QUE SE ALINHA — F17.37.
          Este detalhe era `font-mono text-[0.66rem]`, e o que ele diz é frase:
          "convidados, ainda não entraram", "atribui-se na ficha do cliente",
          "6 sem mês aberto". Mono existe para empilhar algarismos em coluna;
          numa legenda solta ele só afasta as letras e apaga a diferença entre
          `l`, `1` e `I`. O número grande logo acima continua monoespaçado e
          tabular, que é onde o alinhamento vale alguma coisa. */}
      {detalhe && <div className="mt-1.5 text-[0.72rem] leading-snug text-mute">{detalhe}</div>}
      {children}
    </div>
  );
}

/**
 * A comparação com o período anterior.
 *
 * A COR VEM DE FORA, E ISSO NÃO É PREGUIÇA
 *   Quem sabe se subir é bom é a métrica, não este componente: CPC que dobrou é
 *   ruim, ROAS que dobrou é ótimo, e gasto que dobrou não é nem uma coisa nem
 *   outra. Ver `SENTIDO` em `meta/relatorio.ts`.
 *
 *   Se a cor fosse decidida aqui, seria pelo sinal do número — e a tela
 *   parabenizaria quem dobrou o custo por clique.
 *
 * SEM COMPARAÇÃO, NÃO DESENHA NADA
 *   Período sem anterior (o primeiro mês de coleta) não recebe "0%": recebe
 *   silêncio. Zero diria "não mudou", que é afirmação diferente de "não há com
 *   o que comparar".
 */
export function Variacao({
  valor,
  leitura,
}: {
  valor: number | null;
  leitura: 'bom' | 'ruim' | 'neutro' | null;
}) {
  if (valor === null || leitura === null) return null;

  const cor =
    leitura === 'bom' ? 'var(--ok)' : leitura === 'ruim' ? 'var(--err)' : 'var(--mute)';
  const seta = valor > 0 ? '▲' : valor < 0 ? '▼' : '=';

  return (
    <span className="tnum ml-2 text-[0.66rem]" style={{ color: cor }}>
      {seta} {Math.abs(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
    </span>
  );
}
