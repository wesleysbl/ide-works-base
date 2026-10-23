/**
 * A aritmética e o vocabulário da grade do mês — etapa F17.40.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO É UM ARQUIVO SEPARADO DO COMPONENTE
 *   `GradeDoMes.tsx` desenha; aqui mora o que dá para provar sem desenhar nada.
 *   A suíte roda em `node`, sem DOM, e assim as contas de dia — que são a parte
 *   perigosa — têm teste de verdade em vez de inspeção visual.
 *
 * ARITMÉTICA DE DIA, SEM `Date`
 *   A grade era montada com `new Date(Date.UTC(...))` e o fim do período com
 *   `toISOString().slice(0, 10)`. Existe tarefa real com prazo `82025-08-07`, e
 *   `toISOString` devolve `+082025-08-07` — todo `slice(0, 10)` corta errado.
 *
 *   Aqui a conta inteira passa por `@/board/calendario`, que faz dia civil em
 *   número inteiro e é exato em qualquer ano. Para os meses que existem hoje o
 *   resultado é idêntico ao que a grade desenhava antes, e há teste que compara
 *   os dois caminhos mês a mês.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type Day, parseDay } from '@/board/board';
import { diaDaSemana, diasDesdeEpoca, iso, mesVizinho, somarDias } from '@/board/calendario';
import { ROTULO_DO_TIPO_DE_CONTEUDO, nomeDoItem } from '@/clients/nome-do-item';
import type { Periodo } from '@/ui/SeletorDePeriodo';

/**
 * O que cai num dia — o que o servidor devolve em `GET /calendar`.
 *
 * ⚠️ DUAS NATUREZAS, E A DIFERENÇA NÃO É DE ROTULO — F17.44:
 *
 *   `entrega`      é conteúdo, e **conta na cota do mês**
 *   `compromisso`  ocupa o dia e **não conta** — reunião, gravação, viagem
 *
 * Elas vêm de tabelas diferentes de propósito. Se compromisso entrasse na
 * conta, o medidor de entrega do cliente passaria a mentir.
 */
export type EntradaDoMes = {
  /** `delivery` e `appointment` no servidor; aqui a tela lê em português. */
  kind: 'delivery' | 'appointment';
  id: string;
  clientId: string;
  clientName: string;
  /** Vazio no compromisso: ele não é conteúdo, e a pergunta não se aplica. */
  contentType: string;
  /** Dia civil `AAAA-MM-DD`, já no fuso da agência. */
  day: string;
  /**
   * `HH:MM`. ⚠️ Só o compromisso tem hora — a entrega se agenda por DIA, e a
   * hora que o banco guardava nela era subproduto de fuso, nunca escolha de
   * ninguém. Ver a nota em `src/server/calendar.ts`.
   */
  time: string | null;
  title: string | null;
  isExtra: boolean;
  isCompleted: boolean;
  /** O que não coube no nome do compromisso. Sempre nulo na entrega. */
  notes: string | null;
};

export const ehCompromisso = (e: EntradaDoMes) => e.kind === 'appointment';

/**
 * A pergunta antes de apagar, ou `null` quando se pode apagar direto.
 *
 * ENTREGA JÁ FEITA NÃO SE APAGA COM UM CLIQUE. A rota apaga de verdade, sem
 * confirmação, com o argumento de que "item vazio não tem histórico a perder" —
 * o que não vale para o que já foi marcado como feito: apagar tira a entrega do
 * mês e do medidor do cliente, calado, e ninguém vê que sumiu. A grade semanal
 * já tinha a mesma regra no `−` (só remove o que não foi concluído); a janela do
 * Calendário e do Planejamento não tinha. Compromisso e entrega por fazer
 * seguem apagando direto, como sempre.
 */
export function perguntaAntesDeApagar(e: EntradaDoMes): string | null {
  if (ehCompromisso(e) || !e.isCompleted) return null;
  return 'Esta entrega já foi marcada como feita. Apagar tira a entrega do mês e do medidor de entrega do cliente, e não há como desfazer. Apagar mesmo?';
}

