<!--
SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
SPDX-License-Identifier: CC-BY-4.0
-->

# 0018. Custom SelectField komponent namiesto natívneho `<select>`

|                   |                                              |
| ----------------- | -------------------------------------------- |
| **Status**        | ✅ Accepted                                  |
| **Dátum**         | 2026-05-29                                   |
| **Autori**        | Ján Letko, Claude Sonnet 4.6 (LTK Solutions) |
| **Súvisiace ADR** | —                                            |

## Kontext

Natívny `<select>` element sa renderuje rozdielne na každom operačnom
systéme a prehliadači — macOS, Windows, Android, iOS majú každý iný
vizuálny štýl, animácie a správanie dropdown-u. Výsledkom je
nekonzistentný vzhľad appky naprieč platformami, čo je v rozpore
s Inventario brand identitou (čistý, konzistentný UI).

Konkrétne problémy pozorované v produkcii (`app.inventario.estate`):

- macOS Safari: dropdown má zaoblené rohmi a systémovú šedú farbu
  (nezladí sa s brand tokeny)
- Šírka dropdownu je OS-kontrolovaná, nie CSS
- `appearance: none` rieši len trigger button, nie samotnú listbox časť
- Žiadna možnosť pridať ikonku (check mark) pri vybranej položke

Filtrovanie na stránkach `/admin/tenants`, `/users`, `/assets` používa
viacero `<select>` prvkov vedľa seba — ich nesúlad je vizuálne badateľný.

## Možnosti

### Možnosť A: Štýlovaný natívny `<select>` s `appearance: none`

Pomocou `appearance: none` + custom SVG šípky v `globals.css` sa
natívny select štýluje len na úrovni trigger button-a. Vlastná listbox
časť (rozbalený dropdown) zostáva plne OS-kontrolovaná.

- **Plus:** Nulový JS overhead. Klávesnica a a11y zadarmo (browser
  implementation). Mobile-friendly (OS-natívny picker na mobile
  zariadeniach).
- **Mínus:** Listbox časť je naďalej OS-štýlovaná — nekonzistentná
  naprieč platformami. Nie je možné pridať check mark pri vybranej
  položke. Vizuálne nezladí s ostatnými UI komponentmi (Combobox,
  input).

### Možnosť B: Custom `SelectField` komponent (React + Tailwind)

Plne vlastný komponent — trigger `<button>` + `<ul role="listbox">`
renderovaný do DOM-u. Vizuál plne pod kontrolou Tailwind design tokenov.

- **Plus:** 100% konzistentný naprieč OS a prehliadačmi. Plná
  kontrola nad štýlom (border-radius, farby, check mark, animácia šípky).
  Vizuálne zladený s ostatnými komponentmi (Combobox, input, button).
  Možnosť budúcich rozšírení (ikony pri položkách, skupiny, vyhľadávanie).
- **Mínus:** Vyžaduje JS (useState). Treba implementovať klávesnicovú
  navigáciu manuálne (↑↓ Enter Esc Tab). Na mobile neotvára natívny
  OS picker — custom listbox môže byť menej ergonomický na dotykovej
  obrazovke pri veľkom počte položiek (> 20).

### Možnosť C: Headless UI alebo Radix Select

Použitie externej knižnice (Headless UI `<Listbox>`, Radix
`<Select>`) — riešia a11y a klávesnicovú navigáciu za nás.

- **Plus:** A11y a klávesnica sú externé zodpovednosti. Robustnejšia
  implementácia.
- **Mínus:** Ďalšia npm dependency (bundle size). Headless UI je
  viazané na React 18+ Transition API; Radix má iný styling prístup ako
  Tailwind. Inventario zámer je minimalizovať závislosti.

## Rozhodnutie

Zvolili sme **Možnosť B: Custom `SelectField` komponent**.

Komponent je implementovaný v
`apps/web/src/components/SelectField.tsx`.

### Použitie

