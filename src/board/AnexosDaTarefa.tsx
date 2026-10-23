/**
 * `📎 Anexar arquivo` — e o link externo ao lado. Etapa F17.6.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O LUGAR DELA NA FICHA VEM DA REFERÊNCIA REAL
 *
 *   A ordem das seções na ficha do ClickUp, de cima para baixo:
 *     📝 Adicione os campos ............ campos personalizados (F17.5, não é esta)
 *     ▼  Adicionar subtarefa ........... F17.15, feita
 *     🔗 Vincular itens / dependências . uso zero medido, NÃO ENTRA
 *     ▼  Checklists .................... F17.15, feita
 *     📎 Anexar arquivo ................ ESTA
 *
 *   As duas que continuam de fora NÃO SÃO DESENHADAS. Botão morto é pior que
 *   botão ausente, e há teste que falha se `Adicione os campos` ou
 *   `Vincular itens` aparecerem no HTML.
 *
 * O LINK É COISA PRÓPRIA, E ESTÁ AQUI DE PROPÓSITO
 *   No ClickUp o Dropbox e o Google Docs vivem COLADOS no meio da descrição —
 *   a do Jatobá tem três deles no corpo do texto. O plano os promove a
 *   entidade, e a tela os põe ao lado do anexo porque respondem a mesma
 *   pergunta: "onde está o arquivo desta tarefa?". Um no balde, outro fora.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ O ENVIO PODE ESTAR PENDENTE, E A TELA DIZ ISSO EM VOZ ALTA
 *   O balde `ideworks-anexos` é PRIVADO — sem política permissiva nenhuma —, e
 *   por isso os bytes só passam pela chave de serviço no servidor. Enquanto ela
 *   não existir, o servidor responde 503 com a frase que nomeia a variável.
 *
 *   O NOME DA VARIÁVEL NÃO ESTÁ ESCRITO NESTE ARQUIVO, e é de propósito: ele
 *   chega por `variavelQueFalta`, vindo do servidor. `bundle-secrets.test.ts`
 *   recusa qualquer `IDEWORKS_SERVER_` dentro do pacote do navegador, e a trava
 *   é bruta com razão — nome de variável de servidor é pista, e pista de graça é
 *   o que o legado deu ao pôr credencial no código do cliente.
 *
 *   O botão então fica DESATIVADO e a faixa explica por quê — o mesmo padrão do
 *   ícone de pessoa do checklist vazio na F17.15. Um botão que aparece, aceita
 *   o clique e não faz nada é o que ensina a equipe a desconfiar do sistema.
 *
 *   O link continua funcionando, e a faixa diz isso também: é o caminho que a
 *   agência já usa hoje, e ele não depende de credencial nenhuma.
 *
 * O QUE ESTA TELA NÃO DECIDE
 *   Quem alcança a tarefa, se o endereço pode virar clique, se o arquivo cabe.
 *   Tudo isso está no banco: `can_reach_task_id`, `task_links_url_is_web` e
 *   `task_attachments_size_ceiling`. O que existe aqui é conforto — a pessoa vê
 *   o erro antes de gastar o envio.
 *
 * O TETO É DITO ANTES, E NÃO SÓ NA RECUSA — F17.17
 *   Ele caiu de 25 MiB para **5 MB** por decisão do usuário, e passou a aparecer
 *   no PRÓPRIO botão (`até 5 MB`) e na nota da seção. Antes ele só existia na
 *   frase da recusa: a pessoa descobria o limite DEPOIS de escolher o arquivo.
 *   O número vem de `TETO_DE_BYTES`, que é onde ele mora — a mesma constante que
 *   o servidor, a borda e (por conferência) o balde e o `check` do banco usam.
 *
 * A PRÉVIA DO LINK — F17.17
 *   O link externo virou CARTÃO: selo de tipo, nome do arquivo e quem hospeda,
 *   tudo lido do próprio endereço, sem falar com ninguém. Ver `FichaDeLink`
 *   abaixo, e `board/previa-de-link.ts`.
 *
 * SEGURANÇA DE RENDERIZAÇÃO
 *   Nenhum `dangerouslySetInnerHTML`, nenhum `innerHTML`. O endereço do link é
 *   normalizado por `normalizarEndereco`, que delega a `enderecoSeguro` — a
 *   ÚNICA lista de permissão de esquema do projeto. `javascript:` não vira
 *   `href` nem aqui nem no banco.
 */

