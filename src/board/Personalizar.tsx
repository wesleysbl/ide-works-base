/**
 * `Personalizar a barra lateral` — etapa F17.18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS QUATRO ABAS SÃO AS DA REFERÊNCIA, E AS QUATRO FAZEM ALGUMA COISA
 *
 *   `Navegação` · `Início` · `Seções` · `Temas`
 *
 *   A regra do projeto — botão morto é pior que botão ausente — vale para aba
 *   também. Nenhuma delas foi desenhada "para ficar igual": cada uma mexe em
 *   algo que muda na tela no instante do clique.
 *
 *   `Início` foi a que quase não entrou. No ClickUp ela configura os CARTÕES da
 *   página inicial — Recentes, Agenda, Lembretes, Comentários atribuídos. Nada
 *   disso existe aqui, e desenhar a lista deles seria prometer quatro telas que
 *   não há.
 *
 *   O que existe, e é uma decisão de INÍCIO de verdade, são duas: por qual tela
 *   o trabalho começa, e qual aba de `Minhas tarefas` abre sozinha. As duas
 *   funcionam. É com elas que a aba ficou.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A COR DO TEMA CUSTA POUCO POR CAUSA DA DECISÃO D10
 *   A paleta do Tailwind foi trocada por ponteiros para tokens, e a cor da
 *   marca mora numa variável só — `--luz`. Trocar o espectro do sistema inteiro
 *   é trocar o valor dela, e é o que `@/ui/cores-do-tema.css` faz. Este painel só
 *   escolhe a chave.
 *
 * ARRASTAR COM O TECLADO TAMBÉM
 *   A referência reordena as seções arrastando. Arrastar é gesto de ponteiro, e
 *   nem todo mundo usa ponteiro — a mesma decisão que o cartão do quadro tomou
 *   na F17.9a. Então a linha também anda com `↑` e `↓` quando está em foco, e o
 *   `aria-label` diz isso.
 *
 * ⚠️ O PAINEL NÃO MORA MAIS ONDE ELE É ABERTO — F17.22, E FOI MEDIDO
 *   Ver o comentário do `createPortal`, no fim do arquivo. Em uma frase: um
 *   painel que cobre a tela inteira não pode ser filho de uma coluna
 *   `position: sticky`, porque sticky prende o `z-index` dele lá dentro.
 */

import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';

import { ABAS, ROTULO_DA_ABA } from '@/board/meu-trabalho';
import { Ajuda, IconeFechar } from '@/board/menus';
import { type ChaveDeCor, CHAVES_DE_COR, ROTULO_DA_COR, amostraDaCor } from '@/ui/cores';
import { useTema } from '@/ui/aparencia';
import { idDaAba } from '@/ui/abas';
import { Abas } from '@/ui/AlternadorDeVista';
import { prenderOTab, useDevolverFoco, useFocoDaJanela } from '@/ui/foco';
import {
  type Aparencia,
  ITENS_DA_BARRA,
  ITENS_SO_ADMIN,
  type Preferencias,
  ROTULO_DA_APARENCIA,
  ROTULO_DA_SECAO,
  ROTULO_DO_ITEM,
  SECOES_DA_BARRA,
  SECAO_DO_ITEM,
  type SecaoDaBarra,
  TELAS_INICIAIS,
  type TelaInicial,
  reordenar,
  secaoDeAdmin,
} from '@/ui/preferencias';
import { type Escolha, ROTULO_DA_ESCOLHA } from '@/ui/tema';

type AbaDoPainel = 'navegacao' | 'inicio' | 'secoes' | 'temas';

const ABAS_DO_PAINEL: { chave: AbaDoPainel; rotulo: string }[] = [
  { chave: 'navegacao', rotulo: 'Navegação' },
  { chave: 'inicio', rotulo: 'Início' },
  { chave: 'secoes', rotulo: 'Seções' },
  { chave: 'temas', rotulo: 'Temas' },
];

