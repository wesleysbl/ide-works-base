/**
 * Tela de ativação — etapa F1.9.
 *
 * A pessoa recebeu o código pelo WhatsApp de quem criou a conta, e aqui escolhe
 * a própria senha. Quem administra nunca sabe a senha de ninguém.
 *
 * A CAIXA DO CÓDIGO É PERDOADA DE PROPÓSITO
 *   Aceita minúscula, hífen e espaço, e corrige a letra digitada no lugar do
 *   dígito parecido. Quem lê um código escrito erra assim, e brigar com isso só
 *   gera ligação para o suporte.
 *
 * O NOME CHEGA PREENCHIDO, E A PESSOA MANDA NELE — F17.29
 *   Quem convidou escreveu um nome; ele viaja dentro do endereço que está na
 *   mensagem, e aparece aqui já no campo. Confirmar sem mexer é um clique,
 *   corrigir é digitar por cima — é a mesma promessa do rodapé da tela de
 *   convite: quem manda na conta é o dono dela.
 *
 *   O campo NÃO é obrigatório. Convite criado antes desta etapa não tem
 *   sugestão nenhuma, e cobrar o nome aqui transformaria uma ausência antiga
 *   em porta trancada. Vazio faz valer a sugestão guardada no convite.
 *
 * A SENHA ESCOLHIDA AQUI VALE — F17.39
 *   A autenticação é a mesma do Sistema IDE, e ter conta lá é o caso de quase
 *   todo mundo que ainda falta entrar. Para essas pessoas o convite nasce
 *   autorizado a definir a senha: um caminho só, e o botão cumpre o que diz.
 *
 *   SOBRA UM FIM DIFERENTE, e ele é o da F17.30: convite criado antes daquela
 *   decisão, ou conta criada entre o convite e a ativação. Aí a senha digitada
 *   é descartada, e esta tela manda entrar com a senha de sempre — senão a
 *   pessoa sai daqui acreditando que trocou.
 *
 *   O formulário, esse, continua o mesmo para todo mundo: avisar ANTES exigiria
 *   saber quem tem conta antes de o código ser conferido, que é exatamente a
 *   pergunta que este fluxo não responde a quem não provou nada.
 */

import { useSearchParams } from 'react-router-dom';
import { useId, useRef, useState } from 'react';

import { formatCode, normalizeCode } from '@/auth/activation-code';
import { NAME_MAX_LENGTH, NAME_PARAM, suggestedName } from '@/auth/invited-name';
import { ApiError, api } from '@/lib/api';
import { Aviso, Botao, Campo, CampoDeSenha, Pagina, ProntoParaEntrar } from '@/ui/primitivos';

/**
 * A saída desta tela, com o NOME do lugar — F29 (Fase 5a). Até aqui era o
 * `‹ Voltar` da moldura, que fazia "anterior" ou "entrada" sem dizer qual; o
 * Wesley achou que o Voltar confundia, e a entrada é o único lugar que existe
 * para quem ainda não entrou.
 */
const PARA_A_ENTRADA = { rotulo: 'Entrada', para: '/' };

export default function Ativar() {
  const [parametros] = useSearchParams();

  // Só no primeiro desenho: depois disto quem manda no campo é quem digita.
  // Recalcular a cada volta apagaria a correção da pessoa a cada tecla.
  const [nome, setNome] = useState(() => suggestedName(parametros.get(NAME_PARAM)));
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /** O código que nem chega a ser código: o erro mora NO campo, e não no fim do formulário. */
  const [erroDoCodigo, setErroDoCodigo] = useState<string | null>(null);
  // Trava contra o segundo Enter no mesmo quadro — ver `Entrar`.
  const enviandoAgora = useRef(false);
  const idDoCodigo = useId();
  const [ativando, setAtivando] = useState(false);
  const [pronto, setPronto] = useState(false);
  // Começa em `true` porque é o caso de quase todo convite, e porque um sinal
  // que não veio não pode virar a promessa mais forte: o fim que diz "a senha
  // não mudou" só aparece quando o servidor disse isso com todas as letras.
  const [senhaDefinida, setSenhaDefinida] = useState(true);

  /** Mostra XXX-XXX-XXX assim que houver nove caracteres válidos. */
  const codigoVisivel = (() => {
    try {
      return formatCode(codigo);
    } catch {
      return codigo;
    }
  })();

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviandoAgora.current) return;
    setErro(null);
    setErroDoCodigo(null);

    // Recusa antes de ir à rede o que nem chega a ser um código. Poupa uma
    // tentativa do teto de quem só digitou torto.
    try {
      normalizeCode(codigo);
    } catch {
      setErroDoCodigo('O código tem nove caracteres, no formato XXX-XXX-XXX.');
      document.getElementById(idDoCodigo)?.focus();
      return;
    }

    enviandoAgora.current = true;
    setAtivando(true);
    try {
      const resposta = await api.ativar(email, codigo, senha, nome);
      setSenhaDefinida(resposta.senhaDefinida !== false);
      setPronto(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível ativar.');
    } finally {
      enviandoAgora.current = false;
      setAtivando(false);
    }
  }

  if (pronto && !senhaDefinida) {
    return (
      <Pagina
        saida={PARA_A_ENTRADA}
        titulo="Acesso liberado"
        subtitulo="Você já tinha conta, e ela continua a mesma."
      >
        <ProntoParaEntrar nota="A senha que você digitou aqui não foi usada, e a sua não mudou.">
          Pronto. Entre com seu e-mail e <strong>a senha de sempre</strong> — a que você já usava.
        </ProntoParaEntrar>
      </Pagina>
    );
  }

  if (pronto) {
    return (
      <Pagina
        saida={PARA_A_ENTRADA}
        titulo="Conta ativada"
        subtitulo="Sua senha está definida."
      >
        <ProntoParaEntrar>Pronto. Entre com seu e-mail e a senha que você escolheu.</ProntoParaEntrar>
      </Pagina>
    );
  }

  return (
    <Pagina
      saida={PARA_A_ENTRADA}
      titulo="Ativar conta"
      subtitulo="Com o código que você recebeu de quem criou sua conta."
    >
      <form onSubmit={enviar} className="o-form">
        <Campo
          rotulo="Seu nome"
          dica="É assim que você vai aparecer para a equipe. Pode corrigir."
          autoComplete="name"
          maxLength={NAME_MAX_LENGTH}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          disabled={ativando}
        />
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={ativando}
        />
        <Campo
          id={idDoCodigo}
          rotulo="Código de ativação"
          dica="Pode digitar com ou sem hífen, em maiúscula ou minúscula."
          erro={erroDoCodigo ?? undefined}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          required
          value={codigoVisivel}
          onChange={(e) => setCodigo(e.target.value)}
          disabled={ativando}
          placeholder="XXX-XXX-XXX"
        />
        <CampoDeSenha
          rotulo="Sua senha"
          dica="Ao menos 8 caracteres. Senhas já vistas em vazamentos são recusadas."
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={ativando}
        />

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Botao type="submit" disabled={ativando} aria-busy={ativando}>
          {ativando ? 'Ativando…' : 'Ativar e definir senha'}
        </Botao>
      </form>

      <p className="iw-publica-nota">
        O código vale 72 horas e serve uma vez só. Se ele expirou ou você o
        perdeu, peça outro a quem criou sua conta — não é possível recuperá-lo.
      </p>
    </Pagina>
  );
}
