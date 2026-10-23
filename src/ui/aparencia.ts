/**
 * A aparência: o armazenamento, os dois carimbos e os dois ganchos.
 * Etapa F17.18.
 *
 * O QUE ESTE ARQUIVO FAZ, E O QUE ELE NÃO DECIDE
 *   Ele lê o armazenamento do navegador, carimba dois atributos no `<html>`
 *   (`data-tema` e `data-cor`) e avisa quem mais estiver na tela. Nada mais.
 *
 *   As REGRAS moram fora: o que é uma escolha de tema válida está em
 *   `@/ui/tema`; o que é uma preferência de barra válida está em
 *   `@/ui/preferencias`; e o que cada cor vale está em `@/ui/cores-do-tema.css`. As
 *   três são puras e têm teste. Aqui só há o efeito colateral.
 *
 * POR QUE UM ATRIBUTO NO `<html>`, E NÃO UM CONTEXTO DE REACT
 *   Porque o CSS resolve o resto. Nenhum componente precisa saber que existe
 *   tema ou cor — foi assim que a F10d coube sem tocar em tela nenhuma, e é
 *   assim que a cor cabe agora sem tocar em nenhuma das trinta.
 *
 *   Um contexto obrigaria cada componente a ler a cor para escolher a dele, que
 *   é exatamente o que a decisão D10 proíbe.
 *
 * ⚠️ AS DUAS TELAS QUE MEXEM NO TEMA PRECISAM CONCORDAR
 *   Existe o botão flutuante (F10d) e agora a aba `Temas` do painel
 *   `Personalizar`. Se cada um guardasse o seu estado, mudar o tema num deles
 *   deixaria o outro mostrando o valor velho até a próxima recarga.
 *
 *   A sincronia é um evento de janela: quem grava avisa, quem está montado
 *   relê. É o mesmo mecanismo do ouvinte de `matchMedia` que a F10d já usa, e
 *   evita um contexto só para isto.
 *
 * `localStorage` PODE ESTAR BLOQUEADO
 *   Navegação privada, política do navegador, e — no `renderToStaticMarkup` da
 *   suíte — `window` nem existe. Toda leitura e toda escrita passam por
 *   `try/catch`: sem armazenamento, a escolha vale só nesta aba. Melhor que não
 *   funcionar.
 *
 * OS GANCHOS SE CHAMAM `use…`, EM INGLÊS, E O RESTO NÃO
 *   Não é inconsistência: `react-hooks/rules-of-hooks` reconhece gancho pelo
 *   PREFIXO do nome. `usarTema` passaria a ser uma função comum aos olhos do
 *   analisador, e as regras que impedem gancho dentro de condicional deixariam
 *   de valer aqui — justamente onde elas mais custam caro.
 */

import { useCallback, useEffect, useState } from 'react';

import { type ChaveDeCor, atributoDaCor } from '@/ui/cores';
import {
  CHAVE as CHAVE_DO_LUGAR,
  type Lugar,
  escreverLugar,
  lerLugar,
} from '@/ui/lugar';
import {
  CHAVE,
  type Preferencias,
  escreverPreferencias,
  lerPreferencias,
} from '@/ui/preferencias';
import {
  type Escolha,
  CHAVE as CHAVE_DO_TEMA,
  escolhaGuardada,
  temaDoSistema,
  temaEfetivo,
} from '@/ui/tema';

/** O aviso de "alguém mexeu na aparência". Ver o cabeçalho. */
export const EVENTO = 'ideworks:aparencia';

/**
 * O aviso de "alguém mexeu no LUGAR" — F17.24.
 *
 * Evento próprio, e não o de aparência, porque as duas coisas têm ritmo
 * diferente: a aparência muda quando alguém abre o painel, o lugar muda a cada
 * seta de pasta que se clica. Um evento só faria cada gesto na árvore reler as
 * preferências inteiras do sistema.
 */
export const EVENTO_DO_LUGAR = 'ideworks:lugar';

const lerGuardado = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};

const gravarGuardado = (k: string, v: string | null) => {
  try {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    // Sem armazenamento a escolha vale só nesta aba.
  }
};

const avisar = (evento: string = EVENTO) => {
  try {
    window.dispatchEvent(new Event(evento));
  } catch {
    // Sem janela (a suíte roda em `node`), não há a quem avisar.
  }
};

/* ───────────────────────────── carimbar ───────────────────────────── */

export function aplicarTema(escolha: Escolha) {
  try {
    document.documentElement.dataset.tema = temaEfetivo(escolha, temaDoSistema());
  } catch {
    // Sem documento não há o que carimbar.
  }
}

