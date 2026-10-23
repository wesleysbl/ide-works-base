/**
 * Tela de entrada — etapa F1.9.
 *
 * NÃO EXISTE "SOLICITE SEU ACESSO" AQUI, E ISSO É DE PROPÓSITO.
 *   O Sistema IDE tem uma porta pública em três passos — solicite, aguarde
 *   aprovação, entre — e uma fila de aprovação por trás. O IDE Works substitui
 *   isso por convite fechado: quem não foi convidado não tem onde bater.
 *
 *   É uma **remoção** deliberada, não um esquecimento. Há teste cobrando que
 *   nenhuma rota pública de solicitação exista.
 *
 * NÃO EXISTE "ESQUECI MINHA SENHA" TAMBÉM.
 *   A recuperação é feita por uma pessoa, não por um robô: um administrador
 *   gera um código novo, e o entrega à mão. Não há botão de pedir, e não há
 *   link por e-mail — cada caminho de recuperação a mais é um caminho de
 *   invasão a mais.
 *
 *   O link "Redefinir com código", aqui embaixo, leva à tela onde se GASTA
 *   esse código. Ele não pede nada a ninguém: sem código, não há o que fazer
 *   lá — e a frase ao lado dele diz, antes do clique, de onde o código vem.
 *
 *   Até a F17.30 esta frase dizia "redefinir senha é ativar a conta de novo".
 *   Deixou de ser verdade quando ativar passou a vincular conta existente sem
 *   tocar na senha dela — ver `src/auth/password-reset.ts`.
 */

import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, api, semSessao } from '@/lib/api';
import { esquecerConsultas, esquecerSessao, useClienteDeConsultas } from '@/lib/consultas';
import { Aviso, Botao, Campo, CampoDeSenha, Chave, Pagina } from '@/ui/primitivos';
import { avisarOutrasAbas } from '@/ui/rascunho';
import { consultaDaSessao } from '@/ui/sessao';

import { sairDoLogin, saidaDepoisDeEntrar } from './saida-do-login';

/** Diz onde a pessoa está antes do formulário — e fica igual enquanto a
 *  sessão é conferida, para o título não pular quando o formulário aparece. */
const SUBTITULO = 'Acesse seu espaço de trabalho';

