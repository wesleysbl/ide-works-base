import { CampoComMencoes } from '@/board/CamposDeMencao';
/**
 * O que se cria direto na coluna do quadro — F17.10, mantido na F17.10b.
 *
 * O QUE SAIU DAQUI, E PARA ONDE
 *   Este arquivo tinha o editor de markdown, os seletores de pessoa, etiqueta,
 *   prioridade e dia — todos desenhados como CAMPO DE FORMULÁRIO. O usuário
 *   comparou com o ClickUp e reprovou a forma, não a função.
 *
 *   Na F17.10b eles foram refeitos na gramática da origem e mudaram de casa:
 *     · os menus flutuantes ancorados no chip  → `src/board/menus.tsx`
 *     · o editor rico (markdown vira formato)  → `src/board/EditorRico.tsx`
 *     · o modal inteiro de tarefa nova         → `src/board/ModalDeTarefa.tsx`
 *
 *   Sobrou o que já ERA o ClickUp: o `+ Adicionar tarefa` do pé da coluna.
 */

import { useState } from 'react';

import { ChipDoClienteNaCriacao } from '@/board/ClienteDaTarefa';
import { type ListaDoCliente, faltaCliente, tipoDaLista } from '@/board/cliente-no-cartao';
import { SeletorDoTipo } from '@/board/SeletorDoTipo';
import { type ListaDoTipo, type TipoDaTarefa, ehListaDeProducao, faltaTipo } from '@/board/tipo-no-cartao';

/**
 * `+ Adicionar tarefa` — o jeito do ClickUp, e ele é curto de propósito.
 *
 * SÓ O TÍTULO, E ENTER CRIA. Quem está despejando o que combinou numa reunião
 * não para para escolher prioridade; qualquer campo a mais aqui faz a pessoa
 * parar de despejar. O resto se põe depois, na ficha — ou de uma vez, no modal,
 * que é o outro botão.
 *
 * O STATUS VEM DA COLUNA em que se clicou: o cartão nasce onde a pessoa apontou.
 * Sem isso ele apareceria sempre na primeira coluna e a pessoa teria que
 * arrastá-lo — um gesto a mais para desfazer o que a tela decidiu por ela.
 *
 * O CLIENTE, SÓ NA LISTA COMPARTILHADA — F38, Fase 7.
 *   Na lista compartilhada (ATENDIMENTO e afins) toda tarefa precisa de
 *   cliente, e a criação sem ele é recusada. Duas saídas foram pesadas:
 *     · abrir o modal completo ao clicar em Criar — joga a pessoa noutra tela
 *       no meio do despejo, e o título tem de viajar junto;
 *     · um chip "Cliente" DENTRO da caixinha — um clique a mais, e só aqui.
 *   Ficou o chip: o gesto continua curto, o título não sai do lugar, e o
 *   cliente escolhido FICA para a próxima tarefa (quem despeja a reunião de
 *   um cliente despeja várias do mesmo). Enter sem cliente não vai ao
 *   servidor: a frase aparece na caixa e o título fica.
 *   Em lista de cliente (herda) e em lista interna (pode ficar sem cliente) a
 *   caixa continua como era: só o título.
 */
export function AdicionarNaColuna({
  statusId,
  aoCriar,
  lista,
}: {
  statusId: string;
  aoCriar: (
    titulo: string,
    statusId: string,
    clientId?: string | null,
    type?: TipoDaTarefa | null,
  ) => Promise<boolean>;
  /** A lista do quadro — F38, Fase 7 (cliente) e F40, Fase 4 (tipo). Ausente = como antes. */
  lista?: ListaDoCliente & ListaDoTipo & { listId: string };
}) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [cliente, setCliente] = useState<{ id: string | null; nome: string | null }>({ id: null, nome: null });
  const [menuDoCliente, setMenuDoCliente] = useState(false);
  const [falta, setFalta] = useState<string | null>(null);
  /* F40, Fase 4: o tipo escolhido FICA para a próxima, como o cliente. */
  const [tipo, setTipo] = useState<TipoDaTarefa | null>(null);

  const producao = ehListaDeProducao(lista);
  const semTipo = faltaTipo(lista, tipo);
  const compartilhada = lista !== undefined && tipoDaLista(lista) === 'compartilhada';

  const enviar = async () => {
    if (titulo.trim() === '' || salvando || semTipo !== null) return;
    const faltando = lista ? faltaCliente(lista, cliente.id) : null;
    if (faltando) {
      setFalta(faltando);
      return;
    }
    setSalvando(true);
    const deu = await aoCriar(titulo.trim(), statusId, compartilhada ? cliente.id : undefined, tipo);
    setSalvando(false);
    if (deu) {
      // Fica ABERTO depois de criar: quem acabou de despejar uma tarefa
      // normalmente tem a próxima na ponta da língua.
      setTitulo('');
    }
  };

  if (!aberto) {
    return (
      <button type="button" className="t-adicionar" onClick={() => setAberto(true)}>
        + Adicionar tarefa
      </button>
    );
  }

  return (
    <div className="t-caixa-nova">
      <CampoComMencoes
        value={titulo}
        rows={2}
        autoFocus
        disabled={salvando}
        placeholder="Título da tarefa — Enter cria, Esc fecha"
        aria-label="Título da tarefa nova"
        aoMudar={setTitulo}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void enviar();
          }
          if (e.key === 'Escape') {
            setAberto(false);
            setTitulo('');
          }
        }}
      />
      {compartilhada && lista && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-cliente-rapido="1">
          <ChipDoClienteNaCriacao
            listId={lista.listId}
            lista={lista}
            valor={cliente.id}
            valorNome={cliente.nome}
            aoMudar={(id, nome) => {
              setCliente({ id, nome });
              if (id !== null) setFalta(null);
            }}
            aberto={menuDoCliente}
            aoAlternar={() => setMenuDoCliente((a) => !a)}
            faltando={falta !== null}
            desativado={salvando}
            lado="baixo"
            flutuante
          />
        </div>
      )}
      {lista && (
        <div className="mt-1.5" data-tipo-rapido="1">
          <SeletorDoTipo
            valor={tipo}
            aoMudar={setTipo}
            obrigatorio={producao}
            podeLimpar={!producao}
            faltando={semTipo !== null && titulo.trim() !== ''}
            desativado={salvando}
          />
          {semTipo !== null && (
            <p className="mt-1 text-xs" role="status" data-falta-tipo="1" style={{ color: 'var(--err)' }}>
              {semTipo}
            </p>
          )}
        </div>
      )}
      {falta && (
        <p className="mt-1 text-xs" role="alert" style={{ color: 'var(--err)' }}>
          {falta}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          type="button"
          className="o-btn o-btn-primario o-btn-sm"
          disabled={salvando || titulo.trim() === '' || semTipo !== null}
          title={semTipo ?? undefined}
          onClick={() => void enviar()}
        >
          {salvando ? 'criando…' : 'Criar'}
        </button>
        <button
          type="button"
          className="o-btn o-btn-fantasma o-btn-sm"
          onClick={() => {
            setAberto(false);
            setTitulo('');
          }}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
