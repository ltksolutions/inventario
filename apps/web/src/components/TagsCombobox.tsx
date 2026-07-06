// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

/**
 * TagsCombobox — free-form multi-select for the `tags` field.
 *
 * Unlike the single-select Combobox, tags are free strings (no DB id).
 * The component:
 *   - Shows existing tags as removable pills
 *   - Typeahead against previously used tags (passed as `suggestions`)
 *   - Enter / comma / Tab to add a free-form tag
 *   - Backspace on empty input removes the last tag
 *   - ESC closes suggestion dropdown
 *
 * RBAC: no restrictions — every role can manage tags on their own
 * asset form. The asset PATCH itself is guarded server-side.
 */

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { JSX, KeyboardEvent } from 'react';

import { cn } from '@/lib/cn';

export interface TagsComboboxProps {
  /** Current tags array */
  value: string[];
  onChange: (tags: string[]) => void;

  /**
   * Previously used tags for autocomplete suggestions.
   * Caller fetches from the asset list or a dedicated endpoint.
   *
   * Explicitly widened to `| undefined` (not just optional `?`) because
   * callers pass `useQuery` results straight through (e.g. `tagsQuery.data`,
   * which is `string[] | undefined` while loading) — `exactOptionalPropertyTypes`
   * treats "prop omitted" and "prop present with value undefined" as
   * distinct, so both must be allowed here.
   */
  suggestions?: string[] | undefined;

  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const VISIBLE_LIMIT = 10;

export function TagsCombobox({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Pridať tag…',
  disabled = false,
  className,
}: TagsComboboxProps): JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filtered suggestions: exclude already-selected, match query
  const filtered = suggestions.filter(
    (s) => !value.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase().trim()),
  );
  const visible = filtered.slice(0, VISIBLE_LIMIT);

  function addTag(tag: string): void {
    // Normalizácia zhodná so serverovým TagSchema (packages/shared-types):
    // trim + zbalenie viacnásobných medzier + malé písmená. Server toto
    // vynucuje vždy (aj mimo tohto UI), tu je to len zhoda pre okamžitú
    // spätnú väzbu (napr. deduplikácia s existujúcim tagom vo `value`).
    const normalized = tag.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalized || value.includes(normalized)) return;
    onChange([...value, normalized]);
    setInputValue('');
    setOpen(false);
    setActiveIndex(-1);
  }

  function removeTag(tag: string): void {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    switch (e.key) {
      case 'Enter':
      case ',':
      case 'Tab': {
        if (e.key === 'Tab' && !inputValue.trim()) break;
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < visible.length) {
          addTag(visible[activeIndex]!);
        } else if (inputValue.trim()) {
          addTag(inputValue);
        }
        break;
      }
      case 'Backspace': {
        if (!inputValue && value.length > 0) {
          removeTag(value[value.length - 1]!);
        }
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, visible.length - 1));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, -1));
        break;
      }
      case 'Escape': {
        setOpen(false);
        setActiveIndex(-1);
        break;
      }
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: globalThis.MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Pills + input */}
      <div
        role="presentation"
        className={cn(
          'flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-lg border border-border-default bg-surface-card px-2 py-1.5',
          'focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus',
          'transition-colors',
          disabled && 'cursor-not-allowed bg-surface-subtle',
        )}
        onClick={() => !disabled && inputRef.current?.focus()}
        onKeyDown={() => {
          /* keyboard handled by child input */
        }}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-medium text-text-primary"
          >
            #{tag}
            {!disabled && (
              <button
                type="button"
                aria-label={`Odstrániť tag ${tag}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(tag);
                }}
                className="rounded-full p-0.5 text-text-muted hover:text-text-primary"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder : ''}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {/* Suggestions dropdown */}
      {open && (visible.length > 0 || inputValue.trim()) && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-lg border border-border-default bg-surface-card py-1 shadow-lg"
        >
          {visible.map((s, idx) => (
            <li
              key={s}
              role="option"
              aria-selected={false}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-sm text-text-primary hover:bg-surface-subtle',
                idx === activeIndex && 'bg-surface-subtle',
              )}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(idx)}
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  addTag(s);
                }
              }}
            >
              #{s}
            </li>
          ))}

          {inputValue.trim() &&
            !filtered.some((s) => s.toLowerCase() === inputValue.trim().toLowerCase()) && (
              <li
                role="option"
                aria-selected={false}
                className="cursor-pointer border-t border-border-subtle px-3 py-1.5 text-sm font-medium text-brand-primary hover:bg-surface-subtle"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(inputValue);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    addTag(inputValue);
                  }
                }}
              >
                + Pridať &ldquo;{inputValue.trim()}&rdquo;
              </li>
            )}
        </ul>
      )}
    </div>
  );
}
