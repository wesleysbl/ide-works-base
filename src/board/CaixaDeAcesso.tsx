/**
 * Quem alcança este espaço, esta pasta ou esta lista — e até onde. F17.23.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NENHUMA DECISÃO DE ACESSO ACONTECE NESTE ARQUIVO.
 *
 *   Quem alcança, quem pode conceder e o que cada nível permite são respostas do
 *   banco: uma chamada traz as três listas prontas, e `canGrant` já diz se os
 *   controles podem ser mexidos. Um `if (souAdmin)` aqui seria a segunda regra
 *   de acesso do sistema — a dívida 8.1 do legado no lugar mais perigoso.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AS TRÊS LISTAS SÃO DIFERENTES, E MOSTRAR SÓ UMA SERIA MENTIR
 *   `grants` é o que está escrito AQUI. `reachers` é quem alcança DE VERDADE,
 *   contando a corrente inteira e a empresa. Numa lista dentro de uma pasta
 *   fechada, escolher alguém que a pasta barra não muda nada — o nível de um nó
 *   é o MENOR da corrente —, e é `closedAbove` que deixa a tela dizer isso em
 *   vez de deixar a pessoa achar que já resolveu.
 *
 * O NOME DE CADA NÍVEL VEM DE `board/arvore.ts`, num lugar só. Escrever "Ver" e
 * "Executar" aqui faria a próxima tela inventar outras palavras para as mesmas
 * quatro coisas.
 */

import { useEffect, useState } from 'react';

import {
  type AcessoDoNo,
  NIVEIS,
  type NivelDeAcesso,
  O_QUE_O_NIVEL_PODE,
  ROTULO_DO_NIVEL,
} from '@/board/arvore';
import {
  Ajuda,
  Balao,
  IconeArquivo,
  IconeLimpar,
  IconePessoa,
  ItemDeMenu,
  Separador,
} from '@/board/menus';
import { api } from '@/lib/api';

/**
 * OS QUATRO NÍVEIS, EXPLICADOS DE UMA VEZ — F17.24.
 *
 * Antes a frase do nível ESCOLHIDO ficava colada no seletor, e era o que o
 * usuário fotografou: `[ Criar ▾ ] ⊘  Tudo de Executar, mais criar tarefa,
 * lista e pasta.` — duas linhas espremidas disputando espaço com o controle.
 *
 * Dentro do `?` ela pode ser o que sempre precisou ser: as QUATRO, lado a
 * lado. É assim que se escolhe entre quatro coisas — comparando —, e a frase
 * de uma só nunca respondeu "então o que muda se eu puser Executar?".
 */
const OsQuatroNiveis = () => (
  <dl>
    {NIVEIS.map((n) => (
      <div key={n}>
        <dt>{ROTULO_DO_NIVEL[n]}</dt>
        <dd>{O_QUE_O_NIVEL_PODE[n]}</dd>
      </div>
    ))}
  </dl>
);

/** O nó, do jeito que a rota de acesso o endereça. */
export type NoDeAcesso = { nivel: 'space' | 'folder' | 'list'; id: string };

const COISA = { space: 'o espaço', folder: 'a pasta', list: 'a lista' } as const;

type Escolhida = { userId: string; name: string; level: NivelDeAcesso };

