/**
 * A prévia do link, lida do PRÓPRIO endereço — F17.17.
 *
 * O QUE ESTE ARQUIVO PROVA, E POR QUE CADA COISA IMPORTA
 *   1. O DROPBOX É O CASO PRINCIPAL. É onde a agência guarda tudo, e o link
 *      chega colado no comentário e na descrição. Arquivo, pasta e o endereço
 *      novo (`/scl/fi/`) e o antigo (`/s/`) precisam os dois funcionar.
 *   2. NENHUMA IDA À REDE. O `network-guard` da F0.4 já derruba qualquer teste
 *      que tente sair — então um `fetch` escondido aqui apareceria como falha,
 *      e não como lentidão. A garantia extra que este arquivo dá é de FORMA:
 *      `lerLink` é síncrona, e função síncrona não espera resposta de ninguém.
 *   3. `javascript:` E `data:` NÃO VIRAM PRÉVIA. É a mesma trava dos dois
 *      sentidos que a F17.6 pôs no banco, repetida aqui porque esta função vai
 *      escolher o `src` de uma imagem.
 *   4. HOSPEDEIRO DESCONHECIDO NUNCA GANHA MINIATURA. Sem esta regra, todo link
 *      colado numa tarefa viraria pixel de rastreio: quem mandou o link saberia
 *      a hora em que cada pessoa abriu a tarefa.
 *   5. O QUE NÃO SE RECONHECE NÃO QUEBRA. Endereço torto, host esquisito e
 *      caminho vazio devolvem cartão pobre — nunca exceção.
 *   6. A LISTA DE SERVIDORES CONFIÁVEIS DA F17.22 ABRE UMA PORTA, E SÓ UMA.
 *      A comparação é de HOSPEDEIRO e é exata: `evil.com/nuvem.exemplo.net/x` não
 *      passa, curinga não passa, e a lista vazia — que é o padrão — deixa tudo
 *      exatamente como estava. Ver o bloco no fim do arquivo.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  definirHospedeirosConfiaveis,
  hospedeirosConfiaveis,
  lerLink,
} from '@/board/previa-de-link';

/**
 * A LISTA DE CONFIÁVEIS É ESTADO DE MÓDULO, E POR ISSO VOLTA AO VAZIO A CADA
 * TESTE.
 *
 * Sem isto, um teste que declarasse `nuvem.exemplo.net` confiável mudaria o
 * resultado de todos os que viessem depois — inclusive os que provam que
 * hospedeiro desconhecido não ganha miniatura. Um teste que contamina o
 * seguinte é pior que teste nenhum, porque a falha aparece longe da causa.
 */
afterEach(() => definirHospedeirosConfiaveis(''));

describe('o Dropbox — o cofre da agência', () => {
  it('o endereço novo de ARQUIVO traz nome, tipo e miniatura', () => {
    const p = lerLink(
      'https://www.dropbox.com/scl/fi/8h2/Arte%20Final%20Jatoba.png?rlkey=abc123&dl=0',
    );
    expect(p?.provedorNome).toBe('Dropbox');
    expect(p?.nome).toBe('Arte Final Jatoba.png');
    expect(p?.tipo).toBe('Imagem');
    expect(p?.selo).toBe('png');
    // `raw=1` é a forma documentada de pedir o conteúdo pelo próprio endereço.
    // `dl` sai: `dl=0` força a página de visualização e brigaria com o `raw`.
    expect(p?.miniatura).toContain('raw=1');
    expect(p?.miniatura).not.toContain('dl=0');
    // E o `rlkey` continua lá — sem ele o Dropbox não entrega nada.
    expect(p?.miniatura).toContain('rlkey=abc123');
  });

  it('o endereço ANTIGO (`/s/`) continua sendo lido — a agência tem link de anos', () => {
    const p = lerLink('https://www.dropbox.com/s/xyz/Roteiro%20Leads%20quiz%201.pdf?dl=0');
    expect(p?.nome).toBe('Roteiro Leads quiz 1.pdf');
    expect(p?.tipo).toBe('PDF');
  });

  it('a PASTA vira "Pasta", e não um caminho de sorteio', () => {
    const p = lerLink('https://www.dropbox.com/scl/fo/abc/h?rlkey=z&dl=0');
    expect(p?.tipo).toBe('Pasta');
    expect(p?.nome).toBeNull();
    expect(p?.selo).toBe('pasta');
  });

  it('a pasta antiga (`/sh/`) também', () => {
    expect(lerLink('https://www.dropbox.com/sh/abc/AAA?dl=0')?.tipo).toBe('Pasta');
  });

  it('VÍDEO e ARTE são reconhecidos, mas NÃO ganham miniatura', () => {
    // `raw=1` num `.mp4` baixaria o vídeo inteiro dentro de um `<img>` que
    // nunca vai desenhá-lo. O `.psd` da campanha passa de 500 MB.
    const video = lerLink('https://www.dropbox.com/scl/fi/1/reels-oferta.mp4?rlkey=k');
    expect(video?.tipo).toBe('Vídeo');
    expect(video?.miniatura).toBeNull();

    const arte = lerLink('https://www.dropbox.com/scl/fi/2/campanha.psd?rlkey=k');
    expect(arte?.tipo).toBe('Arte');
    expect(arte?.miniatura).toBeNull();
  });

  it('o `.zip` de artes é `Pacote`, e o `.ai` é `Arte` — o que a agência manda de verdade', () => {
    expect(lerLink('https://www.dropbox.com/scl/fi/3/artes.zip')?.tipo).toBe('Pacote');
    expect(lerLink('https://www.dropbox.com/scl/fi/4/logo.ai')?.tipo).toBe('Arte');
  });
});

