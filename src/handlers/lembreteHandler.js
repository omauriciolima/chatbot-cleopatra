// Job agendado (cron) responsável por mandar as mensagens automáticas:
//  - ~24h antes do horário marcado, com pedido de confirmação de presença (feature 4)
//  - ~2h antes do horário marcado
//  - ~30min depois do horário marcado, atualizando o status de "confirmado" pra "concluido"
//  - ~2h depois do horário marcado, com pedido de avaliação (feature 10)
//  - todo dia às 10h, com mensagem de saudade pras clientes sumidas (30+ dias sem agendar)
//
// O job de 10 em 10 minutos usa uma janela de +-15min (ver sheetsService) pra não perder
// nem duplicar nenhum envio.

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

    await verificarEAtualizarStatusPosAtendimento();
    await verificarEEnviarPedidosDeFeedback();
  } catch (erro) {
    console.error('Erro ao verificar/enviar lembretes:', erro.message);
  }
}

// ~30min depois do horário marcado, muda o status de "confirmado" pra "concluido".
// Isso evita que uma cliente que não compareceu (e cujo status a manicure não mudou
// manualmente pra "cancelado") continue marcada como "confirmado" pra sempre e acabe
// recebendo o pedido de avaliação 2h depois como se tivesse sido atendida.
async function verificarEAtualizarStatusPosAtendimento() {
  const pendentesConclusao = await sheetsService.buscarAgendamentosPendentesDeConclusao();

  for (const agendamento of pendentesConclusao) {
    await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'concluido');
  }
}

// Feature 10: 2h depois do horário do atendimento, pede pra cliente avaliar de 1 a 5.
async function verificarEEnviarPedidosDeFeedback() {
  const pendentesFeedback = await sheetsService.buscarAgendamentosPendentesDeFeedback();

  for (const agendamento of pendentesFeedback) {
    await zapiService.enviarTexto(
      agendamento.telefone,
      `Olá ${agendamento.nome}! Espero que tenha amado o resultado! 💅\n\n` +
        `Como foi seu atendimento na Cleópatra?\n\n` +
        `⭐ Digite de 1 a 5 para avaliar:\n` +
        `1️⃣ Horrível\n2️⃣ Ruim\n3️⃣ Regular\n4️⃣ Bom\n5️⃣ Excelente! 😍`
    );
    await sheetsService.marcarFeedbackEnviado(agendamento.numeroLinhaSheet);

    // Guarda os dados do atendimento no estado (não só o nome) pra que, se a nota vier
    // baixa (1 ou 2), a manicure seja notificada com o contexto completo (ver clienteHandler).
    const estadoAtual = obterEstado(agendamento.telefone);
    if (estadoAtual.etapa === ETAPAS.INICIO) {
      atualizarEstado(agendamento.telefone, {
        etapa: ETAPAS.AGUARDANDO_AVALIACAO,
        avaliacaoInfo: {
          nome: agendamento.nome,
          servico: agendamento.servico,
          data: agendamento.data,
          horario: agendamento.horario,
        },
      });
    }
  }
}

// Mensagem de saudade: todo dia às 10h, avisa as clientes que não agendam há mais de
// 30 dias, convidando pra marcar um novo horário. Não repete o envio pra mesma cliente
// antes de 30 dias (controlado pela coluna data_envio_saudade, ver sheetsService).
async function verificarEEnviarSaudade() {
  try {
    const clientesSumidas = await sheetsService.buscarClientesSumidas();

    for (const cliente of clientesSumidas) {
      await zapiService.enviarTexto(
        cliente.telefone,
        `Olá ${cliente.nome}! 💙\n` +
          `Sentimos sua falta no ${NOME_SALAO}!\n` +
          `Já faz um tempinho que não te vemos por aqui. 😢\n\n` +
          `Que tal agendar um horário?\n` +
          `É só responder *oi* que eu te ajudo! 💅✨`
      );
      await sheetsService.marcarSaudadeEnviada(cliente.numeroLinhaSheet);
    }
  } catch (erro) {
    console.error('Erro ao verificar/enviar mensagens de saudade:', erro.message);
  }
}

function iniciarAgendador() {
  cron.schedule('*/10 * * * *', verificarEEnviarLembretes, { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 10 * * *', verificarEEnviarSaudade, { timezone: 'America/Sao_Paulo' });
  console.log('Agendador de lembretes iniciado (a cada 10 minutos, saudade todo dia às 10h).');
}

module.exports = {
  iniciarAgendador,
};
