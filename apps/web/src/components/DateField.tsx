// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * DateField — custom date picker komponent pre Inventario.
 *
 * Nahrádza natívny <input type="date"> vo všetkých formulároch appky.
 * Rozhodnutie a dôvody dokumentované v ADR-0033.
 *
 * Použitie:
 *   <DateField
 *     label="Od"
 *     value={plannedFrom}
 *     onChange={setPlannedFrom}
 *     min={today}
 *     required
 *   />
 *
 * API:
 *   - value / onChange — riadená hodnota, ISO string 'YYYY-MM-DD' (alebo '')
 *     — presne ten istý tvar ako natívny <input type="date">, takže je to
 *     drop-in náhrada bez zmeny state/validation/API kódu.
 *   - min / max — voliteľné ISO string obmedzenia (rovnaká sémantika ako
 *     natívne min/max atribúty)
 *   - label — accessible label (aria-label na trigger)
 *   - id — voliteľné, pre externé <label htmlFor="...">
 *
 * Positioning: popover sa renderuje cez createPortal do document.body,
 * position: fixed, súradnice vypočítané z getBoundingClientRect() triggeru.
 * Pri otvorení sa rozhodne nahor/nadol podľa dostupného priestoru — funguje
 * aj v modáloch, portál obchádza overflow/transform predka (ADR-0033).
 *
 * A11y: trigger je <button> (labelable element) s aria-haspopup="dialog".
 * V1 nemá šípkovú klávesnicovú navigáciu v mriežke dní — fast-follow,
 * pozri ADR-0033 "Riziká, ktoré treba sledovať".
 */

import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { JSX } from 'react';

import { cn } from '@/lib/cn';

export interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const WEEKDAY_LABELS = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
const MONTH_LABELS = [
  'Január',
  'Február',
  'Marec',
  'Apríl',
  'Máj',
  'Jún',
  'Júl',
  'August',
  'September',
  'Október',
  'November',
  'December',
];

const CALENDAR_HEIGHT_ESTIMATE = 340;
const CALENDAR_WIDTH = 288;

interface Coords {
  placement: 'below' | 'above';
  left: number;
  top: number | null;
  bottom: number | null;
}

function parseIso(value: string | undefined): Date | null {
  if (!value) return null;
  const parts = value.split('-').map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDisplay(value: string): string {
  const dt = parseIso(value);
  if (!dt) return '';
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${dt.getFullYear()}`;
}

/** Po=0..Ne=6 offset pre prvý deň mesiaca (natívne getDay() je Ne=0). */
function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  id,
  className,
}: DateFieldProps): JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const selectedDate = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);
  const [viewMonth, setViewMonth] = useState<Date>(() => selectedDate ?? minDate ?? new Date());

  // Prepočítať zobrazený mesiac len pri otvorení, nie pri každej zmene value.
  useEffect(() => {
    if (!open) return;
    setViewMonth(selectedDate ?? minDate ?? new Date());
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function computePosition(): void {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placement: 'below' | 'above' =
        spaceBelow < CALENDAR_HEIGHT_ESTIMATE && spaceAbove > spaceBelow ? 'above' : 'below';
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - CALENDAR_WIDTH - 8);
      setCoords(
        placement === 'below'
          ? { placement, left, top: rect.bottom + 4, bottom: null }
          : { placement, left, top: null, bottom: window.innerHeight - rect.top + 4 },
      );
    }

    computePosition();
    window.addEventListener('resize', computePosition);
    return () => window.removeEventListener('resize', computePosition);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent): void {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        popoverRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    function handleScroll(e: Event): void {
      if (popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function isDisabledDay(date: Date): boolean {
    if (minDate && date < startOfDay(minDate)) return true;
    if (maxDate && date > startOfDay(maxDate)) return true;
    return false;
  }

  function selectDay(date: Date): void {
    if (isDisabledDay(date)) return;
    onChange(toIso(date));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function changeMonth(delta: number): void {
    setViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const offset = mondayOffset(firstOfMonth);
  const totalDays = daysInMonth(year, month);
  const today = startOfDay(new Date());

  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  for (let i = 0; i < offset; i++) {
    cells.push({ date: new Date(year, month, 1 - (offset - i)), inMonth: false });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    if (!last) break;
    cells.push({
      date: new Date(last.date.getFullYear(), last.date.getMonth(), last.date.getDate() + 1),
      inMonth: false,
    });
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={fieldId}
        aria-label={required ? `${label} (povinné)` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary transition',
          'hover:border-border-focus',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          open && 'border-border-focus ring-2 ring-border-focus',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className={cn('truncate', !value && 'text-text-muted')}>
          {value ? formatDisplay(value) : 'dd.mm.rrrr'}
        </span>
        <CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted" />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`Vyberte dátum — ${label}`}
            style={{
              position: 'fixed',
              left: coords.left,
              width: CALENDAR_WIDTH,
              ...(coords.placement === 'below'
                ? { top: coords.top ?? 0 }
                : { bottom: coords.bottom ?? 0 }),
            }}
            className="z-50 rounded-lg border border-border-subtle bg-surface-card p-3 shadow-md"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Predchádzajúci mesiac"
                onClick={() => changeMonth(-1)}
                className="rounded p-1 text-text-secondary hover:bg-surface-subtle"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium text-text-primary">
                {MONTH_LABELS[month]} {year}
              </span>
              <button
                type="button"
                aria-label="Nasledujúci mesiac"
                onClick={() => changeMonth(1)}
                className="rounded p-1 text-text-secondary hover:bg-surface-subtle"
              >
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>

            <div
              role="grid"
              aria-label={`${MONTH_LABELS[month]} ${year}`}
              className="grid grid-cols-7 gap-0.5"
            >
              {WEEKDAY_LABELS.map((w) => (
                <div key={w} className="py-1 text-center text-xs font-medium text-text-muted">
                  {w}
                </div>
              ))}
              {cells.map(({ date, inMonth }) => {
                const disabledDay = isDisabledDay(date);
                const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
                const isToday = isSameDay(date, today);
                return (
                  <button
                    key={toIso(date)}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelected}
                    disabled={disabledDay}
                    onClick={() => selectDay(date)}
                    className={cn(
                      'relative flex h-8 w-full items-center justify-center rounded text-sm',
                      !inMonth && 'text-text-muted opacity-40',
                      inMonth &&
                        !disabledDay &&
                        !isSelected &&
                        'text-text-primary hover:bg-surface-subtle',
                      isSelected &&
                        'bg-brand-primary font-medium text-white hover:bg-brand-primary',
                      disabledDay && 'cursor-not-allowed text-text-muted opacity-30',
                    )}
                  >
                    {date.getDate()}
                    {isToday && !isSelected && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0.5 h-1 w-1 rounded-full bg-brand-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
