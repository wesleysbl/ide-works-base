/**
 * O aplicador global de tema e cor — etapa F17.18.
 *
 * ELE NÃO DESENHA NADA. É o efeito colateral com um lugar para morar: carimba
 * `data-tema` e `data-cor` no `<html>` e mantém o modo "sistema" vivo ao
 * anoitecer.
 *
 * Vive em `App.tsx`, FORA das rotas: o tema e a cor valem para o sistema
 * inteiro, e uma tela que não os aplicasse seria a única página verde num
 * sistema roxo.
 *
 * O armazenamento, os carimbos e os dois ganchos moram em `@/ui/aparencia` —
 * arquivo sem componente, para o recarregamento rápido do Vite não perder o
 * estado a cada edição. Aqui só há o componente.
 */

import { useEffect } from 'react';

import { aplicarCor, aplicarTema, usePreferencias, useTema } from '@/ui/aparencia';

export function AplicarAparencia() {
  const [escolha] = useTema();
  const [prefs] = usePreferencias();

  useEffect(() => {
    aplicarTema(escolha);
  }, [escolha]);

  useEffect(() => {
    aplicarCor(prefs.cor);
  }, [prefs.cor]);

  // Só em "sistema" o ouvinte importa: nas outras a escolha manda, e reagir ao
  // aparelho desfaria o que a pessoa pediu.
  useEffect(() => {
    if (escolha !== 'sistema' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const aoMudar = () => aplicarTema('sistema');
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, [escolha]);

  return null;
}
