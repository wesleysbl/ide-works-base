/**
 * O formulário de cliente, sem tela — etapa F4.5.
 *
 * POR QUE ISTO NÃO ESTÁ DENTRO DO COMPONENTE
 *   Validação dentro de componente só é testável abrindo navegador, e este
 *   formulário tem muitos campos. As regras abaixo são as mesmas na tela e no
 *   servidor: a tela usa para avisar antes de enviar, o servidor usa porque
 *   nunca confia em quem chama.
 *
 * O QUE MELHORA EM RELAÇÃO AO SISTEMA IDE
 *   1. **CPF/CNPJ é conferido de verdade**, com dígito verificador. No legado o
 *      campo é texto com máscara: `000.000.000-00` entra, e é inválido.
 *   2. **Telefone vira dígito**, não máscara. O legado guarda o texto digitado,
 *      e a ficha de um cliente real mostra `(16) 33413-860` — que são os dez
 *      dígitos certos de um fixo, com a máscara aplicada no lugar errado. O
 *      número nunca esteve errado; o que está errado é guardar a apresentação.
 *      Guardando dígito, a máscara é recalculada e não há como sair torta.
 *   3. **Link sem esquema é completado**, não recusado. O banco exige
 *      `esquema://`, e no legado existe `www.linkedin.com/in/...` cadastrado
 *      assim — recusar seria transformar uma digitação comum em erro.
 *   4. **Renovação depois do início.** No legado nada impede o contrário.
 *
 * IDIOMA
 *   Campos em inglês (vão para o schema), mensagens em português (vão para a
 *   tela). Decisão D5.
 */

import { CONTENT_TYPES, type ContentType } from '@/delivery/level';

export type EntradaDeCliente = {
  name: string;
  taxId: string;
  companyEmail: string;
  planId: string | null;
  categoryId: string;
  startedOn: string;
  renewsOn: string;
  phone: string;
  whatsapp: string;
  address: string;
  ownerName: string;
  ownerPhone: string;
  ownerWhatsapp: string;
  notes: string;
  quotas: Record<ContentType, number>;
  links: Array<{ title: string; url: string }>;
  /** Etiquetas do cliente. Vão por ação própria, não por coluna. */
  tagIds: string[];
  /**
   * Listas do quadro ligadas a este cliente, na ordem da ficha.
   *
   * Alvo vazio some; repetido na mesma ficha fica a primeira ocorrência.
   * A ordem escolhida é a que se grava — o banco não recusa duplicata aqui.
   */
  boardListIds: string[];
};

export type ClienteValidado = {
  name: string;
  taxId: string | null;
  companyEmail: string | null;
  planId: string | null;
  categoryId: string;
  startedOn: string;
  renewsOn: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerWhatsapp: string | null;
  notes: string | null;
  quotas: Record<ContentType, number>;
  links: Array<{ title: string; url: string; sortOrder: number }>;
  tagIds: string[];
  boardListIds: string[];
};

export type Erros = Partial<Record<keyof EntradaDeCliente | `link${number}`, string>>;

export const ENTRADA_VAZIA: EntradaDeCliente = {
  name: '',
  taxId: '',
  companyEmail: '',
  planId: null,
  categoryId: '',
  startedOn: '',
  renewsOn: '',
  phone: '',
  whatsapp: '',
  address: '',
  ownerName: '',
  ownerPhone: '',
  ownerWhatsapp: '',
  notes: '',
  quotas: { video: 0, arte: 0, foto: 0, ads: 0 },
  links: [],
  tagIds: [],
  boardListIds: [],
};

/* ─────────────────────────── documento ─────────────────────────── */

export const soDigitos = (v: string) => v.replace(/\D/g, '');

