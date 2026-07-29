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
const { normalizarTexto, interpretarEscolha, sortearFrase, FRASES_NAO_ENTENDI } = require('../utils/textoUtils');
const { agora, formatarISO, formatarBR, listarDatasEntre } = require('../utils/dateUtils');
const { ETAPAS, obterEstado, atualizarEstado, limparEstado } = require('../utils/stateManager');
const { SERVICOS, SERVICOS_PRECOS, SERVICOS_EMOJI } = require('../config/servicos');

// Etapas de confirmação específicas dos comandos administrativos (não fazem parte do
// stateManager.ETAPAS porque só existem na conversa com o telefone da manicure).
const ETAPA_CONFIRMAR_CANCELAR_DIA = 'MANICURE_CONFIRMAR_CANCELAR_DIA';
const ETAPA_CONFIRMAR_CANCELAR_HORA = 'MANICURE_CONFIRMAR_CANCELAR_HORA';
const ETAPA_CONFIRMAR_CANCELAR_NOME = 'MANICURE_CONFIRMAR_CANCELAR_NOME';
const ETAPA_CONFIRMAR_FOLGA = 'MANICURE_CONFIRMAR_FOLGA';
const ETAPA_CONFIRMAR_FERIAS = 'MANICURE_CONFIRMAR_FERIAS';
// Comando "bloquear HH:MM": depois de bloquear, se havia cliente agendada nesse horário,
// pergunta se quer cancelar o agendamento dela também.
const ETAPA_CONFIRMAR_CANCELAR_APOS_BLOQUEIO = 'MANICURE_CONFIRMAR_CANCELAR_APOS_BLOQUEIO';

const OPCOES_SIM_NAO = ['Sim', 'Não'];

const MENSAGEM_AJUDA =
  'Comandos disponíveis:\n\n' +
  '📋 *agenda hoje* — lista os agendamentos de hoje\n' +
  '📋 *agenda amanhã* — lista os agendamentos de amanhã\n' +
  '📅 *agenda DD/MM* — lista todos os agendamentos de uma data\n' +
  '❌ *cancelar [nome]* — cancela o próximo agendamento dessa cliente (com confirmação)\n' +
  '❌ *cancelar dia DD/MM* — cancela todos os agendamentos do dia e avisa as clientes\n' +
  '❌ *cancelar hora HH:MM [DD/MM]* — cancela um horário específico (padrão: hoje)\n' +
  '🚫 *folga DD/MM* — bloqueia o dia e cancela/avisa quem já tinha agendado\n' +
  '🏖️ *ferias DD/MM ate DD/MM* — bloqueia o período e cancela/avisa quem já tinha agendado\n' +
  '🔒 *bloquear HH:MM [DD/MM]* — bloqueia um horário específico (padrão: hoje)\n' +
  '🔓 *liberar HH:MM [DD/MM]* — libera um horário bloqueado (padrão: hoje)\n' +
  '🔍 *buscar [nome]* — mostra o histórico completo de uma cliente\n' +
  '📝 *nota [nome] [texto]* — salva uma observação sobre a cliente\n' +
  '💰 *faturamento hoje/semana/mes* — resumo de receita do período\n' +
  '👥 *clientes* — lista todas as clientes cadastradas\n' +
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
    case ETAPA_CONFIRMAR_CANCELAR_APOS_BLOQUEIO:
      await confirmarCancelarAposBloqueio(telefone, texto);
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

  const matchAgendaData = textoNormalizado.match(/^agenda (\d{1,2}\/\d{1,2})$/);
  if (matchAgendaData) {
    await enviarAgendaPorData(telefone, matchAgendaData[1]);
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

  const matchBloquear = textoNormalizado.match(/^bloquear (\d{1,2}:\d{2})(?:\s+(\d{1,2}\/\d{1,2}))?$/);
  if (matchBloquear) {
    await iniciarBloquearHorario(telefone, matchBloquear[1], matchBloquear[2]);
    return;
  }

  const matchLiberar = textoNormalizado.match(/^liberar (\d{1,2}:\d{2})(?:\s+(\d{1,2}\/\d{1,2}))?$/);
  if (matchLiberar) {
    await liberarHorario(telefone, matchLiberar[1], matchLiberar[2]);
    return;
  }

  if (textoNormalizado.startsWith('buscar ')) {
    const nome = texto.trim().slice('buscar '.length).trim();
    await buscarClienteDetalhado(telefone, nome);
    return;
  }

  if (textoNormalizado.startsWith('nota ')) {
    const resto = texto.trim().slice('nota '.length).trim();
    // Assume que a primeira palavra depois de "nota" é o nome (uma palavra só) da cliente, e
    // o restante é o texto da observação — não dá pra distinguir "nome composto" de "texto"
    // sem algum delimitador, e o comando não define um.
    const [nomeBusca, ...palavrasNota] = resto.split(/\s+/).filter(Boolean);
    const nota = palavrasNota.join(' ');
    await adicionarObservacao(telefone, nomeBusca, nota);
    return;
  }

  const matchFaturamento = textoNormalizado.match(/^faturamento (hoje|semana|mes)$/);
  if (matchFaturamento) {
    await enviarFaturamento(telefone, matchFaturamento[1]);
    return;
  }

  if (textoNormalizado === 'clientes') {
    await listarClientes(telefone);
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

// Comando "agenda DD/MM": igual à agenda de hoje/amanhã, mas para qualquer data e mostrando
// TODOS os status (inclusive cancelados), não só os confirmados.
async function enviarAgendaPorData(telefone, dataTexto) {
  const dataInfo = parseDataDDMM(dataTexto);
  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *agenda 25/12*`);
    return;
  }

  const agendamentos = await sheetsService.listarTodosAgendamentosPorData(dataInfo.dataBR);

  if (agendamentos.length === 0) {
    await zapiService.enviarTexto(telefone, `📅 ${dataInfo.dataBR} está livre! Nenhum agendamento.`);
    return;
  }

  const linhas = agendamentos.map(
    (a) => `⏰ ${a.horario} — ${a.nome} — ${a.servico} — ${a.status}`
  );

  await zapiService.enviarTexto(
    telefone,
    `📅 Agenda de ${dataInfo.dataBR}:\n\n${linhas.join('\n')}\n\nTotal: ${agendamentos.length} agendamento(s)`
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *cancelar dia 25/12*`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *cancelar hora 14:00 25/12*`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *folga 25/12*`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *ferias 20/12 ate 05/01*`);
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
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
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

// ---------------------------------------------------------------------------------------
// Comando 6: "bloquear HH:MM [DD/MM]" — bloqueia um horário específico (hoje por padrão).
// O bloqueio em si é imediato; se havia cliente agendada, pergunta separadamente se quer
// cancelar o agendamento dela também.
// ---------------------------------------------------------------------------------------

async function iniciarBloquearHorario(telefone, horario, dataTexto) {
  const dataInfo = dataTexto ? parseDataDDMM(dataTexto) : dataDeHojeInfo();
  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *bloquear 14:00 25/12*`);
    return;
  }

  await sheetsService.bloquearHorario(dataInfo.dataBR, horario, 'horario');

  const agendamento = await sheetsService.buscarAgendamentoPorHorario(dataInfo.dataBR, horario);

  if (!agendamento) {
    await zapiService.enviarTexto(telefone, `✅ Horário ${horario} de ${dataInfo.dataBR} bloqueado!`);
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPA_CONFIRMAR_CANCELAR_APOS_BLOQUEIO, agendamento });

  await zapiService.enviarOpcoes(
    telefone,
    `✅ Horário ${horario} de ${dataInfo.dataBR} bloqueado!\n\n` +
      `${agendamento.nome} está agendada nesse horário. Quer cancelar o agendamento dela e avisar?`,
    OPCOES_SIM_NAO,
    'Confirmação',
    'Responder'
  );
}