export default function Entrar() {
  const navigate = useNavigate();
  const [parametros] = useSearchParams();
  // Não é só PARA ONDE: é também COMO. `/oauth/authorize` é rota do Worker, e
  // só chega lá por navegação de documento. Ver `./saida-do-login`.
  // `useMemo` não é enfeite: `saida` é dependência do efeito abaixo, e um
  // objeto novo a cada desenho o faria rodar sem parar. O que muda de verdade
  // é o `next`, que é texto.
  const next = parametros.get('next');
  const saida = useMemo(() => saidaDepoisDeEntrar(next), [next]);
  const client = useClienteDeConsultas();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  /* A TRAVA É UMA REF, E NÃO SÓ O ESTADO — F15. Dois Enter no mesmo quadro
     leem o mesmo `entrando = false` (o estado só muda no próximo desenho) e
     mandariam dois logins. A ref muda na hora. */
  const enviandoAgora = useRef(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    let active = true;
    // Confere o cookie no servidor, mesmo se houver identidade antiga no cache.
    // A API já renova a sessão quando o token de acesso vence.
    void client.fetchQuery({ ...consultaDaSessao, staleTime: 0 }).then(
      (session) => {
        if (!active) return;
        // Quem já tinha sessão e caiu aqui vindo do `/oauth/authorize` sai
        // DAQUI para o servidor: `navigate` desenharia "Página não encontrada".
        if (session) sairDoLogin(saida, navigate);
        else setCheckingSession(false);
      },
      (error: unknown) => {
        if (!active) return;
        if (!semSessao(error)) {
          setErro('Não foi possível verificar sua sessão. Recarregue a página ou tente entrar.');
        }
        setCheckingSession(false);
      },
    );
    return () => { active = false; };
  }, [client, navigate, saida]);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (enviandoAgora.current) return;
    enviandoAgora.current = true;
    setErro(null);
    setEntrando(true);
    try {
      await api.entrar(email, senha, rememberMe);
      /*
        ⚠️ E O CACHE EM MEMÓRIA VAI EMBORA AQUI — F17.CARGA02.

        Entrar não recarrega a página: `navigate` é navegação de aplicação, e
        tudo o que estava em memória atravessa. Quem chegou a esta tela sem
        recarregar (digitou `/`, ou foi mandado para cá por um 401) e entrou com
        OUTRA conta encontraria, do outro lado, a árvore da conta anterior — já
        desenhada, antes de qualquer leitura nova. Ver `esquecerConsultas`.
      */
      esquecerConsultas();
      /* E A SESSÃO JUNTO, que `esquecerConsultas` poupa de propósito. Sem esta
         linha, quem entrou por aqui SEM recarregar (veio do `Voltar para a
         entrada` de `NaoEncontrado`, de `Ativar` ou de `Redefinir`, que são
         `Link` e não F5) encontraria do outro lado a sessão da conta anterior
         ainda dentro da validade: o e-mail, as áreas e — o pior — o `userId`
         que abre o rascunho de quem saiu. Ver `esquecerSessao`. */
      esquecerSessao();
      // Entrar É uma mudança de identidade: uma aba deixada aberta com a ficha
      // de quem saiu precisa perguntar de novo quem é — F17.AUD02. Só um
      // carimbo em `localStorage`, sem id nem e-mail. Ver `ui/rascunho.ts`.
      avisarOutrasAbas();
      /*
        A sessao agora vive em cookie: navegar direto e o comportamento certo.

        ⚠️ `replace`, E NÃO `push` — F17.33. Entrar não é uma navegação que se
        desfaz: com `push`, a primeira tela de dentro do sistema fica com o
        formulário de login um passo atrás, e o VOLTAR da F17.33 (e o do próprio
        navegador) devolveria a pessoa a uma tela de entrada que ela acabou de
        atravessar. Com `replace` a entrada some do histórico, e `/painel` passa
        a ser a primeira entrada — que é a verdade do que aconteceu.

        ⚠️ E QUANDO O DESTINO É `/oauth/authorize`, NÃO É `navigate` NENHUM.
        Aquele endereço é do Worker, não das rotas desta aplicação: o roteador
        não o encontraria e desenharia "Página não encontrada", sem nunca mandar
        o cookie do pedido ao servidor. `sairDoLogin` decide — e também lá a
        saída substitui o histórico, para o VOLTAR não refazer a autorização.
      */
      sairDoLogin(saida, navigate);
    } catch (e) {
      // A frase vem do servidor sem tradução. As recusas são idênticas entre si
      // de propósito — melhorar a mensagem aqui entregaria quais e-mails existem.
      setErro(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      enviandoAgora.current = false;
      setEntrando(false);
    }
  }

  if (checkingSession) {
    return (
      <Pagina titulo="IDE Works" subtitulo={SUBTITULO}>
        <p role="status" className="text-sm text-mute" style={{ minHeight: '12rem' }}>
          Verificando sua sessão…
        </p>
      </Pagina>
    );
  }

  return (
    <Pagina titulo="IDE Works" subtitulo={SUBTITULO}>
      <form onSubmit={enviar} className="o-form o-entrada">
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={entrando}
        />
        <CampoDeSenha
          rotulo="Senha"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={entrando}
        />

        {/* A frase fica FORA da chave: dentro do `<label>` ela entraria no nome
            da caixa, e "Manter conectado por 30 dias" é o nome que o leitor de
            tela anuncia e que o teste de ponta a ponta procura. */}
        <div>
          <Chave
            rotulo="Manter conectado por 30 dias"
            ligada={rememberMe}
            aoMudar={setRememberMe}
            desativada={entrando}
          />
          <p className="mt-1 pl-[calc(38px+0.55rem)] text-xs text-mute">Em computador compartilhado, desligue.</p>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <Botao type="submit" disabled={entrando} aria-busy={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </Botao>
      </form>

      {/* DOIS CAMINHOS, E NÃO UM PARÁGRAFO — F27.
          Era uma frase só, em 12px, com os dois links no meio dela: quem
          chegava sem conseguir entrar tinha de ler tudo para achar o SEU caso.
          Agora cada caso tem a pergunta que a pessoa já está se fazendo, o
          link, e de onde vem o código. Nenhum dos dois pede nada a ninguém —
          ver o comentário do topo. F15: moram no pé do cartão, abaixo de um
          fio; o "acesso por convite" foi para o pé da moldura. */}
      <div className="iw-publica-caminhos">
        <section>
          <h2>Recebeu um código de ativação?</h2>
          <p>
            <Link to="/ativar">Ativar conta</Link>
            {' '}— o código vem de um administrador do IDE Works.
          </p>
        </section>
        <section>
          <h2>Perdeu a senha?</h2>
          <p>
            <Link to="/redefinir">Redefinir com código</Link>
            {' '}— não há recuperação automática: um administrador gera um código novo
            e entrega a você.
          </p>
        </section>
      </div>
    </Pagina>
  );
}
