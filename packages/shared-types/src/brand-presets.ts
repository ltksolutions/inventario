// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

/**
 * Brand presety + font voľby — ADR-0028 v2.
 *
 * Prečo presety (revízia v1):
 *   v1 dávalo tenantovi 6 voľných hex polí + voľný font string. To je
 *   náchylné na chyby — nečitateľný kontrast, font ktorý sa nenačíta,
 *   preklep v hex. v2 to nahrádza konečným zoznamom hotových paliet
 *   (každá WCAG 2.1 AA overená v teste) a enum fontov (reálne načítaných
 *   cez next/font). Tenant vyberá z kariet, nedá sa pomýliť.
 *
 * Model (rozhodnutie B, 2026-06-02):
 *   `presetId` na brandKit je len UI skratka. Backend pri výbere presetu
 *   SKOPÍRUJE jeho hex hodnoty do `primary`/`primaryFg`/`accent`/`accentFg`/
 *   `logoDot`. Tým ostáva spätná kompatibilita (BrandProvider, protokoly
 *   ADR-0022, štítky ADR-0027 čítajú hex ako doteraz) aj determinizmus
 *   (uložené hex sa nezmenia ani keď sa upraví definícia presetu v kóde).
 *
 * WCAG invariant (vynútené testom brand-presets.test.ts):
 *   Pre KAŽDÝ preset platí contrastRatio(primary, primaryFg) >= 4.5
 *   a contrastRatio(accent, accentFg) >= 4.5. Paleta ktorá neprejde sa
 *   do tohto súboru nedostane — test ju zachytí.
 *
 * Reálne kontrastné pomery (overené WCAG algoritmom, oba páry na bielom texte):
 *   inventario-navy  primary 13.90  accent  6.84
 *   royal-blue       primary  6.70  accent 10.36
 *   forest-green     primary  5.02  accent  7.13
 *   crimson-red      primary  6.47  accent  8.31
 *   royal-purple     primary  7.10  accent  8.98
 *   teal-deep        primary  5.47  accent  7.58
 *   slate-gray       primary 10.35  accent  7.58
 *   burnt-orange     primary  5.18  accent  7.31
 *   magenta-pink     primary  6.32  accent  8.24
 *   charcoal-black   primary 14.68  accent 10.31
 */

/**
 * Jedna brand paleta. Hex hodnoty #RRGGBB lowercase.
 *
 * - `primary` / `primaryFg` — hlavná farba + text na nej (tlačidlá, header)
 * - `accent` / `accentFg`   — akcentová farba + text na nej (zvýraznenia, CTA)
 * - `logoDot`               — farba bodky v Inventario logu (default = accent)
 */
export interface BrandPreset {
  /** Stabilný identifikátor presetu — ukladá sa do brandKit.presetId. */
  id: string;
  /** Zobrazované meno v UI (po slovensky). */
  name: string;
  primary: string;
  primaryFg: string;
  accent: string;
  accentFg: string;
  logoDot: string;
}

/**
 * 10 preset paliet. Všetky spĺňajú WCAG AA (>= 4.5:1) pre oba páry.
 *
 * Návrhový princíp: tmavé/sýte pozadie + biely text. Svetlé akcenty
 * (napr. #388fc3 na bielej = 3.57:1) sa nepoužívajú ako pozadie pre
 * biely text — accent je vždy dosť tmavý, aby pár prešiel.
 */
