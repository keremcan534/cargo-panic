/**
 * The balance readout: live left/right torque, a needle for the current lean,
 * and a ghost needle previewing the drop being dragged. The preview is what
 * makes the system feel predictable rather than punishing.
 */

import type { BalanceStatus } from '../game/systems/BalanceSystem';
import { fmt, t } from '../i18n';
import { el, uiRoot } from './dom';

export class Meter {
  readonly el: HTMLElement;
  private delta: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private needle: HTMLElement;
  private ghost: HTMLElement;
  private fill: HTMLElement;
  private track: HTMLElement;

  private tolerance: number;
  private displayNet = 0;
  private targetNet = 0;
  private status: BalanceStatus = 'stable';

  constructor(tolerance: number) {
    this.tolerance = Math.max(0.001, tolerance);

    this.delta = el('div', { class: 'delta stable', text: `${fmt(0)} / ${fmt(this.tolerance)}` });
    this.needle = el('div', { class: 'needle' });
    this.ghost = el('div', { class: 'ghost' });
    this.fill = el('div', { class: 'fill' });
    this.left = el('span', { text: t('meter.left', { v: fmt(0) }) });
    this.right = el('span', { text: t('meter.right', { v: fmt(0) }) });

    this.track = el('div', { class: 'track' }, [
      el('div', { class: 'zones' }),
      el('div', { class: 'tick', style: { left: '18.75%' } }),
      el('div', { class: 'tick', style: { left: '81.25%' } }),
      this.fill,
      el('div', { class: 'centre' }),
      this.ghost,
      this.needle,
    ]);

    this.el = el('div', { class: 'meter' }, [
      el('div', { class: 'row' }, [el('div', { class: 'label', text: t('meter.label') }), this.delta]),
      this.track,
      el('div', { class: 'lr' }, [this.left, this.right]),
    ]);
    uiRoot().append(this.el);
  }

  /** The bar spans +-tolerance*1.6; the needle stays inside by 4%. */
  private pct(net: number) {
    const range = this.tolerance * 1.6;
    const c = Math.max(-1, Math.min(1, net / range));
    return c * 46;
  }

  showPreview(net: number) {
    this.ghost.style.transform = `translateX(${(this.pct(net) / 100) * this.track.clientWidth}px)`;
    this.ghost.classList.add('on');
  }

  hidePreview() {
    this.ghost.classList.remove('on');
  }

  setValue(net: number, leftTorque: number, rightTorque: number, status: BalanceStatus) {
    this.targetNet = net;
    const imbalance = Math.abs(net);
    this.delta.textContent = `${fmt(imbalance)} / ${fmt(this.tolerance)}`;
    if (status !== this.status) {
      this.status = status;
      this.delta.className = `delta ${status}`;
      this.fill.style.background =
        status === 'stable' ? 'var(--good)' : status === 'risky' ? 'var(--warn)' : 'var(--bad)';
    }
    this.left.textContent = t('meter.left', { v: fmt(leftTorque) });
    this.right.textContent = t('meter.right', { v: fmt(rightTorque) });
    this.left.classList.toggle('lit', net < -0.05);
    this.right.classList.toggle('lit', net > 0.05);
  }

  /** Smoothly chases the target so the needle swings instead of snapping. */
  tick(dtMs: number) {
    const k = 1 - Math.pow(0.001, dtMs / 1000);
    this.displayNet += (this.targetNet - this.displayNet) * k;
    if (Math.abs(this.targetNet - this.displayNet) < 0.002) this.displayNet = this.targetNet;
    const w = this.track.clientWidth;
    const px = (this.pct(this.displayNet) / 100) * w;
    this.needle.style.transform = `translateX(${px}px)`;
    if (px >= 0) {
      this.fill.style.left = '50%';
      this.fill.style.width = `${px}px`;
    } else {
      this.fill.style.left = `calc(50% - ${-px}px)`;
      this.fill.style.width = `${-px}px`;
    }
  }

  destroy() {
    this.el.remove();
  }
}
