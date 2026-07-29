// Fluxo de conversa com a cliente.
//
// Fluxo principal (agendamento): boas-vindas -> nome -> serviço -> dia -> horário -> confirmação.
// Cliente recorrente pula a etapa de nome e pode repetir o último serviço (feature 1).
// Fora do fluxo principal, mensagens não reconhecidas caem no menu de fallback (feature 2),
// que também dá acesso a "ver meu agendamento", cancelar/reagendar, preços e falar com a
// Cleópatra.

const zapiService = require('../services/zapiService');
const sheetsService = require('../services/sheetsService');
const { ETAPAS, obterEstado, atualizarEstado, limparEstado } = require('../utils/stateManager');
const { interpretarEscolha, normalizarTexto } = require('../utils/textoUtils');
const { proximosDiasUteis, estaDentroDoHorarioComercial } = require('../utils/dateUtils');
const { SERVICOS, SERVICOS_PRECOS, SERVICOS_EMOJI } = require('../config/servicos');

const NOME_SALAO = process.env.NOME_SALAO || 'Espaço Cleópatra';
const NUMERO_MANICURE = zapiService.normalizarTelefone(process.env.NUMERO_MANICURE);

const PALAVRAS_REINICIO = ['reiniciar', 'recomeçar', 'recomecar', 'cancelar', 'menu'];

// Etapas em que "cancelar"/"menu" não devem ser tratados como "reiniciar o fluxo em
// andamento", pois nelas essas palavras têm outro significado (ex: responder à pergunta
// de confirmação de presença/avaliação, ou escolher a opção "Cancelar" do próprio fluxo
// de cancelamento/reagendamento).
const ETAPAS_SEM_REINICIO_POR_PALAVRA = [
  ETAPAS.AGUARDANDO_CONFIRMACAO_PRESENCA,
  ETAPAS.AGUARDANDO_AVALIACAO,
  ETAPAS.AGUARDANDO_CANCELAR_OU_REAGENDAR,
];

// Feature 2: opções do menu de fallback.
const OPCOES_MENU_FALLBACK = [
  'Agendar horário',
  'Ver meu agendamento',
  'Cancelar agendamento',
  'Ver preços',
  'Falar com a Cleópatra',
];

const PALAVRAS_SAUDACAO = [
  'oi', 'oii', 'oiii', 'ola', 'olá', 'opa', 'eae', 'e ai',
  'bom dia', 'boa tarde', 'boa noite', 'iniciar', 'comecar', 'começar',
];

const PALAVRAS_PRECO = ['preco', 'precos', 'preços', 'valor', 'valores', 'tabela de precos'];

const MENSAGEM_FORA_DO_HORARIO =
  'Olá! Estamos fechados agora 😊 Nosso horário é de seg a sáb, das 9h às 19h. ' +
  'Mas pode agendar aqui pelo bot a qualquer hora!';

