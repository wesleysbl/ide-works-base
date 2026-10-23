/**
 * As preferências da barra lateral — etapa F17.18.
 *
 * O QUE PRECISA SER VERDADE SEMPRE
 *   O que está guardado veio do navegador e pode ser QUALQUER coisa: lixo de
 *   outra versão, JSON de outro sistema no mesmo domínio, ou o objeto de uma
 *   versão futura deste arquivo. A leitura nunca pode estourar — se estourar, a
 *   barra não desenha nenhuma e o sistema fica sem navegação.
 *
 *   E há uma armadilha de tempo: quando uma etapa futura criar a quarta seção,
 *   ela precisa APARECER para quem já personalizou a barra. Sem isso, a função
 *   nova nasceria invisível justamente para quem mais usa o sistema.
 */

import { describe, expect, it } from 'vitest';

import { type Area } from '@/auth/areas';
import {
  AREA_DA_SECAO,
  AREA_DO_ITEM,
  ITENS_DA_BARRA,
  PADRAO,
  SECOES_DA_BARRA,
  SECAO_DO_ITEM,
  DESTINO_DO_ITEM,
  alternarAparencia,
  alternarArvoreEmColuna,
  alternarListas,
  alternarRecolhida,
  arvoreNaColuna,
  composicaoEfetiva,
  contextoDoItem,
  escreverPreferencias,
  itensVisiveis,
  lerPreferencias,
  ordemValida,
  reordenar,
  secaoDeAdmin,
  secoesVisiveis,
} from '@/ui/preferencias';

describe('a leitura nunca estoura', () => {
  it('sem nada guardado, devolve o padrão', () => {
    expect(lerPreferencias(null)).toEqual(PADRAO);
    expect(lerPreferencias('')).toEqual(PADRAO);
  });

  it('texto que não é JSON devolve o padrão em vez de estourar', () => {
    expect(() => lerPreferencias('não sou json {')).not.toThrow();
    expect(lerPreferencias('não sou json {')).toEqual(PADRAO);
  });

  it('JSON que não é objeto devolve o padrão', () => {
    expect(lerPreferencias('null')).toEqual(PADRAO);
    expect(lerPreferencias('"texto"')).toEqual(PADRAO);
    expect(lerPreferencias('42')).toEqual(PADRAO);
  });

  it('valor de tipo errado vira o padrão daquele campo, e o resto sobrevive', () => {
    const p = lerPreferencias(
      JSON.stringify({ aparencia: 12, cor: { r: 1 }, telaInicial: 'lua', itens: { minhas: 'sim' } }),
    );
    expect(p.aparencia).toBe(PADRAO.aparencia);
    expect(p.cor).toBe(PADRAO.cor);
    expect(p.telaInicial).toBe(PADRAO.telaInicial);
    expect(p.itens.minhas).toBe(PADRAO.itens.minhas);
  });

  it('o que foi gravado volta igual', () => {
    const meu = {
      ...PADRAO,
      itens: { ...PADRAO.itens, painel: false },
      secoes: { ...PADRAO.secoes, entrega: false },
      // F43 Fase 8: a ordem guardada traz as quatro seções (com `gestao`).
      ordem: ['entrega', 'gestao', 'arvore', 'trabalho'] as const,
      aparencia: 'icones' as const,
      telaInicial: 'todas' as const,
      abaInicial: 'delegado' as const,
      cor: 'roxo' as const,
    };
    expect(lerPreferencias(escreverPreferencias({ ...meu, ordem: [...meu.ordem] }))).toEqual({
      ...meu,
      ordem: [...meu.ordem],
    });
  });

  it('mexer no objeto lido não muda o PADRÃO — ele não é compartilhado por referência', () => {
    const p = lerPreferencias(null);
    p.itens.minhas = false;
    p.ordem.push('trabalho');
    p.recolhidas.entrega = true;
    expect(PADRAO.itens.minhas).toBe(true);
    expect(PADRAO.ordem).toEqual([...SECOES_DA_BARRA]);
    expect(PADRAO.recolhidas.entrega).toBe(false);
  });
});

