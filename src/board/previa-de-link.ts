/**
 * A PRÉVIA DO LINK EXTERNO — etapa F17.17, ampliada na F17.21.
 *
 * ⚠️ O QUE A F17.21 ACRESCENTOU, E É A DECISÃO QUE MAIS PESA AQUI
 *
 *   `carga` — o TAMANHO que a miniatura vai trazer, dito pelo próprio endereço
 *   que nós montamos. O usuário escolheu a opção B: *a imagem carrega sozinha
 *   quando o arquivo é pequeno, e espera clique quando é grande.*
 *
 *   O endereço NÃO diz quantos bytes o arquivo tem — nunca disse e não vai
 *   dizer. Perguntar antes (um `HEAD`) custaria uma requisição que já conta ao
 *   hospedeiro quem abriu a tarefa, e ainda assim não responderia: a política
 *   de origem cruzada esconde o cabeçalho de quem não a libera. Baixar com
 *   limite e abortar também não serve: `<img>` não se aborta no meio, e ler os
 *   bytes por `fetch` esbarra na mesma política.
 *
 *   Então a pergunta muda de lugar. **Não é "quanto pesa o arquivo", é "o
 *   endereço que EU montei tem teto de tamanho".** E essa nós sabemos sempre:
 *
 *     · `leve`     — montado por nós COM teto. A capa do YouTube é 480×360
 *                    fixos; a miniatura do Drive vem com `sz=w640`. Dezenas de
 *                    quilobytes, não dezenas de megabytes. Carrega sozinha.
 *     · `original` — o endereço devolve o ARQUIVO INTEIRO. É o `raw=1` do
 *                    Dropbox: um PNG de 20 MB baixa 20 MB para virar um
 *                    quadradinho. Espera clique.
 *     · `null`     — não há miniatura possível. Nem imagem, nem botão.
 *
 *   **O custo, escrito para ninguém se surpreender:** o desconhecido é tratado
 *   como grande, e o Dropbox cai inteiro nele. A imagem do Dropbox continua
 *   pedindo um clique. O que passou a subir sozinho é a capa do YouTube e a
 *   miniatura do Drive — as duas com teto, as duas por construção.
 *
 *   **E há um preço de privacidade, que a F17.17 não pagava:** uma imagem que
 *   sobe sozinha conta ao hospedeiro que alguém abriu a tarefa. Ele fica com o
 *   endereço de rede e o id do vídeo ou do arquivo — nunca o endereço da tela,
 *   porque a tela pede com `no-referrer` e só quando o cartão entra em campo.
 *   Foi a troca que a decisão B escolheu, de olho aberto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE ELA RESOLVE
 *
 *   Até aqui o link guardado aparecia como `rótulo + endereço cru`, e o
 *   endereço do Dropbox real tem mais de cem caracteres de `rlkey` e `dl=0`.
 *   Numa tarefa com três entregas isso é uma parede de texto que ninguém lê.
 *
 *   O que a equipe precisa saber antes de clicar é sempre a mesma coisa:
 *   **o que é** (imagem, PDF, pasta, vídeo), **como se chama**, e **onde está**
 *   (Dropbox, Google). As três respostas já estão DENTRO do endereço.
 *
 * ⚠️ ESTE ARQUIVO NÃO FALA COM NINGUÉM, E É A DECISÃO CENTRAL DELE
 *
 *   Buscar metadados de link exigiria chamar o Dropbox a partir do navegador
 *   de quem abriu a tarefa — e isso CONTA AO DROPBOX quem abriu qual tarefa,
 *   quando, e de qual endereço de rede. Um sistema interno não entrega esse
 *   registro de graça a terceiro.
 *
 *   Então tudo aqui é leitura do PRÓPRIO ENDEREÇO. Nenhum `fetch`, nenhuma
 *   chave, nenhuma ida à rede. A função é pura, síncrona e testável sem
 *   servidor — e por isso não pode falhar, ficar lenta nem vazar nada.
 *
 *   `miniatura` é a única coisa que, se a pessoa PEDIR, vira uma requisição —
 *   e mesmo assim é um endereço de imagem montado por nós, para um punhado de
 *   hospedeiros conhecidos, e a tela a pede sob clique e com `no-referrer`.
 *   Endereço de terceiro desconhecido NUNCA vira `src` de imagem: isso seria
 *   transformar todo link colado numa tarefa em pixel de rastreio.
 *
 *   ⚠️ A F17.22 ABRIU UMA PORTA, E SÓ UMA: os hospedeiros que o DONO DESTA
 *   INSTALAÇÃO declarou seus. Terceiro desconhecido continua sem `src`, e a
 *   lista nasce vazia. Ver o bloco `OS SERVIDORES CONFIÁVEIS DESTA INSTALAÇÃO`,
 *   logo abaixo — inclusive por que a comparação é de hospedeiro e não de
 *   formato de caminho.
 *
 * SEGURANÇA
 *   `lerLink` devolve `null` para qualquer coisa que não seja `http`/`https`.
 *   Ela NÃO substitui `enderecoSeguro` de `@/board/markdown` — que continua
 *   sendo a única lista de permissão de esquema do projeto — nem
 *   `task_links_url_is_web`, que é quem recusa de verdade, no banco. O que
 *   existe aqui é uma segunda recusa, mais estreita, para o caso de um dia
 *   alguém chamar esta função com texto que não passou por lá.
 *
 * O QUE ELA NÃO SABE FAZER, E ESTÁ CERTO ASSIM
 *   · Nome de PASTA do Dropbox — o endereço de pasta não o carrega. Vira
 *     "Pasta do Dropbox", que já é infinitamente mais legível que o `scl/fo/`.
 *   · Título de documento do Google — o endereço tem só o id. Vira
 *     "Documento do Google Docs".
 *   · Capa de vídeo do Dropbox — não há forma de pedi-la pelo endereço sem
 *     API. YouTube tem, e por isso o YouTube está aqui.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   OS SERVIDORES CONFIÁVEIS DESTA INSTALAÇÃO — etapa F17.22
   ═══════════════════════════════════════════════════════════════════════════

   O PROBLEMA, MEDIDO
     Dos endereços reais que a equipe colou até hoje, QUATRO são de
     `nuvem.exemplo.net` — o Nextcloud do próprio usuário, na forma
     `https://nuvem.exemplo.net/index.php/s/<token>`.

     Esse servidor TEM endereço de miniatura com teto e sem token:

       https://nuvem.exemplo.net/index.php/apps/files_sharing/publicpreview/<token>?x=640&y=640

     Seria `carga: 'leve'` e a imagem subiria sozinha — no servidor DELE, sem
     contar nada a terceiro. Mas a regra "domínio desconhecido nunca vira `src`
     de imagem" o barrava, e essa regra existe por um motivo bom.

   POR QUE NÃO SE AFROUXA PELO FORMATO DO CAMINHO
     Reconhecer "tem `/index.php/s/` no caminho" deixaria passar
     `https://evil.com/index.php/s/RASTREIO` — e o pixel de rastreio voltaria
     pela porta que a regra fechou. O caminho é escolhido por quem cola o link;
     o HOSPEDEIRO é escolhido por quem instalou o sistema.

   ENTÃO A LISTA É DE HOSPEDEIRO, E O DONO DA INSTALAÇÃO É QUEM A ESCREVE
     Ela chega de `IDEWORKS_TRUSTED_IMAGE_HOSTS` (ver `wrangler.toml`) e é
     posta aqui uma vez, na abertura do sistema, por `definirHospedeirosConfiaveis`.
     Enquanto ninguém a escrever, ela é VAZIA — e vazia significa exatamente o
     comportamento que existia antes desta etapa.

   ⚠️ COMPARAÇÃO EXATA, SEM CURINGA
     É a mesma regra, escrita pelo mesmo motivo, que a lista de convidados do
     `wrangler.toml` já segue: *"COMPARACAO EXATA, SEM CURINGA. Nada de
     'qualquer um @parceira.com.br'"*. Aqui:

       · `evil.com/nuvem.exemplo.net/x`  → o `hostname` é `evil.com`. NÃO passa.
       · `nuvem.exemplo.net.evil.com`    → outro hostname. NÃO passa.
       · `nuvem.exemplo.net@evil.com`    → o `URL` resolve o hostname para
                                        `evil.com`. NÃO passa.
       · `arquivos.nuvem.exemplo.net`    → subdomínio só passa se ESTIVER na lista.

     Quem compara é `URL.hostname`, e não o texto do endereço — é isso que
     torna o primeiro caso impossível em vez de improvável. Um domínio inteiro
     é uma porta que ninguém revisa; um hospedeiro é uma decisão que alguém
     tomou.

   O CURINGA NÃO É IGNORADO EM SILÊNCIO
     `*.exemplo.net` nunca casaria com hostname nenhum — funcionaria como "não
     confio em ninguém", e quem escreveu acharia que tinha liberado a rede
     inteira. Por isso a entrada torta é DESCARTADA na leitura, e
     `hospedeirosConfiaveis()` mostra o que de fato valeu.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Um hospedeiro e nada mais: sem esquema, sem barra, sem porta, sem curinga.
 *
 * É o que `URL.hostname` pode devolver. Tudo que não casa aqui é entrada torta
 * e não entra na lista.
 */