describe('o Google — Docs, Planilhas, Apresentações e Drive', () => {
  it('o documento diz que é documento, mesmo sem o título no endereço', () => {
    const p = lerLink('https://docs.google.com/document/d/1AbC_dEf/edit?usp=sharing');
    expect(p?.provedorNome).toBe('Google Docs');
    expect(p?.tipo).toBe('Documento');
    // O título do doc NÃO está no endereço. Dizer "Documento do Google Docs" é
    // honesto; inventar um nome seria mentir com cara de prévia.
    expect(p?.nome).toBeNull();
  });

  it('planilha, apresentação e formulário têm rótulo próprio', () => {
    expect(lerLink('https://docs.google.com/spreadsheets/d/1/edit')?.tipo).toBe('Planilha');
    expect(lerLink('https://docs.google.com/presentation/d/1/edit')?.tipo).toBe('Apresentação');
    expect(lerLink('https://docs.google.com/forms/d/1/viewform')?.tipo).toBe('Formulário');
  });

  it('o arquivo do Drive ganha miniatura pública, montada pelo id do endereço', () => {
    const p = lerLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=drive_link');
    expect(p?.provedorNome).toBe('Google Drive');
    expect(p?.miniatura).toBe(
      'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMn&sz=w640',
    );
  });

  it('a pasta do Drive é pasta, e pasta não tem miniatura', () => {
    const p = lerLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn');
    expect(p?.tipo).toBe('Pasta');
    expect(p?.miniatura).toBeNull();
  });

  it('id de forma esquisita NÃO vira `src` de imagem', () => {
    // A regra é estreita de propósito: o `src` da miniatura é montado por nós,
    // e um id que não tem cara de id é sinal de endereço que não entendemos.
    expect(lerLink('https://drive.google.com/file/d/../view')?.miniatura).toBeNull();
  });
});

describe('o vídeo — a capa que existe sem API', () => {
  it('o YouTube entrega a capa pelo próprio id', () => {
    expect(lerLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.miniatura).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(lerLink('https://youtu.be/dQw4w9WgXcQ')?.miniatura).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    );
    expect(lerLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.tipo).toBe('Vídeo');
  });

  it('sem id não há capa, e o cartão continua de pé', () => {
    const p = lerLink('https://www.youtube.com/');
    expect(p?.tipo).toBe('Vídeo');
    expect(p?.miniatura).toBeNull();
  });
});

