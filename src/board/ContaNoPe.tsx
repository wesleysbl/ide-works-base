/**
 * A conta no pé da barra — F29.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELA JUNTA
 *
 *   Até a F28 as configurações moravam em quatro lugares: `Personalizar a barra
 *   lateral` e `Agentes de IA` soltos no pé da barra; Catálogos, Pessoas, Meta
 *   e `Sair` no cabeçalho do Painel — e só nele. Quem estava no quadro e queria
 *   sair precisava ir ao Painel primeiro.
 *
 *   O Wesley mostrou a barra do Claude: a conta no canto de baixo, e tudo o que
 *   é da pessoa (e não da página) num menu que sai dela. É o que este arquivo
 *   desenha, em toda tela que tem barra.
 *
 * ⚠️ O CHIP NUNCA SOME, E ISSO É A TRAVA QUE O PÉ ERA
 *   Ele não é item de seção: não entra em `Personalizar` e não pode ser
 *   escondido. Escondendo as três seções a barra fica vazia — e é o chip que
 *   ainda leva ao `Personalizar` para desfazer. Uma personalização que se tranca
 *   por fora é pior do que não ter personalização.
 *
 *   E ele leva aos `Agentes de IA` pelo motivo da F16.9b: é a tela onde a
 *   pessoa vê o que concedeu a um agente e REVOGA. Uma tela que corta o acesso
 *   de uma IA aos dados da agência não pode depender de ninguém ter deixado um
 *   item ligado.
 *
 * O MENU É O `Balao` DA ÁRVORE, E NÃO UM MENU NOVO
 *   Foco no primeiro item ao abrir, setas e `Home`/`End`, `Esc` e clique fora —
 *   tudo já existe em `@/board/menus`. E ele abre EM PORTAL (`ancora`): a barra
 *   é `position: sticky`, e sticky prende o `z-index` do balão lá dentro — a
 *   armadilha medida duas vezes que o cabeçalho de `Balao` conta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { type Area } from '@/auth/areas';
import {
  dominioDoPonto,
  enderecoDoPonto,
  quemEsta,
  rotuloDaConta,
  temaDeDestino,
} from '@/board/conta';
import { Avatar, Balao, Separador } from '@/board/menus';
import { useTema } from '@/ui/aparencia';
import {
  IconeAds,
  IconeChevron,
  IconeEtiqueta,
  IconePessoas,
  IconeRelogio,
  IconeSair,
  IconeTema,
} from '@/ui/Icones';
import { type Sessao, podeVer, sairDaConta, useSessao } from '@/ui/sessao';
import { type Tema, temaDoSistema, temaEfetivo } from '@/ui/tema';

/* Os dois ícones que eram do pé solto, e que vieram com ele para o menu. */
const traco = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-4 w-4',
  'aria-hidden': true,
};

/* Um plugue: a tomada onde um agente de IA se conecta. */
const IconePlugue = () => (
  <svg {...traco}>
    <path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5" />
  </svg>
);

const IconeEngrenagem = () => (
  <svg {...traco}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
  </svg>
);

/**
 * As três telas de ÁREA, na ordem do menu.
 *
 * ⚠️ SÓ PARA QUEM TEM A ÁREA — `podeVer`, a mesma conta que o cabeçalho do
 * Painel fazia. Não é a permissão, que é do servidor: é para ninguém clicar num
 * item que responde 403. Enquanto a sessão carrega, `podeVer` diz sim: esconder
 * e revelar faz o menu piscar e empurra o item para debaixo do cursor.
 */
const TELAS_DE_AREA: { area: Area; destino: string; rotulo: string; Icone: typeof IconePessoas }[] = [
  { area: 'pessoas', destino: '/pessoas', rotulo: 'Pessoas', Icone: IconePessoas },
  { area: 'catalogos', destino: '/catalogos', rotulo: 'Catálogos', Icone: IconeEtiqueta },
  { area: 'meta', destino: '/meta', rotulo: 'Meta', Icone: IconeAds },
];