export const BRAND_PRESETS: readonly BrandPreset[] = [
  {
    id: 'inventario-navy',
    name: 'Inventario (predvolená)',
    primary: '#1a2d47',
    primaryFg: '#ffffff',
    accent: '#1f5f8b',
    accentFg: '#ffffff',
    logoDot: '#1f5f8b',
  },
  {
    id: 'royal-blue',
    name: 'Kráľovská modrá',
    primary: '#1d4ed8',
    primaryFg: '#ffffff',
    accent: '#1e3a8a',
    accentFg: '#ffffff',
    logoDot: '#1e3a8a',
  },
  {
    id: 'forest-green',
    name: 'Lesná zelená',
    primary: '#15803d',
    primaryFg: '#ffffff',
    accent: '#166534',
    accentFg: '#ffffff',
    logoDot: '#166534',
  },
  {
    id: 'crimson-red',
    name: 'Karmínová červená',
    primary: '#b91c1c',
    primaryFg: '#ffffff',
    accent: '#991b1b',
    accentFg: '#ffffff',
    logoDot: '#991b1b',
  },
  {
    id: 'royal-purple',
    name: 'Kráľovská fialová',
    primary: '#6d28d9',
    primaryFg: '#ffffff',
    accent: '#5b21b6',
    accentFg: '#ffffff',
    logoDot: '#5b21b6',
  },
  {
    id: 'teal-deep',
    name: 'Tyrkysová tmavá',
    primary: '#0f766e',
    primaryFg: '#ffffff',
    accent: '#115e59',
    accentFg: '#ffffff',
    logoDot: '#115e59',
  },
  {
    id: 'slate-gray',
    name: 'Bridlicová sivá',
    primary: '#334155',
    primaryFg: '#ffffff',
    accent: '#475569',
    accentFg: '#ffffff',
    logoDot: '#475569',
  },
  {
    id: 'burnt-orange',
    name: 'Pálená oranžová',
    primary: '#c2410c',
    primaryFg: '#ffffff',
    accent: '#9a3412',
    accentFg: '#ffffff',
    logoDot: '#9a3412',
  },
  {
    id: 'magenta-pink',
    name: 'Purpurová ružová',
    primary: '#a21caf',
    primaryFg: '#ffffff',
    accent: '#86198f',
    accentFg: '#ffffff',
    logoDot: '#86198f',
  },
  {
    id: 'charcoal-black',
    name: 'Uhľová čierna',
    primary: '#1f2937',
    primaryFg: '#ffffff',
    accent: '#374151',
    accentFg: '#ffffff',
    logoDot: '#374151',
  },
] as const;

/** Mapa pre rýchle vyhľadanie presetu podľa id. */
const PRESET_BY_ID = new Map<string, BrandPreset>(BRAND_PRESETS.map((p) => [p.id, p]));

/** Vyhľadá preset podľa id. Vráti undefined ak neexistuje. */
export function getBrandPreset(id: string): BrandPreset | undefined {
  return PRESET_BY_ID.get(id);
}

/** Zoznam platných preset ID — pre Zod enum / validáciu. */
export const BRAND_PRESET_IDS = BRAND_PRESETS.map((p) => p.id) as readonly string[];

/**
 * Povolené fonty (ADR-0028 v2). Hodnota `css` = CSS font-family string.
 *
 * Tieto fonty sú reálne načítané vo `apps/web` cez `next/font/google`
 * v `layout.tsx`. Každý font tam dostane CSS premennú (`--font-inter`,
 * `--font-open-sans`, ...) ktorú `css` nižšie referencuje cez `var()`.
 * `system-ui` je systémový (žiadny external load) a referuje primitívny
 * stack priamo.
 *
 * Enum zabraňuje výberu fontu ktorý sa nenačíta. Default = `system-ui`.
 *
 * DÔLEŽITÉ: názvy premenných `--font-*` MUSIA súhlasiť s `variable`
 * hodnotami v `apps/web/src/app/layout.tsx`. Pri pridaní nového fontu
 * treba upraviť OBE miesta (zdokumentovaný invariant).
 */
export const FONT_OPTIONS = [
  { id: 'system-ui', label: 'Systémový (predvolený)', css: 'system-ui, -apple-system, sans-serif' },
  { id: 'Inter', label: 'Inter', css: 'var(--font-inter), system-ui, sans-serif' },
  { id: 'Open Sans', label: 'Open Sans', css: 'var(--font-open-sans), system-ui, sans-serif' },
  { id: 'Roboto', label: 'Roboto', css: 'var(--font-roboto), system-ui, sans-serif' },
  { id: 'Lato', label: 'Lato', css: 'var(--font-lato), system-ui, sans-serif' },
] as const;

export type FontOptionId = (typeof FONT_OPTIONS)[number]['id'];

/** Zoznam platných font ID — pre Zod enum. */
export const FONT_OPTION_IDS = FONT_OPTIONS.map((f) => f.id) as [string, ...string[]];

/** Mapa pre vyhľadanie CSS font-family stringu podľa id. */
const FONT_CSS_BY_ID = new Map<string, string>(FONT_OPTIONS.map((f) => [f.id, f.css]));

/** Vráti CSS font-family string pre dané font id. Fallback na system-ui. */
export function getFontCss(id: string): string {
  return FONT_CSS_BY_ID.get(id) ?? 'system-ui, -apple-system, sans-serif';
}
