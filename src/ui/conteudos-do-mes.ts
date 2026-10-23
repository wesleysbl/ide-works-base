/**
 * O que a grade do mês desenha — a busca, num lugar só. Etapa F17.40.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ A RESPOSTA QUE CHEGA TARDE MANDA NA TELA — E ISSO FOI MEDIDO
 *
 *   O calendário geral trocava de mês assim:
 *
 *       const r = await api.calendario(janela.from, janela.to);
 *       setEntradas(r.entries);
 *
 *   Sem cancelar nada, e sem perguntar se a resposta ainda interessa. Abrindo o
 *   calendário em agosto e pedindo dezembro, o Chrome mostrou, meio segundo
 *   depois, os 622 conteúdos de dezembro — e meio segundo mais tarde voltou aos
 *   158 de agosto, porque a resposta de agosto chegou DEPOIS e sobrescreveu.
 *
 *   Medido em 2026-08-31, no código de antes desta etapa, com
 *   `scripts/ver-o-mes-do-cliente.mjs`:
 *
 *       SERIE 0  → 622 conteúdos, 622 pastilhas   (dezembro, certo)
 *       SERIE 1  → 158 conteúdos,   0 pastilhas   (agosto, e ficou assim)
 *
 *   A grade continuava sendo a de dezembro. Ou seja: mês de dezembro, contagem
 *   de agosto, zero conteúdos desenhados — e nenhum erro, nenhum aviso. Quem
 *   estivesse operando concluiria que dezembro está vazio.
 *
 *   Aqui cada busca leva um número. Quando a resposta volta, ela só escreve na
 *   tela se ainda for a busca mais recente. Não é otimização: é a diferença
 *   entre a tela dizer a verdade e a tela mentir em silêncio.
 *
 * POR QUE UM GANCHO, E NÃO DUAS CÓPIAS
 *   O calendário geral e a aba do cliente pedem a MESMA rota, com um parâmetro
 *   de diferença. Duas cópias desta função seriam duas chances de esquecer o
 *   número da vez — e foi por copiar que a F17.25 e a F17.26 tiveram de voltar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';

import { ApiError, api, semSessao } from '@/lib/api';
import type { EntradaDoMes, Janela } from '@/ui/grade-do-mes';

/**
 * @param recarga Um número que, ao mudar, obriga a busca a recomeçar — F17.44.
 *   Existe porque o calendário passou a ESCREVER: depois de marcar um
 *   compromisso, a janela é a mesma e o cliente é o mesmo, então nenhuma das
 *   dependências mudou e o efeito não rodaria de novo. A grade continuaria
 *   mostrando o mês de antes da escrita, sem erro nenhum na tela.
 */
export function useConteudosDoMes(janela: Janela, clienteId?: string, recarga = 0) {
  const [entradas, setEntradas] = useState<EntradaDoMes[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const vez = useRef(0);
  /** De que janela (e cliente) são as `entradas` que estão na tela. */
  const lidoDe = useRef<string | null>(null);
  /** "Tentar de novo": soma um e a busca recomeça, sem outra dependência mudar. */
  const [tentativa, setTentativa] = useState(0);

  // As dependências são os TEXTOS da janela, e não o objeto: `janelaDoMes`
  // devolve um objeto novo a cada desenho, e um objeto novo por si só faria a
  // busca recomeçar do nada, para sempre.
  const { from, to } = janela;

  useEffect(() => {
    const minha = vez.current + 1;
    vez.current = minha;
    const desta = `${from}|${to}|${clienteId ?? ''}`;
    setCarregando(true);
    setErro(null);

    api
      .calendario(from, to, clienteId)
      .then((r) => {
        if (minha !== vez.current) return; // chegou tarde: a tela já pediu outra
        setEntradas(r.entries as EntradaDoMes[]);
        lidoDe.current = desta;
        setCarregando(false);
      })
      .catch((e) => {
        if (semSessao(e)) {
          // Sem sessão a tela não tem o que mostrar. Mandar para a entrada é
          // mais útil que exibir lista vazia com "faltou o crachá", que faz
          // parecer defeito quando a pessoa só precisa entrar.
          window.location.replace('/');
          return;
        }
        if (minha !== vez.current) return;
        // O QUE ESTÁ NA TELA É DE OUTRA JANELA? ENTÃO SAI. Trocar de mês (ou de
        // cliente) e falhar deixava as entradas da leitura anterior sob o nome
        // do mês novo, e a contagem dizia "158 conteúdo(s)" de um mês que não
        // foi lido. Falhar na MESMA janela (a releitura depois de marcar algo)
        // mantém o que já estava: é o mês certo, só pode estar desatualizado.
        if (lidoDe.current !== desta) {
          setEntradas([]);
          lidoDe.current = null;
        }
        setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar.');
        setCarregando(false);
      });
  }, [from, to, clienteId, recarga, tentativa]);

  return { entradas, erro, carregando, tentarDeNovo: () => setTentativa((n) => n + 1) };
}