import { useEffect, useRef, useState } from 'react';

import {
  type Anexo,
  type Link,
  TETO_DE_BYTES,
  conferirArquivo,
  conferirLink,
  imagem,
  pdf,
  tamanhoLegivel,
} from '@/board/conversa';
import { formatarInstante, type TaskDetail } from '@/board/ficha';
import { ImagemNoTexto } from '@/board/ImagemNoTexto';
import { ProvedorDeMiniaturas } from '@/board/MiniaturaDoCartao';
import { Ajuda, IconeFechar } from '@/board/menus';
import { lerLink } from '@/board/previa-de-link';
import { ApiError, api } from '@/lib/api';
import { IconeClipe } from '@/ui/Icones';
import '@/ui/conversa.css';

/** `5 MB`. Escrito uma vez, usado no rótulo, na nota e na recusa. */
const TETO_ESCRITO = tamanhoLegivel(TETO_DE_BYTES);

/**
 * O `?` DA SEÇÃO — F43, Fase 6.
 *
 * A nota de rodapé ("Cada arquivo vai até 5 MB… vence em 5 minutos") explicava
 * a seção e foi para o `?` ao lado do título, pela regra da F17.24 (*"explica a
 * tela" vira `?`*). O teto continua À VISTA no próprio botão (`até 5 MB`, F17.17)
 * — é ele que evita a escolha inútil, e por isso não saiu de lá. "Balde", que é
 * palavra de quem administra, deu lugar a "os arquivos são privados".
 */
export const SOBRE_DOS_ANEXOS = 'o tamanho e a validade dos arquivos';
export const EXPLICACAO_DOS_ANEXOS = `Cada arquivo vai até ${TETO_ESCRITO} — acima disso, use Guardar link. Os arquivos são privados: cada abertura sai de um endereço que vence em 5 minutos.`;

