# SETUP — Chatbot Espaço Cleópatra

Passo a passo completo pra deixar o bot funcionando: Google Sheets, Z-API e deploy no Railway.

## 1. Pré-requisitos

- Node.js 18 ou superior instalado (só necessário se for rodar localmente antes do deploy)
- Uma conta Google
- Uma conta na [Z-API](https://www.z-api.io) com um número de WhatsApp conectado
- Uma conta no [Railway](https://railway.app)
- Um repositório no GitHub com este código

## 2. Configurar a planilha do Google Sheets

1. Crie uma planilha nova no Google Sheets (pode chamar de "Espaço Cleópatra - Agendamentos").
2. Renomeie a primeira aba para **Agendamentos** e coloque na primeira linha estes cabeçalhos:

   | A | B | C | D | E | F | G | H |
   |---|---|---|---|---|---|---|---|
   | nome_cliente | telefone | servico | data | horario | status | lembrete_24h | lembrete_2h |

   > As colunas G e H (`lembrete_24h`, `lembrete_2h`) não fazem parte do escopo original, mas são
   > necessárias para o bot saber se já mandou o lembrete daquele agendamento e não mandar de novo.
   > Elas ficam em branco e o próprio bot preenche com "sim" quando envia cada lembrete.

3. Crie uma segunda aba chamada **Horarios_Disponiveis** com os cabeçalhos:

   | A | B | C |
   |---|---|---|
   | dia_semana | horario | disponivel |

   Preencha uma linha para cada horário que o salão atende, por exemplo:

   | dia_semana | horario | disponivel |
   |---|---|---|
   | segunda | 09:00 | sim |
   | segunda | 10:00 | sim |
   | segunda | 11:00 | sim |
   | terca | 09:00 | sim |
   | ... | ... | ... |

   - `dia_semana` deve ser um destes valores (minúsculo, sem acento): `segunda`, `terca`, `quarta`, `quinta`, `sexta`.
   - `disponivel` aceita "sim" ou "não" (também funciona "TRUE"/"FALSE"). Coloque "não" (ou apague a
     linha) para bloquear um horário específico.

4. Copie o **ID da planilha** — é o trecho da URL entre `/d/` e `/edit`:
   `https://docs.google.com/spreadsheets/d/ESTE_TRECHO_AQUI/edit`

## 3. Criar a conta de serviço do Google (acesso à planilha)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto novo (ou use um existente).
3. Vá em **APIs e Serviços > Biblioteca**, procure por "Google Sheets API" e clique em **Ativar**.
4. Vá em **APIs e Serviços > Credenciais > Criar Credenciais > Conta de serviço**.
5. Dê um nome (ex: `chatbot-cleopatra`) e conclua a criação.
6. Abra a conta de serviço criada, vá na aba **Chaves > Adicionar Chave > Criar nova chave**, escolha
   **JSON** e baixe o arquivo.
7. Abra o arquivo JSON baixado e copie dois valores:
   - `client_email` → vai na variável `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → vai na variável `GOOGLE_PRIVATE_KEY` (mantenha as quebras de linha `\n`)
8. **Compartilhe a planilha** com o e-mail da conta de serviço (o mesmo `client_email`), dando
   permissão de **Editor** — sem isso o bot não consegue ler nem escrever na planilha.

## 4. Configurar a Z-API

1. Crie uma instância em [app.z-api.io](https://app.z-api.io) e conecte o WhatsApp escaneando o QR Code.
2. Anote o **ID da instância** e o **Token** (aparecem no painel da instância).
3. Na aba **Segurança**, ative e copie o **Client-Token** da conta.
4. Configure o **webhook de mensagens recebidas** (na Z-API costuma se chamar "Ao receber",
   dentro de "Webhooks") apontando para:

   ```
   https://SEU-APP.up.railway.app/webhook
   ```

   (você só terá essa URL depois do deploy no Railway — pode voltar aqui pra configurar depois do passo 5)

## 5. Variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e preencha:

```
ZAPI_INSTANCE_ID=        # ID da instância Z-API
ZAPI_TOKEN=               # Token da instância Z-API
ZAPI_CLIENT_TOKEN=        # Client-Token de segurança da conta Z-API
NUMERO_MANICURE=          # WhatsApp da manicure, só dígitos, ex: 5511999999999
GOOGLE_SHEET_ID=          # ID da planilha
GOOGLE_SERVICE_ACCOUNT_EMAIL=   # client_email da conta de serviço
GOOGLE_PRIVATE_KEY=       # private_key da conta de serviço (com aspas e \n)
PORT=3000
NOME_SALAO=Espaço Cleópatra
```

## 6. Rodar localmente (opcional, pra testar antes do deploy)

```bash
npm install
npm start
```

O servidor sobe em `http://localhost:3000`. Para a Z-API conseguir chamar seu webhook local, use
uma ferramenta de túnel como o [ngrok](https://ngrok.com) (`ngrok http 3000`) e configure a URL
gerada (`https://xxxx.ngrok.app/webhook`) no painel da Z-API.

## 7. Deploy no Railway

1. Suba este código para um repositório no GitHub.
2. No [Railway](https://railway.app), clique em **New Project > Deploy from GitHub repo** e
   selecione o repositório.
3. Em **Variables**, adicione todas as variáveis listadas no passo 5 (as mesmas do `.env`).
4. O Railway detecta o `package.json` e roda `npm install` + `npm start` automaticamente.
5. Depois do primeiro deploy, vá em **Settings > Networking** e gere um domínio público
   (`Generate Domain`). Você vai receber uma URL tipo `https://chatbot-cleopatra.up.railway.app`.
6. Volte no painel da Z-API e configure o webhook de mensagens recebidas para:
   `https://chatbot-cleopatra.up.railway.app/webhook`

Pronto! Mande uma mensagem de teste pro número conectado na Z-API para conferir o fluxo de
agendamento, e mande "agenda hoje" do número configurado em `NUMERO_MANICURE` para testar os
comandos administrativos.

## 8. Testando o fluxo

- **Como cliente**: mande qualquer mensagem (ex: "oi") de um número diferente do
  `NUMERO_MANICURE`. O bot deve responder com as boas-vindas e seguir o fluxo até confirmar o
  agendamento — confira se a linha aparece na aba Agendamentos.
- **Como manicure**: mande `agenda hoje`, `agenda amanhã` ou `cancelar Nome da Cliente` a partir
  do número configurado em `NUMERO_MANICURE`.
- **Lembretes**: como o job roda a cada 10 minutos, para testar sem esperar 24h/2h de verdade,
  crie manualmente na planilha um agendamento com `data`/`horario` daqui a ~2h ou ~24h e confira
  se o lembrete chega e se a coluna correspondente (`lembrete_24h`/`lembrete_2h`) é marcada "sim".

## 9. Solução de problemas

- **Bot não responde nada**: confira nos logs do Railway se o webhook está sendo chamado e se não
  há erro de autenticação com o Google (`GOOGLE_PRIVATE_KEY` mal formatada é o erro mais comum —
  garanta que as quebras de linha `\n` estão preservadas).
- **"Nenhum horário disponível" mesmo tendo horários cadastrados**: confira se o valor de
  `dia_semana` na aba Horarios_Disponiveis está exatamente como `segunda`, `terca`, `quarta`,
  `quinta` ou `sexta` (sem acento, minúsculo) e se `disponivel` está como "sim".
- **Mensagens de lista/botão não aparecem no WhatsApp**: a Z-API muda o formato desse endpoint de
  tempos em tempos. O bot já tem um fallback automático que envia as opções numeradas como texto
  simples nesse caso, então o fluxo continua funcionando mesmo assim. Se quiser corrigir a lista
  visual, confira o endpoint `send-option-list` na documentação atual da Z-API e ajuste apenas o
  arquivo `src/services/zapiService.js`.
