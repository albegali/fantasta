/**
 * L'avatar è un URL esterno (PLAN.md, decisione 3) e il DTO è l'unico posto che
 * decide cosa entra in DB. Il decoratore composto `IsAvatarUrl` mette insieme tre
 * casi che è facile rompere senza accorgersene: campo assente, campo svuotato
 * (= togli la foto) e URL non scaricabile.
 */

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateParticipantDto } from './participant.dto';

/** I nomi dei campi che il DTO ha bocciato. */
function errors(body: Record<string, unknown>): string[] {
  const dto = plainToInstance(UpdateParticipantDto, body);
  return validateSync(dto).map((e) => e.property);
}

describe('UpdateParticipantDto · avatarUrl', () => {
  it('accetta http e https', () => {
    expect(errors({ avatarUrl: 'https://esempio.it/stemma.png' })).toEqual([]);
    expect(errors({ avatarUrl: 'http://esempio.it/stemma.png' })).toEqual([]);
  });

  it('accetta il campo assente: il PATCH è parziale', () => {
    expect(errors({ teamName: 'Solo il nome' })).toEqual([]);
  });

  it('accetta la stringa vuota: è il modo di togliere la foto', () => {
    expect(errors({ avatarUrl: '' })).toEqual([]);
  });

  it('rifiuta un URL senza schema', () => {
    expect(errors({ avatarUrl: 'esempio.it/stemma.png' })).toEqual(['avatarUrl']);
  });

  it('rifiuta i data: URI — sarebbero storage, non un link', () => {
    expect(errors({ avatarUrl: 'data:image/png;base64,iVBORw0KGgo=' })).toEqual(['avatarUrl']);
  });

  it('rifiuta gli schemi che non scaricano un’immagine', () => {
    expect(errors({ avatarUrl: 'javascript:alert(1)' })).toEqual(['avatarUrl']);
    expect(errors({ avatarUrl: 'file:///Users/io/stemma.png' })).toEqual(['avatarUrl']);
  });

  it('rifiuta un URL lunghissimo: è un link, non un payload', () => {
    expect(errors({ avatarUrl: `https://esempio.it/${'a'.repeat(2100)}.png` })).toEqual([
      'avatarUrl',
    ]);
  });

  it('rifiuta un valore che non è una stringa', () => {
    expect(errors({ avatarUrl: 42 })).toEqual(['avatarUrl']);
  });
});
