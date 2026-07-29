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

   | A | B | C | D | E | F | G | H | I | J |
   |---|---|---|---|---|---|---|---|---|---|
   | nome_cliente | telefone | servico | data | horario | status | lembrete_24h | lembrete_2h | confirmacao_presenca | feedback_enviado |

   > As colunas G a J (`lembrete_24h`, `lembrete_2h`, `confirmacao_presenca`, `feedback_enviado`) não
   > fazem parte do escopo original, mas são necessárias para o bot saber o que já enviou/perguntou
   > sobre cada agendamento e não repetir. Elas ficam em branco e o próprio bot preenche conforme o
   > fluxo acontece (`sim`/`nao`).

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
   | sabado | 09:00 | sim |
   | ... | ... | ... |

   - `dia_semana` deve ser um destes valores (minúsculo, sem acento): `segunda`, `terca`, `quarta`,
     `quinta`, `sexta`, `sabado`. O salão atende de segunda a sábado (veja "Horário de
     funcionamento" mais abaixo), então cadastre também os horários de sábado.
   - `disponivel` aceita "sim" ou "não" (também funciona "TRUE"/"FALSE"). Coloque "não" (ou apague a
     linha) para bloquear um horário específico.

4. Crie uma terceira aba chamada **Clientes**, usada para lembrar clientes recorrentes (feature de
   memória de cliente), com os cabeçalhos:

   | A | B | C | D | E |
   |---|---|---|---|---|
   | telefone | nome | ultimo_servico | total_visitas | data_cadastro |

   O bot preenche essa aba sozinho: cadastra a cliente assim que ela informa o nome, e depois de
   cada agendamento confirmado atualiza `ultimo_servico` e soma 1 em `total_visitas`.

   > O comando administrativo `nota [nome] [texto]` (ver README/manicureHandler) acrescenta
   > sozinho uma sexta coluna **F: observacoes**, na primeira vez que a manicure salvar uma nota.
   > Não precisa criar essa coluna com antecedência.

   > O bot também usa sozinho, sem precisar criar com antecedência, mais três colunas:
   > **G: data_ultimo_agendamento** (atualizada a cada agendamento confirmado),
   > **H: data_envio_saudade** (atualizada quando a mensagem de saudade é enviada) e
   > **I: lembrete_manutencao** (atualizada quando o lembrete de manutenção é enviado). G e H
   > alimentam a mensagem automática de saudade enviada todo dia às 10h pras clientes que não
   > agendam há mais de 30 dias, e G e I alimentam o lembrete de manutenção enviado às 11h pras
   > clientes que já passaram do prazo típico de durabilidade do último serviço (ver
   > lembreteHandler).

5. Crie uma quarta aba chamada **Avaliacoes**, usada para guardar as notas da pesquisa de
   satisfação enviada 2h após o atendimento, com os cabeçalhos:

   | A | B | C | D |
   |---|---|---|---|
   | telefone | nome | nota | data |

6. Crie uma quinta aba chamada **Dias_Bloqueados**, usada pelos comandos administrativos
   `folga DD/MM`, `ferias DD/MM ate DD/MM`, `bloquear HH:MM [DD/MM]` e `liberar HH:MM [DD/MM]`
   (ver README/manicureHandler), com os cabeçalhos:

   | A | B | C |
   |---|---|---|
   | data | motivo | horario |

   O bot preenche essa aba sozinho (`data` no formato `DD/MM/YYYY`, `motivo` = `folga`/`ferias`/
   `horario`). A coluna `horario` fica **vazia** para bloqueios do dia inteiro (`folga`/`ferias`)
   e preenchida (`HH:MM`) para bloqueios de um horário específico (`bloquear`). Ela é separada
   da aba **Horarios_Disponiveis** de propósito: aquela guarda a grade recorrente por dia da
   semana, então bloquear um dia ou horário específico ali bloquearia isso em todas as semanas
   futuras. Aqui cada linha bloqueia só uma data (ou data+horario) exata.

7. Copie o **ID da planilha** — é o trecho da URL entre `/d/` e `/edit`:
   `https://docs.google.com/spreadsheets/d/ESTE_TRECHO_AQUI/edit`

## 3. Criar a conta de serviço do Google (acesso à planilha)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto novo (ou use um existente).
3. Vá em **APIs e Serviços > Biblioteca**, procure por "Google Sheets API" e clique em **Ativar**.
4. Vá em **APIs e Serviços > Credenciais > Criar Credenciais > Conta de serviço**.
5. Dê um nome (ex: `chatbot-cleopatra`) e conclua a criação.
6. Abra a conta de serviço criada, vá na aba **Chaves > Adicionar Chave > Criar nova chave**, escolha
   **JSON** e baixe o arquivo.
7. Renomeie o arquivo baixado para `credentials.json` e coloque na raiz do projeto (mesma pasta do
   `package.json`). Esse nome já está protegido pelo `.gitignore` (padrão `credentials*.json`), então
   ele nunca é enviado ao GitHub. Se preferir guardar em outro lugar/nome, ajuste o caminho na
   variável `GOOGLE_CREDENTIALS_PATH` do `.env`.
8. **Compartilhe a planilha** com o e-mail da conta de serviço (campo `client_email` dentro do
   arquivo JSON), dando permissão de **Editor** — sem isso o bot não consegue ler nem escrever na
   planilha.

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
ZAPI_INSTANCE_ID=            # ID da instância Z-API
ZAPI_TOKEN=                   # Token da instância Z-API
ZAPI_BASE_URL=https://api.z-api.io   # normalmente não precisa mudar
ZAPI_CLIENT_TOKEN=            # Client-Token de segurança da conta Z-API
NUMERO_MANICURE=               # WhatsApp da manicure, só dígitos, ex: 5511999999999
GOOGLE_SHEETS_ID=              # ID da planilha
GOOGLE_CREDENTIALS_PATH=./credentials.json   # caminho do JSON da conta de serviço
PORT=3000
NOME_SALAO=Espaço Cleópatra
```

> `credentials.json` é o arquivo baixado no passo 3.7 acima. Ele contém uma chave privada — nunca
> commite esse arquivo. O `.gitignore` do projeto já ignora qualquer `credentials*.json`.

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
  `quinta`, `sexta` ou `sabado` (sem acento, minúsculo) e se `disponivel` está como "sim".
- **Mensagens de lista/botão não aparecem no WhatsApp**: a Z-API muda o formato desse endpoint de
  tempos em tempos. O bot já tem um fallback automático que envia as opções numeradas como texto
  simples nesse caso, então o fluxo continua funcionando mesmo assim. Se quiser corrigir a lista
  visual, confira o endpoint `send-option-list` na documentação atual da Z-API e ajuste apenas o
  arquivo `src/services/zapiService.js`.