async function confirmarCancelarAposBloqueio(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, OPCOES_SIM_NAO);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Responde *1* pra sim ou *2* pra não.`);
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, o horário fica bloqueado e o agendamento dela continua como está.');
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
// Comando 7: "liberar HH:MM [DD/MM]" — remove o bloqueio de um horário específico.
// ---------------------------------------------------------------------------------------

async function liberarHorario(telefone, horario, dataTexto) {
  const dataInfo = dataTexto ? parseDataDDMM(dataTexto) : dataDeHojeInfo();
  if (!dataInfo) {
    await zapiService.enviarTexto(telefone, `${sortearFrase(FRASES_NAO_ENTENDI)} Manda assim: *liberar 14:00 25/12*`);
    return;
  }

  const removeu = await sheetsService.liberarHorarioBloqueado(dataInfo.dataBR, horario);

  if (!removeu) {
    await zapiService.enviarTexto(telefone, `Não encontrei bloqueio no horário ${horario} de ${dataInfo.dataBR}.`);
    return;
  }

  await zapiService.enviarTexto(telefone, `✅ Horário ${horario} de ${dataInfo.dataBR} liberado!`);
}

// ---------------------------------------------------------------------------------------
// Comando 8: "buscar [nome]" — mostra o histórico completo de uma cliente.
// ---------------------------------------------------------------------------------------

async function buscarClienteDetalhado(telefone, nome) {
  if (!nome) {
    await zapiService.enviarTexto(telefone, 'Me diz o nome da cliente, assim: *buscar Maria*');
    return;
  }

  const cliente = await sheetsService.buscarClientePorNome(nome);

  if (!cliente) {
    await zapiService.enviarTexto(telefone, `Não encontrei nenhuma cliente chamada "${nome}".`);
    return;
  }

  const [proximo, ultimo] = await Promise.all([
    sheetsService.buscarProximoAgendamentoPorTelefone(cliente.telefone),
    sheetsService.buscarUltimoAgendamentoPorTelefone(cliente.telefone),
  ]);

  const linhas = [
    `👤 Cliente: ${cliente.nome}`,
    `📱 Telefone: ${cliente.telefone}`,
    `🗓️ Cadastro: ${cliente.dataCadastro || 'não informado'}`,
    `💅 Total de visitas: ${cliente.totalVisitas}`,
    `⭐ Último serviço: ${cliente.ultimoServico || 'nenhum'}`,
    `📅 Último agendamento: ${ultimo ? `${ultimo.data} às ${ultimo.horario}` : 'nenhum'}`,
    `📝 Próximo agendamento: ${proximo ? `${proximo.data} às ${proximo.horario}` : 'nenhum'}`,
  ];

  await zapiService.enviarTexto(telefone, linhas.join('\n'));
}

// ---------------------------------------------------------------------------------------
// Comando 9: "nota [nome] [texto]" — salva uma observação livre sobre a cliente.
// ---------------------------------------------------------------------------------------

async function adicionarObservacao(telefone, nome, nota) {
  if (!nome || !nota) {
    await zapiService.enviarTexto(telefone, 'Me diz assim: *nota Maria prefere esmalte vermelho*');
    return;
  }

  const cliente = await sheetsService.buscarClientePorNome(nome);

  if (!cliente) {
    await zapiService.enviarTexto(telefone, `Não encontrei nenhuma cliente chamada "${nome}".`);
    return;
  }

  await sheetsService.salvarObservacaoCliente(cliente.numeroLinhaSheet, nota);
  await zapiService.enviarTexto(telefone, `✅ Observação salva para ${cliente.nome}!`);
}

// ---------------------------------------------------------------------------------------
// Comando 10: "faturamento hoje|semana|mes" — resumo de receita por serviço no período.
// ---------------------------------------------------------------------------------------

const ROTULOS_FATURAMENTO = { hoje: 'de hoje', semana: 'da semana', mes: 'do mês' };

// "semana" = últimos 7 dias corridos (incluindo hoje); "mes" = do dia 1 do mês corrente até hoje.
function intervaloFaturamento(periodo) {
  const hoje = agora();
  hoje.setHours(0, 0, 0, 0);
  const fimISO = formatarISO(hoje);

  if (periodo === 'hoje') {
    return { inicioISO: fimISO, fimISO };
  }

  if (periodo === 'semana') {
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 6);
    return { inicioISO: formatarISO(inicio), fimISO };
  }

  const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return { inicioISO: formatarISO(inicioDoMes), fimISO };
}

async function enviarFaturamento(telefone, periodo) {
  const { inicioISO, fimISO } = intervaloFaturamento(periodo);
  const agendamentos = await sheetsService.listarAgendamentosEntreDatas(inicioISO, fimISO);

  const quantidadePorServico = {};
  SERVICOS.forEach((servico) => {
    quantidadePorServico[servico] = 0;
  });

  let totalAtendimentos = 0;
  let totalReceita = 0;

  agendamentos.forEach((agendamento) => {
    const preco = SERVICOS_PRECOS[agendamento.servico];
    // Ignora serviços fora da tabela (ex: digitados manualmente na planilha, fora do menu do bot).
    if (preco === undefined) return;

    quantidadePorServico[agendamento.servico] += 1;
    totalAtendimentos += 1;
    totalReceita += preco;
  });

  const linhas = SERVICOS.map((servico) => {
    const quantidade = quantidadePorServico[servico];
    const receita = quantidade * SERVICOS_PRECOS[servico];
    return `${SERVICOS_EMOJI[servico]} ${servico}: ${quantidade} atendimento(s) — R$${receita}`;
  });

  await zapiService.enviarTexto(
    telefone,
    `💰 Faturamento ${ROTULOS_FATURAMENTO[periodo]}:\n\n${linhas.join('\n')}\n\n` +
      `Total: ${totalAtendimentos} atendimento(s) — R$${totalReceita}`
  );
}

// ---------------------------------------------------------------------------------------
// Comando 11: "clientes" — lista todas as clientes cadastradas.
// ---------------------------------------------------------------------------------------

async function listarClientes(telefone) {
  const clientes = await sheetsService.listarTodosClientes();

  if (clientes.length === 0) {
    await zapiService.enviarTexto(telefone, 'Nenhuma cliente cadastrada ainda.');
    return;
  }

  const linhas = clientes.map((cliente, indice) => `${indice + 1}. ${cliente.nome} — ${cliente.totalVisitas} visita(s)`);

  await zapiService.enviarTexto(telefone, `👥 Suas clientes (${clientes.length} no total):\n\n${linhas.join('\n')}`);
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
