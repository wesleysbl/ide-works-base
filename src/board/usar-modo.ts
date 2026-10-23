/**
 * O MODO DE UMA TELA — F18C (revisão de 28/09, R09). A mesma regra em todas as
 * telas de trabalho: espaço, pasta, lista, `Minhas tarefas`, `Todas as
 * tarefas` e as listas operacionais da ficha do cliente.
 *
 *   modo = endereço (`?ver=`) › escolha DESTA tela › última escolha no TIPO de
 *          tela › padrão do contexto            (ver `resolverModo`)
 *
 * Trocar o modo grava a preferência desta tela e do tipo de tela (`@/ui/lugar`,
 * `modos`) e, quando a tela mora no endereço, escreve `?ver=`. Uma tela não
 * mexe na escolha das outras: a chave é `contexto:<id>` e `contexto`.
 *
 * `endereco: false` — as áreas da ficha do cliente. A área já vive no
 * endereço (`?area=`), e um `?ver=kanban` que sobrasse ao trocar de Checklist
 * para Conteúdos vazaria o modo de uma lista para a outra. Ali o modo é só
 * preferência, como a forma do Mural (`ideworks:mural-vista`).
 *
 * `explicito` — `Minhas tarefas` e `Todas as tarefas` escrevem sempre
 * `?ver=lista`/`?ver=kanban` (F17.79: a forma está no endereço colado).
 *
 * `escrever` — quem já grava o endereço por uma regra própria (`Minhas
 * tarefas` conserva o texto da busca e o estado da entrada) recebe o valor e
 * escreve do seu jeito.
 */

import { useCallback } from 'react';

import {
  type ContextoDoModo,
  type Modo,
  PARAMETRO_DO_MODO,
  lembrarModo,
  modoParaEndereco,
  resolverModo,
} from '@/board/lista-kanban';
import { useLugar } from '@/ui/aparencia';
import { useParametrosNoEndereco } from '@/ui/endereco';

export function useModoDaTela(
  contexto: ContextoDoModo,
  id: string | null,
  {
    endereco = true,
    explicito = false,
    escrever,
  }: { endereco?: boolean; explicito?: boolean; escrever?: (valor: string) => void } = {},
): [Modo, (modo: Modo) => void] {
  const [lugar, definirLugar] = useLugar();
  const [parametros, definirParametros] = useParametrosNoEndereco();

  const modo = resolverModo({
    doEndereco: endereco ? parametros.get(PARAMETRO_DO_MODO) : null,
    guardados: lugar.modos,
    contexto,
    id,
  });

  const escolher = useCallback(
    (m: Modo) => {
      definirLugar((l) => ({ ...l, modos: lembrarModo(l.modos, contexto, id, m) }));
      if (!endereco) return;
      const valor = explicito ? m : modoParaEndereco(m, contexto);
      if (escrever) escrever(valor);
      else definirParametros({ [PARAMETRO_DO_MODO]: valor });
    },
    [definirLugar, definirParametros, contexto, id, endereco, explicito, escrever],
  );

  return [modo, escolher];
}