// Ponto de entrada: recebe telefone + texto da mensagem e conduz a conversa.
async function tratarMensagem(telefone, texto) {
  const estado = obterEstado(telefone);
  const textoNormalizado = normalizarTexto(texto);

  // Feature 5: pergunta de preços funciona em qualquer etapa da conversa.
  if (PALAVRAS_PRECO.includes(textoNormalizado) || textoNormalizado.includes('quanto custa')) {
    await enviarListaPrecos(telefone);
    return;
  }

  if (
    PALAVRAS_REINICIO.includes(textoNormalizado) &&
    estado.etapa !== ETAPAS.INICIO &&
    !ETAPAS_SEM_REINICIO_POR_PALAVRA.includes(estado.etapa)
  ) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Ok, cancelei o agendamento em andamento. 💅 Quando quiser começar de novo é só mandar um "oi"!');
    return;
  }

  switch (estado.etapa) {
    case ETAPAS.INICIO:
      await tratarMensagemInicial(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_NOME:
      await tratarNome(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_REPETIR_SERVICO:
      await tratarRepetirServico(telefone, texto);
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
    case ETAPAS.AGUARDANDO_CANCELAR_OU_REAGENDAR:
      await tratarCancelarOuReagendar(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_CONFIRMACAO_PRESENCA:
      await tratarConfirmacaoPresenca(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_AVALIACAO:
      await tratarAvaliacao(telefone, texto);
      break;
    case ETAPAS.AGUARDANDO_REAGENDAR_APOS_CANCELAMENTO:
      await tratarReagendarAposCancelamentoManicure(telefone, texto);
      break;
    default:
      limparEstado(telefone);
      await tratarMensagemInicial(telefone, texto);
  }
}

// Feature 2: quando a cliente ainda não está em nenhum fluxo, decide entre iniciar o
// agendamento, atender uma das opções do menu, ou mostrar o menu de fallback porque não
// entendemos a mensagem.
async function tratarMensagemInicial(telefone, texto) {
  const textoNormalizado = normalizarTexto(texto);
  const indiceMenu = interpretarEscolha(texto, OPCOES_MENU_FALLBACK);

  if (indiceMenu === 0 || PALAVRAS_SAUDACAO.includes(textoNormalizado)) {
    await iniciarConversa(telefone);
    return;
  }

  if (indiceMenu === 1) {
    await mostrarMeuAgendamento(telefone);
    return;
  }

  if (indiceMenu === 2) {
    await iniciarFluxoCancelamento(telefone);
    return;
  }

  if (indiceMenu === 3) {
    await enviarListaPrecos(telefone);
    return;
  }

  if (indiceMenu === 4) {
    await falarComCleopatra(telefone);
    return;
  }

  await enviarMenuFallback(telefone);
}

async function enviarMenuFallback(telefone) {
  await zapiService.enviarTexto(
    telefone,
    'Não entendi muito bem 😅 Posso te ajudar com:\n' +
      '1️⃣ Agendar horário\n' +
      '2️⃣ Ver meu agendamento\n' +
      '3️⃣ Cancelar agendamento\n' +
      '4️⃣ Ver preços\n' +
      '5️⃣ Falar com a Cleópatra'
  );
}

// Feature 5: envia a tabela de preços atual (editável em src/config/servicos.js).
async function enviarListaPrecos(telefone) {
  const linhas = SERVICOS.map((servico) => `${SERVICOS_EMOJI[servico]} ${servico} — R$${SERVICOS_PRECOS[servico]}`);

  await zapiService.enviarTexto(
    telefone,
    `Nossos valores 💰:\n\n${linhas.join('\n')}\n\nPara agendar é só digitar *oi* 😊`
  );
}

// Feature 2 (opção "ver meu agendamento"): mostra o próximo agendamento confirmado da cliente.
async function mostrarMeuAgendamento(telefone) {
  const agendamento = await sheetsService.buscarProximoAgendamentoPorTelefone(telefone);

  if (!agendamento) {
    await zapiService.enviarTexto(
      telefone,
      'Não encontrei nenhum agendamento marcado no seu telefone. Quer marcar um horário agora? É só mandar um "oi"! 💅'
    );
    return;
  }

  await zapiService.enviarTexto(
    telefone,
    `Encontrei seu agendamento! 📋\n\n💅 Serviço: ${agendamento.servico}\n📅 Dia: ${agendamento.data}\n⏰ Horário: ${agendamento.horario}`
  );
}

// Feature 2 (opção "falar com a Cleópatra"): avisa a cliente e notifica a manicure.
async function falarComCleopatra(telefone) {
  await zapiService.enviarTexto(
    telefone,
    'Vou chamar a Cleópatra pra você!\nUm momento... 💕\n(A Cleópatra foi notificada e vai te responder em breve)'
  );

  if (NUMERO_MANICURE) {
    // Usa o nome da cliente se ela já for cadastrada, senão identifica pelo telefone mesmo.
    const cliente = await sheetsService.buscarCliente(telefone);
    const identificacao = cliente ? cliente.nome : telefone;
    await zapiService.enviarTexto(NUMERO_MANICURE, `⚠️ Cliente ${identificacao} quer falar com você!`);
  }
}

// Feature 1: início do agendamento. Avisa se estamos fora do horário comercial (feature 6,
// mas o agendamento continua liberado 24h) e verifica se é uma cliente recorrente.
async function iniciarConversa(telefone) {
  if (!estaDentroDoHorarioComercial()) {
    await zapiService.enviarTexto(telefone, MENSAGEM_FORA_DO_HORARIO);
  }

  const cliente = await sheetsService.buscarCliente(telefone);

  if (cliente) {
    atualizarEstado(telefone, {
      etapa: ETAPAS.AGUARDANDO_REPETIR_SERVICO,
      nome: cliente.nome,
      ultimoServico: cliente.ultimoServico,
    });

    if (cliente.ultimoServico) {
      await zapiService.enviarOpcoes(
        telefone,
        `Olá ${cliente.nome}! Que bom te ver de novo! 😍\n\nQuer repetir seu último serviço (${cliente.ultimoServico})?`,
        ['Sim, repetir', 'Não, quero escolher outro'],
        'Repetir serviço',
        'Responder'
      );
      return;
    }

    await enviarMenuServicos(telefone, `Olá ${cliente.nome}! Que bom te ver de novo! 😍\n\nQual serviço você quer agendar dessa vez?`);
    return;
  }

  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_NOME });
  await zapiService.enviarTexto(
    telefone,
    `Olá! 👑 Bem-vinda ao *${NOME_SALAO}*!\n` +
      `Eu sou a assistente virtual e vou te ajudar a agendar seu horário rapidinho. 💅\n\n` +
      `Qual é o seu nome, linda?`
  );
}

async function tratarNome(telefone, texto) {
  const nome = texto.trim();
  if (nome.length < 2) {
    await zapiService.enviarTexto(telefone, 'Desculpa, não entendi 🙏 Pode me dizer seu nome, por favor?');
    return;
  }

  // Feature 1: já cadastra a cliente nova na aba Clientes assim que sabemos o nome dela.
  await sheetsService.cadastrarCliente({ telefone, nome });
  atualizarEstado(telefone, { nome });

  await enviarMenuServicos(telefone, `Prazer, ${nome}! 🌸 Qual serviço você quer agendar?`);
}

async function enviarMenuServicos(telefone, mensagem) {
  atualizarEstado(telefone, { etapa: ETAPAS.AGUARDANDO_SERVICO });
  await zapiService.enviarOpcoes(telefone, mensagem || 'Qual serviço você quer agendar?', SERVICOS, 'Serviços', 'Escolher serviço');
}

// Feature 1: cliente recorrente decide se quer repetir o último serviço ou escolher outro.
async function tratarRepetirServico(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, ['Sim, repetir', 'Não, quero escolher outro']);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra repetir ou *2* pra escolher outro serviço.');
    return;
  }

  if (indice === 0) {
    await avancarParaEscolhaDia(telefone, estado.ultimoServico);
    return;
  }

  await enviarMenuServicos(telefone);
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

  await avancarParaEscolhaDia(telefone, SERVICOS[indice]);
}

