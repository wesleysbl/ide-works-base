/**
 * Colar o print no comentário — `Ctrl+V`. Etapa F17.68.
 *
 * O GESTO QUE A EQUIPE JÁ FAZ
 *   Dar print, colar no comentário, mandar. Até aqui o `Ctrl+V` num campo de
 *   comentário não fazia nada com imagem: a pessoa tinha que salvar o arquivo,
 *   achar a pasta e usar `Anexar arquivo`. Três passos para um gesto de um.
 *
 * ⚠️ NÃO EXISTE SEGUNDO CAMINHO DE ESCRITA — REGRA 9.
 *   Este arquivo NÃO envia nada. Ele só decide TRÊS coisas, e todas são puras:
 *
 *     1. isto é uma colagem de imagem, ou é a colagem de texto de sempre?
 *     2. os BYTES são mesmo de uma imagem, ou só o rótulo dizia isso?
 *     3. que nome NOSSO esse arquivo vai ter?
 *
 *   O envio continua sendo `api.enviarAnexo` → `POST /board/tasks/:id/
 *   attachments` → `uploadAttachment`, exatamente o mesmo do botão de clipe. O
 *   teto, o alcance no banco, o balde privado e a linha em `task_attachments`
 *   são os mesmos, porque é o mesmo caminho. Ver `server/board-anexos.ts`.
 *
 * ⚠️ O TETO TAMBÉM NÃO MORA AQUI.
 *   Quem confere tamanho é `conferirArquivo`, em `conversa.ts`, com a frase que
 *   já diz OS DOIS NÚMEROS — o tamanho e o teto. Uma regra de tamanho escrita
 *   aqui seria o quinto lugar onde 5 MB mora, e o quinto é o que ninguém lembra
 *   de mudar junto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE FOI MEDIDO ANTES DE ESCREVER, PORQUE O DIAGNÓSTICO DIZIA OUTRA COISA
 *
 *   Suspeitava-se que o print de tela cheia estouraria os 5 MB com facilidade.
 *   Medido nesta máquina, com a tela real da equipe:
 *
 *     tela 1920×1080, print de verdade, PNG ........... 0,80 MB
 *     ruído puro 1920×1080 (pior caso teórico) ........ 5,94 MB
 *     ruído puro 2560×1440 ............................ 10,6 MB
 *
 *   Print de interface comprime MUITO bem — é cor chapada, e o PNG vive disso.
 *   O pior caso de 5,94 MB é ruído aleatório, que nenhuma tela produz. Então a
 *   escolha desta etapa é RECUSAR acima do teto, e não encolher:
 *
 *     · encolher custaria decodificar e reescrever a imagem no navegador, perder
 *       qualidade justamente no print de tela (texto pequeno é o que mais sofre
 *       em JPEG), e criar uma SEGUNDA regra de tamanho;
 *     · a recusa já existe, já diz o tamanho e o teto, e já aponta a saída —
 *       *"Para algo maior, ponha o link do Dropbox ao lado."*
 *
 *   A dívida está registrada no plano: se a equipe trocar de monitor e o print
 *   começar a passar dos 5 MB de verdade, encolher volta à mesa COM medida nova.
 */

/* ───────────────────────────── o que se cola ───────────────────────────── */

/**
 * Os dois tipos que entram por colagem, e por que são só dois.
 *
 * O botão de clipe aceita `.ai`, `.psd`, `.zip` — trabalho real da agência, e
 * recusá-lo seria recusar trabalho. A COLAGEM é outra coisa: o que a área de
 * transferência produz num print é PNG (Windows e Chrome) ou JPEG (recorte de
 * página, celular). Aceitar mais que isso por colagem seria abrir um tipo que
 * ninguém cola, e cada tipo a mais é uma assinatura a mais para conferir.
 */
export const TIPOS_QUE_SE_COLAM = ['image/png', 'image/jpeg'] as const;

export type TipoColado = (typeof TIPOS_QUE_SE_COLAM)[number];

/**
 * ⚠️ A ASSINATURA, E NÃO O RÓTULO.
 *
 * O `type` de um item da área de transferência é o que o NAVEGADOR diz, e o
 * navegador repete o que a aplicação de origem escreveu. Nada nesse caminho leu
 * o conteúdo. Um `.html` colado de um gerenciador de arquivos pode chegar
 * dizendo-se `image/png`, e a linha em `task_attachments` guardaria essa mentira
 * como verdade.
 *
 * Os primeiros bytes não mentem: quem os escreve é o codificador da imagem.
 *
 *   PNG ..... 89 50 4E 47 0D 0A 1A 0A   (os oito, e não só os quatro: os
 *             quatro últimos são o que pega arquivo corrompido em transferência
 *             de texto, que é exatamente o risco de uma colagem)
 *   JPEG .... FF D8 FF                  (SOI + o primeiro marcador)
 *
 * Não é antivírus, e não se pretende: o conteúdo depois do cabeçalho continua
 * sendo de terceiro. O que isto garante é que o tipo GRAVADO é o tipo REAL — e
 * quem desenha o anexo na ficha decide por esse tipo (ver `previsualizavel`).
 */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

const comeca = (bytes: Uint8Array, assinatura: number[]): boolean =>
  bytes.length >= assinatura.length && assinatura.every((b, i) => bytes[i] === b);

/** O tipo que os BYTES dizem ser, ou `null` se não for imagem que se cola. */
export function assinaturaDeImagem(bytes: Uint8Array): TipoColado | null {
  if (comeca(bytes, PNG)) return 'image/png';
  if (comeca(bytes, JPEG)) return 'image/jpeg';
  return null;
}

