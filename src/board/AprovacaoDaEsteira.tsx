/**
 * "APROVAÇÃO DO CLIENTE" NA ESTEIRA — F42, Fase 3.
 *
 * ONDE MORA
 *   No menu `···` da lista, logo abaixo de "Esteira…" e "Automações…": é ali que
 *   a esteira se configura hoje, e a pessoa volta ali para refazer. A esteira é
 *   a RESOLVIDA da lista (própria, da pasta ou do espaço) — o aviso de herança
 *   diz quantas listas a configuração alcança.
 *
 * O QUE A CAIXA MOSTRA
 *   1. O CAMINHO DO CARD, desenhado: enviado → aguardando cliente → aprovado /
 *      reprovado, com o nome da etapa escolhida em cada passo (ou "falta
 *      escolher", em amarelo).
 *   2. Três seletores, só com etapas DESTA esteira. O banco recusa etapa de
 *      outra esteira do mesmo jeito (IW042); a frase dele chega inteira.
 *   3. A situação: completa, ou incompleta com o que falta.
 *
 * SÓ ADMIN: a rota responde 403 a quem não administra, e a frase aparece aqui.
 *
 * TESTES: `PainelDosDestinos` desenha no servidor; salvar e recarregar é o e2e
 * `aprovacao-configuracao`.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  DESTINOS,
  DESTINOS_VAZIOS,
  avisoDeHeranca,
  destinosRepetidos,
  fraseDaSituacao,
  mesmosDestinos,
  nomeDaEtapa,
  situacaoDosDestinos,
} from '@/board/aprovacao-da-esteira';
import { Balao } from '@/board/menus';
import { ApiError, api, semSessao } from '@/lib/api';
import type { Destinos, DestinosDaEsteira } from '@/server/aprovacao-config';

import '@/ui/aprovacao.css';

/** Um passo do desenho: o papel e a etapa escolhida (ou o que falta). */
function Passo({ rotulo, etapa, tom }: { rotulo: string; etapa: string | null; tom?: 'ok' | 'err' }) {
  return (
    <div className="ap-passo" data-falta={etapa === null || undefined} data-tom={tom}>
      <span className="ap-passo-rotulo">{rotulo}</span>
      <span className="ap-passo-etapa">{etapa ?? 'falta escolher'}</span>
    </div>
  );
}