describe('a ordem das seções, saneada', () => {
  /* F43 Fase 8: as saídas abaixo ganharam `gestao`, sempre LOGO DEPOIS de
     `entrega` — a seção nova nasce onde o item dela (o Controle) morava. */
  it('seção repetida entra uma vez só — duas desenhariam a árvore duas vezes', () => {
    expect(ordemValida(['arvore', 'arvore', 'trabalho'])).toEqual([
      'arvore',
      'trabalho',
      'entrega',
      'gestao',
    ]);
  });

  it('seção desconhecida some', () => {
    expect(ordemValida(['planilhas', 'arvore'])).toEqual(['arvore', 'trabalho', 'entrega', 'gestao']);
  });

  it('⚠️ SEÇÃO FALTANTE ENTRA NO FIM — é o que faz a seção nova aparecer amanhã', () => {
    // Sem isto, quem já personalizou a barra nunca veria a seção que uma etapa
    // futura criar: ela nasceria invisível para quem mais usa o sistema.
    // (A exceção é a seção com origem — `gestao`, logo depois de `entrega`.)
    expect(ordemValida(['entrega'])).toEqual(['entrega', 'gestao', 'trabalho', 'arvore']);
    expect(ordemValida([])).toEqual([...SECOES_DA_BARRA]);
    expect(ordemValida('nada')).toEqual([...SECOES_DA_BARRA]);
  });

  it('F43 Fase 8: `Gestão` nasce logo depois de `Entrega`, onde o Controle morava — nunca embaixo da árvore', () => {
    // A ordem de fábrica de quem já tinha a barra guardada antes da F43.
    expect(ordemValida(['trabalho', 'entrega', 'arvore'])).toEqual([
      'trabalho',
      'entrega',
      'gestao',
      'arvore',
    ]);
    // Uma ordem escolhida: a Entrega no fim continua no fim, com a Gestão atrás.
    expect(ordemValida(['arvore', 'trabalho', 'entrega'])).toEqual([
      'arvore',
      'trabalho',
      'entrega',
      'gestao',
    ]);
    // Já guardada em outro lugar, ela fica onde a pessoa a pôs.
    expect(ordemValida(['gestao', 'trabalho', 'entrega', 'arvore'])).toEqual([
      'gestao',
      'trabalho',
      'entrega',
      'arvore',
    ]);
  });

  it('a ordem devolvida tem sempre todas as seções, e uma vez cada', () => {
    const ordem = ordemValida(['arvore']);
    expect(new Set(ordem).size).toBe(SECOES_DA_BARRA.length);
  });
});

/* ─────────────────── a árvore vai para o fim — F28 ─────────────────── */

describe('a ordem de fábrica põe a Entrega antes da árvore — F28', () => {
  /*
    A árvore é a única seção que cresce. No meio, ela empurrava Painel,
    Calendário e Planejamento para debaixo da dobra. A fábrica mudou, e quem
    tinha a fábrica ANTIGA guardada — sem nunca tê-la escolhido — vai junto.
    Quem escolheu outra ordem fica com a sua.
  */
  const antiga = ['trabalho', 'arvore', 'entrega'];
  /* F43 Fase 8: a fábrica nova tem `gestao` depois de `entrega`. A antiga
     continua de três: é o texto como ele foi gravado antes da F28. */
  const nova = ['trabalho', 'entrega', 'gestao', 'arvore'];
  /** O texto como a versão de antes da F28 gravava: o objeto cru, sem `versao`. */
  const gravadoAntes = (extra: Record<string, unknown>) => JSON.stringify({ ...PADRAO, ...extra });

  it('a fábrica é Meu trabalho → Entrega → Compartilhado comigo', () => {
    expect([...SECOES_DA_BARRA]).toEqual(nova);
    expect(PADRAO.ordem).toEqual(nova);
  });

  it('sem nada guardado, a ordem é a nova', () => {
    expect(lerPreferencias(null).ordem).toEqual(nova);
  });

  it('a fábrica antiga guardada é levada para a nova', () => {
    expect(lerPreferencias(gravadoAntes({ ordem: antiga })).ordem).toEqual(nova);
  });

  it('⚠️ quem mudou SÓ a aparência também migra — a ordem veio junto, não foi escolhida', () => {
    // O objeto inteiro é gravado de uma vez: trocar para `Somente ícones` antes
    // da F28 gravou a ordem de fábrica daquele dia junto.
    const p = lerPreferencias(gravadoAntes({ ordem: antiga, aparencia: 'icones', cor: 'roxo' }));
    expect(p.ordem).toEqual(nova);
    expect(p.aparencia).toBe('icones');
    expect(p.cor).toBe('roxo');
  });

  it('a fábrica antiga INCOMPLETA também migra — o saneamento a completa antes da comparação', () => {
    expect(lerPreferencias(gravadoAntes({ ordem: ['trabalho', 'arvore'] })).ordem).toEqual(nova);
  });

  it('ordem personalizada antes da F28 fica como a pessoa deixou', () => {
    // F43 Fase 8: com a `gestao` logo depois da `entrega` — ver `ORIGEM_DA_SECAO`.
    const comGestao = (o: string[]) => o.flatMap((s) => (s === 'entrega' ? [s, 'gestao'] : [s]));
    for (const minha of [
      ['entrega', 'trabalho', 'arvore'],
      ['arvore', 'trabalho', 'entrega'],
      ['trabalho', 'entrega', 'arvore'],
    ]) {
      expect(lerPreferencias(gravadoAntes({ ordem: minha })).ordem).toEqual(comGestao(minha));
    }
  });

  it('⚠️ a ordem antiga ESCOLHIDA depois da F28 fica — senão a linha voltaria sozinha', () => {
    // A barra relê o que acabou de gravar. Sem a versão no texto, arrastar
    // para a ordem antiga seria desfeito no instante seguinte.
    const escolhida = { ...PADRAO, ordem: [...antiga, 'gestao'] as typeof PADRAO.ordem };
    expect(lerPreferencias(escreverPreferencias(escolhida)).ordem).toEqual([...antiga, 'gestao']);
  });

  it('ordem guardada inválida continua saneada, e com a fábrica nova completando', () => {
    expect(lerPreferencias(gravadoAntes({ ordem: 'nada' })).ordem).toEqual(nova);
    expect(lerPreferencias(gravadoAntes({ ordem: ['entrega', 'entrega', 'x'] })).ordem).toEqual([
      'entrega',
      'gestao',
      'trabalho',
      'arvore',
    ]);
  });
});

