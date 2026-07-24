// Integração com a Z-API: envio de mensagens de WhatsApp e leitura do webhook de entrada.
//
// Atenção: a Z-API atualiza seus endpoints/payloads com alguma frequência.
// Os formatos usados aqui são os documentados em https://developer.z-api.io na época
// da criação deste bot — se algo não funcionar, confira a documentação atual e ajuste
// apenas este arquivo (o resto do sistema não depende do formato exato da Z-API).

const axios = require('axios');

function montarUrlBase() {
  const { ZAPI_INSTANCE_ID, ZAPI_TOKEN } = process.env;
  return `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}`;
}

function montarHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.ZAPI_CLIENT_TOKEN) {
    headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN;
  }
  return headers;
}

// Mantém só os dígitos do telefone (Z-API trabalha com DDI+DDD+número, sem "+" ou espaços).
function normalizarTelefone(telefone) {
  return (telefone || '').toString().replace(/\D/g, '');
}

// Envia uma mensagem de texto simples.
async function enviarTexto(telefone, mensagem) {
  const url = `${montarUrlBase()}/send-text`;
  await axios.post(
    url,
    { phone: normalizarTelefone(telefone), message: mensagem },
    { headers: montarHeaders() }
  );
}

// Envia uma mensagem com lista de opções (botão que abre uma lista no WhatsApp).
// `opcoes` é um array de strings. Também numeramos as opções no texto da mensagem,
// para que a cliente possa simplesmente digitar o número caso o WhatsApp dela não
// renderize bem mensagens de lista (ex: WhatsApp Web em alguns navegadores).
async function enviarOpcoes(telefone, mensagem, opcoes, tituloLista = 'Opções', textoBotao = 'Ver opções') {
  const mensagemComNumeros = `${mensagem}\n\n${opcoes.map((opcao, indice) => `${indice + 1}️⃣ ${opcao}`).join('\n')}`;

  try {
    const url = `${montarUrlBase()}/send-option-list`;
    await axios.post(
      url,
      {
        phone: normalizarTelefone(telefone),
        message: mensagemComNumeros,
        optionList: {
          title: tituloLista,
          buttonLabel: textoBotao,
          options: opcoes.map((opcao, indice) => ({ id: String(indice + 1), description: opcao })),
        },
      },
      { headers: montarHeaders() }
    );
  } catch (erro) {
    // Se o envio da lista/botão falhar (ex: mudança na API), garante que a cliente
    // ainda recebe as opções numeradas em texto simples e consegue continuar a conversa.
    console.error('Falha ao enviar lista de opções, enviando como texto simples:', erro.message);
    await enviarTexto(telefone, mensagemComNumeros);
  }
}

// Extrai telefone, texto e remetente de um payload recebido no webhook da Z-API.
// Cobre os formatos mais comuns: mensagem de texto simples, resposta de lista e resposta de botão.
function extrairMensagemRecebida(payload) {
  const telefone = normalizarTelefone(payload.phone);
  const fromMe = Boolean(payload.fromMe);

  let texto = '';
  if (payload.text && payload.text.message) {
    texto = payload.text.message;
  } else if (payload.listResponseMessage) {
    texto = payload.listResponseMessage.title || payload.listResponseMessage.selectedRowId || '';
  } else if (payload.buttonsResponseMessage) {
    texto = payload.buttonsResponseMessage.buttonText || payload.buttonsResponseMessage.message || '';
  }

  return { telefone, texto: texto.trim(), fromMe };
}

module.exports = {
  normalizarTelefone,
  enviarTexto,
  enviarOpcoes,
  extrairMensagemRecebida,
};
