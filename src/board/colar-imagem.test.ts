/**
 * COLAR O PRINT NO COMENTÁRIO — F17.68.
 *
 * POR QUE ESTE TESTE EXISTE
 *   As três decisões desta etapa são puras e nenhuma delas se enxerga olhando a
 *   tela funcionar:
 *
 *     · "colar texto continua colando texto" só se prova ENUMERANDO as formas de
 *       colagem que existem — e a que quebra o gesto é justamente a que ninguém
 *       lembra de testar à mão (planilha, e-mail: texto E imagem juntos);
 *     · a assinatura de arquivo só se prova com bytes que MENTEM, e o navegador
 *       não produz mentira sob demanda;
 *     · o nome gerado é o que impede o nome de terceiro de entrar, e um nome
 *       vindo de fora passaria despercebido numa conferência visual.
 *
 * O QUE ELE **NÃO** PROVA
 *   O envio. Quem envia é `api.enviarAnexo`, pelo mesmo caminho do botão de
 *   clipe, e quem recorta o alcance é o banco. Isso está em
 *   `scripts/provar-colar-imagem.mjs` (banco, como `ideworks_app`) e no Chrome
 *   de verdade, no relatório da etapa. Cobertura imaginada é pior que nenhuma.
 */

import { describe, expect, it } from 'vitest';

import {
  BYTES_DA_ASSINATURA,
  TIPOS_QUE_SE_COLAM,
  assinaturaDeImagem,
  conferirImagemColada,
  deveAnexar,
  ehTipoQueSeCola,
  nomeDaColagem,
} from '@/board/colar-imagem';
import { TETO_DE_BYTES, conferirArquivo, imagem } from '@/board/conversa';

const bytes = (...v: number[]) => new Uint8Array(v);

/** Um PNG de verdade começa assim, e os oito bytes importam. */
const CABECA_PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const CABECA_JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);

/* ───────────────────────────── a assinatura ───────────────────────────── */

describe('o tipo vem dos bytes, não do rótulo', () => {
  it('reconhece PNG pelos oito bytes', () => {
    expect(assinaturaDeImagem(CABECA_PNG)).toBe('image/png');
  });

  it('reconhece JPEG pelo SOI', () => {
    expect(assinaturaDeImagem(CABECA_JPEG)).toBe('image/jpeg');
  });

  it('⚠️ recusa um HTML que se diz PNG — é o caso que motivou a conferência', () => {
    // `<!doctype h` em bytes. O `type` do item diria `image/png`; os bytes não.
    const html = bytes(0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65);
    expect(assinaturaDeImagem(html)).toBeNull();
  });

  it('recusa PNG com os quatro primeiros bytes certos e o resto trocado', () => {
    // Só `89 50 4E 47` não basta: os quatro seguintes são o que denuncia
    // arquivo corrompido por transferência de texto.
    expect(assinaturaDeImagem(bytes(0x89, 0x50, 0x4e, 0x47, 0x0a, 0x0a, 0x1a, 0x0a))).toBeNull();
  });

  it('recusa arquivo curto demais para ter assinatura', () => {
    expect(assinaturaDeImagem(bytes(0x89, 0x50))).toBeNull();
    expect(assinaturaDeImagem(bytes())).toBeNull();
  });

  it('recusa GIF, WEBP e PDF — não entram por colagem', () => {
    expect(assinaturaDeImagem(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00))).toBeNull();
    expect(assinaturaDeImagem(bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00))).toBeNull();
    expect(assinaturaDeImagem(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toBeNull();
  });

  it('oito bytes bastam — não se lê o arquivo inteiro para saber o tipo', () => {
    expect(BYTES_DA_ASSINATURA).toBe(8);
  });

  it('o tipo devolvido é sempre um dos que a ficha sabe pré-visualizar', () => {
    for (const t of TIPOS_QUE_SE_COLAM) expect(imagem(t)).toBe(true);
  });
});

/* ───────────────────────────── o rótulo declarado ───────────────────────── */