/* ─────────────────── recolher a barra e as seções — F29 ─────────────────── */

describe('a barra recolhe, e cada seção fecha pelo título — F29', () => {
  /*
    Recolher a barra é a aparência `Somente ícones` a um clique; recolher uma
    seção é um campo novo, `recolhidas`. O campo novo nasce em textos que já
    existem sem ele — a leitura precisa lê-los como "tudo aberto", senão a
    barra de todo mundo abriria com seções fechadas que ninguém fechou.
  */
  it('de fábrica, nenhuma seção está recolhida', () => {
    expect(PADRAO.recolhidas).toEqual({ trabalho: false, arvore: false, entrega: false, gestao: false });
    expect(lerPreferencias(null).recolhidas).toEqual(PADRAO.recolhidas);
  });

  it('⚠️ texto gravado antes do campo (versão 2, sem `recolhidas`) lê tudo aberto', () => {
    const semOCampo: Record<string, unknown> = { ...PADRAO, aparencia: 'icones', versao: 2 };
    delete semOCampo.recolhidas;
    const antigo = JSON.stringify(semOCampo);
    expect(antigo).not.toContain('recolhidas');
    const p = lerPreferencias(antigo);
    expect(p.recolhidas).toEqual({ trabalho: false, arvore: false, entrega: false, gestao: false });
    // O resto do que estava guardado sobrevive.
    expect(p.aparencia).toBe('icones');
  });

  it('texto de antes da F28 (sem versão) também lê tudo aberto — e a migração da ordem continua', () => {
    const antigo = JSON.stringify({ ordem: ['trabalho', 'arvore', 'entrega'] });
    const p = lerPreferencias(antigo);
    expect(p.recolhidas).toEqual(PADRAO.recolhidas);
    expect(p.ordem).toEqual(['trabalho', 'entrega', 'gestao', 'arvore']);
  });

  it('valor estranho numa seção vira aberto, e o resto do campo sobrevive', () => {
    const p = lerPreferencias(
      JSON.stringify({ recolhidas: { entrega: true, trabalho: 'sim', planilhas: true } }),
    );
    // F43 Fase 8: a `gestao` sem valor herda da `entrega` — o Controle estava lá dentro.
    expect(p.recolhidas).toEqual({ trabalho: false, arvore: false, entrega: true, gestao: true });
  });

  it('campo de tipo errado inteiro vira tudo aberto, sem estourar', () => {
    for (const lixo of ['"x"', '42', 'null', '[true]']) {
      const texto = `{"recolhidas": ${lixo}}`;
      expect(() => lerPreferencias(texto)).not.toThrow();
      expect(lerPreferencias(texto).recolhidas).toEqual(PADRAO.recolhidas);
    }
  });

  it('a seção recolhida volta igual depois de gravar e ler — é o que sobrevive ao F5', () => {
    const minha = alternarRecolhida(PADRAO, 'entrega');
    expect(lerPreferencias(escreverPreferencias(minha)).recolhidas).toEqual({
      trabalho: false,
      arvore: false,
      entrega: true,
      gestao: false,
    });
  });

  it('a versão gravada continua 2 — o campo novo não precisa de outra', () => {
    expect(JSON.parse(escreverPreferencias(PADRAO)).versao).toBe(2);
  });

  it('alternar uma seção mexe só nela, e duas vezes volta ao começo', () => {
    const uma = alternarRecolhida(PADRAO, 'arvore');
    expect(uma.recolhidas).toEqual({ trabalho: false, arvore: true, entrega: false, gestao: false });
    expect(alternarRecolhida(uma, 'arvore').recolhidas).toEqual(PADRAO.recolhidas);
    // Não muda o objeto de quem chamou.
    expect(PADRAO.recolhidas.arvore).toBe(false);
  });

  it('recolher a barra é trocar a aparência, e expandir devolve', () => {
    const recolhida = alternarAparencia(PADRAO);
    expect(recolhida.aparencia).toBe('icones');
    expect(alternarAparencia(recolhida).aparencia).toBe('icones-e-rotulos');
    // O resto da escolha fica: recolher a barra não reabre nem fecha seção.
    const comSecao = alternarRecolhida(PADRAO, 'entrega');
    expect(alternarAparencia(comSecao).recolhidas.entrega).toBe(true);
  });
});

