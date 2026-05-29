// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * SelectField — custom dropdown komponent pre Inventario.
 *
 * Nahrádza natívny <select> vo všetkých častiach appky. Rozhodnutie
 * dokumentované v ADR-0018.
 *
 * Použitie:
 *   <SelectField
 *     label="Stav"
 *     value={statusFilter}
 *     onChange={setStatusFilter}
 *     options={[
 *       { value: '', label: 'Všetky stavy' },
 *       { value: 'ACTIVE', label: 'Aktívny' },
 *       { value: 'SUSPENDED', label: 'Pozastavený' },
 *     ]}
 *   />
 *
 * API:
 *   - value / onChange — riadená hodnota (string)
 *   - options — pole { value: string; label: string }
 *   - label — accessible label (vždy povinný pre screen readery)
 *   - disabled — zakáže interakciu
 *   - className — override šírky / iné utility triedy
 *
 * A11y:
 *   - role="combobox" + aria-expanded + aria-haspopup
 *   - Klávesnica: Enter/Space = otvori, Esc = zatvor, ↑↓ = naviguj,
 *     Enter na option = vyber, Tab = zatvor a presun focus ďalej
 */

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { JSX, KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  /** Tailwind utility override — napr. 'w-40' alebo 'w-full' */
  className?: string;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: SelectFieldProps): JSX.Element {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  const selectedOption = options.find((o) => o.value === value) ?? options[0];
  const selectedIndex = options.findIndex((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent): void {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        listboxRef.current?.contains(e.target as Node)
      )
        return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [open, selectedIndex]);

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((v) => !v);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  function handleListKeyDown(e: KeyboardEvent<HTMLUListElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const opt = options[focusedIndex];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
        triggerRef.current?.focus();
      }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function select(opt: SelectOption): void {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary transition',
          'hover:border-border-focus',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          open && 'border-border-focus ring-2 ring-border-focus',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="truncate">{selectedOption?.label ?? label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-text-muted transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className="absolute left-0 top-full z-50 mt-1 min-w-full rounded-lg border border-border-subtle bg-surface-card py-1 shadow-md"
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isFocused = i === focusedIndex;
            return (
              <li key={opt.value} role="option" aria-selected={isSelected} id={`${id}-opt-${i}`}>
                <button
                  type="button"
                  onClick={() => select(opt)}
                  onMouseEnter={() => setFocusedIndex(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary',
                    isFocused && 'bg-surface-subtle',
                    isSelected && 'font-medium',
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {isSelected && (
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-brand-primary" />
                    )}
                  </span>
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
