// Script de teste manual da integração com o Google Sheets.
//
// Não faz parte do fluxo do bot — é só uma ferramenta de diagnóstico pra conferir, antes de
// colocar o bot no ar, se GOOGLE_SHEETS_ID e GOOGLE_CREDENTIALS_PATH (do .env) estão certos e
// se a conta de serviço realmente tem permissão de leitura/escrita na planilha.
//
// Uso: node teste-sheets.js

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const ABA_HORARIOS = 'Horarios_Disponiveis';
const ABA_AGENDAMENTOS = 'Agendamentos';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// Linha de teste: usa telefone/data fictícios (fora de qualquer intervalo real) e status
// "teste" (diferente de "confirmado"/"cancelado") pra não interferir em nada do bot enquanto
// ela existir na planilha.
const LINHA_TESTE = ['TESTE AUTOMATIZADO', '5500000000000', 'Manicure', '01/01/2000', '00:00', 'teste'];

// Reproduz a mesma lógica de autenticação do sheetsService.js: lê o JSON da conta de serviço
// a partir do caminho indicado em GOOGLE_CREDENTIALS_PATH.
function carregarCredenciais() {
  const caminhoCredenciais = path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH || './credentials.json');
  const conteudo = fs.readFileSync(caminhoCredenciais, 'utf8');
  return JSON.parse(conteudo);
}

// 1. Conecta na Google Sheets usando as credenciais do .env.
async function conectar() {
  const credenciais = carregarCredenciais();
  const auth = new google.auth.JWT({
    email: credenciais.client_email,
    key: credenciais.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// 2. Lê a aba Horarios_Disponiveis.
async function lerHorariosDisponiveis(sheets) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_HORARIOS}!A2:C`,
  });
  return data.values || [];
}

// 3. Escreve a linha de teste ao final da aba Agendamentos e descobre em qual linha ela caiu.
async function escreverLinhaTeste(sheets) {
  const resposta = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A:J`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [LINHA_TESTE] },
  });

  // O range de retorno vem no formato "Agendamentos!A123:J123" — extraímos o número da linha dali.
  const rangeAtualizado = resposta.data.updates.updatedRange;
  const numeroLinha = parseInt(rangeAtualizado.match(/![A-Z]+(\d+)/)[1], 10);
  return numeroLinha;
}

// 4. Lê de volta a linha recém-escrita, pra confirmar que gravou certinho.
async function lerLinha(sheets, numeroLinha) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ABA_AGENDAMENTOS}!A${numeroLinha}:J${numeroLinha}`,
  });
  return (data.values || [])[0] || [];
}

// A API do Sheets não devolve células vazias no final da linha, então tiramos essas antes
// de comparar com o que foi escrito.
function semCelulasVaziasNoFinal(linha) {
  const copia = [...linha];
  while (copia.length > 0 && copia[copia.length - 1] === '') {
    copia.pop();
  }
  return copia;
}

// 5. Apaga a linha de teste (remove a linha inteira, não só o conteúdo).
async function apagarLinha(sheets, numeroLinha) {
  const sheetId = await obterSheetIdPorNome(sheets, ABA_AGENDAMENTOS);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: numeroLinha - 1, // índice 0-based
              endIndex: numeroLinha,
            },
          },
        },
      ],
    },
  });
}

async function obterSheetIdPorNome(sheets, nomeAba) {
  const { data } = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const aba = (data.sheets || []).find((s) => s.properties.title === nomeAba);
  if (!aba) {
    throw new Error(`Aba "${nomeAba}" não encontrada na planilha.`);
  }
  return aba.properties.sheetId;
}

async function main() {
  console.log('=== Teste de conexão com o Google Sheets ===\n');

  if (!SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEETS_ID não está definido no .env');
  }

  console.log('1. Conectando com a conta de serviço...');
  const sheets = await conectar();
  console.log('   ✅ Conectado com sucesso.\n');

  console.log(`2. Lendo a aba "${ABA_HORARIOS}"...`);
  const horarios = await lerHorariosDisponiveis(sheets);
  if (horarios.length === 0) {
    console.log('   ⚠️  Nenhum horário encontrado (aba vazia, ou nome/dados diferentes do esperado).\n');
  } else {
    console.log(`   ✅ ${horarios.length} horário(s) encontrado(s):`);
    horarios.forEach(([diaSemana, horario, disponivel]) => {
      console.log(`      - ${diaSemana} às ${horario} (disponível: ${disponivel})`);
    });
    console.log('');
  }

  console.log(`3. Escrevendo linha de teste na aba "${ABA_AGENDAMENTOS}"...`);
  const numeroLinha = await escreverLinhaTeste(sheets);
  console.log(`   ✅ Linha escrita na linha ${numeroLinha}.\n`);

  console.log('4. Lendo a linha escrita para confirmar...');
  const linhaLida = await lerLinha(sheets, numeroLinha);
  const confere =
    JSON.stringify(semCelulasVaziasNoFinal(linhaLida)) === JSON.stringify(semCelulasVaziasNoFinal(LINHA_TESTE));
  console.log(`   Linha lida: ${JSON.stringify(linhaLida)}`);
  console.log(`   ${confere ? '✅ Confere com o que foi escrito!' : '❌ Não bateu com o esperado!'}\n`);

  console.log('5. Apagando a linha de teste...');
  await apagarLinha(sheets, numeroLinha);
  console.log('   ✅ Linha de teste removida.\n');

  if (!confere) {
    throw new Error('A linha lida não bateu com a linha escrita — ver detalhes acima.');
  }

  console.log('=== Teste concluído com sucesso! A conexão com o Google Sheets está funcionando. ===');
}

main().catch((erro) => {
  console.error('\n❌ Erro durante o teste:', erro.message);
  process.exitCode = 1;
});
