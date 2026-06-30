// "Projetos" pessoais (boards): agrupadores próprios do usuário que organizam
// sprints em raias. Não têm relação com os projetos do Redmine. Persistidos por
// usuário e cifrados em repouso via DPAPI, igual a notas/sprints.
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const BOARDS_FILE = dataFile('boards.json');
let boardsStore = readJsonSecure(BOARDS_FILE, {}); // { [userId]: Board[] }
const saveBoards = () => writeJsonSecure(BOARDS_FILE, boardsStore);

function userBoards(userId) {
  if (!boardsStore[userId]) boardsStore[userId] = [];
  return boardsStore[userId];
}

function removeBoard(userId, id) {
  boardsStore[userId] = userBoards(userId).filter((b) => b.id !== id);
  saveBoards();
}

module.exports = { userBoards, saveBoards, removeBoard };
