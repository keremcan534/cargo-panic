# Translations

Cargo Panic's UI text lives in `src/i18n/<code>.ts`, one dictionary per
language, all keyed by the English source `src/i18n/en.ts`. How languages are
picked, applied and added is in the README ("Languages").

## Status

| Code | Language | Status | Needs |
| --- | --- | --- | --- |
| `en` | English | source text | - |
| `tr` | Türkçe | shipped with the game before the eight below | - |
| `de` | Deutsch | **machine translation** | review by a native German speaker |
| `es` | Español | **machine translation** | review by a native Spanish speaker |
| `fr` | Français | **machine translation** | review by a native French speaker |
| `it` | Italiano | **machine translation** | review by a native Italian speaker |
| `pl` | Polski | **machine translation** | review by a native Polish speaker |
| `pt` | Português (Brasil) | **machine translation** | review by a native Brazilian Portuguese speaker |
| `ru` | Русский | **machine translation** | review by a native Russian speaker |
| `id` | Bahasa Indonesia | **machine translation** | review by a native Indonesian speaker |

The eight machine translations were written without a native speaker. Each
file says so in its header. They are complete (every key, checked by the
compiler and `tests/unit/i18n.test.ts`) and fit the screens at 360 x 640 and
412 x 915 (`tests/e2e/languages.spec.ts`), but wording, tone and grammar
should be reviewed by a native speaker before a store release in that
language. When a language has been reviewed, change its row here and the
note in its file's header.

`pt` is Brazilian Portuguese; devices set to Portugal's Portuguese get it
too. `id` is also chosen for older Android devices that report Indonesian
as `in`.

## What a reviewer should check

- **Game terms**, used the same way everywhere in the file. Each file's
  header lists the terms chosen:

  | English | de | es | fr | it | pl | pt | ru | id |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | rack | Regal | estantería | rayonnage | scaffale | regał | estante | стеллаж | rak |
  | shelf | Regalboden | estante | étagère | ripiano | półka | prateleira | полка | papan rak |
  | cargo | Fracht | carga | marchandise / colis | merce | ładunek | carga | груз | kargo |
  | heavy | schwer | pesada | lourd | pesante | ciężki | pesada | тяжёлый | berat |
  | fragile | zerbrechlich | frágil | fragile | fragile | kruchy | frágil | хрупкий | rapuh |
  | long | lang | larga | long | lungo | długi | longa | длинный | panjang |
  | priority | Priorität | prioritaria | prioritaire | prioritario | priorytet | prioritária | приоритет | prioritas |
  | Endless Shift | Endlosschicht | Turno infinito | Service sans fin | Turno infinito | Zmiana bez końca | Turno sem fim | Бесконечная смена | Sif tanpa akhir |
  | undo | Rückgängig | deshacer | annuler | annulla | cofnij | desfazer | отменить | urungkan |
  | hint | Tipp | pista | indice | indizio | podpowiedź | dica | подсказка | petunjuk |
  | wave | Welle | oleada | vague | ondata | fala | onda | волна | gelombang |
  | level | Level | nivel | niveau | livello | poziom | fase | уровень | level |

- **Grammar around placeholders.** `{shelf}` in the loss messages is filled
  with the `shelf.*` names; German, Polish and Russian use a different case
  after the preposition in `fail.detail.fragile` (`shelf.*On`), and
  Portuguese puts the preposition in `shelf.*On`. `fail.side.*` fills
  `{side}` in `fail.detail.collapse`.
- **Casing.** Text that is all-caps in English is all-caps in every language
  (the unit test checks it with the language's own upper-case rules).
- **Length.** Buttons and banners must still fit a 360 px wide phone: run
  `npx playwright test tests/e2e/languages.spec.ts` after a change and look
  at `test-results/languages/<code>-360x640-*.png`.
- **Placeholders** (`{n}`, `{secs}`, `{limit}` ...) stay exactly as they are;
  their order may change. Units after `{secs}` are joined with a no-break
  space (` `) so the number never ends a line alone.
