/**
 * The trailer, on a 120 BPM grid: a beat is 0.5 s, a bar 2 s. Every scene
 * starts on a bar (or a beat inside a montage), so every cut lands on a
 * beat. Clip time is placed with an anchor: a recorded event (a finger going
 * down or up, from the clip's log) or a fixed clip frame is pinned to a beat,
 * so drops and impacts hit the music too.
 *
 * Only what the game does is shown: every picture is a recorded clip or a
 * screenshot of the real game (marketing/capture/clips.ts).
 */

/** Where a clip's frames sit on the timeline. */
export type Anchor =
  | { clip: string; event: 'down' | 'up'; nth: number; beat: number }
  | { clip: string; frame: number; beat: number };

/** A region of the phone screen, in CSS px of the 412 x 915 capture. */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Layout =
  /** A gameplay crop on a card, big, with the headline beside it. */
  | { kind: 'card'; anchor: Anchor; crop: Crop; side: 'left' | 'right'; tint?: string }
  /** Menu screenshots on a tilted phone, with finger taps. */
  | { kind: 'phone'; screens: { still: string; from: number; tap?: { target: string; beat: number } }[] }
  /** Two phones side by side, the same move in 3D and 2D. */
  | { kind: 'pair'; left: Anchor; right: Anchor; labels: [string, string] }
  | { kind: 'logo' }
  | { kind: 'end' };

export interface Scene {
  id: string;
  /** Start and length in beats. */
  beat: number;
  beats: number;
  layout: Layout;
  /** The big headline (letters rise out of a mask), and an optional smaller line. */
  title?: string;
  sub?: string;
  /** How this scene comes in. */
  enter?: 'cut' | 'flash' | 'whip' | 'wipe';
  /** Extra sound hits in beats (collapse, rewards); taps come from the clip logs. */
  hits?: { beat: number; kind: 'impact' | 'chime' | 'riser' }[];
}

export const BPM = 120;
export const BEAT_S = 60 / BPM;
export const TOTAL_BEATS = 68; // 17 bars = 34 s

/** The full phone screen, and the rack with meter and belt (the play area). */
const PLAY: Crop = { x: 0, y: 100, w: 412, h: 690 };
const RACK: Crop = { x: 0, y: 200, w: 412, h: 560 };

