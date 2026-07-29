/**
 * L'anello del countdown: percentuale, soglia dei 3 secondi e formato del
 * numero. Il tempo resta del server (`lot.endsAt` → `remainingSeconds`), qui si
 * verifica solo come lo si disegna.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuctionRules } from '../../core/auction-events';
import { AuctionStore } from '../../core/auction.store';
import { TimerRing } from './timer-ring';

const seconds = signal(0);
const rules = signal<Partial<AuctionRules> | null>({ bidTimerSeconds: 5 });

function render(remaining: number, timer = 5) {
  seconds.set(remaining);
  rules.set({ bidTimerSeconds: timer });
  const fixture = TestBed.createComponent(TimerRing);
  fixture.detectChanges();
  const ring = (fixture.nativeElement as HTMLElement).querySelector('.ring') as HTMLElement;
  const num = (fixture.nativeElement as HTMLElement).querySelector('.ring-num') as HTMLElement;
  return {
    pct: ring.style.getPropertyValue('--ring-pct').trim(),
    color: ring.style.getPropertyValue('--ring-color').trim(),
    text: num.textContent?.trim() ?? '',
    urgent: num.classList.contains('is-urgent'),
  };
}

describe('TimerRing', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuctionStore, useValue: { remainingSeconds: seconds, rules } }],
    });
  });

  it('la percentuale è il residuo sul timer di lega', () => {
    expect(render(5, 5).pct).toBe('100%');
    expect(render(2.5, 5).pct).toBe('50%');
    expect(render(0, 5).pct).toBe('0%');
  });

  it('sopra i 3 secondi: lime e secondi interi arrotondati per eccesso', () => {
    const v = render(4.2, 5);
    expect(v.text).toBe('5');
    expect(v.urgent).toBe(false);
    expect(v.color).toBe('var(--color-accent)');
  });

  it('sotto i 3 secondi: rosso e un decimale', () => {
    const v = render(2.4, 5);
    expect(v.text).toBe('2.4');
    expect(v.urgent).toBe(true);
    expect(v.color).toBe('var(--color-urgent)');
  });

  it('esattamente 3 secondi non è ancora urgenza', () => {
    expect(render(3, 5).urgent).toBe(false);
  });

  it('un residuo fuori scala non sfonda l’anello', () => {
    // `endsAt` più lontano del timer di lega (l'admin l'ha appena allungato)
    expect(render(9, 5).pct).toBe('100%');
    expect(render(-2, 5).pct).toBe('0%');
  });
});
