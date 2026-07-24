// Job agendado (cron) responsável por mandar os lembretes automáticos:
//  - ~24h antes do horário marcado
//  - ~2h antes do horário marcado
//
// Roda a cada 10 minutos e usa uma janela de +-15min (ver sheetsService) pra não
// perder nem duplicar nenhum envio.

const cron = require('node-cron');
const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');

const NOME_SALAO = process.env.NOME_SALAO || 'Espaço Cleópatra';

async function verificarEEnviarLembretes() {
  try {
    const { pendentes24h, pendentes2h } = await sheetsService.buscarAgendamentosPendentesDeLembrete();

    for (const agendamento of pendentes24h) {
      await zapiService.enviarTexto(
        agendamento.telefone,
        `Oii ${agendamento.nome}! Passando pra lembrar do seu horário amanhã no *${NOME_SALAO}* 💅\n\n` +
          `📅 ${agendamento.data} às ${agendamento.horario}\n💅 ${agendamento.servico}\n\nAté lá! ✨`
      );
      await sheetsService.marcarLembreteEnviado(agendamento.numeroLinhaSheet, '24h');
    }

    for (const agendamento of pendentes2h) {
      await zapiService.enviarTexto(
        agendamento.telefone,
        `${agendamento.nome}, seu horário no *${NOME_SALAO}* é daqui a 2 horinhas! ⏰\n\n` +
          `📅 ${agendamento.data} às ${agendamento.horario}\n💅 ${agendamento.servico}\n\nTe esperamos! 💕`
      );
      await sheetsService.marcarLembreteEnviado(agendamento.numeroLinhaSheet, '2h');
    }
  } catch (erro) {
    console.error('Erro ao verificar/enviar lembretes:', erro.message);
  }
}

function iniciarAgendador() {
  cron.schedule('*/10 * * * *', verificarEEnviarLembretes, { timezone: 'America/Sao_Paulo' });
  console.log('Agendador de lembretes iniciado (a cada 10 minutos).');
}

module.exports = {
  iniciarAgendador,
};
