/**
 * DEFINIR RESPONSÁVEL PELA CAPA DO CARTÃO — etapa F17.69.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PEDIDO
 *   *"A equipe necessita alterar ou definir o responsável por um cartão
 *   diretamente pelo quadro, sem abrir o modal completo da tarefa."*
 *
 * ⚠️ POR QUE ISTO NÃO MORA NAS PÁGINAS
 *   O gesto tem de funcionar no quadro da LISTA e no quadro da PASTA (F17.64),
 *   e as duas páginas são arquivos separados. Escrever o mesmo laço duas vezes
 *   é o que faz um quadro ganhar o conserto e o outro não — foi assim que
 *   `CorpoDoCartao` nasceu na F17.18. Aqui o estado, a escrita, o otimismo e o
 *   desfazer moram num lugar só, e cada página passa duas funções: como avisar,
 *   e como reler o quadro.
 *
 * ⚠️ O DESFAZER É A RAZÃO DE O OTIMISMO MORAR AQUI
 *   A capa mostra as iniciais na hora do clique, antes de o banco responder —
 *   sem isso o gesto parece não ter acontecido. Mas a escrita PODE ser recusada:
 *   desde a F17.69 `set_task_assignees` confere se a pessoa alcança a empresa
 *   daquela tarefa. Uma capa que ficasse mostrando a pessoa recusada seria pior
 *   que não mostrar nada — a equipe passaria a acreditar numa atribuição que o
 *   banco não tem.
 *
 *   Então o que a capa mostra é `otimista[taskId] ?? tarefa.assignees`, e a
 *   entrada some em três casos: deu certo (e a releitura do quadro traz o valor
 *   de verdade), deu errado (volta ao que era), ou a página trocou de quadro.
 *
 * ⚠️ E O QUE FICA DEPOIS DO SUCESSO NÃO É O QUE SE PEDIU
 *   `set_task_assignees` descarta em silêncio quem não tem perfil (F4.8), então
 *   a resposta da escrita é a ficha RELIDA. É dela que sai o conjunto que a capa
 *   passa a mostrar — o mesmo argumento que já vale para a ficha.
 *
 * O CUSTO
 *   A lista de gente é pedida quando o menu ABRE, para AQUELA tarefa, e é
 *   guardada enquanto ele estiver aberto. Nada disso entra no carregamento do
 *   quadro — que está em 379 ms no quadro da pasta (F17.74) porque a política de
 *   `task_assignees` cobra uma pergunta de alcance por linha (F17.3). Ver
 *   `server/responsaveis-da-tarefa.ts`.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { BoardAssignee } from '@/board/board';
import { type FilaDeGravacoes, criarFilaDeGravacoes } from '@/board/fila-de-gravacoes';
import { ApiError, api } from '@/lib/api';
import { entregar, useVez } from '@/ui/vez';

/** Uma linha do seletor: nome, e se aquela pessoa já é responsável. */
export type PessoaAtribuivel = BoardAssignee & { assigned: boolean };

/**
 * O que o cartão precisa saber para oferecer o seletor de responsável.
 *
 * ⚠️ MESMA FORMA DE `MoverDoCartao` (F17.63), e de propósito: o estado de aberto
 * vem de FORA porque a coluna desenha cinquenta cartões, e cada um guardando o
 * próprio `aberto` deixaria dois menus abertos ao mesmo tempo. Nada aqui fala
 * com o banco: o cartão avisa o conjunto escolhido, e quem escreve é este
 * módulo — pela mesma `set_task_assignees` que a ficha usa (regra 9).
 */
export type ResponsavelDoCartao = {
  /** Quem a CAPA mostra agora. Otimista enquanto a escrita não voltou. */
  pessoas: readonly BoardAssignee[];
  aberto: boolean;
  /** A lista ainda não chegou. O balão abre com o aviso, e não vazio. */
  carregando: boolean;
  /** Enquanto a escrita não voltou. Um segundo pedido em cima do primeiro não. */
  desativado: boolean;
  /** Quem se pode oferecer NESTA tarefa — já estreitado por empresa no banco. */
  opcoes: readonly BoardAssignee[];
  meuId: string | null;
  aoAlternar: () => void;
  aoFechar: () => void;
  /** O conjunto INTEIRO, e não um a um: a escrita do banco é de conjunto. */
  aoMudar: (ids: readonly string[]) => void;
};

