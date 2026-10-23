/**
 * A LUPA E O BOTÃO `Responsável` — etapa F17.55.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELA MOSTRA, E POR QUE ELA MOSTRA DOIS NÚMEROS
 *
 *   A F17.50 achou o cabeçalho anunciando `71 tarefas` numa lista de 1.070 —
 *   ele contava os cartões que tinham chegado. O conserto foi contar no banco.
 *
 *   O filtro traz a mesma armadilha de volta pelo outro lado: uma barra que
 *   dissesse só `27` deixaria de dizer 27 DE QUANTAS, e quem abrisse a tela com
 *   um filtro herdado do endereço acharia que a lista tem 27 tarefas. Por isso
 *   os dois números andam juntos, sempre: **`27 de 1.070`**.
 *
 *   Os dois vêm do banco, da mesma varredura, e a tela não faz conta nenhuma
 *   com eles. Ver `columnMatched` em `@/board/board`.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ O QUE A BARRA DIZ É O QUE FOI FILTRADO, E NÃO O QUE FOI DIGITADO
 *   Os dois se separam a cada tecla: a caixa já mudou e a resposta ainda não
 *   chegou. Anunciar `27 achadas` embaixo da palavra `sonh` seria contar o
 *   resultado de uma busca com o nome de outra. Então o texto vem de `aplicado`
 *   — o filtro que o SERVIDOR usou —, e a caixa de digitar é a única coisa
 *   nesta peça que mostra o rascunho.
 *
 * A ESPERA É DE 350 ms, E NÃO DE ZERO
 *   O preço de uma busca é uma varredura da lista sob a política de acesso —
 *   1,8 s de piso na `ATENDIMENTO`. Uma ida ao servidor por tecla faria oito
 *   varreduras para digitar `sabor doce`, e a última resposta poderia chegar
 *   antes da penúltima. `Enter` atravessa a espera, para quem já sabe o que
 *   quer não esperar por nada.
 *
 *   ⚠️ SAIR DA CAIXA TAMBÉM ATRAVESSA — revisão pós-F43. Digitar e clicar num
 *   cartão antes dos 350 ms fazia o relógio disparar DEPOIS de o card abrir ao
 *   lado, e o `replace` da busca apagava a entrada do painel. Agora o `blur`
 *   grava o pendente na hora, e o relógio não escreve em outra entrada do
 *   histórico. Ver `@/board/espera-da-busca`.
 *
 * ⚠️ O MENU OFERECE QUEM SE ALCANÇA, E NÃO QUEM JÁ TEM TAREFA — F17.70
 *   Até a F17.68 `opcoes` era montada a partir de quem APARECIA como
 *   responsável naquele quadro. Com 17 pessoas no sistema e 7 com alguma
 *   tarefa, o menu escondia as dez que estavam sem trabalho — que são
 *   exatamente as que alguém abre este menu para encontrar.
 *
 *   Agora a lista vem de quem QUEM ESTÁ OLHANDO alcança, pela regra de empresa
 *   que já existia (F17.34/F17.53), unida a quem já é responsável ali. Duas
 *   pessoas de empresas diferentes veem listas diferentes, e isso é medido no
 *   banco: `scripts/provar-o-filtro-de-responsavel.mjs`.
 *
 *   ⚠️ O NÚMERO AO LADO DO NOME CONTINUA SENDO O DAQUELE QUADRO, e quem alcança
 *   e tem zero aparece **com zero**. Zero não é um erro a esconder — é a
 *   resposta. E ele NÃO obedece à busca: a lista é a mesma a cada tecla, então
 *   a barra não recontou gente nenhuma por causa da digitação.
 *
 * SEM RESPONSÁVEL É UMA ESCOLHA, E NÃO UM CASO DE BORDA
 *   1.015 das 1.070 tarefas da `ATENDIMENTO` não têm ninguém — herança da
 *   importação da F17.49. Um menu de responsável sem essa linha deixaria a
 *   maioria esmagadora do trabalho fora de qualquer peneira.
 */

import { useEffect, useRef, useState } from 'react';

