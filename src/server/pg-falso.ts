/**
 * UM POSTGRES DE MENTIRA NO FIO — para contar idas ao banco com o driver REAL.
 *
 * POR QUE ISTO EXISTE
 *   Os dublês de teste do repositório trocam o `postgres.js` inteiro por uma
 *   função, e por isso não conseguem dizer a única coisa que importa para a
 *   latência: quantas vezes o driver fica esperando o servidor. Aqui o driver
 *   é o de produção, falando o protocolo de verdade com um servidor mínimo que
 *   escuta em `127.0.0.1` (a trava de rede da suíte só cobre `fetch`).
 *
 * O QUE É UMA "IDA"
 *   O servidor responde com um pequeno atraso (`JANELA_DA_IDA_MS`). Tudo o que o
 *   cliente mandar antes de a resposta sair — mesmo em várias escritas no
 *   soquete — é UMA ida: ele não esperou por nada. O que chegar depois da
 *   resposta é a ida seguinte. É essa contagem, e não a de consultas, que vira
 *   milissegundos de rede em produção, onde cada ida atravessa o Hyperdrive.
 *
 * O QUE ELE NÃO É
 *   Não executa SQL. Cada consulta é casada por expressão regular com uma
 *   resposta combinada (`respostas`); o que sobra recebe uma resposta vazia.
 *   Serve para provar fiação e contagem, nunca o resultado de uma consulta —
 *   isso é com o PGlite, nos testes `*-banco.test.ts`.
 *
 * ONDE MORA
 *   Em `src/server` e não em `test/`, porque o projeto TypeScript de `src` não
 *   enxerga arquivos fora dele. Nenhum código de produção o importa.
 */
import net from 'node:net';

import type postgres from 'postgres';

/**
 * Uma coluna da resposta. O texto puro é `text` (OID 25); com `oid` o driver
 * converte como converteria do banco — 16 booleano (`'t'`/`'f'`), 23 inteiro,
 * 114 json. Serve para devolver um array ou um booleano sem a busca de tipos.
 */
export type ColunaCombinada = string | { nome: string; oid: number };

export type RespostaCombinada = {
  /** Casa com o texto da consulta (os `$n` chegam como estão). */
  quando: RegExp;
  colunas?: ColunaCombinada[];
  linhas?: (parametros: Array<string | null>) => Array<Array<string | null>>;
  /** Se vier, a consulta falha com esta mensagem (SQLSTATE `XX000`). */
  erro?: string;
};

/**
 * Quanto o servidor demora para responder, em ms.
 *
 * É o que separa "o cliente esperou" de "o cliente falou tudo de uma vez": o
 * `postgres.js` quebra uma rajada grande em escritas de ~1 KB seguidas, e dois
 * pacotes que chegam dentro desta janela, sem resposta no meio, são UMA ida.
 */
const JANELA_DA_IDA_MS = 12;

export type PgFalso = {
  porta: number;
  /**
   * Opções do `postgres.js` para falar com este servidor, do jeito do Worker:
   * `prepare: false` (o Hyperdrive agrupa em modo transação) e sem busca de tipos.
   *
   * O soquete é aberto aqui, com `noDelay`: o `postgres.js` não liga o
   * TCP_NODELAY, e o algoritmo de Nagle seguraria a segunda escrita de uma
   * rajada até a resposta da primeira voltar — um artefato do teste na
   * máquina local, que faria uma rajada de oito consultas parecer duas idas.
   */
  opcoesDoCliente(): postgres.Options<Record<string, never>>;
  /** Mensagens do cliente em cada pacote recebido — o tamanho é a "ida". */
  idas: number[];
  /** Texto de cada consulta executada, na ordem. */
  consultas: string[];
  /** Parâmetros de cada consulta, na ordem (vazio para as sem parâmetro). */
  parametros: Array<Array<string | null>>;
  zerar(): void;
  fechar(): Promise<void>;
};

function mensagem(tipo: string, corpo: Buffer = Buffer.alloc(0)): Buffer {
  const b = Buffer.alloc(5 + corpo.length);
  b.write(tipo, 0, 'latin1');
  b.writeInt32BE(4 + corpo.length, 1);
  b.set(corpo, 5);
  return b;
}
const texto0 = (s: string) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const int32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const int16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};

const SEM_RESPOSTA: RespostaCombinada = { quando: /./ };