/** Fim EXCLUSIVO: `to` é o primeiro dia de fora, como o servidor espera. */
export type Janela = { from: string; to: string };

/**
 * `de-todos` — o calendário geral: o conteúdo diz de quem é e leva à ficha.
 * `de-um-cliente` — a aba de dentro da ficha: o conteúdo diz o que é, e não
 * leva a lugar nenhum, porque já se está lá.
 */
export type Lente = 'de-todos' | 'de-um-cliente';

export const DIAS_DA_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export const TIPO_ROTULO: Record<string, string> = {
  video: 'Vídeo',
  arte: 'Arte',
  foto: 'Foto',
  ads: 'Ads',
};

/**
 * A cor de cada tipo é a MESMA em toda a aplicação — etapa F4.3.
 *
 * Antes o calendário tinha paleta própria (violeta, azul, âmbar, rosa) e o
 * painel tinha outra. O mesmo vídeo era roxo aqui e azul lá, e a cor deixava de
 * ser informação para virar decoração. Agora as quatro saem do prisma do
 * OBSIDIAN, as mesmas cinco luzes do plano do Grupo Ide.
 *
 * ⚠️ MENOS A ARTE, desde a F43 Fase 5. A luz da agência é o `#00ff66` do botão
 * principal e do lugar atual; arte pintada com ela fazia meio calendário
 * parecer ação. Ela ganhou `--tipo-arte`, um lilás fora do prisma.
 */
export const TIPO_COR: Record<string, string> = {
  video: 'var(--luz-ia)',
  arte: 'var(--tipo-arte)',
  foto: 'var(--luz-estudio)',
  ads: 'var(--luz-lives)',
};

/**
 * A cor do tipo pinta o ÍCONE, e só ele — F43 Fase 5.
 *
 * A história tem dois passos. Na F17.37 a cor saiu da LETRA (a 11px, a luz do
 * tipo como tinta media 2,43 no pior caso, e a régua pede 7:1) e foi para o
 * contorno e o fundo da pastilha. Na F43 ela sai também do contorno e do fundo:
 * um calendário de 117 conteúdos virava 117 retângulos tingidos com fio
 * colorido, e a grade inteira gritava. A pastilha agora é neutra, o nome fica
 * na tinta do texto, e a cor mora no ícone pequeno ao lado — que já dizia o
 * tipo pela FORMA (F16), então a cor nunca é o único sinal.
 *
 * Ícone não é letra: a régua dele é a de elemento gráfico (3:1), e as cinco
 * cores passam dela nos dois temas.
 */
export const corDoTipo = (tipo: string): string => TIPO_COR[tipo] ?? 'var(--mute)';

/**
 * A quinta luz do prisma é a do compromisso — F17.44.
 *
 * `--luz-filmes` é uma luz que nenhum tipo de conteúdo usa (a da agência também
 * saiu dos tipos na F43, mas ela é o verde da ação), e é isso que a faz
 * servir: a cor não diz "mais um tipo", diz "isto não é conteúdo".
 * Ela é branca no tema escuro e quase preta no claro, então lida ao lado das
 * quatro cores de tipo ela é a ausência de cor de tipo.
 *
 * Desde a F43 Fase 5 ela pinta só o relógio do compromisso, como as outras
 * quatro pintam só o ícone do tipo (ver `corDoTipo`).
 */
export const COR_DO_COMPROMISSO = 'var(--luz-filmes)';

/** A cor do ícone da pastilha, seja ela conteúdo ou compromisso. */
export const corDaEntrada = (e: EntradaDoMes): string =>
  ehCompromisso(e) ? COR_DO_COMPROMISSO : corDoTipo(e.contentType);

/**
 * Soma um dia sem passar por `Date`.
 *
 * O que não se consegue ler como dia volta como veio — encolher `82025` para
 * caber em quatro casas seria inventar uma data, e o seletor de período nunca
 * produz outra coisa que não `AAAA-MM-DD`.
 */
