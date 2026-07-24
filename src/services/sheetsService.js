// Toda a "persistência" do sistema é feita no Google Sheets, através da API v4.
//
// Abas usadas:
//  - "Agendamentos": nome_cliente | telefone | servico | data | horario | status | lembrete_24h | lembrete_2h
//    (as duas últimas colunas foram adicionadas além das exigidas pelo escopo, apenas para o bot
//    saber se já enviou o lembrete de 24h/2h e não mandar duplicado)
//  - "Horarios_Disponiveis": dia_semana | horario | disponivel
//
// Datas são gravadas no formato brasileiro "DD/MM/YYYY", igual à visualização da manicure na planilha.

const { google } = require('googleapis');
const { converterBRparaISO, minutosAte } = require('../utils/dateUtils');
const { normalizarTexto } = require('../utils/textoUtils');

const ABA_AGENDAMENTOS = 'Agendamentos';
const ABA_HORARIOS = 'Horarios_Disponiveis';

let clienteSheetsCache = null;

// Cria (uma única vez) o cliente autenticado da API do Google Sheets usando conta de serviço.
async function obterClienteSheets() {
  if (clienteSheetsCache) return clienteSheetsCache;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
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

// Retorna os horários configurados (aba Horarios_Disponiveis) para um dia da semana, já ordenados.
async function listarHorariosConfigurados(diaSemana) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
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
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:H`,
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
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[nome, telefone, servico, dataBR, horario, 'confirmado', '', '']],
    },
  });
}

// Lê todos os agendamentos com status "confirmado" numa data (formato DD/MM/YYYY), ordenados por horário.
async function listarAgendamentosPorData(dataBR) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:H`,
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

// Procura o próximo agendamento confirmado de uma cliente (por nome, busca parcial e sem acento)
// e marca o status como "cancelado". Retorna o agendamento cancelado ou null se não achar.
async function cancelarAgendamentoPorNome(nomeBusca) {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:H`,
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
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!F${escolhido.numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['cancelado']] },
  });

  return {
    nome: escolhido.linha[0],
    telefone: escolhido.linha[1],
    servico: escolhido.linha[2],
    data: escolhido.linha[3],
    horario: escolhido.linha[4],
  };
}

// Busca agendamentos confirmados que estão a ~24h ou ~2h do horário marcado e ainda não
// receberam o respectivo lembrete. Usado pelo lembreteHandler (cron).
async function buscarAgendamentosPendentesDeLembrete() {
  const sheets = await obterClienteSheets();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A2:H`,
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

async function marcarLembreteEnviado(numeroLinhaSheet, tipo) {
  const coluna = tipo === '24h' ? 'G' : 'H';
  const sheets = await obterClienteSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${ABA_AGENDAMENTOS}!${coluna}${numeroLinhaSheet}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['sim']] },
  });
}

module.exports = {
  listarHorariosLivres,
  salvarAgendamento,
  listarAgendamentosPorData,
  cancelarAgendamentoPorNome,
  buscarAgendamentosPendentesDeLembrete,
  marcarLembreteEnviado,
};
