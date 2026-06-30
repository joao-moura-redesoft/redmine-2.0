// Contas TOTP — as sementes vivem no cofre cifrado do servidor; o cliente só
// recebe o código atual já calculado, nunca a semente.
import axios from 'axios';

export interface TotpEntry {
  id: string;
  name: string;
  code: string;
}

export async function listTotp(): Promise<{ accounts: TotpEntry[]; remaining: number }> {
  const { data } = await axios.get('/api/secrets/totp');
  return { accounts: data.accounts ?? [], remaining: data.remaining ?? 30 };
}

export async function addTotp(name: string, secret: string): Promise<void> {
  await axios.post('/api/secrets/totp', { name, secret });
}

export async function deleteTotp(id: string): Promise<void> {
  await axios.delete(`/api/secrets/totp/${id}`);
}

// Migração: sobe contas TOTP antigas do localStorage pro cofre e apaga.
export async function migrateLegacyTotp(): Promise<void> {
  try {
    const raw = localStorage.getItem('totp_accounts');
    if (!raw) return;
    const list = JSON.parse(raw) as { name: string; secret: string }[];
    for (const a of list) {
      if (a?.name && a?.secret) {
        try {
          await addTotp(a.name, a.secret);
        } catch {
          /* ignora duplicados/erros */
        }
      }
    }
    localStorage.removeItem('totp_accounts');
  } catch {
    /* ignora */
  }
}
