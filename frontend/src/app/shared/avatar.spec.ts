/**
 * Che cosa finisce davvero nel DOM: la foto quando c'è, le iniziali quando manca
 * o quando l'immagine non si carica (l'URL è esterno, PLAN.md decisione 3).
 */

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Avatar } from './avatar';

@Component({
  imports: [Avatar],
  template: `<app-avatar [name]="name()" [src]="src()" [online]="online()" />`,
})
class Host {
  readonly name = signal<string | null>('Alberto');
  readonly src = signal<string | null>(null);
  readonly online = signal<boolean | null>(null);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  return {
    host: fixture.componentInstance,
    img: () => el().querySelector('img'),
    text: () => el().textContent?.trim() ?? '',
    sync: () => fixture.detectChanges(),
  };
}

describe('Avatar', () => {
  it('senza URL disegna le iniziali', () => {
    const v = render();
    expect(v.img()).toBeNull();
    expect(v.text()).toBe('AL');
  });

  it('con un URL disegna l’immagine, senza referrer verso il sito di terzi', () => {
    const v = render();
    v.host.src.set('https://esempio.it/stemma.png');
    v.sync();

    const img = v.img()!;
    expect(img.getAttribute('src')).toBe('https://esempio.it/stemma.png');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    // decorativa: il nome è già scritto accanto in ogni schermata
    expect(img.getAttribute('alt')).toBe('');
  });

  it('immagine che non si carica → si torna alle iniziali', () => {
    const v = render();
    v.host.src.set('https://esempio.it/morto.png');
    v.sync();
    v.img()!.dispatchEvent(new Event('error'));
    v.sync();

    expect(v.img()).toBeNull();
    expect(v.text()).toBe('AL');
  });

  it('un URL corretto dopo un fallimento riprova da sé', () => {
    const v = render();
    v.host.src.set('https://esempio.it/morto.png');
    v.sync();
    v.img()!.dispatchEvent(new Event('error'));
    v.sync();

    v.host.src.set('https://esempio.it/buono.png');
    v.sync();
    expect(v.img()?.getAttribute('src')).toBe('https://esempio.it/buono.png');
  });

  it('la foto convive con l’indicatore di presenza', () => {
    const v = render();
    v.host.src.set('https://esempio.it/stemma.png');
    v.host.online.set(true);
    v.sync();

    expect(v.img()).not.toBeNull();
    expect(v.img()!.closest('.avatar-wrap')).not.toBeNull();
    expect(
      (v.img()!.parentElement as HTMLElement).querySelector('.avatar-dot.is-online'),
    ).not.toBeNull();
  });
});
