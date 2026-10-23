/**
 * Mural e Captação — etapa F4.10.
 *
 * As duas últimas abas do Sistema IDE. Ficam no mesmo módulo porque são as duas
 * menores e compartilham a mesma regra de permissão: quem enxerga o cliente
 * cuida das duas.
 *
 * O NOME DE QUEM CAPTOU VEM DO DIRETÓRIO
 *   Mesma armadilha da F4.8 e da F4.9: a política de `profiles` mostra só o
 *   próprio perfil, então junção direta devolveria vazio em vez de erro.
 */

import { type Sql, type Tx, arrayOuNulo, withActor } from '@/server/db';
import { type AuthenticatedActor, asDbActor } from '@/server/session';

/* ─────────────────────────── vocabulário ─────────────────────────── */

export const CORES_DA_NOTA = ['yellow', 'green', 'blue', 'red'] as const;
export type CorDaNota = (typeof CORES_DA_NOTA)[number];

export const ESTADOS_DA_CAPTACAO = ['recorded', 'in_edit', 'edited', 'published'] as const;
export type EstadoDaCaptacao = (typeof ESTADOS_DA_CAPTACAO)[number];

export const TIPOS_DE_CAPTACAO = [
  'testimonial',
  'event',
  'institutional',
  'product',
  'promotional',
  'other',
] as const;
export type TipoDeCaptacao = (typeof TIPOS_DE_CAPTACAO)[number];

export class MuralRefused extends Error {
  readonly status: 400 | 403 | 404;

  constructor(message: string, status: 400 | 403 | 404) {
    super(message);
    this.name = 'MuralRefused';
    this.status = status;
  }
}

/**
 * Valor fora do vocabulário é recusa, não `default` silencioso — regra 3 do
 * roteiro. O banco recusaria de qualquer jeito; aqui a frase é legível.
 */
function umDe<T extends string>(lista: readonly T[], valor: unknown, campo: string): T {
  if (typeof valor === 'string' && (lista as readonly string[]).includes(valor)) return valor as T;
  throw new MuralRefused(`${campo} desconhecido: "${String(valor)}".`, 400);
}

const comoDia = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const inteiroNaoNegativo = (v: unknown, padrao: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : padrao;
};

function traduzir(erro: unknown): never {
  const e = erro as { code?: string; message?: string; constraint_name?: string };
  if (e.code === '42501') throw new MuralRefused(e.message ?? 'Sem permissão.', 403);
  // 31 de fevereiro: a forma `AAAA-MM-DD` passa por `conferirCaptacao`, mas só o
  // Postgres sabe dizer que o dia não existe — e era 500.
  if (e.code === '22008' || e.code === '22007') {
    throw new MuralRefused('Esse dia não existe no calendário.', 400);
  }
  if (e.constraint_name === 'mural_notes_content_not_blank') {
    throw new MuralRefused('A nota precisa de conteúdo.', 400);
  }
  if (e.constraint_name === 'video_captures_count_positive') {
    throw new MuralRefused('Uma gravação tem pelo menos um vídeo.', 400);
  }
  throw erro;
}

/* ─────────────────────────── mural ─────────────────────────── */

export type Nota = {
  id: string;
  title: string | null;
  content: string;
  color: CorDaNota;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  /**
   * O nome da conexão de IA pela qual a nota foi escrita (F26.2), para o selo
   * de origem da F26.9. Nulo = escrita por gente.
   */
  viaName: string | null;
  /**
   * Quem pediu à IA — o autor da nota, SÓ quando `viaName` existe. O mural não
   * mostra autor de nota humana, e o selo é o único lugar que o nomeia.
   */
  viaAuthorName: string | null;
};