export const SCENES: Scene[] = [
  {
    id: 'pack',
    beat: 0,
    beats: 4,
    title: 'PACK IT.',
    layout: { kind: 'card', anchor: { clip: 'hook-l25', event: 'up', nth: 1, beat: 2.25 }, crop: PLAY, side: 'right' },
  },
  {
    id: 'balance',
    beat: 4,
    beats: 4,
    title: 'BALANCE IT.',
    enter: 'whip',
    layout: { kind: 'card', anchor: { clip: 'hook-l25', event: 'up', nth: 2, beat: 6.75 }, crop: RACK, side: 'left' },
  },
  {
    id: 'tip',
    beat: 8,
    beats: 4,
    title: "DON'T TIP IT.",
    enter: 'flash',
    layout: { kind: 'card', anchor: { clip: 'tip-fix-l4', event: 'up', nth: 1, beat: 8.5 }, crop: PLAY, side: 'right', tint: '#ff5f57' },
  },
  {
    id: 'fix',
    beat: 12,
    beats: 4,
    title: 'FIX IT FAST.',
    enter: 'whip',
    layout: { kind: 'card', anchor: { clip: 'tip-fix-l4', event: 'up', nth: 2, beat: 13.5 }, crop: PLAY, side: 'left', tint: '#3fd68a' },
  },
  {
    id: 'fall',
    beat: 16,
    beats: 4,
    title: '…OR WATCH IT FALL.',
    enter: 'cut',
    // Frame 45: the countdown reaches zero (the game's own flash); the rack falls over the next ~0.6 s.
    layout: { kind: 'card', anchor: { clip: 'collapse-l4', frame: 45, beat: 17 }, crop: PLAY, side: 'right', tint: '#ff5f57' },
    hits: [{ beat: 17, kind: 'impact' }, { beat: 18.5, kind: 'riser' }],
  },
  { id: 'logo', beat: 20, beats: 4, enter: 'wipe', layout: { kind: 'logo' }, hits: [{ beat: 20.5, kind: 'chime' }] },
  {
    id: 'levels',
    beat: 24,
    beats: 8,
    title: '25 HAND-BUILT LEVELS',
    enter: 'whip',
    layout: {
      kind: 'phone',
      screens: [
        { still: 'title', from: 24, tap: { target: 'levels', beat: 26 } },
        { still: 'levels', from: 27, tap: { target: 'level', beat: 29 } },
        { still: 'level16', from: 30 },
      ],
    },
  },
  {
    id: 'heavy',
    beat: 32,
    beats: 2,
    title: 'HEAVY',
    enter: 'flash',
    layout: { kind: 'card', anchor: { clip: 'heavy-l14', event: 'up', nth: 1, beat: 33 }, crop: RACK, side: 'right', tint: '#6b7a8f' },
  },
  {
    id: 'fragile',
    beat: 34,
    beats: 2,
    title: 'FRAGILE',
    enter: 'cut',
    layout: { kind: 'card', anchor: { clip: 'fragile-l8', event: 'up', nth: 1, beat: 34.5 }, crop: RACK, side: 'left', tint: '#3aa89e' },
  },
  {
    id: 'long',
    beat: 36,
    beats: 2,
    title: 'LONG',
    enter: 'cut',
    layout: { kind: 'card', anchor: { clip: 'long-l12', event: 'up', nth: 1, beat: 37.5 }, crop: RACK, side: 'right', tint: '#e0602e' },
  },
  {
    id: 'priority',
    beat: 38,
    beats: 2,
    title: 'PRIORITY',
    enter: 'cut',
    layout: { kind: 'card', anchor: { clip: 'priority-l16', event: 'up', nth: 1, beat: 39 }, crop: RACK, side: 'left', tint: '#ffc93c' },
  },
  {
    id: 'tap',
    beat: 40,
    beats: 4,
    title: 'DRAG IT OR TAP IT',
    enter: 'whip',
    layout: { kind: 'card', anchor: { clip: 'tap-l15', event: 'up', nth: 2, beat: 42.5 }, crop: PLAY, side: 'right' },
  },
  {
    id: 'win',
    beat: 44,
    beats: 4,
    title: 'EARN ALL THREE STARS',
    enter: 'flash',
    // Frame 152: the win panel appears; its three stars pop over frames 156-168.
    layout: { kind: 'card', anchor: { clip: 'long-l12', frame: 152, beat: 44.5 }, crop: { x: 0, y: 60, w: 412, h: 760 }, side: 'left', tint: '#ffc93c' },
    hits: [{ beat: 45.5, kind: 'chime' }],
  },
  {
    id: 'endless',
    beat: 48,
    beats: 8,
    title: 'ENDLESS SHIFT',
    sub: 'Every wave proven solvable',
    enter: 'wipe',
    // Frame 53: SHIPMENT DISPATCHED appears, the score lines tally after it.
    layout: { kind: 'card', anchor: { clip: 'endless-w12', frame: 53, beat: 50 }, crop: { x: 0, y: 0, w: 412, h: 800 }, side: 'right', tint: '#f0a53c' },
    hits: [{ beat: 50, kind: 'chime' }],
  },
  {
    id: 'views',
    beat: 56,
    beats: 4,
    title: 'PLAY IN 3D OR 2D',
    enter: 'whip',
    layout: {
      kind: 'pair',
      left: { clip: 'views-3d', event: 'up', nth: 1, beat: 58 },
      right: { clip: 'views-2d', event: 'up', nth: 1, beat: 58 },
      labels: ['3D', '2D'],
    },
  },
  { id: 'end', beat: 60, beats: 8, enter: 'wipe', layout: { kind: 'end' }, hits: [{ beat: 60.5, kind: 'chime' }] },
];

/** Store screenshots: a scene from a clip or a menu, with a short headline (1920 x 1080). */
export interface StoreShot {
  /** Listing position: phoneScreenshots/<n>_<locale>.jpg */
  n: number;
  title: string;
  sub?: string;
  /** The headline in the other listing languages (STORE_LANG=<lang>); English is title/sub. */
  i18n: Record<'tr' | 'de' | 'es' | 'fr' | 'it' | 'pl' | 'pt' | 'ru' | 'id', { title: string; sub: string }>;
  source: { clip: string; frame: number } | { still: string } | { pair: [{ clip: string; frame: number }, { clip: string; frame: number }] };
  crop?: Crop;
}

