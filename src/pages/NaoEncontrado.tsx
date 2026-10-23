/**
 * O 404 — F15 do plano UX.
 *
 * A SAÍDA DEPENDE DE QUEM ESTÁ OLHANDO
 *   Sem sessão, a saída é a entrada (`/`), que é pública. Com sessão, é o
 *   Painel — o mesmo lugar para onde a entrada manda quem acabou de entrar
 *   (`saidaDepoisDeEntrar`). Nenhum dos dois abre acesso: a tela só ESCOLHE o
 *   link; quem decide o que abre continua sendo o servidor, e o Painel sem
 *   permissão recusa como sempre recusou.
 *
 *   Enquanto a sessão é conferida, vale a saída sem sessão: a entrada com
 *   crachá válido já leva ao Painel sozinha, então ela nunca é o link errado.
 *   Não há redirecionamento automático — endereço errado não vira laço.
 *
 * O ENDEREÇO QUE FALHOU APARECE, escrito. "Esse endereço" sem dizer qual
 * obrigava a pessoa a olhar a barra do navegador — que no celular nem aparece.
 */
import { Link, useLocation } from 'react-router-dom';

import { Pagina } from '@/ui/primitivos';
import { useSessao } from '@/ui/sessao';

export default function NaoEncontrado() {
  const { pathname } = useLocation();
  const { sessao } = useSessao();

  return (
    <Pagina titulo="Página não encontrada" subtitulo="Esse endereço não existe no IDE Works.">
      <p className="eyebrow">Endereço pedido</p>
      <code className="iw-publica-endereco">{pathname}</code>
      <p className="iw-publica-nota">Confira o link que você recebeu, ou siga por aqui:</p>
      <div className="iw-publica-feito mt-3">
        {sessao ? (
          <Link to="/painel" className="o-btn o-btn-solido">
            Ir para o Painel
          </Link>
        ) : (
          <Link to="/" className="o-btn o-btn-solido">
            Voltar para a entrada
          </Link>
        )}
      </div>
    </Pagina>
  );
}
