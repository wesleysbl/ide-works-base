import { describe, expect, it } from 'vitest';

import {
  DIAS_DA_JANELA,
  BATIDAS_ATE_ALARME,
  HORAS_ATE_ATRASO,
  MINUTOS_ENTRE_EXECUCOES,
  TETO_DE_USO,
  classificarFalha,
  desfechoDaExecucao,
  devePausar,
  janelaDeColeta,
  lerUso,
  batidasPerdidas,
  saudeDaColeta,
  saudeDoMotor,
} from '@/meta/coleta';

describe('janelaDeColeta', () => {
  const hoje = new Date('2026-08-20T09:00:00Z');

  it('cobre 28 dias contando hoje', () => {
    // Inclusiva nas duas pontas: de 24/07 a 20/08 sao 28 dias, nao 29.
    expect(janelaDeColeta(hoje)).toEqual({ de: '2026-07-24', ate: '2026-08-20' });
  });

  it('termina HOJE, nao ontem', () => {
    // A Meta leva ate 48h para fechar o calculo. O dia corrente vem incompleto
    // e vem de novo, completo, nas proximas execucoes — excluí-lo so atrasaria
    // o painel sem tornar numero nenhum mais correto.
    expect(janelaDeColeta(hoje).ate).toBe('2026-08-20');
  });

  it('ignora a hora do dia', () => {
    const cedo = janelaDeColeta(new Date('2026-08-20T00:01:00Z'));
    const tarde = janelaDeColeta(new Date('2026-08-20T23:59:00Z'));
    expect(cedo).toEqual(tarde);
  });

  it('atravessa a virada de mes e de ano', () => {
    expect(janelaDeColeta(new Date('2027-01-05T12:00:00Z'))).toEqual({
      de: '2026-12-09',
      ate: '2027-01-05',
    });
  });

  it('aceita janela menor quando pedida', () => {
    expect(janelaDeColeta(hoje, 1)).toEqual({ de: '2026-08-20', ate: '2026-08-20' });
    expect(janelaDeColeta(hoje, 7).de).toBe('2026-08-14');
  });

  it('recusa janela invalida em vez de devolver intervalo torto', () => {
    expect(() => janelaDeColeta(hoje, 0)).toThrow(/inválida/);
    expect(() => janelaDeColeta(hoje, -3)).toThrow(/inválida/);
  });

  it('a janela padrao e a que a viabilidade exige', () => {
    expect(DIAS_DA_JANELA).toBe(28);
  });
});

describe('lerUso', () => {
  it('le as duas porcentagens do cabecalho', () => {
    const r = lerUso('{"app_id_util_pct":12.5,"acc_id_util_pct":40}');
    expect(r).toEqual({ app: 12.5, conta: 40 });
  });

  it('cabecalho ausente devolve nulo, e isso NAO e erro', () => {
    // A Meta so manda este cabecalho nas chamadas de insights de anuncio.
    // Tratar ausencia como problema pararia a coleta do organico.
    expect(lerUso(null)).toBeNull();
    expect(lerUso('   ')).toBeNull();
  });

  it('cabecalho ilegivel devolve nulo em vez de quebrar', () => {
    expect(lerUso('nao e json')).toBeNull();
    expect(lerUso('{"outra_coisa":1}')).toBeNull();
  });

  it('preenche com zero a porcentagem que faltar', () => {
    expect(lerUso('{"acc_id_util_pct":30}')).toEqual({ app: 0, conta: 30 });
  });
});

describe('devePausar', () => {
  it('pausa quando qualquer uma das duas passa do teto', () => {
    expect(devePausar({ app: 95, conta: 10 })).toBe(true);
    expect(devePausar({ app: 10, conta: 95 })).toBe(true);
  });

  it('nao pausa abaixo do teto', () => {
    expect(devePausar({ app: 89, conta: 89 })).toBe(false);
  });

  it('pausa exatamente no teto', () => {
    expect(devePausar({ app: TETO_DE_USO, conta: 0 })).toBe(true);
  });

  it('sem leitura de uso, nao pausa', () => {
    expect(devePausar(null)).toBe(false);
  });
});

