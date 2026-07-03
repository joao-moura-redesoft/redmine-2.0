// Helper único para os stores em arquivo JSON (cifrados ou não em repouso).
//
// Hoje cada store (secretsStore, notesStore, boardsStore, sprintsStore,
// talkStore) reimplementa o mesmo trio: carregar na inicialização, manter em
// memória e reescrever o arquivo inteiro a cada mudança. Este helper centraliza
// esse padrão para código novo e serve de ponto único quando a persistência for
// trocada por um banco transacional (ver docs/CENTRALIZACAO-SERVIDOR-UNICO.md).
//
//   const store = createJsonStore('ai-usage.json', { fallback: {} });
//   store.data[uid] = ...;
//   store.save();
const { dataFile, readJsonSecure, writeJsonSecure } = require('./secureStore');

function createJsonStore(filename, { fallback = {}, encrypted = false } = {}) {
  const file = dataFile(filename);
  let data = readJsonSecure(file, fallback);

  return {
    get data() {
      return data;
    },
    // Permite reatribuir a coleção inteira (ex.: subscriptions = subscriptions.filter(...)).
    set data(next) {
      data = next;
    },
    // Persiste em disco. Nunca deixa um erro de cifragem derrubar o processo
    // quando chamado de dentro de um loop/timer — o chamador decide se propaga.
    save() {
      writeJsonSecure(file, data, { requireEncryption: encrypted });
    },
    file,
  };
}

module.exports = { createJsonStore };
