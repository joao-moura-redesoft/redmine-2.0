// Bloco de notas pessoal, persistido por usuário do Redmine (cifrado via DPAPI).
const { dataFile, readJsonSecure, writeJsonSecure } = require('../lib/secureStore');

const NOTES_FILE = dataFile('notes.json');
let notesStore = readJsonSecure(NOTES_FILE, {}); // { [userId]: Note[] }
const saveNotes = () => writeJsonSecure(NOTES_FILE, notesStore);

function userNotes(userId) {
  if (!notesStore[userId]) notesStore[userId] = [];
  return notesStore[userId];
}

// Remove uma nota do usuário (reatribui o array filtrado no store).
function removeNote(userId, id) {
  notesStore[userId] = userNotes(userId).filter(n => n.id !== id);
  saveNotes();
}

module.exports = { userNotes, saveNotes, removeNote };