describe('classificarFalha', () => {
  it('limite manda parar a execucao inteira', () => {
    // Nao melhora no proximo ativo: insistir queima o resto da cota e enche o
    // alarme com a mesma falha repetida.
    const r = classificarFalha({ code: 4, message: 'Application request limit reached' });
    expect(r.tipo).toBe('limite');
    expect(r.deveParar).toBe(true);
  });

  it('token vencido manda parar, e a mensagem diz que precisa de gente', () => {
    const r = classificarFalha({ code: 190, message: 'Error validating access token' });
    expect(r.tipo).toBe('token');
    expect(r.deveParar).toBe(true);
    expect(r.mensagem).toMatch(/renovad/i);
  });

  it('falta de permissao NAO para a execucao: e problema daquela conta', () => {
    const r = classificarFalha({ code: 200, message: 'Permissions error' });
    expect(r.tipo).toBe('permissao');
    expect(r.deveParar).toBe(false);
    expect(r.mensagem).toMatch(/parceiro/i);
  });

  it('distingue metrica que sumiu de consulta recusada', () => {
    const sumiu = classificarFalha({ code: 100, message: '(#100) unknown fields: impressions' });
    expect(sumiu.tipo).toBe('metrica_desconhecida');

    const grande = classificarFalha({ code: 100, message: 'Please reduce the amount of data' });
    expect(grande.tipo).toBe('nao_encontrado');
  });

  it('erro desconhecido nao para a execucao', () => {
    const r = classificarFalha({ code: 999, message: 'algo novo' });
    expect(r.tipo).toBe('outro');
    expect(r.deveParar).toBe(false);
    expect(r.mensagem).toBe('algo novo');
  });

  it('aceita erro que nem parece erro da Meta', () => {
    const r = classificarFalha(new Error('a rede caiu'));
    expect(r.tipo).toBe('outro');
    expect(r.deveParar).toBe(false);
  });
});

describe('desfechoDaExecucao', () => {
  it('tudo certo e ok', () => {
    expect(desfechoDaExecucao(5, 0)).toBe('ok');
  });

  it('parte certa e parte errada e parcial', () => {
    expect(desfechoDaExecucao(3, 2)).toBe('partial');
  });

  it('nenhum sucesso com falhas e falha', () => {
    expect(desfechoDaExecucao(0, 4)).toBe('failed');
  });

  it('ZERO ativos e ok, nao falha', () => {
    // Nao haver o que coletar e estado legitimo: ninguem conectou conta ainda.
    // Marcar como falha faria o alarme tocar todo dia ate o primeiro cliente
    // ser conectado — e alarme que sempre toca e alarme que ninguem le.
    expect(desfechoDaExecucao(0, 0)).toBe('ok');
  });
});

describe('saudeDaColeta — uma conta', () => {
  const agora = new Date('2026-08-20T12:00:00Z');

  it('nunca coletou e um estado proprio', () => {
    expect(saudeDaColeta(null, agora)).toBe('nunca_coletou');
  });

  it('coleta de hoje esta em dia', () => {
    expect(saudeDaColeta('2026-08-20T03:00:00Z', agora)).toBe('em_dia');
  });

  it('tolera mais de uma volta da fila', () => {
    // A volta completa leva ate ~5 horas. Alarmar antes disso marcaria de
    // atrasada uma conta que so ainda nao chegou a vez.
    expect(saudeDaColeta('2026-08-20T04:00:00Z', agora)).toBe('em_dia');
  });

  it('passa a atrasado depois do limite', () => {
    expect(saudeDaColeta('2026-08-19T20:00:00Z', agora)).toBe('atrasado');
  });

  it('o limite e o documentado', () => {
    const noLimite = new Date(agora.getTime() - HORAS_ATE_ATRASO * 3_600_000).toISOString();
    expect(saudeDaColeta(noLimite, agora)).toBe('em_dia');
  });

  it('O APAGAO DE CATORZE HORAS seria pego', () => {
    // Em 2026-08-20 a coleta parou as 17:30 e ficou catorze horas morta. Com o
    // limite antigo de 36 horas, TODA conta continuaria marcada como "em dia"
    // do comeco ao fim. Este teste existe para o numero nao voltar a subir sem
    // alguem se dar conta do que isso apaga.
    const parouEm = '2026-08-20T20:30:00Z';
    const catorzeHorasDepois = new Date('2026-08-21T10:30:00Z');
    expect(saudeDaColeta(parouEm, catorzeHorasDepois)).toBe('atrasado');
  });
});

