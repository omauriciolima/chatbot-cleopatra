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
};

// telefone -> { etapa, nome, servico, dataISO, dataBR, horario, diasDisponiveis, horariosDisponiveis }
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
