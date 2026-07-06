// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

import type { FieldErrors } from 'react-hook-form';

/**
 * focusFirstInvalidField — shared form UX helper (2026-07-06).
 *
 * Problem (reported by Janika): on long forms (Pridanie/Editácia
 * majetku), clicking "Vytvoriť"/"Uložiť" with a missing required
 * field further down the form gave no visible feedback — the error
 * text renders right next to the field, but the field itself is
 * scrolled out of view, so nobody thinks to scroll up and hunt for it.
 *
 * Fix: every field's wrapper (the local `Field` component in each
 * form) renders `data-field="<react-hook-form field name>"` on its
 * outer element. Pass this function as react-hook-form's
 * `handleSubmit(onValid, onInvalid)` second argument — when
 * validation fails, it takes the FIRST error key (react-hook-form
 * preserves registration order, which for these forms matches the
 * visual top-to-bottom field order), finds the matching `[data-field]`
 * element, scrolls it to the vertical centre of the viewport, and
 * focuses its first focusable descendant.
 *
 * Why "first focusable descendant" instead of react-hook-form's own
 * `setFocus(name)`: several required fields (category, location,
 * status, tracking mode…) are custom `Combobox`/`SelectField`
 * components wired through RHF's `Controller`, whose `render` prop
 * only consumes `field.value`/`field.onChange` — not `field.ref` — so
 * no native input ref is ever registered with react-hook-form for
 * those fields. Querying the DOM ourselves works uniformly for both
 * native `register()` inputs and Controller-wrapped custom widgets
 * (whose first descendant is a `<button role="combobox">` trigger).
 *
 * Usage:
 *   const { handleSubmit, ... } = useForm<FormValues>(...);
 *   <form onSubmit={handleSubmit(onSubmit, focusFirstInvalidField)}>
 */
export function focusFirstInvalidField(errors: FieldErrors): void {
  const firstKey = Object.keys(errors)[0];
  if (!firstKey) return;

  // Deferred to the next frame: react-hook-form re-renders (to paint
  // the error messages, which can change a field's height) in the
  // same tick this callback fires. Waiting a frame means we scroll to
  // the DOM as it will actually look, not as it looked a moment ago.
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-field="${cssEscape(firstKey)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = el.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]');
    focusable?.focus();
  });
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Fallback for environments without CSS.escape (none expected in
  // production browsers, kept defensive since this runs client-side).
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
