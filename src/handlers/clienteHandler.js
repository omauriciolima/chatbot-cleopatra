// Fluxo de conversa com a cliente: boas-vindas -> nome -> serviço -> dia -> horário -> confirmação.

const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');
const { ETAPAS, obterEstado, atualizarEstado, limparEstado } = require('../utils/stateManager');
const { interpretarEscolha, normalizarTexto } = require('../utils/textoUtils');
const { proximosDiasUteis } = require('../utils/dateUtils');

const NOME_SALAO = process.env.NOME_SALAO || 'Espaço Cleópatra';

const SERVICOS = ['Manicure', 'Pedicure', 'Manicure + Pedicure', 'Alongamento em Gel'];

const PALAVRAS_REINICIO = ['reiniciar', 'recomeçar', 'recomecar', 'cancelar', 'menu'];

// Ponto de entrada: recebe telefone + texto da mensagem e conduz a conversa.
async function tratarMensagem(telefone, texto) {
  const estado = obterEstado(telefone);

  if (PALAVRAS_REINICIO.includes(normalizarTexto(texto)) && estado.etapa !== ETAPAS.INICIO) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, cancelei o agendamento em andamento. 💅 Quando quiser começar de novo é só mandar um "oi"!');
    return;
  }

  switch (estado.etapa) {
    case ETAPAS.INICIO:
      await iniciarConversa(telefone);
      break;
    case ETAPAS.AGUARDANDO_NOME:
      await tratarNome(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_SERVICO:
      await tratarServico(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_DIA:
      await tratarDia(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_HORARIO:
      await tratarHorario(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_CONFIRMACAO:
      await tratarConfirmacao(telefone, texto);
      break;
    default:
      limparEstado(telefone);
      await iniciarConversa(telefone);
  }
}

async function iniciarConversa(telefone) {
  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_NOME });
  await zapiService.enviarTexto(
    telefone,
    `Oii, seja bem-vinda ao *${NOME_SALAO}*! 💅✨\n\nVou te ajudar a marcar seu horário. Pra começar, qual é o seu nome?`
  );
}

async function tratarNome(telefone, texto) {
  const nome = texto.trim();
  if (nome.length < 2) {
    await zapiService.enviarTexto(telefone, 'Desculpa, não entendi 🙏 Pode me dizer seu nome, por favor?');
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_SERVICO, nome });
  await zapiService.enviarOpcoes(
    telefone,
    `Prazer, ${nome}! 🌸 Qual serviço você quer agendar?`,
    SERVICOS,
    'Serviços',
    'Escolher serviço'
  );
}

async function tratarServico(telefone, texto) {
  const indice = interpretarEscolha(texto, SERVICOS);
  if (indice === -1) {
    await zapiService.enviarOpcoes(
      telefone,
      'Não achei essa opção 🙈 Escolhe um dos serviços abaixo:',
      SERVICOS,
      'Serviços',
      'Escolher serviço'
    );
    return;
  }

  const servico = SERVICOS[indice];
  const dias = proximosDiasUteis(7);
  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_DIA, servico, diasDisponiveis: dias });

  await zapiService.enviarOpcoes(
    telefone,
    `Perfeito, *${servico}*! 📅 Agora escolhe o dia que fica melhor pra você:`,
    dias.map((dia) => dia.label),
    'Dias disponíveis',
    'Escolher dia'
  );
}

async function tratarDia(telefone, texto) {
  const estado = obterEstado(telefone);
  const opcoesLabel = estado.diasDisponiveis.map((dia) => dia.label);
  const indice = interpretarEscolha(texto, opcoesLabel);

  if (indice === -1) {
    await zapiService.enviarOpcoes(
      telefone,
      'Não achei esse dia 🙈 Escolhe uma das opções abaixo:',
      opcoesLabel,
      'Dias disponíveis',
      'Escolher dia'
    );
    return;
  }

  const diaEscolhido = estado.diasDisponiveis[indice];
  const horariosLivres = await sheetsService.listarHorariosLivres(diaEscolhido.dataBR, diaEscolhido.diaSemana);

  if (horariosLivres.length === 0) {
    await zapiService.enviarOpcoes(
      telefone,
      `Poxa, não temos mais horários livres em ${diaEscolhido.label} 😞 Escolhe outro dia:`,
      opcoesLabel,
      'Dias disponíveis',
      'Escolher dia'
    );
    return;
  }

  atualizarEstado(telefone, {
    etapa: ETAPAS.AGUARDANDO_HORARIO,
    dataISO: diaEscolhido.dataISO,
    dataBR: diaEscolhido.dataBR,
    diaSemana: diaEscolhido.diaSemana,
    diaLabel: diaEscolhido.label,
    horariosDisponiveis: horariosLivres,
  });

  await zapiService.enviarOpcoes(
    telefone,
    `Show! ⏰ Esses são os horários livres em ${diaEscolhido.label}:`,
    horariosLivres,
    'Horários',
    'Escolher horário'
  );
}

async function tratarHorario(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, estado.horariosDisponiveis);

  if (indice === -1) {
    await zapiService.enviarOpcoes(
      telefone,
      'Não achei esse horário 🙈 Escolhe um dos horários abaixo:',
      estado.horariosDisponiveis,
      'Horários',
      'Escolher horário'
    );
    return;
  }

  const horario = estado.horariosDisponiveis[indice];
  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_CONFIRMACAO, horario });

  const resumo =
    `Só confirmar então! ✨\n\n` +
    `👤 Nome: ${estado.nome}\n` +
    `💅 Serviço: ${estado.servico}\n` +
    `📅 Dia: ${estado.diaLabel}\n` +
    `⏰ Horário: ${horario}\n\n` +
    `Tá tudo certo? Responde *1 - Sim* ou *2 - Não*`;

  await zapiService.enviarOpcoes(telefone, resumo, ['Sim, confirmar', 'Não, cancelar'], 'Confirmação', 'Responder');
}

async function tratarConfirmacao(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, ['Sim, confirmar', 'Não, cancelar']);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra confirmar ou *2* pra cancelar.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Sem problemas! Cancelei esse agendamento. Quando quiser começar de novo, é só chamar 💕');
    return;
  }

  // Antes de salvar, confere de novo se o horário continua livre (evita conflito de duas
  // clientes escolhendo o mesmo horário ao mesmo tempo).
  const horariosAindaLivres = await sheetsService.listarHorariosLivres(estado.dataBR, estado.diaSemana);

  if (!horariosAindaLivres.includes(estado.horario)) {
    limparEstado(telefone);
    await zapiService.enviarTexto(
      telefone,
      `Ah não! 😢 Esse horário acabou de ser reservado por outra cliente. Manda um "oi" pra escolher outro horário, tá bom?`
    );
    return;
  }

  await sheetsService.salvarAgendamento({
    nome: estado.nome,
    telefone,
    servico: estado.servico,
    dataBR: estado.dataBR,
    horario: estado.horario,
  });

  limparEstado(telefone);

  await zapiService.enviarTexto(
    telefone,
    `Agendamento confirmado! 🎉💅\n\n` +
      `${estado.nome}, te esperamos no dia ${estado.diaLabel} às ${estado.horario} no *${NOME_SALAO}*.\n\n` +
      `Vamos te mandar um lembrete mais perto da hora. Até lá! ✨`
  );
}

module.exports = {
  tratarMensagem,
};
