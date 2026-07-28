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

// Gera os próximos N dias de funcionamento do salão (segunda a sábado — feature 6) a
// partir de amanhã, no formato { dataISO, dataBR, diaSemana, label }.
function proximosDiasUteis(quantidade = 7) {
  const dias = [];
  const cursor = agora();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // começa amanhã

  while (dias.length < quantidade) {
    const diaSemanaIndex = cursor.getDay();
    const ehDomingo = diaSemanaIndex === 0; // salão fecha só aos domingos

    if (!ehDomingo) {
      const dataISO = formatarISO(cursor);
      dias.push({
        dataISO,
        dataBR: formatarBR(dataISO),
        diaSemana: NOMES_DIA_SEMANA[diaSemanaIndex],
        label: `${formatarBR(dataISO)} (${rotuloDiaSemana(diaSemanaIndex)})`,
      });
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return dias;
}

// Sábado e domingo não usam o sufixo "-feira" ("Sábado-feira" não existe).
function rotuloDiaSemana(diaSemanaIndex) {
  if (diaSemanaIndex === 6) return 'Sábado';
  if (diaSemanaIndex === 0) return 'Domingo';
  return `${capitalizar(NOMES_DIA_SEMANA[diaSemanaIndex])}-feira`;
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

// Feature 6 (horário de funcionamento): true se agora está dentro do funcionamento do
// salão (segunda a sábado, 9h às 19h). O agendamento pelo bot continua liberado 24h,
// esta função só é usada para decidir se mostramos o aviso de "estamos fechados".
function estaDentroDoHorarioComercial() {
  const data = agora();
  const diaSemanaIndex = data.getDay(); // 0=domingo ... 6=sábado
  const hora = data.getHours();

  const ehDiaUtilOuSabado = diaSemanaIndex >= 1 && diaSemanaIndex <= 6;
  const dentroDoHorario = hora >= 9 && hora < 19;

  return ehDiaUtilOuSabado && dentroDoHorario;
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
  estaDentroDoHorarioComercial,
};