```tsx
import { SelectField } from '@/components/SelectField';

<SelectField
  label="Stav" // povinný — pre aria-label
  value={statusFilter}
  onChange={setStatusFilter}
  options={[
    { value: '', label: 'Všetky stavy' },
    { value: 'ACTIVE', label: 'Aktívny' },
    { value: 'SUSPENDED', label: 'Pozastavený' },
  ]}
  className="w-40" // voliteľný — Tailwind width override
/>;
```

### Kedy použiť `SelectField` vs. `Combobox`

| Situácia                                              | Komponent      |
| ----------------------------------------------------- | -------------- |
| Filter / enum výber, < 20 položiek                    | `SelectField`  |
| Rýchle pridanie novej položky za behu (inline create) | `Combobox`     |
| Typovanie / vyhľadávanie v > 20 položkách             | `Combobox`     |
| Multi-select (tagy)                                   | `TagsCombobox` |

### Kedy je natívny `<select>` stále vhodný

- Formuláre mimo hlavnej appky (napr. marketing site, jednoduchá
  registračná stránka)
- Mobile-only kontexty s veľkým počtom položiek (> 20), kde je OS
  picker ergonomickejší
- Server-rendered formuláre bez JS hydratácie

### A11y implementácia

Komponent implementuje WAI-ARIA combobox pattern:

- Trigger: `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`,
  `aria-controls`
- Listbox: `role="listbox"`, `aria-label`
- Options: `role="option"`, `aria-selected`
- Klávesnica: `Enter`/`Space` = otvoriť/zatvoriť, `↑↓` = navigácia,
  `Escape` = zatvoriť a vrátiť focus, `Tab` = zatvoriť a presunúť focus

### Kde je `SelectField` nasadený

| Stránka / komponent | Použitie                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `TenantsContent`    | filter Stav, filter Plán, filter Veľkosť strany, dialog Upraviť tenant (Plán + Stav), dialog Nový tenant (Plán) |
| `UsersContent`      | _(plánované — nahradí natívny select pre Rola + Stav + Veľkosť strany)_                                         |
| `AssetsListContent` | _(plánované)_                                                                                                   |

Každý nový `<select>` v appke by mal byť implementovaný ako
`SelectField`, nie natívny `<select>`. Výnimky dokumentovať
s komentárom `// ADR-0018: natívny select — [dôvod]`.

## Dôsledky

### Pozitívne

- Konzistentný vizuál filtra naprieč celou appkou, bez ohľadu na OS
- Zladený s design tokenmi (border-radius, farby, focus ring)
- Check mark pri vybranej položke — okamžitý vizuálny feedback
- Animovaná šípka (rotate 180° pri otvorení)
- Jeden komponent pre všetkých — developer nemusí rozhodovať aký
  element použiť pre filter/enum vstup

### Negatívne / kompromisy

- JS required — pri hydratácii nedostupný (SSR edge case, prakticky
  nezásadný v Inventario kontexte kde je celá appka client-side)
- Na mobile sa neotvára natívny OS picker — custom listbox. Pre
  < 20 položiek je to akceptovateľné; pre väčší počet zvážiť
  `Combobox` s vyhľadávaním

### Riziká, ktoré treba sledovať

- **A11y audit** — WAI-ARIA combobox pattern je implementovaný manuálne.
  Pri WCAG 2.1 AA audite overiť kompatibilitu so screen readermi
  (VoiceOver, NVDA). Ak nájdeme problémy, migrovať na Radix Select.
- **Mobile UX** — ak budú stránky s filtermi > 20 položiek, zvážiť
  podmienečný render: mobile → natívny `<select>`, desktop → `SelectField`

## Referencie

- [WAI-ARIA Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
- [WAI-ARIA Listbox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- [Headless UI Listbox](https://headlessui.com/react/listbox) — referencia pre porovnanie
- [Radix Select](https://www.radix-ui.com/primitives/docs/components/select) — referencia pre porovnanie