const SO_HOSPEDEIRO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

const normalizar = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

let confiaveis: readonly string[] = [];

/**
 * Põe a lista da instalação. Chamada uma vez, na abertura — ver `main.tsx`.
 *
 * Recebe TEXTO separado por vírgula, que é a forma que a variável de ambiente
 * tem. Chamar de novo SUBSTITUI a lista; chamar com texto vazio a esvazia, e
 * lista vazia é o padrão de fábrica: ninguém é confiável até alguém dizer que é.
 */
export function definirHospedeirosConfiaveis(lista: string): void {
  confiaveis = lista
    .split(',')
    .map(normalizar)
    .filter((h) => h !== '' && SO_HOSPEDEIRO.test(h));
}

/** O que de fato valeu, depois de descartada a entrada torta. */
export const hospedeirosConfiaveis = (): readonly string[] => confiaveis;

/**
 * Se este hospedeiro é um dos declarados pelo dono da instalação.
 *
 * `host` vem de `URL.hostname` — nunca do texto cru do endereço. Ver o
 * cabeçalho: é aí que mora a diferença entre a comparação exata e um `includes`
 * que `evil.com/nuvem.exemplo.net/x` engana.
 */
export const ehConfiavel = (host: string): boolean => confiaveis.includes(normalizar(host));