describe('reordenar', () => {
  it('move a seção para a posição pedida', () => {
    expect(reordenar(['trabalho', 'arvore', 'entrega'], 2, 0)).toEqual([
      'entrega',
      'trabalho',
      'arvore',
    ]);
  });

  it('para o mesmo lugar devolve a lista igual', () => {
    expect(reordenar(['trabalho', 'arvore', 'entrega'], 1, 1)).toEqual([
      'trabalho',
      'arvore',
      'entrega',
    ]);
  });

  it('índice fora da lista não embaralha — soltar fora da caixa é gesto comum', () => {
    const ordem = ['trabalho', 'arvore', 'entrega'] as const;
    expect(reordenar(ordem, -1, 0)).toEqual([...ordem]);
    expect(reordenar(ordem, 0, 9)).toEqual([...ordem]);
    expect(reordenar(ordem, 9, 0)).toEqual([...ordem]);
  });

  it('não perde nem duplica seção', () => {
    const saida = reordenar(['trabalho', 'arvore', 'entrega'], 0, 2);
    expect(new Set(saida).size).toBe(3);
  });
});

describe('o que a barra desenha', () => {
  it('esconder a SEÇÃO esconde os itens dela, mesmo marcados', () => {
    const p = { ...PADRAO, secoes: { ...PADRAO.secoes, entrega: false } };
    expect(itensVisiveis(p, 'entrega')).toEqual([]);
    expect(secoesVisiveis(p)).not.toContain('entrega');
  });

  it('seção de navegação sem item visível some — cabeçalho sozinho é ruído', () => {
    const p = {
      ...PADRAO,
      itens: { ...PADRAO.itens, painel: false, calendario: false, planejamento: false },
    };
    expect(itensVisiveis(p, 'entrega')).toEqual([]);
    expect(secoesVisiveis(p)).not.toContain('entrega');
  });

  it('a árvore fica mesmo sem item — o conteúdo dela é a árvore inteira', () => {
    expect(secoesVisiveis(PADRAO)).toContain('arvore');
  });

  it('com tudo escondido, a barra fica vazia — e é por isso que o pé mora fora dela', () => {
    const p = { ...PADRAO, secoes: { trabalho: false, arvore: false, entrega: false, gestao: false } };
    expect(secoesVisiveis(p)).toEqual([]);
  });
});

/* ─────────────────── a ÁREA também esconde — F17.36 ─────────────────── */

describe('quem não alcança a área não recebe o botão', () => {
  /*
    Até a F17.36 os seis itens eram da mesma área e este bloco não podia
    existir: não havia como ter o quadro e não ter a entrega. Agora há, e sem
    esta conta Painel, Calendário e Planejamento virariam botão que responde
    403 — botão morto com um passo a mais.
  */
  const so = (...areas: Area[]) => (a: Area) => areas.includes(a);

  it('só o quadro: os três itens da Entrega somem, e a seção com eles', () => {
    const alcanca = so('quadro');
    expect(itensVisiveis(PADRAO, 'entrega', alcanca)).toEqual([]);
    expect(secoesVisiveis(PADRAO, alcanca)).not.toContain('entrega');
    // `avisos` entrou na F17.46, e entrou NA FRENTE: a caixa de entrada é o
    // único item que muda de conteúdo sem ninguém pedir, e é da área `quadro`
    // como os outros três — quem tem o quadro tem a caixa dele.
    expect(itensVisiveis(PADRAO, 'trabalho', alcanca)).toEqual([
      'avisos',
      'chat',
      'minhas',
      'todas',
      'quadro',
    ]);
    expect(secoesVisiveis(PADRAO, alcanca)).toContain('arvore');
  });

  it('só a entrega: o trabalho some — exceto o chat, que é livre (D26)', () => {
    const alcanca = so('entrega');
    // Chat não consulta área: a chave IDEWORKS_CHAT é o freio, na barra.
    expect(itensVisiveis(PADRAO, 'trabalho', alcanca)).toEqual(['chat']);
    expect(secoesVisiveis(PADRAO, alcanca)).toEqual(['trabalho', 'entrega']);
  });

  it('sem parâmetro, nada é escondido — é o que vale enquanto a sessão carrega', () => {
    // Esconder e revelar faz o menu piscar e empurra o botão para debaixo do
    // cursor no instante do clique. Quem recusa de verdade é o servidor.
    // F43 Fase 8: menos a `Gestão`, que é por PAPEL e fica fechada enquanto a
    // sessão carrega (ver `ITENS_SO_ADMIN`) — com o papel, ela volta.
    expect(secoesVisiveis(PADRAO)).toEqual(PADRAO.ordem.filter((s) => s !== 'gestao'));
    expect(secoesVisiveis(PADRAO, undefined, true)).toEqual([...PADRAO.ordem]);
    expect(itensVisiveis(PADRAO, 'entrega')).toEqual(['painel', 'calendario', 'planejamento']);
  });

  it('a escolha da pessoa e a área se somam, e a mais restritiva ganha', () => {
    const p = { ...PADRAO, itens: { ...PADRAO.itens, painel: false } };
    expect(itensVisiveis(p, 'entrega', so('entrega'))).toEqual(['calendario', 'planejamento']);
    expect(itensVisiveis(p, 'entrega', so('quadro'))).toEqual([]);
  });

  it('todo item e toda seção têm área — senão a conta passa por cima de um', () => {
    for (const i of ITENS_DA_BARRA) expect(AREA_DO_ITEM[i], `sem área: ${i}`).toBeTruthy();
    for (const s of SECOES_DA_BARRA) expect(AREA_DA_SECAO[s], `sem área: ${s}`).toBeTruthy();
  });
});

