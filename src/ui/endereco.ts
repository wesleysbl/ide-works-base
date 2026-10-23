/**
 * A ESCOLHA QUE MORA NO ENDEREÇO — etapa F17.24.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ALGUMAS COISAS VÃO PARA O ENDEREÇO E OUTRAS PARA O NAVEGADOR
 *
 *   **Se outra pessoa, abrindo o mesmo endereço, deve ver a mesma coisa, é
 *   URL. Se é arrumação pessoal, é navegador** (`@/ui/lugar`).
 *
 *   "Qual aba" e "qual visão" são a mesma coisa para quem abre: mandar
 *   `/tarefas?ver=quadro` num comentário e o colega cair na LISTA seria mandar
 *   um endereço que não leva onde diz. Já "quais pastas eu deixo abertas" não
 *   significa nada para ninguém além de mim.
 *
 *   O endereço ganha ainda duas coisas que o armazenamento não dá: ele
 *   sobrevive ao botão VOLTAR, e sobrevive a trocar de máquina.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ NENHUM ENDEREÇO QUE JÁ EXISTE MUDA
 *   `/quadro/:id` e `/tarefa/:id` estão em uso e podem ter sido colados em
 *   comentário. Isto aqui só ACRESCENTA parâmetro de consulta, que é ignorado
 *   por quem não o conhece — inclusive pelas versões da tela que vieram antes.
 *
 * `replace`, E NÃO `push`
 *   Trocar de aba não é navegar. Com `push`, quem passeasse pelas três abas de
 *   `Minhas tarefas` precisaria de três toques no VOLTAR para sair da tela — e
 *   o botão voltar viraria "desfazer clique", que não é o que ele promete.
 *   Com `replace`, o VOLTAR leva para a tela anterior, e a aba escolhida
 *   continua no endereço que ficou no histórico.
 *
 * O PARÂMETRO SÓ APARECE DEPOIS DE UMA ESCOLHA
 *   Chegando sem ele, vale o padrão de quem chama — que em `Minhas tarefas` é
 *   a aba escolhida no painel `Personalizar`. Escolhendo, ele é ESCRITO, mesmo
 *   quando coincide com o padrão: é o que faz o endereço colado valer para
 *   quem tem outro padrão configurado.
 *
 * TOLERANTE NA LEITURA
 *   `?aba=banana` não estoura nem mostra tela vazia: vira o padrão. O
 *   parâmetro vem da barra de endereço, e ali qualquer coisa pode ser digitada.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** O valor válido, ou o padrão. Puro, e testado sem navegador. */
export function escolhaValida<T extends string>(
  cru: string | null,
  validos: readonly T[],
  padrao: T,
): T {
  if (cru === null) return padrao;
  const limpo = cru.trim().toLowerCase();
  return (validos as readonly string[]).includes(limpo) ? (limpo as T) : padrao;
}

/**
 * Uma escolha de tela guardada no endereço.
 *
 * Devolve o par de sempre — o valor e quem o troca —, então a tela que a usa
 * troca `useState` por isto e não muda em mais nada.
 */
export function useEscolhaNoEndereco<T extends string>(
  chave: string,
  validos: readonly T[],
  padrao: T,
): [T, (valor: T) => void] {
  const [parametros, definirParametros] = useSearchParams();
  const valor = escolhaValida(parametros.get(chave), validos, padrao);

  const definir = useCallback(
    (novo: T) => {
      definirParametros(
        (anteriores) => {
          // Cópia, e não mutação do que veio: em modo estrito o React chama o
          // atualizador duas vezes, e mexer no objeto recebido faria a segunda
          // chamada trabalhar em cima do resultado da primeira.
          const proximos = new URLSearchParams(anteriores);
          proximos.set(chave, novo);
          return proximos;
        },
        { replace: true },
      );
    },
    [chave, definirParametros],
  );

  return [valor, definir];
}

/**
 * As mudanças aplicadas sobre os parâmetros de antes — puro, testado sem
 * navegador. Chave com valor vazio SAI do endereço (ver `useParametrosNoEndereco`).
 */
export function aplicarMudancas(anteriores: URLSearchParams, mudancas: Record<string, string>): URLSearchParams {
  // Cópia, e não mutação do que veio: em modo estrito o React chama o
  // atualizador duas vezes. Mesma razão de `useEscolhaNoEndereco`.
  const proximos = new URLSearchParams(anteriores);
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (valor === '') proximos.delete(chave);
    else proximos.set(chave, valor);
  }
  return proximos;
}

/** Opções de uma gravação de parâmetros. */
export type OpcoesDaGravacao = {
  /**
   * Conserva o `state` da entrada de navegação — F05. Sem isto, trocar um
   * parâmetro apaga o que a tela guardou na entrada (em `Minhas tarefas`, o
   * progresso da paginação), e ela precisa regravar com outro `replace`.
   */
  manterEstado?: boolean;
};

/**
 * VÁRIOS PARÂMETROS DE UMA VEZ, TROCADOS NO MESMO GESTO — F17.55.
 *
 * `useEscolhaNoEndereco` troca um. A busca e o responsável mudam JUNTOS —
 * `Limpar` apaga os dois —, e dois `setSearchParams` seguidos no mesmo evento
 * fariam o segundo partir do endereço de antes do primeiro: o `Limpar`
 * apagaria a busca e devolveria o responsável.
 *
 * A chave com valor vazio SAI do endereço, em vez de virar `?busca=`. A tela
 * sem filtro tem de ter o endereço limpo que sempre teve: ele é colado em
 * comentário.
 */
