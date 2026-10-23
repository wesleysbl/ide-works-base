/**
 * Caixa "Nova conversa" (direta) — F20.6.
 *
 * Escolhe uma pessoa do diretório; a API devolve a conversa existente se já
 * houver (open_direct_conversation).
 *
 * F33 — O BALÃO FLUTUA, ANCORADO NO BOTÃO. Preso ao botão, ele morava dentro
 * de `.ch-lista` (`overflow: auto`) e era mais largo que a coluna: a coluna o
 * cortava na divisa com a conversa e ganhava rolagem lateral; no celular, com
 * a lista de 11rem, o corte era por baixo. Em portal (`ancora`) ele sai da
 * caixa que recorta e se ajusta à janela — o mesmo remédio do menu da conta.
 */

import { useMemo, useState } from 'react';

import { Balao, IconePessoa, ItemDeMenu } from '@/board/menus';

import type { PessoaDoDiretorio } from '@/chat/NovoGrupo';

export function NovaDireta({
  pessoas,
  euId,
  salvando,
  aoFechar,
  aoAbrir,
  ancora,
}: {
  pessoas: readonly PessoaDoDiretorio[];
  euId: string | null;
  salvando: boolean;
  /** O botão que abriu (F33). Ausente nos testes: sem âncora o balão desenha no lugar. */
  ancora?: HTMLElement | null;
  aoFechar: () => void;
  aoAbrir: (userId: string) => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return pessoas
      .filter((p) => p.id !== euId)
      .filter((p) => (q === '' ? true : p.name.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [pessoas, euId, busca]);

  const escolher = (id: string) => {
    setErro(null);
    void aoAbrir(id).catch((e: unknown) => {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a conversa.');
    });
  };

  return (
    /* UM TÍTULO SÓ — F33. O `rotulo` já desenha o título (com o `X` da
       F17.33); o `cu-balao-titulo` escrito à mão aqui embaixo repetia
       "Nova conversa" logo abaixo dele. */
    <Balao lado="baixo" aoFechar={aoFechar} rotulo="Nova conversa" ancora={ancora}>
      <input
        className="cu-busca"
        data-foco="1"
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
            desativado={salvando}
            aoEscolher={() => escolher(p.id)}
          >
            <IconePessoa c="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="rotulo">{p.name}</span>
          </ItemDeMenu>
        ))}
      </div>
      {erro && <p className="ch-caixa-erro" role="alert">{erro}</p>}
    </Balao>
  );
}