describe('saudeDoMotor — o sistema, e nao a conta', () => {
  const agora = new Date('2026-08-21T10:00:00Z');
  const atras = (minutos: number) =>
    new Date(agora.getTime() - minutos * 60_000).toISOString();

  it('nunca rodou e um estado proprio', () => {
    // Diferente de "parada": nunca rodou pode ser sistema recem-publicado.
    expect(saudeDoMotor(null, agora)).toBe('nunca_rodou');
  });

  it('a batida mais recente esta em dia', () => {
    expect(saudeDoMotor(atras(5), agora)).toBe('em_dia');
  });

  it('tolera o relogio da nuvem nao ser pontual', () => {
    // A execucao leva minutos e o gatilho nao dispara no segundo exato. Uma
    // batida e meia de folga.
    expect(saudeDoMotor(atras(MINUTOS_ENTRE_EXECUCOES * 1.4), agora)).toBe('em_dia');
  });

  it('uma batida perdida e atraso, nao alarme', () => {
    // Alarme que toca por qualquer coisa e alarme que ninguem le.
    expect(saudeDoMotor(atras(MINUTOS_ENTRE_EXECUCOES * 2), agora)).toBe('atrasada');
  });

  it('quatro batidas perdidas ja e defeito', () => {
    expect(saudeDoMotor(atras(MINUTOS_ENTRE_EXECUCOES * BATIDAS_ATE_ALARME + 1), agora)).toBe(
      'parada',
    );
  });

  it('O APAGAO seria gritado em UMA HORA, e nao em catorze', () => {
    // Esta e a funcao que faltava. `saudeDaColeta` olha a conta, e quando o
    // motor morre todas as contas envelhecem juntas e devagar — cada linha
    // parece aceitavel por horas. So perguntando "quando foi a ultima
    // execucao?" o problema aparece enquanto ainda e pequeno.
    //
    // O NUMERO CAIU DE DUAS HORAS PARA UMA, e nao por caprico: o gatilho passou
    // de trinta para quinze minutos quando a Alma Nove dobrou o numero de
    // contas (F7g). O limite continua sendo QUATRO BATIDAS — o que mudou foi o
    // que uma batida vale. Escrever "duas horas" aqui de novo desamarraria o
    // teste da constante e ele passaria a conferir um numero, nao uma regra.
    const limite = MINUTOS_ENTRE_EXECUCOES * BATIDAS_ATE_ALARME;
    expect(limite).toBe(60);

    // O limite CRAVADO ainda é a quarta batida, e a quarta é a última tolerada
    // — o limite é inclusivo de propósito. O alarme sobe logo depois.
    expect(saudeDoMotor(atras(limite), agora)).toBe('atrasada');
    expect(saudeDoMotor(atras(limite + 1), agora)).toBe('parada');

    // E o apagão de verdade estaria gritando por treze horas, em vez de nada.
    expect(saudeDoMotor(atras(14 * 60), agora)).toBe('parada');
  });
});

describe('batidasPerdidas', () => {
  const agora = new Date('2026-08-21T10:00:00Z');
  const atras = (minutos: number) =>
    new Date(agora.getTime() - minutos * 60_000).toISOString();

  it('em dia nao perdeu nenhuma', () => {
    expect(batidasPerdidas(atras(5), agora)).toBe(0);
  });

  it('conta as batidas que nao aconteceram', () => {
    expect(batidasPerdidas(atras(MINUTOS_ENTRE_EXECUCOES * 3), agora)).toBe(2);
  });

  it('nunca devolve numero negativo', () => {
    expect(batidasPerdidas(atras(0), agora)).toBe(0);
    expect(batidasPerdidas(null, agora)).toBe(0);
  });

  it('o apagao de catorze horas se conta em batidas, e o numero e grande', () => {
    // Escrito a partir da constante, e nao com o numero cravado. Cravar 27 foi
    // o que fez este teste quebrar quando o gatilho passou de trinta para
    // quinze minutos — ele conferia a aritmetica de um intervalo especifico, e
    // nao a regra "quantas batidas cabem no silencio".
    const esperado = Math.floor((14 * 60) / MINUTOS_ENTRE_EXECUCOES) - 1;
    expect(batidasPerdidas(atras(14 * 60), agora)).toBe(esperado);

    // E o que o numero PRECISA ser, independente do intervalo: alto o bastante
    // para ninguem confundir com atraso normal.
    expect(esperado).toBeGreaterThan(BATIDAS_ATE_ALARME * 5);
  });
});
