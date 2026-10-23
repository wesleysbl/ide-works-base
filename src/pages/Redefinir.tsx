/**
 * Tela da senha nova — etapa F17.31.
 *
 * POR QUE ELA NÃO É A DE ATIVAR
 *   Até a F17.30 as duas seriam a mesma: redefinir era ativar de novo. Deixou
 *   de ser quando ativar passou a VINCULAR conta que já existe sem tocar na
 *   senha dela — e quem chega aqui já tem conta, já entrava, e o que quer é
 *   exatamente o que aquela tela não faz mais.
 *
 *   Mandá-la para a tela de ativação seria mandá-la para a única que recusa
 *   este código de propósito.
 *
 * NÃO HÁ "ESQUECI MINHA SENHA" AQUI
 *   Não há campo para pedir código: quem gera é uma pessoa, e ela entrega à
 *   mão. Um botão de pedir seria um caminho de recuperação a mais — e cada um
 *   deles é também um caminho de invasão a mais.
 *
 * A CAIXA DO CÓDIGO É PERDOADA, como na ativação: minúscula, hífen e espaço
 * passam, e a letra digitada no lugar do dígito parecido é corrigida antes.
 */

import { useId, useRef, useState } from 'react';

import { formatCode, normalizeCode } from '@/auth/activation-code';
import { ApiError, api } from '@/lib/api';
import { Aviso, Botao, Campo, CampoDeSenha, Pagina, ProntoParaEntrar } from '@/ui/primitivos';

/**
 * A saída desta tela, com o NOME do lugar — F29 (Fase 5a). Até aqui era o
 * `‹ Voltar` da moldura, que fazia "anterior" ou "entrada" sem dizer qual; o
 * Wesley achou que o Voltar confundia, e a entrada é o único lugar que existe
 * para quem ainda não entrou.
 */
const PARA_A_ENTRADA = { rotulo: 'Entrada', para: '/' };

export default function Redefinir() {
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  /** O código que nem chega a ser código: o erro mora NO campo, e não no fim do formulário. */
  const [erroDoCodigo, setErroDoCodigo] = useState<string | null>(null);
  // Trava contra o segundo Enter no mesmo quadro — ver `Entrar`.
  const enviandoAgora = useRef(false);
  const idDoCodigo = useId();
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);

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
    setSalvando(true);
    try {
      await api.redefinirSenha(email, codigo, senha);
      setPronto(true);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível trocar a senha.');
    } finally {
      enviandoAgora.current = false;
      setSalvando(false);
    }
  }

  if (pronto) {
    return (
      <Pagina
        saida={PARA_A_ENTRADA}
        titulo="Senha trocada"
        subtitulo="A partir de agora vale a que você escolheu."
      >
        <ProntoParaEntrar nota="A senha antiga não vale mais, e o código que você usou também não.">
          Pronto. Entre com seu e-mail e a senha nova.
        </ProntoParaEntrar>
      </Pagina>
    );
  }

  return (
    <Pagina
      saida={PARA_A_ENTRADA}
      titulo="Escolher senha nova"
      subtitulo="Com o código que um administrador entregou a você."
    >
      <form onSubmit={enviar} className="o-form">
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={salvando}
        />
        <Campo
          id={idDoCodigo}
          rotulo="Código"
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
          disabled={salvando}
          placeholder="XXX-XXX-XXX"
        />
        <CampoDeSenha
          rotulo="Sua senha nova"
          dica="Ao menos 8 caracteres. Senhas já vistas em vazamentos são recusadas."
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={salvando}
        />

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Botao type="submit" disabled={salvando} aria-busy={salvando}>
          {salvando ? 'Trocando…' : 'Trocar minha senha'}
        </Botao>
      </form>

      <p className="iw-publica-nota">
        O código vale 72 horas e serve uma vez só. Quem o gerou não sabe, e não vai
        saber, qual senha você escolheu.
      </p>
    </Pagina>
  );
}
