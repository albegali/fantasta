/**
 * Le due regole dell'avatar-come-URL (PLAN.md, decisione 3): cosa si accetta di
 * spedire al server e cosa si disegna quando l'immagine non si carica.
 */

import { isAvatarUrl, photoUrl } from './ui';

describe('isAvatarUrl', () => {
  it('accetta http e https', () => {
    expect(isAvatarUrl('https://esempio.it/stemma.png')).toBe(true);
    expect(isAvatarUrl('http://esempio.it/stemma.png')).toBe(true);
    expect(isAvatarUrl('  https://esempio.it/stemma.png  ')).toBe(true);
  });

  it('accetta il vuoto: è il modo di togliere la foto', () => {
    expect(isAvatarUrl('')).toBe(true);
    expect(isAvatarUrl('   ')).toBe(true);
  });

  it('rifiuta un URL a metà, cioè quel che si sta ancora digitando', () => {
    expect(isAvatarUrl('h')).toBe(false);
    expect(isAvatarUrl('https:/')).toBe(false);
    expect(isAvatarUrl('esempio.it/stemma.png')).toBe(false);
  });

  it('rifiuta i data: URI — sarebbero un’immagine in DB, non un link', () => {
    expect(isAvatarUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });

  it('rifiuta gli schemi che non scaricano un’immagine', () => {
    expect(isAvatarUrl('javascript:alert(1)')).toBe(false);
    expect(isAvatarUrl('file:///Users/io/stemma.png')).toBe(false);
  });
});

describe('photoUrl', () => {
  it('senza URL si ricade sulle iniziali', () => {
    expect(photoUrl(null, null)).toBeNull();
    expect(photoUrl(undefined, null)).toBeNull();
    expect(photoUrl('   ', null)).toBeNull();
  });

  it('disegna l’immagine quando c’è', () => {
    expect(photoUrl('https://esempio.it/a.png', null)).toBe('https://esempio.it/a.png');
  });

  it('l’URL che ha già fallito non si ritenta: restano le iniziali', () => {
    const url = 'https://esempio.it/morto.png';
    expect(photoUrl(url, url)).toBeNull();
  });

  it('un URL corretto riprova da sé, senza azzerare niente', () => {
    expect(photoUrl('https://esempio.it/buono.png', 'https://esempio.it/morto.png')).toBe(
      'https://esempio.it/buono.png',
    );
  });
});
