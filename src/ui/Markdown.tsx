/**
 * O briefing desenhado — etapa F17.10, com a prévia do link na F17.21.
 *
 * NÃO EXISTE `dangerouslySetInnerHTML` NESTE ARQUIVO, E É O PONTO DELE
 *   O analisador (`src/board/markdown.ts`) devolve uma ÁRVORE, e aqui ela vira
 *   elementos de React. Texto que veio da descrição de uma tarefa nunca é
 *   interpretado como HTML — então não há injeção possível, e não é preciso
 *   confiar em higienizador nenhum.
 *
 *   O preço declarado: `<b>oi</b>` escrito no briefing aparece com os sinais de
 *   maior e menor, como texto. É o comportamento certo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PRÉVIA DO LINK NO TEXTO — F17.21, e a forma dela foi ESCOLHIDA
 *
 *   O usuário abriu uma tarefa real e perguntou por que não via prévia. A
 *   descrição era uma frase com um link no fim, e o link saía sublinhado, sem
 *   cartão: a F17.17 só tinha feito cartão para o link GUARDADO, o que entra
 *   pela seção de anexos. Para quem usa, essa distinção não existe.
 *
 *   ⚠️ **O CARTÃO NÃO SUBSTITUI O LINK, E NÃO ENTRA DENTRO DELE.** Ele é IRMÃO
 *   do parágrafo, desenhado logo abaixo. Três razões, e a primeira manda:
 *
 *     1. **É o que torna `<a>` dentro de `<a>` impossível por FORMA.** O cartão
 *        é clicável, logo tem um `<a>` seu. Se nascesse no lugar do link —
 *        dentro da corrente de `desenharInline` — seria um `<a>` dentro do
 *        `<a>` que a árvore já traz. Como irmão do `<p>`, os dois nunca se
 *        encontram. A F17.6 mordeu esse anzol por outro caminho, e só o HTML
 *        medido revelou.
 *     2. **A frase continua legível.** No caso real o link está no meio de uma
 *        instrução — *"Subir as imagens na medida exata - <link>"*. Trocar o
 *        link pelo cartão partiria a frase no meio.
 *     3. **É o que o Slack e o WhatsApp fazem.** A mensagem fica; o cartão
 *        assenta embaixo. A regra "só quando o link está sozinho na linha" foi
 *        considerada e RECUSADA: ela deixaria de fora justamente a tarefa que
 *        motivou a etapa, onde o link vem depois de um traço.
 *
 *   O TETO DE TRÊS por parágrafo não é gosto: três é o máximo medido num
 *   briefing real da agência. Acima disso o texto vira parede de cartão — que é
 *   o problema que a F17.17 foi resolver, ao contrário.
 *
 *   QUEM ACHA OS LINKS É `markdown.ts`, e nada aqui procura endereço. Ver
 *   `linksDoConteudo`: a prévia se SOMA à regra `URL_SOLTA` que já existia.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A CLASSE VEM DE `tarefa.css` E DE `conversa.css`, E A COR VEM DE TOKEN
 *   Nenhuma cor literal aqui — decisão D10. O que existe de cor nesta tela sai
 *   de `var(--…)` do OBSIDIAN, escrito na folha.
 */

import { ImagemNoTexto } from '@/board/ImagemNoTexto';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
import { imagensDoTexto } from '@/board/imagens-no-texto';
import { Fragment, type ReactNode, useState } from 'react';

import {
  type Block,
  type Inline,
  type ListItem,
  linksDoConteudo,
  parseMarkdown,
} from '@/board/markdown';
import { lerLink } from '@/board/previa-de-link';
import '@/ui/conversa.css';

/** Três é o máximo medido num briefing real. Ver o cabeçalho. */
const TETO_NO_PARAGRAFO = 3;

/** No briefing inteiro cabe mais: ele é muitos parágrafos, não um só. */
export const TETO_NO_TEXTO = 6;

/* ───────────────────────────── o cartão ───────────────────────────── */

/**
 * Um link do texto, virado cartão.
 *
 * ⚠️ UM `<a>` SÓ, E NENHUM BOTÃO DENTRO DELE.
 *   O `<a>` cobre o selo, o nome e a linha de meta — e para aí. O botão de
 *   pedir a imagem, e a própria imagem, são IRMÃOS dele. Botão dentro de link é
 *   o mesmo defeito de estrutura que link dentro de link: HTML inválido, e o
 *   navegador desmancha do jeito dele.
 *
 * A IMAGEM SEGUE A DECISÃO B DO USUÁRIO — ver `previa-de-link.ts`
 *   `carga === 'leve'`     → sobe sozinha (endereço com teto: capa do YouTube,
 *                            miniatura do Drive).
 *   `carga === 'original'` → espera clique (o `raw=1` do Dropbox devolve o
 *                            arquivo inteiro, e ninguém sabe quanto ele pesa).
 *   `miniatura === null`   → não há imagem nem botão. Nada de botão morto.
 *
 * O QUE NÃO QUEBRA A TELA
 *   Link morto, privado ou de hospedeiro que não conhecemos: a `<img>` cai no
 *   `onError` e some. Se ela tinha sido PEDIDA, quem responde é o próprio botão
 *   — a resposta fica no controle que foi apertado, e não numa faixa de aviso
 *   embaixo, que é o que a F17.20 tirou da tela inteira.
 */