/** A tela, sem efeito: o que a pessoa escolheu chega em `escolha`. */
export function PainelDosDestinos({
  dados,
  escolha,
  salvando = false,
  falha = null,
  salvo = false,
  aoEscolher,
  aoSalvar,
}: {
  dados: DestinosDaEsteira;
  escolha: Destinos;
  salvando?: boolean;
  falha?: string | null;
  salvo?: boolean;
  aoEscolher: (d: Destinos) => void;
  aoSalvar: () => void;
}) {
  const situacao = situacaoDosDestinos(escolha);
  const nome = (id: string | null) => nomeDaEtapa(dados.statuses, id);
  const repetidos = destinosRepetidos(escolha);
  const mudou = !mesmosDestinos(escolha, dados.targets);

  return (
    <div className="ap-esteira" data-aprovacao-esteira data-situacao={situacao.tipo}>
      <p className="ap-apoio">
        Esteira <b>{dados.statusSetName}</b>. {avisoDeHeranca(dados.inheritedFrom)}
      </p>
      <p className="ap-apoio">
        Ao solicitar a aprovação, o card vai para a etapa de &quot;aguardando cliente&quot;; a resposta do cliente o leva
        sozinho para a de aprovado ou a de reprovado.
      </p>

      {/* O CAMINHO DO CARD. Lido em ordem pelo leitor de tela; as setas são enfeite. */}
      <div className="ap-caminho" role="group" aria-label="Caminho do card na aprovação do cliente">
        <div className="ap-caminho-linha">
          <div className="ap-passo ap-passo-inicio">
            <span className="ap-passo-rotulo">Enviado</span>
            <span className="ap-passo-etapa">a equipe solicita</span>
          </div>
          <span className="ap-seta" aria-hidden="true">→</span>
          <Passo rotulo="Aguardando cliente" etapa={nome(escolha.awaitingStatusId)} />
        </div>
        <div className="ap-caminho-ramos">
          <span className="ap-seta ap-seta-ramo" aria-hidden="true">↳</span>
          <Passo rotulo="✓ Aprovado" etapa={nome(escolha.approvedStatusId)} tom="ok" />
          <span className="ap-seta ap-seta-ramo" aria-hidden="true">↳</span>
          <Passo rotulo="↺ Reprovado" etapa={nome(escolha.rejectedStatusId)} tom="err" />
        </div>
      </div>

      <div className="ap-seletores">
        {DESTINOS.map((d) => (
          <label key={d.chave} className="ap-seletor">
            <span className="ap-seletor-rotulo">{d.rotulo}</span>
            <select
              className="cu-mini-select"
              aria-label={`Etapa de ${d.rotulo}`}
              title={d.explica}
              value={escolha[d.chave] ?? ''}
              disabled={salvando}
              onChange={(e) => aoEscolher({ ...escolha, [d.chave]: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">— escolher etapa —</option>
              {dados.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <p className="ap-situacao" data-situacao={situacao.tipo} role="status">
        {fraseDaSituacao(situacao)}
      </p>
      {repetidos && (
        <p className="ap-falha" role="alert">
          &quot;Aguardando cliente&quot; precisa ser uma etapa diferente de &quot;Aprovado&quot; e de &quot;Reprovado&quot;.
        </p>
      )}
      {falha && (
        <p className="ap-falha" role="alert">
          {falha}
        </p>
      )}

      <div className="ap-botoes">
        <button
          type="button"
          className="o-btn o-btn-primario o-btn-sm"
          disabled={salvando || repetidos || !mudou}
          onClick={aoSalvar}
        >
          {salvando ? 'salvando…' : 'Salvar destinos'}
        </button>
        {salvo && !mudou && <span className="ap-ok">Salvo.</span>}
      </div>
    </div>
  );
}

/** O balão, com estado: lê ao abrir, grava ao salvar. */
export function CaixaDaAprovacao({
  listId,
  aoFechar,
  lado = 'baixo-direita',
}: {
  listId: string;
  aoFechar: () => void;
  /** No menu `···` da árvore abre para a esquerda; no card (F42, Fase 4), para a direita. */
  lado?: 'baixo' | 'baixo-direita';
}) {
  const [dados, setDados] = useState<DestinosDaEsteira | null>(null);
  const [escolha, setEscolha] = useState<Destinos>(DESTINOS_VAZIOS);
  const [erroDeLeitura, setErroDeLeitura] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  const ler = useCallback(async () => {
    setErroDeLeitura(null);
    try {
      const r = await api.destinosDaAprovacao(listId);
      setDados(r.approval);
      setEscolha(r.approval.targets);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setErroDeLeitura(e instanceof ApiError && e.message ? e.message : 'Não foi possível ler a esteira.');
    }
  }, [listId]);

  useEffect(() => {
    void ler();
  }, [ler]);

  const salvar = async () => {
    setSalvando(true);
    setFalha(null);
    setSalvo(false);
    try {
      const r = await api.gravarDestinosDaAprovacao(listId, escolha);
      setDados(r.approval);
      setEscolha(r.approval.targets);
      setSalvo(true);
    } catch (e) {
      if (semSessao(e)) {
        window.location.replace('/');
        return;
      }
      setFalha(e instanceof ApiError && e.message ? e.message : 'Não foi possível salvar os destinos.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Balao lado={lado} papel="dialog" aoFechar={aoFechar} rotulo="Aprovação do cliente">
      {dados === null && erroDeLeitura === null && <p className="cu-vazio">Lendo a esteira…</p>}
      {erroDeLeitura !== null && (
        <p role="alert" className="cu-vazio">
          {erroDeLeitura}{' '}
          <button type="button" onClick={() => void ler()}>
            Tentar novamente
          </button>
        </p>
      )}
      {dados !== null && (
        <PainelDosDestinos
          dados={dados}
          escolha={escolha}
          salvando={salvando}
          falha={falha}
          salvo={salvo}
          aoEscolher={(d) => {
            setSalvo(false);
            setEscolha(d);
          }}
          aoSalvar={() => void salvar()}
        />
      )}
    </Balao>
  );
}