describe('o vocabulário fecha', () => {
  it('todo item pertence a uma seção que existe', () => {
    for (const i of ITENS_DA_BARRA) {
      expect(SECOES_DA_BARRA).toContain(SECAO_DO_ITEM[i]);
    }
  });

  it('todo item tem destino, e nenhum aponta para área que dá 403', () => {
    // Meta, Pessoas e Catálogos são de outras áreas (`src/auth/areas.ts`): um
    // funcionário sem a área levaria 403 ao clicar, que é botão morto com um
    // passo a mais.
    const proibidos = ['/meta', '/pessoas', '/catalogos', '/contas'];
    for (const i of ITENS_DA_BARRA) {
      const destino = DESTINO_DO_ITEM[i];
      expect(destino.startsWith('/')).toBe(true);
      expect(proibidos.some((p) => destino.startsWith(p))).toBe(false);
    }
  });

  it('todo item da lista tem visibilidade no padrão', () => {
    for (const i of ITENS_DA_BARRA) expect(typeof PADRAO.itens[i]).toBe('boolean');
  });
});

/* ─────────────────── a seção Gestão — F43, Fase 8 ─────────────────── */

describe('F43 Fase 8: a seção `Gestão` nasce como o Controle estava', () => {
  /*
    O `Controle da semana` saiu do fim de `Entrega` para uma seção própria. Para
    quem já tinha a barra guardada, a seção nova não é escolha de ninguém: é o
    mesmo item em outra prateleira. Então ela herda da `Entrega` o que a pessoa
    tinha decidido sobre ela — escondida, recolhida — e, gravada a escolha
    própria, a herança acaba.
  */
  /** Texto como a versão de antes gravava: sem `gestao` em lugar nenhum. */
  const semGestao = (extra: Record<string, unknown>) =>
    JSON.stringify({ ...PADRAO, versao: 2, ...extra });

  it('quem escondeu a Entrega não passa a ver a Gestão sem ter pedido', () => {
    const p = lerPreferencias(semGestao({ secoes: { trabalho: true, arvore: true, entrega: false } }));
    expect(p.secoes.gestao).toBe(false);
    expect(lerPreferencias(semGestao({ secoes: { trabalho: true, arvore: true, entrega: true } })).secoes.gestao).toBe(true);
  });

  it('quem recolheu a Entrega encontra a Gestão recolhida também', () => {
    const p = lerPreferencias(semGestao({ recolhidas: { trabalho: false, arvore: false, entrega: true } }));
    expect(p.recolhidas.gestao).toBe(true);
  });

  it('a escolha guardada da própria Gestão ganha da herança', () => {
    const p = lerPreferencias(
      semGestao({
        secoes: { trabalho: true, arvore: true, entrega: false, gestao: true },
        recolhidas: { trabalho: false, arvore: false, entrega: true, gestao: false },
      }),
    );
    expect(p.secoes.gestao).toBe(true);
    expect(p.recolhidas.gestao).toBe(false);
  });

  it('a migração da F28 continua valendo com a seção nova', () => {
    const antigo = JSON.stringify({ ordem: ['trabalho', 'arvore', 'entrega'] });
    expect(lerPreferencias(antigo).ordem).toEqual([...SECOES_DA_BARRA]);
  });

  it('`secaoDeAdmin`: só a Gestão — é ela que o painel esconde de quem não administra', () => {
    expect(SECOES_DA_BARRA.filter(secaoDeAdmin)).toEqual(['gestao']);
  });
});

/* ─────────────────── a árvore numa coluna própria — F29 ─────────────────── */

