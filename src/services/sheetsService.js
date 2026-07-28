// Toda a "persistência" do sistema é feita no Google Sheets, através da API v4.
//
// Abas usadas:
//  - "Agendamentos": nome_cliente | telefone | servico | data | horario | status |
//    lembrete_24h | lembrete_2h | confirmacao_presenca | feedback_enviado
//    (as colunas depois de "status" foram adicionadas além das exigidas pelo escopo,
//    apenas para o bot controlar o que já foi enviado/perguntado e não duplicar nada)
//  - "Horarios_Disponiveis": dia_semana | horario | disponivel
//  - "Clientes": telefone | nome | ultimo_servico | total_visitas | data_cadastro
//  - "Avaliacoes": telefone | nome | nota | data
//
// Datas são gravadas no formato brasileiro "DD/MM/YYYY", igual à visualização da manicure na planilha.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { converterBRparaISO, minutosAte, agora, formatarISO, formatarBR } = require('../utils/dateUtils');
const { normalizarTexto } = require('../utils/textoUtils');

const ABA_AGENDAMENTOS = 'Agendamentos';
const ABA_HORARIOS = 'Horarios_Disponiveis';
const ABA_CLIENTES = 'Clientes';
const ABA_AVALIACOES = 'Avaliacoes';

// ID da planilha (GOOGLE_SHEETS_ID) e caminho do arquivo JSON da conta de serviço
// (GOOGLE_CREDENTIALS_PATH), ambos configurados no .env.
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

let clienteSheetsCache = null;

// Lê o arquivo JSON da conta de serviço do Google (baixado no Google Cloud Console).
function carregarCredenciais() {
  const caminhoCredenciais = path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json');
  const conteudo = fs.readFileSync(caminhoCredenciais, 'utf8');
  return JSON.parse(conteudo);
}

