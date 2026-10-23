/**
 * O roteador do IDE Works — etapa F1.9, recomposto na F17.AUD03.
 *
 * A TABELA MORA EM `src/rotas.tsx`; aqui só se monta o roteador. Ver o
 * cabeçalho de lá para o que é público, o que é adiado e por que a tabela
 * saiu deste arquivo.
 *
 * ROTEADOR DE DADOS, E NÃO `<BrowserRouter>` — F17.AUD03
 *   A ficha da tarefa precisa segurar a saída quando há texto por salvar — o
 *   X, o `‹ Voltar`, o botão do navegador, a barra lateral, a trilha, os links
 *   para a mãe e para as subtarefas. A biblioteca instalada tem esse bloqueio
 *   (`useBlocker`), mas só no roteador de dados: `createBrowserRouter` +
 *   `RouterProvider`. A composição mudou de forma; os endereços, o histórico
 *   (`history.state.idx`, que o `Voltar` lê), o carregamento sob demanda e a
 *   restauração de rolagem ficaram os mesmos — a mesma `createBrowserHistory`
 *   serve aos dois modos.
 *
 * ⚠️ UM ROTEADOR SÓ, CRIADO UMA VEZ
 *   `createBrowserRouter` ouve o `popstate` do documento ao nascer. Criá-lo a
 *   cada desenho — ou duas vezes, como o modo estrito faz com inicializadores
 *   de estado — deixaria roteadores órfãos ouvindo o botão do navegador. Ele
 *   é de módulo, e nasce no primeiro desenho, não na importação: a tabela é
 *   importada por teste sem navegador, e `createBrowserRouter` exige um.
 *
 * O PROVEDOR DE CONSULTAS FICA ACIMA DO ROTEADOR — F17.CARGA02
 *   Acima, e não dentro de uma tela, porque o ponto INTEIRO é sobreviver à
 *   troca de rota: o cache que morresse junto com a tela seria o estado em
 *   componente que a etapa veio substituir. Ele tem a vida da aplicação, como
 *   o roteador — e pelo mesmo motivo o cliente é de módulo (ver
 *   `@/lib/consultas`).
 *
 *   É este provedor que chama `mount()` no cliente, e é `mount()` quem assina o
 *   foco da janela e a volta da rede. Sem ele haveria cache, e não haveria
 *   revalidação ao voltar para a aba.
 */

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import { clienteDeConsultas } from '@/lib/consultas';
import { ROTAS } from '@/rotas';

let roteador: ReturnType<typeof createBrowserRouter> | null = null;

export default function App() {
  roteador ??= createBrowserRouter(ROTAS);
  return (
    <QueryClientProvider client={clienteDeConsultas}>
      <RouterProvider router={roteador} />
    </QueryClientProvider>
  );
}