export async function readMural(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<Nota[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select id, title, content, color, position_x, position_y, width, height,
             via_name,
             -- O nome vem do diretório (ver o cabeçalho), e só para a linha de IA.
             case when via_name is not null
                  then ideworks.display_name(created_by) end as via_author_name
        from ideworks.mural_notes
       where client_id = ${clientId}
       order by created_at`;

    return linhas.map((r) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? null,
      content: r.content as string,
      color: r.color as CorDaNota,
      positionX: Number(r.position_x),
      positionY: Number(r.position_y),
      width: Number(r.width),
      height: Number(r.height),
      viaName: (r.via_name as string | null) ?? null,
      viaAuthorName: (r.via_author_name as string | null) ?? null,
    }));
  });
}

export type EntradaDeNota = {
  title: string | null;
  content: string;
  color: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
};

/**
 * A conferência da nota nova, sem banco: conteúdo em branco e cor fora do
 * vocabulário são recusados com frase.
 *
 * Roda no invólucro da tela ANTES de abrir a transação, e de novo no miolo,
 * para o caminho do agente que chama o miolo direto. É pura, então rodar duas
 * vezes não muda nada além de repetir a mesma recusa.
 */
function conferirNotaNova(e: Partial<EntradaDeNota>): { conteudo: string; cor: CorDaNota } {
  const conteudo = (e.content ?? '').trim();
  if (conteudo === '') throw new MuralRefused('A nota precisa de conteúdo.', 400);
  const cor = umDe(CORES_DA_NOTA, e.color ?? 'yellow', 'Cor');
  return { conteudo, cor };
}

/**
 * Posição e tamanho gravam em coluna `integer`, e quem manda é o navegador com
 * o que MEDIU: arrastar a nota até a borda do quadro manda `larguraDoQuadro -
 * larguraDaNota`, com a fração do `getBoundingClientRect`, e o Postgres recusa
 * "803.5" para `integer` — a pessoa ouvia "Não foi possível mover a nota". Aqui
 * a medida é arredondada; o que nem é número é recusa com frase. Ausente é
 * "não mexer" (`null`).
 */
function emPixels(v: unknown, campo: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new MuralRefused(`${campo} inválida: mande um número.`, 400);
  }
  return Math.round(v);
}

/** A mesma conferência para a edição, onde campo ausente é "não mexer". */
function conferirEdicaoDaNota(e: Partial<EntradaDeNota>): {
  conteudo: string | null;
  cor: CorDaNota | null;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
} {
  const cor = e.color === undefined ? null : umDe(CORES_DA_NOTA, e.color, 'Cor');
  const conteudo = e.content === undefined ? null : e.content.trim();
  if (conteudo !== null && conteudo === '') {
    throw new MuralRefused('A nota precisa de conteúdo.', 400);
  }
  return {
    conteudo,
    cor,
    positionX: emPixels(e.positionX, 'Posição horizontal'),
    positionY: emPixels(e.positionY, 'Posição vertical'),
    width: emPixels(e.width, 'Largura'),
    height: emPixels(e.height, 'Altura'),
  };
}

export async function createNota(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  e: Partial<EntradaDeNota>,
): Promise<string> {
  conferirNotaNova(e);

  // O autor é quem está logado — sai da sessão, nunca do corpo do pedido.
  return withActor(sql, asDbActor(actor), (tx) => createNotaInTx(tx, clientId, e, actor.userId));
}

/**
 * O MIOLO do criar nota, no `Tx` de quem chama — F26.3, mesmo padrão de
 * `postCommentInTx` (`server/board-anexos.ts`).
 *
 * Recebe um `Tx` JÁ ABERTO, com o ator declarado; não chama `withActor` nem
 * `sql.begin`. A tela chama por `createNota`; o agente (F26.6) chama direto de
 * dentro do `mutate` de `runAgentWrite`, no `sqlTx` do registro — o invólucro
 * abriria uma segunda transação fora do ledger.
 *
 * `autorId` é parâmetro de quem chama, e quem chama é código confiável: a tela
 * passa a pessoa logada; o agente, o dono da concessão. Numa sessão de agente
 * o gatilho da F26.2 regrava `created_by` com quem age de qualquer jeito; na
 * sessão humana ninguém confere, e por isso o valor nunca vem do pedido.
 *
 * A TRADUÇÃO DE ERRO MORA AQUI: a recusa do gatilho `agent_client_record_guard`
 * (42501, com frase) sai como `MuralRefused` legível para os dois chamadores.
 */
export async function createNotaInTx(
  tx: Tx,
  clientId: string,
  e: Partial<EntradaDeNota>,
  autorId: string,
): Promise<string> {
  const { conteudo, cor } = conferirNotaNova(e);

  try {
    const [criada] = await tx`
      insert into ideworks.mural_notes
        (client_id, title, content, color, position_x, position_y, created_by)
      values (${clientId},
              ${(e.title ?? '').trim() === '' ? null : (e.title as string).trim()},
              ${conteudo}, ${cor}::ideworks.note_color,
              ${inteiroNaoNegativo(e.positionX, 0)},
              ${inteiroNaoNegativo(e.positionY, 0)},
              ${autorId})
      returning id`;
    if (!criada) throw new MuralRefused('Cliente não encontrado, ou fora do seu alcance.', 403);
    return criada.id as string;
  } catch (erro) {
    if (erro instanceof MuralRefused) throw erro;
    traduzir(erro);
  }
}

/**
 * Atualiza a nota — inclusive só a posição.
 *
 * Arrastar um post-it grava posição a cada solta, e nada mais. Por isso os
 * campos são opcionais: mandar o conteúdo junto numa gravação de arrasto
 * sobrescreveria o que outra pessoa acabou de escrever na mesma nota.
 */
export async function updateNota(
  sql: Sql,
  actor: AuthenticatedActor,
  notaId: string,
  e: Partial<EntradaDeNota>,
): Promise<void> {
  conferirEdicaoDaNota(e);

  return withActor(sql, asDbActor(actor), (tx) => updateNotaInTx(tx, notaId, e));
}

/**
 * O MIOLO do editar nota, no `Tx` de quem chama — F26.3. Mesmo contrato de
 * `createNotaInTx`: sem `withActor`, sem `begin`, tradução de erro aqui.
 *
 * Não há conferência de autoria neste arquivo, e é o desenho: na sessão de
 * agente, quem recusa editar a nota de outra pessoa é o gatilho
 * `agent_client_record_guard` (F26.2), e a frase dele sobe como `MuralRefused`
 * 403 pelo `traduzir`.
 */
export async function updateNotaInTx(
  tx: Tx,
  notaId: string,
  e: Partial<EntradaDeNota>,
): Promise<void> {
  const { conteudo, cor, positionX, positionY, width, height } = conferirEdicaoDaNota(e);

  try {
    const alteradas = await tx`
      update ideworks.mural_notes
         set title      = case when ${e.title === undefined} then title
                               else nullif(btrim(${e.title ?? ''}), '') end,
             content    = coalesce(${conteudo}, content),
             color      = coalesce(${cor}::ideworks.note_color, color),
             position_x = coalesce(${positionX}::integer, position_x),
             position_y = coalesce(${positionY}::integer, position_y),
             width      = coalesce(${width}::integer, width),
             height     = coalesce(${height}::integer, height),
             updated_at = now()
       where id = ${notaId}
       returning id`;

    if (alteradas.length === 0) {
      throw new MuralRefused('Nota não encontrada, ou fora do seu alcance.', 404);
    }
  } catch (erro) {
    if (erro instanceof MuralRefused) throw erro;
    traduzir(erro);
  }
}

export async function deleteNota(
  sql: Sql,
  actor: AuthenticatedActor,
  notaId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), (tx) => deleteNotaInTx(tx, notaId));
}

/**
 * O MIOLO do apagar nota, no `Tx` de quem chama — F26.8. O desfazer em lote
 * apaga a nota que a IA criou dentro da transação do DONO, junto com o carimbo
 * no registro. Sessão humana: o gatilho `agent_client_record_guard` deixa
 * passar, e quem decide o alcance é a política (`can_see_client`), que filtra
 * em silêncio — daí o `returning`.
 */
export async function deleteNotaInTx(tx: Tx, notaId: string): Promise<void> {
  try {
    const apagadas = await tx`delete from ideworks.mural_notes where id = ${notaId} returning id`;
    if (apagadas.length === 0) {
      throw new MuralRefused('Nota não encontrada, ou fora do seu alcance.', 404);
    }
  } catch (erro) {
    if (erro instanceof MuralRefused) throw erro;
    traduzir(erro);
  }
}

/* ─────────────────────────── captação ─────────────────────────── */

export type Captacao = {
  id: string;
  recordedOn: string;
  capturedBy: { id: string; name: string } | null;
  capturedByNote: string | null;
  videoCount: number;
  kinds: TipoDeCaptacao[];
  status: EstadoDaCaptacao;
  script: string | null;
  notes: string | null;
  totalMinutes: number | null;
};

export async function readCaptacoes(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
): Promise<Captacao[]> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`
      select v.id, v.recorded_on, v.captured_by, v.captured_by_note,
             v.video_count, v.kinds, v.status, v.script, v.notes, v.total_minutes,
             ideworks.display_name(v.captured_by) as captured_by_name
        from ideworks.video_captures v
       where v.client_id = ${clientId}
       order by v.recorded_on desc, v.created_at desc`;

    return linhas.map((r) => ({
      id: r.id as string,
      recordedOn: comoDia(r.recorded_on),
      capturedBy:
        r.captured_by === null
          ? null
          : {
              id: r.captured_by as string,
              name: (r.captured_by_name as string | null) ?? '(sem nome)',
            },
      capturedByNote: (r.captured_by_note as string | null) ?? null,
      videoCount: Number(r.video_count),
      kinds: (r.kinds as TipoDeCaptacao[]) ?? [],
      status: r.status as EstadoDaCaptacao,
      script: (r.script as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      totalMinutes: r.total_minutes === null ? null : Number(r.total_minutes),
    }));
  });
}

export type EntradaDeCaptacao = {
  recordedOn: string;
  capturedBy: string | null;
  capturedByNote: string | null;
  videoCount: number;
  kinds: string[];
  status: string;
  script: string | null;
  notes: string | null;
  totalMinutes: number | null;
};

function conferirCaptacao(e: Partial<EntradaDeCaptacao>) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.recordedOn ?? '')) {
    throw new MuralRefused('Informe a data da gravação.', 400);
  }
  const quantidade = Number(e.videoCount);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new MuralRefused('Uma gravação tem pelo menos um vídeo.', 400);
  }
  const minutos = e.totalMinutes ?? null;
  if (minutos !== null && (!Number.isInteger(Number(minutos)) || Number(minutos) < 0)) {
    throw new MuralRefused('Duração inválida.', 400);
  }

  return {
    recordedOn: e.recordedOn as string,
    capturedBy: e.capturedBy ?? null,
    capturedByNote: (e.capturedByNote ?? '').trim() === '' ? null : (e.capturedByNote as string).trim(),
    videoCount: quantidade,
    kinds: (e.kinds ?? []).map((k) => umDe(TIPOS_DE_CAPTACAO, k, 'Tipo de vídeo')),
    status: umDe(ESTADOS_DA_CAPTACAO, e.status ?? 'recorded', 'Estado'),
    script: (e.script ?? '').trim() === '' ? null : (e.script as string).trim(),
    notes: (e.notes ?? '').trim() === '' ? null : (e.notes as string).trim(),
    totalMinutes: minutos === null ? null : Number(minutos),
  };
}

export async function createCaptacao(
  sql: Sql,
  actor: AuthenticatedActor,
  clientId: string,
  entrada: Partial<EntradaDeCaptacao>,
): Promise<string> {
  const e = conferirCaptacao(entrada);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const [criada] = await tx`
        insert into ideworks.video_captures
          (client_id, recorded_on, captured_by, captured_by_note, video_count,
           kinds, status, script, notes, total_minutes, created_by)
        values (${clientId}, ${e.recordedOn}, ${e.capturedBy}, ${e.capturedByNote},
                ${e.videoCount}, coalesce(${arrayOuNulo(e.kinds)}::ideworks.capture_kind[], '{}'),
                ${e.status}::ideworks.capture_status,
                ${e.script}, ${e.notes}, ${e.totalMinutes}, ${actor.userId})
        returning id`;
      if (!criada) throw new MuralRefused('Cliente não encontrado, ou fora do seu alcance.', 403);
      return criada.id as string;
    } catch (erro) {
      if (erro instanceof MuralRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function updateCaptacao(
  sql: Sql,
  actor: AuthenticatedActor,
  captacaoId: string,
  entrada: Partial<EntradaDeCaptacao>,
): Promise<void> {
  const e = conferirCaptacao(entrada);

  return withActor(sql, asDbActor(actor), async (tx) => {
    try {
      const alteradas = await tx`
        update ideworks.video_captures
           set recorded_on      = ${e.recordedOn},
               captured_by      = ${e.capturedBy},
               captured_by_note = ${e.capturedByNote},
               video_count      = ${e.videoCount},
               kinds            = coalesce(${arrayOuNulo(e.kinds)}::ideworks.capture_kind[], '{}'),
               status           = ${e.status}::ideworks.capture_status,
               script           = ${e.script},
               notes            = ${e.notes},
               total_minutes    = ${e.totalMinutes},
               updated_at       = now()
         where id = ${captacaoId}
         returning id`;

      if (alteradas.length === 0) {
        throw new MuralRefused('Gravação não encontrada, ou fora do seu alcance.', 404);
      }
    } catch (erro) {
      if (erro instanceof MuralRefused) throw erro;
      traduzir(erro);
    }
  });
}

export async function deleteCaptacao(
  sql: Sql,
  actor: AuthenticatedActor,
  captacaoId: string,
): Promise<void> {
  return withActor(sql, asDbActor(actor), async (tx) => {
    const apagadas = await tx`
      delete from ideworks.video_captures where id = ${captacaoId} returning id`;
    if (apagadas.length === 0) {
      throw new MuralRefused('Gravação não encontrada, ou fora do seu alcance.', 404);
    }
  });
}
