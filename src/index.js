// Servidor Express: recebe o webhook da Z-API e encaminha a mensagem para o fluxo
// correto (cliente ou manicure), de acordo com o número que enviou a mensagem.

require('dotenv').config();

const express = require('express');
const zapiService = require('./services/zapiService');
const clienteHandler = require('./handlers/clienteHandler');
const manicureHandler = require('./handlers/manicureHandler');
const lembreteHandler = require('./handlers/lembreteHandler');

const app = express();
app.use(express.json());

const NUMERO_MANICURE = zapiService.normalizarTelefone(process.env.NUMERO_MANICURE);

// Health check simples, útil pro Railway saber que o serviço está de pé.
app.get('/', (req, res) => {
  res.send('Chatbot Espaço Cleópatra está rodando ✅');
});

app.post('/webhook', async (req, res) => {
  // Responde imediatamente pra Z-API não ficar tentando reenviar o webhook por timeout.
  res.sendStatus(200);

  try {
    const { telefone, texto, fromMe, tipo } = zapiService.extrairMensagemRecebida(req.body);

    // Mensagens de mídia (áudio, imagem, vídeo, documento, figurinha etc.) não têm "texto",
    // mas ainda assim são repassadas ao handler correto, que decide como responder a elas
    // (ver tratarMensagem em clienteHandler.js e manicureHandler.js).
    const ehTexto = zapiService.ehMensagemDeTexto(tipo);

    if (fromMe || !telefone || (ehTexto && !texto)) {
      return;
    }

    if (telefone === NUMERO_MANICURE) {
      await manicureHandler.tratarMensagem(telefone, texto, tipo);
    } else {
      await clienteHandler.tratarMensagem(telefone, texto, tipo);
    }
  } catch (erro) {
    console.error('Erro ao processar mensagem do webhook:', erro);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  lembreteHandler.iniciarAgendador();
});