describe('o que NÃO pode acontecer', () => {
  it('`javascript:` e `data:` não têm prévia — nem para virar `src`', () => {
    // A mesma trava dos dois sentidos da F17.6: a tela recusa, o banco recusa.
    // Aqui ela vale de novo porque esta função escolhe o endereço de uma imagem.
    expect(lerLink('javascript:alert(1)')).toBeNull();
    expect(lerLink('data:image/png;base64,AAAA')).toBeNull();
    expect(lerLink('vbscript:msgbox(1)')).toBeNull();
  });

  it('hospedeiro desconhecido NUNCA ganha miniatura', () => {
    // Senão todo link colado numa tarefa viraria pixel de rastreio.
    const p = lerLink('https://rastreador.example.com/pixel/abc.png');
    expect(p?.provedor).toBe('outro');
    expect(p?.tipo).toBe('Imagem');
    expect(p?.miniatura).toBeNull();
  });

  it('endereço torto devolve nulo em vez de explodir', () => {
    expect(lerLink('')).toBeNull();
    expect(lerLink('não é endereço nenhum')).toBeNull();
    expect(lerLink('www.dropbox.com/sem/esquema')).toBeNull();
  });

  it('caminho vazio, `%` solto e nome sem extensão não quebram nada', () => {
    expect(lerLink('https://exemplo.com')?.tipo).toBe('Página');
    expect(lerLink('https://www.dropbox.com/scl/fi/1/%E9.png')?.tipo).toBe('Imagem');
    expect(lerLink('https://exemplo.com/pagina/qualquer')?.tipo).toBe('Página');
  });

  it('`lerLink` é SÍNCRONA — função síncrona não espera resposta de ninguém', () => {
    // É a forma que garante o cabeçalho do módulo: prévia montada do endereço,
    // sem contar ao Dropbox quem abriu qual tarefa.
    const r = lerLink('https://www.dropbox.com/scl/fi/1/a.png');
    expect(r).not.toBeInstanceOf(Promise);
    expect(typeof r?.host).toBe('string');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   OS SERVIDORES CONFIÁVEIS DA INSTALAÇÃO — etapa F17.22
   ═══════════════════════════════════════════════════════════════════════════

   O QUE ESTE BLOCO GUARDA
     · que a lista NASCE VAZIA, e que vazia significa exatamente o
       comportamento anterior à etapa — nenhum hospedeiro novo ganha imagem;
     · que a comparação é de HOSPEDEIRO e é EXATA. É a prova que impede o
       afrouxamento por formato de caminho: `evil.com/nuvem.exemplo.net/x` e
       `evil.com/index.php/s/TOKEN` continuam sem `src` de imagem;
     · que curinga não passa nem em silêncio: `*.exemplo.net` é descartado na
       leitura, para ninguém achar que liberou o que não liberou.
   ═══════════════════════════════════════════════════════════════════════════ */

const NC = 'nuvem.exemplo.net';
const COMPARTILHADO = `https://${NC}/index.php/s/Qr7MwyYFwGiLJkH`;
const MINIATURA = `https://${NC}/index.php/apps/files_sharing/publicpreview/Qr7MwyYFwGiLJkH?x=640&y=640`;

describe('a lista nasce vazia, e vazia não muda nada', () => {
  it('sem lista, o Nextcloud do usuário é um hospedeiro qualquer', () => {
    expect(hospedeirosConfiaveis()).toEqual([]);
    const p = lerLink(COMPARTILHADO);
    expect(p?.provedor).toBe('outro');
    expect(p?.miniatura).toBeNull();
    expect(p?.carga).toBeNull();
  });
});

describe('o hospedeiro declarado pelo dono ganha miniatura', () => {
  it('o compartilhamento público vira a miniatura COM TETO, e sobe sozinha', () => {
    definirHospedeirosConfiaveis(NC);
    const p = lerLink(COMPARTILHADO);
    expect(p?.provedor).toBe('confiavel');
    expect(p?.provedorNome).toBe('Nextcloud');
    expect(p?.miniatura).toBe(MINIATURA);
    // `x=640&y=640` é o teto: por isso ela é `leve` e não espera clique.
    expect(p?.carga).toBe('leve');
  });

  it('a forma curta `/s/<token>` das versões novas também', () => {
    definirHospedeirosConfiaveis(NC);
    expect(lerLink(`https://${NC}/s/Qr7MwyYFwGiLJkH`)?.miniatura).toBe(MINIATURA);
  });

  it('imagem direta no servidor dele espera clique — o tamanho segue desconhecido', () => {
    definirHospedeirosConfiaveis(NC);
    const p = lerLink(`https://${NC}/arquivos/logo.png`);
    expect(p?.provedor).toBe('confiavel');
    expect(p?.tipo).toBe('Imagem');
    expect(p?.miniatura).toBe(`https://${NC}/arquivos/logo.png`);
    expect(p?.carga).toBe('original');
  });

  it('o que não é imagem nem compartilhamento continua sem `src`', () => {
    definirHospedeirosConfiaveis(NC);
    const p = lerLink(`https://${NC}/arquivos/campanha.psd`);
    expect(p?.miniatura).toBeNull();
    expect(p?.carga).toBeNull();
  });

  it('espaço, maiúscula e ponto final na lista não atrapalham', () => {
    definirHospedeirosConfiaveis(`  NUVEM.Exemplo.net. , `);
    expect(hospedeirosConfiaveis()).toEqual([NC]);
    expect(lerLink(COMPARTILHADO)?.miniatura).toBe(MINIATURA);
  });
});

describe('⚠️ COMPARAÇÃO EXATA DE HOSPEDEIRO — `evil.com/nuvem.exemplo.net/x` NÃO passa', () => {
  it('o nome do confiável no CAMINHO de outro servidor não vale nada', () => {
    definirHospedeirosConfiaveis(NC);
    for (const endereco of [
      `https://evil.com/${NC}/x`,
      `https://evil.com/${NC}/index.php/s/Qr7MwyYFwGiLJkH`,
      `https://evil.com/${NC}/pixel.png`,
    ]) {
      const p = lerLink(endereco);
      expect(p?.host).toBe('evil.com');
      expect(p?.provedor).toBe('outro');
      expect(p?.miniatura).toBeNull();
    }
  });

  it('o FORMATO do caminho não é o que libera — só o hospedeiro é', () => {
    // Se a regra fosse "tem /index.php/s/ no caminho", esta linha passaria — e
    // o pixel de rastreio voltaria pela porta que a regra fechou.
    definirHospedeirosConfiaveis(NC);
    expect(lerLink('https://evil.com/index.php/s/RASTREIO')?.miniatura).toBeNull();
  });

  it('sufixo, subdomínio e o truque do `@` também não passam', () => {
    definirHospedeirosConfiaveis(NC);
    // `nuvem.exemplo.net.evil.com` termina com o nome, e é outro servidor.
    expect(lerLink(`https://${NC}.evil.com/index.php/s/T0ken123`)?.miniatura).toBeNull();
    // Subdomínio só passa se ESTIVER na lista.
    expect(lerLink(`https://arquivos.${NC}/index.php/s/T0ken123`)?.miniatura).toBeNull();
    // O que parece hospedeiro antes do `@` é usuário: o hospedeiro é `evil.com`.
    const p = lerLink(`https://${NC}@evil.com/index.php/s/T0ken123`);
    expect(p?.host).toBe('evil.com');
    expect(p?.miniatura).toBeNull();
  });

  it('o subdomínio passa quando ele MESMO está escrito na lista', () => {
    definirHospedeirosConfiaveis(`arquivos.${NC}`);
    expect(lerLink(`https://arquivos.${NC}/index.php/s/Qr7MwyYFwGiLJkH`)?.carga).toBe('leve');
    // E o pai continua de fora — a lista é de nomes, não de famílias.
    expect(lerLink(COMPARTILHADO)?.miniatura).toBeNull();
  });
});

describe('curinga e entrada torta são DESCARTADOS, e não aceitos em silêncio', () => {
  it('`*.exemplo.net` não entra na lista', () => {
    definirHospedeirosConfiaveis('*.exemplo.net');
    expect(hospedeirosConfiaveis()).toEqual([]);
    expect(lerLink(COMPARTILHADO)?.miniatura).toBeNull();
  });

  it('esquema, caminho, porta e `@` também não entram', () => {
    definirHospedeirosConfiaveis(`https://${NC}, ${NC}/x, ${NC}:8443, dono@${NC}, .exemplo.net`);
    expect(hospedeirosConfiaveis()).toEqual([]);
  });

  it('o que é hospedeiro de verdade entra, mesmo ao lado do que não é', () => {
    definirHospedeirosConfiaveis(`*.exemplo.net, ${NC}, , https://outro.com`);
    expect(hospedeirosConfiaveis()).toEqual([NC]);
  });

  it('e chamar com texto vazio devolve o padrão de fábrica', () => {
    definirHospedeirosConfiaveis(NC);
    definirHospedeirosConfiaveis('');
    expect(hospedeirosConfiaveis()).toEqual([]);
    expect(lerLink(COMPARTILHADO)?.miniatura).toBeNull();
  });
});

describe('o token do compartilhamento é conferido — aqui se escolhe um `src`', () => {
  it('token com caractere de fora não vira miniatura', () => {
    definirHospedeirosConfiaveis(NC);
    expect(lerLink(`https://${NC}/index.php/s/../../etc`)?.miniatura).toBeNull();
    expect(lerLink(`https://${NC}/index.php/s/`)?.miniatura).toBeNull();
    expect(lerLink(`https://${NC}/index.php/s/a b`)?.miniatura).toBeNull();
  });
});