describe('a lista curta do que se cola', () => {
  it('aceita png e jpeg', () => {
    expect(ehTipoQueSeCola('image/png')).toBe(true);
    expect(ehTipoQueSeCola('image/jpeg')).toBe(true);
  });

  it('aceita com parâmetro e em maiúscula — o navegador escreve dos dois jeitos', () => {
    expect(ehTipoQueSeCola('IMAGE/PNG')).toBe(true);
    expect(ehTipoQueSeCola('image/jpeg; charset=binary')).toBe(true);
    expect(ehTipoQueSeCola(' image/png ')).toBe(true);
  });

  it('recusa o resto', () => {
    for (const t of ['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', '']) {
      expect(ehTipoQueSeCola(t)).toBe(false);
    }
  });

  it('⚠️ recusa `image/svg+xml` — SVG é documento que executa, não print', () => {
    expect(ehTipoQueSeCola('image/svg+xml')).toBe(false);
  });
});

/* ───────────────────────────── colar texto ───────────────────────────── */

describe('⚠️ colar texto continua colando texto', () => {
  const texto = { kind: 'string', type: 'text/plain' };
  const html = { kind: 'string', type: 'text/html' };
  const png = { kind: 'file', type: 'image/png' };
  const jpeg = { kind: 'file', type: 'image/jpeg' };

  it('print de tela: só o arquivo, sem texto nenhum → anexa', () => {
    expect(deveAnexar([png])).toBe(true);
  });

  it('“copiar imagem” numa página: arquivo + marcação, sem texto puro → anexa', () => {
    expect(deveAnexar([html, png])).toBe(true);
  });

  it('texto puro → NÃO mexe', () => {
    expect(deveAnexar([texto, html])).toBe(false);
    expect(deveAnexar([texto])).toBe(false);
  });

  it('⚠️ texto E imagem juntos (planilha, e-mail) → NÃO mexe, o texto ganha', () => {
    expect(deveAnexar([texto, html, png])).toBe(false);
  });

  it('colagem vazia → não mexe', () => {
    expect(deveAnexar([])).toBe(false);
  });

  it('arquivo que não é imagem → não mexe', () => {
    expect(deveAnexar([{ kind: 'file', type: 'application/pdf' }])).toBe(false);
    expect(deveAnexar([{ kind: 'file', type: 'application/zip' }])).toBe(false);
  });

  it('dois itens de imagem de uma vez → anexa', () => {
    expect(deveAnexar([png, jpeg])).toBe(true);
  });

  it('imagem como `string` e não como `file` → não mexe', () => {
    // Um item de texto com `type` de imagem não é arquivo nenhum; `getAsFile`
    // devolveria `null` e o envio iria vazio.
    expect(deveAnexar([{ kind: 'string', type: 'image/png' }])).toBe(false);
  });
});

/* ───────────────────────────── o nome ───────────────────────────── */

describe('o nome do anexo é nosso, e nunca o que veio de fora', () => {
  const QUANDO = new Date(2026, 8, 4, 10, 32, 7);

  it('diz quando o print foi colado', () => {
    expect(nomeDaColagem('image/png', QUANDO)).toBe('print-2026-09-04-10h32m07.png');
  });

  it('jpeg vira `.jpg`, que é o que a pessoa reconhece', () => {
    expect(nomeDaColagem('image/jpeg', QUANDO)).toBe('print-2026-09-04-10h32m07.jpg');
  });

  it('dois prints na mesma colagem não colidem', () => {
    expect(nomeDaColagem('image/png', QUANDO, 0)).toBe('print-2026-09-04-10h32m07.png');
    expect(nomeDaColagem('image/png', QUANDO, 1)).toBe('print-2026-09-04-10h32m07-2.png');
    expect(nomeDaColagem('image/png', QUANDO, 2)).toBe('print-2026-09-04-10h32m07-3.png');
  });

  it('mês e dia de um dígito saem com zero à esquerda', () => {
    expect(nomeDaColagem('image/png', new Date(2026, 0, 5, 9, 3, 1))).toBe(
      'print-2026-01-05-09h03m01.png',
    );
  });

  it('⚠️ o nome gerado passa nas travas que o banco impõe ao anexo', () => {
    // `is_meaningful_name` recusa nome só de pontuação, e `conferirArquivo`
    // recusa nome vazio. Um nome gerado que não passasse aqui só apareceria em
    // produção, no primeiro print colado.
    expect(conferirArquivo(nomeDaColagem('image/png', QUANDO), 1024)).toBeNull();
    expect(conferirArquivo(nomeDaColagem('image/jpeg', QUANDO, 3), 1024)).toBeNull();
  });

  it('e não tem barra, acento nem espaço — coisas que o nome de fora traria', () => {
    const n = nomeDaColagem('image/png', QUANDO, 1);
    expect(n).toMatch(/^[a-z0-9.-]+$/);
  });
});

