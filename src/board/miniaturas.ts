/**
 * A MINIATURA DO CARTÃO — a parte que decide, sem React e sem rede. F17.56.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ A REGRA QUE ESTE ARQUIVO EXISTE PARA NÃO DEIXAR CAIR
 *
 *   O cabeçalho de `board/previa-de-link.ts` explica por que a prévia de LINK
 *   não carrega sozinha: um `<img src>` para hospedeiro desconhecido CONTA
 *   ÀQUELE HOSPEDEIRO que alguém abriu a tarefa — endereço de rede, instante,
 *   e o identificador do arquivo. Todo endereço colado numa tarefa viraria
 *   pixel de rastreio, de graça, para terceiro.
 *
 *   A miniatura desta etapa é outra coisa, e é por isso que ela pode carregar
 *   sozinha: o arquivo é NOSSO. Ele está no balde privado `ideworks-anexos`, o
 *   endereço é assinado pelo nosso servidor, expira, e o único servidor que
 *   fica sabendo que alguém abriu o quadro é o nosso — que já sabia, porque
 *   foi ele que serviu o quadro.
 *
 *   ⚠️ OS DOIS CAMINHOS NÃO SE ENCOSTAM, E NÃO PODEM. Este módulo não conhece
 *   `lerLink`, não conhece `IDEWORKS_TRUSTED_IMAGE_HOSTS` e não aceita
 *   endereço nenhum vindo de dado: ele só sabe converter IDENTIFICADOR DE
 *   ANEXO em endereço, pedindo ao nosso servidor. Se um dia alguém fizer o
 *   cartão desenhar `task_links`, a decisão de hospedeiro confiável tem de ser
 *   refeita LÁ, com a lista do dono — e não herdada daqui.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * COMO O PRAZO É RESOLVIDO, E POR QUÊ
 *
 *   O endereço assinado morre em `PRAZO_DA_ASSINATURA` (300 s). Havia três
 *   saídas, e a escolhida é a terceira:
 *
 *     a) PRAZO MAIOR — recusada. O prazo curto é o que separa este balde do
 *        balde público do legado (F17.52). Aumentá-lo por conforto de tela
 *        seria pagar em segurança uma conta de desenho.
 *
 *     b) RENOVAR NUM RELÓGIO — recusada. Um quadro esquecido aberto numa aba
 *        pediria assinatura a cada quatro minutos e meio para sempre, sem
 *        ninguém olhando. Trabalho de servidor para uma tela que ninguém vê.
 *
 *     c) PEDIR SOB DEMANDA, E DE NOVO QUANDO O NAVEGADOR RECLAMAR — escolhida.
 *        A imagem JÁ DESENHADA não quebra quando o endereço vence: o navegador
 *        não vai buscá-la de novo. Quem quebra é o cartão que aparece DEPOIS
 *        — filtro trocado, coluna que carregou mais, aba retomada. Esse pede
 *        endereço na hora em que aparece, e ele nasce fresco.
 *
 *        O caso restante é o `<img>` que já está no DOM com endereço vencido e
 *        que o navegador resolve buscar outra vez (cache descartado). Ele
 *        dispara `error`, e `aoFalhar` marca o id para ser pedido de novo —
 *        UMA vez. Sem esse teto, um objeto que sumiu do balde viraria um laço
 *        de pedidos.
 *
 * ⚠️ ESTE ARQUIVO NÃO FALA COM A REDE. Ele só diz O QUE pedir e O QUE já vale.
 * Quem pede é `board/MiniaturaDoCartao.tsx`. A separação é a mesma de
 * `previa-de-link.ts`: a decisão fica pura, síncrona e testável sem servidor.
 *
 * O BALCÃO E O GANCHO MORAM AQUI, E NÃO NO COMPONENTE
 *   Pela mesma razão de `board/editor-dom.ts`: um arquivo `.tsx` que exporta
 *   coisa que não é componente quebra o recarregamento rápido do Vite
 *   (`react-refresh/only-export-components`). `MiniaturaDoCartao.tsx` ficou só
 *   com os dois provedores, que são componentes de verdade.
 *
 *   `useContext` é leitura, não rede: a promessa deste arquivo — nenhum
 *   `fetch`, nenhuma chave, nenhuma ida à rede — continua inteira.
 */

import { createContext, useCallback, useContext } from 'react';

/** O endereço assinado de um anexo, e a hora em que ele deixa de valer. */
export type Assinatura = { url: string; expiresAt: string };

/** O que já se sabe, por identificador de anexo. */
export type Assinaturas = Readonly<Record<string, Assinatura>>;