export function useParametrosNoEndereco(): [
  URLSearchParams,
  (mudancas: Record<string, string>, opcoes?: OpcoesDaGravacao) => void,
] {
  const [parametros, definirParametros] = useSearchParams();

  const definir = useCallback(
    (mudancas: Record<string, string>, opcoes?: OpcoesDaGravacao) => {
      definirParametros((anteriores) => aplicarMudancas(anteriores, mudancas), {
        replace: true,
        ...(opcoes?.manterEstado ? { state: estadoDaEntrada() } : {}),
      });
    },
    [definirParametros],
  );

  return [parametros, definir];
}

/** O `state` que o roteador guardou na entrada atual (`history.state.usr`). */
function estadoDaEntrada(): unknown {
  if (typeof window === 'undefined') return undefined;
  const h = window.history.state as { usr?: unknown } | null;
  return h?.usr;
}

/** O texto como vai para o endereço: só espaço é o mesmo que nada. */
export function textoParaEndereco(texto: string): string {
  return texto.trim() === '' ? '' : texto;
}

/**
 * UM TEXTO QUE MORA NO ENDEREÇO — F05 do plano UX (a busca de `Minhas tarefas`).
 *
 * A caixa responde na hora: o texto vive num estado local, e o endereço é
 * gravado DEPOIS — com `replace`, uma vez que a digitação assenta (`espera`),
 * e não por letra. Uma entrada de histórico por letra transformaria o VOLTAR
 * em "desfazer tecla"; e o Safari recusa mais de 100 `replaceState` em 30 s.
 *
 * O PENDENTE NÃO SE PERDE AO SAIR DA CAIXA. `gravarJa` grava na hora — a tela
 * o chama quando o foco sai da caixa, que é o que acontece no `mousedown` de
 * um link, ANTES do clique navegar. Assim abrir uma tarefa logo depois de
 * digitar e voltar encontra a busca.
 *
 * ⚠️ QUEM GRAVA OUTRO PARÂMETRO NA MESMA TELA PRECISA LEVAR O TEXTO JUNTO.
 * O `setSearchParams` do React Router parte dos parâmetros do ÚLTIMO DESENHO:
 * duas gravações no mesmo gesto (a da busca, ao sair da caixa, e a da aba, no
 * clique) fariam a segunda apagar a primeira. `comOTexto` devolve as mudanças
 * com o texto incluído e cancela o pendente — uma gravação só, com tudo.
 *
 * O ENDEREÇO QUE MUDA POR FORA MANDA — VOLTAR, um link colado, `Limpar`
 * vindo de outra peça. O hook sabe o que ELE gravou por último; valor
 * diferente disso chegou de fora, e vira o texto da caixa.
 */
export function useTextoNoEndereco(
  chave: string,
  { espera = 300, teto = Infinity }: { espera?: number; teto?: number } = {},
): {
  texto: string;
  definir: (texto: string) => void;
  gravarJa: () => void;
  comOTexto: (mudancas: Record<string, string>) => Record<string, string>;
} {
  const [parametros, definirParametros] = useParametrosNoEndereco();
  const doEndereco = (parametros.get(chave) ?? '').slice(0, teto);
  const [texto, setTexto] = useState(doEndereco);

  /** O que o endereço tem (ou vai ter) por gravação DESTE hook. */
  const gravado = useRef(doEndereco);
  const pendente = useRef<string | null>(null);
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* A gravação atrasada usa o `definir` do desenho mais novo — o do desenho
     em que se digitou já pode ter os parâmetros de antes de uma troca de aba. */
  const definirAtual = useRef(definirParametros);
  useEffect(() => {
    definirAtual.current = definirParametros;
  }, [definirParametros]);

  const parar = () => {
    if (relogio.current !== null) clearTimeout(relogio.current);
    relogio.current = null;
  };

  const gravar = useCallback((valor: string) => {
    parar();
    pendente.current = null;
    const noEndereco = textoParaEndereco(valor);
    gravado.current = noEndereco;
    definirAtual.current({ [chave]: noEndereco }, { manterEstado: true });
  }, [chave]);

  // O endereço mudou por fora — ver o cabeçalho.
  useEffect(() => {
    if (doEndereco === gravado.current) return;
    parar();
    pendente.current = null;
    gravado.current = doEndereco;
    setTexto(doEndereco);
  }, [doEndereco]);

  // O relógio morre com a tela: gravar depois de sair escreveria no endereço
  // de OUTRA tela.
  useEffect(() => parar, []);

  const definir = useCallback(
    (novo: string) => {
      const valor = novo.slice(0, teto);
      setTexto(valor);
      // Apagar é gesto decidido (X, Esc, Limpar busca): vai na hora.
      if (valor === '') {
        if (gravado.current !== '' || pendente.current !== null) gravar('');
        return;
      }
      pendente.current = valor;
      parar();
      relogio.current = setTimeout(() => {
        if (pendente.current !== null) gravar(pendente.current);
      }, espera);
    },
    [espera, gravar, teto],
  );

  const gravarJa = useCallback(() => {
    if (pendente.current !== null) gravar(pendente.current);
  }, [gravar]);

  const comOTexto = useCallback(
    (mudancas: Record<string, string>) => {
      parar();
      const atual = pendente.current ?? texto;
      pendente.current = null;
      const noEndereco = textoParaEndereco(atual);
      gravado.current = noEndereco;
      return { ...mudancas, [chave]: noEndereco };
    },
    [chave, texto],
  );

  return { texto, definir, gravarJa, comOTexto };
}
