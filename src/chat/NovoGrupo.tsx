/**
 * Caixa "Novo grupo" — F20.6.
 *
 * Espelha o molde de `CaixaDeClientes` / `CaixaDeAcesso`: Balao, busca por
 * nome no diretório do chat, escolha múltipla.
 *
 * F33 — flutua ancorado no botão, pelo mesmo motivo de `NovaDireta`: preso,
 * ele era recortado pela `.ch-lista`.
 */

import { useMemo, useState } from 'react';

import { Balao, IconePessoa, ItemDeMenu } from '@/board/menus';

export type PessoaDoDiretorio = { id: string; name: string };

export function NovoGrupo({
  pessoas,
  euId,
  salvando,
  aoFechar,
  aoCriar,
  ancora,
}: {
  pessoas: readonly PessoaDoDiretorio[];
  euId: string | null;
  salvando: boolean;
  /** O botão que abriu (F33). Ausente nos testes: sem âncora o balão desenha no lugar. */
  ancora?: HTMLElement | null;
  aoFechar: () => void;
  aoCriar: (nome: string, memberIds: string[]) => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [busca, setBusca] = useState('');
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const [erro, setErro] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pessoas
      .filter((p) => p.id !== euId)
      .filter((p) => (q === '' ? true : p.name.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [pessoas, euId, busca]);

  const alternar = (id: string) => {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  };

  const criar = () => {
    const n = nome.trim();
    if (n === '') {
      setErro('Dê um nome ao grupo.');
      return;
    }
    setErro(null);
    void aoCriar(n, [...marcados]).catch((e: unknown) => {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar o grupo.');
    });
  };

  return (
    /* UM TÍTULO SÓ — F33: o `rotulo` já é o título; o `cu-balao-titulo` que
       ficava aqui o repetia. */
    <Balao lado="baixo" aoFechar={aoFechar} rotulo="Novo grupo" ancora={ancora}>
      <label className="ch-campo">
        <span>Nome</span>
        <input
          data-foco="1"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Squad de vídeo"
          aria-label="Nome do grupo"
          disabled={salvando}
        />
      </label>
      <input
        className="cu-busca"
        value={busca}
        placeholder="Busque por nome…"
        aria-label="Buscar pessoa"
        onChange={(e) => setBusca(e.target.value)}
        disabled={salvando}
      />
      <div className="cu-rolagem">
        {candidatos.length === 0 && (
          <p className="cu-vazio">
            {pessoas.length <= 1
              ? 'Nenhuma outra pessoa no diretório.'
              : 'Ninguém com esse nome.'}
          </p>
        )}
        {candidatos.map((p) => (
          <ItemDeMenu
            key={p.id}
            marcado={marcados.has(p.id)}
            desativado={salvando}
            aoEscolher={() => alternar(p.id)}
          >
            <IconePessoa c="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="rotulo">{p.name}</span>
          </ItemDeMenu>
        ))}
      </div>
      {erro && <p className="ch-caixa-erro" role="alert">{erro}</p>}
      <span className="cu-rodape">
        <button type="button" className="o-btn o-btn-fantasma" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </button>
        <button
          type="button"
          className="o-btn o-btn-primario"
          disabled={salvando || nome.trim() === ''}
          onClick={criar}
        >
          Criar grupo
        </button>
      </span>
    </Balao>
  );
}
