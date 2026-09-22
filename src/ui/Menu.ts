/**
 * Title screen: a lit hero rack swaying in the 3D scene, DOM controls over it.
 */

import * as THREE from 'three';
import type { AppContext, Screen } from '../app/Router';
import { gameScreen } from '../app/Game';
import { TOTAL_LEVELS } from '../game/levels/levels';
import type { LevelDef, PackageType } from '../game/levels/types';
import { audio } from '../game/systems/AudioManager';
import { progress } from '../game/systems/ProgressManager';
import { formatScore, newRun, seedFromUrl } from '../game/systems/RunManager';
import { Easing } from '../render/Tween';
import { Warehouse } from '../render/three/Warehouse';
import { Cargo3D } from '../render/three/world/Cargo3D';
import { Rack3D } from '../render/three/world/Rack3D';
import { levelSelectScreen } from './LevelSelect';
import { btn, el, fadeIn, fadeOut, iconBtn, setIcon, uiRoot } from './dom';

const HERO: LevelDef = {
  id: 0,
  name: 'HERO',
  objective: '',
  shelves: [
    { slots: 6, maxWeight: 99 },
    { slots: 6, maxWeight: 99 },
  ],
  packages: [],
  balanceTolerance: 99,
};

const HERO_CARGO: [PackageType, number, number][] = [
  ['heavy', 1, 0],
  ['standard', 1, 1],
  ['fragile', 1, 3],
  ['standard', 1, 4],
  ['long', 0, 0],
  ['priority', 0, 4],
];

export function menuScreen(ctx: AppContext): Screen {
  const { renderer } = ctx;
  let root: HTMLElement;
  let warehouse: Warehouse;
  let rack: Rack3D;
  let cargo: Cargo3D[] = [];
  let stopSway: (() => void) | undefined;
  let offFrame: (() => void) | undefined;

  const go = (factory: Parameters<typeof ctx.router.go>[0]) => {
    void fadeOut(200).then(() => ctx.router.go(factory));
  };

  return {
    enter() {
      renderer.frame(2, 6);
      // The hero rack sits a little lower so the wordmark has the top third.
      renderer.camera.position.y += 0.4;
      renderer.camera.lookAt(0, 0.7, 0);

      rack = new Rack3D(renderer.tweens, HERO, renderer.scene);
      warehouse = new Warehouse({ rackHalfWidth: rack.halfWidth });
      renderer.scene.add(warehouse.group);

      for (const [type, tier, slot] of HERO_CARGO) {
        const c = new Cargo3D(renderer.tweens, cargo.length, type);
        const s = rack.shelves[tier];
        c.mesh.position.set(s.slotCentreX(slot, c.slots), s.cargoCentreY, 0.02);
        rack.group.add(c.mesh);
        cargo.push(c);
      }
      stopSway = renderer.tweens.add(rack.group.rotation, { z: 0.02 }, {
        ms: 3200,
        yoyo: true,
        repeat: -1,
        ease: Easing.sineInOut,
      });
      rack.group.rotation.z = -0.02;
      offFrame = renderer.onFrame((dt) => warehouse.tick(dt));

      const done = progress.completedCount();
      const stars = progress.totalStars();
      const endless = progress.endless;

      const soundBtn = iconBtn(progress.soundOn ? 'sound-on' : 'sound-off', () => {
        const on = !progress.soundOn;
        audio.setEnabled(on);
        setIcon(soundBtn, on ? 'sound-on' : 'sound-off');
        if (on) audio.click();
      }, 'Sound');

      const play = btn(
        done === 0 ? 'PLAY' : `CONTINUE - LEVEL ${progress.unlocked}`,
        () => go((c) => gameScreen(c, { levelId: progress.unlocked })),
        'primary',
        'lg',
      );
      play.dataset.role = 'play';
      const endlessBtn = btn('ENDLESS SHIFT', () => go((c) => gameScreen(c, { run: newRun(seedFromUrl()) })), 'gold', 'md');
      endlessBtn.dataset.role = 'endless';
      const levels = btn('LEVEL SELECT', () => go(levelSelectScreen), 'secondary', 'md');
      levels.dataset.role = 'levels';

      root = el('div', { class: 'screen menu fade-in' }, [
        el('div', { class: 'top' }, [soundBtn]),
        el('div', { class: 'wordmark' }, [
          el('div', { class: 'l1', text: 'CARGO' }),
          el('div', { class: 'l2', text: 'PANIC' }),
          el('div', { class: 'tagline', text: 'PACK THE WAREHOUSE WITHOUT TIPPING THE SHELVES' }),
        ]),
        el('div', { class: 'bottom' }, [
          el('div', { class: 'chip' }, [
            el('span', { class: 'g', text: `★ ${stars} / ${TOTAL_LEVELS * 3}` }),
            el('span', { class: 'd', text: `${done} / ${TOTAL_LEVELS} CLEARED` }),
          ]),
          play,
          el('div', {
            class: `caption ${endless.runs ? 'gold' : ''}`,
            text: endless.runs
              ? `BEST ${formatScore(endless.bestScore)}  -  WAVE ${endless.bestWave}`
              : 'PROCEDURAL WAVES - ONE MISTAKE ENDS A RUN',
          }),
          endlessBtn,
          levels,
          el('div', { class: 'studio', text: 'BLACKBLUE STUDIOS' }),
        ]),
      ]);
      uiRoot().append(root);
      fadeIn();
    },
    exit() {
      stopSway?.();
      offFrame?.();
      for (const c of cargo) c.dispose();
      cargo = [];
      rack.dispose();
      warehouse.dispose();
      root.remove();
      renderer.scene.remove(...renderer.scene.children.filter((o) => !(o instanceof THREE.Points)));
    },
  };
}