describe('a árvore numa coluna própria — F29', () => {
  /*
    Um campo novo, `arvoreEmColuna`, nasce em textos que já existem sem ele. A
    leitura precisa lê-los como "dentro da barra" — senão a grade de todo mundo
    abriria uma terceira faixa que ninguém pediu.
  */
  it('de fábrica, a árvore mora dentro da barra', () => {
    expect(PADRAO.arvoreEmColuna).toBe(false);
    expect(lerPreferencias(null).arvoreEmColuna).toBe(false);
  });

  it('⚠️ texto gravado antes do campo (versão 2, sem `arvoreEmColuna`) lê dentro da barra', () => {
    const semOCampo: Record<string, unknown> = { ...PADRAO, aparencia: 'icones', versao: 2 };
    delete semOCampo.arvoreEmColuna;
    const antigo = JSON.stringify(semOCampo);
    expect(antigo).not.toContain('arvoreEmColuna');
    const p = lerPreferencias(antigo);
    expect(p.arvoreEmColuna).toBe(false);
    expect(p.aparencia).toBe('icones');
  });

  it('valor estranho vira dentro da barra, sem estourar', () => {
    for (const lixo of ['"sim"', '1', 'null', '[true]', '{}']) {
      const texto = `{"arvoreEmColuna": ${lixo}}`;
      expect(() => lerPreferencias(texto)).not.toThrow();
      expect(lerPreferencias(texto).arvoreEmColuna).toBe(false);
    }
  });

  it('ligada, volta igual depois de gravar e ler — é o que sobrevive ao F5', () => {
    const minha = alternarArvoreEmColuna(PADRAO);
    expect(lerPreferencias(escreverPreferencias(minha)).arvoreEmColuna).toBe(true);
    // A versão continua 2: a ausência do campo não é ambígua (ver `VERSAO`).
    expect(JSON.parse(escreverPreferencias(minha)).versao).toBe(2);
  });

  it('alternar mexe só nela, duas vezes volta ao começo, e não muda o objeto de quem chamou', () => {
    const ligada = alternarArvoreEmColuna(PADRAO);
    expect(ligada).toEqual({ ...PADRAO, arvoreEmColuna: true });
    expect(alternarArvoreEmColuna(ligada).arvoreEmColuna).toBe(false);
    expect(PADRAO.arvoreEmColuna).toBe(false);
  });

  it('desligada, nunca há coluna', () => {
    expect(arvoreNaColuna(PADRAO)).toBe(false);
  });

  it('ligada e com a barra expandida, há coluna', () => {
    expect(arvoreNaColuna(alternarArvoreEmColuna(PADRAO))).toBe(true);
  });

  /* F02B (R08): ESTE TESTE CODIFICAVA O FECHAMENTO CONJUNTO — "recolher a
     barra esconde a coluna". O Wesley pediu uma coluna de cada vez; a regra
     agora é a oposta, e o teste prova a oposta. */
  it('⚠️ F02B: recolher o MENU não esconde a coluna — uma coluna de cada vez', () => {
    const ligada = alternarArvoreEmColuna(PADRAO);
    const menuRecolhido = alternarAparencia(ligada);
    expect(menuRecolhido.aparencia).toBe('icones');
    expect(arvoreNaColuna(menuRecolhido)).toBe(true);
    // E expandir de novo também não mexe nela.
    expect(arvoreNaColuna(alternarAparencia(menuRecolhido))).toBe(true);
    // Quem esconde a coluna são as LISTAS, e o menu fica como estava.
    const listasRecolhidas = alternarListas(menuRecolhido);
    expect(arvoreNaColuna(listasRecolhidas)).toBe(false);
    expect(listasRecolhidas.aparencia).toBe('icones');
    expect(listasRecolhidas.arvoreEmColuna).toBe(true);
  });

  it('seção escondida em `Personalizar`, ou sem a área do quadro: sem árvore, sem coluna', () => {
    // Senão a grade reservaria 16.5rem para uma coluna que a barra não desenha.
    const ligada = alternarArvoreEmColuna(PADRAO);
    expect(arvoreNaColuna({ ...ligada, secoes: { ...ligada.secoes, arvore: false } })).toBe(false);
    expect(arvoreNaColuna(ligada, (a: Area) => a === 'entrega')).toBe(false);
    expect(arvoreNaColuna(ligada, (a: Area) => a === 'quadro')).toBe(true);
  });
});

/* ─────────── F02B: menu e listas recolhem cada um por si (R08) ─────────── */

