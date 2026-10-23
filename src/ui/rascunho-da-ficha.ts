/**
 * O rascunho DE UMA FICHA ABERTA — quando se grava, quando se oferece, quando
 * se cala. Etapa F17.AUD02.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO, REPRODUZIDO NA AUDITORIA DE 09/09/2026 (achado 7)
 *
 *   Guardar um rascunho com o nome preenchido; abrir `Novo cliente`; não
 *   clicar em Recuperar nem em Descartar; esperar 800 ms. A chave passava a
 *   conter nome VAZIO. O efeito de gravação automática disparava assim que a
 *   ficha terminava de carregar — com o formulário vazio — por cima do
 *   rascunho que a tela ainda estava oferecendo. A cópia antiga sobrevivia na
 *   memória do componente, então Recuperar funcionava nessa primeira abertura;
 *   fechar e abrir de novo já não achava nada.
 *
 * A REGRA QUE ESTE ARQUIVO ESCREVE
 *   A recuperação tem quatro estados, e só três deles gravam:
 *
 *     sem-rascunho ─┐
 *     recuperado   ─┼─ grava o que MUDOU em relação ao carregado
 *     descartado   ─┘
 *     pendente     ── não grava nada: há uma decisão em aberto
 *
 *   E "mudou" é estrutural: o formulário é comparado com o que a ficha
 *   carregou do sistema e com o que já está guardado. Abrir e fechar sem tocar
 *   em nada não escreve; digitar e voltar ao original apaga o rascunho, porque
 *   ele passou a ser igual ao que está salvo.
 *
 * O DONO VEM DE FORA, E SEM ELE NADA ACONTECE
 *   `abrir(ficha)` recebe a ficha COM o usuário confirmado pela sessão — ver
 *   `ui/rascunho.ts`. Enquanto a sessão carrega (ou falhou), `abrir(null)`
 *   deixa tudo suspenso: sem oferta, sem gravação, sem temporizador. Trocar de
 *   dono cancela o que estava agendado SEM gravar: o dado na tela é de quem
 *   saiu, e gravá-lo sob o nome de quem entrou seria atribuir por suposição.
 *
 * FECHAR CONCLUI, SAIR CANCELA
 *   `encerrar` é o fechamento normal da ficha: se há gravação agendada, ela é
 *   feita agora, para o meio segundo de espera não perder a última linha
 *   digitada. `abrir(null)` é a saída da sessão: cancela sem gravar.
 *
 * POR QUE UM ARQUIVO SÓ PARA ISTO
 *   A ficha tinha a decisão espalhada por três `useEffect` que se olhavam por
 *   `carregando` e `salvando`, e foi assim que o vazio passou por cima do
 *   rascunho. Aqui a decisão é uma máquina pequena, sem React, com relógio
 *   injetável — e se prova com temporizadores falsos, que é como a suíte roda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  type Ficha,
  type Rascunho,
  apagarRascunho,
  guardarRascunho,
  lerRascunho,
} from '@/ui/rascunho';

export type Recuperacao = 'sem-rascunho' | 'pendente' | 'recuperado' | 'descartado';

export type EstadoDoRascunho<T> = {
  recuperacao: Recuperacao;
  /** O rascunho OFERECIDO — existe só em `pendente`. Quem aplica é a pessoa. */
  oferecido: Rascunho<T> | null;
};

export const SEM_RASCUNHO: EstadoDoRascunho<never> = { recuperacao: 'sem-rascunho', oferecido: null };

/** O relógio, injetável para a suíte. O padrão é o do ambiente. */
export type Relogio = {
  agendar: (acao: () => void, ms: number) => unknown;
  cancelar: (id: unknown) => void;
};

export type OpcoesDoRascunho<T> = {
  /** Meio segundo: gravar a cada letra faria 400 escritas num endereço. */
  atraso?: number;
  relogio?: Relogio;
  /** Comparação estrutural. O padrão serve a qualquer formulário de JSON. */
  iguais?: (a: T, b: T) => boolean;
  /** Para a tela redesenhar quando a recuperação muda de estado. */
  aoMudar?: (estado: EstadoDoRascunho<T>) => void;
};

export type RascunhoDaFicha<T> = {
  /**
   * A ficha com dono confirmado — ou `null` enquanto não há. Mudar de ficha ou
   * de dono recomeça: esquece o carregado e lê o rascunho da nova, se houver.
   * O que estava agendado conclui se a pessoa é a mesma; com outra pessoa (ou
   * nenhuma), é cancelado sem gravar.
   */
  abrir(ficha: Ficha | null): void;
  /** O que a ficha carregou do sistema — a base da comparação. */
  carregou(valor: T): void;
  /** O formulário está assim agora. Decide se agenda uma gravação. */
  mudou(valor: T): void;
  /** A pessoa clicou em Recuperar. Devolve o que aplicar, ou `null` fora de `pendente`. */
  recuperar(): T | null;
  /** A pessoa clicou em Descartar: o rascunho some e não volta. */
  descartar(): void;
  /** Gravou no sistema: o rascunho perdeu a razão de existir, e o agendado também. */
  salvo(): void;
  /**
   * A pessoa escolheu `Descartar e sair` — F17.AUD03. O rascunho DESTA ficha
   * some, o que estava agendado é cancelado sem gravar, e a base carregada
   * fica como está: quem sai sem querer o texto não quer encontrá-lo de volta
   * na próxima abertura. Só esta ficha: as outras não são tocadas.
   */
  abandonar(): void;
  /** A ficha vai fechar: conclui a gravação agendada, se houver, e para. */
  encerrar(): void;
  estado(): EstadoDoRascunho<T>;
};

