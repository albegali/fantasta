import { Player as PlayerRecord } from '@prisma/client';
import { Player } from '../auction/dto/events';

/**
 * Riga `Player` del DB → `Player` del contratto. Unico punto in cui `realTeam`
 * (nome interno, distingue la squadra di Serie A dalla squadra fantacalcio)
 * diventa `team` per i client.
 */
export function toPlayerView(row: PlayerRecord): Player {
  return {
    id: row.id,
    name: row.name,
    team: row.realTeam,
    role: row.role,
    quotation: row.quotation,
  };
}
