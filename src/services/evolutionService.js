// Integração com a Evolution API: envio de mensagens de WhatsApp e leitura do webhook de entrada.

const axios = require('axios');

function montarHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.EVOLUTION_API_KEY
  };
}

// Evolution API espera: DDI+DDD+número, só dígitos, sem + ou espaços
function normalizarTelefone(telefone) {
  return (telefone || '').toString().replace(/\D/g, '');
}

// Envia mensagem de texto simples
async function enviarTexto(telefone, mensagem) {
  const url = `${process.env.EVOLUTION_BASE_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
  await axios.post(
    url,
    { number: normalizarTelefone(telefone), text: mensagem },
    { headers: montarHeaders() }
  );
}

// Evolution API não suporta listas nativas — envia como texto numerado
async function enviarOpcoes(telefone, mensagem, opcoes) {
  const mensagemComNumeros = `${mensagem}\n\n${opcoes.map((opcao, i) => `${i + 1}️⃣ ${opcao}`).join('\n')}`;
  await enviarTexto(telefone, mensagemComNumeros);
}

// Tipos de mensagem de texto válidos no webhook da Evolution API
const TIPOS_TEXTO = ['conversation', 'extendedTextMessage'];

function ehMensagemDeTexto(tipo) {
  return TIPOS_TEXTO.includes(tipo);
}

// Extrai telefone, texto, tipo e fromMe do payload do webhook da Evolution API
function extrairMensagemRecebida(payload) {
  const data = payload.data || {};
  const key = data.key || {};

  // Remove @s.whatsapp.net e normaliza
  const telefoneRaw = (key.remoteJid || '').replace('@s.whatsapp.net', '').replace('@g.us', '');
  const telefone = normalizarTelefone(telefoneRaw);
  const fromMe = Boolean(key.fromMe);
  const messageType = data.messageType || '';

  let texto = '';
  const message = data.message || {};
  if (message.conversation) {
    texto = message.conversation;
  } else if (message.extendedTextMessage) {
    texto = message.extendedTextMessage.text || '';
  }

  return { telefone, texto: texto.trim(), fromMe, tipo: messageType };
}

module.exports = {
  normalizarTelefone,
  enviarTexto,
  enviarOpcoes,
  extrairMensagemRecebida,
  ehMensagemDeTexto,
};
