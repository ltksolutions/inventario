<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# Session 2026-05-29 (večer) — UX polish: SelectField + grouped categories

## Čo sme riešili

UX konzistencia — natívne `<select>` elementy sa renderujú rozdielne
na každom OS. Rozhodli sme sa nahradiť ich custom `SelectField`
komponentom a zdokumentovať rozhodnutie v ADR-0018.

Paralelne sme zlepšili čitateľnosť Číselníkov — kategórie v chaoticky
premiešanom poradí boli mätúce pre nových používateľov.

---

## Čo sme spravili

### 1. Číselníky — kategórie zoskupené podľa typov

**Rozhodnutie:** Zachovať Typy majetku a Kategórie ako oddelené záložky
(majú rôznu sémantiku), ale v záložke Kategórie vizuálne zoskupiť riadky
podľa typu.

**Implementácia:**

- `CiselnikyContent.tsx` — `CategoriesTab` prepísaná na grouped render
- Skupiny zoradené abecedne podľa názvu typu (`localeCompare('sk')`)
- Každá skupina má farebný badge s názvom typu a počtom kategórií
- `ASSET_TYPE_COLORS` — 7 farebných rampov konzistentných s design tokenmi
- `pluralCount()` — správna slovenčina (1 kategória / 2-4 kategórie / 5+ kategórií)
- Stĺpec „Typ majetku" v tabuľke odstránený (redundantný po zavedení groupingu)
- Ostatné záložky (Lokality, Typy, Stavy) nezmenené

**Súbory:**

- `apps/web/src/components/CiselnikyContent.tsx`

### 2. SelectField custom dropdown komponent

**Rozhodnutie:** Variant C — plne custom React komponent namiesto natívneho
`<select>` alebo štýlovaného natívneho selectu. Zdôvodnenie v ADR-0018.

**Implementácia:**

- `SelectField.tsx` — nový shared komponent
  - WAI-ARIA combobox pattern (`role="combobox"`, `role="listbox"`, `role="option"`)
  - Klávesnicová navigácia: ↑↓ pohyb, Enter/Space otvorenie/výber, Esc zatvorenie,
    Tab zatvorenie a presun focusu ďalej
  - Check mark (`lucide-react Check`) pri vybranej položke
  - Animovaná šípka (rotate 180° pri otvorení)
  - `useId()` pre unikátne ARIA ID-čka
  - `useEffect` + `mousedown` listener pre zatváranie pri kliku mimo
  - API: `label` (povinný), `value`, `onChange`, `options[]`, `disabled?`, `className?`

**Nasadenie — TenantsContent.tsx:**

- Filtre: Stav, Plán, Veľkosť strany
- Edit dialog: Plán + Stav
- Create dialog: Plán
- Pridaný `import { SelectField } from './SelectField'`
- Pridané option konštanty: `STATUS_OPTIONS`, `PLAN_OPTIONS`, `PAGE_SIZE_OPTIONS`,
  `PLAN_OPTIONS_FULL`, `STATUS_OPTIONS_FULL`

**Súbory:**

- `apps/web/src/components/SelectField.tsx` (nový)
- `apps/web/src/components/TenantsContent.tsx` (upravený)
- `docs/decisions/0018-select-field-component.md` (nový ADR)

### 3. ESLint fix

Pre-commit hook zlyhol na neexistujúcom pravidle:
`jsx-a11y/no-noninteractive-element-to-interactive-role`

Riešenie: odstránený komentár `// eslint-disable-next-line` z `SelectField.tsx`.

### 4. Dokumentácia

- `ROADMAP.md` — v0.4 označené ako Completed, Done sekcia doplnená
- `docs/milestones/slice-4-frontend-web.md` — sekcia „Rozšírenia po 2026-05-20"
- `docs/sessions/NEXT.md` — aktualizovaný

---

## Kľúčové rozhodnutia

### Prečo SelectField a nie natívny `<select>` s `appearance: none`?

`appearance: none` štýluje len trigger button — samotnú listbox časť
(rozbalený dropdown) naďalej renderuje OS. Na macOS, Windows, Android
vyzerá úplne inak. Custom komponent dáva 100% kontrolu.

### Prečo nie Headless UI alebo Radix?

Inventario zámer je minimalizovať npm závislosti. Pre < 20 položiek
(naše use cases: filtre, formulárové selecty) je manuálna implementácia
WAI-ARIA combobox pattern dostatočná a udržiavateľná.

### Kedy použiť SelectField vs Combobox vs natívny select?

Viď ADR-0018 tabuľka:

- `SelectField` — filter / enum výber, < 20 položiek
- `Combobox` — inline create, typeahead, > 20 položiek
- `TagsCombobox` — multi-select
- natívny `<select>` — len mimo hlavnej appky, s komentárom `// ADR-0018`

---

## Ďalšie kroky

- Rozšíriť `SelectField` do `UsersContent`, `AssetsListContent`, `LoansContent`
- Smoke test po deployi — overiť grouped categories + SelectField v produkcii

---

## Commit messages

```
feat(web): group categories by asset type in Číselníky tab
feat(web): SelectField custom dropdown component + ADR-0018 + apply to TenantsContent
fix(web): remove invalid eslint-disable comment for non-existent jsx-a11y rule
docs: update ROADMAP to v0.4 + slice-4 milestone extensions 2026-05-29
docs: poupratuj — NEXT.md + session log 2026-05-29 večer
```