/**
 * O token de um compartilhamento público do Nextcloud, quando o caminho é um.
 *
 * As duas formas que o Nextcloud publica:
 *   `/index.php/s/<token>`  (a que os quatro links reais usam)
 *   `/s/<token>`            (a curta, das versões novas)
 *
 * O token é alfanumérico por construção. A conferência existe pelo mesmo motivo
 * que `ID_DO_GOOGLE` existe: aqui se escolhe o `src` de uma imagem, e o pedaço
 * vem do endereço que alguém colou.
 */
const TOKEN_DO_NEXTCLOUD = /^[A-Za-z0-9_-]{4,64}$/;

function tokenDoNextcloud(partes: readonly string[]): string | null {
  const alvo =
    partes[0] === 's' ? partes[1] : partes[0] === 'index.php' && partes[1] === 's' ? partes[2] : '';
  return alvo !== undefined && TOKEN_DO_NEXTCLOUD.test(alvo) ? alvo : null;
}

/** O que o arquivo é. Governa o rótulo, o selo e se há miniatura possível. */
export type EspecieDeLink =
  | 'imagem'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'arte'
  | 'documento'
  | 'planilha'
  | 'apresentacao'
  | 'formulario'
  | 'pacote'
  | 'pasta'
  | 'arquivo'
  | 'pagina';

/**
 * O tamanho que a miniatura vai trazer — ver o cabeçalho.
 *
 * `leve` é o endereço que NÓS montamos com teto; `original` é o que devolve o
 * arquivo inteiro; `null` é a ausência de miniatura.
 */
export type CargaDaMiniatura = 'leve' | 'original' | null;

