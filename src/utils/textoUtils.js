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

module.exports = {
  normalizarTexto,
  interpretarEscolha,
};
