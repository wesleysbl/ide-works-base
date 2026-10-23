/**
 * A conversa da tarefa — onde o trabalho termina. Etapa F17.6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DESDE A F17.65 ESTE BLOCO NÃO É SÓ CONVERSA: É A LINHA DO TEMPO
 *
 *   *"Preciso que some o histórico em movimentação"* — **e os comentários no
 *   meio, na mesma linha do tempo**. Quem trocou o status, quem tirou o
 *   responsável e quem mudou a tarefa de lista entram AQUI, entre as falas, em
 *   ordem de relógio. Quem os ordena é `montarHistorico`, que é puro e tem
 *   teste; quem desenha a linha que não é fala é `MovimentacaoDaTarefa`.
 *
 *   ⚠️ E NÃO NUM BLOCO PRÓPRIO, que foi o que a F17.41 tinha feito. Medido em
 *   2026-09-03: 1.758 das 1.829 tarefas não têm autor registrado nem evento
 *   nenhum — o livro começou vazio, e passado não se fabrica. Um bloco próprio
 *   ficaria vazio em 96% das fichas, e caixa vazia em toda tarefa parece
 *   defeito. Aqui não há caixa nova: este bloco já existia em toda tarefa, com
 *   o campo de escrever sempre aberto, e a tela não precisa dizer uma palavra
 *   sobre si mesma (F17.37).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O COMENTÁRIO É A ENTREGA, E ISSO MUDA O QUE ESTA TELA PRECISA FAZER
 *
 *   Medido nas tarefas reais da Agência Ide: o designer termina o trabalho
 *   postando o link do Dropbox num comentário. Em `[A] JATOBÁ - NÚMERO ALTO
 *   DE INVESTIDORES` o comentário é, literalmente, o endereço da pasta — sem
 *   colchetes, sem parênteses, sem uma palavra em volta.
 *
 *   Daí duas coisas que não são enfeite:
 *     1. O endereço colado sozinho VIRA CLIQUE. Quem faz isso NÃO é código
 *        desta etapa: é a regra `URL_SOLTA` de `src/board/markdown.ts`, escrita
 *        na F17.10b pela mesma medição. Uma segunda transformação aqui produzia
 *        `<a>` dentro de `<a>` — foi medida e removida. Ver `conversa.ts`.
 *     2. O campo de escrever fica SEMPRE aberto no pé do bloco. Comentar não é
 *        uma ação escondida atrás de um botão: é o gesto mais frequente da
 *        tarefa.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ONDE ELA FICA NA TELA, E POR QUE NÃO É UMA COLUNA
 *
 *   No ClickUp o comentário mora numa COLUNA PRÓPRIA, à direita do briefing.
 *   Aqui ele não mora, e a decisão foi tomada por medição de tela, não por
 *   gosto:
 *
 *     · A ficha do IDE Works é UMA coluna (`cu-ficha` dentro de `PaginaLarga`).
 *       Uma segunda coluna cortaria o briefing pela metade — e o briefing é o
 *       produto: as tarefas reais do Jatobá e da Jordana têm tabela de seis
 *       colunas dentro dele.
 *     · A agência trabalha em laptop de 1366px. Duas colunas ali dariam ~600px
 *       para cada uma, e uma tabela de seis colunas em 600px rola na horizontal.
 *     · O próprio ClickUp COLAPSA a coluna de comentário para baixo do corpo
 *       quando a janela estreita. Então esta posição não é uma invenção: é a
 *       outra forma que a origem já tem.
 *
 *   Fica então um BLOCO PRÓPRIO abaixo do cartão da ficha, com cabeçalho e
 *   contagem — visualmente separado, e não um rodapé perdido depois dos
 *   carimbos.
 *
 *   ⚠️ F43, FASE 6 — A CONVERSA ENTROU NA FICHA, E A DECISÃO ACIMA CONTINUA
 *   VALENDO. Ela não virou coluna: quem foi para o lado foram as PROPRIEDADES
 *   (etapa, responsáveis, prazo…), uma coluna estreita de ~20rem, e só quando
 *   a ficha tem pelo menos 66rem de largura (*container query* em `.cu-ficha`,
 *   ver `tarefa.css`). Medido: a 1366px a ficha tem ~1030px e fica em uma
 *   coluna, como sempre; a 1440px tem ~1100px, e o briefing fica com ~750px —
 *   a tabela de seis colunas cabe. A conversa vem logo depois do conteúdo, na
 *   coluna do trabalho, e por isso sobe para a primeira dobra quando a ficha é
 *   larga. Abaixo da largura, a ordem é a de antes: carimbos, depois conversa.
 *
 *   A frase de rodapé ("Ctrl+Enter envia…") foi para o `?` ao lado do clipe,
 *   pela regra da F17.24: ela explica o campo. Ver `EXPLICACAO_DA_CONVERSA`.
 *
 * NÃO EXISTE EDITOR RICO AQUI, E É DELIBERADO
 *   Comentário não precisa de barra de formatação: precisa de campo que aceita
 *   texto e MOSTRA formatado. Quem desenha é `src/ui/Markdown.tsx` — o
 *   renderizador somente-leitura que ficou sem chamador quando o editor rico
 *   entrou na F17.10b e foi mantido de propósito, para isto.
 *
 * SEGURANÇA DE RENDERIZAÇÃO — e aqui ela vale mais que em qualquer outra tela
 *   Comentário é texto de TERCEIRO. Não existe `dangerouslySetInnerHTML` nem
 *   `innerHTML` em ponto nenhum deste caminho: o analisador devolve uma ÁRVORE
 *   e `Markdown.tsx` a transforma em elementos de React. `javascript:` num link
 *   é recusado nos dois sentidos — por `enderecoSeguro` ao desenhar, e por
 *   `task_links_url_is_web` ao gravar.
 *
 *   `linkarTextoCru` NÃO produz HTML: ela devolve MARKDOWN, que passa pelo
 *   mesmo analisador de sempre. A garantia continua inteira.
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança a tarefa, quem pode editar, e se a resposta cabe. Tudo está no
 *   banco: `can_reach_task_id`, `task_comments_update` (que exige
 *   `author_id = acting_user_id()`) e `task_comments_parent_fk` (que garante UM
 *   nível). `comentario.mine` vem do SERVIDOR, calculado pela mesma fonte da
 *   política — botão de editar que aparece e leva 403 é pior que botão ausente.
 */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  deveAnexar,
  ehTipoQueSeCola,
} from '@/board/colar-imagem';
import {
  type Comentario,
  aninharConversa,
  autorDaFala,
  materialDoComentario,
  conferirComentario,
  paiParaResponder,
  rotuloDeComentarios,
  rotuloDeRespostas,
  execucoesDaResposta,
  seloDeAgente,
  type ExecucaoDoLedger,
} from '@/board/conversa';
import { formatarInstante, type TaskDetail } from '@/board/ficha';
import { montarHistorico } from '@/board/historico';
import { Ajuda, Avatar } from '@/board/menus';
import { MovimentacaoDaTarefa } from '@/board/MovimentacaoDaTarefa';
import { enviarImagens } from '@/board/enviar-imagens';
import { imagemNoTexto, imagensDoTexto, juntarTextoEImagens, textoSemImagens } from '@/board/imagens-no-texto';
import { ImagensDaConversa } from '@/board/ImagensDaConversa';
import { ApiError, api } from '@/lib/api';
import { Markdown } from '@/ui/Markdown';
import { IconeClipe } from '@/ui/Icones';
import { Selo } from '@/ui/primitivos';
import { CampoComMencoes } from '@/board/CamposDeMencao';
import '@/ui/conversa.css';

