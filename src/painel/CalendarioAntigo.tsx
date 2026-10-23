/**
 * `/calendario` CONTINUA FUNCIONANDO — F43, Fase 4.
 *
 * O Calendário virou a terceira visão do Planejamento, e o endereço antigo
 * está nos favoritos, na barra de quem guardou a preferência e colado em
 * comentário. Ele não vira 404: leva à visão Calendário, com o resto da
 * consulta junto (`enderecoDoCalendarioAntigo`). `replace`: o VOLTAR não cai
 * de novo no endereço que só redireciona — seria um laço.
 *
 * Mora fora de `src/pages` de propósito: não é tela (não tem barra nem topo),
 * e as provas de "toda tela tem barra e diz onde está" contam as telas de lá.
 */

import { Navigate, useLocation } from 'react-router-dom';

import { enderecoDoCalendarioAntigo } from '@/painel/visoes-do-planejamento';

export function CalendarioAntigo() {
  const { search, hash } = useLocation();
  return <Navigate to={`${enderecoDoCalendarioAntigo(search)}${hash}`} replace />;
}
