// Job agendado (cron) responsável por mandar as mensagens automáticas:
//  - ~24h antes do horário marcado, com pedido de confirmação de presença (feature 4)
//  - ~2h antes do horário marcado
//  - ~2h depois do horário marcado, com pedido de avaliação (feature 10)
//
// Roda a cada 10 minutos e usa uma janela de +-15min (ver sheetsService) pra não
// perder nem duplicar nenhum envio.

const cron = require('node-cron');
const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');
const { ETAPAS, obterEstado, atualizarEstado } = require('../utils/stateManager');

const NOME_SALAO = process.env.NOME_SALAO || 'Espaço Cleópatra';

async function verificarEEnviarLembretes() {
  try {
    const { pendentes24h, pendentes2h } = await sheetsService.buscarAgendamentosPendentesDeLembrete();

    for (const agendamento of pendentes24h) {
      await zapiService.enviarTexto(
        agendamento.telefone,
        `Oii ${agendamento.nome}! Passando pra lembrar do seu horário amanhã no *${NOME_SALAO}* 💅\n\n` +
          `📅 ${agendamento.data} às ${agendamento.horario}\n💅 ${agendamento.servico}\n\n` +
          `Você confirma seu horário amanhã às ${agendamento.horario}? Responde *1* para SIM ou *2* para NÃO`
      );
      await sheetsService.marcarLembreteEnviado(agendamento.numeroLinhaSheet, '24h');

      // Feature 4: só assume que a próxima mensagem da cliente é a resposta da confirmação
      // se ela não estiver em algum outro fluxo em andamento (ex: já agendando outro horário).
      const estadoAtual = obterEstado(agendamento.telefone);
      if (estadoAtual.etapa === ETAPAS.INICIO) {
        atualizarEstado(agendamento.telefone, {
          etapa: ETAPAS.AGUARDANDO_CONFIRMACAO_PRESENCA,
          confirmacaoPresenca: {
            numeroLinhaSheet: agendamento.numeroLinhaSheet,
            nome: agendamento.nome,
            data: agendamento.data,
            horario: agendamento.horario,
          },
        });
      }
    }

    for (const agendamento of pendentes2h) {
      await zapiService.enviarTexto(
        agendamento.telefone,
        `${agendamento.nome}, seu horário no *${NOME_SALAO}* é daqui a 2 horinhas! ⏰\n\n` +
          `📅 ${agendamento.data} às ${agendamento.horario}\n💅 ${agendamento.servico}\n\nTe esperamos! 💕`
      );
      await sheetsService.marcarLembreteEnviado(agendamento.numeroLinhaSheet, '2h');
    }

    await verificarEEnviarPedidosDeFeedback();
  } catch (erro) {
    console.error('Erro ao verificar/enviar lembretes:', erro.message);
  }
}

// Feature 10: 2h depois do horário do atendimento, pede pra cliente avaliar de 1 a 5.
async function verificarEEnviarPedidosDeFeedback() {
  const pendentesFeedback = await sheetsService.buscarAgendamentosPendentesDeFeedback();

  for (const agendamento of pendentesFeedback) {
    await zapiService.enviarTexto(
      agendamento.telefone,
      `Olá ${agendamento.nome}! Espero que tenha amado o resultado 💅\n` +
        `Como foi seu atendimento na Cleópatra?\n⭐ Digite de 1 a 5 para avaliar`
    );
    await sheetsService.marcarFeedbackEnviado(agendamento.numeroLinhaSheet);

    const estadoAtual = obterEstado(agendamento.telefone);
    if (estadoAtual.etapa === ETAPAS.INICIO) {
      atualizarEstado(agendamento.telefone, {
        etapa: ETAPAS.AGUARDANDO_AVALIACAO,
        avaliacaoNome: agendamento.nome,
      });
    }
  }
}

function iniciarAgendador() {
  cron.schedule('*/10 * * * *', verificarEEnviarLembretes, { timezone: 'America/Sao_Paulo' });
  console.log('Agendador de lembretes iniciado (a cada 10 minutos).');
}

module.exports = {
  iniciarAgendador,
};
