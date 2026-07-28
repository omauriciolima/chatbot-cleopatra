// Simulador do bot pelo terminal, sem precisar do WhatsApp/Z-API.
//
// Como funciona: usa o clienteHandler de verdade (o mesmo código que roda em produção) e a
// planilha real do Google Sheets (mesmas credenciais do .env) — só a parte de "mandar
// mensagem pelo WhatsApp" é substituída por um print colorido no terminal. Ou seja, dá pra
// testar o fluxo de agendamento de ponta a ponta e ver exatamente o que seria gravado na
// planilha, sem depender da Z-API.
//
// Atenção: se você completar um agendamento de verdade nesta simulação, o bot grava as
// linhas normalmente nas abas "Clientes" e "Agendamentos" da planilha real (usando o
// telefone fictício abaixo). Apague essas linhas de teste na planilha depois, se quiser.
//
// Uso: node teste-bot.js
//
// Comandos especiais durante a simulação:
//   .reset  -> limpa o estado da conversa (como se fosse uma cliente nova mandando "oi")
//   .sair   -> encerra o script

require('dotenv').config();

const readline = require('readline');
const zapiService = require('./src/services/zapiService');
const clienteHandler = require('./src/handlers/clienteHandler');
const { limparEstado } = require('./src/utils/stateManager');

const TELEFONE_TESTE = '5531999999999';

const COR_AZUL = '\x1b[34m';
const COR_VERDE = '\x1b[32m';
const COR_CINZA = '\x1b[90m';
const COR_VERMELHO = '\x1b[31m';
const COR_RESET = '\x1b[0m';

// Substitui as funções que fariam a chamada real pra Z-API por versões que só imprimem no
// terminal (em azul), simulando como a cliente veria a mensagem no WhatsApp. O restante do
// clienteHandler continua rodando normalmente (inclusive as leituras/escritas na planilha).
zapiService.enviarTexto = async (_telefone, mensagem) => {
  imprimirMensagemDoBot(mensagem);
};

zapiService.enviarOpcoes = async (_telefone, mensagem, opcoes) => {
  const mensagemComNumeros = `${mensagem}\n\n${opcoes.map((opcao, indice) => `${indice + 1}️⃣ ${opcao}`).join('\n')}`;
  imprimirMensagemDoBot(mensagemComNumeros);
};

function imprimirMensagemDoBot(mensagem) {
  console.log(`${COR_AZUL}🤖 Bot:\n${mensagem}${COR_RESET}\n`);
}

function imprimirMensagemDaCliente(mensagem) {
  console.log(`${COR_VERDE}👤 Cliente (${TELEFONE_TESTE}): ${mensagem}${COR_RESET}\n`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const PROMPT_CLIENTE = `${COR_VERDE}Você (cliente)> ${COR_RESET}`;

// Se o stdin fechar de um jeito inesperado (Ctrl+D, terminal fechado, entrada via pipe
// que acabou etc.), encerra graciosamente em vez de estourar um erro feio no terminal.
let encerrandoPorFechamentoDoStdin = false;
rl.on('close', () => {
  encerrandoPorFechamentoDoStdin = true;
  console.log(`${COR_CINZA}\nSimulação encerrada.${COR_RESET}`);
  process.exit(0);
});

function perguntar(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// Encaminha uma mensagem "da cliente" pro clienteHandler de verdade, do mesmo jeito que o
// webhook da Z-API faria, e mostra qualquer erro sem derrubar a simulação.
async function enviarComoCliente(texto) {
  imprimirMensagemDaCliente(texto);
  try {
    await clienteHandler.tratarMensagem(TELEFONE_TESTE, texto);
  } catch (erro) {
    console.log(`${COR_VERMELHO}⚠️  Erro ao processar a mensagem: ${erro.message}${COR_RESET}\n`);
  }
}

function imprimirInstrucoes() {
  console.log(`${COR_CINZA}=== Simulador do bot Espaço Cleópatra (sem WhatsApp) ===`);
  console.log(`Telefone fictício usado: ${TELEFONE_TESTE}`);
  console.log('Digite as respostas como se você fosse a cliente. Comandos especiais:');
  console.log('  .reset  -> reinicia a conversa (equivale a mandar "oi" de novo do zero)');
  console.log('  .sair   -> encerra o script');
  console.log('');
  console.log('Sugestões de fluxos para testar:');
  console.log('  1) Agendamento completo: depois do "oi" inicial, informe um nome e siga');
  console.log('     escolhendo serviço, dia e horário até confirmar');
  console.log('  2) Preços: digite "precos" (funciona em qualquer etapa da conversa)');
  console.log('  3) Fallback: digite ".reset" e, na sequência, algo sem sentido (ex: "asdkjh")');
  console.log('     — precisa ser logo após o ".reset" (no meio do fluxo, qualquer texto vira');
  console.log('     resposta da pergunta atual, ex: seu "nome")');
  console.log('  4) Cancelar/reagendar: digite ".reset" e, na sequência, "cancelar" — mesmo motivo');
  console.log('     do item acima (fora de um fluxo em andamento, "cancelar" busca um agendamento');
  console.log('     existente; durante um fluxo, "cancelar" só cancela o que está em andamento)');
  console.log(`${COR_RESET}`);
}

async function loop() {
  imprimirInstrucoes();

  // Passo 1: simula a cliente (nova ou recorrente, dependendo do que já existir na
  // planilha para esse telefone) mandando "oi" pra abrir a conversa.
  await enviarComoCliente('oi');

  // Passo 2 em diante: fica lendo o que você digitar e repassando pro bot, até ".sair"
  // (ou até o stdin fechar sozinho, tratado pelo listener "close" acima).
  while (!encerrandoPorFechamentoDoStdin) {
    const texto = await perguntar(PROMPT_CLIENTE);
    const textoLimpo = texto.trim();

    if (['.sair', 'sair', 'exit'].includes(textoLimpo.toLowerCase())) {
      break;
    }

    if (textoLimpo.toLowerCase() === '.reset') {
      limparEstado(TELEFONE_TESTE);
      console.log(`${COR_CINZA}(conversa reiniciada — mande "oi" para começar de novo)${COR_RESET}\n`);
      continue;
    }

    if (textoLimpo === '') {
      continue;
    }

    await enviarComoCliente(texto);
  }

  // Fecha a interface (dispara o listener "close" acima, que imprime a despedida e encerra
  // o processo) — não faz nada se já estiver fechando por causa do stdin ter terminado.
  if (!encerrandoPorFechamentoDoStdin) {
    rl.close();
  }
}

loop().catch((erro) => {
  console.error('Erro fatal na simulação:', erro);
  process.exitCode = 1;
});
