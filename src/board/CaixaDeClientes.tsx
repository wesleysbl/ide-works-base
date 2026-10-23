/**
 * TRAZER OS CLIENTES PARA O QUADRO — etapa F17.43, informada na F17.83.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   *"podemos puxar os clientes na parte de quadro?"* — a barra da Helena no
 *   ClickUp tem um espaço `TIME HELENA` com os CLIENTES como listas: Jatobá,
 *   Valentini, DXI, Clinimax, Sabor Doce, Estúdio Ide, cada um com sua contagem.
 *
 *   São 96 clientes cadastrados. Digitar 96 nomes à mão daria 96 textos que não
 *   sabem que são clientes — e é isso que esta caixa existe para não acontecer:
 *   o que ela cria é a lista COM o vínculo, e o nome vem do cadastro.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NENHUMA DECISÃO ACONTECE AQUI
 *   Quem enxerga cada cliente é `clients_select`; quem pode criar lista naquele
 *   espaço é `lists_write`; quem pode ligar a lista ao cliente é o guarda
 *   `lists_client_reach_guard`. A caixa mostra o que o servidor devolveu e
 *   mostra a recusa dele — um `if (souAdmin)` aqui seria a dívida 8.1 outra vez.
 *
 * ⚠️ A CONTAGEM NÃO SE CALCULA NESTA TELA
 *   O servidor devolve TODOS os clientes ao alcance, cada um com
 *   `listCountInSpace`. Quem já tem lista aqui aparece com o selo; trazer de
 *   novo cria outra lista, e a linha continua clicável. Somar de novo aqui —
 *   olhando a árvore, filtrando arquivada — daria uma segunda opinião, e ela
 *   ficaria para trás na primeira aba deixada aberta.
 *
 * A CAIXA PRECISA CABER, E ELA CABE PELO MESMO CAMINHO DE TODAS
 *   96 nomes não cabem em tela nenhuma. O `Balao` mede o espaço livre e põe o
 *   teto (F17.35); quem rola é a `.cu-rolagem` do meio, e a busca e o rodapé
 *   ficam fora dela, presos — senão o botão de trazer sairia da tela junto com
 *   a lista. Fechar por X, `Esc` e clique fora é do `Balao` também (F17.33).
 */

import { useEffect, useMemo, useState } from 'react';

import {
  type ClienteParaTrazer,
  seloDeListasNoEspaco,
} from '@/board/arvore';
import { nomeCasaComABusca } from '@/board/busca-de-nome';
import { Balao, IconeCliente, ItemDeMenu } from '@/board/menus';
import { api } from '@/lib/api';