/** Dígito verificador de CPF: soma ponderada, módulo 11. */
function cpfEhValido(d: string): boolean {
  if (d.length !== 11) return false;
  // Todos iguais passa na conta do módulo 11 e não é CPF. É o furo clássico.
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** Dígito verificador de CNPJ: pesos 2..9 cíclicos, módulo 11. */
function cnpjEhValido(d: string): boolean {
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const digito = (ate: number) => {
    let peso = ate - 7;
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(d[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return digito(12) === Number(d[12]) && digito(13) === Number(d[13]);
}

export const documentoEhValido = (bruto: string) => {
  const d = soDigitos(bruto);
  return d.length === 11 ? cpfEhValido(d) : d.length === 14 ? cnpjEhValido(d) : false;
};

/** Apresentação. O banco guarda dígito; a máscara é da tela. */
export function formatarDocumento(bruto: string): string {
  const d = soDigitos(bruto);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return bruto;
}

/* ─────────────────────────── telefone ─────────────────────────── */

/** Fixo com DDD tem 10 dígitos; celular, 11 — e o nono é sempre 9. */
export const telefoneEhValido = (bruto: string) => {
  const d = soDigitos(bruto);
  if (d.length === 10) return true;
  return d.length === 11 && d[2] === '9';
};

export function formatarTelefone(bruto: string): string {
  const d = soDigitos(bruto);
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  return bruto;
}

/* ─────────────────────────── link ─────────────────────────── */

const ESQUEMA_QUE_EXECUTA = /^(javascript|data|vbscript|file):/i;
const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Completa o esquema quando falta, e devolve `null` para o que não é link.
 *
 * NÃO HÁ LISTA FECHADA DE ESQUEMAS PERMITIDOS
 *   O legado tem `sheinlink://` cadastrado, que é deep link legítimo de loja
 *   Shein. Cada marketplace inventa o seu, e uma lista fechada estaria velha no
 *   dia seguinte. Recusa-se pelo que executa script, que é a lista curta e
 *   estável.
 */
export function normalizarUrl(bruto: string): string | null {
  const v = bruto.trim();
  if (v === '') return null;
  if (ESQUEMA_QUE_EXECUTA.test(v)) return null;
  if (TEM_ESQUEMA.test(v)) return v;
  // `www.linkedin.com/in/alguem` — digitação comum, e existe assim no legado.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(v)) return `https://${v}`;
  return null;
}

/* ─────────────────────────── e-mail ─────────────────────────── */

/**
 * Conferência deliberadamente frouxa: uma arroba, com algo dos dois lados e um
 * ponto à direita. A regra "correta" de e-mail é impossível de escrever e
 * recusa endereços válidos — e o único teste que vale é mandar mensagem.
 */
export const emailEhValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* ─────────────────────────── validação ─────────────────────────── */

const vazio = (v: string) => v.trim() === '';
const ouNulo = (v: string) => (vazio(v) ? null : v.trim());

const EH_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function validarCliente(
  e: EntradaDeCliente,
): { ok: true; valor: ClienteValidado } | { ok: false; erros: Erros } {
  const erros: Erros = {};

  if (vazio(e.name)) erros.name = 'O nome é obrigatório.';
  if (vazio(e.categoryId)) erros.categoryId = 'Escolha a categoria.';

  if (!EH_DATA.test(e.startedOn)) erros.startedOn = 'Informe a data de início.';
  if (!vazio(e.renewsOn)) {
    if (!EH_DATA.test(e.renewsOn)) erros.renewsOn = 'Data de renovação inválida.';
    // Contrato que renova antes de começar não é engano de digitação isolado:
    // é o tipo de linha que depois aparece como "-290 dias" no painel.
    else if (EH_DATA.test(e.startedOn) && e.renewsOn < e.startedOn) {
      erros.renewsOn = 'A renovação não pode ser anterior ao início.';
    }
  }

  if (!vazio(e.taxId) && !documentoEhValido(e.taxId)) {
    erros.taxId = 'CPF ou CNPJ inválido — confira os dígitos.';
  }
  if (!vazio(e.companyEmail) && !emailEhValido(e.companyEmail)) {
    erros.companyEmail = 'E-mail inválido.';
  }

  for (const campo of ['phone', 'whatsapp', 'ownerPhone', 'ownerWhatsapp'] as const) {
    if (!vazio(e[campo]) && !telefoneEhValido(e[campo])) {
      erros[campo] = 'Telefone incompleto — use DDD e o número.';
    }
  }

  for (const t of CONTENT_TYPES) {
    const q = e.quotas[t];
    if (!Number.isInteger(q) || q < 0) {
      erros.quotas = 'As quantidades precisam ser números inteiros, zero ou mais.';
      break;
    }
  }

  const links: ClienteValidado['links'] = [];
  const vistos = new Set<string>();
  e.links.forEach((l, i) => {
    // Linha em branco é o estado normal de um campo que a pessoa abriu e não
    // usou. Ignora-se em silêncio; só o preenchimento pela metade é erro.
    if (vazio(l.title) && vazio(l.url)) return;

    if (vazio(l.title)) {
      erros[`link${i}`] = 'Dê um nome ao link.';
      return;
    }
    const url = normalizarUrl(l.url);
    if (url === null) {
      erros[`link${i}`] = 'Endereço inválido.';
      return;
    }

    // O banco tem índice único sobre isto. Avisar aqui é melhor que deixar o
    // Postgres recusar com uma mensagem que ninguém entende.
    const chave = `${l.title.trim().toLowerCase()} ${url.toLowerCase()}`;
    if (vistos.has(chave)) {
      erros[`link${i}`] = 'Este link já está na lista.';
      return;
    }
    vistos.add(chave);

    links.push({ title: l.title.trim(), url, sortOrder: links.length });
  });

  // Lista apontada duas vezes na mesma ficha não é recusa: fica a primeira,
  // na ordem em que a pessoa arrumou as linhas. Alvo vazio é linha aberta
  // e não usada — some em silêncio, como o link em branco.
  const boardListIds: string[] = [];
  const listasVistas = new Set<string>();
  for (const bruto of e.boardListIds ?? []) {
    const id = bruto.trim();
    if (id === '') continue;
    if (listasVistas.has(id)) continue;
    listasVistas.add(id);
    boardListIds.push(id);
  }

  if (Object.keys(erros).length > 0) return { ok: false, erros };

  return {
    ok: true,
    valor: {
      name: e.name.trim(),
      taxId: vazio(e.taxId) ? null : soDigitos(e.taxId),
      companyEmail: ouNulo(e.companyEmail),
      planId: e.planId,
      categoryId: e.categoryId,
      startedOn: e.startedOn,
      renewsOn: ouNulo(e.renewsOn),
      phone: vazio(e.phone) ? null : soDigitos(e.phone),
      whatsapp: vazio(e.whatsapp) ? null : soDigitos(e.whatsapp),
      address: ouNulo(e.address),
      ownerName: ouNulo(e.ownerName),
      ownerPhone: vazio(e.ownerPhone) ? null : soDigitos(e.ownerPhone),
      ownerWhatsapp: vazio(e.ownerWhatsapp) ? null : soDigitos(e.ownerWhatsapp),
      notes: ouNulo(e.notes),
      quotas: { ...e.quotas },
      links,
      // Repetido na tela não é erro de digitação a ponto de recusar o
      // formulário inteiro: descarta-se em silêncio, como a função do banco
      // também faz.
      tagIds: [...new Set(e.tagIds ?? [])],
      boardListIds,
    },
  };
}
