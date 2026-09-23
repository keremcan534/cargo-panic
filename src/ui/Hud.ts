/**
 * Gameplay HUD: level identity, objective, remaining cargo, pause/restart,
 * the hazard countdown banner, and transient toasts.
 *
 * The hazard banner carries a warning icon (a shape, not just the red) and
 * the countdown as text, so it reads the same with reduced motion or
 * without colour.
 */

import type { HazardKind } from '../game/systems/HazardSystem';
import { fmt, t } from '../i18n';
import { el, iconBtn, uiRoot } from './dom';

const WARNING_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 1.6 20.6h20.8z" fill="#2a0503"/><path d="M12 9v5.4" stroke="#ff5f57" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="17.6" r="1.5" fill="#ff5f57"/></svg>';

export interface HudConfig {
  title: string;
  subtitle: string;
  subtitleGold?: boolean;
  objective: string;
  showRestart: boolean;
}

export class Hud {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private objectiveEl: HTMLElement;
  private remainingEl: HTMLElement;
  private banner: HTMLElement;
  private bannerText: HTMLElement;
  private bannerBar: HTMLElement;
  private bannerOn = false;
  private toasts: HTMLElement[] = [];
  private restartBtn: HTMLButtonElement | null;
  private pauseBtn: HTMLButtonElement;

  constructor(config: HudConfig, handlers: { onRestart: () => void; onPause: () => void }) {
    this.titleEl = el('div', { class: 'title', text: config.title });
    this.subtitleEl = el('div', {
      class: `subtitle ${config.subtitleGold ? 'gold' : ''}`,
      text: config.subtitle,
    });
    this.objectiveEl = el('div', { class: 'objective', text: config.objective });
    this.remainingEl = el('div', { class: 'remaining', text: '' });

    this.restartBtn = config.showRestart ? iconBtn('restart', handlers.onRestart, t('hud.restart')) : null;
    this.pauseBtn = iconBtn('pause', handlers.onPause, t('hud.pause'));
    const icons = el('div', { class: 'icons' }, [this.restartBtn, this.pauseBtn]);

    this.el = el('div', { class: 'hud' }, [
      el('div', {}, [this.titleEl, this.subtitleEl, this.objectiveEl]),
      el('div', { class: 'right' }, [icons, this.remainingEl]),
    ]);

    this.bannerText = el('span', { class: 'text' });
    this.bannerBar = el('i');
    this.banner = el('div', { class: 'hazard' }, [
      el('div', { class: 'line' }, [el('span', { class: 'warn-icon', html: WARNING_SVG }), this.bannerText]),
      el('div', { class: 'bar' }, [this.bannerBar]),
    ]);

    uiRoot().append(this.el, this.banner);
  }

  setRemaining(left: number, total: number) {
    this.remainingEl.textContent = t('hud.left', { left, total });
    this.remainingEl.classList.toggle('done', left === 0);
  }

  setObjective(text: string) {
    if (this.objectiveEl.textContent !== text) this.objectiveEl.textContent = text;
  }

  /** Re-reads the HUD's own labels after a language change (the controller re-sets the rest). */
  relabel() {
    for (const [b, key] of [
      [this.restartBtn, 'hud.restart'],
      [this.pauseBtn, 'hud.pause'],
    ] as const) {
      if (!b) continue;
      b.title = t(key);
      b.setAttribute('aria-label', t(key));
    }
  }

  setTitle(text: string) {
    this.titleEl.textContent = text;
  }

  setSubtitle(text: string) {
    this.subtitleEl.textContent = text;
  }

  pulseSubtitle() {
    this.subtitleEl.classList.add('pop');
    setTimeout(() => this.subtitleEl.classList.remove('pop'), 140);
  }

  showHazard(kind: HazardKind, remainingMs: number, totalMs: number) {
    if (!this.bannerOn) {
      this.bannerOn = true;
      this.banner.classList.add('on');
    }
    const secs = Math.max(0, remainingMs / 1000);
    this.bannerText.textContent = t('hud.fixIt', { hazard: t(`hazard.${kind}` as const), secs: fmt(secs) });
    const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
    this.bannerBar.style.transform = `scaleX(${ratio})`;
  }

  hideHazard() {
    if (!this.bannerOn) return;
    this.bannerOn = false;
    this.banner.classList.remove('on');
  }

  toast(message: string, tone: 'bad' | 'good' | 'info' = 'bad') {
    const t = el('div', { class: `toast ${tone}`, text: message });
    uiRoot().append(t);
    this.toasts.push(t);
    if (this.toasts.length > 3) this.toasts.shift()?.remove();
    setTimeout(() => {
      t.remove();
      const i = this.toasts.indexOf(t);
      if (i >= 0) this.toasts.splice(i, 1);
    }, 1050);
  }

  destroy() {
    this.el.remove();
    this.banner.remove();
    for (const t of this.toasts) t.remove();
    this.toasts = [];
  }
}