/** A corrente do link. Também não existe em `menus.tsx` nem em `Icones.tsx`. */
const IconeCorrente = () => (
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
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

/* ───────────────────────────── a ficha de um arquivo ───────────────────────────── */

/**
 * O cartão de um anexo.
 *
 * Imagens aparecem ao abrir a tarefa, inclusive anexos antigos. O provedor
 * busca as URLs privadas em lote; o clique na prévia só amplia a imagem.
 * PDFs mantêm a abertura sob demanda, e o nome permite baixar qualquer arquivo.
 *
 * `<img>` E `<object>`, E NUNCA `<iframe>`.
 *   Os dois desenham o arquivo sem criar um contexto de navegação que possa
 *   tentar navegar a nossa página. E só imagem e PDF chegam aqui — a lista está
 *   em `conversa.ts`, e o download força `Content-Disposition: attachment` para
 *   todo o resto.
 */
export function FichaDeAnexo({
  anexo,
  ocupado,
  aoAbrir,
  aoApagar,
}: {
  anexo: Anexo;
  ocupado: boolean;
  aoAbrir: (a: Anexo, previa: boolean) => void;
  aoApagar: (id: string) => void;
}) {
  const quando = formatarInstante(anexo.createdAt);
  const ehImagem = imagem(anexo.contentType);

  return (
    <div className="a-ficha">
      {ehImagem && <ImagemNoTexto id={anexo.id} alt={anexo.fileName} />}
      <div className="a-topo">
        <span className="a-ext" title={anexo.contentType}>
          {anexo.extension ?? '?'}
        </span>
        {/* `selecionavel` — F17.25. O nome do arquivo é conteúdo: alguém o
            digitou ao enviar, e ele é copiado para o comentário e para a
            conversa do WhatsApp. Ele continua sendo o BOTÃO de baixar — a
            liberação de `@/ui/interacao.css` devolve o cursor de mão ao
            botão que está dentro de uma região selecionável. */}
        <button
          type="button"
          className="a-nome selecionavel"
          title={`Baixar ${anexo.fileName}`}
          disabled={ocupado}
          onClick={() => aoAbrir(anexo, false)}
        >
          {anexo.fileName}
        </button>
        <button
          type="button"
          className="c-acao"
          data-perigo="true"
          aria-label={`Apagar ${anexo.fileName}`}
          title="Apagar o anexo"
          disabled={ocupado}
          onClick={() => aoApagar(anexo.id)}
        >
          <IconeFechar />
        </button>
      </div>

      <div className="a-meta">
        {/* Nome e tamanho SEMPRE, pré-visualização quando der — é o que o plano
            pede, e o tamanho é o que responde "isto é a arte final ou a
            miniatura?" sem abrir nada. */}
        <span className="tnum">{tamanhoLegivel(anexo.byteSize)}</span>
        {anexo.uploadedBy && <span>· {anexo.uploadedBy.name}</span>}
        {quando && <span className="tnum">· {quando}</span>}
        {anexo.expiresAt && <span>· Exclusão em {formatarInstante(anexo.expiresAt)}</span>}
      </div>

      {pdf(anexo.contentType) && (
        <button
          type="button"
          className="c-acao"
          disabled={ocupado}
          onClick={() => aoAbrir(anexo, true)}
        >
          ver aqui
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── a ficha de um link ───────────────────────────── */

/**
 * O cartão de um link externo — F17.17.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU, E POR QUÊ
 *   Antes: `rótulo` + o endereço cru inteiro. O link real do Dropbox tem mais
 *   de cem caracteres de `rlkey` e `dl=0`, e numa tarefa com três entregas isso
 *   é uma parede de texto.
 *
 *   Agora: selo de tipo, nome do arquivo, quem hospeda — tudo lido do PRÓPRIO
 *   endereço por `lerLink`, sem falar com ninguém. O endereço continua visível,
 *   mas como domínio (`www.dropbox.com`), e o inteiro fica no `title` do link.
 *   Rótulo amigável continua não podendo esconder o destino.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A IMAGEM SÓ CARREGA SE ALGUÉM PEDIR, E ISSO É PRIVACIDADE, NÃO PREGUIÇA
 *   Desenhar a miniatura ao abrir a ficha faria o navegador de quem abriu a
 *   tarefa chamar o Dropbox — e isso CONTA AO DROPBOX quem abriu qual tarefa,
 *   quando, e de qual endereço de rede. Os anexos privados da tarefa são
 *   carregados pelo nosso Storage; links externos continuam sob demanda.
 *
 *   Quando a pessoa pede, a requisição sai com `referrerPolicy="no-referrer"`:
 *   o Dropbox recebe o pedido do arquivo, e não o endereço da tela interna de
 *   onde ele partiu.
 *
 * A PRÉVIA NÃO PODE QUEBRAR A TELA
 *   Link morto, privado, ou de hospedeiro que não conhecemos: `lerLink` devolve
 *   um cartão pobre (ou nulo), e a `<img>` que não abre cai no `onError` e vira
 *   uma frase. Em nenhum caminho a seção some ou fica em branco.
 *
 * SEM `dangerouslySetInnerHTML` E SEM `innerHTML`, aqui como no resto do
 * projeto — e vale dobrado, porque o endereço veio de terceiro.
 */
function FichaDeLink({
  link,
  ocupado,
  aoApagar,
}: {
  link: Link;
  ocupado: boolean;
  aoApagar: (id: string) => void;
}) {
  const [mostrando, setMostrando] = useState(false);
  const [quebrada, setQuebrada] = useState(false);
  const previa = lerLink(link.url);

  return (
    <div className="a-link">
      {/* O selo do tipo, na mesma gramática do selo de extensão do anexo — é o
          que a pessoa lê primeiro para saber se aquilo é arte, PDF ou pasta. */}
      <span className="a-ext" title={previa?.tipo ?? 'Link'}>
        {previa?.selo ?? 'link'}
      </span>

      {/* `selecionavel` — F17.25. O RÓTULO e o ENDEREÇO do link são o que mais
          se copia neste sistema: o link do Dropbox é a entrega. Sem esta
          marcação, a regra do `body` (ver `@/ui/interacao.css`) tiraria
          justamente o gesto que a etapa não pode quebrar. */}
      <span className="a-link-corpo selecionavel">
        {/*
          O endereço já veio normalizado pelo banco: `task_links_url_is_web` só
          aceita http e https, então `javascript:` nunca chega a ser um `href`.
          `noreferrer` junto de `noopener` — o endereço de uma tela interna não é
          assunto do Dropbox.
        */}
        <a
          className="a-link-rotulo"
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.url}
        >
          {link.label}
        </a>
        <span className="a-link-meta">
          {previa && (
            <>
              <span>{previa.tipo}</span>
              <span>· {previa.provedorNome}</span>
            </>
          )}
          {/*
            O DESTINO CONTINUA À VISTA. Antes era o endereço inteiro; agora é o
            nome do arquivo quando ele existe, e o domínio quando não existe —
            e o endereço inteiro está no `title` do rótulo e no deste elemento.
          */}
          <span className="a-link-alvo" title={link.url}>
            {previa === null ? link.url : (previa.nome ?? previa.host)}
          </span>
        </span>
      </span>

      {/* O botão só existe quando HÁ imagem para pedir — nada de botão morto. E
          ele some quando a imagem já se recusou a abrir, senão viraria um.

          F17.21: e só quando a imagem vem em TAMANHO ORIGINAL. A que tem teto
          (`carga === 'leve'`) sobe sozinha logo abaixo, e um botão para pedir o
          que já está na tela seria o botão morto que este comentário evita. É a
          mesma regra do cartão do texto — link é link, nos dois lugares. */}
      {previa?.carga === 'original' && !quebrada && (
        <button
          type="button"
          className="c-acao"
          disabled={ocupado}
          onClick={() => setMostrando((v) => !v)}
        >
          {mostrando ? 'esconder' : 'ver imagem'}
        </button>
      )}

      <button
        type="button"
        className="c-acao"
        data-perigo="true"
        aria-label={`Apagar o link ${link.label}`}
        title="Apagar o link"
        disabled={ocupado}
        onClick={() => aoApagar(link.id)}
      >
        <IconeFechar />
      </button>

      {(mostrando || previa?.carga === 'leve') && previa?.miniatura && !quebrada && (
        <img
          className="a-link-previa"
          src={previa.miniatura}
          alt={`Prévia de ${previa.nome ?? link.label}`}
          // `no-referrer`: o Dropbox recebe o pedido do arquivo, e não o
          // endereço da tela de onde ele partiu.
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setQuebrada(true)}
        />
      )}

      {/* F17.21: a frase só aparece para quem PEDIU a imagem. A que sobe
          sozinha e não abre some calada — ninguém a chamou, e uma faixa
          explicando o que não foi pedido é exatamente o que a F17.20 tirou. */}
      {quebrada && mostrando && (
        <span className="a-link-nota">
          A prévia não abriu — o link pode estar privado ou fora do ar. O clique no nome continua
          funcionando.
        </span>
      )}
    </div>
  );
}

/* ───────────────────────────── a seção ───────────────────────────── */

export function AnexosDaTarefa({
  tarefa,
  ocupado,
  envioPronto,
  variavelQueFalta,
  aoAssentar,
  aoErro,
  focar = false,
}: {
  tarefa: TaskDetail;
  ocupado: boolean;
  /**
   * Se a chave de serviço existe no servidor.
   *
   * Vem de `GET /board/tasks/:id`, que responde `storage.ready`. A tela NUNCA
   * recebe a chave — só se ela existe. É o mesmo desenho de `hasToken` em
   * `GET /meta/health`: segredo não sai por rota.
   */
  envioPronto: boolean;
  /** O nome da variável que falta, para a faixa poder dizê-lo sem inventá-lo. */
  variavelQueFalta: string;
  /** A ficha RELIDA que toda escrita devolve. Ver `server/board-anexos.ts`. */
  aoAssentar: (t: TaskDetail) => void;
  aoErro: (mensagem: string) => void;
  /**
   * O foco vai ao título da seção ao montar — F43, Fase 6. A ficha só passa
   * `true` quando a seção acabou de ser pedida pelo "+ Anexo": o botão que a
   * pessoa apertou some da linha, e o foco não pode cair no `<body>`.
   */
  focar?: boolean;
}) {
  const [trabalhando, setTrabalhando] = useState(false);
  const topo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focar) topo.current?.focus();
  }, [focar]);
  const [rotuloDoLink, setRotuloDoLink] = useState('');
  const [alvoDoLink, setAlvoDoLink] = useState('');
  const [errosDoLink, setErrosDoLink] = useState<Record<string, string>>({});
  const [abrindoLink, setAbrindoLink] = useState(false);
  const [previa, setPrevia] = useState<{ id: string; url: string; tipo: string } | null>(null);
  const entradaDeArquivo = useRef<HTMLInputElement>(null);

  const ocupadoAgora = ocupado || trabalhando;

  /**
   * Uma porta só para toda escrita desta seção.
   *
   * A FRASE DO BANCO SAI INTEIRA quando ele recusa — inclusive a de 503 que
   * nomeia a chave de serviço que falta. Trocá-la por "algo deu errado" deixaria
   * a pessoa achando que o sistema está quebrado, quando o que falta é uma
   * credencial que só ela pode providenciar.
   */
  const fazer = async (acao: () => Promise<{ task: unknown }>) => {
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

  const escolherArquivo = (arquivo: File | null) => {
    if (!arquivo) return;

    // O teto é conferido AQUI antes de gastar o envio inteiro. Não substitui
    // `task_attachments_size_ceiling`: o banco continua recusando, porque quem
    // chama a API não é necessariamente esta tela.
    const recusa = conferirArquivo(arquivo.name, arquivo.size);
    if (recusa) {
      aoErro(recusa);
      return;
    }
    void fazer(() => api.enviarAnexo(tarefa.id, arquivo));
    // O campo é limpo para o MESMO arquivo poder ser escolhido de novo: sem
    // isto, tentar de novo depois de um erro não dispararia evento nenhum.
    if (entradaDeArquivo.current) entradaDeArquivo.current.value = '';
  };

  /**
   * Abrir um anexo — sempre por endereço assinado, pedido NO CLIQUE.
   *
   * NÃO EXISTE ENDEREÇO PERMANENTE, e é isso que separa este balde do balde do
   * legado: lá o documento de cliente tem endereço fixo e público, e quem o
   * receber por engano o lê para sempre.
   */
  const abrir = (anexo: Anexo, mostrarAqui: boolean) => {
    void (async () => {
      setTrabalhando(true);
      try {
        const r = await api.enderecoDoAnexo(anexo.id);
        if (mostrarAqui) setPrevia({ id: anexo.id, url: r.url, tipo: r.contentType });
        // `noopener` e `noreferrer`: o endereço da tela interna não é assunto
        // de ninguém, e a aba nova não pode alcançar esta.
        else window.open(r.url, '_blank', 'noopener,noreferrer');
      } catch (e) {
        aoErro(e instanceof ApiError ? e.message : 'Não foi possível abrir o arquivo.');
      } finally {
        setTrabalhando(false);
      }
    })();
  };

  const guardarLink = () => {
    const erros = conferirLink({ label: rotuloDoLink, url: alvoDoLink });
    setErrosDoLink(erros);
    if (Object.keys(erros).length > 0) return;

    void (async () => {
      const deu = await fazer(() =>
        api.guardarLink(tarefa.id, { label: rotuloDoLink, url: alvoDoLink }),
      );
      if (deu) {
        setRotuloDoLink('');
        setAlvoDoLink('');
        setAbrindoLink(false);
      }
    })();
  };

  const anexos = tarefa.attachments.filter((a) => !a.expiresAt);
  const total = anexos.length + tarefa.links.length;

  return (
    <section className="a-secao">
      <div ref={topo} tabIndex={-1} className="c-topo" style={{ border: 0, padding: '0.3rem 0.15rem' }}>
        <IconeClipe />
        <span>Anexar arquivo</span>
        {total > 0 && (
          <span className="c-conta">
            {anexos.length} arquivo(s) · {tarefa.links.length} link(s)
          </span>
        )}
        {/* Só com o envio de pé: desligado, quem explica é o `?` da faixa de
            pendência lá embaixo, e dois `?` para a mesma seção seriam um a mais. */}
        {envioPronto && (
          <Ajuda sobre={SOBRE_DOS_ANEXOS} lado="baixo">
            <p>{EXPLICACAO_DOS_ANEXOS}</p>
          </Ajuda>
        )}
      </div>

      {anexos.length > 0 && (
        <ProvedorDeMiniaturas ids={anexos.filter((a) => imagem(a.contentType)).map((a) => a.id)}>
        <div className="a-grade">
          {anexos.map((a) => (
            <FichaDeAnexo
              key={a.id}
              anexo={a}
              ocupado={ocupadoAgora}
              aoAbrir={abrir}
              aoApagar={(id) => void fazer(() => api.apagarAnexo(id))}
            />
          ))}
        </div>
        </ProvedorDeMiniaturas>
      )}

      {/* A pré-visualização aberta, quando alguém pediu "ver aqui". */}
      {previa !== null && (
        <div className="a-linha-nova" style={{ display: 'block' }}>
          <div className="a-meta" style={{ justifyContent: 'space-between' }}>
            <span>Pré-visualização · o endereço vence em 5 minutos</span>
            <button type="button" className="c-acao" onClick={() => setPrevia(null)}>
              fechar
            </button>
          </div>
          {imagem(previa.tipo) ? (
            <img className="a-previa" src={previa.url} alt="Pré-visualização do anexo" />
          ) : (
            // `object` e não `iframe`: ele não cria contexto de navegação
            // próprio, então a página do PDF não pode tentar navegar a nossa.
            <object className="a-previa-pdf" data={previa.url} type="application/pdf">
              <p className="a-nota">
                Este navegador não desenha PDF aqui. Use <b>Baixar</b> no nome do arquivo.
              </p>
            </object>
          )}
        </div>
      )}

      {/* --- enviar arquivo -------------------------------------------------- */}
      {/*
        `<label for>` com o campo nativo escondido: o `<input type="file">` não
        se estiliza, e este é o único jeito de manter a superfície do OBSIDIAN
        sem tirar o campo do teclado nem do leitor de tela.
      */}
      <div className="a-linha-nova">
        {/*
          NENHUM BOTÃO MORTO. Sem a chave de serviço o envio não pode funcionar,
          e então o que aparece é um botão DESATIVADO com o `title` dizendo por
          quê — o mesmo padrão do ícone de pessoa do checklist vazio na F17.15.
          A alternativa (deixar clicável e responder 503 depois de subir 20 MB)
          é botão morto com o agravante de gastar o envio.
        */}
        {envioPronto ? (
          <>
            <input
              ref={entradaDeArquivo}
              id={`anexo-${tarefa.id}`}
              type="file"
              className="a-arquivo-oculto"
              disabled={ocupadoAgora}
              onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)}
            />
            <label
              htmlFor={`anexo-${tarefa.id}`}
              className="o-btn o-btn-fantasma o-btn-sm"
              style={{ cursor: ocupadoAgora ? 'not-allowed' : 'pointer' }}
            >
              <IconeClipe />
              {/*
                O TETO ESTÁ NO PRÓPRIO BOTÃO — F17.17. Ele estava só na nota do
                rodapé e na frase da recusa, isto é: a pessoa descobria o limite
                DEPOIS de escolher o arquivo. Dizê-lo antes custa cinco
                caracteres e evita a escolha inútil.
              */}
              <span style={{ marginLeft: '0.3rem' }}>Anexar arquivo</span>
              <span className="a-teto">até {TETO_ESCRITO}</span>
            </label>
          </>
        ) : (
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-sm"
            disabled
            /* F07 do plano UX: a dica do botão fala com quem usa a ficha. O
               nome da variável é de quem administra — mora no `?`, rotulado. */
            title="O envio de arquivo ainda não está disponível — use Guardar link"
          >
            <IconeClipe />
            <span style={{ marginLeft: '0.3rem' }}>Anexar arquivo</span>
          </button>
        )}

        {!abrindoLink && (
          <button
            type="button"
            className="o-btn o-btn-fantasma o-btn-sm"
            disabled={ocupadoAgora}
            onClick={() => setAbrindoLink(true)}
          >
            <IconeCorrente />
            <span style={{ marginLeft: '0.3rem' }}>Guardar link</span>
          </button>
        )}
      </div>

      {/* --- o link externo -------------------------------------------------- */}
      {abrindoLink && (
        <div className="a-linha-nova" data-erro={Object.keys(errosDoLink).length > 0}>
          <IconeCorrente />
          <input
            className="a-campo a-campo-rotulo"
            placeholder="Nome do link"
            value={rotuloDoLink}
            disabled={ocupadoAgora}
            onChange={(e) => setRotuloDoLink(e.target.value)}
          />
          <input
            className="a-campo a-campo-alvo"
            placeholder="www.dropbox.com/scl/fo/…"
            value={alvoDoLink}
            disabled={ocupadoAgora}
            onChange={(e) => setAlvoDoLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardarLink();
              if (e.key === 'Escape') setAbrindoLink(false);
            }}
          />
          <span className="p-acoes">
            <button
              type="button"
              className="o-btn o-btn-fantasma o-btn-sm"
              disabled={ocupadoAgora}
              onClick={() => {
                setAbrindoLink(false);
                setErrosDoLink({});
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="o-btn o-btn-primario o-btn-sm"
              disabled={ocupadoAgora}
              onClick={guardarLink}
            >
              Guardar
            </button>
          </span>
        </div>
      )}

      {(errosDoLink.label || errosDoLink.url) && (
        <p className="a-erro">{errosDoLink.label ?? errosDoLink.url}</p>
      )}

      {tarefa.links.length > 0 && (
        <div className="a-links">
          {tarefa.links.map((l: Link) => (
            <FichaDeLink
              key={l.id}
              link={l}
              ocupado={ocupadoAgora}
              aoApagar={(id) => void fazer(() => api.apagarLink(id))}
            />
          ))}
        </div>
      )}

      {/* A NOTA DO ENVIO LIGADO FICOU, ENCURTADA, NA F17.20 — E SAIU DA TELA NA
          F43, Fase 6: foi para o `?` do título (`EXPLICACAO_DOS_ANEXOS`), com as
          mesmas três coisas — o teto, a saída pelo link e o endereço que vence.
          O teto continua escrito no próprio botão. Fica só a faixa do envio
          DESLIGADO, que não explica a tela: avisa que o botão apagado não é
          defeito. */}
      {!envioPronto && (
        /*
          A FAIXA EXISTE PARA O BOTÃO DESATIVADO NÃO PARECER DEFEITO. Quem abre a
          ficha e vê um botão apagado sem explicação conclui que o sistema está
          quebrado; o que falta é uma credencial, e só o usuário pode
          providenciá-la.
        */
        /*
          A FAIXA ENCOLHEU DE SEIS LINHAS PARA DUAS — F17.24.
          O que ficou é o que a pessoa precisa saber agora: o envio não está
          ligado, e há um caminho que funciona. O porquê — o balde privado, a
          comparação com o balde público do sistema legado, a variável que
          falta e onde pegá-la — é matéria de quem vai LIGAR, não de quem quer
          entregar um vídeo. Está tudo no `?`, sem uma palavra a menos.
        */
        <p className="a-pendente a-pendente-curta">
          <span>
            <b>O envio de arquivo ainda não está ligado.</b> <b>Guardar link</b> funciona desde
            já — é o caminho que a equipe já usa hoje.
          </span>
          <Ajuda sobre="por que o envio está desligado" lado="cima">
            <p>
              Enviar arquivo depende de uma configuração do servidor que ainda não foi concluída.
              Até lá, guarde o link do Dropbox ou do Google Drive: ele abre para toda a equipe.
            </p>
            {variavelQueFalta !== '' && (
              <p className="a-para-quem-administra">
                Para quem administra o sistema: falta definir <b>{variavelQueFalta}</b> no
                servidor.
              </p>
            )}
          </Ajuda>
        </p>
      )}
    </section>
  );
}
