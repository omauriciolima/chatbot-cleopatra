// Alias de compatibilidade: a integração de WhatsApp migrou para a Evolution API
// (ver src/services/evolutionService.js). Este arquivo existe só para não quebrar
// handlers que ainda importam './zapiService' diretamente.
module.exports = require('./evolutionService');
