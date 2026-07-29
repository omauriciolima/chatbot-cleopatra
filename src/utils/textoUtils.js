// Funções auxiliares para interpretar texto digitado pela cliente (com ou sem acento,
// maiúsculas/minúsculas, respondendo pelo número da opção ou pelo nome dela).

const MAPA_ACENTOS = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ç: 'c',
};

function normalizarTexto(texto) {
  return (texto || '')
    .toString()
    .trim()
    .toLowerCase()
    .split('')
    .map((caractere) => MAPA_ACENTOS[caractere] || caractere)
    .join('');
}

// Tenta descobrir qual opção (0-based) a cliente escolheu, aceitando:
//  - o número da opção ("2")
//  - o texto da opção, completo ou parcial ("pedicure" casa com "Pedicure")
// Retorna -1 se não encontrar nenhuma correspondência.
function interpretarEscolha(textoRecebido, opcoes) {
  const textoNormalizado = normalizarTexto(textoRecebido);

  const comoNumero = parseInt(textoNormalizado, 10);
  if (!Number.isNaN(comoNumero) && comoNumero >= 1 && comoNumero <= opcoes.length) {
    return comoNumero - 1;
  }

  const indicePorTexto = opcoes.findIndex((opcao) => {
    const opcaoNormalizada = normalizarTexto(opcao);
    return opcaoNormalizada === textoNormalizado || opcaoNormalizada.includes(textoNormalizado);
  });

  return indicePorTexto;
}

// Nomes das intenções que detectarIntencao reconhece (ver PALAVRAS_CHAVE_POR_INTENCAO logo
// abaixo). Uso o mesmo padrão de "objeto de constantes" já usado em stateManager.ETAPAS.
const INTENCOES = {
  PRECO: 'PRECO',
  CANCELAR: 'CANCELAR',
  VER_AGENDAMENTO: 'VER_AGENDAMENTO',
  FALAR_CLEOPATRA: 'FALAR_CLEOPATRA',
  PAGAMENTO: 'PAGAMENTO',
  LOCALIZACAO: 'LOCALIZACAO',
  AGENDAR: 'AGENDAR',
};

// Cada intenção tem uma lista de palavras/expressões-chave que, se aparecerem em qualquer
// parte da mensagem, indicam essa intenção. A ORDEM das chaves importa: é a ordem em que
// detectarIntencao testa cada intenção, e algumas palavras-chave são substrings de outras
// (ex: "horario" aparece tanto em VER_AGENDAMENTO — "tenho horario" — quanto em AGENDAR),
// então as intenções mais específicas (frases inteiras) vêm antes das mais genéricas (uma
// palavra só), pra frase específica não ser "engolida" pela palavra genérica.
const PALAVRAS_CHAVE_POR_INTENCAO = {
  // "fica" foi retirado daqui (e só ficou em LOCALIZACAO, mais abaixo): as duas intenções
  // usam essa palavra sozinha ("quanto fica" vs "onde fica"), mas PRECO já tem "quanto" pra
  // cobrir esse caso, então "fica" isolado é bem mais associado a "onde fica o salão".
  [INTENCOES.PRECO]: [
    'preço', 'preços', 'valor', 'valores', 'quanto', 'custa', 'tabela', 'cobram', 'cobrar', 'custo',
  ],
  [INTENCOES.CANCELAR]: [
    'cancelar', 'cancela', 'cancelo', 'desmarcar', 'desmarco', 'desmarque', 'não vou', 'nao vou',
  ],
  [INTENCOES.VER_AGENDAMENTO]: [
    'meu agendamento', 'minha agenda', 'quando marquei', 'que dia marquei',
    'tenho horário', 'tenho horario', 'meu horário', 'meu horario',
  ],
  [INTENCOES.FALAR_CLEOPATRA]: [
    'falar com', 'chamar', 'atendente', 'humano', 'pessoa',
    'cleópatra', 'cleopatra', 'responsável', 'responsavel', 'dono', 'dona',
  ],
  [INTENCOES.PAGAMENTO]: [
    'pagamento', 'pagar', 'pix', 'cartão', 'cartao', 'dinheiro', 'aceita', 'forma', 'troco',
  ],
  [INTENCOES.LOCALIZACAO]: [
    'onde', 'endereço', 'endereco', 'localização', 'localizacao', 'fica', 'como chego', 'maps', 'chegar',
  ],
  [INTENCOES.AGENDAR]: [
    'agendar', 'agenda', 'marcar', 'marca', 'quero marcar', 'quero agendar', 'horário', 'horario',
  ],
};

// Pré-normaliza as palavras-chave uma única vez (em vez de normalizar a cada chamada de
// detectarIntencao), já que a lista acima é fixa.
const PALAVRAS_CHAVE_NORMALIZADAS = Object.fromEntries(
  Object.entries(PALAVRAS_CHAVE_POR_INTENCAO).map(([intencao, palavras]) => [
    intencao,
    palavras.map((palavra) => normalizarTexto(palavra)),
  ])
);

// Reconhece a intenção da cliente por palavras-chave, em linguagem natural (não precisa ser
// a frase exata) — ex: "quanto custa a manicure?" ou "quero marcar um horário" também são
// reconhecidas, não só "preço" ou "agendar" isoladas. Retorna uma das chaves de INTENCOES, ou
// null se a mensagem não contiver nenhuma palavra-chave conhecida.
function detectarIntencao(mensagem) {
  const textoNormalizado = normalizarTexto(mensagem);
  if (!textoNormalizado) return null;

  for (const [intencao, palavrasChave] of Object.entries(PALAVRAS_CHAVE_NORMALIZADAS)) {
    if (palavrasChave.some((palavra) => textoNormalizado.includes(palavra))) {
      return intencao;
    }
  }

  return null;
}

// Humanização (persona Cléo): listas de frases que o bot sorteia aleatoriamente em vez de
// repetir sempre o mesmo texto, usadas junto com sortearFrase() nos handlers.
const FRASES_CONFIRMACAO = ['Ótimo! 😊', 'Perfeito! 💅', 'Que boa escolha! ✨', 'Adorei! 👑', 'Maravilha! 😍'];

const FRASES_DESPEDIDA = [
  'Até logo! 💙', 'Te esperamos! 👑', 'Vai ficar linda! 💅✨', 'Até breve! 😊', 'Com carinho, Cléo 💕',
];

const FRASES_NAO_ENTENDI = [
  'Hmm, não entendi muito bem 😅', 'Pode repetir de outro jeito? 😊',
  'Não captei bem, me diz de novo! 💕', 'Eita, não entendi! Me ajuda? 😅',
];

// Sorteia aleatoriamente uma frase de uma lista (ex: FRASES_CONFIRMACAO), pra variar as
// respostas do bot em vez de repetir sempre o mesmo texto.
function sortearFrase(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

module.exports = {
  normalizarTexto,
  interpretarEscolha,
  INTENCOES,
  detectarIntencao,
  sortearFrase,
  FRASES_CONFIRMACAO,
  FRASES_DESPEDIDA,
  FRASES_NAO_ENTENDI,
};