function CartaoDeLink({ href }: { href: string }) {
  const [pedida, setPedida] = useState(false);
  const [quebrada, setQuebrada] = useState(false);

  const previa = lerLink(href);
  // `lerLink` recusa o que não é `http`/`https` — e `linksDoConteudo` já não
  // entrega outra coisa. A recusa dupla é de propósito: aqui se escolhe o
  // `src` de uma imagem.
  if (previa === null) return null;

  const nome = previa.nome ?? previa.host;
  // Sem repetir o hospedeiro quando ele já É o nome: `nuvem.exemplo.net` seguido
  // de `Página · nuvem.exemplo.net` diz a mesma coisa duas vezes.
  const meta =
    previa.provedorNome === previa.host ? previa.tipo : `${previa.tipo} · ${previa.provedorNome}`;

  const pedivel = previa.miniatura !== null && previa.carga === 'original';
  const mostrando = previa.carga === 'leve' || pedida;

  return (
    <div className="pv">
      <a className="pv-alvo" href={href} target="_blank" rel="noopener noreferrer" title={href}>
        <span className="pv-selo">{previa.selo}</span>
        <span className="pv-corpo">
          <span className="pv-nome">{nome}</span>
          <span className="pv-meta">{meta}</span>
        </span>
      </a>

      {pedivel && (
        <button
          type="button"
          className="c-acao"
          disabled={quebrada}
          onClick={() => setPedida((v) => !v)}
        >
          {quebrada ? 'não abriu' : pedida ? 'esconder' : 'ver imagem'}
        </button>
      )}

      {mostrando && !quebrada && previa.miniatura !== null && (
        <img
          className="pv-imagem"
          src={previa.miniatura}
          alt={`Prévia de ${nome}`}
          // `no-referrer`: o hospedeiro recebe o pedido do arquivo, e não o
          // endereço da tela interna de onde ele partiu.
          referrerPolicy="no-referrer"
          // A que sobe sozinha só sai da rede quando entra em campo — um
          // briefing com seis cartões não pede seis imagens ao abrir.
          loading="lazy"
          onError={() => setQuebrada(true)}
        />
      )}
    </div>
  );
}

/**
 * Os cartões de um pedaço de texto, na ordem em que os links aparecem.
 *
 * Exportada porque a DESCRIÇÃO usa a mesma peça — lá os cartões ficam embaixo
 * do editor, que é o único lugar possível: dentro de um `contenteditable` eles
 * virariam conteúdo editável, e o próprio editor os leria de volta como texto.
 */
export function PreviasDeLink({
  enderecos,
  teto = TETO_NO_PARAGRAFO,
}: {
  enderecos: readonly string[];
  teto?: number;
}) {
  if (enderecos.length === 0) return null;
  return (
    <div className="pv-pilha">
      {enderecos.slice(0, teto).map((href) => (
        <CartaoDeLink key={href} href={href} />
      ))}
    </div>
  );
}

/* ───────────────────────────── a árvore ───────────────────────────── */

function desenharInline(nos: readonly Inline[]): ReactNode[] {
  return nos.map((no, i) => {
    const chave = `${no.kind}-${i}`;
    switch (no.kind) {
      case 'attachment':
        return <ImagemNoTexto key={chave} id={no.id} alt={no.alt} />;
      case 'mention':
        return <span key={chave} className="mencao">@{no.name}</span>;
      case 'text':
        return <span key={chave}>{no.text}</span>;
      case 'strong':
        return <strong key={chave}>{desenharInline(no.children)}</strong>;
      case 'em':
        return <em key={chave}>{desenharInline(no.children)}</em>;
      case 'del':
        return <del key={chave}>{desenharInline(no.children)}</del>;
      case 'code':
        return (
          <code key={chave} className="md-cod">
            {no.text}
          </code>
        );
      case 'link':
        return (
          // `noreferrer` junto de `noopener`: sem ele o site de destino recebe
          // de onde o clique veio, e o endereço de uma tela interna não é
          // assunto do Dropbox.
          //
          // ⚠️ `no.children` NÃO PODE CONTER OUTRO LINK — `parseInline` o
          // achata em `semLinksDentro` antes de chegar aqui. Sem isso,
          // `[[a](b)](c)` desenhava `<a>` dentro de `<a>`.
          <a key={chave} href={no.href} target="_blank" rel="noopener noreferrer" className="md-elo">
            {desenharInline(no.children)}
          </a>
        );
      default:
        return null;
    }
  });
}

