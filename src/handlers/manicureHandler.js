// Comandos administrativos, usados apenas pelo número da manicure (dono(a) do salão).

const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');
const { normalizarTexto } = require('../utils/textoUtils');
const { agora, formatarISO, formatarBR } = require('../utils/dateUtils');

const MENSAGEM_AJUDA =
  'Comandos disponíveis:\n\n' +
  '📋 *agenda hoje* — lista os agendamentos de hoje\n' +
  '📋 *agenda amanhã* — lista os agendamentos de amanhã\n' +
  '❌ *cancelar [nome]* — cancela o próximo agendamento dessa cliente\n' +
  '⏰ *atraso [minutos]min* — avisa todas as clientes de hoje sobre um atraso';

async function tratarMensagem(telefone, texto) {
  const textoNormalizado = normalizarTexto(texto);

  if (textoNormalizado === 'agenda hoje') {
    await enviarAgendaDoDia(telefone, formatarBR(dataDeHoje()), 'hoje');
    return;
  }

  if (['agenda amanha', 'agenda amanhã'].includes(textoNormalizado)) {
    await enviarAgendaDoDia(telefone, formatarBR(dataDeAmanha()), 'amanhã');
    return;
  }

  if (textoNormalizado.startsWith('cancelar ')) {
    const nome = texto.trim().slice('cancelar '.length).trim();
    await cancelarAgendamento(telefone, nome);
    return;
  }

  // Feature 9: manicure digita algo como "atraso 15min" e o bot avisa as clientes de hoje.
  if (textoNormalizado.startsWith('atraso')) {
    const minutosEncontrados = texto.match(/(\d+)/);
    const minutos = minutosEncontrados ? parseInt(minutosEncontrados[1], 10) : null;
    await avisarAtraso(telefone, minutos);
    return;
  }

  await zapiService.enviarTexto(telefone, MENSAGEM_AJUDA);
}

function dataDeHoje() {
  const data = agora();
  data.setHours(0, 0, 0, 0);
  return formatarISO(data);
}

function dataDeAmanha() {
  const data = agora();
  data.setHours(0, 0, 0, 0);
  data.setDate(data.getDate() + 1);
  return formatarISO(data);
}

async function enviarAgendaDoDia(telefone, dataBR, rotulo) {
  const agendamentos = await sheetsService.listarAgendamentosPorData(dataBR);

  if (agendamentos.length === 0) {
    await zapiService.enviarTexto(telefone, `Nenhum agendamento para ${rotulo} (${dataBR}). 🗓️`);
    return;
  }

  const linhas = agendamentos.map(
    (agendamento) => `⏰ ${agendamento.horario} — ${agendamento.nome} (${agendamento.servico})`
  );

  await zapiService.enviarTexto(
    telefone,
    `Agenda de ${rotulo} (${dataBR}):\n\n${linhas.join('\n')}`
  );
}

async function cancelarAgendamento(telefone, nome) {
  if (!nome) {
    await zapiService.enviarTexto(telefone, 'Me diz o nome da cliente, assim: *cancelar Maria*');
    return;
  }

  const cancelado = await sheetsService.cancelarAgendamentoPorNome(nome);

  if (!cancelado) {
    await zapiService.enviarTexto(telefone, `Não encontrei nenhum agendamento confirmado para "${nome}".`);
    return;
  }

  await zapiService.enviarTexto(
    telefone,
    `Cancelado ✅\n${cancelado.nome} — ${cancelado.servico} em ${cancelado.data} às ${cancelado.horario}`
  );

  // Avisa a cliente também, já que o cancelamento partiu da manicure.
  await zapiService.enviarTexto(
    cancelado.telefone,
    `Oii ${cancelado.nome}, seu agendamento de ${cancelado.data} às ${cancelado.horario} foi cancelado. Qualquer coisa, me chama pra remarcar! 💕`
  );
}

// Feature 9: avisa todas as clientes com agendamento confirmado hoje sobre o atraso.
async function avisarAtraso(telefoneManicure, minutos) {
  if (!minutos) {
    await zapiService.enviarTexto(telefoneManicure, 'Me diz quantos minutos de atraso, assim: *atraso 15min*');
    return;
  }

  const agendamentosHoje = await sheetsService.listarAgendamentosPorData(formatarBR(dataDeHoje()));

  if (agendamentosHoje.length === 0) {
    await zapiService.enviarTexto(telefoneManicure, 'Não há agendamentos hoje pra avisar 🙂');
    return;
  }

  for (const agendamento of agendamentosHoje) {
    await zapiService.enviarTexto(
      agendamento.telefone,
      `Olá ${agendamento.nome}! A Cleópatra me pediu para avisar que está com ${minutos} minutos de atraso. Pedimos desculpas! 🙏`
    );
  }

  await zapiService.enviarTexto(
    telefoneManicure,
    `Avisei ${agendamentosHoje.length} cliente(s) sobre o atraso de ${minutos} minutos ✅`
  );
}

module.exports = {
  tratarMensagem,
};