export function CaixaDeAcesso({
  no,
  salvando,
  aoFechar,
  aoAgir,
}: {
  no: NoDeAcesso;
  salvando: boolean;
  aoFechar: () => void;
  aoAgir: <T>(fn: () => Promise<T>) => Promise<{ ok: boolean }>;
}) {
  const [lendo, setLendo] = useState(true);
  const [acesso, setAcesso] = useState<AcessoDoNo | null>(null);
  const [fechado, setFechado] = useState(false);
  const [linhas, setLinhas] = useState<Escolhida[]>([]);
  const [equipe, setEquipe] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [r, e] = await Promise.all([api.acessoDoNo(no.nivel, no.id), api.equipe()]);
        if (!vivo) return;
        setAcesso(r.access);
        setFechado(r.access.restricted);
        setLinhas(r.access.grants.map((g) => ({ ...g })));
        setEquipe(e.team);
      } catch {
        /* A caixa mostra o vazio e o botão fica desligado — melhor do que uma
           caixa que não abre. */
      } finally {
        if (vivo) setLendo(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [no.nivel, no.id]);

  const podeMexer = acesso?.canGrant === true && !salvando;
  const forasteiros = equipe.filter((p) => !linhas.some((l) => l.userId === p.id));

  const aplicar = () =>
    void aoAgir(async () => {
      const r = await api.salvarAcessoDoNo(no.nivel, no.id, {
        restricted: fechado,
        grants: linhas.map((l) => ({ userId: l.userId, level: l.level })),
      });
      // A resposta é o estado NOVO, lido pela mesma regra da política. Guardar o
      // que a tela mandou faria a caixa mostrar uma coisa e o banco outra — e
      // quem fecha entra sozinho na lista, o que a tela não teria como adivinhar.
      setAcesso(r.access);
      setFechado(r.access.restricted);
      setLinhas(r.access.grants.map((g) => ({ ...g })));
      return r;
    });

  return (
    <Balao lado="baixo-direita" aoFechar={aoFechar} rotulo={`Quem alcança ${COISA[no.nivel]}`}>
      {lendo && <p className="cu-vazio">Lendo quem alcança…</p>}

      {!lendo && acesso === null && (
        <p className="cu-vazio">Não foi possível ler quem alcança isto agora.</p>
      )}

      {!lendo && acesso !== null && (
        <div className="cu-esteira">
          {acesso.closedAbove.length > 0 && (
            <p className="cu-vazio">
              Acima daqui já há coisa fechada:{' '}
              <b style={{ color: 'var(--plat)' }}>
                {acesso.closedAbove.map((a) => a.name).join(' · ')}
              </b>
              . Quem não passa por lá não chega aqui, mesmo escolhido nesta lista.
            </p>
          )}

          <ItemDeMenu
            marcado={!fechado}
            desativado={!podeMexer}
            aoEscolher={() => setFechado(false)}
          >
            <IconePessoa />
            Toda a empresa
          </ItemDeMenu>
          <ItemDeMenu marcado={fechado} desativado={!podeMexer} aoEscolher={() => setFechado(true)}>
            <IconeArquivo />
            Só quem eu escolher
          </ItemDeMenu>

          {fechado && (
            <>
              {linhas.length === 0 && (
                <p className="cu-vazio">
                  Ninguém escolhido ainda. Sem ninguém na lista, só quem administra o sistema
                  chega aqui.
                </p>
              )}

              {linhas.map((l, i) => (
                <div key={l.userId} className="cu-esteira-linha">
                  <span className="cu-ponto" aria-hidden="true" />
                  <span
                    className="cu-esteira-nome"
                    style={{ border: 'none', background: 'none', overflow: 'hidden' }}
                  >
                    {l.name === '' ? 'sem nome' : l.name}
                  </span>
                  <span className="cu-esteira-acoes">
                    <select
                      className="cu-mini-select"
                      value={l.level}
                      disabled={!podeMexer}
                      aria-label={`O que ${l.name || 'esta pessoa'} pode fazer`}
                      onChange={(e) =>
                        setLinhas((v) =>
                          v.map((x, j) =>
                            j === i ? { ...x, level: e.target.value as NivelDeAcesso } : x,
                          ),
                        )
                      }
                    >
                      {NIVEIS.map((n) => (
                        <option key={n} value={n}>
                          {ROTULO_DO_NIVEL[n]}
                        </option>
                      ))}
                    </select>
                    {/* A FRASE DO NÍVEL VIROU `?` — F17.24. Ver `OsQuatroNiveis`. */}
                    <Ajuda sobre="cada nível de acesso">
                      <OsQuatroNiveis />
                    </Ajuda>
                    <button
                      type="button"
                      className="cu-icone-btn"
                      disabled={!podeMexer}
                      aria-label={`Tirar ${l.name || 'esta pessoa'}`}
                      onClick={() => setLinhas((v) => v.filter((_, j) => j !== i))}
                    >
                      <IconeLimpar c="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ))}

              {forasteiros.length > 0 && (
                <label className="cu-destino">
                  <span>Acrescentar</span>
                  <select
                    className="cu-mini-select"
                    value=""
                    disabled={!podeMexer}
                    aria-label="Acrescentar pessoa"
                    onChange={(e) => {
                      const escolhida = forasteiros.find((f) => f.id === e.target.value);
                      if (escolhida === undefined) return;
                      setLinhas((v) => [
                        ...v,
                        // `Executar` é o padrão porque é o caso que o usuário
                        // descreveu: "precisa ter acesso e cumprir, sem criar".
                        { userId: escolhida.id, name: escolhida.name, level: 'execute' },
                      ]);
                    }}
                  >
                    <option value="">escolher…</option>
                    {forasteiros.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <div className="cu-esteira-pe">
            <button
              type="button"
              className="o-btn o-btn-primario o-btn-sm"
              disabled={!podeMexer}
              onClick={aplicar}
            >
              {salvando ? 'salvando…' : 'Aplicar'}
            </button>
          </div>

          {/* CONSEQUÊNCIA, NÃO EXPLICAÇÃO DE TELA — por isso ela FICA escrita.
              O que virou `?` foi a lista de quem pode: essa é a parte que
              descreve o sistema, e não o que acontece com o seu clique. */}
          {acesso.canGrant === false && (
            <p className="cu-vazio cu-com-ajuda">
              <span>Você não pode mudar o acesso aqui.</span>
              <Ajuda sobre="quem muda o acesso">
                <p>Quem administra o sistema, quem criou o espaço, e quem recebeu o nível</p>
                <p>
                  <b>{ROTULO_DO_NIVEL.manage}</b> neste nó ou em algum acima dele.
                </p>
              </Ajuda>
            </p>
          )}

          <Separador />

          {/* A PAREDE VIROU CONTAGEM — F17.24.
              Era `Alcançam hoje: Fulano (Administrar) · Sicrano (Administrar) ·
              beltrano@… (Administrar)`, três linhas de parágrafo corrido em que
              achar um nome exige ler todos. O número responde a pergunta comum
              ("tem gente demais aqui?"); o `?` abre a lista, uma pessoa por
              linha, para a pergunta rara ("quem, exatamente?"). */}
          <p className="cu-vazio cu-com-ajuda">
            <span>
              Alcançam hoje:{' '}
              <b style={{ color: 'var(--plat)' }}>
                {acesso.reachers.length === 0
                  ? 'ninguém'
                  : `${acesso.reachers.length} ${
                      acesso.reachers.length === 1 ? 'pessoa' : 'pessoas'
                    }`}
              </b>
            </span>
            {acesso.reachers.length > 0 && (
              <Ajuda sobre="quem alcança hoje" lado="cima-direita">
                <ul className="cu-lista-de-gente">
                  {acesso.reachers.map((r) => (
                    <li key={r.userId}>
                      <span>{r.name === '' ? 'sem nome' : r.name}</span>
                      <span className="nivel">{ROTULO_DO_NIVEL[r.level]}</span>
                    </li>
                  ))}
                </ul>
              </Ajuda>
            )}
          </p>
        </div>
      )}
    </Balao>
  );
}
