// Comandos administrativos, usados apenas pelo número da manicure (dono(a) do salão).
//
// Além dos comandos simples (agenda hoje/amanhã, cancelar [nome], atraso), este arquivo tem
// comandos que envolvem uma etapa de confirmação antes de agir (cancelar dia inteiro, cancelar
// horário específico, cancelar por nome, folga e férias). Para isso reaproveitamos o mesmo
// stateManager usado no fluxo da cliente: cada telefone (inclusive o da manicure) tem seu
// próprio estado guardado em memória, então dá pra "pausar" o comando administrativo esperando
// a resposta de confirmação (1-Sim / 2-Não) antes de mexer na planilha.

const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');
const { normalizarTexto, interpretarEscolha } = require('../utils/textoUtils');
const { agora, formatarISO, formatarBR, listarDatasEntre } = require('../utils/dateUtils');
const { ETAPAS, obterEstado, atualizarEstado, limparEstado } = require('../utils/stateManager');

// Etapas de confirmação específicas dos comandos administrativos (não fazem parte do
// stateManager.ETAPAS porque só existem na conversa com o telefone da manicure).
const ETAPA_CONFIRMAR_CANCELAR_DIA = 'MANICURE_CONFIRMAR_CANCELAR_DIA';
const ETAPA_CONFIRMAR_CANCELAR_HORA = 'MANICURE_CONFIRMAR_CANCELAR_HORA';
const ETAPA_CONFIRMAR_CANCELAR_NOME = 'MANICURE_CONFIRMAR_CANCELAR_NOME';
const ETAPA_CONFIRMAR_FOLGA = 'MANICURE_CONFIRMAR_FOLGA';
const ETAPA_CONFIRMAR_FERIAS = 'MANICURE_CONFIRMAR_FERIAS';

const OPCOES_SIM_NAO = ['Sim', 'Não'];

const MENSAGEM_AJUDA =
  'Comandos disponíveis:\n\n' +
  '📋 *agenda hoje* — lista os agendamentos de hoje\n' +
  '📋 *agenda amanhã* — lista os agendamentos de amanhã\n' +
  '❌ *cancelar [nome]* — cancela o próximo agendamento dessa cliente (com confirmação)\n' +
  '❌ *cancelar dia DD/MM* — cancela todos os agendamentos do dia e avisa as clientes\n' +
  '❌ *cancelar hora HH:MM [DD/MM]* — cancela um horário específico (padrão: hoje)\n' +
  '🚫 *folga DD/MM* — bloqueia o dia e cancela/avisa quem já tinha agendado\n' +
  '🏖️ *ferias DD/MM ate DD/MM* — bloqueia o período e cancela/avisa quem já tinha agendado\n' +
  '⏰ *atraso [minutos]min* — avisa todas as clientes de hoje sobre um atraso';

