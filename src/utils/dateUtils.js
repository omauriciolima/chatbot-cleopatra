// Funções auxiliares de data e hora usadas em todo o projeto.
// Todas as datas "de negócio" são tratadas no fuso horário de São Paulo (America/Sao_Paulo).

const TIMEZONE = 'America/Sao_Paulo';

const NOMES_DIA_SEMANA = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
];

// Retorna a data/hora atual já ajustada para o fuso de São Paulo.
function agora() {
  const agoraStr = new Date().toLocaleString('en-US', { timeZone: TIMEZONE });
  return new Date(agoraStr);
}

// Formata uma data (objeto Date) como "YYYY-MM-DD".
function formatarISO(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Formata uma data no padrão brasileiro "DD/MM/YYYY".
function formatarBR(dataISO) {
  const [ano, mes, dia] = dataISO.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Retorna o nome do dia da semana (sem acento, minúsculo) de uma data ISO "YYYY-MM-DD".
// Usado para casar com a coluna "dia_semana" da aba Horarios_Disponiveis.
// Converte "DD/MM/YYYY" para "YYYY-MM-DD".
function converterBRparaISO(dataBR) {
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

function nomeDiaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia);
  return NOMES_DIA_SEMANA[data.getDay()];
}

// Gera os próximos N dias úteis (segunda a sexta) a partir de amanhã,
// no formato { dataISO, dataBR, diaSemana, label }.
function proximosDiasUteis(quantidade = 7) {
  const dias = [];
  const cursor = agora();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // começa amanhã

  while (dias.length < quantidade) {
    const diaSemanaIndex = cursor.getDay();
    const ehFimDeSemana = diaSemanaIndex === 0 || diaSemanaIndex === 6;

    if (!ehFimDeSemana) {
      const dataISO = formatarISO(cursor);
      dias.push({
        dataISO,
        dataBR: formatarBR(dataISO),
        diaSemana: NOMES_DIA_SEMANA[diaSemanaIndex],
        label: `${formatarBR(dataISO)} (${capitalizar(NOMES_DIA_SEMANA[diaSemanaIndex])}-feira)`,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return dias;
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Combina data ISO ("YYYY-MM-DD") + horário ("HH:mm") em um objeto Date, no fuso de SP.
function combinarDataHorario(dataISO, horario) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const [hora, minuto] = horario.split(':').map(Number);
  return new Date(ano, mes - 1, dia, hora, minuto, 0, 0);
}

// Retorna a diferença em minutos entre agora e o horário do agendamento (positivo = futuro).
function minutosAte(dataISO, horario) {
  const alvo = combinarDataHorario(dataISO, horario);
  const diffMs = alvo.getTime() - agora().getTime();
  return Math.round(diffMs / 60000);
}

module.exports = {
  agora,
  formatarISO,
  formatarBR,
  converterBRparaISO,
  nomeDiaSemana,
  proximosDiasUteis,
  combinarDataHorario,
  minutosAte,
};
