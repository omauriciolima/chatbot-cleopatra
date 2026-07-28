# Chatbot Espaço Cleópatra

Chatbot de agendamento via WhatsApp para o Espaço Cleópatra (manicure), construído com Node.js/Express,
integrado à [Z-API](https://www.z-api.io) para envio/recebimento de mensagens e ao Google Sheets como
banco de dados de agendamentos e horários disponíveis.

## Funcionalidades

- **Fluxo de agendamento pelo WhatsApp**: clientes escolhem serviço, dia e horário disponível e recebem
  confirmação automática.
- **Memória de cliente recorrente**: reconhece clientes já cadastradas pelo telefone, cumprimenta pelo
  nome e oferece repetir o último serviço.
- **Fallback inteligente**: mensagens que o bot não entende mostram um menu com as principais ações
  (agendar, ver agendamento, cancelar/reagendar, preços, falar com a Cleópatra).
- **Cancelamento e reagendamento** self-service: a cliente encontra seu agendamento pelo telefone e
  escolhe cancelar ou remarcar.
- **Confirmação de presença** no lembrete de 24h (responde SIM/NÃO), cancelando automaticamente e
  avisando a manicure em caso de NÃO.
- **Lista de preços** sob demanda (`preços`, `valores`, `quanto custa`), editável no código.
- **Horário de funcionamento**: avisa quando o salão está fechado (seg a sáb, 9h–19h), mas o
  agendamento pelo bot continua disponível 24h.
- **Aviso de lotação**: se o dia escolhido estiver cheio, sugere os próximos dias com vaga.
- **Histórico da cliente**: guarda o último serviço e o total de visitas na aba Clientes.
- **Aviso de atraso** (comando da manicure `atraso [minutos]min`) para todas as clientes do dia.
- **Pesquisa de satisfação** 2h após o atendimento, com nota de 1 a 5 salva na aba Avaliacoes.
- **Comandos administrativos** para a manicure (`agenda hoje`, `agenda amanhã`, `cancelar [nome]`,
  `atraso [minutos]min`) via o número configurado em `NUMERO_MANICURE`.
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