describe('F02B: recolher o menu e as listas independentemente', () => {
  const comColuna = { ...PADRAO, arvoreEmColuna: true };
  const combinacoes = [
    { menu: 'icones-e-rotulos', listas: false, coluna: true },
    { menu: 'icones', listas: false, coluna: true },
    { menu: 'icones-e-rotulos', listas: true, coluna: false },
    { menu: 'icones', listas: true, coluna: false },
  ] as const;

  it('de fábrica as listas estão abertas', () => {
    expect(PADRAO.listasRecolhidas).toBe(false);
    expect(lerPreferencias(null).listasRecolhidas).toBe(false);
  });

  for (const { menu, listas, coluna } of combinacoes) {
    it(`menu ${menu} + listas ${listas ? 'recolhidas' : 'abertas'}: coluna ${coluna ? 'sim' : 'não'}, e sobrevive ao F5`, () => {
      const p = { ...comColuna, aparencia: menu, listasRecolhidas: listas };
      expect(arvoreNaColuna(p)).toBe(coluna);
      const relida = lerPreferencias(escreverPreferencias(p));
      expect(relida.aparencia).toBe(menu);
      expect(relida.listasRecolhidas).toBe(listas);
      expect(relida.arvoreEmColuna).toBe(true);
    });
  }

  it('alternar as listas mexe só nelas e não muda o objeto de quem chamou', () => {
    const recolhidas = alternarListas(comColuna);
    expect(recolhidas).toEqual({ ...comColuna, listasRecolhidas: true });
    expect(alternarListas(recolhidas)).toEqual(comColuna);
    expect(comColuna.listasRecolhidas).toBe(false);
  });

  it('o menu alterna sem tocar nas listas, e vice-versa', () => {
    const p = alternarListas(comColuna);
    expect(alternarAparencia(p).listasRecolhidas).toBe(true);
    expect(alternarListas(alternarAparencia(comColuna)).aparencia).toBe('icones');
  });

  it('⚠️ migração: texto antigo com `icones` + coluna lê listas RECOLHIDAS — a tela não muda no F5', () => {
    // Antes da F02B, esse texto desenhava o rail SEM a coluna.
    const antigo = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones', versao: 2 });
    const p = lerPreferencias(antigo);
    expect(p.listasRecolhidas).toBe(true);
    expect(p.aparencia).toBe('icones');
    expect(p.arvoreEmColuna).toBe(true);
    expect(arvoreNaColuna(p)).toBe(false);
  });

  it('migração: todo outro texto antigo lê listas abertas — o que já se via', () => {
    for (const velho of [
      { arvoreEmColuna: true, aparencia: 'icones-e-rotulos', versao: 2 },
      { arvoreEmColuna: false, aparencia: 'icones', versao: 2 },
      { arvoreEmColuna: false, aparencia: 'icones-e-rotulos' },
      {},
    ]) {
      expect(lerPreferencias(JSON.stringify(velho)).listasRecolhidas, JSON.stringify(velho)).toBe(false);
    }
  });

  it('a escolha gravada vence a migração, e valor estranho cai na migração sem estourar', () => {
    const escolhida = JSON.stringify({ arvoreEmColuna: true, aparencia: 'icones', listasRecolhidas: false, versao: 2 });
    expect(lerPreferencias(escolhida).listasRecolhidas).toBe(false);
    for (const lixo of ['"sim"', '1', 'null', '[true]']) {
      expect(lerPreferencias(`{"listasRecolhidas": ${lixo}}`).listasRecolhidas).toBe(false);
    }
  });

  it('a 1024 no trabalho: menu compacto + listas abertas cabe; menu aberto cede a coluna', () => {
    const medida = { contexto: 'trabalho' as const, largura: 1000, vao: 24 };
    const rail = composicaoEfetiva({ ...comColuna, aparencia: 'icones' }, medida);
    expect(rail).toMatchObject({ aparencia: 'icones', arvoreNaColuna: true, adaptada: false });
    // 1000 − 56 − 24 − 264 − 24 = 632 ≥ 560
    expect(rail.conteudo).toBe(632);
    const aberto = composicaoEfetiva(comColuna, medida);
    expect(aberto).toMatchObject({ aparencia: 'icones-e-rotulos', arvoreNaColuna: false, adaptada: true });
  });

  it('as quatro combinações a 1440 no trabalho desenham a escolha, sem adaptar', () => {
    const medida = { contexto: 'trabalho' as const, largura: 1416, vao: 24 };
    for (const { menu, listas, coluna } of combinacoes) {
      const c = composicaoEfetiva({ ...comColuna, aparencia: menu, listasRecolhidas: listas }, medida);
      expect(c).toMatchObject({ aparencia: menu, arvoreNaColuna: coluna, adaptada: false });
    }
  });

  it('no chat a coluna nunca abre, com o menu em qualquer estado — chat protegido', () => {
    for (const aparencia of ['icones', 'icones-e-rotulos'] as const) {
      for (const largura of [1000, 1416, 2400]) {
        const c = composicaoEfetiva({ ...comColuna, aparencia }, { contexto: 'chat', largura, vao: 24 });
        expect(c.arvoreNaColuna).toBe(false);
        expect(c.aparencia).toBe('icones');
      }
    }
  });
});

/* ─────────────── a composição efetiva: adaptar sem gravar — F02 ─────────────── */

