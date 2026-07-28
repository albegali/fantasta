import * as XLSX from 'xlsx';
import { Role } from '@prisma/client';

export interface ParsedPlayer {
  externalId?: number;
  name: string;
  realTeam: string;
  role: Role;
  quotation: number;
  fvm?: number;
}

const ROLE_MAP: Record<string, Role> = {
  P: Role.P,
  D: Role.D,
  C: Role.C,
  A: Role.A,
};

/** Normalizza le intestazioni per il matching (minuscolo, senza punti/spazi). */
function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[\s.]/g, '');
}

/**
 * Parser del file "Quotazioni" di Fantacalcio.it.
 * Il file ha spesso una riga-titolo iniziale; l'header vero contiene colonne
 * come: Id | R | RM | Nome | Squadra | Qt.A | Qt.I | ... | FVM.
 * Cerchiamo dinamicamente la riga header (quella con "nome" e "squadra").
 */
export function parseFantacalcioXlsx(buffer: Buffer): ParsedPlayer[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

  // Trova l'indice della riga header
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(norm);
    if (cells.includes('nome') && cells.includes('squadra')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('Header non trovato: assicurati sia il file Quotazioni di Fantacalcio.it');
  }

  const header = rows[headerIdx].map(norm);
  const col = (name: string) => header.indexOf(name);
  const idxId = col('id');
  const idxRole = col('r'); // ruolo classico
  const idxName = col('nome');
  const idxTeam = col('squadra');
  const idxQtA = col('qta') >= 0 ? col('qta') : col('qtaclassic');
  const idxFvm = col('fvm');

  const out: ParsedPlayer[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[idxName] ?? '').trim();
    const team = String(r[idxTeam] ?? '').trim();
    const roleRaw = String(r[idxRole] ?? '').trim().toUpperCase();
    if (!name || !team || !ROLE_MAP[roleRaw]) continue;

    out.push({
      externalId: idxId >= 0 && r[idxId] != null ? Number(r[idxId]) : undefined,
      name,
      realTeam: team,
      role: ROLE_MAP[roleRaw],
      quotation: idxQtA >= 0 ? Number(r[idxQtA]) || 1 : 1,
      fvm: idxFvm >= 0 && r[idxFvm] != null ? Number(r[idxFvm]) : undefined,
    });
  }
  return out;
}
