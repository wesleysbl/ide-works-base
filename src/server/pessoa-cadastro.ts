/** Edição de cadastro pelo super administrador. O Auth aplica nome local,
 * e-mail de login e auditoria na mesma transação, pelo trigger da migration.
 * O comando vai em app_metadata (somente servidor), nunca user_metadata.
 */
import { z } from 'zod';
import { withActor, type Sql } from '@/server/db';
import { asDbActor, type AuthenticatedActor } from '@/server/session';
import { type AuthProvider } from '@/server/ports';
import { PessoaRefused } from '@/server/pessoas';
import { assertTestAccount } from '@/server/test-account-guard';

const email = z.string().trim().toLowerCase().email().max(254);
export const cadastroSchema = z.object({
  nome: z.string().trim().min(1).max(160),
  email,
  anterior: z.object({ nome: z.string().nullable(), email: z.string().email().max(254) }).strict(),
}).strict();

export async function editarCadastro(sql: Sql, actor: AuthenticatedActor, provider: AuthProvider, id: string, entrada: unknown) {
  if (!actor.isSuper) throw new PessoaRefused('Só um superadministrador pode editar o cadastro.', 403);
  const dados = cadastroSchema.safeParse(entrada);
  if (!dados.success) throw new PessoaRefused('Informe um nome de até 160 caracteres e um e-mail válido.', 400);
  const { nome, email: novoEmail, anterior } = dados.data;
  const perfil = await withActor(sql, asDbActor(actor), async (tx) => {
    const linhas = await tx`select p.id, p.full_name, p.email,
      exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        where t.tgname='ideworks_profile_edit' and c.relname='users' and n.nspname='auth' and t.tgenabled='O') as pronto
      from ideworks.profiles p where p.id = ${id}`;
    return linhas[0];
  });
  if (!perfil) throw new PessoaRefused('Pessoa não encontrada.', 404);
  if (!perfil.pronto) throw new PessoaRefused('A edição de cadastro está temporariamente indisponível.', 400);
  if (perfil.full_name === nome && perfil.email === novoEmail) return;
  if (perfil.full_name !== anterior.nome || perfil.email !== anterior.email) throw new PessoaRefused('O cadastro mudou. Feche esta janela e abra novamente para conferir os dados.', 400);
  if (!provider.serviceKey) throw new PessoaRefused('Não foi possível salvar o cadastro agora. Tente novamente mais tarde.', 400);
  if (provider.testAccountsOnly) {
    assertTestAccount(perfil.email as string, provider.allowedAccounts ?? '');
    assertTestAccount(novoEmail, provider.allowedAccounts ?? '');
  }
  let resposta: Response;
  try {
    resposta = await fetch(`${provider.url}/auth/v1/admin/users/${id}`, {
      method: 'PUT',
      headers: { apikey: provider.serviceKey, Authorization: `Bearer ${provider.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(novoEmail !== perfil.email ? { email: novoEmail, email_confirm: true } : {}),
        app_metadata: { ideworks_profile_edit: {
          request_id: crypto.randomUUID(), actor_id: actor.userId,
          nome, email: novoEmail, anterior,
        } },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Resposta perdida não prova rollback. Reabrir permite conferir e repetir.
    throw new PessoaRefused('Não foi possível confirmar o salvamento. Reabra o cadastro e confira os dados antes de tentar novamente.', 400);
  }
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({})) as { code?: string; error_code?: string };
    const codigo = erro.code ?? erro.error_code;
    if (codigo === 'email_exists' || codigo === 'email_address_not_authorized' || codigo === 'user_already_exists') {
      throw new PessoaRefused('Esse e-mail já está em uso ou não está disponível. Confira o endereço.', 400);
    }
    if (resposta.status === 404) throw new PessoaRefused('Esta pessoa não tem uma conta de acesso vinculada.', 404);
    throw new PessoaRefused('Não foi possível salvar. O e-mail pode estar em uso ou o cadastro pode ter mudado. Reabra a janela e confira os dados.', 400);
  }
}