import type { BoardAssigneeOption } from '@/board/board';
import {
  type FiltroDeTarefas,
  SEM_FILTRO,
  SEM_RESPONSAVEL,
  TETO_DA_BUSCA,
  nomeDoResponsavel,
  temFiltro,
} from '@/board/filtro';
import { ESPERA_DA_BUSCA, entradaDoHistorico, esperaDaBusca } from '@/board/espera-da-busca';
import { Avatar, Balao, ItemDeMenu, Separador } from '@/board/menus';
import { IconeBusca, IconeFechar } from '@/ui/Icones';

export function BarraDeFiltro({
  filtro,
  aplicado,
  opcoes,
  semResponsavel,
  achadas,
  total,
  ocupado,
  aoMudar,
}: {
  /** O filtro pedido — o que mora no endereço. */
  filtro: FiltroDeTarefas;
  /**
   * O filtro que o servidor aplicou, quando já houve resposta. Nulo enquanto a
   * primeira ainda não chegou. É dele que sai a frase, e não de `filtro`.
   */
  aplicado: FiltroDeTarefas | null;
  opcoes: readonly BoardAssigneeOption[];
  /** Quantas tarefas não têm ninguém. É a contagem da opção `Sem responsável`. */
  semResponsavel: number;
  /** Quantas passaram pelo filtro, contadas no banco. */
  achadas: number;
  /** Quantas há ao todo, contadas no banco. */
  total: number;
  /** Há uma leitura em voo — a caixa continua digitável, o menu espera. */
  ocupado: boolean;
  aoMudar: (f: FiltroDeTarefas) => void;
}) {
  const [rascunho, setRascunho] = useState(filtro.texto);
  const [menuAberto, setMenuAberto] = useState(false);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);

  /* O relógio grava com o filtro e o `aoMudar` do desenho MAIS NOVO: o
     responsável pode ter mudado entre a tecla e o disparo. */
  const atual = useRef({ filtro, aoMudar });
  useEffect(() => {
    atual.current = { filtro, aoMudar };
  }, [filtro, aoMudar]);
  const [espera] = useState(() =>
    esperaDaBusca({
      espera: ESPERA_DA_BUSCA,
      gravar: (texto) => atual.current.aoMudar({ ...atual.current.filtro, texto }),
      ondeEstou: entradaDoHistorico,
    }),
  );

  /* O RASCUNHO SEGUE O FILTRO QUANDO ELE MUDA POR FORA — `Limpar`, o botão
     VOLTAR do navegador, um endereço colado. Sem isto, apertar `Limpar`
     esvaziaria a lista e deixaria a palavra escrita na caixa, dizendo que se
     está buscando algo que não se está mais. */
  useEffect(() => {
    setRascunho(filtro.texto);
  }, [filtro.texto]);

  // O relógio morre com a peça: um pedido disparado depois da tela trocar
  // pintaria o quadro errado.
  useEffect(() => espera.cancelar, [espera]);

  const pedir = (proximo: FiltroDeTarefas) => {
    espera.cancelar();
    aoMudar(proximo);
  };

  const digitar = (texto: string) => {
    setRascunho(texto);
    espera.digitar(texto);
  };

  const escolher = (quem: string | null) => {
    setMenuAberto(false);
    pedir({ ...filtro, responsavel: quem });
  };

  const dito = aplicado ?? SEM_FILTRO;
  const filtrando = temFiltro(dito);
  const quem = nomeDoResponsavel(filtro, opcoes);
  const buscado = dito.texto.trim();

  return (
    <div className="q-filtro">
      {/* A CAIXA DE BUSCA. `type="search"` traz o X do navegador de graça em
          alguns, e nenhum X em outros — por isso o nosso está aqui, sempre.

          F06A: o MESMO desenho do `CampoDeBusca` das outras telas (`.iw-busca`,
          40 px, anel de foco na caixa, X de ícone). A lógica continua sendo
          desta peça — a espera de 350 ms e o `Enter` que atravessa —, que o
          campo comum não tem. `type="text"` de propósito: o nome e o papel
          (`textbox`) são os que as provas e o leitor de tela já conhecem. */}
      <div className="iw-busca q-filtro-caixa" role="search">
        <IconeBusca className="iw-busca-lupa h-4 w-4" />
        <input
          className="q-filtro-texto"
          type="text"
          value={rascunho}
          maxLength={TETO_DA_BUSCA}
          placeholder="Buscar tarefa pelo nome…"
          aria-label="Buscar tarefa pelo nome"
          autoComplete="off"
          onChange={(e) => digitar(e.target.value)}
          // O foco sai antes do clique no cartão navegar: a busca pendente vai
          // para o endereço AGORA, e não por cima da entrada do painel.
          onBlur={espera.gravarJa}
          onKeyDown={(e) => {
            // `Enter` não espera. `Esc` limpa a busca sem tirar o foco da caixa.
            if (e.key === 'Enter') pedir({ ...filtro, texto: rascunho });
            if (e.key === 'Escape' && rascunho !== '') {
              setRascunho('');
              pedir({ ...filtro, texto: '' });
            }
          }}
        />
        {rascunho !== '' && (
          <button
            type="button"
            className="iw-busca-limpar"
            aria-label="Apagar a busca"
            title="Apagar a busca"
            onClick={(e) => {
              setRascunho('');
              pedir({ ...filtro, texto: '' });
              // O foco volta para a caixa, como no `CampoDeBusca`: o X some
              // ao apagar, e o foco não pode cair no nada.
              (e.currentTarget.parentElement?.querySelector('input') as HTMLInputElement | null)?.focus();
            }}
          >
            <IconeFechar className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* O BOTÃO `Responsável`, com o menu do ClickUp. Fecha por X, `Esc` e
          clique fora — isso é do `Balao` (F17.33), e não se refaz aqui. */}
      <span className="cu-ancora">
        <button
          ref={setAncora}
          type="button"
          className="cu-chip q-filtro-quem"
          data-cheio={filtro.responsavel !== null}
          aria-haspopup="menu"
          aria-expanded={menuAberto}
          disabled={ocupado}
          title="Filtrar por quem é responsável"
          onClick={() => setMenuAberto((v) => !v)}
        >
          <span className="rotulo">{quem === null ? 'Responsável' : quem}</span>
        </button>

        {menuAberto && (
          <Balao
            lado="baixo"
            ancora={ancora}
            rotulo="Filtrar por responsável"
            aoFechar={() => setMenuAberto(false)}
          >
            <div className="cu-balao-titulo">Responsável</div>

            <div className="cu-rolagem">
              <ItemDeMenu marcado={filtro.responsavel === null} aoEscolher={() => escolher(null)}>
                <span className="rotulo">Qualquer um</span>
              </ItemDeMenu>

              <ItemDeMenu
                marcado={filtro.responsavel === SEM_RESPONSAVEL}
                aoEscolher={() => escolher(SEM_RESPONSAVEL)}
                fim={<span className="tnum">{semResponsavel}</span>}
              >
                <span className="rotulo">Sem responsável</span>
              </ItemDeMenu>

              <Separador />

              {opcoes.length === 0 && (
                <p className="cu-vazio">Ninguém está como responsável por aqui.</p>
              )}

              {opcoes.map((p) => (
                <ItemDeMenu
                  key={p.id}
                  marcado={filtro.responsavel === p.id}
                  aoEscolher={() => escolher(p.id)}
                  fim={<span className="tnum">{p.tasks}</span>}
                >
                  <Avatar pessoa={p} />
                  <span className="rotulo">{p.name}</span>
                </ItemDeMenu>
              ))}
            </div>
          </Balao>
        )}
      </span>

      {/* O QUE ESTÁ FILTRADO, DITO EM NÚMERO E EM PALAVRA.
          `aria-live` porque ele muda sem a página recarregar — a mesma razão do
          pé da coluna cortada (F17.50).

          ⚠️ O RESPONSÁVEL NÃO SE REPETE AQUI, e o texto sim. O botão ao lado JÁ
          diz de quem é a peneira, e escrevê-lo duas vezes na mesma linha deu
          `Sem responsável | 1015 de 1070 · Sem responsável` na primeira captura
          desta etapa. O texto é outra história: o botão muda no ato, e a caixa
          de digitar mostra o RASCUNHO — só esta linha diz por qual palavra os
          números que estão do lado dela foram contados. */}
      {filtrando && (
        <span className="q-filtro-dito tnum" aria-live="polite">
          {achadas} de {total}
          {buscado !== '' && <> · “{buscado}”</>}
        </span>
      )}

      {(filtrando || temFiltro(filtro)) && (
        <button
          type="button"
          className="o-btn o-btn-vidro o-btn-sm"
          onClick={() => {
            setRascunho('');
            pedir(SEM_FILTRO);
          }}
        >
          Limpar
        </button>
      )}
    </div>
  );
}
