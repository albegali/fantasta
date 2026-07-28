import { Injectable, signal } from '@angular/core';

/**
 * Suono e vibrazione dei rilanci. Il toggle nella UI comanda questo servizio:
 * niente asset audio, un bip sintetizzato con WebAudio più `navigator.vibrate`
 * dove esiste. Silenzioso di default finché l'utente non interagisce (i browser
 * bloccano l'AudioContext prima del primo gesto).
 */
@Injectable({ providedIn: 'root' })
export class AlertsService {
  readonly enabled = signal(true);

  private ctx: AudioContext | null = null;
  /**
   * Finché l'utente non tocca la pagina, browser e OS rifiutano audio e
   * vibrazione (e lo scrivono in console). Restiamo zitti fino al primo gesto.
   */
  private unlocked = false;

  constructor() {
    const unlock = (): void => {
      this.unlocked = true;
    };
    addEventListener('pointerdown', unlock, { once: true, passive: true });
    addEventListener('keydown', unlock, { once: true });
  }

  toggle(): void {
    this.enabled.update((v) => !v);
    if (this.enabled()) this.blip(880, 0.05);
  }

  /** Rilancio altrui / nuova chiamata. */
  bid(): void {
    this.blip(660, 0.05);
    this.vibrate(20);
  }

  /** Tocca a te chiamare. */
  yourTurn(): void {
    this.blip(520, 0.09);
    this.vibrate([30, 60, 30]);
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.enabled() || !this.unlocked) return;
    navigator.vibrate?.(pattern);
  }

  private blip(frequency: number, seconds: number): void {
    if (!this.enabled() || !this.unlocked) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = frequency;
      osc.type = 'sine';
      gain.gain.value = 0.05;
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + seconds);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + seconds);
    } catch {
      // Audio non disponibile (contesto bloccato, browser senza WebAudio): silenzio.
    }
  }
}
