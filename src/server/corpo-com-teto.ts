/**
 * Ler o corpo de um pedido SEM deixar o excesso entrar na memória — revisão de
 * segurança de 09/10/2026. Vale para o envio de arquivo (`lerFormularioComTeto`) e
 * para o JSON da API (`lerTextoComTeto`, que também atende a rota pública da
 * aprovação).
 *
 * O DEFEITO QUE ISTO FECHA
 *   (JSON) `request.json()` e `request.text()` puxavam o corpo INTEIRO antes de a
 *   rota olhar o que era — inclusive em `/auth/login` e na aprovação do cliente,
 *   que não pedem sessão. O teto que a aprovação declarava (8 KiB) só valia para
 *   quem mandava `Content-Length`; em "chunked" o Worker lia tudo e só então
 *   contava. Quem não tem sessão não ganha a memória do Worker.
 *
 *   (arquivo) As rotas de arquivo (anexo da tarefa, imagem do chat) diziam conferir o teto
 *   "antes de ler o corpo", mas conferiam `arquivo.size` — que só existe DEPOIS de
 *   `request.formData()` ter montado o envio inteiro. Qualquer pessoa com sessão
 *   mandava 100 MB para `POST /board/tasks/:id/attachments` e o Worker (128 MB de
 *   memória, e o isolado serve outras pessoas ao mesmo tempo) os carregava antes
 *   de dizer "grande demais". O teto de verdade era o da plataforma.
 *
 * O QUE FAZ
 *   1. `Content-Length` declarado acima do teto: recusa sem ler um byte.
 *   2. Sem o cabeçalho (corpo em pedaços), ou com ele mentindo para menos: lê
 *      pedaço a pedaço, conta, e DESISTE no teto — o resto nunca é puxado.
 *   3. Dentro do teto: monta o `FormData` do que foi lido, igual a antes.
 *
 * O TETO DO CORPO É O DO ARQUIVO MAIS UMA MARGEM PARA O ENVELOPE (fronteiras e
 * campos de texto). O teto do arquivo em si continua sendo conferido por quem
 * chama, com a frase que diz o tamanho recebido.
 */

/** Fronteiras, nomes de campo e os poucos campos de texto do envio. */
export const MARGEM_DO_ENVELOPE = 256 * 1024;

export type FormularioLido =
  | { grande: true }
  | { grande: false; forma: FormData | null };

/** O corpo passou do teto — de longe, pelo `Content-Length`, ou de perto, contando o que chegou. */
export class CorpoGrandeDemais extends Error {
  constructor() {
    super('Pedido grande demais.');
    this.name = 'CorpoGrandeDemais';
  }
}

/** Corpo de um pedido JSON da API humana: o maior legítimo (texto de ficha, lista de etapas) cabe folgado. */
export const TETO_DO_JSON = 2 * 1024 * 1024;

/**
 * Antes de haver sessão (login, ativação, redefinição) o corpo são três campos de
 * texto. Quem fala sem crachá não ganha 2 MB de memória do Worker.
 */
export const TETO_DO_JSON_ANTES_DA_SESSAO = 16 * 1024;

/** O teto do corpo JSON deste caminho da API (o que vem depois de `/api`, ou inteiro). */
export function tetoDoJson(pathname: string): number {
  return /^\/api\/auth\//.test(pathname) ? TETO_DO_JSON_ANTES_DA_SESSAO : TETO_DO_JSON;
}

/** Envio de arquivo: tem o teto próprio de `lerFormularioComTeto`. */
export const ehEnvioDeArquivo = (request: Request): boolean =>
  (request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('multipart/form-data');

/** O `Content-Length` declarado já passa do teto? Sem o cabeçalho, ou ilegível, não se sabe: falso. */
export function declaraCorpoMaiorQue(request: Request, teto: number): boolean {
  const declarado = request.headers.get('Content-Length');
  if (declarado === null) return false;
  const n = Number(declarado);
  return Number.isFinite(n) && n > teto;
}

/**
 * Lê o corpo pedaço a pedaço e DESISTE no teto — o resto nunca é puxado para a
 * memória. `null` quando passou. Sem corpo, vazio.
 */
async function lerBytesComTeto(
  request: Request,
  limite: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (declaraCorpoMaiorQue(request, limite)) return null;
  if (request.body === null) return new Uint8Array(0);

  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    pedacos.push(value);
  }

  const bytes = new Uint8Array(total);
  let ponta = 0;
  for (const p of pedacos) {
    bytes.set(p, ponta);
    ponta += p.byteLength;
  }
  return bytes;
}

/** O corpo como texto, até o teto. Passou do teto: lança `CorpoGrandeDemais`. */
export async function lerTextoComTeto(request: Request, teto: number): Promise<string> {
  const bytes = await lerBytesComTeto(request, teto);
  if (bytes === null) throw new CorpoGrandeDemais();
  return new TextDecoder().decode(bytes);
}

export async function lerFormularioComTeto(
  request: Request,
  tetoDoArquivo: number,
): Promise<FormularioLido> {
  const bytes = await lerBytesComTeto(request, tetoDoArquivo + MARGEM_DO_ENVELOPE);
  if (bytes === null) return { grande: true };
  if (request.body === null) return { grande: false, forma: null };

  try {
    const forma = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('Content-Type') ?? '' },
    }).formData();
    return { grande: false, forma };
  } catch {
    return { grande: false, forma: null };
  }
}
