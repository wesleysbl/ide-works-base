/**
 * MEDIÇÃO DE CONEXÕES AO BANCO, POR REQUISIÇÃO — F22, Fase 1.
 *
 * POR QUE ISTO EXISTE
 *   Uma chamada MCP abre ONZE conexões ao Postgres, uma depois da outra. O
 *   diagnóstico que descobriu isso mediu 464–502 ms por conexão — mas mediu do
 *   Mac, pelo pooler. Dentro do Worker quem fala com o banco é o Hyperdrive,
 *   que mantém conexão quente: lá o custo pode ser bem menor, e ninguém sabe
 *   quanto.
 *
 *   Consertar a fiação sem esse número seria trocar desperdício por esperança:
 *   não haveria linha de base para dizer se a Fase 2 melhorou, nem quanto.
 *   Este módulo mede primeiro. Ele NÃO muda caminho nenhum — só conta e
 *   cronometra.
 *
 * POR QUE `AsyncLocalStorage`, E NÃO UMA VARIÁVEL DE MÓDULO
 *   Um isolado do Worker atende várias requisições ao mesmo tempo, e elas se
 *   intercalam em cada `await`. Um contador global somaria a conexão de uma
 *   requisição na conta da outra, e o número medido — que é o produto desta
 *   fase — nasceria errado. O armazenamento por contexto assíncrono é a única
 *   forma barata de manter cada conta na sua requisição.
 *
 * O QUE ELE NÃO PODE FAZER
 *   Nada que possa atrasar ou derrubar uma requisição real. Por isso toda
 *   função aqui é no-op quando não há medição em curso, nenhuma delas lança, e
 *   o cabeçalho só carrega rótulos escritos no código — nunca identificador,
 *   credencial ou conteúdo.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Uma conexão observada: o rótulo do ponto do código que a abriu e quanto ela viveu. */
export type ConexaoMedida = {
  /** Nome fixo do ponto do código. Literal, jamais dado de usuário. */
  readonly rotulo: string;
  /** Milissegundos entre abrir o cliente e o `end()` dele resolver. */
  readonly ms: number;
  /** `false` quando a requisição terminou sem o `end()` daquele cliente resolver. */
  readonly fechada: boolean;
};

export type MedicaoDeBanco = {
  /** Quantos clientes Postgres a requisição abriu. É o número que a Fase 2 tem de derrubar. */
  readonly aberturas: number;
  /** Quantos desses fecharam antes de a requisição responder. */
  readonly fechamentos: number;
  /** Soma do tempo de vida dos clientes. Sequenciais como são hoje, isto é o custo real. */
  readonly msDeConexao: number;
  /** Tempo total da requisição, para saber quanto do prazo o banco comeu. */
  readonly msDaRequisicao: number;
  readonly conexoes: readonly ConexaoMedida[];
};

/**
 * Teto de conexões detalhadas no cabeçalho.
 *
 *   Onze é o número de hoje; trinta dá folga para uma chamada pior sem deixar
 *   o cabeçalho crescer sem limite. Acima disso a contagem continua exata — só
 *   o detalhe para de ser listado.
 */
const TETO_DE_DETALHE = 30;

type Anotacao = { rotulo: string; inicio: number; fim: number | null };

type Contador = {
  readonly inicio: number;
  readonly anotacoes: Anotacao[];
};

const contexto = new AsyncLocalStorage<Contador>();

/** Relógio monotônico quando existe; a data comum quando não existe. */
function agora(): number {
  return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

/**
 * Roda um trabalho com a medição ligada e devolve o resultado ao lado do número.
 *
 * O resultado do trabalho passa intacto, inclusive quando ele lança: o erro
 * sobe sem ser tocado, porque medir não pode engolir falha.
 */
export async function medirBancoDaRequisicao<T>(
  work: () => Promise<T>,
): Promise<{ resultado: T; medicao: MedicaoDeBanco }> {
  const contador: Contador = { inicio: agora(), anotacoes: [] };
  const resultado = await contexto.run(contador, work);
  return { resultado, medicao: fecharConta(contador) };
}

/**
 * Registra a abertura de um cliente e devolve o carimbo de fechamento.
 *
 * Fora de uma medição devolve uma função vazia — o custo em produção normal é
 * uma leitura de contexto e uma chamada que não faz nada.
 */
export function registrarAberturaDeConexao(rotulo: string): () => void {
  const contador = contexto.getStore();
  if (!contador) return () => {};
  const anotacao: Anotacao = { rotulo, inicio: agora(), fim: null };
  contador.anotacoes.push(anotacao);
  return () => {
    // Só o primeiro fechamento conta: `end()` chamado duas vezes não pode
    // encolher o tempo já medido.
    if (anotacao.fim === null) anotacao.fim = agora();
  };
}

function fecharConta(contador: Contador): MedicaoDeBanco {
  const fim = agora();
  const conexoes = contador.anotacoes.map((a) => ({
    rotulo: a.rotulo,
    ms: Math.round((a.fim ?? fim) - a.inicio),
    fechada: a.fim !== null,
  }));
  return {
    aberturas: conexoes.length,
    fechamentos: conexoes.filter((c) => c.fechada).length,
    msDeConexao: conexoes.reduce((total, c) => total + c.ms, 0),
    msDaRequisicao: Math.round(fim - contador.inicio),
    conexoes,
  };
}

/** Nome do cabeçalho de resposta que carrega a medição. */
export const CABECALHO_DE_MEDICAO = 'x-ideworks-db';

/**
 * O valor do cabeçalho: só números e rótulos do código.
 *
 * Não há aqui identificador de concessão, de pessoa, de token, nem pedaço de
 * conteúdo — de propósito, porque este cabeçalho vai para produção e é lido de
 * fora, por `curl`, por quem estiver com o terminal aberto.
 */
export function cabecalhoDeMedicao(medicao: MedicaoDeBanco): string {
  const partes = medicao.conexoes
    .slice(0, TETO_DE_DETALHE)
    .map((c) => `${higienizar(c.rotulo)}:${c.ms}${c.fechada ? '' : '!'}`)
    .join(',');
  return [
    `conns=${medicao.aberturas}`,
    `closed=${medicao.fechamentos}`,
    `db=${medicao.msDeConexao}ms`,
    `req=${medicao.msDaRequisicao}ms`,
    partes ? `parts=${partes}` : 'parts=-',
  ].join('; ');
}

/**
 * Rótulo vira cabeçalho, então nada de caractere que quebre a gramática de
 * cabeçalho HTTP. Os rótulos são literais do código — isto é cinto, não
 * suspensório.
 */
function higienizar(rotulo: string): string {
  return rotulo.replace(/[^a-zA-Z0-9._-]/g, '') || 'db';
}
