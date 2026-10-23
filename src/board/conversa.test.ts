/**
 * A camada pura da entrega — comentário, anexo e link. F17.6.
 *
 * O QUE ESTE ARQUIVO PROVA, E POR QUE CADA COISA IMPORTA
 *   1. O ENDEREÇO CRU VIRA CLIQUE. É a medição que motiva a etapa inteira: o
 *      comentário real da Agência Ide é o endereço do Dropbox colado sozinho,
 *      sem colchetes. Sem `linkarTextoCru` a entrega chegaria como texto que a
 *      pessoa tem que selecionar e copiar.
 *   2. `javascript:` NÃO VIRA CLIQUE, nos dois caminhos — o do texto cru e o do
 *      link guardado. Comentário é texto de terceiro.
 *   3. A CONVERSA TEM UM NÍVEL, e órfão não some.
 *   4. A VALIDAÇÃO DE CONFORTO NÃO É MAIS SEVERA QUE O BANCO. `✅` e `👍` são
 *      aceitos por `ideworks.is_meaningful_name` — medido contra o Postgres na
 *      F17.15 —, e uma tela que os recusasse mentiria sobre o que o sistema
 *      aceita.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type Comentario,
  TETO_DE_BYTES,
  aninharConversa,
  conferirArquivo,
  conferirComentario,
  conferirLink,
  imagem,
  normalizarEndereco,
  paiParaResponder,
  pdf,
  previsualizavel,
  rotuloDeComentarios,
  rotuloDeRespostas,
  tamanhoLegivel,
} from '@/board/conversa';
// A regra que transforma endereço cru em link mora AQUI, e não em `conversa.ts`
// — ver o bloco "o endereço cru vira clique" abaixo.
import { parseInline } from '@/board/markdown';

/** `src/board/` → a raiz. Serve à conferência do teto contra o SQL, no fim. */
const RAIZ_DO_PROJETO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fala = (p: Partial<Comentario>): Comentario => ({
  id: 'c1',
  parentId: null,
  body: 'ok',
  author: { id: 'a', name: 'Ana' },
  createdAt: '2026-08-26T10:00:00.000Z',
  editedAt: null,
  replyCount: 0,
  mine: false,
  replies: [],
  ...p,
});

/* ───────────────────────────── o endereço cru vira clique ───────────────────────────── */

/**
 * ESTE BLOCO NÃO TESTA CÓDIGO DESTA ETAPA — E É EXATAMENTE POR ISSO QUE EXISTE.
 *
 *   A F17.6 começou escrevendo uma função para transformar endereço cru em
 *   link. Ela era REDUNDANTE: `parseInline`, em `src/board/markdown.ts`, já tem
 *   a regra `URL_SOLTA`, escrita na F17.10b com o comentário "as tarefas reais
 *   colam link do Dropbox e do Google Docs sem colchete nenhum — sem isto eles
 *   não clicam". Pior que redundante: as duas juntas produziam `<a>` dentro de
 *   `<a>`. Medido no HTML, e removida.
 *
 *   O que fica é este teste, na etapa que DEPENDE do comportamento. Se alguém
 *   um dia "simplificar" o analisador e tirar `URL_SOLTA`, a entrega da Agência
 *   Ide para de clicar — e o teste que grita é este, não um de markdown
 *   genérico.
 */
describe('o comentário real da Agência Ide vira clique — e quem faz isso é `markdown.ts`', () => {
  // O comentário medido em `[A] JATOBÁ - NÚMERO ALTO DE INVESTIDORES`.
  const O_COMENTARIO_REAL =
    'www.dropbox.com/scl/fo/exemplo00000000000000/AAexemploDePasta000000_X?rlkey=abc123';

  const links = (fonte: string) =>
    parseInline(fonte).filter((n): n is Extract<typeof n, { kind: 'link' }> => n.kind === 'link');

  it('o endereço sem esquema, colado sozinho, ganha `https://` e vira link', () => {
    const [l] = links(O_COMENTARIO_REAL);
    expect(l?.href).toBe(`https://${O_COMENTARIO_REAL}`);
  });

  it('e o texto do link continua sendo o que a pessoa escreveu', () => {
    const [l] = links(O_COMENTARIO_REAL);
    expect(l?.children).toEqual([{ kind: 'text', text: O_COMENTARIO_REAL }]);
  });

  it('o endereço COM esquema, no meio da frase, também vira link', () => {
    const [l] = links('pronto: https://docs.google.com/document/d/1abc');
    expect(l?.href).toBe('https://docs.google.com/document/d/1abc');
  });

  it('UM link, e não dois aninhados — o defeito que a função redundante causava', () => {
    expect(links(O_COMENTARIO_REAL)).toHaveLength(1);
  });

  it('a pontuação final da frase fica FORA do link', () => {
    // Sem isto o endereço terminaria em ponto — o Dropbox recusa, e a pessoa
    // culparia o sistema por ter quebrado o link dela.
    const [l] = links('veja https://a.com/x.');
    expect(l?.href).toBe('https://a.com/x');
  });

  it('`javascript:` NÃO vira clique', () => {
    expect(links('javascript:alert(1)')).toHaveLength(0);
    expect(links('[clique](javascript:alert(1))')).toHaveLength(0);
  });

  it('dois endereços na mesma linha viram dois links', () => {
    expect(links('https://a.com/1 e https://b.com/2')).toHaveLength(2);
  });
});

