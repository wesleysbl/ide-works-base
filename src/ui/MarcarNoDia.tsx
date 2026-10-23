/**
 * MARCAR NO DIA — etapa F17.44.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O ACHADO DO USUÁRIO
 *   *"Qual a lógica do calendário de cada cliente e o geral sendo que eles não
 *   possuem botão de +? Onde são adicionadas essas entregas? Compromissos? Se
 *   não tiver esses calendários com capacidade de adicionar e realmente
 *   utilizar como agenda, acredito que fique confuso, bem confuso."*
 *
 *   Ele tem razão. A F17.40 entregou o calendário como VISOR: o conteúdo nasce
 *   em `Conteúdos` e no `Semanal`, e a grade só desenha. Tela que parece agenda
 *   e não deixa marcar nada não é agenda.
 *
 * ⚠️ DUAS COISAS, E A DIFERENÇA MANDA NA COTA
 *
 *     ENTREGA      é conteúdo — Arte, Vídeo, Foto, Ads — e **conta na cota**
 *     COMPROMISSO  reunião, gravação, viagem: ocupa o dia e **NÃO conta**
 *
 *   Não é rótulo. Se compromisso entrasse na conta, o medidor de entrega do
 *   cliente passaria a mentir, e o nível de entrega calculado a partir dele iria
 *   junto. As duas coisas moram em tabelas diferentes justamente para que essa
 *   separação seja aritmética — ver `src/server/appointments.ts`.
 *
 *   Na tela isso aparece de um jeito só: a escolha é a PRIMEIRA pergunta da
 *   janela, e nada mais na janela é igual depois dela. Entrega pede tipo;
 *   compromisso pede hora. Uma janela que perguntasse tudo e escondesse metade
 *   faria as duas parecerem a mesma coisa com campos a mais.
 *
 * ⚠️ HORA SÓ EXISTE NO COMPROMISSO, E EM BRANCO ELA NÃO É `00:00`
 *   Conteúdo se agenda por DIA. A hora que o banco guarda nele é subproduto do
 *   fuso — meia-noite na migração do legado, nove da manhã no que a tela
 *   semanal grava — e o calendário mostrava `00:00` em 2.598 das 2.626
 *   entregas com data. Nesta etapa a entrega deixou de exibir hora, e a única
 *   hora do calendário passou a ser a que alguém digitou aqui.
 *
 *   Deixar a hora em branco é dizer "o dia inteiro", e é assim que ela é
 *   gravada: nula. Não há campo pré-preenchido com meia-noite.
 *
 * O DIA SAI DO SELETOR DA F17.42
 *   Mesma peça, mesma aritmética de dia civil, mesmo passado que custa o mesmo
 *   que o futuro. A diferença: aqui ele pode abrir JÁ MARCADO, e isso não
 *   contraria a F17.42 — lá o marcado seria palpite do sistema, aqui é o dia em
 *   que a pessoa acabou de clicar. Marcado por gesto é fato; marcado por padrão
 *   é adivinhação.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { CONTENT_TYPES, type ContentType } from '@/delivery/level';
import { ApiError, api } from '@/lib/api';
import { IconeDoTipoDeConteudo } from '@/ui/GradeDoMes';
import { SeletorDeDia } from '@/ui/SeletorDeDia';
import { Janela, BotaoDeFechar } from '@/ui/janela';
import {
  type EntradaDoMes,
  TIPO_ROTULO,
  corDoTipo,
  ehCompromisso,
  hojeNaAgencia,
  meioDiaDoDia,
  mesDoDia,
  perguntaAntesDeApagar,
} from '@/ui/grade-do-mes';
import { Area, Aviso, Campo, Chave, Selecao } from '@/ui/primitivos';

/** Um cliente para escolher, no calendário de todos. */
export type ClienteParaEscolher = { id: string; nome: string };

/**
 * O que a janela veio fazer.
 *
 * `novo` traz o dia clicado, ou `null` quando veio do `+` do cabeçalho — ali
 * ninguém apontou dia nenhum, e inventar um seria a suposição que a F17.42
 * removeu da grade semanal.
 */
export type AlvoDaMarcacao =
  | { modo: 'novo'; dia: string | null }
  | { modo: 'existente'; entrada: EntradaDoMes };

