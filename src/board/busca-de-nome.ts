/**
 * A BUSCA POR NOME NOS SELETORES DA TAREFA — pessoa, lista e cliente.
 *
 * Os quatro seletores do quadro (`MenuDePessoas`, `MenuDeListas`,
 * `MenuDeClientes` e a `CaixaDeClientes`) comparavam
 * `nome.toLowerCase().includes(busca.toLowerCase())`: quem digita sem acento —
 * o normal — não achava "João", "Ana Luíza" nem "Clínica Sorrir", e o seletor
 * respondia "ninguém com esse nome" sobre quem estava na lista. A busca por
 * título (`filtro.ts`) e as telas de Pessoas e Meta já dobravam o acento; estas
 * ficaram para trás.
 *
 * É a dobra GENÉRICA (decomposição e marcas), e não a tabela de `filtro.ts`:
 * aquela existe para ser a MESMA do `translate` do SQL, e aqui a comparação é
 * toda no navegador, sobre nomes que já chegaram.
 */

/** Minúsculas e sem acento — de qualquer forma Unicode em que o acento venha. */
export function paraBusca(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
}

/** O nome contém o que se digitou? Busca vazia casa com tudo. */
export function nomeCasaComABusca(nome: string, busca: string): boolean {
  const q = paraBusca(busca.trim());
  return q === '' || paraBusca(nome).includes(q);
}