// Cria (uma única vez) o cliente autenticado da API do Google Sheets usando conta de serviço.
async function obterClienteSheets() {
  if (clienteSheetsCache) return clienteSheetsCache;

  const credenciais = carregarCredenciais();
  const auth = new google.auth.JWT({
    email: credenciais.client_email,
    key: credenciais.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();
  clienteSheetsCache = google.sheets({ version: 'v4', auth });
  return clienteSheetsCache;
}

function disponivelParaBoolean(valor) {
  const texto = normalizarTexto(valor);
  return ['sim', 'true', 'verdadeiro', '1', 'disponivel'].includes(texto);
}

// Mantém só os dígitos de um telefone, para comparar números vindos de fontes diferentes
// (planilha, Z-API) sem se importar com "+", espaços etc.
function apenasDigitos(valor) {
  return (valor || '').toString().replace(/\D/g, '');
}

function hojeFormatadoBR() {
  return formatarBR(formatarISO(agora()));
}

// Retorna os horários configurados (aba Horarios_Disponiveis) para um dia da semana, já ordenados.
async function listarHorariosConfigurados(diaSemana) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_HORARIOS}!A2:C`,
  });

  const linhas = data.values || [];
  return linhas
    .filter((linha) => normalizarTexto(linha[0]) === normalizarTexto(diaSemana) && disponivelParaBoolean(linha[2]))
    .map((linha) => linha[1])
    .filter(Boolean)
    .sort();
}

// Retorna os horários já ocupados (com status diferente de "cancelado") numa data específica.
async function listarHorariosOcupados(dataBR) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  return linhas
    .filter((linha) => linha[3] === dataBR && normalizarTexto(linha[5]) !== 'cancelado')
    .map((linha) => linha[4]);
}

// Cruza os horários configurados para o dia da semana com os já ocupados naquela data,
// retornando somente os horários realmente livres.
async function listarHorariosLivres(dataBR, diaSemana) {
  const [configurados, ocupados] = await Promise.all([
    listarHorariosConfigurados(diaSemana),
    listarHorariosOcupados(dataBR),
  ]);

  const ocupadosSet = new Set(ocupados);
  return configurados.filter((horario) => !ocupadosSet.has(horario));
}

// Grava um novo agendamento confirmado ao final da aba Agendamentos.
async function salvarAgendamento({ nome, telefone, servico, dataBR, horario }) {
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[nome, telefone, servico, dataBR, horario, 'confirmado', '', '', '', '']],
    },
  });
}

// Lê todos os agendamentos com status "confirmado" numa data (formato DD/MM/YYYY), ordenados por horário.
async function listarAgendamentosPorData(dataBR) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  return linhas
    .map((linha, indice) => ({ linha, numeroLinhaSheet: indice + 2 }))
    .filter(({ linha }) => linha[3] === dataBR && normalizarTexto(linha[5]) === 'confirmado')
    .map(({ linha, numeroLinhaSheet }) => ({
      numeroLinhaSheet,
      nome: linha[0],
      telefone: linha[1],
      servico: linha[2],
      data: linha[3],
      horario: linha[4],
      status: linha[5],
    }))
    .sort((a, b) => a.horario.localeCompare(b.horario));
}

// Atualiza o status (coluna F) de um agendamento numa linha específica da planilha.
// Genérico: usado tanto pelo cancelamento via manicure quanto pelos fluxos de
// cancelamento/reagendamento e de confirmação de presença da cliente.
async function atualizarStatusAgendamento(numeroLinhaSheet, novoStatus) {
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!F${numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[novoStatus]] },
  });
}

// Feature 4: marca na coluna I se a cliente confirmou ("sim") ou não ("nao") presença
// quando perguntado no lembrete de 24h.
async function atualizarConfirmacaoPresenca(numeroLinhaSheet, valor) {
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!I${numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[valor]] },
  });
}

// Procura o próximo agendamento confirmado de uma cliente (por nome, busca parcial e sem acento)
// e marca o status como "cancelado". Retorna o agendamento cancelado ou null se não achar.
async function cancelarAgendamentoPorNome(nomeBusca) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  const buscaNormalizada = normalizarTexto(nomeBusca);

  const candidatos = linhas
    .map((linha, indice) => ({ linha, numeroLinhaSheet: indice + 2 }))
    .filter(
      ({ linha }) =>
        normalizarTexto(linha[5]) === 'confirmado' && normalizarTexto(linha[0]).includes(buscaNormalizada)
    )
    .sort((a, b) => {
      const dataA = converterBRparaISO(a.linha[3]) + a.linha[4];
      const dataB = converterBRparaISO(b.linha[3]) + b.linha[4];
      return dataA.localeCompare(dataB);
    });

  if (candidatos.length === 0) return null;

  const escolhido = candidatos[0];
  await atualizarStatusAgendamento(escolhido.numeroLinhaSheet, 'cancelado');

  return {
    nome: escolhido.linha[0],
    telefone: escolhido.linha[1],
    servico: escolhido.linha[2],
    data: escolhido.linha[3],
    horario: escolhido.linha[4],
  };
}

// Feature 3 (cancelamento/reagendamento) e "ver meu agendamento": busca o próximo
// agendamento confirmado e futuro (ou em andamento) de um telefone específico.
async function buscarProximoAgendamentoPorTelefone(telefone) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  const telefoneBusca = apenasDigitos(telefone);

  const candidatos = linhas
    .map((linha, indice) => ({ linha, numeroLinhaSheet: indice + 2 }))
    .filter(({ linha }) => apenasDigitos(linha[1]) === telefoneBusca && normalizarTexto(linha[5]) === 'confirmado')
    .map(({ linha, numeroLinhaSheet }) => ({
      numeroLinhaSheet,
      nome: linha[0],
      telefone: linha[1],
      servico: linha[2],
      data: linha[3],
      horario: linha[4],
      minutosAteAgendamento: minutosAte(converterBRparaISO(linha[3]), linha[4]),
    }))
    // Ignora agendamentos já bem no passado (mais de 1h atrás), pra não sugerir "cancelar"
    // algo que já aconteceu há muito tempo.
    .filter((candidato) => candidato.minutosAteAgendamento > -60)
    .sort((a, b) => a.minutosAteAgendamento - b.minutosAteAgendamento);

  return candidatos[0] || null;
}

// Busca agendamentos confirmados que estão a ~24h ou ~2h do horário marcado e ainda não
// receberam o respectivo lembrete. Usado pelo lembreteHandler (cron).
async function buscarAgendamentosPendentesDeLembrete() {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  const pendentes24h = [];
  const pendentes2h = [];

  linhas.forEach((linha, indice) => {
    if (normalizarTexto(linha[5]) !== 'confirmado') return;

    const dataISO = converterBRparaISO(linha[3]);
    const minutos = minutosAte(dataISO, linha[4]);
    const numeroLinhaSheet = indice + 2;
    const lembrete24hEnviado = normalizarTexto(linha[6]) === 'sim';
    const lembrete2hEnviado = normalizarTexto(linha[7]) === 'sim';

    const agendamento = {
      numeroLinhaSheet,
      nome: linha[0],
      telefone: linha[1],
      servico: linha[2],
      data: linha[3],
      horario: linha[4],
    };

    // Janela de +-15min ao redor de 24h e 2h, compatível com um cron rodando a cada 10min.
    if (!lembrete24hEnviado && minutos <= 24 * 60 + 15 && minutos >= 24 * 60 - 15) {
      pendentes24h.push(agendamento);
    }
    if (!lembrete2hEnviado && minutos <= 2 * 60 + 15 && minutos >= 2 * 60 - 15) {
      pendentes2h.push(agendamento);
    }
  });

  return { pendentes24h, pendentes2h };
}

// Feature 10: busca agendamentos confirmados cujo horário já passou há ~2h e que ainda
// não receberam o pedido de avaliação.
async function buscarAgendamentosPendentesDeFeedback() {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:J`,
  });

  const linhas = data.values || [];
  const pendentes = [];

  linhas.forEach((linha, indice) => {
    if (normalizarTexto(linha[5]) !== 'confirmado') return;

    const feedbackJaEnviado = normalizarTexto(linha[9]) === 'sim';
    if (feedbackJaEnviado) return;

    const dataISO = converterBRparaISO(linha[3]);
    const minutos = minutosAte(dataISO, linha[4]);

    // Janela de +-15min ao redor de "2h atrás" (minutos negativo = já passou).
    if (minutos <= -105 && minutos >= -135) {
      pendentes.push({
        numeroLinhaSheet: indice + 2,
        nome: linha[0],
        telefone: linha[1],
        servico: linha[2],
        data: linha[3],
        horario: linha[4],
      });
    }
  });

  return pendentes;
}