/* ───────────────────────────── o menu ───────────────────────────── */

/**
 * O menu, sem estado próprio — quem abre, fecha e sai é o chip.
 *
 * Exportado para a suíte desenhá-lo ABERTO: o chip começa fechado, e o
 * `renderToStaticMarkup` não clica em nada.
 */
export function MenuDaConta({
  sessao,
  ancora,
  temaAtual,
  saindo,
  aoFechar,
  aoPersonalizar,
  aoMudarTema,
  aoSair,
}: {
  sessao: Sessao | null;
  /** O chip. Nulo nos testes, e o balão desenha no lugar. */
  ancora: HTMLElement | null;
  temaAtual: Tema;
  saindo: boolean;
  aoFechar: () => void;
  aoPersonalizar: () => void;
  aoMudarTema: (t: Tema) => void;
  aoSair: () => void;
}) {
  const destino = temaDeDestino(temaAtual);
  const telas = TELAS_DE_AREA.filter((t) => podeVer(sessao, t.area));
  const ponto = enderecoDoPonto();

  /* `role="menuitem"`, e não o `menuitemcheckbox` de `ItemDeMenu`: nenhum item
     daqui é marcado ou desmarcado — são destinos e gestos. Um leitor de tela
     anunciaria "não marcado" em `Sair`. A classe e o `data-item` são os de
     `ItemDeMenu`: o mesmo desenho e as mesmas setas do `Balao`. */
  const link = (para: string, rotulo: string, icone: JSX.Element) => (
    <Link key={para} to={para} role="menuitem" data-item="1" className="cu-item" onClick={aoFechar}>
      {icone}
      {rotulo}
    </Link>
  );

  return (
    <Balao lado="cima" aoFechar={aoFechar} ancora={ancora} className="bl-conta-menu" nome="Conta e configurações">
      <button
        type="button"
        role="menuitem"
        data-item="1"
        className="cu-item"
        onClick={() => {
          aoFechar();
          aoPersonalizar();
        }}
      >
        <IconeEngrenagem />
        Personalizar a barra lateral
      </button>
      {/* O TEMA ALTERNA, E O RÓTULO DIZ PARA ONDE — o mesmo `useTema` da aba
          `Temas` do `Personalizar`, que continua sendo onde se escolhe `Auto`.
          O menu NÃO fecha aqui: o clique muda a tela inteira na hora, e quem
          quis só ver pode voltar no mesmo lugar. */}
      <button
        type="button"
        role="menuitem"
        data-item="1"
        className="cu-item"
        onClick={() => aoMudarTema(destino)}
      >
        <IconeTema />
        {destino === 'claro' ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      </button>
      {link('/conexoes', 'Agentes de IA', <IconePlugue />)}

      {telas.length > 0 && <Separador />}
      {telas.map((t) => link(t.destino, t.rotulo, <t.Icone />))}

      {/* O PONTO — F30. Um `<a>` de verdade, e não o `Link` do roteador: o
          destino é OUTRO sistema (`enderecoDoPonto()`), e o roteador trataria
          o endereço como rota daqui. Abre em aba nova para o IdeWorks ficar
          onde estava; `noopener` corta o `window.opener` que a aba nova
          ganharia, e `noreferrer` não manda o endereço da tela junto.

          O domínio vai miúdo embaixo, e no nome acessível: quem clica sabe
          que sai do sistema antes de sair. Fica antes do fio do `Sair` —
          é gesto do dia a dia, e não configuração. Sem
          `INSTALACAO.enderecoDoPonto`, o item não existe. */}
      {ponto && (
        <a
          href={ponto}
          target="_blank"
          rel="noopener noreferrer"
          role="menuitem"
          data-item="1"
          className="cu-item"
          aria-label={`Já bateu seu ponto hoje? Abre ${dominioDoPonto(ponto)} em outra aba`}
          onClick={aoFechar}
        >
          <IconeRelogio />
          <span className="bl-conta-ponto">
            Já bateu seu ponto hoje?
            <span className="bl-conta-ponto-dominio">{dominioDoPonto(ponto)}</span>
          </span>
        </a>
      )}

      <Separador />
      <button
        type="button"
        role="menuitem"
        data-item="1"
        className="cu-item"
        disabled={saindo}
        onClick={aoSair}
      >
        <IconeSair />
        {saindo ? 'Saindo…' : 'Sair'}
      </button>
    </Balao>
  );
}

/* ───────────────────────────── o chip ───────────────────────────── */

/**
 * O que vai DENTRO do chip: o rosto, o nome e o papel — F29.
 *
 * Separado do botão para a suíte desenhá-lo com uma sessão pronta: o chip lê a
 * sessão por `useSessao`, e o `renderToStaticMarkup` não espera consulta.
 */
export function RostoDaConta({
  sessao,
  carregando,
  soIcones,
}: {
  sessao: Sessao | null;
  carregando: boolean;
  soIcones: boolean;
}) {
  const { nome, papel } = quemEsta(sessao);
  return (
    <>
      {/* ENQUANTO A SESSÃO CARREGA, UM CÍRCULO SEM LETRA — e não "??", nem o
          chip ausente. O chip nasce no tamanho final: nada pula quando a
          resposta chega, e o menu já abre (a sessão nula mostra tudo, como
          `podeVer` manda). As iniciais saem do NOME quando há (F29), senão do
          e-mail — a mesma regra dos cartões. */}
      {sessao === null ? (
        <span className="cu-avatar" aria-hidden />
      ) : (
        <Avatar pessoa={{ id: sessao.userId, name: nome }} decorativo />
      )}
      {!soIcones && (
        <>
          <span className="bl-conta-texto">
            <span className="bl-conta-nome">{carregando ? 'Sua conta' : nome}</span>
            {papel !== null && <span className="bl-conta-papel">{papel}</span>}
          </span>
          {/* F29: a mesma seta SVG dos títulos de seção — o `▾` de texto
              lia-se como um ponto. Para baixo fechado, para cima aberto (o
              menu sobe); quem gira é a folha, pelo `aria-expanded`. */}
          <IconeChevron className="bl-conta-seta" />
        </>
      )}
    </>
  );
}

export function ContaNoPe({
  soIcones,
  aoPersonalizar,
}: {
  /** A aparência DESENHADA pela barra (a gaveta é sempre expandida). */
  soIcones: boolean;
  aoPersonalizar: () => void;
}) {
  const { sessao, carregando } = useSessao();
  const [escolha, definirTema] = useTema();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);
  /* `ref={setChip}` e não `useRef`: o balão precisa REDESENHAR quando a âncora
     chega — o mesmo padrão do `···` da árvore (`AcaoDaLinha`). */
  const [chip, setChip] = useState<HTMLButtonElement | null>(null);

  /* O nome acessível diz nome, e-mail e papel em qualquer aparência — ver
     `rotuloDaConta`. */
  const rotulo = rotuloDaConta(sessao, carregando);

  /* Fechar DEVOLVE O FOCO AO CHIP — `Esc` dentro do balão cairia no `<body>`,
     e quem navega pelo teclado recomeçaria da primeira parada da página. */
  const fechar = () => {
    setAberto(false);
    chip?.focus();
  };

  return (
    <>
      <button
        ref={setChip}
        type="button"
        className="bl-conta"
        aria-label={rotulo}
        title={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <RostoDaConta sessao={sessao} carregando={carregando} soIcones={soIcones} />
      </button>

      {aberto && (
        <MenuDaConta
          sessao={sessao}
          ancora={chip}
          temaAtual={temaEfetivo(escolha, temaDoSistema())}
          saindo={saindo}
          aoFechar={fechar}
          aoPersonalizar={aoPersonalizar}
          aoMudarTema={definirTema}
          aoSair={() => {
            setSaindo(true);
            void sairDaConta();
          }}
        />
      )}
    </>
  );
}
