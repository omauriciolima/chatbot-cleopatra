// Controle de estado da conversa de cada cliente.
// Guardado em memória (Map) — não precisa de banco de dados porque o fluxo
// é curto e, se o servidor reiniciar, o pior caso é o cliente recomeçar a conversa.

const ETAPAS = {
  INICIO: 'INICIO',
  AGUARDANDO_NOME: 'AGUARDANDO_NOME',
  AGUARDANDO_SERVICO: 'AGUARDANDO_SERVICO',
  AGUARDANDO_DIA: 'AGUARDANDO_DIA',
  AGUARDANDO_HORARIO: 'AGUARDANDO_HORARIO',
  AGUARDANDO_CONFIRMACAO: 'AGUARDANDO_CONFIRMACAO',
  // Cliente recorrente: pergunta se quer repetir o último serviço (feature 1).
  AGUARDANDO_REPETIR_SERVICO: 'AGUARDANDO_REPETIR_SERVICO',
  // Fluxo de cancelamento/reagendamento a partir do menu de fallback (feature 3).
  AGUARDANDO_CANCELAR_OU_REAGENDAR: 'AGUARDANDO_CANCELAR_OU_REAGENDAR',
  // Resposta ao lembrete de 24h perguntando se a cliente confirma presença (feature 4).
  AGUARDANDO_CONFIRMACAO_PRESENCA: 'AGUARDANDO_CONFIRMACAO_PRESENCA',
  // Resposta à pesquisa de satisfação enviada 2h após o horário (feature 10).
  AGUARDANDO_AVALIACAO: 'AGUARDANDO_AVALIACAO',
};

// telefone -> { etapa, nome, servico, dataISO, dataBR, horario, diasDisponiveis,
//               horariosDisponiveis, ultimoServico, agendamentoParaCancelar,
//               confirmacaoPresenca, avaliacaoNome }
const estados = new Map();

function obterEstado(telefone) {
  if (!estados.has(telefone)) {
    estados.set(telefone, { etapa: ETAPAS.INICIO });
  }
  return estados.get(telefone);
}

function atualizarEstado(telefone, dadosParciais) {
  const estadoAtual = obterEstado(telefone);
  const novoEstado = { ...estadoAtual, ...dadosParciais };
  estados.set(telefone, novoEstado);
  return novoEstado;
}

function limparEstado(telefone) {
  estados.delete(telefone);
}

module.exports = {
  ETAPAS,
  obterEstado,
  atualizarEstado,
  limparEstado,
};