describe('F02: o espaço adapta o desenho, e a escolha guardada não muda', () => {
  const comColuna = { ...PADRAO, arvoreEmColuna: true };
  /* A grade de 1024×768: 1024 − 24 de respiro da página = 1000; vão de 24. */
  const ux01 = { contexto: 'chat' as const, largura: 1000, vao: 24 };

  it('UX01 (1024, barra expandida, árvore na coluna, chat): a árvore sai e a barra vira rail', () => {
    const c = composicaoEfetiva(comColuna, ux01);
    expect(c.arvoreNaColuna).toBe(false);
    expect(c.aparencia).toBe('icones');
    expect(c.adaptada).toBe(true);
    // 1000 − 56 − 24 = 920: lista + conversa cabem (≥ 720), longe dos 400 de antes.
    expect(c.conteudo).toBe(920);
    expect(c.conteudo!).toBeGreaterThanOrEqual(720);
  });

  it('adaptar NÃO mexe na escolha: o texto gravado continua o mesmo', () => {
    const antes = escreverPreferencias(comColuna);
    composicaoEfetiva(comColuna, ux01);
    expect(escreverPreferencias(comColuna)).toBe(antes);
    expect(comColuna.aparencia).toBe('icones-e-rotulos');
    expect(comColuna.arvoreEmColuna).toBe(true);
  });

  it('ampliar a janela devolve a barra expandida sem ninguém escolher de novo', () => {
    const larga = composicaoEfetiva(comColuna, { contexto: 'trabalho', largura: 1416, vao: 24 });
    expect(larga.aparencia).toBe('icones-e-rotulos');
    expect(larga.arvoreNaColuna).toBe(true);
    expect(larga.adaptada).toBe(false);
  });

  it('F08: no chat o contexto é a lista de Conversas — rail em qualquer largura, sem gravar', () => {
    for (const largura of [1000, 1416, 2400]) {
      const c = composicaoEfetiva(comColuna, { ...ux01, largura });
      expect(c.aparencia).toBe('icones');
      // A árvore segue recolhida (§3.1), e a preferência continua ligada.
      expect(c.arvoreNaColuna).toBe(false);
      expect(c.adaptada).toBe(true);
      expect(c.conteudo!).toBeGreaterThanOrEqual(720);
    }
    expect(comColuna.aparencia).toBe('icones-e-rotulos');
    // Expandir na mão ainda vale nesta tela; sem medida (gaveta) vale a escolha.
    expect(composicaoEfetiva(comColuna, { ...ux01, largura: 1416, expandidaNaMao: true }).aparencia)
      .toBe('icones-e-rotulos');
    expect(composicaoEfetiva(comColuna, { ...ux01, largura: null }).aparencia).toBe('icones-e-rotulos');
  });

  it('no trabalho a 1024 a coluna volta para a barra, e a barra fica expandida', () => {
    const c = composicaoEfetiva(comColuna, { contexto: 'trabalho', largura: 1000, vao: 24 });
    expect(c.arvoreNaColuna).toBe(false);
    expect(c.aparencia).toBe('icones-e-rotulos');
    expect(c.conteudo).toBe(688);
  });

  it('no trabalho a 1280 a coluna cabe e fica, como a pessoa escolheu', () => {
    const c = composicaoEfetiva(comColuna, { contexto: 'trabalho', largura: 1256, vao: 24 });
    expect(c.arvoreNaColuna).toBe(true);
    expect(c.adaptada).toBe(false);
    expect(c.conteudo!).toBeGreaterThanOrEqual(560);
  });

  it('sem medida (primeiro desenho, gaveta) vale a escolha — retrocompatível', () => {
    const c = composicaoEfetiva(comColuna, { contexto: 'trabalho', largura: null, vao: 0 });
    expect(c).toMatchObject({ aparencia: 'icones-e-rotulos', arvoreNaColuna: true, adaptada: false });
  });

  it('expandida na mão, a barra fica expandida mesmo sem espaço (e o chat se defende sozinho)', () => {
    const c = composicaoEfetiva(PADRAO, { ...ux01, expandidaNaMao: true });
    expect(c.aparencia).toBe('icones-e-rotulos');
    expect(c.conteudo!).toBeLessThan(720);
  });

  it('quem escolheu `Somente ícones` continua com ícones em qualquer largura', () => {
    const icones = { ...PADRAO, aparencia: 'icones' as const };
    for (const largura of [1000, 1416, 2400]) {
      expect(composicaoEfetiva(icones, { contexto: 'chat', largura, vao: 24 }).aparencia).toBe('icones');
    }
  });

  it('sem a área da árvore não há coluna para abrir, nem para ceder', () => {
    const c = composicaoEfetiva(comColuna, { contexto: 'trabalho', largura: 2000, vao: 24 }, () => false);
    expect(c.arvoreNaColuna).toBe(false);
    expect(c.adaptada).toBe(false);
  });

  it('o contexto padrão vem do item aceso', () => {
    expect(contextoDoItem('chat')).toBe('chat');
    expect(contextoDoItem('painel')).toBe('entrega');
    expect(contextoDoItem('calendario')).toBe('entrega');
    expect(contextoDoItem('minhas')).toBe('trabalho');
    expect(contextoDoItem(undefined)).toBe('trabalho');
  });
});