export function CaixaDeClientes({
  spaceId,
  folderId,
  onde,
  salvando,
  aoFechar,
  aoAgir,
  clientesJaLidos,
}: {
  spaceId: string;
  /** Nulo é trazer para a raiz do espaço — a lista solta, que existe. */
  folderId: string | null;
  /** O nome do lugar de destino, para a caixa dizer para ONDE está trazendo. */
  onde: string;
  salvando: boolean;
  aoFechar: () => void;
  aoAgir: <T>(fn: () => Promise<T>) => Promise<{ ok: boolean }>;
  /**
   * O teste de tela passa os clientes já lidos: `renderToStaticMarkup` não
   * corre o efeito que busca. A tela de verdade omite isto e lê do servidor.
   */
  clientesJaLidos?: readonly ClienteParaTrazer[];
}) {
  const [lendo, setLendo] = useState(clientesJaLidos === undefined);
  const [clientes, setClientes] = useState<ClienteParaTrazer[]>(() => [
    ...(clientesJaLidos ?? []),
  ]);
  const [busca, setBusca] = useState('');
  const [escolhidos, setEscolhidos] = useState<string[]>([]);

  useEffect(() => {
    if (clientesJaLidos !== undefined) return;
    let vivo = true;
    void (async () => {
      try {
        const r = await api.clientesParaTrazer(spaceId);
        if (!vivo) return;
        setClientes(r.clients);
      } catch {
        /* A caixa mostra o vazio e o botão fica desligado — melhor do que uma
           caixa que não abre. A recusa do servidor, quando ela importa de
           verdade, aparece no ato de TRAZER, que passa por `aoAgir`. */
      } finally {
        if (vivo) setLendo(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [spaceId, clientesJaLidos]);

  const filtrados = useMemo(() => {
    return clientes.filter((c) => nomeCasaComABusca(c.name, busca));
  }, [clientes, busca]);

  const marcados = useMemo(() => new Set(escolhidos), [escolhidos]);

  const alternar = (id: string) =>
    setEscolhidos((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  /*
    MARCAR OS ENCONTRADOS, E NÃO "MARCAR TODOS".

    Com 96 clientes, "todos" é quase sempre o gesto errado — e desfazê-lo é
    desmarcar 96 vezes. O que a pessoa quer é o resultado da busca que ela
    acabou de digitar; por isso o botão fala do que está na frente dela, e diz
    quantos são.
  */
  const marcarEncontrados = () =>
    setEscolhidos((v) => [...new Set([...v, ...filtrados.map((c) => c.id)])]);

  const trazer = () =>
    void aoAgir(() =>
      api.trazerClientes(spaceId, { folderId, clientIds: escolhidos }),
    ).then((feito) => {
      if (feito.ok) aoFechar();
    });

  const podeTrazer = escolhidos.length > 0 && !salvando;

  return (
    <Balao lado="baixo-direita" aoFechar={aoFechar} rotulo={`Trazer clientes para ${onde}`}>
      <input
        className="cu-busca"
        data-foco="1"
        value={busca}
        placeholder="Busque o cliente…"
        aria-label="Buscar cliente"
        onChange={(e) => setBusca(e.target.value)}
      />

      <div className="cu-balao-titulo">Trazer para {onde}</div>

      <div className="cu-rolagem">
        {lendo && <p className="cu-vazio">Lendo os clientes…</p>}

        {!lendo && filtrados.length === 0 && (
          <p className="cu-vazio">
            {clientes.length === 0
              ? 'Nenhum cliente ao seu alcance.'
              : 'Nenhum cliente com esse nome.'}
          </p>
        )}

        {filtrados.map((c) => {
          const selo = seloDeListasNoEspaco(c.listCountInSpace);
          return (
            <ItemDeMenu
              key={c.id}
              marcado={marcados.has(c.id)}
              desativado={salvando}
              aoEscolher={() => alternar(c.id)}
              /* O cliente parado continua sendo oferecido — quem quer a lista
                 de um cliente que parou quer o histórico dele —, e fica
                 marcado para ninguém trazer um contrato encerrado achando
                 que é ativo. Quem já tem lista aqui também continua
                 clicável: trazer de novo cria a segunda lista. */
              fim={
                selo || !c.active ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {selo ? <span>{selo}</span> : null}
                    {c.active ? null : <span className="cu-selo-morto">inativo</span>}
                  </span>
                ) : undefined
              }
            >
              <IconeCliente c="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span
                className="rotulo"
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                {c.name}
              </span>
            </ItemDeMenu>
          );
        })}
      </div>

      {/* OS DOIS ATALHOS VÃO DENTRO DE UM `span`, e não soltos no rodapé: a
          folha empurra todo `.o-btn` filho direto para a direita
          (`margin-left: auto`), e três deles soltos repartiriam o vão em três
          folgas iguais em vez de deixar o botão que age no canto. */}
      <div className="cu-esteira-pe">
        <span style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            type="button"
            className="o-btn o-btn-vidro o-btn-sm"
            disabled={salvando || filtrados.length === 0}
            onClick={marcarEncontrados}
          >
            Marcar {filtrados.length}
          </button>
          <button
            type="button"
            className="o-btn o-btn-vidro o-btn-sm"
            disabled={salvando || escolhidos.length === 0}
            onClick={() => setEscolhidos([])}
          >
            Limpar
          </button>
        </span>
        <button
          type="button"
          className="o-btn o-btn-primario o-btn-sm"
          disabled={!podeTrazer}
          onClick={trazer}
        >
          {salvando
            ? 'trazendo…'
            : escolhidos.length === 0
              ? 'Trazer'
              : `Trazer ${escolhidos.length}`}
        </button>
      </div>

      {/* CONSEQUÊNCIA, E NÃO EXPLICAÇÃO DE TELA: é o que acontece com o clique
          de quem está lendo. A lista nasce sabendo de quem ela é; trazer de
          novo não substitui a que já está aqui. */}
      <p className="cu-vazio">
        Cada escolha vira uma lista com o nome do cliente, ligada à ficha. Quem
        já tem lista aqui ganha outra.
      </p>
    </Balao>
  );
}
