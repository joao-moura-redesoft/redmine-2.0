// Sprints pessoais (Opção B): agrupamento próprio do Bluemine, fora do Redmine.
// Cada sprint guarda apenas IDs de issue (de qualquer projeto). Persistido por
// usuário do Redmine e cifrado em repouso via DPAPI, igual ao bloco de notas.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const SPRINTS_FILE = dataFile('sprints.json');
let sprintsStore = readJsonSecure(SPRINTS_FILE, {}); // { [userId]: Sprint[] }
const saveSprints = () => writeJsonSecure(SPRINTS_FILE, sprintsStore);

function userSprints(userId) {
  if (!sprintsStore[userId]) sprintsStore[userId] = [];
  return sprintsStore[userId];
}

// Remove uma sprint do usuário (reatribui o array filtrado no store).
function removeSprint(userId, id) {
  sprintsStore[userId] = userSprints(userId).filter(s => s.id !== id);
  saveSprints();
}

module.exports = { userSprints, saveSprints, removeSprint };
