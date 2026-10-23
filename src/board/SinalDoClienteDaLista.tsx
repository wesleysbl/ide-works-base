/**
 * DE QUE CLIENTE É ESTA LISTA, E O CAMINHO ATÉ A FICHA.
 *
 * Na barra lateral o sinal é só o ícone: a lista trazida nasce com o nome do
 * cliente, e escrevê-lo de novo numa coluna de 15rem gastaria a largura para
 * não dizer nada. Dentro da lista e na visão do espaço o nome precisa estar
 * escrito — a dívida da F17.43, em que só a barra sabia.
 *
 * Some quando não há nome. A condição é a mesma da linha da árvore:
 * `listaLevaAFicha` em `@/board/arvore`. Atalho para 404 é pior que atalho
 * nenhum, e o vínculo não alarga alcance.
 */

import { Link } from 'react-router-dom';

import { listaLevaAFicha } from '@/board/arvore';
import { IconeCliente } from '@/board/menus';

export function SinalDoClienteDaLista({
  clientId,
  clientName,
}: {
  clientId: string | null;
  clientName: string | null;
}) {
  if (!listaLevaAFicha({ clientId, clientName })) return null;

  return (
    <Link
      to={`/cliente/${clientId}`}
      className="cu-chip"
      data-cheio="true"
      data-cliente-da-lista={clientId}
      title={`Ficha de ${clientName}`}
      aria-label={`Abrir a ficha de ${clientName}`}
      style={{ textDecoration: 'none' }}
    >
      <IconeCliente c="h-3.5 w-3.5 shrink-0" />
      <span className="rotulo">{clientName}</span>
    </Link>
  );
}