export const somarUmDia = (data: string): string => {
  const d = parseDay(data);
  return d === null ? data : iso(somarDias(d, 1));
};

/**
 * O instante com que se agenda um conteúdo NO DIA escolhido.
 *
 * ⚠️ MEIO-DIA DE PROPÓSITO, e isto foi medido na F17.42: `scheduled_at` é um
 * instante, e `T00:00:00Z` cairia no dia ANTERIOR no fuso da agência. Meio-dia
 * sobra folga para os dois lados.
 *
 * A hora resultante **não é informação** — é o preço de guardar um dia dentro
 * de um instante. Por isso o calendário não a mostra mais (F17.44).
 *
 * Mora aqui, e não dentro da tela semanal, porque agora são duas telas que
 * agendam conteúdo: a semanal e o calendário. Duas cópias da convenção seriam
 * duas chances de uma delas virar `T00:00:00Z` sem ninguém notar.
 */
export const meioDiaDoDia = (dia: string) => `${dia}T12:00:00Z`;

/**
 * O mês de competência de um dia, no formato que `POST /items` espera.
 *
 * ⚠️ Passa por `parseDay`, e não por `dia.slice(0, 7)`: existe prazo real
 * `82025-08-07` neste banco, e recortar por posição inventaria o mês `8202`.
 * O que não se consegue ler como dia volta `null`, e quem chamou decide.
 */
export function mesDoDia(dia: string): string | null {
  const d = parseDay(dia);
  return d === null ? null : `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-01`;
}

/**
 * O recorte que a tela lê: o período escolhido, ou o mês inteiro.
 *
 * Sem período escolhido é o mês todo, porque o contrato da agência é mensal —
 * é o recorte que a operação usa por padrão.
 */
export function janelaDoMes(mes: string, periodo: Periodo | null): Janela {
  if (periodo) return { from: periodo.de, to: somarUmDia(periodo.ate) };
  const [ano, m] = mes.split('-').map(Number);
  const seguinte = mesVizinho(ano, m, 1);
  return {
    from: iso({ year: ano, month: m, day: 1 }),
    to: iso({ year: seguinte.ano, month: seguinte.mes, day: 1 }),
  };
}

/**
 * As casas do mês, começando no domingo.
 *
 * `null` é o buraco antes do dia 1º. A grade NÃO completa a última semana com
 * os dias do mês seguinte, ao contrário da grade do seletor de tarefa: aqui
 * cada casa é grande e mostra conteúdo, e casa grande de outro mês pediria a
 * pergunta "por que este dia está vazio?".
 */
export function casasDoMes(mes: string): Array<string | null> {
  const [ano, m] = mes.split('-').map(Number);
  const primeiro: Day = { year: ano, month: m, day: 1 };
  const seguinte = mesVizinho(ano, m, 1);
  const total =
    diasDesdeEpoca({ year: seguinte.ano, month: seguinte.mes, day: 1 }) - diasDesdeEpoca(primeiro);
  return [
    ...Array.from({ length: diaDaSemana(primeiro) }, () => null),
    ...Array.from({ length: total }, (_, i) => iso({ ...primeiro, day: i + 1 })),
  ];
}

/** Agrupa os conteúdos por dia civil, que é a chave que a casa da grade usa. */
export function porDia(entradas: EntradaDoMes[]): Map<string, EntradaDoMes[]> {
  const mapa = new Map<string, EntradaDoMes[]>();
  for (const e of entradas) {
    const lista = mapa.get(e.day) ?? [];
    lista.push(e);
    mapa.set(e.day, lista);
  }
  return mapa;
}

/**
 * O que a pastilha escreve, por lente.
 *
 * No compromisso o rótulo é o NOME dele, e não uma palavra de categoria: quem
 * marcou "Gravação na loja" quer ler "Gravação na loja", e não "Compromisso".
 * De fora do cliente o nome dele vem junto, porque ali a primeira pergunta
 * continua sendo de quem é o dia.
 */