async function tratarMensagem(telefone, texto) {
  const estado = obterEstado(telefone);

  switch (estado.etapa) {
    case ETAPA_CONFIRMAR_CANCELAR_DIA:
      await confirmarCancelamentoDia(telefone, texto);
      return;
    case ETAPA_CONFIRMAR_CANCELAR_HORA:
      await confirmarCancelamentoHora(telefone, texto);
      return;
    case ETAPA_CONFIRMAR_CANCELAR_NOME:
      await confirmarCancelamentoNome(telefone, texto);
      return;
    case ETAPA_CONFIRMAR_FOLGA:
      await confirmarFolga(telefone, texto);
      return;
    case ETAPA_CONFIRMAR_FERIAS:
      await confirmarFerias(telefone, texto);
      return;
    default:
      break;
  }

  const textoNormalizado = normalizarTexto(texto);

  if (textoNormalizado === 'agenda hoje') {
    await enviarAgendaDoDia(telefone, formatarBR(dataDeHoje()), 'hoje');
    return;
  }

  if (['agenda amanha', 'agenda amanhã'].includes(textoNormalizado)) {
    await enviarAgendaDoDia(telefone, formatarBR(dataDeAmanha()), 'amanhã');
    return;
  }

  const matchCancelarDia = textoNormalizado.match(/^cancelar dia (\d{1,2}\/\d{1,2})$/);
  if (matchCancelarDia) {
    await iniciarCancelamentoDia(telefone, matchCancelarDia[1]);
    return;
  }

  const matchCancelarHora = textoNormalizado.match(/^cancelar hora (\d{1,2}:\d{2})(?:\s+(\d{1,2}\/\d{1,2}))?$/);
  if (matchCancelarHora) {
    await iniciarCancelamentoHora(telefone, matchCancelarHora[1], matchCancelarHora[2]);
    return;
  }

  if (textoNormalizado.startsWith('cancelar ')) {
    const nome = texto.trim().slice('cancelar '.length).trim();
    await iniciarCancelamentoPorNome(telefone, nome);
    return;
  }

  const matchFolga = textoNormalizado.match(/^folga (\d{1,2}\/\d{1,2})$/);
  if (matchFolga) {
    await iniciarFolga(telefone, matchFolga[1]);
    return;
  }

  const matchFerias = textoNormalizado.match(/^ferias (\d{1,2}\/\d{1,2}) ate (\d{1,2}\/\d{1,2})$/);
  if (matchFerias) {
    await iniciarFerias(telefone, matchFerias[1], matchFerias[2]);
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

function dataDeHojeInfo() {
  const dataISO = dataDeHoje();
  return { dataISO, dataBR: formatarBR(dataISO) };
}

// Interpreta um texto "DD/MM" digitado pela manicure, assumindo o ano corrente (ou o
// próximo ano, se a data já tiver passado esse ano). Retorna null se a data for inválida.
function parseDataDDMM(textoData) {
  const match = (textoData || '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const dia = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);

  const hoje = agora();
  hoje.setHours(0, 0, 0, 0);

  let candidato = new Date(hoje.getFullYear(), mes - 1, dia);
  // Se o JS "estourou" o dia/mês pra frente (ex: 31/02 vira 03/03), a data digitada é inválida.
  if (candidato.getDate() !== dia || candidato.getMonth() !== mes - 1) return null;

  if (candidato < hoje) {
    candidato = new Date(hoje.getFullYear() + 1, mes - 1, dia);
  }

  const dataISO = formatarISO(candidato);
  return { dataISO, dataBR: formatarBR(dataISO) };
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

// Notifica a cliente sobre um cancelamento feito pela manicure e já deixa a conversa dela
// pronta para responder "1" (reagendar, reabrindo o fluxo normal de agendamento a partir da
// escolha de serviço) ou "2" (não por enquanto) — ver ETAPAS.AGUARDANDO_REAGENDAR_APOS_CANCELAMENTO
// e o tratamento dela em clienteHandler.js.
async function avisarCancelamentoEPerguntarReagendamento(agendamento, mensagem) {
  atualizarEstado(agendamento.telefone, {
    etapa: ETAPAS.AGUARDANDO_REAGENDAR_APOS_CANCELAMENTO,
    nome: agendamento.nome,
  });

  await zapiService.enviarOpcoes(
    agendamento.telefone,
    mensagem,
    ['Sim, quero reagendar', 'Não por enquanto'],
    'Reagendar',
    'Responder'
  );
}

// ---------------------------------------------------------------------------------------
// Comando 1: "cancelar dia DD/MM" — cancela todos os agendamentos confirmados do dia.
// ---------------------------------------------------------------------------------------

async function iniciarCancelamentoDia(telefone, dataTexto) {
  const dataInfo = parseDataDDMM(dataTexto);
  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, 'Não entendi a data 🙏 Manda assim: *cancelar dia 25/12*');
    return;
  }

  const agendamentos = await sheetsService.listarAgendamentosPorData(dataInfo.dataBR);

  if (agendamentos.length === 0) {
    await zapiService.enviarTexto(telefone, `Não há agendamentos confirmados para ${dataInfo.dataBR}.`);
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPA_CONFIRMAR_CANCELAR_DIA, dataBR: dataInfo.dataBR, agendamentos });

  await zapiService.enviarOpcoes(
    telefone,
    `Encontrei ${agendamentos.length} agendamento(s) para ${dataInfo.dataBR}.\n` +
      `Confirma o cancelamento e aviso para todas as clientes?`,
    OPCOES_SIM_NAO,
    'Confirmação',
    'Responder'
  );
}

async function confirmarCancelamentoDia(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra sim ou *2* pra não.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, não cancelei nada 🙂');
    return;
  }

  const { dataBR, agendamentos } = estado;
  limparEstado(telefone);

  for (const agendamento of agendamentos) {
    await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');
    await avisarCancelamentoEPerguntarReagendamento(
      agendamento,
      `Olá ${agendamento.nome}! 💙\nA Cleópatra precisou cancelar os atendimentos de ${dataBR}.\n` +
        `Pedimos desculpas pelo transtorno! 🙏\nQuer reagendar?`
    );
  }

  await zapiService.enviarTexto(
    telefone,
    `Prontinho! Cancelei ${agendamentos.length} agendamento(s) de ${dataBR} e avisei as clientes ✅`
  );
}

