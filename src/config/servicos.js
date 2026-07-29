// Configuração central dos serviços do salão: nomes, preços e emojis usados nas mensagens.
// Fica num módulo só (em vez de duplicado em clienteHandler e manicureHandler) porque tanto
// o menu de agendamento/preços quanto o cálculo de faturamento precisam bater com os mesmos
// valores — a manicure pode editar os preços aqui diretamente no código.

const SERVICOS = ['Manicure', 'Pedicure', 'Manicure + Pedicure', 'Alongamento em Gel'];

const SERVICOS_PRECOS = {
  Manicure: 25,
  Pedicure: 30,
  'Manicure + Pedicure': 50,
  'Alongamento em Gel': 120,
};

const SERVICOS_EMOJI = {
  Manicure: '💅',
  Pedicure: '🦶',
  'Manicure + Pedicure': '💅🦶',
  'Alongamento em Gel': '💎',
};

// Prazo (em dias) até o serviço "vencer" e valer a pena lembrar a cliente de agendar uma
// manutenção (ver lembreteHandler.js). Cada serviço tem uma durabilidade típica diferente.
const PRAZOS_MANUTENCAO_DIAS = {
  Manicure: 15,
  Pedicure: 20,
  'Manicure + Pedicure': 15,
  'Alongamento em Gel': 21,
};

module.exports = {
  SERVICOS,
  SERVICOS_PRECOS,
  SERVICOS_EMOJI,
  PRAZOS_MANUTENCAO_DIAS,
};
