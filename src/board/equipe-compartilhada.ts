/**
 * O DIRETÓRIO, UMA VEZ, PARA AS TELAS QUE ATRIBUEM — etapa F17.CARGA03.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO SUBSTITUI
 *
 *   Duas cópias do MESMO efeito de montagem, letra por letra — uma na ficha da
 *   tarefa (`pages/Tarefa.tsx`), outra na caixa de tarefa nova
 *   (`board/ModalDeTarefa.tsx`):
 *
 *       const r = await api.equipe();
 *       setEquipe(r.team);
 *       setMeuId(r.me ?? null);
 *     } catch (e) {
 *       if (paraLogin(e)) return;
 *       setEquipe([]);
 *
 *   Abrir cinco tarefas seguidas pagava `/team` cinco vezes para desenhar a
 *   MESMA lista de oito nomes. Criar uma tarefa no meio do caminho pagava a
 *   sexta. O estado morava no componente, e componente que desmonta leva o que
 *   sabia junto — a dívida 3 da F17.67, no diretório em vez de na árvore.
 *
 * ⚠️ O SILÊNCIO É COMPORTAMENTO, E ELE FOI PRESERVADO DE PROPÓSITO
 *
 *   As duas cópias engoliam a falha: sem o diretório, `equipe` virava `[]`, o
 *   seletor de pessoas ficava vazio e A FICHA ABRIA DO MESMO JEITO. Isso não
 *   era descuido — é a regra da tarefa 5 desta fase, escrita antes dela: a
 *   tarefa tem de continuar editável sem esperar menu auxiliar nenhum.
 *
 *   Aqui a falha continua sendo silêncio. `pessoas` volta vazio, `erro` fica
 *   guardado para quem quiser dizer alguma coisa, e nenhuma tela é obrigada a
 *   olhar. O que NÃO é silêncio é o 401: ele manda ao login, como mandava.
 *
 * ⚠️ ISTO NÃO É A LISTA DE RESPONSÁVEIS ELEGÍVEIS DE UMA TAREFA
 *   `/team` é `ideworks.team_directory()` — "a quem EU posso atribuir", uma
 *   pergunta sobre o ator. A lista por TAREFA é outra rota
 *   (`GET /board/tasks/:id/assignable`, a F17.69) e outra pergunta — "quem
 *   alcança ESTA tarefa" —, que depende da lista e do cliente de cada uma.
 *
 *   Compartilhar aquela entre tarefas ofereceria, numa delas, gente que o banco
 *   recusaria; o plano proíbe, e ela continua sendo lida ao abrir o menu do
 *   cartão, uma vez, para aquela tarefa. Ver `server/responsaveis-da-tarefa.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { TaskPerson } from '@/board/ficha';
import { api, semSessao } from '@/lib/api';
import { CHAVE_DA_EQUIPE, useClienteDeConsultas } from '@/lib/consultas';

/**
 * O vazio ESTÁVEL — a mesma razão de `SEM_EMPRESAS` em `arvore-compartilhada`.
 *
 * `[]` escrito na hora seria um array novo a cada desenho, e o diretório vai
 * como propriedade para `MenuDePessoas` e para `conferirDescarte`: bastaria
 * para refazer memórias que dependem dele.
 */
const SEM_NINGUEM: TaskPerson[] = [];

export type Diretorio = {
  /** Quem pode receber tarefa. Vazio enquanto não há resposta, e na falha. */
  pessoas: TaskPerson[];
  /** Qual deles sou eu — o `Eu` no topo do seletor. `null` sem resposta. */
  meuId: string | null;
};

async function lerEquipe({ signal }: { signal: AbortSignal }): Promise<Diretorio> {
  const r = await api.equipe(signal);
  return { pessoas: r.team as TaskPerson[], meuId: r.me ?? null };
}

/**
 * A consulta, do jeito que a tela a pede.
 *
 * Exportada pela mesma razão de `consultaDaArvore`: a suíte liga um observador
 * a ELA — o mesmo objeto que o gancho entrega ao React — e não a uma cópia
 * parecida, que provaria o teste em vez da tela.
 */
export const consultaDaEquipe = {
  queryKey: CHAVE_DA_EQUIPE,
  queryFn: lerEquipe,

  /**
   * ⚠️ A ÚNICA EXCEÇÃO À REGRA DE `retryOnMount` DO CLIENTE — e ela é medida.
   *
   *   O cliente inteiro tem `retryOnMount: false`, pela regra da F17.AUD04: uma
   *   consulta que falhou não tenta de novo só porque outra tela montou; quem
   *   decide tentar de novo é a PESSOA, no botão que a tela oferece.
   *
   *   O diretório NÃO TEM ESSE BOTÃO, e não deve ter: a falha dele é silêncio
   *   deliberado — o seletor de pessoas fica vazio e a ficha abre do mesmo
   *   jeito. Um `Tentar de novo` para isso seria uma faixa de erro em toda
   *   tarefa por causa de um menu que talvez ninguém abra.
   *
   *   Sem esta linha, então, a herança produziria uma REGRESSÃO em relação ao
   *   código que esta fase substitui: antes, cada ficha lia `/team` ao montar,
   *   e uma falha se curava sozinha na tarefa seguinte. Com a leitura
   *   compartilhada e `retryOnMount: false`, uma falha de rede deixaria o
   *   seletor vazio por até cinco minutos, sem nenhuma porta de saída além do
   *   F5. Aqui a montagem seguinte tenta outra vez — que é exatamente o
   *   comportamento antigo, e uma tentativa por abertura, nunca em série.
   */
  retryOnMount: true,
} as const;

/** A sessão acabou — quem responde a isso é o login, e não o seletor de gente. */
const sessaoAcabou = (erro: unknown): boolean => erro !== null && semSessao(erro);

/**
 * O diretório compartilhado.
 *
 * ⚠️ NENHUMA TELA ESPERA POR ELE. O gancho não devolve "carregando" porque
 * ninguém deveria bloquear desenho por causa disto: a ficha da tarefa abre,
 * edita e salva com o diretório vazio, e o seletor de pessoas é o único que
 * fica sem opções. Devolver um `carregando` seria oferecer a alguém a chance de
 * segurar a tela com ele.
 */
export function useEquipe(): Diretorio {
  const cliente = useClienteDeConsultas();

  const { data, error } = useQuery(consultaDaEquipe, cliente);

  /* Sessão vencida não é falha de diretório: é a hora de entrar de novo. Num
     efeito, e não no meio do desenho — a mesma regra de `useArvoreCompleta`. */
  const acabou = sessaoAcabou(error);
  useEffect(() => {
    if (acabou) window.location.replace('/');
  }, [acabou]);

  return { pessoas: data?.pessoas ?? SEM_NINGUEM, meuId: data?.meuId ?? null };
}