export type PreviaDeLink = {
  /**
   * Quem hospeda. `outro` não ganha miniatura — ver o cabeçalho.
   *
   * `confiavel` é o hospedeiro que o dono desta instalação declarou seu, em
   * `IDEWORKS_TRUSTED_IMAGE_HOSTS`. Ele é o único que sai desta função com
   * miniatura sem ser um dos quatro nomes conhecidos — e é a etapa F17.22.
   */
  provedor: 'dropbox' | 'google' | 'youtube' | 'instagram' | 'confiavel' | 'outro';
  /** `Dropbox`, `Google Docs`, `YouTube`… ou o próprio domínio. */
  provedorNome: string;
  /** O domínio, para a tela mostrar o destino sem a parede de caracteres. */
  host: string;
  especie: EspecieDeLink;
  /** O rótulo em português: `Imagem`, `PDF`, `Pasta`… */
  tipo: string;
  /** O selo curto do cartão, na gramática do `.a-ext` do anexo: `png`, `pasta`. */
  selo: string;
  /** O nome do arquivo, quando o endereço o carrega. Nulo em pasta e em doc. */
  nome: string | null;
  extensao: string | null;
  /**
   * Endereço de uma IMAGEM que representa o link, montado a partir do próprio
   * endereço. Nulo quando não dá — e nulo SEMPRE para hospedeiro desconhecido.
   *
   * Quando ela sobe sozinha e quando espera clique é `carga` quem diz.
   */
  miniatura: string | null;
  /**
   * O TETO DE TAMANHO do endereço acima — a regra da opção B, F17.21.
   *
   * `leve` sobe sozinha; `original` espera clique; `null` não tem imagem.
   * Nunca é `leve` para hospedeiro desconhecido, porque desconhecido nunca tem
   * `miniatura` nenhuma.
   */
  carga: CargaDaMiniatura;
};

/* ───────────────────────────── a tabela de extensões ───────────────────────────── */

/**
 * Extensão → espécie e rótulo.
 *
 * A LISTA DE IMAGEM É A MESMA DE `conversa.ts` EM ESPÍRITO, mas não em forma:
 * lá a chave é o `content-type` declarado por quem enviou; aqui é a extensão
 * escrita no endereço, que é a única coisa que existe num link de terceiro.
 * Unificá-las obrigaria uma das duas a adivinhar a outra.
 */
const POR_EXTENSAO: Record<string, { especie: EspecieDeLink; tipo: string }> = {
  png: { especie: 'imagem', tipo: 'Imagem' },
  jpg: { especie: 'imagem', tipo: 'Imagem' },
  jpeg: { especie: 'imagem', tipo: 'Imagem' },
  gif: { especie: 'imagem', tipo: 'Imagem' },
  webp: { especie: 'imagem', tipo: 'Imagem' },
  avif: { especie: 'imagem', tipo: 'Imagem' },
  bmp: { especie: 'imagem', tipo: 'Imagem' },
  tif: { especie: 'imagem', tipo: 'Imagem' },
  tiff: { especie: 'imagem', tipo: 'Imagem' },
  heic: { especie: 'imagem', tipo: 'Imagem' },
  // `svg` é imagem, e a tela pode desenhá-lo — mas só de hospedeiro conhecido,
  // e num `<img>`, que não executa o script de dentro de um SVG.
  svg: { especie: 'imagem', tipo: 'Imagem' },

  pdf: { especie: 'pdf', tipo: 'PDF' },

  mp4: { especie: 'video', tipo: 'Vídeo' },
  mov: { especie: 'video', tipo: 'Vídeo' },
  m4v: { especie: 'video', tipo: 'Vídeo' },
  webm: { especie: 'video', tipo: 'Vídeo' },
  avi: { especie: 'video', tipo: 'Vídeo' },
  mkv: { especie: 'video', tipo: 'Vídeo' },

  mp3: { especie: 'audio', tipo: 'Áudio' },
  wav: { especie: 'audio', tipo: 'Áudio' },
  m4a: { especie: 'audio', tipo: 'Áudio' },
  aac: { especie: 'audio', tipo: 'Áudio' },
  ogg: { especie: 'audio', tipo: 'Áudio' },

  // O que a agência entrega de verdade. `.psd` e `.ai` passam de 500 MB e nunca
  // vão para o balde — eles vivem no Dropbox, e é por isso que estão aqui.
  psd: { especie: 'arte', tipo: 'Arte' },
  ai: { especie: 'arte', tipo: 'Arte' },
  indd: { especie: 'arte', tipo: 'Arte' },
  eps: { especie: 'arte', tipo: 'Arte' },
  fig: { especie: 'arte', tipo: 'Arte' },
  sketch: { especie: 'arte', tipo: 'Arte' },
  xd: { especie: 'arte', tipo: 'Arte' },
  aep: { especie: 'arte', tipo: 'Arte' },
  prproj: { especie: 'arte', tipo: 'Arte' },

  doc: { especie: 'documento', tipo: 'Documento' },
  docx: { especie: 'documento', tipo: 'Documento' },
  odt: { especie: 'documento', tipo: 'Documento' },
  rtf: { especie: 'documento', tipo: 'Documento' },
  txt: { especie: 'documento', tipo: 'Documento' },
  md: { especie: 'documento', tipo: 'Documento' },

  xls: { especie: 'planilha', tipo: 'Planilha' },
  xlsx: { especie: 'planilha', tipo: 'Planilha' },
  csv: { especie: 'planilha', tipo: 'Planilha' },
  ods: { especie: 'planilha', tipo: 'Planilha' },

  ppt: { especie: 'apresentacao', tipo: 'Apresentação' },
  pptx: { especie: 'apresentacao', tipo: 'Apresentação' },
  key: { especie: 'apresentacao', tipo: 'Apresentação' },
  odp: { especie: 'apresentacao', tipo: 'Apresentação' },

  zip: { especie: 'pacote', tipo: 'Pacote' },
  rar: { especie: 'pacote', tipo: 'Pacote' },
  '7z': { especie: 'pacote', tipo: 'Pacote' },
  tar: { especie: 'pacote', tipo: 'Pacote' },
  gz: { especie: 'pacote', tipo: 'Pacote' },
};