async function marcarLembreteEnviado(numeroLinhaSheet, tipo) {
  const coluna = tipo === '24h' ? 'G' : 'H';
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!${coluna}${numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['sim']] },
  });
}

// Feature 10: marca na coluna J que o pedido de avaliação já foi enviado.
async function marcarFeedbackEnviado(numeroLinhaSheet) {
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!J${numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['sim']] },
  });
}

// Feature 1/8: busca uma cliente cadastrada na aba Clientes pelo telefone.
async function buscarCliente(telefone) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_CLIENTES}!A2:E`,
  });

  const linhas = data.values || [];
  const telefoneBusca = apenasDigitos(telefone);
  const indice = linhas.findIndex((linha) => apenasDigitos(linha[0]) === telefoneBusca);

  if (indice === -1) return null;

  const linha = linhas[indice];
  return {
    numeroLinhaSheet: indice + 2,
    telefone: linha[0],
    nome: linha[1],
    ultimoServico: linha[2] || '',
    totalVisitas: parseInt(linha[3], 10) || 0,
    dataCadastro: linha[4] || '',
  };
}

// Feature 1: cadastra uma cliente nova na aba Clientes (chamado assim que ela informa o
// nome, antes mesmo de terminar o agendamento). Não faz nada se ela já existir.
async function cadastrarCliente({ telefone, nome }) {
  const clienteExistente = await buscarCliente(telefone);
  if (clienteExistente) return;

  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_CLIENTES}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[telefone, nome, '', 0, hojeFormatadoBR()]],
    },
  });
}

// Feature 8: depois de um agendamento confirmado, atualiza (ou cria, se por algum motivo
// ainda não existir) o registro da cliente com o último serviço e +1 na contagem de visitas.
async function registrarAtendimentoCliente({ telefone, nome, servico }) {
  const cliente = await buscarCliente(telefone);
  const sheets = await obterClienteSheets();

  if (!cliente) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${ABA_CLIENTES}!A:E`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[telefone, nome, servico, 1, hojeFormatadoBR()]] },
    });
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_CLIENTES}!C${cliente.numeroLinhaSheet}:D${cliente.numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[servico, cliente.totalVisitas + 1]] },
  });
}

// Feature 10: grava a avaliação (1 a 5) enviada pela cliente na aba Avaliacoes.
async function salvarAvaliacao({ telefone, nome, nota }) {
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AVALIACOES}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[telefone, nome, nota, hojeFormatadoBR()]],
    },
  });
}

module.exports = {
  listarHorariosLivres,
  salvarAgendamento,
  listarAgendamentosPorData,
  atualizarStatusAgendamento,
  atualizarConfirmacaoPresenca,
  cancelarAgendamentoPorNome,
  buscarProximoAgendamentoPorTelefone,
  buscarAgendamentosPendentesDeLembrete,
  buscarAgendamentosPendentesDeFeedback,
  marcarLembreteEnviado,
  marcarFeedbackEnviado,
  buscarCliente,
  cadastrarCliente,
  registrarAtendimentoCliente,
  salvarAvaliacao,
};