/**
 * The six store screenshots, in listing order. Frames are picked from the
 * recorded clips (frame numbers are stable: capture is deterministic).
 */
export const STORE_SHOTS: StoreShot[] = [
  { n: 1, i18n: { tr: { title: 'Yerleştir. Dengele.', sub: '25 elle tasarlanmış bölüm, hepsinin çözülebildiği kanıtlı' }, de: { title: 'Einräumen. Ausbalancieren.', sub: '25 handgebaute Level – jedes nachweislich lösbar' }, es: { title: 'Coloca. Equilibra.', sub: '25 niveles hechos a mano, todos con solución comprobada' }, fr: { title: 'Range. Équilibre.', sub: '25 niveaux faits main, tous prouvés solubles' }, it: { title: 'Sistema. Bilancia.', sub: '25 livelli fatti a mano, tutti risolvibili per certo' }, pl: { title: 'Układaj. Równoważ.', sub: '25 ręcznie zrobionych poziomów – każdy na pewno do przejścia' }, pt: { title: 'Organize. Equilibre.', sub: '25 fases feitas à mão, todas com solução comprovada' }, ru: { title: 'Грузи. Уравновешивай.', sub: '25 уровней ручной работы, у каждого есть решение' }, id: { title: 'Susun. Seimbangkan.', sub: '25 level buatan tangan, semuanya terbukti bisa diselesaikan' } }, title: 'Pack it. Balance it.', sub: '25 hand-built levels, every one proven solvable', source: { clip: 'hook-l25', frame: 85 }, crop: PLAY },
  { n: 2, i18n: { tr: { title: 'Rafı devirme', sub: 'Bir hata anında kaybettirmez – düzeltmek için saniyelerin var' }, de: { title: 'Kipp das Regal nicht', sub: 'Ein Fehler ist nie sofort verloren – du hast Sekunden zum Retten' }, es: { title: 'No vuelques la estantería', sub: 'Un fallo no es una derrota al instante: tienes segundos para arreglarlo' }, fr: { title: 'Ne renverse pas l’étagère', sub: 'Une erreur n’est jamais fatale d’un coup : tu as quelques secondes pour réparer' }, it: { title: 'Non ribaltare lo scaffale', sub: 'Un errore non è mai una sconfitta immediata: hai qualche secondo per rimediare' }, pl: { title: 'Nie przewróć regału', sub: 'Błąd to nie natychmiastowa porażka – masz kilka sekund na poprawkę' }, pt: { title: 'Não derrube a estante', sub: 'Um erro nunca é derrota na hora – você tem segundos para consertar' }, ru: { title: 'Не опрокинь стеллаж', sub: 'Ошибка не проигрыш сразу – есть несколько секунд, чтобы исправить' }, id: { title: 'Jangan sampai rak terguling', sub: 'Satu kesalahan tidak langsung kalah – ada beberapa detik untuk memperbaiki' } }, title: "Don't tip the rack", sub: 'A slip gives you seconds to fix it – not an instant loss', source: { clip: 'tip-fix-l4', frame: 40 }, crop: PLAY },
  { n: 3, i18n: { tr: { title: 'Ağır. Kırılabilir. Uzun. Öncelikli.', sub: 'Her kargo türünün kendi kuralı var' }, de: { title: 'Schwer. Zerbrechlich. Lang. Priorität.', sub: 'Jede Fracht hat ihre eigenen Regeln' }, es: { title: 'Pesada. Frágil. Larga. Prioritaria.', sub: 'Cada tipo de carga tiene sus propias reglas' }, fr: { title: 'Lourd. Fragile. Long. Prioritaire.', sub: 'Chaque type de cargaison a ses propres règles' }, it: { title: 'Pesante. Fragile. Lungo. Prioritario.', sub: 'Ogni tipo di carico ha le sue regole' }, pl: { title: 'Ciężki. Kruchy. Długi. Priorytet.', sub: 'Każdy rodzaj ładunku ma swoje zasady' }, pt: { title: 'Pesada. Frágil. Longa. Prioritária.', sub: 'Cada tipo de carga tem suas próprias regras' }, ru: { title: 'Тяжёлый. Хрупкий. Длинный. Приоритет.', sub: 'У каждого вида груза свои правила' }, id: { title: 'Berat. Rapuh. Panjang. Prioritas.', sub: 'Setiap jenis kargo punya aturannya sendiri' } }, title: 'Heavy. Fragile. Long. Priority.', sub: 'Every kind of cargo plays by its own rules', source: { clip: 'views-3d', frame: 63 }, crop: PLAY },
  { n: 4, i18n: { tr: { title: 'Sonsuz Vardiya', sub: 'Üretilen dalgalar, hepsinin çözülebildiği kanıtlı' }, de: { title: 'Endlosschicht', sub: 'Generierte Wellen, jede nachweislich lösbar' }, es: { title: 'Turno infinito', sub: 'Oleadas generadas, todas con solución comprobada' }, fr: { title: 'Service sans fin', sub: 'Des vagues générées, toutes prouvées solubles' }, it: { title: 'Turno infinito', sub: 'Ondate generate, tutte risolvibili per certo' }, pl: { title: 'Zmiana bez końca', sub: 'Generowane fale – każda na pewno do przejścia' }, pt: { title: 'Turno sem fim', sub: 'Ondas geradas, todas com solução comprovada' }, ru: { title: 'Бесконечная смена', sub: 'Сгенерированные волны, у каждой есть решение' }, id: { title: 'Sif tanpa akhir', sub: 'Gelombang acak, semuanya terbukti bisa diselesaikan' } }, title: 'Endless Shift', sub: 'Procedural waves, every one proven solvable', source: { clip: 'endless-w12', frame: 100 }, crop: { x: 0, y: 0, w: 412, h: 800 } },
  { n: 5, i18n: { tr: { title: '3D ya da 2D oyna', sub: 'Aynı raf, aynı kurallar – duraklatıp istediğin an geç' }, de: { title: 'Spiel in 3D oder 2D', sub: 'Gleiches Regal, gleiche Regeln – jederzeit in der Pause wechseln' }, es: { title: 'Juega en 3D o 2D', sub: 'Misma estantería, mismas reglas: cambia cuando quieras desde la pausa' }, fr: { title: 'Joue en 3D ou en 2D', sub: 'Même étagère, mêmes règles : change quand tu veux depuis la pause' }, it: { title: 'Gioca in 3D o 2D', sub: 'Stesso scaffale, stesse regole: cambia quando vuoi dalla pausa' }, pl: { title: 'Graj w 3D lub 2D', sub: 'Ten sam regał, te same zasady – zmieniaj w pauzie, kiedy chcesz' }, pt: { title: 'Jogue em 3D ou 2D', sub: 'Mesma estante, mesmas regras – troque quando quiser na pausa' }, ru: { title: 'Играй в 3D или 2D', sub: 'Тот же стеллаж, те же правила – переключай в паузе' }, id: { title: 'Main dalam 3D atau 2D', sub: 'Rak sama, aturan sama – ganti kapan saja dari jeda' } }, title: 'Play in 3D or 2D', sub: 'Same board, same rules – switch any time from pause', source: { pair: [{ clip: 'views-3d', frame: 63 }, { clip: 'views-2d', frame: 63 }] } },
  { n: 6, i18n: { tr: { title: 'Sürükle ya da dokun', sub: 'Her sevkiyatta bir ücretsiz geri alma' }, de: { title: 'Ziehen oder tippen', sub: 'Und ein kostenloses Rückgängig pro Lieferung' }, es: { title: 'Arrastra o toca', sub: 'Y un deshacer gratis en cada envío' }, fr: { title: 'Glisse ou touche', sub: 'Et une annulation gratuite à chaque livraison' }, it: { title: 'Trascina o tocca', sub: 'E un annulla gratis a ogni spedizione' }, pl: { title: 'Przeciągnij lub stuknij', sub: 'I jedno darmowe cofnięcie w każdej dostawie' }, pt: { title: 'Arraste ou toque', sub: 'E um desfazer grátis em cada remessa' }, ru: { title: 'Перетаскивай или нажимай', sub: 'И одна бесплатная отмена в каждой отгрузке' }, id: { title: 'Seret atau ketuk', sub: 'Dan satu urungkan gratis di setiap pengiriman' } }, title: 'Drag it or tap it', sub: 'And one free undo on every shipment', source: { clip: 'tap-l15', frame: 36 }, crop: PLAY },
];