// ---------------------------------------------------------------------------------------
// Comando 2: "cancelar hora HH:MM [DD/MM]" — cancela um horário específico (hoje por padrão).
// ---------------------------------------------------------------------------------------

async function iniciarCancelamentoHora(telefone, horario, dataTexto) {
  const dataInfo = dataTexto ? parseDataDDMM(dataTexto) : dataDeHojeInfo();

  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, 'Não entendi a data 🙏 Manda assim: *cancelar hora 14:00 25/12*');
    return;
  }

  const agendamento = await sheetsService.buscarAgendamentoPorHorario(dataInfo.dataBR, horario);

  if (!agendamento) {
    await zapiService.enviarTexto(
      telefone,
      `Não encontrei agendamento confirmado às ${horario} em ${dataInfo.dataBR}.`
    );
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPA_CONFIRMAR_CANCELAR_HORA, agendamento });

  await zapiService.enviarOpcoes(
    telefone,
    `Encontrei: ${agendamento.nome} — ${agendamento.servico} em ${agendamento.data} às ${agendamento.horario}.\n` +
      `Confirma o cancelamento?`,
    OPCOES_SIM_NAO,
    'Confirmação',
    'Responder'
  );
}

async function confirmarCancelamentoHora(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra sim ou *2* pra não.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, não cancelei nada 🙂');
    return;
  }

  const { agendamento } = estado;
  limparEstado(telefone);

  await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');
  await avisarCancelamentoEPerguntarReagendamento(
    agendamento,
    `Olá ${agendamento.nome}! 💙\nPrecisamos cancelar seu horário de ${agendamento.data} às ${agendamento.horario}.\n` +
      `Pedimos desculpas! 🙏\nQuer reagendar?`
  );

  await zapiService.enviarTexto(telefone, `Cancelado ✅ Avisei ${agendamento.nome}.`);
}

// ---------------------------------------------------------------------------------------
// Comando 3: "cancelar [nome]" — cancela o próximo agendamento futuro dessa cliente.
// ---------------------------------------------------------------------------------------

async function iniciarCancelamentoPorNome(telefone, nome) {
  if (!nome) {
    await zapiService.enviarTexto(telefone, 'Me diz o nome da cliente, assim: *cancelar Maria*');
    return;
  }

  const agendamento = await sheetsService.buscarProximoAgendamentoPorNome(nome);

  if (!agendamento) {
    await zapiService.enviarTexto(telefone, `Não encontrei nenhum agendamento confirmado para "${nome}".`);
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPA_CONFIRMAR_CANCELAR_NOME, agendamento });

  await zapiService.enviarOpcoes(
    telefone,
    `Encontrei: ${agendamento.nome} — ${agendamento.servico} em ${agendamento.data} às ${agendamento.horario}.\n` +
      `Confirma o cancelamento?`,
    OPCOES_SIM_NAO,
    'Confirmação',
    'Responder'
  );
}

async function confirmarCancelamentoNome(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra sim ou *2* pra não.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, não cancelei nada 🙂');
    return;
  }

  const { agendamento } = estado;
  limparEstado(telefone);

  await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');
  await avisarCancelamentoEPerguntarReagendamento(
    agendamento,
    `Olá ${agendamento.nome}! 💙\nPrecisamos cancelar seu horário de ${agendamento.data} às ${agendamento.horario}.\n` +
      `Pedimos desculpas! 🙏\nQuer reagendar?`
  );

  await zapiService.enviarTexto(telefone, `Cancelado ✅ Avisei ${agendamento.nome}.`);
}

// ---------------------------------------------------------------------------------------
// Comando 4: "folga DD/MM" — bloqueia o dia inteiro (aba Dias_Bloqueados) e, se houver
// agendamentos, cancela e avisa as clientes.
// ---------------------------------------------------------------------------------------