/** Quantos bytes bastam para a assinatura — o resto do arquivo não se lê aqui. */
export const BYTES_DA_ASSINATURA = PNG.length;

/* ───────────────────────────── colar texto continua colando texto ───────── */

/** O par `kind`/`type` de `DataTransferItem`, sem depender do DOM para testar. */
export type ItemColado = { kind: string; type: string };

/**
 * ⚠️ A DECISÃO MAIS DELICADA DA ETAPA: quando NÃO se mexe na colagem.
 *
 * Colar texto tem que continuar colando texto. Não "quase sempre" — sempre. Um
 * campo de comentário onde `Ctrl+V` às vezes come o texto é pior do que um campo
 * que nunca aceitou imagem, porque o segundo ao menos é previsível.
 *
 * A REGRA É: só se anexa quando há imagem E NÃO HÁ `text/plain`.
 *
 *   · print de tela .................... só `[file image/png]`  → anexa
 *   · "copiar imagem" numa página ...... `[file image/png]` (+ `text/html`)
 *                                        → anexa
 *   · texto copiado de qualquer lugar .. tem `text/plain`       → não mexe
 *   · trecho de planilha, de e-mail .... tem `text/plain`       → não mexe,
 *                                        mesmo quando vem imagem junto
 *
 * O último caso é de propósito CONSERVADOR. Quando a colagem traz texto E
 * imagem, o que a pessoa está colando é o TEXTO — a imagem veio de carona na
 * marcação. Ficar com o texto e perder a imagem é um erro reparável (ela cola a
 * imagem de novo, sozinha); comer o texto que ela acabou de copiar não é.
 *
 * `e.preventDefault()` só acontece quando esta função devolve `true`.
 */
export function deveAnexar(itens: readonly ItemColado[]): boolean {
  const temTexto = itens.some((i) => i.kind === 'string' && i.type === 'text/plain');
  if (temTexto) return false;
  return itens.some((i) => i.kind === 'file' && ehTipoQueSeCola(i.type));
}

/** O `type` declarado está na lista curta? Comparação sem parâmetro (`;charset=`). */
export function ehTipoQueSeCola(declarado: string): boolean {
  const limpo = declarado.split(';')[0].trim().toLowerCase();
  return (TIPOS_QUE_SE_COLAM as readonly string[]).includes(limpo);
}

/* ───────────────────────────── o nome ───────────────────────────── */

const dois = (n: number): string => String(n).padStart(2, '0');

/**
 * ⚠️ O NOME É NOSSO, E NUNCA O QUE VEIO DE FORA.
 *
 * Chrome batiza o print colado de `image.png`; outra origem pode mandar
 * qualquer coisa, com acento, barra, `..` ou caractere de controle — e o nome do
 * anexo é o que a ficha ESCREVE na tela. Gerar o nome aqui tira essa entrada do
 * caminho inteiro.
 *
 * Vinte anexos chamados `image.png` numa tarefa também não ajudam ninguém a
 * achar nada. `print-2026-09-04-10h32m07.png` diz QUANDO, que é a única coisa
 * que distingue um print de outro.
 *
 * `ordem` só aparece a partir do segundo arquivo da MESMA colagem — dois prints
 * colados no mesmo segundo teriam o mesmo nome sem ele. Note que o nome não é
 * chave de nada: a chave do objeto no balde é um sorteio, feito por
 * `caminhoDoObjeto`. Nome repetido não sobrescreveria arquivo nenhum; só
 * confundiria quem lê.
 */
export function nomeDaColagem(tipo: TipoColado, quando: Date, ordem = 0): string {
  const extensao = tipo === 'image/png' ? 'png' : 'jpg';
  const carimbo =
    `${quando.getFullYear()}-${dois(quando.getMonth() + 1)}-${dois(quando.getDate())}` +
    `-${dois(quando.getHours())}h${dois(quando.getMinutes())}m${dois(quando.getSeconds())}`;
  return `print-${carimbo}${ordem > 0 ? `-${ordem + 1}` : ''}.${extensao}`;
}

/* ───────────────────────────── a conferência ───────────────────────────── */

export type ColagemConferida =
  | { ok: true; tipo: TipoColado; nome: string }
  | { ok: false; motivo: string };

/**
 * A imagem colada passa, ou a frase que diz por que não.
 *
 * A ORDEM É: assinatura → tamanho. Assinatura primeiro porque um arquivo que
 * nem é imagem não merece uma frase sobre megabytes — a pessoa ficaria
 * comprimindo um `.html`.
 *
 * O tamanho NÃO é conferido aqui: quem confere é `conferirArquivo`, e quem
 * chama esta função chama as duas. Ver o cabeçalho — o teto tem um dono só.
 */
export function conferirImagemColada(
  cabeca: Uint8Array,
  quando: Date,
  ordem = 0,
): ColagemConferida {
  const tipo = assinaturaDeImagem(cabeca);
  if (!tipo) {
    // A RECUSA DIZ O QUE ACONTECEU, e não "falhou". Quem cola um arquivo que se
    // diz PNG e não é precisa saber que o problema é o ARQUIVO, não o sistema —
    // senão tenta de novo, três vezes, e abre um chamado.
    return {
      ok: false,
      motivo: 'Este arquivo não é uma imagem PNG ou JPEG válida. Envie um print ou uma imagem nesses formatos.',
    };
  }
  return { ok: true, tipo, nome: nomeDaColagem(tipo, quando, ordem) };
}
