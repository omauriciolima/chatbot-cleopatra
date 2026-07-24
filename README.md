# Chatbot Espaço Cleópatra

Chatbot de agendamento via WhatsApp para o Espaço Cleópatra (manicure), construído com Node.js/Express,
integrado à [Z-API](https://www.z-api.io) para envio/recebimento de mensagens e ao Google Sheets como
banco de dados de agendamentos e horários disponíveis.

## Funcionalidades

- **Fluxo de agendamento pelo WhatsApp**: clientes escolhem serviço, dia e horário disponível e recebem
  confirmação automática.
- **Comandos administrativos** para a manicure (`agenda hoje`, `agenda amanhã`, `cancelar [nome]`) via
  o número configurado em `NUMERO_MANICURE`.
- **Lembretes automáticos** de 24h e 2h antes do horário marcado, com job agendado que roda a cada 10
  minutos e evita reenvio duplicado.
- **Google Sheets como banco de dados**, sem necessidade de infraestrutura própria.

## Estrutura

```
src/
  index.js                   # servidor Express e webhook da Z-API
  handlers/
    clienteHandler.js        # fluxo de agendamento do cliente
    manicureHandler.js       # comandos administrativos
    lembreteHandler.js       # job de lembretes 24h/2h
  services/
    zapiService.js           # integração com a Z-API
    sheetsService.js         # integração com o Google Sheets
  utils/
    dateUtils.js
    stateManager.js
    textoUtils.js
```

## Como rodar

```bash
npm install
cp .env.example .env   # preencha as variáveis (veja docs/SETUP.md)
npm start               # ou npm run dev, com --watch
```

O servidor sobe em `http://localhost:3000` e expõe:

- `GET /` — health check
- `POST /webhook` — recebe as mensagens encaminhadas pela Z-API

## Setup completo

O passo a passo detalhado (planilha do Google Sheets, conta de serviço do Google, configuração da
Z-API, variáveis de ambiente e deploy no Railway) está em [`docs/SETUP.md`](docs/SETUP.md).