async function iniciarFolga(telefone, dataTexto) {
  const dataInfo = parseDataDDMM(dataTexto);
  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, 'Não entendi a data 🙏 Manda assim: *folga 25/12*');
    return;
  }

  const agendamentos = await sheetsService.listarAgendamentosPorData(dataInfo.dataBR);
  atualizarEstado(telefone, { etapa: ETAPA_CONFIRMAR_FOLGA, dataBR: dataInfo.dataBR, agendamentos });

  const mensagem =
    agendamentos.length > 0
      ? `Encontrei ${agendamentos.length} agendamento(s) para ${dataInfo.dataBR}.\n` +
        `Quer bloquear o dia, cancelar esses agendamentos e avisar as clientes?`
      : `Não há agendamentos para ${dataInfo.dataBR}. Confirma o bloqueio do dia?`;

  await zapiService.enviarOpcoes(telefone, mensagem, OPCOES_SIM_NAO, 'Confirmação', 'Responder');
}

async function confirmarFolga(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra sim ou *2* pra não.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, não bloqueei nada 🙂');
    return;
  }

  const { dataBR, agendamentos } = estado;
  limparEstado(telefone);

  await sheetsService.bloquearData(dataBR, 'folga');

  for (const agendamento of agendamentos) {
    await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');
    await avisarCancelamentoEPerguntarReagendamento(
      agendamento,
      `Olá ${agendamento.nome}! 💙\nO Espaço Cleópatra estará fechado no dia ${dataBR}.\n` +
        `Seu agendamento foi cancelado.\nQuer remarcar para outro dia?`
    );
  }

  const resumoClientes = agendamentos.length > 0 ? ` e avisei ${agendamentos.length} cliente(s)` : '';
  await zapiService.enviarTexto(telefone, `Dia ${dataBR} bloqueado${resumoClientes} ✅`);
}

// ---------------------------------------------------------------------------------------
// Comando 5: "ferias DD/MM ate DD/MM" — bloqueia o período inteiro e cancela/avisa quem
// já tinha agendamento dentro dele.
// ---------------------------------------------------------------------------------------

async function iniciarFerias(telefone, dataInicioTexto, dataFimTexto) {
  const inicioInfo = parseDataDDMM(dataInicioTexto);
  const fimInfo = parseDataDDMM(dataFimTexto);

  if (!inicioInfo || !fimInfo) {
    await zapiService.enviarTexto(telefone, 'Não entendi as datas 🙏 Manda assim: *ferias 20/12 ate 05/01*');
    return;
  }

  if (fimInfo.dataISO < inicioInfo.dataISO) {
    await zapiService.enviarTexto(telefone, 'A data final precisa ser igual ou depois da data inicial 🙏');
    return;
  }

  const agendamentos = await sheetsService.listarAgendamentosEntreDatas(inicioInfo.dataISO, fimInfo.dataISO);

  atualizarEstado(telefone, {
    etapa: ETAPA_CONFIRMAR_FERIAS,
    dataInicioBR: inicioInfo.dataBR,
    dataFimBR: fimInfo.dataBR,
    dataInicioISO: inicioInfo.dataISO,
    dataFimISO: fimInfo.dataISO,
    agendamentos,
  });

  const avisoAgendamentos =
    agendamentos.length > 0
      ? `Encontrei ${agendamentos.length} agendamento(s) nesse período, que serão cancelados e as clientes avisadas.`
      : 'Não há agendamentos nesse período.';

  await zapiService.enviarOpcoes(
    telefone,
    `Vou bloquear de ${inicioInfo.dataBR} até ${fimInfo.dataBR}.\n${avisoAgendamentos}\nConfirma?`,
    OPCOES_SIM_NAO,
    'Confirmação',
    'Responder'
  );
}

async function confirmarFerias(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra sim ou *2* pra não.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, não bloqueei nada 🙂');
    return;
  }

  const { dataInicioBR, dataFimBR, dataInicioISO, dataFimISO, agendamentos } = estado;
  limparEstado(telefone);

  const datasDoPeriodo = listarDatasEntre(dataInicioISO, dataFimISO);
  for (const dataISO of datasDoPeriodo) {
    await sheetsService.bloquearData(formatarBR(dataISO), 'ferias');
  }

  for (const agendamento of agendamentos) {
    await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');
    await avisarCancelamentoEPerguntarReagendamento(
      agendamento,
      `Olá ${agendamento.nome}! 💙\nO Espaço Cleópatra estará de férias entre ${dataInicioBR} e ${dataFimBR}.\n` +
        `Seu agendamento foi cancelado.\nQuer remarcar para outro dia?`
    );
  }

  await zapiService.enviarTexto(
    telefone,
    `Período de ${dataInicioBR} até ${dataFimBR} bloqueado e ${agendamentos.length} cliente(s) avisada(s) ✅`
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