export function rotuloDaEntrada(e: EntradaDoMes, lente: Lente): string {
  if (ehCompromisso(e)) {
    const nome = e.title ?? 'Compromisso';
    return lente === 'de-todos' ? `${e.clientName} · ${nome}` : nome;
  }
  const tipo = TIPO_ROTULO[e.contentType] ?? e.contentType;
  if (lente === 'de-todos') return e.clientName;
  return e.title ? `${tipo} · ${e.title}` : tipo;
}

/** O que o cursor parado revela — tudo o que a pastilha teve de truncar. */
export function detalheDaEntrada(e: EntradaDoMes, lente: Lente): string {
  if (ehCompromisso(e)) {
    const partes = lente === 'de-todos' ? [e.clientName] : [];
    // "Compromisso" só aparece AQUI, no detalhe, e nunca na pastilha: na
    // pastilha ele roubaria o espaço do nome, que é a informação.
    partes.push('Compromisso');
    if (e.time) partes.push(e.time);
    if (e.title) partes.push(e.title);
    if (e.notes) partes.push(e.notes);
    return partes.join(' · ');
  }
  const tipo = TIPO_ROTULO[e.contentType] ?? e.contentType;
  const partes = lente === 'de-todos' ? [e.clientName, tipo] : [tipo];
  if (e.time) partes.push(e.time);
  if (e.title) partes.push(e.title);
  if (e.isExtra) partes.push('extra');
  return partes.join(' · ');
}

/* ─────────────────────────── F12 do plano UX ───────────────────────────
   Hoje, mês vizinho, nome acessível, dia cheio e agenda — tudo o que a grade
   e a agenda precisam decidir sem desenhar. As duas formas leem as MESMAS
   entradas de `useConteudosDoMes`; nada aqui busca dado. */


/** O fuso em que o servidor entrega o `day` de cada entrada (`AGENCY_TIMEZONE`). */
export const FUSO_DA_AGENCIA = 'America/Sao_Paulo';

/**
 * O formatador do dia da agência, criado UMA vez. Criar um `Intl.DateTimeFormat`
 * por chamada custa ~100 µs contra ~2 µs de reusar — e o Planejamento pede o
 * dia de cada peça várias vezes por desenho (`diaDoInstante`), o que são
 * centenas de milissegundos numa carteira cheia.
 */
const DIA_NA_AGENCIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_DA_AGENCIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * O dia de hoje NO FUSO DA AGÊNCIA — `AAAA-MM-DD`.
 *
 * ⚠️ A tela abria no mês de `new Date().toISOString().slice(0, 7)`, que é o
 * mês em UTC: no último dia do mês, a partir das 21h de Brasília, o calendário
 * abria no mês SEGUINTE. E o `day` das entradas já vem no fuso da agência —
 * então "hoje" tem de ser medido no mesmo relógio, qualquer que seja o fuso do
 * computador de quem olha.
 */
export function hojeNaAgencia(agora: Date = new Date()): string {
  return DIA_NA_AGENCIA.format(agora);
}


/**
 * O dia, NO FUSO DA AGÊNCIA, de um instante marcado (`scheduledAt` do servidor).
 *
 * ⚠️ `scheduledAt.slice(0, 10)` é o dia em UTC. A grade grava ao meio-dia
 * (`meioDiaDoDia`), e aí os dois relógios concordam; mas uma peça marcada às
 * 22h de Brasília chega como 01h do dia seguinte, e o recorte por posição a
 * jogava na célula do dia errado — no último dia do mês, no mês errado —
 * enquanto o Calendário (`readCalendar`) e a "última entrega" (`diaNaAgencia`)
 * a mostravam no dia certo. A Semanal, as Semanas e o Contrato do Planejamento
 * leem o dia por aqui, o mesmo relógio do Calendário.
 *
 * Só instante com fuso explícito (`Z` ou `±hh:mm`) é convertido. Dia puro
 * (`AAAA-MM-DD`) já é um dia, e o que não se lê como instante volta cortado em
 * dez posições como sempre voltou — sem estourar (`82025-08-07` existe no
 * banco).
 */