const igualPorJson = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

const RELOGIO_DO_AMBIENTE: Relogio = {
  agendar: (acao, ms) => setTimeout(acao, ms),
  cancelar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function criarRascunhoDaFicha<T>(opcoes: OpcoesDoRascunho<T> = {}): RascunhoDaFicha<T> {
  const atraso = opcoes.atraso ?? 500;
  const relogio = opcoes.relogio ?? RELOGIO_DO_AMBIENTE;
  const iguais = opcoes.iguais ?? igualPorJson;

  let ficha: Ficha | null = null;
  /**
   * A última ficha COM dono. Serve para saber se a nova é OUTRA — mesmo que
   * no meio tenha passado por `null`, como numa saída seguida de entrada.
   */
  let anterior: Ficha | null = null;
  /** O que veio do sistema. `null` até `carregou` — e antes disso não se grava. */
  let carregado: T | null = null;
  /** O que a tela mostra agora. */
  let atual: T | null = null;
  /** O que está no cofre (gravado ou lido). Igual a isto não se grava de novo. */
  let guardado: T | null = null;
  let recuperacao: Recuperacao = 'sem-rascunho';
  let oferecido: Rascunho<T> | null = null;
  let agendado: unknown = null;

  const estado = (): EstadoDoRascunho<T> => ({ recuperacao, oferecido });
  const avisar = () => opcoes.aoMudar?.(estado());

  const cancelar = () => {
    if (agendado === null) return;
    relogio.cancelar(agendado);
    agendado = null;
  };

  const gravar = () => {
    if (ficha === null || atual === null) return;
    guardarRascunho(ficha, atual);
    guardado = atual;
  };

  const apagar = () => {
    if (ficha !== null) apagarRascunho(ficha);
    guardado = null;
  };

  /** Se há gravação agendada, faz agora. É o fechamento normal. */
  const concluir = () => {
    if (agendado === null) return;
    cancelar();
    gravar();
  };

  const mesmaFicha = (a: Ficha | null, b: Ficha | null) =>
    a === b ||
    (a !== null && b !== null && a.usuario === b.usuario && a.tipo === b.tipo && a.id === b.id);

  /** Olha para o que está na tela e decide: agenda, cancela ou apaga. */
  const avaliar = () => {
    if (ficha === null || carregado === null || atual === null) return;
    // A decisão em aberto suspende tudo: gravar agora seria escrever o
    // formulário recém-carregado por cima do que a tela está oferecendo.
    if (recuperacao === 'pendente') return;

    if (iguais(atual, carregado)) {
      // Voltou ao que está salvo: não há o que recuperar.
      cancelar();
      if (guardado !== null) apagar();
      return;
    }
    if (guardado !== null && iguais(atual, guardado)) {
      cancelar();
      return;
    }
    cancelar();
    agendado = relogio.agendar(() => {
      agendado = null;
      gravar();
    }, atraso);
  };

  return {
    abrir(nova) {
      if (mesmaFicha(ficha, nova)) return;
      if (ficha !== null && nova !== null && ficha.usuario === nova.usuario) {
        // Mesma pessoa, outra ficha: o que estava agendado é dela, e conclui.
        concluir();
      } else {
        // Sem gravar: o que está na tela é de quem estava aqui antes.
        cancelar();
      }
      ficha = nova;
      guardado = null;
      oferecido = null;
      recuperacao = 'sem-rascunho';
      if (nova !== null) {
        // Outra ficha ou outro dono: o carregado era da anterior. Sem base
        // nova, `mudou` fica calado até `carregou` — é o que impede o texto de
        // A na tela de virar rascunho de B.
        if (anterior !== null && !mesmaFicha(anterior, nova)) carregado = null;
        anterior = nova;
        oferecido = lerRascunho<T>(nova);
        if (oferecido !== null) {
          recuperacao = 'pendente';
          guardado = oferecido.valor;
        }
      }
      avisar();
      avaliar();
    },

    carregou(valor) {
      carregado = valor;
      atual = valor;
    },

    mudou(valor) {
      atual = valor;
      avaliar();
    },

    recuperar() {
      if (recuperacao !== 'pendente' || oferecido === null) return null;
      const valor = oferecido.valor;
      oferecido = null;
      recuperacao = 'recuperado';
      avisar();
      return valor;
    },

    descartar() {
      if (recuperacao !== 'pendente') return;
      cancelar();
      apagar();
      oferecido = null;
      recuperacao = 'descartado';
      avisar();
      // O que a pessoa digitou enquanto decidia passa a valer como rascunho.
      avaliar();
    },

    salvo() {
      cancelar();
      apagar();
      oferecido = null;
      recuperacao = 'sem-rascunho';
      // O que acabou de ser gravado é a nova base: igual a isto não vira rascunho.
      if (atual !== null) carregado = atual;
      avisar();
    },

    abandonar() {
      cancelar();
      apagar();
      oferecido = null;
      recuperacao = 'sem-rascunho';
      // ⚠️ `atual` volta à base: o `encerrar` que vem logo depois, na
      // desmontagem, não pode reagendar nem concluir o que foi descartado.
      atual = carregado;
      avisar();
    },

    encerrar() {
      concluir();
    },

    estado,
  };
}