/**
 * De um conjunto de ids para as pessoas que a capa desenha.
 *
 * ⚠️ O NOME PODE VIR DE DOIS LUGARES, e os dois são necessários. Quem foi
 * MARCADO agora só tem nome na lista do menu; quem já estava e continua pode
 * estar FORA dessa lista — é o caso de um responsável antigo fora da parede de
 * hoje, que o menu traz marcado justamente para poder ser tirado. Sem a segunda
 * metade, tirar OUTRA pessoa faria esse nome sumir da capa por um instante e
 * voltar depois da releitura, que é piscar sem motivo.
 */
export function pessoasDoConjunto(
  ids: readonly string[],
  ofertas: readonly BoardAssignee[],
  atuais: readonly BoardAssignee[],
): BoardAssignee[] {
  const porId = new Map<string, BoardAssignee>();
  for (const p of atuais) porId.set(p.id, p);
  for (const p of ofertas) porId.set(p.id, p);
  return ids.map((id) => porId.get(id) ?? { id, name: '?' });
}

/** O que a página precisa dar ao gancho. */
export type LigacaoDoResponsavel = {
  /** Onde a frase de erro (ou de confirmação) aparece. Já existe nos dois quadros. */
  aoAvisar: (texto: string | null) => void;
  /** Reler o quadro depois de a escrita voltar. */
  aoTerminar: () => Promise<void> | void;
};

/**
 * O gancho que as duas páginas usam.
 *
 * Devolve uma FÁBRICA: `responsavelDoCartao(tarefa)` monta o objeto daquele
 * cartão. É a mesma forma de `moverDoCartao` na F17.63.
 */