export function diaDoInstante(instante: string): string {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(instante) || !/T/i.test(instante)) return instante.slice(0, 10);
  const d = new Date(instante);
  return Number.isNaN(d.getTime()) ? instante.slice(0, 10) : hojeNaAgencia(d);
}

/**
 * O dia de um instante, escrito `DD/MM/AAAA`, NO FUSO DA AGÊNCIA.
 *
 * É o rótulo de data de tudo que o servidor carimba com hora — `createdAt`,
 * `completedAt`, `expiresAt`, `occurredAt`, `postedAt`. O corte por posição
 * (`instante.slice(0, 10)`) era o dia em UTC: às 21h de Brasília ele já é o
 * seguinte, e a etiqueta dizia "revogada em" um dia que ainda não tinha chegado.
 *
 * Para um DIA já escrito (`dueOn`, `happenedOn`, `recordedOn`) este não é o
 * lugar — dia puro não tem fuso e se formata sem passar por aqui. O que não se
 * lê como dia volta como veio, sem estourar.
 */
export function dataCurtaDoInstante(instante: string): string {
  const dia = diaDoInstante(instante);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return instante;
  return dia.split('-').reverse().join('/');
}

/** `AAAA-MM` do mês corrente, no fuso da agência. */
export const mesDeHoje = (agora: Date = new Date()) => hojeNaAgencia(agora).slice(0, 7);

/** O mês `passo` meses adiante (ou atrás), sem `Date`. */
export function deslocarMes(mes: string, passo: number): string {
  const [ano, m] = mes.split('-').map(Number);
  const v = mesVizinho(ano, m, passo);
  return `${String(v.ano).padStart(4, '0')}-${String(v.mes).padStart(2, '0')}`;
}