/**
 * As três escolhas de tema, na ordem da referência.
 *
 * `Auto` é o `sistema` de `@/ui/tema` — o mesmo estado, com o nome que a
 * referência usa; o título da opção diz por extenso: "Segue o sistema".
 *
 * Desde 2026-09-11 este é o ÚNICO lugar que troca o tema. Havia também um
 * botão flutuante no canto de baixo da tela, e ele saiu: cobria texto das
 * telas, e fazia a mesma coisa que esta fila.
 */
const TEMAS: { escolha: Escolha; rotulo: string }[] = [
  { escolha: 'claro', rotulo: 'Claro' },
  { escolha: 'escuro', rotulo: 'Escuro' },
  { escolha: 'sistema', rotulo: 'Auto' },
];

const ROTULO_DA_TELA: Record<TelaInicial, string> = {
  minhas: 'Minhas tarefas',
  todas: 'Todas as tarefas',
  quadro: 'Quadro',
};

/* ───────────────────────────── peças ───────────────────────────── */

function Caixa({
  marcada,
  rotulo,
  aoMudar,
}: {
  marcada: boolean;
  rotulo: string;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="pz-caixa">
      <input type="checkbox" checked={marcada} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="pz-caixa-texto">{rotulo}</span>
    </label>
  );
}