/** O selo curto quando não há extensão. Máximo seis letras — cabe no `.a-ext`. */
const SELO_DA_ESPECIE: Record<EspecieDeLink, string> = {
  imagem: 'img',
  pdf: 'pdf',
  video: 'vídeo',
  audio: 'áudio',
  arte: 'arte',
  documento: 'doc',
  planilha: 'folha',
  apresentacao: 'slide',
  formulario: 'form',
  pacote: 'zip',
  pasta: 'pasta',
  arquivo: 'arq',
  pagina: 'web',
};

/* ───────────────────────────── as peças ───────────────────────────── */

/** `%C3%A9` → `é`. Endereço torto não derruba a prévia: devolve o que veio. */
function decodificar(pedaco: string): string {
  try {
    return decodeURIComponent(pedaco);
  } catch {
    return pedaco;
  }
}

/** A extensão em minúsculas, só quando ela tem cara de extensão. */
function extensaoDe(nome: string): string | null {
  const ponto = nome.lastIndexOf('.');
  if (ponto <= 0 || ponto === nome.length - 1) return null;
  const bruta = nome.slice(ponto + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(bruta) ? bruta : null;
}

/** O id do YouTube tem esta forma, e nada mais vira `src` de imagem. */
const ID_DE_VIDEO = /^[A-Za-z0-9_-]{6,20}$/;
/** O id do Google Drive. Mesmo raciocínio: sem isto, `src` aceitaria qualquer coisa. */
const ID_DO_GOOGLE = /^[A-Za-z0-9_-]{10,120}$/;

type Nucleo = Pick<PreviaDeLink, 'especie' | 'tipo' | 'selo' | 'nome' | 'extensao'>;

/**
 * O endereço do Dropbox que devolve os BYTES em vez da página de visualização.
 *
 * `raw=1` é a forma documentada de pedir o conteúdo de um link compartilhado
 * direto pela URL — sem token e sem API. `dl` sai porque `dl=1` força download
 * e `dl=0` força a página; os três juntos brigam.
 *
 * ⚠️ ISTO NÃO É UMA MINIATURA DE VERDADE: o Dropbox devolve a imagem no tamanho
 * original. Está registrado como dívida da etapa. Por isso a tela a pede sob
 * clique, e não ao abrir a ficha.
 */
function crua(u: URL): string {
  const copia = new URL(u.toString());
  copia.searchParams.delete('dl');
  copia.searchParams.set('raw', '1');
  return copia.toString();
}

const semNome = (especie: EspecieDeLink, tipo: string): Nucleo => ({
  especie,
  tipo,
  selo: SELO_DA_ESPECIE[especie],
  nome: null,
  extensao: null,
});

/* ───────────────────────────── a leitura ───────────────────────────── */

/**
 * Lê o endereço e devolve o que dá para dizer sobre ele SEM sair da máquina.
 *
 * Devolve `null` quando o endereço não é web — e a tela, nesse caso, cai para
 * o que existia antes: rótulo e endereço. Nunca lança.
 */
export function lerLink(bruto: string): PreviaDeLink | null {
  let u: URL;
  try {
    u = new URL(bruto.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const partes = u.pathname.split('/').filter((p) => p !== '');
  const ultima = decodificar(partes[partes.length - 1] ?? '');
  const extensao = extensaoDe(ultima);
  const conhecida = extensao === null ? undefined : POR_EXTENSAO[extensao];

  const doArquivo = (): Nucleo => ({
    especie: conhecida?.especie ?? 'arquivo',
    tipo: conhecida?.tipo ?? 'Arquivo',
    selo: extensao ?? SELO_DA_ESPECIE.arquivo,
    nome: ultima === '' ? null : ultima,
    extensao,
  });

  /* --- Dropbox: o cofre da agência ---------------------------------------- */
  if (
    host === 'dropbox.com' ||
    host.endsWith('.dropbox.com') ||
    host.endsWith('.dropboxusercontent.com')
  ) {
    const ehPasta =
      partes[0] === 'sh' || partes[0] === 'home' || (partes[0] === 'scl' && partes[1] === 'fo');
    const nucleo = ehPasta ? semNome('pasta', 'Pasta') : doArquivo();
    return {
      provedor: 'dropbox',
      provedorNome: 'Dropbox',
      host,
      ...nucleo,
      // Só imagem. Pedir `raw=1` de um `.mp4` baixaria o vídeo inteiro dentro
      // de um `<img>` que nunca vai desenhá-lo.
      miniatura: nucleo.especie === 'imagem' ? crua(u) : null,
      // `original`, e é o ponto da F17.21: `raw=1` devolve o arquivo do
      // tamanho que ele é. Sem teto, sem clique não sobe.
      carga: nucleo.especie === 'imagem' ? 'original' : null,
    };
  }

  /* --- Google: Docs, Planilhas, Apresentações, Drive ----------------------- */
  if (host === 'docs.google.com') {
    const familia = partes[0];
    const google = (nucleo: Nucleo, nome: string): PreviaDeLink => ({
      provedor: 'google',
      provedorNome: nome,
      host,
      ...nucleo,
      miniatura: null,
      carga: null,
    });
    if (familia === 'document') return google(semNome('documento', 'Documento'), 'Google Docs');
    if (familia === 'spreadsheets') return google(semNome('planilha', 'Planilha'), 'Planilhas Google');
    if (familia === 'presentation') {
      return google(semNome('apresentacao', 'Apresentação'), 'Apresentações Google');
    }
    if (familia === 'forms') return google(semNome('formulario', 'Formulário'), 'Formulários Google');
    return google(semNome('pagina', 'Página'), 'Google');
  }

  if (host === 'drive.google.com') {
    if (partes[0] === 'drive' && partes[1] === 'folders') {
      return {
        provedor: 'google',
        provedorNome: 'Google Drive',
        host,
        ...semNome('pasta', 'Pasta'),
        miniatura: null,
        carga: null,
      };
    }
    // `drive.google.com/file/d/<id>/view`
    const id =
      partes[0] === 'file' && partes[1] === 'd' ? (partes[2] ?? '') : (u.searchParams.get('id') ?? '');
    const cabe = ID_DO_GOOGLE.test(id);
    return {
      provedor: 'google',
      provedorNome: 'Google Drive',
      host,
      ...semNome('arquivo', 'Arquivo'),
      // O Drive devolve miniatura de QUALQUER tipo por este endereço — PDF,
      // vídeo, documento. É a forma pública, sem token, e por isso ela some
      // sozinha quando o arquivo é privado: a tela cai para o cartão.
      miniatura: cabe ? `https://drive.google.com/thumbnail?id=${id}&sz=w640` : null,
      // `sz=w640` É O TETO, e é ele que faz esta subir sozinha: o Drive
      // redimensiona no servidor dele, então o que chega tem 640 de largura
      // seja o arquivo de que tamanho for.
      carga: cabe ? 'leve' : null,
    };
  }

  /* --- YouTube: é a única capa de VÍDEO que existe sem API ----------------- */
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const id =
      host === 'youtu.be'
        ? (partes[0] ?? '')
        : partes[0] === 'shorts' || partes[0] === 'embed'
          ? (partes[1] ?? '')
          : (u.searchParams.get('v') ?? '');
    const cabe = ID_DE_VIDEO.test(id);
    return {
      provedor: 'youtube',
      provedorNome: 'YouTube',
      host,
      ...semNome('video', 'Vídeo'),
      miniatura: cabe ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null,
      // `hqdefault` tem 480×360 SEMPRE, para todo vídeo que existe. É o
      // endereço de teto mais firme que este arquivo conhece.
      carga: cabe ? 'leve' : null,
    };
  }

  /* --- Instagram: é o que a agência mais cola, e foi MEDIDO ---------------- */
  //
  // Quatro dos seis endereços colados hoje em descrição e comentário são do
  // Instagram — perfil de cliente, quase sempre. Sem esta seção o cartão diria
  // "Página · www.instagram.com" e não teria por que existir; com ela ele diz
  // de qual PERFIL se trata, que é a única coisa que alguém quer saber ali.
  //
  // SEM MINIATURA, e não é esquecimento: o Instagram recusa imagem pedida de
  // fora do site dele, e o endereço de capa que existe hoje expira. Um `<img>`
  // que quebra sempre é pior que nenhum.
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const insta = (especie: EspecieDeLink, tipo: string, selo: string, nome: string | null) => ({
      provedor: 'instagram' as const,
      provedorNome: 'Instagram',
      host,
      especie,
      tipo,
      selo,
      nome,
      extensao: null,
      miniatura: null,
      carga: null,
    });
    if (partes[0] === 'p') return insta('pagina', 'Publicação', 'post', null);
    if (partes[0] === 'reel' || partes[0] === 'reels') return insta('video', 'Reel', 'reel', null);
    if (partes[0] === 'stories') return insta('video', 'Story', 'story', null);
    if (partes[0] === 'tv') return insta('video', 'Vídeo', 'vídeo', null);
    // `instagram.com/<perfil>/` — o resto do caminho vazio é a marca do perfil.
    if (partes.length === 1 && /^[A-Za-z0-9._]{1,30}$/.test(partes[0])) {
      return insta('pagina', 'Perfil', 'perfil', `@${partes[0]}`);
    }
    return insta('pagina', 'Página', 'web', null);
  }

  /* --- o servidor do próprio dono — F17.22 --------------------------------- */
  //
  // A ÚNICA porta pela qual um hospedeiro fora dos quatro nomes acima vira
  // `src` de imagem, e ela só abre para quem está na lista da instalação. Ver o
  // bloco no alto do arquivo: a comparação é de `hostname`, exata, sem curinga.
  if (ehConfiavel(host)) {
    const token = tokenDoNextcloud(partes);
    if (token !== null) {
      return {
        provedor: 'confiavel',
        provedorNome: 'Nextcloud',
        host,
        // O compartilhamento não diz no endereço o que há dentro dele — nem o
        // nome, nem a extensão, nem se é pasta. É a mesma situação do Drive, e
        // a mesma resposta: `Arquivo`, com a miniatura tentando.
        ...semNome('arquivo', 'Arquivo'),
        miniatura: `${u.origin}/index.php/apps/files_sharing/publicpreview/${token}?x=640&y=640`,
        // `x=640&y=640` É O TETO: quem redimensiona é o servidor dele, então o
        // que chega tem 640 de lado seja o arquivo de que tamanho for. E ele
        // devolve 404 para o que não sabe pré-visualizar — pasta, `.psd`, link
        // vencido —, e aí a `<img>` cai no `onError` e some, como já cai a do
        // Drive privado.
        carga: 'leve',
      };
    }
    // Endereço direto no servidor dele — `.../logo.png`. A privacidade não é
    // assunto aqui (o servidor é dele), mas o TAMANHO continua desconhecido:
    // vale a mesma regra do Dropbox, e a imagem espera clique.
    const nucleo = doArquivo();
    if (nucleo.especie === 'imagem') {
      return {
        provedor: 'confiavel',
        provedorNome: host,
        host,
        ...nucleo,
        miniatura: u.toString(),
        carga: 'original',
      };
    }
  }

  /* --- qualquer outro ------------------------------------------------------ */
  // SEM MINIATURA, SEMPRE. Um `<img src>` apontando para hospedeiro qualquer
  // transformaria todo link colado numa tarefa em pixel de rastreio — quem
  // mandou o link saberia a hora em que cada pessoa abriu a tarefa.
  const nucleo = extensao === null ? semNome('pagina', 'Página') : doArquivo();
  return { provedor: 'outro', provedorNome: host, host, ...nucleo, miniatura: null, carga: null };
}