/**
 * A MARGEM — quanto antes do vencimento um endereço já conta como vencido.
 *
 * Trinta segundos. Um endereço com dez segundos de vida é tecnicamente válido
 * e praticamente inútil: entre o servidor assinar e o navegador terminar de
 * baixar a arte numa conexão ruim cabe mais que isso. Pedir de novo custa uma
 * linha num lote que já vai sair.
 */
export const MARGEM_DE_VENCIMENTO_MS = 30_000;

/** Se esta assinatura ainda serve para desenhar. */
export function aindaVale(a: Assinatura | undefined, agora: number): boolean {
  if (!a) return false;
  const fim = Date.parse(a.expiresAt);
  if (!Number.isFinite(fim)) return false;
  return fim - MARGEM_DE_VENCIMENTO_MS > agora;
}

/**
 * O QUE PEDIR AGORA: os identificadores desenhados que ainda não têm endereço
 * válido, menos os que já foram pedidos e falharam.
 *
 * ⚠️ `falhados` ENTRA COMO SUBTRAÇÃO, E É O QUE IMPEDE O LAÇO. Um anexo cuja
 * linha existe mas cujo objeto sumiu do balde nunca vai assinar; sem esta
 * subtração, cada `error` do `<img>` geraria um pedido, que geraria outro
 * `error`. O preço é que um erro de rede momentâneo custa a miniatura até a
 * próxima leitura do quadro — e essa é a troca certa: tela sem uma arte é
 * menos ruim que navegador pedindo em laço.
 */
export function aPedir(
  desenhados: readonly string[],
  conhecidas: Assinaturas,
  falhados: ReadonlySet<string>,
  agora: number,
): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const id of desenhados) {
    if (id === '' || vistos.has(id)) continue;
    vistos.add(id);
    if (falhados.has(id)) continue;
    if (aindaVale(conhecidas[id], agora)) continue;
    saida.push(id);
  }
  return saida;
}

/**
 * Esquecer o que não está mais na tela.
 *
 * Sem isto, quem passa uma tarde trocando de lista acumula uma assinatura por
 * cartão que já viu — todas vencidas, todas inúteis, e nenhuma solta. Guardar
 * só o que está desenhado mantém o mapa do tamanho da tela.
 */
export function apenasOsDesenhados(
  conhecidas: Assinaturas,
  desenhados: readonly string[],
): Assinaturas {
  const vivos = new Set(desenhados);
  const saida: Record<string, Assinatura> = {};
  for (const [id, a] of Object.entries(conhecidas)) {
    if (vivos.has(id)) saida[id] = a;
  }
  return saida;
}

/**
 * O TEXTO ALTERNATIVO da miniatura.
 *
 * Ele NÃO diz "miniatura", "prévia" nem "imagem do anexo": quem ouve a tela
 * quer saber DE QUE tarefa é a arte, e o nome do mecanismo não ajuda ninguém a
 * trabalhar. É a mesma régua da F17.37 — a tela não fala sobre si mesma.
 */
export function textoDaMiniatura(tituloDaTarefa: string): string {
  return `Arte de ${tituloDaTarefa}`;
}

/* ────────────────────── o balcão, e quem o consulta ────────────────────── */

/**
 * O que um cartão pode perguntar sobre a própria arte.
 *
 * `aoFalhar` está aqui, e não num efeito do cartão, porque a decisão de não
 * pedir de novo é do CONJUNTO: ver `aPedir`.
 */
export type Balcao = {
  assinaturas: Assinaturas;
  falhados?: ReadonlySet<string>;
  aoFalhar: (id: string) => void;
};

/**
 * ⚠️ ELE NASCE VAZIO, E ISSO É O DESENHO. Cartão desenhado fora de um provedor
 * não quebra: fica sem arte, exatamente como antes desta etapa. Uma tela nova
 * que esqueça o provedor perde a miniatura, e não a tela.
 */
export const ContextoDeMiniaturas = createContext<Balcao>({
  assinaturas: {},
  aoFalhar: () => undefined,
});

/**
 * O endereço da arte de um cartão, se já se sabe qual é.
 *
 * `undefined` enquanto o lote não voltou — e o cartão desenha sem imagem nenhuma
 * nesse meio-tempo, SEM reservar espaço. Reservar faria a coluna inteira pular
 * quando as artes chegassem, e é o oposto da régua desta etapa.
 */
export function useMiniatura(attachmentId: string | null): {
  url: string | undefined;
  indisponivel: boolean;
  aoFalhar: () => void;
} {
  const balcao = useContext(ContextoDeMiniaturas);
  const url = attachmentId === null ? undefined : balcao.assinaturas[attachmentId]?.url;
  const aoFalhar = useCallback(() => {
    if (attachmentId !== null) balcao.aoFalhar(attachmentId);
  }, [attachmentId, balcao]);
  return { url, aoFalhar, indisponivel: attachmentId !== null && (balcao.falhados?.has(attachmentId) ?? false) };
}