/** O balão de fala da referência. Não existe em `menus.tsx` nem em `Icones.tsx`. */
const IconeBalaoDeFala = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-3.5 w-3.5"
    aria-hidden="true"
  >
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
  </svg>
);

/* ───────────────────────────── o campo de escrever ───────────────────────────── */

/**
 * O `?` DO CAMPO — F43, Fase 6.
 *
 * Era um parágrafo fixo no pé da conversa, em toda tarefa. Explica o campo
 * (a tecla, como pôr imagem, o prazo da imagem), e pela regra da F17.24 foi
 * para o `?` ao lado do clipe. O prazo da imagem continua também no `title` do
 * próprio clipe ("disponível por 10 dias"), que é onde a escolha acontece.
 */
export const SOBRE_DA_CONVERSA = 'como enviar o comentário';
export const EXPLICACAO_DA_CONVERSA =
  'Ctrl+Enter envia; Enter quebra linha. Arraste uma imagem, cole um print ou use o clipe (PNG/JPEG, até 5 MB). As imagens acompanham o comentário e são excluídas após 10 dias.';

/**
 * A caixa de texto, com a mesma tecla de sempre.
 *
 * `Ctrl/Cmd + Enter` ENVIA, e `Enter` sozinho QUEBRA LINHA. É o inverso de um
 * campo de chat, e é de propósito: o corpo é markdown, e um comentário de
 * entrega tem endereço numa linha e explicação na outra. Enviar no `Enter`
 * tornaria impossível escrever duas linhas sem apertar um botão.
 */
