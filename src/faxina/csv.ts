/**
 * CSV da faxina — F38, Fase 8.
 *
 * SEPARADOR `;` — escolha: o Excel em português do Brasil usa `;` como separador
 * de lista (a vírgula é decimal), então abrir um CSV com `,` ali joga tudo na
 * primeira coluna; o Google Sheets detecta `;` sozinho ao importar. UTF-8 com BOM
 * para o Excel não estragar os acentos. A LEITURA aceita `;`, `,` ou tab (o
 * Sheets exporta com vírgula), pelo cabeçalho.
 */

export const BOM = '﻿';

/** Título que começa com = + - @ viraria fórmula numa planilha. */
const contraFormula = (v: string): string => (/^[=+\-@]/.test(v) ? `'${v}` : v);

export function celula(valor: string, separador = ';'): string {
  const v = contraFormula(valor);
  return v.includes(separador) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function montarCsv(cabecalho: readonly string[], linhas: readonly (readonly string[])[], separador = ';'): string {
  const todas = [cabecalho, ...linhas];
  return `${BOM}${todas.map((l) => l.map((c) => celula(c, separador)).join(separador)).join('\r\n')}\r\n`;
}

/** O separador mais frequente na primeira linha (fora de aspas não importa: é o cabeçalho). */
export function detectarSeparador(texto: string): string {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? '';
  const contagem = (s: string) => primeira.split(s).length - 1;
  const candidatos = [';', ',', '\t'] as const;
  return candidatos.reduce((melhor, s) => (contagem(s) > contagem(melhor) ? s : melhor), ';');
}

/** Lê CSV com aspas, aspas duplicadas e quebra de linha dentro da célula. */
export function lerCsv(textoBruto: string, separador?: string): string[][] {
  const texto = textoBruto.startsWith(BOM) ? textoBruto.slice(1) : textoBruto;
  const sep = separador ?? detectarSeparador(texto);
  const linhas: string[][] = [];
  let linha: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const ch = texto[i] as string;
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          atual += '"';
          i += 1;
        } else aspas = false;
      } else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(atual);
      atual = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i += 1;
      linha.push(atual);
      atual = '';
      if (linha.some((c) => c !== '')) linhas.push(linha);
      linha = [];
    } else atual += ch;
  }
  linha.push(atual);
  if (linha.some((c) => c !== '')) linhas.push(linha);
  return linhas;
}