/* ───────────────────────────── a conferência inteira ───────────────────── */

describe('conferirImagemColada', () => {
  const QUANDO = new Date(2026, 8, 4, 10, 32, 7);

  it('PNG de verdade passa, com tipo e nome', () => {
    expect(conferirImagemColada(CABECA_PNG, QUANDO)).toEqual({
      ok: true,
      tipo: 'image/png',
      nome: 'print-2026-09-04-10h32m07.png',
    });
  });

  it('o que não é imagem é recusado com frase que diz o que houve', () => {
    const r = conferirImagemColada(bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x00, 0x00), QUANDO);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('deveria ter recusado');
    expect(r.motivo).toContain('PNG');
    expect(r.motivo).toContain('JPEG');
    // "falhou" não serve: a frase tem que dizer que o problema é o arquivo.
    expect(r.motivo).not.toMatch(/falhou|erro inesperado/i);
  });

  it('⚠️ o tipo GRAVADO é o dos bytes — um JPEG rotulado de PNG vira `image/jpeg`', () => {
    const r = conferirImagemColada(CABECA_JPEG, QUANDO);
    expect(r).toMatchObject({ ok: true, tipo: 'image/jpeg' });
  });
});

/* ───────────────────────────── o teto ───────────────────────────── */

describe('⚠️ o teto continua tendo um dono só', () => {
  it('a colagem não define teto nenhum — quem confere é `conferirArquivo`', async () => {
    const fonte = await import('node:fs').then((fs) =>
      fs.readFileSync('src/board/colar-imagem.ts', 'utf8'),
    );
    // O número 5, o `1024` e o `1048576` não podem aparecer como REGRA no
    // arquivo. Aparecer na medição documentada do cabeçalho é outra coisa.
    const codigo = fonte
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('/*'))
      .join('\n');
    expect(codigo).not.toContain('1024');
    expect(codigo).not.toContain('TETO_DE_BYTES');
  });

  it('a recusa por tamanho é a mesma do botão de clipe, e diz os dois números', () => {
    const nome = nomeDaColagem('image/png', new Date(2026, 8, 4, 10, 32, 7));
    // 10,6 MB — o ruído puro de 2560×1440 medido nesta etapa, que é o pior caso
    // teórico de um print. A frase tem que trazer OS DOIS números.
    const recusa = conferirArquivo(nome, 11_063_296);
    expect(recusa).toContain('tem 11 MB');
    expect(recusa).toContain('o teto é 5 MB');
  });

  it('⚠️ a frase fica ambígua no primeiro byte acima do teto — dívida, não desta etapa', () => {
    // `tamanhoLegivel` arredonda, e `TETO_DE_BYTES + 1` sai "5 MB" nos DOIS
    // lados: *"O arquivo tem 5 MB e o teto é 5 MB"*. É a mesma frase que o botão
    // de clipe já dava antes desta etapa — o defeito é de `tamanhoLegivel`, e
    // consertá-lo aqui mudaria a recusa de um caminho que não é o desta etapa.
    // Fica medido e registrado no plano.
    expect(conferirArquivo('x.png', TETO_DE_BYTES + 1)).toContain('tem 5 MB e o teto é 5 MB');
  });

  it('um print medido de verdade (0,80 MB, tela 1920×1080) passa folgado', () => {
    // O número é medido, não estimado: ver o cabeçalho de `colar-imagem.ts`.
    expect(conferirArquivo('print-2026-09-04-10h32m07.png', 833_737)).toBeNull();
    expect(833_737).toBeLessThan(TETO_DE_BYTES);
  });
});