async function avancarParaEscolhaDia(telefone, servico) {
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
    await sugerirProximosDiasComVaga(telefone, diaEscolhido);
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

// Feature 7: quando o dia escolhido está lotado, procura os próximos dias úteis (além da
// janela original de 7 dias mostrada antes) que ainda tenham horário livre, e sugere até 2.
async function sugerirProximosDiasComVaga(telefone, diaEscolhido) {
  const diasCandidatos = proximosDiasUteis(14).filter((dia) => dia.dataISO > diaEscolhido.dataISO);

  const diasComVaga = [];
  for (const dia of diasCandidatos) {
    if (diasComVaga.length >= 2) break;
    const livres = await sheetsService.listarHorariosLivres(dia.dataBR, dia.diaSemana);
    if (livres.length > 0) {
      diasComVaga.push(dia);
    }
  }

  if (diasComVaga.length === 0) {
    await zapiService.enviarTexto(
      telefone,
      `Que pena! Não tenho horários disponíveis em ${diaEscolhido.label} nem nos próximos dias 😕 Tenta de novo mais tarde, por favor!`
    );
    limparEstado(telefone);
    return;
  }

  atualizarEstado(telefone, { diasDisponiveis: diasComVaga });

  const sugestoes = diasComVaga.map((dia) => `📅 ${dia.label}`).join('\n');
  await zapiService.enviarOpcoes(
    telefone,
    `Que pena! Não tenho horários disponíveis em ${diaEscolhido.label} 😕\n\nQue tal tentar:\n${sugestoes}`,
    diasComVaga.map((dia) => dia.label),
    'Dias disponíveis',
    'Escolher dia'
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

  // Feature 8: guarda o último serviço e soma 1 na contagem de visitas da cliente.
  await sheetsService.registrarAtendimentoCliente({ telefone, nome: estado.nome, servico: estado.servico });

  const { nome, diaLabel, horario } = estado;
  limparEstado(telefone);

  await zapiService.enviarTexto(
    telefone,
    `Agendamento confirmado! 🎉💅\n\n` +
      `*${nome}*, te esperamos no dia *${diaLabel}* às *${horario}* no *${NOME_SALAO}*!\n\n` +
      `Vamos te lembrar 24h e 2h antes. Até lá! ✨👑`
  );
}

// Feature 3: início do fluxo de cancelamento/reagendamento a partir do menu de fallback.
async function iniciarFluxoCancelamento(telefone) {
  const agendamento = await sheetsService.buscarProximoAgendamentoPorTelefone(telefone);

  if (!agendamento) {
    await zapiService.enviarTexto(telefone, 'Não encontrei nenhum agendamento seu pra cancelar ou reagendar 🤔');
    return;
  }

  atualizarEstado(telefone, {
    etapa: ETAPAS.AGUARDANDO_CANCELAR_OU_REAGENDAR,
    agendamentoParaCancelar: agendamento,
  });

  await zapiService.enviarOpcoes(
    telefone,
    `Achei seu agendamento:\n\n💅 ${agendamento.servico}\n📅 ${agendamento.data} às ${agendamento.horario}\n\nQuer cancelar ou reagendar?`,
    ['Cancelar', 'Reagendar'],
    'Cancelar ou reagendar',
    'Responder'
  );
}

async function tratarCancelarOuReagendar(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, ['Cancelar', 'Reagendar']);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra cancelar ou *2* pra reagendar.');
    return;
  }

  const agendamento = estado.agendamentoParaCancelar;
  await sheetsService.atualizarStatusAgendamento(agendamento.numeroLinhaSheet, 'cancelado');

  if (indice === 0) {
    limparEstado(telefone);
    await zapiService.enviarTexto(
      telefone,
      `Cancelamento feito! 💙\n` +
        `Sentiremos sua falta ${agendamento.nome}!\n` +
        `Quando quiser voltar é só chamar.\n` +
        `Aguardamos você sempre! 💅✨`
    );
    return;
  }

  // Reagendar: libera o horário antigo (já cancelado acima) e reabre o fluxo normal de
  // agendamento a partir da escolha de serviço, já sabendo o nome da cliente.
  atualizarEstado(telefone, { nome: agendamento.nome });
  await enviarMenuServicos(telefone, 'Show, bora marcar um novo horário! 💅 Qual serviço você quer agendar?');
}