export function useResponsavelDoCartao({ aoAvisar, aoTerminar }: LigacaoDoResponsavel) {
  /** Qual cartão está com o menu aberto. Um, no máximo. */
  const [aberto, setAberto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ofertas, setOfertas] = useState<readonly BoardAssignee[]>([]);
  const [meuId, setMeuId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<ReadonlySet<string>>(new Set());
  /** O que a capa mostra enquanto a escrita não voltou. Ver o cabeçalho. */
  const [otimista, setOtimista] = useState<ReadonlyMap<string, BoardAssignee[]>>(new Map());

  /**
   * QUEM DECIDE SE A LISTA QUE CHEGOU AINDA É A DESTE MENU — revisão de 08/10.
   *
   * Abrir o menu do cartão A, fechá-lo (Esc) e abrir o do B antes de a lista do A
   * chegar é o gesto comum com a rede lenta, e o balão do A cobre o cartão de baixo,
   * então não há outro jeito de chegar ao B. A lista do A, chegando depois da do B,
   * sobrescrevia `ofertas` — e o menu do B passava a oferecer a gente do A: o
   * "defeito exato" do comentário de `abrir`, por outra porta. Ela também apagava o
   * "carregando" do B e, se falhasse, fechava o menu do B com o erro do A. Cada
   * abertura pega um bilhete e `fechar` encerra a vez (`@/ui/vez`).
   */
  const vez = useVez();

  const fechar = useCallback(() => {
    vez.encerrar();
    setAberto(null);
    setOfertas([]);
    setCarregando(false);
  }, [vez]);

  /**
   * Abrir busca a lista DAQUELA tarefa. Fechar joga fora.
   *
   * Não há cache entre cartões de propósito: a lista é estreitada por tarefa
   * (uma pessoa pode alcançar a lista de um cartão e não a do vizinho, que é o
   * caso do quadro da pasta), e guardar a do cartão anterior ofereceria gente
   * errada no cartão seguinte — o defeito exato que a etapa fecha.
   */
  const abrir = useCallback(
    async (taskId: string) => {
      const bilhete = vez.abrir(taskId);
      setAberto(taskId);
      setOfertas([]);
      setCarregando(true);
      await entregar(vez, bilhete, api.pessoasAtribuiveis(taskId), {
        chegou: (r) => {
          setOfertas(r.people.map((p) => ({ id: p.id, name: p.name })));
          setMeuId(r.me ?? null);
        },
        falhou: (e) => {
          aoAvisar(
            e instanceof ApiError
              ? e.message
              : 'Não deu para carregar quem pode ser responsável. Tente de novo.',
          );
          setAberto(null);
        },
        terminou: () => setCarregando(false),
      });
    },
    [aoAvisar, vez],
  );

  /**
   * UMA FILA POR CARTÃO — revisão de 08/10.
   *
   * O menu da capa fica aberto enquanto se marca, e o segundo clique chegava com
   * a primeira gravação ainda no ar: `gravar` o IGNORAVA, em silêncio, e a
   * pessoa via a segunda marca não pegar (o servidor ficava só com a primeira).
   * Agora o clique entra na fila do cartão e sai quando a gravação anterior
   * terminar, na ordem dos cliques (`@/board/fila-de-gravacoes`); só a ÚLTIMA
   * decide o que a capa mostra e quando reler o quadro.
   */
  const filas = useRef(new Map<string, FilaDeGravacoes>());
  const filaDe = (taskId: string): FilaDeGravacoes => {
    let fila = filas.current.get(taskId);
    if (fila === undefined) {
      fila = criarFilaDeGravacoes();
      filas.current.set(taskId, fila);
    }
    return fila;
  };

  const gravar = useCallback(
    async (tarefa: { id: string; assignees: readonly BoardAssignee[] }, ids: readonly string[]) => {
      const antes = [...tarefa.assignees];
      const atual = otimista.get(tarefa.id) ?? antes;

      // O QUE A CAPA PASSA A MOSTRAR NA HORA. Ver o cabeçalho: sem isto o gesto
      // não tem resposta, e com isto ele precisa saber voltar atrás.
      setOtimista((m) => new Map(m).set(tarefa.id, pessoasDoConjunto(ids, ofertas, atual)));
      setSalvando((s) => new Set(s).add(tarefa.id));
      aoAvisar(null);

      // ⚠️ A MESMA ESCRITA DA FICHA. `PATCH` com `assigneeIds` chama
      // `ideworks.set_task_assignees`, que confere a empresa de quem entra e
      // registra o que mudou em `task_events` (F17.65). A capa não ganhou
      // caminho de escrita próprio — a regra 9 existe para não haver segundo.
      const gravacao = filaDe(tarefa.id).enfileirar(() =>
        api.salvarTarefaDoQuadro(tarefa.id, { assigneeIds: [...ids] }),
      );
      const limpar = () =>
        setOtimista((m) => {
          const proximo = new Map(m);
          proximo.delete(tarefa.id);
          return proximo;
        });
      let deuCerto = false;

      try {
        const r = await gravacao.resultado;

        // Há clique mais novo na fila: a capa já mostra a escolha dele, e a
        // resposta dele é que diz o que ficou. Esta não mexe em nada.
        if (gravacao.ehAUltima()) {
          // O QUE FICOU, e não o que se pediu: a função do banco descarta em
          // silêncio quem não tem perfil no IDE Works (F4.8).
          const ficou = (r.task as { assignees?: BoardAssignee[] } | null)?.assignees;
          if (Array.isArray(ficou)) {
            setOtimista((m) =>
              new Map(m).set(
                tarefa.id,
                ficou.map((p) => ({ id: p.id, name: p.name })),
              ),
            );
          }
          await aoTerminar();
        }
        deuCerto = true;
      } catch (e) {
        // ⚠️ O DESFAZER. A capa volta a mostrar exatamente o que mostrava — se
        // não houver clique mais novo, cuja escolha a capa já mostra.
        if (gravacao.ehAUltima()) limpar();
        aoAvisar(
          e instanceof ApiError
            ? e.message
            : 'Não foi possível mudar o responsável. O cartão ficou como estava.',
        );
      } finally {
        if (gravacao.terminou()) {
          setSalvando((s) => {
            const proximo = new Set(s);
            proximo.delete(tarefa.id);
            return proximo;
          });
        }
      }

      // SÓ DEPOIS DA RELEITURA a marca otimista sai — antes dela, o quadro ainda
      // é o antigo, e limpar aqui faria a capa piscar de volta ao valor velho. E
      // só se nenhum clique mais novo chegou durante a releitura.
      if (deuCerto && gravacao.ehAUltima()) limpar();
    },
    [otimista, ofertas, aoAvisar, aoTerminar],
  );

  return useMemo(
    () =>
      (tarefa: { id: string; assignees: readonly BoardAssignee[] }): ResponsavelDoCartao => ({
        pessoas: otimista.get(tarefa.id) ?? tarefa.assignees,
        aberto: aberto === tarefa.id,
        carregando: aberto === tarefa.id && carregando,
        desativado: salvando.has(tarefa.id),
        opcoes: aberto === tarefa.id ? ofertas : [],
        meuId,
        aoAlternar: () => {
          if (aberto === tarefa.id) fechar();
          else void abrir(tarefa.id);
        },
        aoFechar: fechar,
        aoMudar: (ids) => void gravar(tarefa, ids),
      }),
    [otimista, aberto, carregando, salvando, ofertas, meuId, fechar, abrir, gravar],
  );
}