function CampoDeComentario({
  valor,
  aoMudar,
  aoEnviar,
  aoCancelar,
  aoColarImagens,
  ocupado,
  erro,
  dica,
  rotuloDoBotao,
  ajuda,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  aoEnviar: () => void;
  aoCancelar?: () => void;
  /** Recebe arquivos colados, escolhidos ou arrastados; o envio valida tipo e tamanho. */
  aoColarImagens?: (arquivos: File[]) => Promise<string[]>;
  ocupado: boolean;
  erro: string | null;
  dica: string;
  rotuloDoBotao: string;
  /** O `?` do campo, ao lado do clipe. Só o campo do pé da conversa o tem. */
  ajuda?: ReactNode;
}) {
  /**
   * ⚠️ `Ctrl+V` — F17.68. E o caminho normal é NÃO FAZER NADA.
   *
   * Este `onPaste` sai por `return` em todos os casos menos um, e é assim de
   * propósito: colar texto é o gesto de todo dia, e ele não pode passar por
   * lógica nenhuma. Só quando `deveAnexar` diz que a colagem é de imagem — e
   * de imagem SÓ — é que existe um `preventDefault`.
   *
   * A checagem de bytes NÃO acontece aqui: ela é assíncrona (`arrayBuffer`), e
   * `preventDefault` tem que ser síncrono. Por isso a ordem é: decidir pelo
   * `kind`/`type` agora, conferir os bytes depois, e recusar com frase se os
   * bytes desmentirem o rótulo.
   */
  const entradaDeImagem = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const entradasDeArrasto = useRef(0);
  const valorAtual = useRef(valor);
  valorAtual.current = valor;
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const anexar = async (arquivos: File[]) => {
    if (!aoColarImagens || ocupado) return;
    const ids = await aoColarImagens(arquivos);
    if (vivo.current && ids.length) aoMudar(juntarTextoEImagens(
      textoSemImagens(valorAtual.current), [...imagensDoTexto(valorAtual.current), ...ids],
    ));
  };


  const colar = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!aoColarImagens || ocupado) return;
    const dados = e.clipboardData;
    if (!dados) return;

    const itens = Array.from(dados.items ?? []).map((i) => ({ kind: i.kind, type: i.type }));
    if (!deveAnexar(itens)) return;

    const arquivos = Array.from(dados.files ?? []).filter((f) => ehTipoQueSeCola(f.type));
    if (arquivos.length === 0) return;

    e.preventDefault();
    void anexar(arquivos);
  };

  // Durante o arrasto, `files` pode estar vazio; o navegador só libera os
  // arquivos ao soltar. Texto arrastado mantém o comportamento do textarea.
  const arrastaArquivo = (dados: DataTransfer) => Array.from(dados.types).includes('Files');
  const arrastar = (e: React.DragEvent<HTMLDivElement>) => {
    if (!aoColarImagens || !arrastaArquivo(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = ocupado ? 'none' : 'copy';
    if (e.type === 'dragenter') entradasDeArrasto.current += 1;
    setArrastando(!ocupado);
  };
  const soltar = (e: React.DragEvent<HTMLDivElement>) => {
    entradasDeArrasto.current = 0;
    setArrastando(false);
    if (!aoColarImagens || !arrastaArquivo(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const arquivos = Array.from(e.dataTransfer.files);
    if (arquivos.length) void anexar(arquivos);
  };

  return (
    <>
      <div className="c-editor-com-imagens" data-arrastando={arrastando && !ocupado}
        onDragEnter={arrastar} onDragOver={arrastar} onDrop={soltar}
        onDragLeave={() => {
          entradasDeArrasto.current = Math.max(0, entradasDeArrasto.current - 1);
          if (entradasDeArrasto.current === 0) setArrastando(false);
        }}>
      {arrastando && !ocupado && <span className="c-soltar-imagem">Solte as imagens para anexar</span>}
      <CampoComMencoes
        className="c-caixa"
        /* O NOME DO CAMPO — WCAG 4.1.2. A `dica` é o placeholder (um `data-` do
           CSS, que o leitor de tela não lê); sem `aria-label` o campo de
           comentário era anunciado só como "caixa de texto". */
        aria-label={dica}
        data-erro={erro !== null}
        placeholder={dica}
        value={textoSemImagens(valor)}
        rows={2}
        disabled={ocupado}
        aoMudar={(texto) => aoMudar(juntarTextoEImagens(texto, imagensDoTexto(valor)))}
        onPaste={colar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            aoEnviar();
          }
          if (e.key === 'Escape' && aoCancelar) aoCancelar();
        }}
      />
      {imagensDoTexto(valor).length > 0 && (
        <div className="imagens-do-rascunho">
          {imagensDoTexto(valor).map((id) => <div key={id} className="imagem-do-rascunho">
            <Markdown fonte={imagemNoTexto(id)} />
            <button type="button" className="c-acao" disabled={ocupado}
              onClick={() => aoMudar(juntarTextoEImagens(textoSemImagens(valor), imagensDoTexto(valor).filter((x) => x !== id)))}>
              Remover imagem do comentário
            </button>
          </div>)}
        </div>
      )}
      </div>
      <span className="c-pe">
        {(aoColarImagens || ajuda) && (
          <span className="c-pe-icones">
            {aoColarImagens && (
              <>
                <input ref={entradaDeImagem} type="file" accept="image/png,image/jpeg"
                  multiple hidden disabled={ocupado} aria-label="Selecionar imagens para correção"
                  onChange={(e) => {
                    const arquivos = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (arquivos.length) void anexar(arquivos);
                  }} />
                <button type="button" className="o-btn o-btn-fantasma o-btn-icone c-anexar-imagem"
                  aria-label="Anexar imagem"
                  disabled={ocupado} onClick={() => entradaDeImagem.current?.click()}
                  title="Anexar imagem · PNG ou JPEG, até 5 MB · disponível por 10 dias">
                  <IconeClipe />
                </button>
              </>
            )}
            {ajuda}
          </span>
        )}
        <button
          type="button"
          className="o-btn o-btn-primario o-btn-sm"
          disabled={ocupado || valor.trim() === ''}
          onClick={aoEnviar}
        >
          {rotuloDoBotao}
        </button>
        {aoCancelar && (
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-sm"
            disabled={ocupado}
            onClick={aoCancelar}
          >
            Cancelar
          </button>
        )}
      </span>
    </>
  );
}

/* ───────────────────────────── uma fala ───────────────────────────── */

function Fala({
  comentario,
  original,
  ocupado,
  aoResponder,
  aoEditar,
  aoApagar,
  aoColarImagens,
  respondendo,
  aoAbrirResposta,
  execucoes,
}: {
  comentario: Comentario;
  original?: Comentario;
  ocupado: boolean;
  aoResponder: (paiId: string, corpo: string) => Promise<boolean>;
  aoEditar: (id: string, corpo: string) => Promise<boolean>;
  aoApagar: (id: string, respostas: number) => void;
  /**
   * O print colado — F17.68. O MESMO de cima, e não um por fala.
   *
   * O anexo é DA TAREFA, e não do comentário: colar um print respondendo
   * alguém anexa na mesma tarefa que colar no campo de baixo.
   * `task_attachments` não tem coluna de comentário, e inventar uma aqui seria
   * o segundo caminho que a regra 9 proíbe.
   */
  aoColarImagens: (arquivos: File[]) => Promise<string[]>;
  respondendo: string | null;
  aoAbrirResposta: (id: string | null) => void;
  execucoes: readonly ExecucaoDoLedger[];
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(comentario.body);
  const [resposta, setResposta] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const quando = formatarInstante(comentario.createdAt);
  const editado = formatarInstante(comentario.editedAt);
  // F42, Fase 7: autor nulo do cliente vira "Cliente (pelo link)", não "sem perfil".
  const autor = autorDaFala(comentario);
  const doCliente = comentario.fromClient === true;
  const material = materialDoComentario(comentario);
  const selo = doCliente ? null : seloDeAgente(comentario.id, autor.name, execucoes);

  const enviarEdicao = () => {
    const recusa = conferirComentario(rascunho);
    setErro(recusa);
    if (recusa) return;
    void (async () => {
      if (await aoEditar(comentario.id, rascunho)) setEditando(false);
    })();
  };

  const enviarResposta = () => {
    const recusa = conferirComentario(resposta);
    setErro(recusa);
    if (recusa) return;
    void (async () => {
      // Numa resposta, o pai é o comentário original — ver `paiParaResponder`.
      if (await aoResponder(paiParaResponder(comentario), resposta)) {
        setResposta('');
        aoAbrirResposta(null);
      }
    })();
  };

  return (
    <>
    <div
      className="c-fala"
      data-minha={comentario.mine}
      data-do-cliente={doCliente ? 'true' : undefined}
      id={`comentario-${comentario.id}`}
    >
      <Avatar pessoa={autor} mini />

      <div className="c-corpo">
        <div className="c-cabeca">
          <span className="c-autor">{autor.name}</span>
          {/* F42, Fase 7: o que o cliente escreveu no link de aprovação. Ele
              não tem conta: o selo diz de onde veio, e ninguém da equipe edita
              nem apaga (o banco recusa; `mine` vem falso). */}
          {doCliente && (
            <Selo tom="warn" titulo="Escrito pelo cliente no link de aprovação. Ninguém da equipe edita nem apaga.">
              do cliente
            </Selo>
          )}
          {material && (
            <span className="c-quando c-material-do-cliente" data-material-do-cliente>
              {material}
            </span>
          )}
          {selo && (
            <Selo
              tom="neutro"
              titulo={`Comentário do agente ${selo.integration}, em nome de ${selo.person}`}
            >
              {selo.integration} · {selo.person}
            </Selo>
          )}
          {quando && <span className="c-quando">{quando}</span>}
          {/*
            INSTANTE, e não a palavra "editado" sozinha. Num comentário que
            carrega um link de entrega, quem leu ontem precisa saber se o link
            mudou depois — e "editado" não responde isso.
          */}
          {editado && <span className="c-editado">editado {editado}</span>}
        </div>

        {original && (
          <a className="c-citacao" href={`#comentario-${original.id}`}>
            <strong>{original.author || original.fromClient ? autorDaFala(original).name : 'Comentário original'}</strong>
            <span>{original.body}</span>
          </a>
        )}

        {editando ? (
          <div className="c-escrever c-escrever-resposta">
            <CampoDeComentario
              valor={rascunho}
              aoMudar={setRascunho}
              aoEnviar={enviarEdicao}
              aoColarImagens={aoColarImagens}
              aoCancelar={() => {
                setEditando(false);
                setRascunho(comentario.body);
                setErro(null);
              }}
              ocupado={ocupado}
              erro={erro}
              dica="Reescreva o comentário"
              rotuloDoBotao="Salvar"
            />
          </div>
        ) : (
          <div className="c-texto selecionavel">
            {/*
              `selecionavel` — F17.25. O cromo do sistema deixou de se
              selecionar; o comentário é CONTEÚDO, e na Agência Ide ele É a
              entrega — o link do Dropbox chega por aqui e é daqui que ele é
              copiado. Ver a seção 1 de `@/ui/interacao.css`.
            */}
            {/*
              O CORPO VAI CRU, sem passar por transformação nenhuma.

              O endereço colado sozinho vira clique dentro de `markdown.ts`, na
              regra `URL_SOLTA` que a F17.10b escreveu — pela mesma medição que
              motiva esta etapa: "as tarefas reais colam link do Dropbox e do
              Google Docs sem colchete nenhum". Uma segunda transformação aqui
              produzia `<a>` dentro de `<a>`; foi medida e removida.

              F17.21: E O CARTÃO DE PRÉVIA ENTRA POR AQUI DENTRO, pelo mesmo
              caminho. Nada muda nesta linha, e é o ponto: quem desenha o cartão
              é `Markdown.tsx`, embaixo do parágrafo, a partir dos links que
              `URL_SOLTA` já achou. A tentação era escrever a prévia aqui, ao
              lado do texto — seria a segunda transformação de novo, e o mesmo
              `<a>` dentro de `<a>` pela terceira vez.
            */}
            <Markdown fonte={comentario.body} />
          </div>
        )}

        {erro !== null && !editando && <p className="a-erro">{erro}</p>}

        <div className="c-acoes">
          <button
            type="button"
            className="c-acao"
            disabled={ocupado}
            onClick={() => aoAbrirResposta(respondendo === comentario.id ? null : comentario.id)}
          >
            Responder
          </button>

          {comentario.replyCount > 0 && (
            <span className="c-quando">{rotuloDeRespostas(comentario.replyCount)}</span>
          )}

          {/*
            `mine` VEM DO SERVIDOR, calculado pela mesma fonte da política
            (`author_id = acting_user_id()`). A tela não compara ids: se
            comparasse, teria uma segunda versão da regra — e a segunda é a que
            fica para trás na primeira mudança.
          */}
          {comentario.mine && (
            <>
              <button
                type="button"
                className="c-acao"
                disabled={ocupado || editando}
                onClick={() => {
                  setRascunho(comentario.body);
                  setEditando(true);
                }}
              >
                Editar
              </button>
              <button
                type="button"
                className="c-acao"
                data-perigo="true"
                disabled={ocupado}
                onClick={() => aoApagar(comentario.id, comentario.replyCount)}
              >
                Apagar
              </button>
            </>
          )}
        </div>

        {respondendo === comentario.id && (
          <div className="c-escrever c-escrever-resposta">
            <CampoDeComentario
              valor={resposta}
              aoMudar={setResposta}
              aoEnviar={enviarResposta}
              aoColarImagens={aoColarImagens}
              aoCancelar={() => {
                aoAbrirResposta(null);
                setResposta('');
                setErro(null);
              }}
              ocupado={ocupado}
              erro={erro}
              dica={`Responder a ${autor.name}`}
              rotuloDoBotao="Responder"
            />
          </div>
        )}

      </div>
    </div>

        {comentario.replies.length > 0 && (
          <div className="c-respostas">
            {comentario.replies.map((r) => (
              <Fala
                key={r.id}
                comentario={r}
                original={comentario}
                ocupado={ocupado}
                aoResponder={aoResponder}
                aoEditar={aoEditar}
                aoApagar={aoApagar}
                aoColarImagens={aoColarImagens}
                respondendo={respondendo}
                aoAbrirResposta={aoAbrirResposta}
                execucoes={execucoes}
              />
            ))}
          </div>
        )}
    </>
  );
}

/* ───────────────────────────── o bloco ───────────────────────────── */

export function ConversaDaTarefa({
  tarefa,
  ocupado,
  aoAssentar,
  aoErro,
  execucoesIniciais = [],
}: {
  tarefa: TaskDetail;
  ocupado: boolean;
  /** A ficha RELIDA que toda escrita devolve. Ver `server/board-anexos.ts`. */
  aoAssentar: (t: TaskDetail) => void;
  aoErro: (mensagem: string) => void;
  /** Ledger já conhecido — a suíte prova o selo no primeiro quadro, sem efeito. */
  execucoesIniciais?: readonly ExecucaoDoLedger[];
}) {
  const [novo, setNovo] = useState('');
  const { hash } = useLocation();
  useEffect(() => {
    if (!/^#comentario-[0-9a-f-]+$/i.test(hash)) return;
    const destino = document.getElementById(hash.slice(1));
    if (!destino) return;
    destino.dataset.destacado = 'true';
    destino.scrollIntoView({ block: 'center' });
    return () => { delete destino.dataset.destacado; };
  }, [hash, tarefa.id]);
  const [erro, setErro] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [execucoes, setExecucoes] = useState<ExecucaoDoLedger[]>(() => [...execucoesIniciais]);

  useEffect(() => {
    let vivo = true;
    void api
      .execucoesDaIntegracao()
      .then((r) => {
        if (vivo) setExecucoes(execucoesDaResposta(r));
      })
      .catch(() => {
        /* Integração desligada, 401, 503: a conversa segue sem selo. */
      });
    return () => {
      vivo = false;
    };
  }, [tarefa.id]);

  const [enviandoImagens, setEnviandoImagens] = useState(false);
  const envioEmCurso = useRef(false);
  const ocupadoAgora = ocupado || trabalhando || enviandoImagens;

  /**
   * Uma porta só para toda escrita deste bloco.
   *
   * A frase do banco sai INTEIRA quando ele recusa: as travas da F17.6 nomeiam
   * o que está no caminho e o que fazer — "só o autor apaga o próprio
   * comentário", "a conversa tem UM nível" —, e trocá-las por "algo deu errado"
   * jogaria fora o trabalho delas.
   */
  const fazer = async (acao: () => Promise<{ task: unknown }>): Promise<boolean> => {
    setTrabalhando(true);
    try {
      const r = await acao();
      aoAssentar(r.task as TaskDetail);
      return true;
    } catch (e) {
      aoErro(e instanceof ApiError ? e.message : 'O banco recusou a operação.');
      return false;
    } finally {
      setTrabalhando(false);
    }
  };

  const enviar = () => {
    const recusa = conferirComentario(novo);
    setErro(recusa);
    if (recusa) return;
    void (async () => {
      if (await fazer(() => api.comentarTarefa(tarefa.id, novo))) setNovo('');
    })();
  };

  const colarImagens = async (arquivos: File[]): Promise<string[]> => {
    if (ocupadoAgora || envioEmCurso.current) return [];
    envioEmCurso.current = true;
    setEnviandoImagens(true);
    setErro(null);
    try {
      const r = await enviarImagens(tarefa.id, arquivos, aoAssentar);
      if (r.erros.length) setErro(r.erros.join(' '));
      return r.ids;
    } finally {
      envioEmCurso.current = false;
      setEnviandoImagens(false);
    }
  };

  /**
   * Apagar avisa QUANTAS respostas vão junto.
   *
   * `task_comments_parent_fk on delete cascade` leva as respostas — inclusive
   * as DE OUTRAS PESSOAS, porque cascata é ação referencial e não passa por
   * política. Apagar sem dizer isso destruiria a fala de alguém em silêncio.
   */
  const apagar = (id: string, respostas: number) => {
    if (respostas > 0) {
      const certeza = window.confirm(
        `Este comentário tem ${respostas} ${respostas === 1 ? 'resposta' : 'respostas'}, e ${respostas === 1 ? 'ela vai' : 'elas vão'} junto — inclusive de outras pessoas. Apagar mesmo assim?`,
      );
      if (!certeza) return;
    }
    void fazer(() => api.apagarComentario(id));
  };

  // A ÁRVORE É MONTADA AQUI, e o servidor manda achatado. Mesmo desenho de
  // `aninharItens` e de `buildTree`: uma consulta só, e a forma se monta onde
  // tem teste.
  const fio = aninharConversa(tarefa.comments);

  /* DESTINO DE NOTIFICAÇÃO QUE NÃO ESTÁ AQUI — F10. O aviso aponta
     `#comentario-<id>`; a ficha traz todos os comentários, então se o id não
     está entre eles, ele foi apagado. A ficha abre normal e diz isso, sem
     mostrar nada do que foi apagado. */
  const alvoDoAviso = /^#comentario-([0-9a-f-]+)$/i.exec(hash)?.[1] ?? null;
  const comentarioAusente = alvoDoAviso !== null && !tarefa.comments.some((c) => c.id === alvoDoAviso);

  /*
    A LINHA DO TEMPO — F17.65.

    *"E os comentários no meio, na mesma linha do tempo — é isso que torna a
    coluna legível."* O que junta as duas fontes é `montarHistorico`, que é puro
    e tem teste; aqui só se desenha o que ele devolveu, na ordem em que veio.

    ⚠️ ELA ENTRA AQUI DENTRO, E NÃO NUM BLOCO PRÓPRIO. 1.758 das 1.829 tarefas
    não têm histórico nenhum — o livro começou vazio e não se fabrica passado.
    Um bloco próprio ficaria vazio em 96% das fichas, e caixa vazia em toda
    tarefa parece defeito. Aqui não há caixa nova: o bloco da conversa já existe
    em toda tarefa, com o campo de escrever sempre aberto, e a tela não precisa
    dizer uma palavra sobre si mesma (F17.37).
  */
  const linhaDoTempo = montarHistorico({
    criadaPor: tarefa.createdBy?.name ?? null,
    criadaVia: tarefa.createdVia ?? null,
    criadaEm: tarefa.createdAt,
    eventos: tarefa.history,
    falas: fio,
  });

  return (
    <section className="c-bloco">
      <div className="c-topo">
        <IconeBalaoDeFala />
        <span>Comentários e movimentação</span>
        <span className="c-conta">{rotuloDeComentarios(tarefa.progress.commentCount)}</span>
      </div>

      {comentarioAusente && (
        <p className="c-alvo-ausente" role="status" data-alvo-ausente="">
          O comentário desta notificação não está mais nesta tarefa: ele pode ter sido apagado.
        </p>
      )}

      {linhaDoTempo.length > 0 && (
        <div className="c-fio">
          {linhaDoTempo.map((item) =>
            item.tipo === 'comentario' ? (
              <Fala
                key={item.chave}
                comentario={item.fala}
                ocupado={ocupadoAgora}
                aoResponder={(paiId, corpo) =>
                  fazer(() => api.comentarTarefa(tarefa.id, corpo, paiId))
                }
                aoEditar={(id, corpo) => fazer(() => api.editarComentario(id, corpo))}
                aoApagar={apagar}
                aoColarImagens={colarImagens}
                respondendo={respondendo}
                aoAbrirResposta={setRespondendo}
                execucoes={execucoes}
              />
            ) : (
              <MovimentacaoDaTarefa key={item.chave} item={item} />
            ),
          )}
        </div>
      )}

      {/* Os prints ficam junto da conversa e são enviados independentemente do texto. */}
      <ImagensDaConversa tarefa={tarefa} ocupado={ocupadoAgora}
        aoApagar={(id) => fazer(() => api.apagarAnexo(id))} />
      <div className="c-escrever">
        <CampoDeComentario
          valor={novo}
          aoMudar={setNovo}
          aoEnviar={enviar}
          aoColarImagens={colarImagens}
          ocupado={ocupadoAgora}
          erro={erro}
          /* Curta, e ainda falando da entrega de verdade: o link do Dropbox
             colado vira clique (`URL_SOLTA`). A instrução da tecla mora no `?`. */
          dica="Escreva o que foi entregue ou cole o link do Dropbox"
          rotuloDoBotao="Comentar"
          ajuda={
            <Ajuda sobre={SOBRE_DA_CONVERSA} lado="cima-direita">
              <p>{EXPLICACAO_DA_CONVERSA}</p>
            </Ajuda>
          }
        />
      </div>

      {erro !== null && <p className="a-erro">{erro}</p>}
    </section>
  );
}
