/**
 * Painel do grupo (e leitura de membros do Geral) — F20.6.
 *
 * Geral: só lista membros, sem ações.
 * Grupo: dono ou administrador (isSuperadmin) adiciona/remove, renomeia,
 * passa a posse; qualquer membro pode sair.
 */

import { useMemo, useState } from 'react';

import { Ajuda } from '@/board/menus';
import type { ChatMember } from '@/server/chat';
import { podeGerenciarGrupo } from '@/chat/nao-lidas';

export type MembroNaTela = ChatMember;

export function PainelDoGrupo({
  kind,
  nome,
  members,
  myRole,
  euId,
  isSuperadmin,
  diretorio,
  salvando,
  sobreposto = false,
  aoFechar,
  aoRenomear,
  aoAdicionar,
  aoRemover,
  aoSair,
  aoPassarPosse,
}: {
  kind: 'general' | 'group' | 'direct';
  nome: string;
  members: readonly MembroNaTela[];
  myRole: 'owner' | 'member' | null;
  euId: string | null;
  isSuperadmin: boolean;
  diretorio: readonly { id: string; name: string }[];
  salvando: boolean;
  /**
   * F08: sem folga para a terceira faixa, o painel cobre a leitura (e não a
   * espreme). A tela decide; aqui só muda o papel e o desenho.
   */
  sobreposto?: boolean;
  aoFechar: () => void;
  aoRenomear: (nome: string) => Promise<void>;
  aoAdicionar: (userId: string) => Promise<void>;
  aoRemover: (userId: string) => Promise<void>;
  aoSair: () => Promise<void>;
  aoPassarPosse: (userId: string) => Promise<void>;
}) {
  const gerencia = podeGerenciarGrupo(kind, myRole, isSuperadmin);
  const [rascunhoNome, setRascunhoNome] = useState(nome);
  const [buscaAdd, setBuscaAdd] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const idsMembros = useMemo(() => new Set(members.map((m) => m.id)), [members]);

  const forasteiros = useMemo(() => {
    const q = buscaAdd.trim().toLowerCase();
    return diretorio
      .filter((p) => !idsMembros.has(p.id))
      .filter((p) => (q === '' ? true : p.name.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [diretorio, idsMembros, buscaAdd]);

  const agir = (fn: () => Promise<void>) => {
    setErro(null);
    void fn().catch((e: unknown) => {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir.');
    });
  };

  return (
    /* `id` e `tabIndex={-1}`: a tela leva o foco para cá quando o painel abre
       por cima da leitura, e o botão Membros aponta para ele (`aria-controls`). */
    <aside
      className="ch-painel-grupo"
      id="ch-membros"
      tabIndex={-1}
      aria-label="Membros da conversa"
      data-sobreposto={sobreposto ? 'true' : undefined}
    >
      <header className="ch-painel-grupo-cabeca">
        <span className="ch-painel-grupo-nome">
          {/* F43 Fase 10 — "O Geral é de toda a equipe…" era uma frase fixa no
              pé do painel, explicando por que ali não há ação. Ela foi para o
              "?" ao lado do título: quem estranha a falta de "Sair" e
              "Renomear" pergunta ali, e a frase está inteira. */}
          {kind === 'general' ? (
            <span className="flex items-center gap-1.5">
              <strong>Membros</strong>
              <Ajuda sobre="o grupo Geral" lado="baixo-direita">
                O Geral é de toda a equipe. Não se renomeia, não se sai e ninguém gerencia a lista.
              </Ajuda>
            </span>
          ) : (
            <strong>Membros</strong>
          )}
          <span className="ch-painel-grupo-de" title={nome}>{nome}</span>
        </span>
        <button type="button" className="o-btn o-btn-fantasma" onClick={aoFechar}>
          Fechar
        </button>
      </header>

      {kind === 'group' && gerencia && (
        <div className="ch-painel-grupo-bloco">
          <label className="ch-campo">
            <span>Nome do grupo</span>
            <input
              value={rascunhoNome}
              onChange={(e) => setRascunhoNome(e.target.value)}
              disabled={salvando}
              aria-label="Renomear grupo"
            />
          </label>
          <button
            type="button"
            className="o-btn o-btn-fantasma"
            disabled={salvando || rascunhoNome.trim() === '' || rascunhoNome.trim() === nome}
            onClick={() => agir(() => aoRenomear(rascunhoNome.trim()))}
          >
            Renomear
          </button>
        </div>
      )}

      <div className="ch-painel-grupo-bloco">
        <div className="ch-painel-grupo-titulo">
          {members.length === 1 ? '1 pessoa' : `${members.length} pessoas`}
        </div>
        <ul className="ch-membros">
          {members.map((m) => {
            const souEu = euId != null && m.id === euId;
            const rotuloPapel =
              m.role === 'owner' ? 'dono' : m.role === 'member' ? 'membro' : null;
            return (
              <li key={m.id} className="ch-membro">
                <span className="ch-membro-nome">
                  {m.name}
                  {souEu ? ' (você)' : ''}
                  {!m.isActive ? ' — desativada' : ''}
                </span>
                {rotuloPapel && <span className="ch-membro-papel">{rotuloPapel}</span>}
                {kind === 'group' && gerencia && !souEu && (
                  <span className="ch-membro-acoes">
                    {m.role !== 'owner' && (
                      <button
                        type="button"
                        className="o-btn o-btn-fantasma"
                        disabled={salvando}
                        onClick={() => agir(() => aoPassarPosse(m.id))}
                      >
                        Passar posse
                      </button>
                    )}
                    <button
                      type="button"
                      className="o-btn o-btn-fantasma"
                      disabled={salvando}
                      onClick={() => agir(() => aoRemover(m.id))}
                    >
                      Remover
                    </button>
                  </span>
                )}
              </li>
            );
          })}
          {members.length === 0 && <li className="ch-vazio">Nenhum membro listado.</li>}
        </ul>
      </div>

      {kind === 'group' && gerencia && (
        <div className="ch-painel-grupo-bloco">
          <div className="ch-painel-grupo-titulo">Adicionar</div>
          <input
            className="cu-busca"
            value={buscaAdd}
            placeholder="Busque por nome…"
            aria-label="Buscar pessoa para adicionar"
            onChange={(e) => setBuscaAdd(e.target.value)}
            disabled={salvando}
          />
          <ul className="ch-membros">
            {forasteiros.slice(0, 12).map((p) => (
              <li key={p.id} className="ch-membro">
                <span className="ch-membro-nome">{p.name}</span>
                <button
                  type="button"
                  className="o-btn o-btn-fantasma"
                  disabled={salvando}
                  onClick={() => agir(() => aoAdicionar(p.id))}
                >
                  Adicionar
                </button>
              </li>
            ))}
            {forasteiros.length === 0 && (
              <li className="ch-vazio">Ninguém para adicionar.</li>
            )}
          </ul>
        </div>
      )}

      {kind === 'group' && myRole != null && (
        <div className="ch-painel-grupo-bloco">
          <button
            type="button"
            className="o-btn o-btn-fantasma"
            disabled={salvando}
            onClick={() => {
              if (!window.confirm('Sair deste grupo?')) return;
              agir(() => aoSair());
            }}
          >
            Sair do grupo
          </button>
        </div>
      )}

      {erro && <p className="ch-caixa-erro" role="alert">{erro}</p>}
    </aside>
  );
}