/**
 * A cor.
 *
 * O PADRÃO APAGA O ATRIBUTO em vez de escrever `ide`. Sem atributo, nenhuma
 * regra de `cores-do-tema.css` casa e o sistema fica byte a byte como era antes desta
 * etapa — inclusive o degradê do botão sólido, que só ganha substituto quando
 * há cor escolhida.
 */
export function aplicarCor(cor: ChaveDeCor) {
  try {
    const valor = atributoDaCor(cor);
    if (valor === null) delete document.documentElement.dataset.cor;
    else document.documentElement.dataset.cor = valor;
  } catch {
    // idem
  }
}

/* ───────────────────────────── os dois ganchos ───────────────────────────── */

/** A escolha de tema, compartilhada entre o botão flutuante e o painel. */
export function useTema(): [Escolha, (e: Escolha) => void] {
  const [escolha, setEscolha] = useState<Escolha>(() => escolhaGuardada(lerGuardado));

  useEffect(() => {
    const reler = () => setEscolha(escolhaGuardada(lerGuardado));
    window.addEventListener(EVENTO, reler);
    return () => window.removeEventListener(EVENTO, reler);
  }, []);

  const definir = useCallback((nova: Escolha) => {
    // `sistema` é a AUSÊNCIA de escolha, e por isso ele APAGA a chave. Gravar
    // "sistema" como valor congelaria um momento e quebraria o modo sistema —
    // é o que `src/ui/tema.ts` já argumenta desde a F10d.
    gravarGuardado(CHAVE_DO_TEMA, nova === 'sistema' ? null : nova);
    setEscolha(nova);
    aplicarTema(nova);
    avisar();
  }, []);

  return [escolha, definir];
}

/** As preferências da barra, compartilhadas entre a barra e o painel. */
export function usePreferencias(): [Preferencias, (p: Preferencias) => void] {
  const [prefs, setPrefs] = useState<Preferencias>(() => lerPreferencias(lerGuardado(CHAVE)));

  useEffect(() => {
    const reler = () => setPrefs(lerPreferencias(lerGuardado(CHAVE)));
    window.addEventListener(EVENTO, reler);
    return () => window.removeEventListener(EVENTO, reler);
  }, []);

  const definir = useCallback((nova: Preferencias) => {
    gravarGuardado(CHAVE, escreverPreferencias(nova));
    setPrefs(nova);
    aplicarCor(nova.cor);
    avisar();
  }, []);

  return [prefs, definir];
}

/**
 * ONDE A PESSOA ESTAVA — F17.24. Ver `@/ui/lugar` para o que mora aqui e por quê.
 *
 * ⚠️ O ATUALIZADOR RELÊ DO ARMAZENAMENTO ANTES DE ESCREVER, e isso não é
 * capricho. Há CINCO consumidores deste gancho ao mesmo tempo na tela — a
 * árvore, o quadro e um por grupo de `Minhas tarefas` —, cada um mexendo num
 * campo diferente do MESMO objeto. Se cada um escrevesse a partir do próprio
 * retrato, recolher um grupo apagaria a pasta que a árvore acabou de recolher.
 *
 * O evento devolve a versão nova para todos, então os cinco continuam
 * concordando sem contexto de React e sem uma única propriedade nova.
 */
export function useLugar(): [Lugar, (mudar: (atual: Lugar) => Lugar) => void] {
  const [lugar, setLugar] = useState<Lugar>(() => lerLugar(lerGuardado(CHAVE_DO_LUGAR)));

  useEffect(() => {
    const reler = () => setLugar(lerLugar(lerGuardado(CHAVE_DO_LUGAR)));
    window.addEventListener(EVENTO_DO_LUGAR, reler);
    return () => window.removeEventListener(EVENTO_DO_LUGAR, reler);
  }, []);

  const definir = useCallback((mudar: (atual: Lugar) => Lugar) => {
    const atual = lerLugar(lerGuardado(CHAVE_DO_LUGAR));
    const nova = mudar(atual);
    // Devolver o MESMO objeto é como quem chama diz "não mudou nada". Sem esta
    // saída, o efeito que guarda a lista aberta gravaria e avisaria a tela
    // inteira a cada montagem do quadro, sem uma única diferença.
    if (nova === atual) return;
    gravarGuardado(CHAVE_DO_LUGAR, escreverLugar(nova));
    setLugar(nova);
    avisar(EVENTO_DO_LUGAR);
  }, []);

  return [lugar, definir];
}