// Feature 4: resposta da cliente à pergunta de confirmação de presença enviada no
// lembrete de 24h (ver lembreteHandler.js).
async function tratarConfirmacaoPresenca(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, ['Sim', 'Não']);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* para SIM ou *2* para NÃO.');
    return;
  }

  const { numeroLinhaSheet, nome, data, horario } = estado.confirmacaoPresenca;

  if (indice === 0) {
    await sheetsService.atualizarConfirmacaoPresenca(numeroLinhaSheet, 'sim');
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, `Perfeito, ${nome}! Te esperamos amanhã às ${horario} 💅✨`);
    return;
  }

  await sheetsService.atualizarConfirmacaoPresenca(numeroLinhaSheet, 'nao');
  await sheetsService.atualizarStatusAgendamento(numeroLinhaSheet, 'cancelado');
  limparEstado(telefone);

  await zapiService.enviarTexto(
    telefone,
    `Sem problemas, ${nome}! Cancelei seu horário de ${data} às ${horario}. Quando quiser remarcar, é só chamar 💕`
  );

  if (NUMERO_MANICURE) {
    await zapiService.enviarTexto(
      NUMERO_MANICURE,
      `⚠️ ${nome} não confirmou presença e o horário de ${data} às ${horario} foi cancelado automaticamente.`
    );
  }
}

// Feature 10: resposta da cliente ao pedido de avaliação enviado 2h após o atendimento
// (ver lembreteHandler.js).
async function tratarAvaliacao(telefone, texto) {
  const estado = obterEstado(telefone);
  const nota = parseInt(normalizarTexto(texto), 10);

  if (Number.isNaN(nota) || nota < 1 || nota > 5) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Digita um número de *1* a *5* pra avaliar.');
    return;
  }

  await sheetsService.salvarAvaliacao({ telefone, nome: estado.avaliacaoNome, nota });
  limparEstado(telefone);
  await zapiService.enviarTexto(telefone, 'Muito obrigada pela avaliação! 💖 Isso ajuda demais a Cleópatra a continuar melhorando.');
}

// Resposta da cliente à pergunta de reagendamento enviada pela manicure depois de um
// cancelamento administrativo (comandos "cancelar dia/hora/[nome]", "folga" ou "ferias" —
// ver manicureHandler.js).
async function tratarReagendarAposCancelamentoManicure(telefone, texto) {
  const estado = obterEstado(telefone);
  const indice = interpretarEscolha(texto, ['Sim, quero reagendar', 'Não por enquanto']);

  if (indice === -1) {
    await zapiService.enviarTexto(telefone, 'Não entendi 🙏 Responde *1* pra reagendar ou *2* pra não por enquanto.');
    return;
  }

  if (indice === 1) {
    limparEstado(telefone);
    await zapiService.enviarTexto(telefone, 'Tudo bem! Quando quiser marcar um novo horário, é só me chamar 💕');
    return;
  }

  await enviarMenuServicos(telefone, `Show, ${estado.nome}! Bora marcar um novo horário? 💅 Qual serviço você quer agendar?`);
}

module.exports = {
  tratarMensagem,
};