const diaLegivel = (dia: string) => dia.split('-').reverse().join('/');

export function MarcarNoDia({
  alvo,
  clienteFixo,
  clientes,
  aoFechar,
  aoMudar,
}: {
  alvo: AlvoDaMarcacao;
  /** A aba do cliente já sabe de quem é. `null` no calendário de todos. */
  clienteFixo: string | null;
  /** Só o calendário de todos precisa da lista; a aba manda `[]`. */
  clientes: ClienteParaEscolher[];
  aoFechar: () => void;
  aoMudar: () => Promise<unknown> | void;
}) {
  const existente = alvo.modo === 'existente' ? alvo.entrada : null;
  const compromisso = existente !== null && ehCompromisso(existente);

  const [natureza, setNatureza] = useState<'entrega' | 'compromisso'>(
    compromisso ? 'compromisso' : 'entrega',
  );
  const [cliente, setCliente] = useState(existente?.clientId ?? clienteFixo ?? '');
  const [dia, setDia] = useState<string | null>(
    alvo.modo === 'novo' ? alvo.dia : alvo.entrada.day,
  );
  const [tipo, setTipo] = useState<ContentType>(
    (existente && !compromisso ? (existente.contentType as ContentType) : 'arte') ?? 'arte',
  );
  const [titulo, setTitulo] = useState(existente?.title ?? '');
  const [hora, setHora] = useState(existente?.time ?? '');
  const [notas, setNotas] = useState(existente?.notes ?? '');
  const [concluido, setConcluido] = useState(existente?.isCompleted ?? false);

  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [escolhendoDia, setEscolhendoDia] = useState(false);
  const botaoDoDia = useRef<HTMLButtonElement>(null);

  /*
    O mês em que o seletor abre. Sem dia escolhido ele abre no mês de HOJE — que
    é onde ele já abriria sozinho —, e continua sem nada marcado.
  */
  const mesInicial = useMemo(
    () => (dia !== null ? (mesDoDia(dia) ?? '').slice(0, 7) : hojeNaAgencia().slice(0, 7)),
    [dia],
  );

  /*
    A janela fecha por `Esc`, por `X` e por clique fora — `Janela` traz os três
    (F17.33). Com o seletor de dia aberto por cima, `Esc` fecha só o seletor:
    `Balao` para a tecla antes de ela subir.

    E trocar de natureza limpa o erro: "Dê um nome ao compromisso" continuar na
    tela depois de a pessoa passar para Entrega seria a tela reclamando de um
    campo que ela já nem mostra.
  */
  useEffect(() => setErro(null), [natureza]);

  async function executar(acao: () => Promise<unknown>) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await acao();
      await aoMudar();
      aoFechar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível gravar.');
      setOcupado(false);
    }
  }

  function gravar() {
    if (dia === null) return setErro('Escolha o dia.');
    if (cliente === '') return setErro('Escolha de qual cliente é.');

    if (natureza === 'compromisso') {
      const dados = {
        clientId: cliente,
        day: dia,
        // ⚠️ Em branco vira `null`, e não `'00:00'`. Ver a nota do topo.
        time: hora.trim() === '' ? null : hora.trim(),
        title: titulo.trim(),
        notes: notas.trim() === '' ? null : notas.trim(),
      };
      return executar(() =>
        existente ? api.salvarCompromisso(existente.id, dados) : api.criarCompromisso(dados),
      );
    }

    const mes = mesDoDia(dia);
    if (mes === null) return setErro('Esse dia não existe no calendário.');

    if (existente) {
      /*
        Entrega já existente: o dia e o nome vão por rotas separadas, porque são
        coisas separadas no modelo — dia é `scheduled_at`, e mudá-lo é o mesmo
        gesto que a grade semanal faz. Só se chama o que mudou.
      */
      const mudouODia = dia !== existente.day;
      const mudouONome = titulo.trim() !== (existente.title ?? '');
      const mudouAConclusao = concluido !== existente.isCompleted;
      return executar(async () => {
        if (mudouODia) await api.agendar(existente.id, meioDiaDoDia(dia));
        if (mudouONome) await api.renomearItem(existente.id, titulo.trim() || null);
        if (mudouAConclusao) await api.alternarConclusao(existente.id, concluido);
      });
    }

    /*
      ⚠️ `isExtra` NÃO VAI. Quem sabe se a entrega nasce extra é o mês, e o
      servidor responde com a mesma regra da grade semanal — extra é o que passa
      da cota contratada daquele tipo. Uma segunda cópia da conta aqui ficaria
      para trás na primeira mudança.

      O mês de competência é o mês DO DIA escolhido, e não o mês que a tela está
      mostrando: marcar dia 2 de setembro estando em agosto é setembro. A grade
      semanal já trata o item agendado fora do mês de competência como caso
      real — ela o mostra na lista de "fora do mês" em vez de empurrá-lo para a
      semana mais próxima —, e criar um desses de propósito seria criar
      confusão de graça.
    */
    return executar(() =>
      api.criarItem(cliente, mes, tipo, undefined, meioDiaDoDia(dia), titulo.trim() || null),
    );
  }

  function apagar() {
    if (!existente) return;
    const pergunta = perguntaAntesDeApagar(existente);
    if (pergunta !== null && !window.confirm(pergunta)) return;
    return executar(() =>
      compromisso ? api.excluirCompromisso(existente.id) : api.excluirItem(existente.id),
    );
  }

  const tituloDaJanela = existente
    ? compromisso
      ? 'Compromisso'
      : 'Entrega'
    : 'Marcar no dia';

  return (
    <Janela rotulo={tituloDaJanela} aoFechar={aoFechar}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-plat">{tituloDaJanela}</h2>
        <BotaoDeFechar aoFechar={aoFechar} />
      </div>

      <div className="mt-4 space-y-3">
        {/* --- o que é: a primeira pergunta, e só ao criar ------------------ */}
        {!existente && (
          <div>
            <div className="eyebrow mb-1.5">O que é</div>
            <div className="flex gap-2">
              <Escolha
                marcada={natureza === 'entrega'}
                aoMarcar={() => setNatureza('entrega')}
                nome="Entrega"
                explicacao="Conta no mês contratado"
              />
              <Escolha
                marcada={natureza === 'compromisso'}
                aoMarcar={() => setNatureza('compromisso')}
                nome="Compromisso"
                explicacao="Ocupa o dia, sem entregar"
              />
            </div>
          </div>
        )}

        {/*
          --- de quem é ---------------------------------------------------

          ⚠️ NÃO APARECE AO CORRIGIR UMA ENTREGA. Mover conteúdo de cliente
          mudaria o mês contratado de dois clientes de uma vez, e não há rota
          para isso — um seletor que não faz nada é pior que seletor nenhum,
          porque ele promete. Compromisso, sim: marcar a reunião na agenda
          errada é o engano mais comum que existe, e `appointments_update` tem
          `with check` justamente para o destino continuar dentro do alcance.
        */}
        {clienteFixo === null && (!existente || compromisso) && (
          <Selecao
            rotulo="Cliente"
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            disabled={ocupado}
          >
            <option value="">Escolher…</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
        )}

        {/* --- o dia ------------------------------------------------------- */}
        <div>
          <div className="eyebrow mb-1.5">Dia</div>
          <button
            ref={botaoDoDia}
            type="button"
            className="o-btn o-btn-vidro"
            aria-haspopup="dialog"
            disabled={ocupado}
            onClick={() => setEscolhendoDia(true)}
          >
            {dia === null ? 'Escolher o dia' : diaLegivel(dia)}
          </button>
          {escolhendoDia && (
            <SeletorDeDia
              rotulo="Escolher o dia"
              mesInicial={mesInicial}
              /* Marcado por gesto, e não por padrão — ver a nota do topo. */
              valor={dia}
              ancora={botaoDoDia.current}
              aoEscolher={(d) => {
                setDia(d);
                setEscolhendoDia(false);
              }}
              aoFechar={() => setEscolhendoDia(false)}
            />
          )}
        </div>

        {/* --- o que muda conforme a natureza ------------------------------ */}
        {natureza === 'entrega' ? (
          <>
            {!existente && (
              <div>
                <div className="eyebrow mb-1.5">Tipo</div>
                {/* F43 Fase 5: o escolhido era a pílula inteira tingida na cor
                    do tipo, com contorno. Agora é o "ligado" de todo botão que
                    alterna (`.o-btn[aria-pressed]`, neutro), e a cor do tipo
                    fica no ícone — o mesmo desenho da pastilha que vai nascer. */}
                <div className="flex flex-wrap gap-2">
                  {CONTENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={ocupado}
                      onClick={() => setTipo(t)}
                      style={{ '--cal-cor': corDoTipo(t) } as CSSProperties}
                      className="o-btn o-btn-vidro o-btn-sm"
                      aria-pressed={tipo === t}
                    >
                      <IconeDoTipoDeConteudo tipo={t} />
                      {TIPO_ROTULO[t]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Campo
              rotulo="Nome"
              dica="Opcional. Sem nome, a pastilha mostra o tipo."
              value={titulo}
              disabled={ocupado}
              onChange={(e) => setTitulo(e.target.value)}
            />
            {/*
              Marcar produção pelo calendário — é a mesma linha que a aba de
              conteúdos e a grade semanal marcam, e por isso não há como as três
              telas discordarem. O risco na pastilha já mostrava o estado; o que
              faltava era poder trocá-lo sem sair do mês.

              ⚠️ SÓ NA ENTREGA. Compromisso não se conclui: reunião acontece ou
              não acontece, e um "feito" ali daria a impressão de que ele entra
              em alguma conta — que é justamente o que ele não faz.
            */}
            {existente && (
              <Chave rotulo="Concluído" ligada={concluido} aoMudar={setConcluido} desativada={ocupado} />
            )}
          </>
        ) : (
          <>
            <Campo
              rotulo="Nome"
              value={titulo}
              disabled={ocupado}
              onChange={(e) => setTitulo(e.target.value)}
            />
            <Campo
              rotulo="Hora"
              type="time"
              dica="Em branco, o compromisso ocupa o dia inteiro."
              value={hora}
              disabled={ocupado}
              onChange={(e) => setHora(e.target.value)}
            />
            <Area
              rotulo="Observação"
              value={notas}
              disabled={ocupado}
              onChange={(e) => setNotas(e.target.value)}
            />
          </>
        )}

        {/*
          O caminho para a ficha, que a pastilha do calendário de todos deixou
          de ser quando ela virou botão. Só aqui, e só de fora do cliente: de
          dentro da ficha ele levaria para onde já se está.
        */}
        {existente && clienteFixo === null && (
          <Link to={`/cliente/${existente.clientId}`} className="block text-sm text-mute underline">
            Abrir a ficha de {existente.clientName}
          </Link>
        )}

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <div>
          {existente && (
            <button
              type="button"
              className="o-btn o-btn-fantasma"
              disabled={ocupado}
              onClick={apagar}
            >
              Apagar
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="o-btn o-btn-vidro" onClick={aoFechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="o-btn o-btn-primario"
            disabled={ocupado}
            onClick={gravar}
          >
            {existente ? 'Salvar' : 'Marcar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}

/**
 * Uma das duas naturezas.
 *
 * A explicação vem embaixo do nome, e é a razão de a escolha não ser um menu
 * suspenso: num menu, "Entrega" e "Compromisso" seriam duas palavras sem a
 * única coisa que as distingue — se contam ou não no mês contratado.
 */
function Escolha({
  marcada,
  aoMarcar,
  nome,
  explicacao,
}: {
  marcada: boolean;
  aoMarcar: () => void;
  nome: string;
  explicacao: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={aoMarcar}
      aria-pressed={marcada}
      className="flex-1 rounded-md border p-2 text-left"
      /* F43 Fase 5: a marcada tinha contorno no verde da marca, que no resto
         do sistema quer dizer "ação" ou "você está aqui". Escolha é estado:
         contorno firme na tinta do texto e o fundo sobe um tom. */
      style={{
        borderColor: marcada ? 'var(--plat-dim)' : 'var(--hair-2)',
        background: marcada ? 'color-mix(in srgb, var(--plat) 8%, transparent)' : 'transparent',
      }}
    >
      <div className="text-sm text-plat">{nome}</div>
      <div className="text-xs text-mute">{explicacao}</div>
    </button>
  );
}