const MESES_POR_EXTENSO = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_POR_EXTENSO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "setembro de 2026". */
export function nomeDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES_POR_EXTENSO[m - 1] ?? mes} de ${ano}`;
}

/** "quinta, 12 de setembro" — o cabeçalho de um dia na agenda. */
export function nomeDoDia(dia: string): string {
  const d = parseDay(dia);
  if (d === null) return dia;
  return `${DIAS_POR_EXTENSO[diaDaSemana(d)]}, ${d.day} de ${MESES_POR_EXTENSO[d.month - 1]}`;
}

/** "qui" — a coluna estreita da agenda. */
export function diaCurtoDaSemana(dia: string): string {
  const d = parseDay(dia);
  return d === null ? '' : DIAS_CURTOS[diaDaSemana(d)];
}

/** O rótulo do tipo, ou "Compromisso" — a MESMA palavra na grade e na agenda. */
export function tipoDaEntrada(e: EntradaDoMes): string {
  if (ehCompromisso(e)) return 'Compromisso';
  return ROTULO_DO_TIPO_DE_CONTEUDO[e.contentType] ?? e.contentType;
}

/**
 * O nome acessível de uma entrada — R06/F12.
 *
 * O conteúdo reusa `nomeDoItem` (F11C): tipo, título ou "sem título", dia e
 * extra. Não se inventa título para o que não tem. De fora do cliente, o nome
 * do cliente vem primeiro, porque é a primeira pergunta do calendário geral.
 * O estado fecha a frase: "concluído" ou "pendente".
 */
export function nomeAcessivelDaEntrada(e: EntradaDoMes, lente: Lente): string {
  const quem = lente === 'de-todos' ? `${e.clientName} — ` : '';
  if (ehCompromisso(e)) {
    const titulo = e.title?.trim() ? ` “${e.title.trim()}”` : '';
    const dia = `, dia ${e.day.slice(8, 10)}/${e.day.slice(5, 7)}`;
    const hora = e.time ? `, às ${e.time}` : ', dia inteiro';
    return `${quem}Compromisso${titulo}${dia}${hora}`;
  }
  const nome = nomeDoItem({
    id: e.id,
    contentType: e.contentType,
    scheduledAt: e.day,
    isExtra: e.isExtra,
    title: e.title,
  });
  return `${quem}${nome}, ${e.isCompleted ? 'concluído' : 'pendente'}`;
}

/**
 * Quantas entradas cabem numa casa antes do "+N" — R06.
 *
 * Sem teto, o dia com nove conteúdos esticava a semana inteira e a primeira
 * metade do mês empurrava a segunda para fora da tela. Com teto, toda semana
 * tem a mesma altura até alguém pedir para ver o dia cheio.
 */
export const TETO_DA_CASA = 4;

/**
 * O que a casa mostra. Até o teto, tudo; acima dele, três e um "+N" — o botão
 * ocupa a quarta linha, e a casa não cresce por causa dele.
 */
export function recorteDaCasa<T>(lista: readonly T[], expandida: boolean): { mostrar: T[]; escondidos: number } {
  if (expandida || lista.length <= TETO_DA_CASA) return { mostrar: [...lista], escondidos: 0 };
  const mostrar = lista.slice(0, TETO_DA_CASA - 1);
  return { mostrar, escondidos: lista.length - mostrar.length };
}

/**
 * Os dias da agenda: só os que têm alguma coisa, em ordem, e HOJE sempre que
 * ele estiver na janela — "Hoje" é um lugar da agenda mesmo quando está vazio.
 */
export function diasDaAgenda(
  entradas: EntradaDoMes[],
  janela: Janela,
  hoje: string,
): Array<{ dia: string; entradas: EntradaDoMes[] }> {
  const mapa = porDia(entradas.filter((e) => e.day >= janela.from && e.day < janela.to));
  if (hoje >= janela.from && hoje < janela.to && !mapa.has(hoje)) mapa.set(hoje, []);
  return [...mapa.keys()].sort().map((dia) => ({ dia, entradas: mapa.get(dia) ?? [] }));
}

/* ─────────────────────────── a forma de ver ─────────────────────────── */

export type FormaDoCalendario = 'mes' | 'agenda';

export const FORMAS_DO_CALENDARIO = [
  { valor: 'mes', rotulo: 'Mês' },
  { valor: 'agenda', rotulo: 'Agenda' },
] as const;

/**
 * A forma com que a tela abre — F12. No celular, a agenda: sete colunas de
 * 50 px não leem nome nenhum. No desktop, o mês. Quem quiser a outra troca.
 */
export function formaInicial(): FormaDoCalendario {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639.98px)').matches
      ? 'agenda'
      : 'mes';
  } catch {
    return 'mes';
  }
}

/**
 * A ordem dentro de um dia — F12. Compromisso primeiro (é hora marcada: o dia
 * inteiro antes, depois pela hora), depois o conteúdo que falta, e por último
 * o concluído. Numa casa com teto, o que ainda pede ação não pode ficar
 * escondido atrás do "+N" enquanto o que já foi feito ocupa a vista. Dentro de
 * cada grupo, a ordem do servidor.
 */
export function ordenarNoDia(lista: readonly EntradaDoMes[]): EntradaDoMes[] {
  const peso = (e: EntradaDoMes) => (ehCompromisso(e) ? 0 : e.isCompleted ? 2 : 1);
  return lista
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const p = peso(a.e) - peso(b.e);
      if (p !== 0) return p;
      if (ehCompromisso(a.e) && ehCompromisso(b.e)) {
        const h = (a.e.time ?? '') < (b.e.time ?? '') ? -1 : (a.e.time ?? '') > (b.e.time ?? '') ? 1 : 0;
        if (h !== 0) return h;
      }
      return a.i - b.i;
    })
    .map(({ e }) => e);
}