/* ───────────────────────────── a conversa de um nível ───────────────────────────── */

describe('a conversa se monta em UM nível, e nada some', () => {
  it('resposta entra dentro do comentário que ela responde', () => {
    const fio = aninharConversa([
      fala({ id: 'c1', body: 'segue o link' }),
      fala({ id: 'r1', parentId: 'c1', body: 'obrigado', createdAt: '2026-08-26T11:00:00.000Z' }),
    ]);
    expect(fio).toHaveLength(1);
    expect(fio[0].replies.map((r) => r.id)).toEqual(['r1']);
  });

  it('a ordem é CRONOLÓGICA nos dois níveis — conversa se lê na ordem em que foi dita', () => {
    const fio = aninharConversa([
      fala({ id: 'b', createdAt: '2026-08-26T12:00:00.000Z' }),
      fala({ id: 'a', createdAt: '2026-08-26T10:00:00.000Z' }),
      fala({ id: 'a2', parentId: 'a', createdAt: '2026-08-26T13:00:00.000Z' }),
      fala({ id: 'a1', parentId: 'a', createdAt: '2026-08-26T11:00:00.000Z' }),
    ]);
    expect(fio.map((c) => c.id)).toEqual(['a', 'b']);
    expect(fio[0].replies.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('ÓRFÃO NÃO SOME: pai inexistente aparece na raiz', () => {
    // O banco não deixa nascer (`task_comments_parent_fk`), mas esconder a fala
    // de alguém é o pior defeito possível nesta tela.
    const fio = aninharConversa([fala({ id: 'r', parentId: 'sumiu' })]);
    expect(fio.map((c) => c.id)).toEqual(['r']);
  });

  it('não muda o array que recebeu — a ficha do servidor continua intacta', () => {
    const entrada = [fala({ id: 'c1' }), fala({ id: 'r1', parentId: 'c1' })];
    aninharConversa(entrada);
    expect(entrada[0].replies).toEqual([]);
  });

  it('conversa vazia vira fio vazio, sem erro', () => {
    expect(aninharConversa([])).toEqual([]);
  });
});

/* ───────────────────────────── a quem a resposta se endereça ───────────────────────────── */

describe('o botão Responder de uma RESPOSTA endereça o comentário original', () => {
  // `post_task_comment` recusa (23514) resposta a resposta: "responde-se ao
  // comentário, não a uma resposta". A fala de segundo nível também oferece
  // `Responder`, e mandar o id dela como pai fazia o botão falhar sempre.
  it('comentário de primeiro nível: o pai é ele mesmo', () => {
    expect(paiParaResponder(fala({ id: 'c1', parentId: null }))).toBe('c1');
  });

  it('resposta: o pai é o comentário que ela responde, e não ela', () => {
    expect(paiParaResponder(fala({ id: 'r1', parentId: 'c1' }))).toBe('c1');
  });

  it('resposta órfã (o pai não veio na ficha) continua apontando para o pai verdadeiro', () => {
    expect(paiParaResponder(fala({ id: 'r', parentId: 'sumiu' }))).toBe('sumiu');
  });
});

/* ───────────────────────────── o endereço guardado ───────────────────────────── */

describe('o endereço do link — lista de PERMISSÃO, como no banco', () => {
  it('completa o `https://` da digitação natural da equipe', () => {
    expect(normalizarEndereco('www.dropbox.com/scl/fo/abc')).toBe(
      'https://www.dropbox.com/scl/fo/abc',
    );
  });

  it('mantém o que já tem esquema', () => {
    expect(normalizarEndereco('https://docs.google.com/document/d/1')).toBe(
      'https://docs.google.com/document/d/1',
    );
    expect(normalizarEndereco('http://exemplo.com')).toBe('http://exemplo.com');
  });

  it('recusa `javascript:`, em qualquer caixa', () => {
    expect(normalizarEndereco('javascript:alert(1)')).toBeNull();
    expect(normalizarEndereco('JavaScript:alert(1)')).toBeNull();
    expect(normalizarEndereco('  javascript:alert(1)')).toBeNull();
  });

  it('recusa `data:` — e recusa o que o markdown aceita mas esta tabela não', () => {
    expect(normalizarEndereco('data:text/html;base64,x')).toBeNull();
    // `enderecoSeguro` aceita `mailto:` e caminho relativo, porque servem ao
    // markdown. `task_links_url_is_web` não os aceita, e a tela precisa
    // concordar com o banco — senão a recusa viria como nome de restrição.
    expect(normalizarEndereco('mailto:a@b.com')).toBeNull();
    expect(normalizarEndereco('/painel')).toBeNull();
  });

  it('recusa endereço com espaço — o `check` do banco também', () => {
    expect(normalizarEndereco('https://a.com/ b')).toBeNull();
  });

  it('vazio é nulo, e não uma string vazia que o banco recusaria depois', () => {
    expect(normalizarEndereco('   ')).toBeNull();
  });
});

describe('a conferência do link antes de gastar uma ida ao servidor', () => {
  it('exige rótulo e endereço', () => {
    const e = conferirLink({ label: '', url: '' });
    expect(e.label).toBeTruthy();
    expect(e.url).toBeTruthy();
  });

  it('recusa rótulo só com pontuação — a mesma regra do banco', () => {
    expect(conferirLink({ label: '{}', url: 'https://a.com' }).label).toBeTruthy();
  });

  it('aceita o par real: nome curto e endereço do Dropbox sem esquema', () => {
    expect(conferirLink({ label: 'Pasta de entrega', url: 'www.dropbox.com/scl/fo/x' })).toEqual({});
  });
});

/* ───────────────────────────── o corpo do comentário ───────────────────────────── */

describe('o corpo do comentário — nem mais nem menos severo que o banco', () => {
  it('aceita o link cru, que é como a entrega chega', () => {
    expect(conferirComentario('www.dropbox.com/scl/fo/x?rlkey=y')).toBeNull();
  });

  it('ACEITA emoji sozinho — `is_meaningful_name` aceita, medido no Postgres', () => {
    // `[[:punct:]]` do Postgres é PONTUAÇÃO Unicode e nada além: `✅` e `👍`
    // são símbolo (`\p{S}`) e passam. Uma tela mais severa que a regra
    // recusaria um comentário que o sistema aceita.
    expect(conferirComentario('✅')).toBeNull();
    expect(conferirComentario('👍')).toBeNull();
  });

  it('recusa o que o banco recusa: vazio, só espaço, só pontuação', () => {
    expect(conferirComentario('')).toBeTruthy();
    expect(conferirComentario('   ')).toBeTruthy();
    expect(conferirComentario('...')).toBeTruthy();
    expect(conferirComentario('{}')).toBeTruthy();
  });
});

/* ───────────────────────────── o arquivo ───────────────────────────── */

describe('o arquivo, antes de subir', () => {
  it('recusa o vazio — zero byte é arquivo que não subiu', () => {
    expect(conferirArquivo('a.pdf', 0)).toBeTruthy();
  });

  it('recusa acima do teto, e a frase diz OS DOIS números e a saída que existe', () => {
    // A decisão do usuário na F17.17: 5 MB, contra os 25 MiB da F17.6.
    // "Arquivo grande demais" obriga a pessoa a adivinhar de quanto ela passou;
    // com o tamanho e o teto lado a lado ela decide na hora entre comprimir e
    // pôr o link.
    const r = conferirArquivo('video.mp4', TETO_DE_BYTES + 1);
    expect(r).toBeTruthy();
    expect(r).toContain('5 MB');
    expect(r).toContain('link');
  });

  it('o teto é exatamente 5 MB, e o byte de cima já não passa', () => {
    expect(TETO_DE_BYTES).toBe(5 * 1024 * 1024);
    expect(conferirArquivo('no-limite.png', TETO_DE_BYTES)).toBeNull();
    expect(conferirArquivo('um-byte-acima.png', TETO_DE_BYTES + 1)).toBeTruthy();
  });

  it('aceita o PDF de roteiro real, de 2 MB', () => {
    expect(conferirArquivo('Jatobá Investimentos - Roteiro Leads quiz 1.pdf', 2_100_000)).toBeNull();
  });

  it('recusa nome só com pontuação — o `{}` do Trello, outra vez', () => {
    expect(conferirArquivo('{}', 1000)).toBeTruthy();
  });
});

describe('o tamanho legível usa a mesma base que o Explorador do Windows', () => {
  it('bytes, KB, MB e GB', () => {
    expect(tamanhoLegivel(640)).toBe('640 B');
    expect(tamanhoLegivel(1024)).toBe('1 KB');
    expect(tamanhoLegivel(831488)).toBe('812 KB');
    expect(tamanhoLegivel(3_565_158)).toBe('3,4 MB');
    expect(tamanhoLegivel(26214400)).toBe('25 MB');
  });

  it('a casa decimal zerada SAI — `5 MB` é regra, `5,0 MB` parece aproximação', () => {
    expect(tamanhoLegivel(5 * 1024 * 1024)).toBe('5 MB');
    expect(tamanhoLegivel(1024 * 1024)).toBe('1 MB');
    // E a que não é zero fica: o tamanho do arquivo continua exato.
    expect(tamanhoLegivel(5_400_000)).toBe('5,1 MB');
  });

  it('número impossível não vira `NaN` na tela', () => {
    expect(tamanhoLegivel(Number.NaN)).toBe('tamanho desconhecido');
    expect(tamanhoLegivel(-1)).toBe('tamanho desconhecido');
  });
});

describe('o que se pré-visualiza é uma lista CURTA e fechada', () => {
  it('imagem e PDF, e nada mais', () => {
    expect(imagem('image/png')).toBe(true);
    expect(imagem('image/jpeg')).toBe(true);
    expect(pdf('application/pdf')).toBe(true);
    expect(previsualizavel('image/webp')).toBe(true);
  });

  it('`text/html` NÃO é pré-visualizável — ele só se baixa', () => {
    // O banco não tem lista de permissão de tipo, de propósito: a agência anexa
    // `.ai`, `.psd` e `.zip`. O risco é contido aqui e no `?download=` da URL
    // assinada, que faz o navegador SALVAR em vez de renderizar.
    expect(previsualizavel('text/html')).toBe(false);
    expect(previsualizavel('image/svg+xml; charset=utf-8')).toBe(false);
    expect(previsualizavel('application/postscript')).toBe(false);
    expect(previsualizavel('application/zip')).toBe(false);
  });
});

describe('os rótulos que a tela escreve', () => {
  it('a contagem de comentários, no plural certo', () => {
    expect(rotuloDeComentarios(0)).toBe('nenhum comentário');
    expect(rotuloDeComentarios(1)).toBe('1 comentário');
    expect(rotuloDeComentarios(4)).toBe('4 comentários');
  });

  it('a de respostas é VAZIA em zero — o ClickUp não escreve "0 respostas"', () => {
    expect(rotuloDeRespostas(0)).toBe('');
    expect(rotuloDeRespostas(1)).toBe('1 resposta');
    expect(rotuloDeRespostas(3)).toBe('3 respostas');
  });
});

/* ─────────────────────── o teto mora num lugar só ─────────────────────── */

/**
 * ⚠️ ESTE BLOCO É A TRAVA QUE IMPEDE O ERRO MAIS CARO DESTA ETAPA.
 *
 * O teto do anexo vive em quatro lugares — a tela, o servidor, o `check` da
 * linha e o `file_size_limit` do balde. Os dois primeiros importam
 * `TETO_DE_BYTES` e não podem divergir. Os dois últimos são SQL, e SQL não se
 * importa: eles só concordam se alguém conferir.
 *
 * Se divergirem, a pessoa recebe o erro de um lugar diferente do que a tela
 * promete — o balde responde 502 com uma frase em inglês no meio de um envio
 * que a tela tinha aceitado.
 *
 * Aqui a conferência é ESTÁTICA: lê o arquivo da migration e exige que os dois
 * números escritos nela sejam este. `scripts/provar-comentarios-e-anexos.mjs`
 * faz a outra metade, perguntando ao banco e ao serviço de Storage de verdade.
 */
describe('o teto do anexo mora num lugar só, e o SQL concorda com ele', () => {
  const migracao = readFileSync(
    join(RAIZ_DO_PROJETO, 'supabase/migrations/20260826120000_ideworks_f17_17_limite_de_anexo.sql'),
    'utf8',
  );

  it('o `check` da linha usa exatamente `TETO_DE_BYTES`', () => {
    expect(migracao).toContain(`byte_size <= ${TETO_DE_BYTES}`);
  });

  it('e o teto do BALDE também — os dois têm que ser o mesmo número', () => {
    expect(migracao).toContain(`file_size_limit = ${TETO_DE_BYTES}`);
  });

  it('nenhum 25 MiB sobrou no SQL EXECUTÁVEL da migration nova', () => {
    // Os comentários citam o número velho, e devem citar: eles contam a história
    // da mudança. O que não pode sobrar é um `26214400` que o Postgres EXECUTE.
    // Mesmo raciocínio de `scripts/proibido.mjs`, que ignora prosa.
    const executavel = migracao
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(executavel).not.toContain('26214400');
  });
});