export async function criarPgFalso(respostas: RespostaCombinada[] = []): Promise<PgFalso> {
  const idas: number[] = [];
  const consultas: string[] = [];
  const parametros: Array<Array<string | null>> = [];

  const servidor = net.createServer((soquete) => {
    soquete.setNoDelay(true);
    let entrada = Buffer.alloc(0);
    let iniciou = false;
    let situacao = 'I';
    let pendente: { saida: Buffer[]; timer: ReturnType<typeof setTimeout> | null } | null = null;
    const declaradas = new Map<string, { sql: string; resposta: RespostaCombinada }>();
    const portais = new Map<string, { declarada: { sql: string; resposta: RespostaCombinada }; params: Array<string | null> }>();

    const escolher = (sql: string) => respostas.find((r) => r.quando.test(sql)) ?? SEM_RESPOSTA;
    const descricao = (colunas: ColunaCombinada[]) =>
      mensagem(
        'T',
        Buffer.concat([
          int16(colunas.length),
          ...colunas.map((c) => {
            const nome = typeof c === 'string' ? c : c.nome;
            const oid = typeof c === 'string' ? 25 : c.oid;
            return Buffer.concat([texto0(nome), int32(0), int16(0), int32(oid), int16(-1), int32(-1), int16(0)]);
          }),
        ]),
      );
    const quantosParametros = (sql: string) => {
      const achados = sql.match(/\$(\d+)/g) ?? [];
      return achados.length === 0 ? 0 : Math.max(...achados.map((x) => Number(x.slice(1))));
    };
    const acompanharTransacao = (sql: string) => {
      const s = sql.trim().toLowerCase();
      if (s.startsWith('begin')) situacao = 'T';
      else if (s.startsWith('commit') || s.startsWith('rollback')) situacao = 'I';
    };
    const erro = (texto: string, codigo = 'XX000') =>
      mensagem(
        'E',
        Buffer.concat([
          Buffer.from('SERROR\0'),
          Buffer.from('C' + codigo + '\0'),
          Buffer.from('M' + texto + '\0'),
          Buffer.from([0]),
        ]),
      );
    /** Depois de um erro no protocolo estendido o servidor ignora tudo até o próximo `Sync`. */
    let descartando = false;
    const executar = (sql: string, resposta: RespostaCombinada, params: Array<string | null>): Buffer[] => {
      consultas.push(sql);
      parametros.push(params);
      const fim = /^\s*(commit|rollback)/i.test(sql);
      if (situacao === 'E' && !fim) {
        descartando = true;
        return [erro('current transaction is aborted, commands ignored until end of transaction block', '25P02')];
      }
      acompanharTransacao(sql);
      if (resposta.erro !== undefined) {
        descartando = true;
        situacao = situacao === 'T' ? 'E' : situacao;
        return [erro(resposta.erro)];
      }
      const linhas = resposta.linhas?.(params) ?? [];
      const saida: Buffer[] = linhas.map((r) =>
        mensagem(
          'D',
          Buffer.concat([
            int16(r.length),
            ...r.map((v) => (v === null ? int32(-1) : Buffer.concat([int32(Buffer.byteLength(v)), Buffer.from(v)]))),
          ]),
        ),
      );
      const etiqueta = /^\s*begin/i.test(sql) ? 'BEGIN' : /^\s*commit/i.test(sql) ? 'COMMIT' : `SELECT ${linhas.length}`;
      saida.push(mensagem('C', texto0(etiqueta)));
      return saida;
    };

    soquete.on('data', (dado) => {
      entrada = Buffer.concat([entrada, dado]);
      let mensagens = 0;
      const saida: Buffer[] = [];
      for (;;) {
        if (!iniciou) {
          if (entrada.length < 4) break;
          const tamanho = entrada.readInt32BE(0);
          if (entrada.length < tamanho) break;
          entrada = entrada.subarray(tamanho);
          iniciou = true;
          // O aperto de mão não conta como ida de consulta: responde na hora.
          soquete.write(
            Buffer.concat([
              mensagem('R', int32(0)),
              mensagem('S', Buffer.concat([texto0('server_version'), texto0('16.0')])),
              mensagem('K', Buffer.concat([int32(1), int32(2)])),
              mensagem('Z', Buffer.from('I')),
            ]),
          );
          continue;
        }
        if (entrada.length < 5) break;
        const tamanho = entrada.readInt32BE(1);
        if (entrada.length < 1 + tamanho) break;
        const tipo = String.fromCharCode(entrada[0]);
        const corpo = entrada.subarray(5, 1 + tamanho);
        entrada = entrada.subarray(1 + tamanho);
        mensagens += 1;

        if (descartando && tipo !== 'S' && tipo !== 'X' && tipo !== 'Q') continue;
        if (tipo === 'Q') {
          const sql = corpo.toString('utf8', 0, corpo.length - 1);
          const r = escolher(sql);
          if (r.erro === undefined && r.colunas?.length) saida.push(descricao(r.colunas));
          saida.push(...executar(sql, r, []));
          descartando = false;
          saida.push(mensagem('Z', Buffer.from(situacao)));
        } else if (tipo === 'P') {
          const fimNome = corpo.indexOf(0);
          const nome = corpo.toString('utf8', 0, fimNome);
          const fimSql = corpo.indexOf(0, fimNome + 1);
          const sql = corpo.toString('utf8', fimNome + 1, fimSql);
          declaradas.set(nome, { sql, resposta: escolher(sql) });
          saida.push(mensagem('1'));
        } else if (tipo === 'D') {
          const especie = String.fromCharCode(corpo[0]);
          const nome = corpo.toString('utf8', 1, corpo.length - 1);
          if (especie === 'S') {
            const d = declaradas.get(nome)!;
            const n = quantosParametros(d.sql);
            saida.push(mensagem('t', Buffer.concat([int16(n), ...Array.from({ length: n }, () => int32(25))])));
            saida.push(d.resposta.colunas?.length ? descricao(d.resposta.colunas) : mensagem('n'));
          } else {
            const p = portais.get(nome)!;
            saida.push(p.declarada.resposta.colunas?.length ? descricao(p.declarada.resposta.colunas) : mensagem('n'));
          }
        } else if (tipo === 'B') {
          let o = 0;
          const e1 = corpo.indexOf(0, o);
          const portal = corpo.toString('utf8', o, e1);
          o = e1 + 1;
          const e2 = corpo.indexOf(0, o);
          const nome = corpo.toString('utf8', o, e2);
          o = e2 + 1;
          const nFormatos = corpo.readInt16BE(o);
          o += 2 + 2 * nFormatos;
          const nParams = corpo.readInt16BE(o);
          o += 2;
          const params: Array<string | null> = [];
          for (let i = 0; i < nParams; i += 1) {
            const tam = corpo.readInt32BE(o);
            o += 4;
            if (tam < 0) params.push(null);
            else {
              params.push(corpo.toString('utf8', o, o + tam));
              o += tam;
            }
          }
          portais.set(portal, { declarada: declaradas.get(nome)!, params });
          saida.push(mensagem('2'));
        } else if (tipo === 'E') {
          const portal = corpo.toString('utf8', 0, corpo.indexOf(0));
          const p = portais.get(portal)!;
          saida.push(...executar(p.declarada.sql, p.declarada.resposta, p.params));
        } else if (tipo === 'S') {
          descartando = false;
          saida.push(mensagem('Z', Buffer.from(situacao)));
        } else if (tipo === 'X') {
          soquete.end();
        }
        // 'H' (Flush) não pede nada além do que já está na fila.
      }
      if (mensagens === 0) return;
      // Responde depois da janela. Um pacote que chega ENQUANTO a resposta anterior
      // ainda não saiu pertence à mesma ida: o cliente não esperou por ela.
      if (pendente !== null) {
        pendente.saida.push(...saida);
        idas[idas.length - 1] += mensagens;
        return;
      }
      idas.push(mensagens);
      const lote = { saida, timer: null as ReturnType<typeof setTimeout> | null };
      pendente = lote;
      lote.timer = setTimeout(() => {
        pendente = null;
        if (lote.saida.length > 0 && !soquete.destroyed) soquete.write(Buffer.concat(lote.saida));
      }, JANELA_DA_IDA_MS);
    });
    soquete.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const endereco = servidor.address() as net.AddressInfo;
  return {
    porta: endereco.port,
    idas,
    consultas,
    parametros,
    opcoesDoCliente() {
      return {
        host: '127.0.0.1',
        port: endereco.port,
        user: 'u',
        database: 'd',
        ssl: false,
        prepare: false,
        fetch_types: false,
        max: 1,
        socket: () =>
          new Promise<net.Socket>((resolve, reject) => {
            const s = net.connect({ host: '127.0.0.1', port: endereco.port, noDelay: true }, () => resolve(s));
            s.once('error', reject);
          }),
      } as unknown as postgres.Options<Record<string, never>>;
    },
    zerar() {
      idas.length = 0;
      consultas.length = 0;
      parametros.length = 0;
    },
    fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}