function desenharItens(itens: readonly ListItem[], ordenada: boolean): ReactNode {
  const Marca = ordenada ? 'ol' : 'ul';
  return (
    <Marca className={ordenada ? 'md-ol' : 'md-ul'}>
      {itens.map((item, i) => (
        <li key={i} className={item.checked === null ? undefined : 'md-caixa'}>
          {item.checked !== null && (
            <input
              type="checkbox"
              checked={item.checked}
              // A CAIXA DA DESCRIÇÃO NÃO SE CLICA, e isso é deliberado: ela é
              // TEXTO dentro do briefing, não um estado guardado no banco.
              // Deixá-la clicável faria a marca sumir na primeira recarga —
              // caixinha que esquece é pior que caixinha que não clica.
              // Checklist de verdade é a F17.15.
              readOnly
              disabled
              aria-label={item.checked ? 'item marcado no texto' : 'item não marcado no texto'}
            />
          )}
          <span>{desenharInline(item.content)}</span>
          {item.children.length > 0 && desenharItens(item.children, ordenada)}
        </li>
      ))}
    </Marca>
  );
}

function desenharBloco(b: Block, chave: number): ReactNode {
  switch (b.kind) {
    case 'heading': {
      const Titulo = `h${b.level}` as 'h1';
      return (
        <Titulo key={chave} className={`md-t md-t${b.level}`}>
          {desenharInline(b.content)}
        </Titulo>
      );
    }
    case 'paragraph':
      // O PARÁGRAFO E OS CARTÕES DELE, LADO A LADO NA ÁRVORE — ver o cabeçalho.
      // O `<p>` fecha antes de o primeiro cartão abrir: nenhum `<a>` do cartão
      // nasce dentro do `<a>` do texto, e nenhum `<div>` nasce dentro do `<p>`.
      //
      // Só o PARÁGRAFO ganha cartão. Não o título — ele é linha de hierarquia,
      // e um cartão embaixo o transformaria em seção. Não o item de lista —
      // dez entregas virariam dez cartões, e a lista deixa de ser lista. Não a
      // célula de tabela, que tem largura de coluna.
      //
      // PARÁGRAFO VAZIO É A LINHA EM BRANCO QUE ALGUÉM DEIXOU — ver
      // `parseMarkdown`. Sem o `<br>` o `<p>` fica com altura zero e o espaço
      // some na leitura, que é o defeito que ele veio desfazer.
      if (b.content.length === 0) {
        return (
          <p key={chave} className="md-p">
            <br />
          </p>
        );
      }
      return (
        <Fragment key={chave}>
          <p className="md-p">{desenharInline(b.content)}</p>
          <PreviasDeLink enderecos={linksDoConteudo(b.content)} />
        </Fragment>
      );
    case 'rule':
      return <hr key={chave} className="md-regra" />;
    case 'code':
      return (
        <pre key={chave} className="md-bloco-cod">
          <code>{b.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={chave} className="md-citacao">
          {b.blocks.map((x, i) => desenharBloco(x, i))}
        </blockquote>
      );
    case 'list':
      return <div key={chave}>{desenharItens(b.items, b.ordered)}</div>;
    case 'table':
      return (
        // A tabela rola DENTRO da própria caixa. Briefing real tem tabela de
        // seis colunas, e sem isto a rolagem horizontal vaza para a página.
        <div key={chave} className="md-tab-caixa">
          <table className="md-tab">
            <thead>
              <tr>
                {b.header.map((celula, i) => (
                  <th key={i} style={b.align[i] ? { textAlign: b.align[i] as 'left' } : undefined}>
                    {desenharInline(celula)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((linha, i) => (
                <tr key={i}>
                  {linha.map((celula, k) => (
                    <td
                      key={k}
                      style={b.align[k] ? { textAlign: b.align[k] as 'left' } : undefined}
                    >
                      {desenharInline(celula)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export function Markdown({
  fonte,
  pedirEnderecos,
}: {
  fonte: string;
  /** No chat: assina via `/chat/images/urls` (F20.7). */
  pedirEnderecos?: (
    ids: readonly string[],
  ) => Promise<{ urls: Record<string, { url: string; expiresAt: string }> }>;
}) {
  const blocos = parseMarkdown(fonte);

  if (blocos.length === 0) {
    return <p className="md-p text-mute">Sem descrição.</p>;
  }

  return <ProvedorDeMiniaturas ids={imagensDoTexto(fonte)} pedir={pedirEnderecos}>
    <div className="md">{blocos.map((b, i) => desenharBloco(b, i))}</div>
  </ProvedorDeMiniaturas>;
}