function Fila<T extends string>({
  valor,
  opcoes,
  rotulo,
  ajuda,
  aoEscolher,
}: {
  valor: T;
  opcoes: { chave: T; rotulo: string; titulo?: string }[];
  rotulo: string;
  /**
   * A explicação da escolha, atrás de um `?` — F17.24.
   *
   * Ela ficava numa frase solta embaixo da fila, e a soma dessas frases era a
   * metade do painel. Aqui ela mora ao lado do rótulo, invisível até alguém
   * perguntar.
   */
  ajuda?: ReactNode;
  aoEscolher: (v: T) => void;
}) {
  return (
    <div className="pz-grupo" role="radiogroup" aria-label={rotulo}>
      <span className="pz-rotulo pz-rotulo-com-ajuda">
        {rotulo}
        {ajuda !== undefined && <Ajuda sobre={rotulo}>{ajuda}</Ajuda>}
      </span>
      <div className="pz-fila">
        {opcoes.map((o) => (
          <button
            key={o.chave}
            type="button"
            role="radio"
            aria-checked={valor === o.chave}
            className="pz-opcao"
            title={o.titulo}
            onClick={() => aoEscolher(o.chave)}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── o painel ───────────────────────────── */

export function Personalizar({
  preferencias,
  aoMudar,
  aoFechar,
  souAdmin = false,
}: {
  preferencias: Preferencias;
  aoMudar: (p: Preferencias) => void;
  aoFechar: () => void;
  /** F40: os itens de administração só aparecem aqui para quem administra. */
  souAdmin?: boolean;
}) {
  const [aba, setAba] = useState<AbaDoPainel>('navegacao');
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [tema, definirTema] = useTema();
  // O foco que faz o `Esc` desta janela existir — F17.33.
  const janela = useFocoDaJanela<HTMLDivElement>();
  // Ao fechar, o foco volta ao item do menu da conta que abriu o painel (ou ao
  // botão que o substituiu) — antes caía no `<body>`.
  useDevolverFoco(true);

  const p = preferencias;
  const mexer = (mudou: Partial<Preferencias>) => aoMudar({ ...p, ...mudou });

  /* AS SEÇÕES QUE ESTE PAINEL MOSTRA — F43, Fase 8. `Gestão` só tem item de
     quem administra; para um funcionário ela nunca aparece na barra, e uma
     linha dela aqui (ou uma caixa vazia com o nome dela) seria o painel
     prometendo o que a barra não vai mostrar. A ordem GUARDADA continua com
     todas — esconder do painel não é tirar da escolha. */
  const doPainel = (secao: SecaoDaBarra) => souAdmin || !secaoDeAdmin(secao);
  const ordemNoPainel = p.ordem.filter(doPainel);

  /* `de` e `para` são posições NA LISTA DO PAINEL, e a troca é feita na ordem
     inteira, pelas posições das mesmas seções lá: a seção escondida do painel
     fica onde estava em relação às outras, sem ninguém tê-la arrastado. */
  const mover = (de: number, para: number) => {
    setArrastando(null);
    const origem = ordemNoPainel[de];
    const destino = ordemNoPainel[para];
    if (origem === undefined || destino === undefined) return;
    mexer({ ordem: reordenar(p.ordem, p.ordem.indexOf(origem), p.ordem.indexOf(destino)) });
  };

  const painel = (
    <div
      className="cu-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        /* ⚠️ `ref` + `tabIndex` — F17.33, e sem os dois o `Esc` abaixo é letra
           morta. Ele foi escrito na F17.22 e nunca funcionou: nada dentro deste
           painel recebe foco ao abrir, e tecla apertada com o foco no `<body>`
           não passa por este elemento. Ver `useFocoDaJanela`. */
        ref={janela}
        tabIndex={-1}
        className="cu-modal pz-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Personalizar a barra lateral"
        onKeyDown={(e) => {
          // `aria-modal`: o `Tab` fica dentro do painel (só as pontas).
          if (e.key === 'Tab') {
            prenderOTab(e, e.currentTarget);
            return;
          }
          if (e.key !== 'Escape') return;
          e.preventDefault();
          aoFechar();
        }}
      >
        <div className="cu-topo">
          {/* F03: abas de verdade — cada uma com o seu painel, foco móvel,
              ←/→ e Home/End (padrão da APG). */}
          <Abas
            rotulo="Personalizar"
            base="pz"
            className="cu-abas"
            classeDaAba="cu-aba"
            valor={aba}
            aoEscolher={setAba}
            idDoPainel={(a) => `pz-painel-${a}`}
            opcoes={ABAS_DO_PAINEL.map((a) => ({ valor: a.chave, rotulo: a.rotulo }))}
          />
          <div className="cu-canto">
            <button type="button" className="cu-icone-btn" aria-label="Fechar" onClick={aoFechar}>
              <IconeFechar />
            </button>
          </div>
        </div>

        {/*
          AS QUATRO ABAS FICAM MONTADAS, E A INATIVA VAI COM `hidden`.
          Duas razões, e as duas valem por si:
            · a lista de seções guarda o estado do arrasto e a rolagem — trocar
              de aba e voltar não recomeça o gesto;
            · `hidden` tira o painel da árvore de acessibilidade E do desenho,
              mas ele CONTINUA no HTML — que é como `tela-do-trabalho.test.ts`
              consegue provar as quatro de uma vez, inclusive a rede contra
              seção que não existe.
        */}
        <div className="pz-corpo">
          {/* ─────────────────────── Navegação ─────────────────────── */}
          <div role="tabpanel" id="pz-painel-navegacao" aria-labelledby={idDaAba('pz', 'navegacao')} hidden={aba !== 'navegacao'}>
              {/* A FRASE ENCOLHEU — F17.24, e virou "?" na F43 Fase 10. Ela
                  dizia primeiro "o que aparece na barra", que é o nome da aba
                  escrito outra vez; o que ficou ("esconder não tira o
                  acesso") é um sossego, não um aviso de perda — e frase fixa
                  de instrução vai para o "?" ao lado do que ela explica, aqui
                  as caixas dos itens. Um clique, e ela está lá inteira. */}
              <div className="pz-aba-cabeca">
                <span>Itens da barra</span>
                <Ajuda sobre="esconder um item da barra">
                  Esconder um item não tira o acesso: a tela continua no endereço dela.
                </Ajuda>
              </div>

              {SECOES_DA_BARRA.filter((s) => s !== 'arvore' && doPainel(s)).map((secao) => (
                <div key={secao} className="pz-grupo">
                  <span className="pz-rotulo">{ROTULO_DA_SECAO[secao]}</span>
                  {ITENS_DA_BARRA.filter(
                    (i) => SECAO_DO_ITEM[i] === secao && (souAdmin || !ITENS_SO_ADMIN.includes(i)),
                  ).map((item) => (
                    <Caixa
                      key={item}
                      marcada={p.itens[item]}
                      rotulo={ROTULO_DO_ITEM[item]}
                      aoMudar={(v) => mexer({ itens: { ...p.itens, [item]: v } })}
                    />
                  ))}
                </div>
              ))}

              <Fila<Aparencia>
                rotulo="Aparência"
                valor={p.aparencia}
                aoEscolher={(v) => mexer({ aparencia: v })}
                opcoes={[
                  {
                    chave: 'icones',
                    rotulo: ROTULO_DA_APARENCIA.icones,
                    titulo:
                      'Os itens de navegação ficam só com o ícone. A árvore continua com nome — nome de lista não tem ícone que o substitua.',
                  },
                  { chave: 'icones-e-rotulos', rotulo: ROTULO_DA_APARENCIA['icones-e-rotulos'] },
                ]}
              />

              {/*
                A LISTA DO QUE NÃO EXISTE NÃO ESTÁ AQUI, E ISSO É DELIBERADO.
                Caixa de entrada, Respostas, Comentários atribuídos, Chat,
                Painéis, Planejador, Quadros brancos, Formulários, Clipes e
                Planilhas de horas aparecem na referência e dependem de etapas
                que não foram feitas. Desenhar a caixa deles daria uma chave que
                liga e desliga o nada.

                ⚠️ AQUI HAVIA UM RODAPÉ DIZENDO ISSO EM PROSA, e ele escapou da
                limpeza da F17.20 — a mesma tagarelice que saiu de doze outros
                lugares. A F17.22 o tirou. O comentário fica: o motivo é para
                quem mexe no código, não para quem escolhe uma caixa.
              */}
          </div>

          {/* ─────────────────────── Início ─────────────────────── */}
          <div role="tabpanel" id="pz-painel-inicio" aria-labelledby={idDaAba('pz', 'inicio')} hidden={aba !== 'inicio'}>
              {/* ⚠️ TRÊS BLOCOS DE TEXTO SAÍRAM DAQUI — F17.24.
                  · "Por onde o trabalho começa." era o nome da aba de novo.
                  · "É para onde Trabalho, no topo da barra, leva." explicava o
                    controle: virou o `?` do `Tela inicial`.
                  · O parágrafo sobre os cartões da página inicial do ClickUp
                    (Recentes, Agenda, Lembretes) explicava por que a aba é
                    curta. Isso é matéria de quem mexe no código, e já está no
                    cabeçalho deste arquivo. */}
              <Fila<TelaInicial>
                rotulo="Tela inicial"
                valor={p.telaInicial}
                aoEscolher={(v) => mexer({ telaInicial: v })}
                opcoes={TELAS_INICIAIS.map((t) => ({ chave: t, rotulo: ROTULO_DA_TELA[t] }))}
                ajuda={
                  <p>
                    {/* F28: o topo era a marca "ide Trabalho" e virou o item `Início`. */}
                    É para onde <b>Início</b>, no topo da barra, leva.
                  </p>
                }
              />

              <Fila
                rotulo="Aba inicial de Minhas tarefas"
                valor={p.abaInicial}
                aoEscolher={(v) => mexer({ abaInicial: v })}
                opcoes={ABAS.map((a) => ({ chave: a, rotulo: ROTULO_DA_ABA[a] }))}
                ajuda={
                  <p>
                    É a aba que abre sozinha quando ninguém escolheu outra no endereço.
                  </p>
                }
              />
          </div>

          {/* ─────────────────────── Seções ─────────────────────── */}
          <div role="tabpanel" id="pz-painel-secoes" aria-labelledby={idDaAba('pz', 'secoes')} hidden={aba !== 'secoes'}>
              {/* AS DUAS FRASES DA ABA VIRARAM UM "?" — F43 Fase 10. "Arraste
                  para trocar a ordem…" ensinava o gesto e "esconder uma seção
                  não apaga nada" sossegava; nenhuma avisa de perda. Juntas, no
                  "?" do topo da lista que elas explicam. Quem usa o teclado
                  continua ouvindo as setas no nome de cada linha. */}
              <div className="pz-aba-cabeca">
                <span>Ordem e seções da barra</span>
                <Ajuda sobre="ordenar e esconder seções">
                  <p>
                    Arraste para trocar a ordem. Com a linha em foco, <b>↑</b> e <b>↓</b> fazem o
                    mesmo.
                  </p>
                  <p>
                    Esconder uma seção não apaga nada — o quadro continua em <b>/quadro</b>.
                  </p>
                </Ajuda>
              </div>

              <ul className="pz-secoes">
                {ordemNoPainel.map((secao, i) => (
                  <li
                    key={secao}
                    className="pz-secao"
                    draggable
                    data-arrastando={arrastando === i}
                    tabIndex={0}
                    aria-label={`${ROTULO_DA_SECAO[secao]}, posição ${i + 1} de ${ordemNoPainel.length}. Use as setas para cima e para baixo para mover.`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(i));
                      e.dataTransfer.effectAllowed = 'move';
                      setArrastando(i);
                    }}
                    onDragEnd={() => setArrastando(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const de = Number(e.dataTransfer.getData('text/plain'));
                      if (Number.isInteger(de)) mover(de, i);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        mover(i, i - 1);
                      }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        mover(i, i + 1);
                      }
                    }}
                  >
                    <span className="pz-pega" aria-hidden>
                      ⠿
                    </span>
                    <span className="pz-secao-nome">{ROTULO_DA_SECAO[secao]}</span>
                    <label className="pz-caixa pz-caixa-fim">
                      <input
                        type="checkbox"
                        checked={p.secoes[secao]}
                        aria-label={`Mostrar a seção ${ROTULO_DA_SECAO[secao]}`}
                        onChange={(e) =>
                          mexer({ secoes: { ...p.secoes, [secao]: e.target.checked } })
                        }
                      />
                      <span className="pz-caixa-texto">Mostrar</span>
                    </label>
                  </li>
                ))}
              </ul>

              {/* "Esconder uma seção não apaga nada…" morava aqui, no fim da
                  lista (F17.24). Desde a F43 Fase 10 ela está no "?" do topo. */}
          </div>

          {/* ─────────────────────── Temas ─────────────────────── */}
          <div role="tabpanel" id="pz-painel-temas" aria-labelledby={idDaAba('pz', 'temas')} hidden={aba !== 'temas'}>
              <Fila<Escolha>
                rotulo="Tema"
                valor={tema}
                aoEscolher={definirTema}
                opcoes={TEMAS.map((t) => ({
                  chave: t.escolha,
                  rotulo: t.rotulo,
                  titulo: ROTULO_DA_ESCOLHA[t.escolha],
                }))}
              />

              <div className="pz-grupo">
                <span className="pz-rotulo">Cor do tema</span>
                <div className="pz-cores" role="radiogroup" aria-label="Cor do tema">
                  {CHAVES_DE_COR.map((cor) => (
                    <button
                      key={cor}
                      type="button"
                      role="radio"
                      aria-checked={p.cor === cor}
                      aria-label={ROTULO_DA_COR[cor]}
                      title={
                        cor === 'ide'
                          ? 'O verde da agência — o padrão do OBSIDIAN'
                          : cor === 'preto'
                            ? 'Monocromático: acompanha a tinta do tema'
                            : ROTULO_DA_COR[cor]
                      }
                      className="pz-cor"
                      /* A amostra aponta para a MESMA variável que a folha
                         define, e não para um hexadecimal copiado. Ver
                         `@/ui/cores`. */
                      style={{ ['--amostra' as string]: amostraDaCor(cor as ChaveDeCor) }}
                      onClick={() => mexer({ cor })}
                    >
                      <span className="pz-amostra" aria-hidden />
                      <span className="pz-cor-nome">{ROTULO_DA_COR[cor]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ⚠️ SAIU — F17.24. O parágrafo explicava a decisão D10 (uma
                  variável só) e a existência de uma versão clara de cada tom.
                  Nada disso muda o que o clique faz: quem escolhe uma cor vê o
                  sistema inteiro trocar de cor na hora, que é a prova. */}
          </div>
        </div>

        <div className="pz-pe">
          {/*
            ONDE ISTO FICA GRAVADO, DITO NA TELA.
            A escolha vive neste navegador. Quem personalizar aqui e abrir em
            outro computador encontra o padrão — e é melhor saber disso pelo
            painel do que descobrir sozinho na segunda-feira.
          */}
          <p className="pz-detalhe">
            Guardado neste navegador. Em outro computador, ou numa janela anônima, a barra volta
            ao padrão.
          </p>
          <button type="button" className="o-btn o-btn-vidro o-btn-sm" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );

  /*
    ⚠️ O PORTAL AQUI NÃO É ARQUITETURA — É O CONSERTO DA F17.22, E FOI MEDIDO.

    Sintoma, na captura do usuário: com o painel aberto, `Zeca Hamburgueria`,
    `Cartão +Vitta`, `Pró-Forma Equipamentos` e `ImPlaCor - Implantes`
    apareciam POR CIMA das caixas de seleção, e o cartão que estava sob o mouse
    flutuava inteiro sobre o painel. Parecia painel transparente; não era.

    Medido em Chrome em 2026-08-27, com `document.elementsFromPoint` no meio de
    um desses nomes, a pilha voltou nesta ordem, de cima para baixo:

      span.truncate.opacity-80 [opacity=0.8] · div.cu-fundo [fixed z=100]

    Um `<span>` sem posição nenhuma acima de um `fixed` de `z-index: 100`. A
    cadeia de ancestrais do painel diz por quê — só UM elo cria contexto de
    empilhamento entre ele e a raiz:

      div.cu-fundo [fixed z=100] → div.bl-barra [STICKY] → div.q-tela → … → html

    `.bl-barra` é `position: sticky` acima de 1024px, e sticky CRIA CONTEXTO DE
    EMPILHAMENTO mesmo com `z-index: auto`. Então o `100` do painel não vale na
    página: vale dentro da barra. E a barra, na camada dos posicionados sem
    `z-index`, é desenhada por ORDEM DE DOCUMENTO — ela vem ANTES do miolo, e
    tudo que no miolo cria contexto próprio passa por cima do painel inteiro:
    o `opacity: 0.8` do nome do cliente no cartão, e o `transform` do
    `.q-cartao:hover`.

    É a mesma FAMÍLIA de causa da F17.19 (sticky empilha), em outro elemento —
    e é por isso que o `z-index: 1` que a F17.19 pôs em `.q-barra.cu-arvore` não
    ajudou aqui: aquele número vive DENTRO desta mesma barra presa.

    POR QUE PORTAL, E NÃO MAIS UM `z-index`
      Um `z-index: 1` em `.bl-barra` consertaria hoje e quebraria de novo no
      primeiro vizinho com `z-index: 1` — e ele já existe: a coluna fixa de
      `.o-tab-fixa` (obsidian.css) usa 1, 2 e 3. Empate se resolve por ordem de
      documento, e a tabela vem depois da barra.

      O painel cobre a tela inteira (`fixed; inset: 0`); ser filho de uma coluna
      é um acidente de onde o botão mora, não uma relação real. No `body` ele
      não depende de ancestral nenhum — nem deste, nem de um `transform` que
      alguém venha a pôr na barra amanhã.

    O GUARDA DO `document` É PELO TESTE, E NÃO POR SSR
      Não há renderização no servidor neste app. Mas `tela-do-trabalho.test.ts`
      monta este painel com `renderToStaticMarkup` em ambiente `node`, onde
      `document` não existe — e é ele quem prova as quatro abas, a D10 e a rede
      contra botão morto. Sem o guarda, o teste estouraria em vez de ler o HTML.
  */
  return typeof document === 'undefined' ? painel : createPortal(painel, document.body);
}
