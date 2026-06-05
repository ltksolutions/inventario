// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

'use client';

import { Check, ChevronDown, Loader2, Pencil, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

import { cn } from '@/lib/cn';

export interface ComboboxOption {
  id: string;
  label: string;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (id: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  canCreate?: boolean;
  onCreate?: (label: string) => Promise<{ id: string; label: string }> | void;
  canRename?: boolean;
  onRename?: (id: string, newLabel: string) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  loading?: boolean;
}

const VISIBLE_LIMIT = 10;

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Vyberte alebo začnite písať',
  canCreate = false,
  onCreate,
  canRename = false,
  onRename,
  disabled = false,
  className,
  ariaLabel,
  loading = false,
}: ComboboxProps): JSX.Element {
  const id = useId();
  const listId = `${id}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selectedOption = options.find((o) => o.id === value) ?? null;
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase().trim()))
    : options;
  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const hasMore = filtered.length > VISIBLE_LIMIT;
  const totalAll = options.length;

  const queryTrimmed = query.trim();
  const exactMatch = options.some((o) => o.label.toLowerCase() === queryTrimmed.toLowerCase());
  const showCreate = canCreate && queryTrimmed.length > 0 && !exactMatch;
  const totalNavigable = visible.length + (showCreate ? 1 : 0);
  const createIndex = showCreate ? visible.length : -1;

  useEffect(() => {
    if (open) {
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (renamingId !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [renamingId]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: globalThis.MouseEvent): void {
      const root = triggerRef.current?.closest('[data-combobox-root]');
      if (root && !root.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[role="option"]');
    const el = items[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function openDropdown(e?: ReactMouseEvent): void {
    if (disabled) return;
    e?.stopPropagation();
    setOpen(true);
    setQuery('');
  }

  function closeDropdown(returnFocus = true): void {
    setOpen(false);
    setQuery('');
    setRenamingId(null);
    // Only return focus when closing via keyboard (Escape) — not on mouse click,
    // because focus() on the button inside a <label> wrapper can re-trigger
    // the label's click handler and reopen the dropdown.
    if (returnFocus) triggerRef.current?.focus();
  }

  function selectOption(optionId: string): void {
    onChange(optionId);
    closeDropdown(false);
  }

  function clearSelection(e: ReactMouseEvent): void {
    e.stopPropagation();
    onChange(null);
  }

  async function handleCreate(): Promise<void> {
    if (!onCreate || !queryTrimmed) return;
    setCreateLoading(true);
    try {
      const result = await onCreate(queryTrimmed);
      if (result) onChange(result.id);
      closeDropdown(false);
    } finally {
      setCreateLoading(false);
    }
  }

  function startRename(option: ComboboxOption, e: ReactMouseEvent): void {
    e.stopPropagation();
    setRenamingId(option.id);
    setRenameValue(option.label);
  }

  async function commitRename(optionId: string): Promise<void> {
    const trimmed = renameValue.trim();
    if (!trimmed || !onRename) {
      setRenamingId(null);
      return;
    }
    setRenameLoading(true);
    try {
      await onRename(optionId, trimmed);
    } finally {
      setRenameLoading(false);
      setRenamingId(null);
    }
  }

  function cancelRename(): void {
    setRenamingId(null);
    setRenameValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % totalNavigable);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev <= 0 ? totalNavigable - 1 : prev - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex === createIndex && showCreate) void handleCreate();
        else if (activeIndex >= 0 && activeIndex < visible.length)
          selectOption(visible[activeIndex]!.id);
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
    }
  }

  return (
    <div
      data-combobox-root
      className="relative"
      onKeyDown={handleKeyDown}
      role="presentation"
      // Prevent the parent <label> element from re-triggering the button
      // when clicks inside the dropdown bubble up.
      onClick={(e) => e.preventDefault()}
    >
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(e) => openDropdown(e)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-border-default bg-surface-card px-3 py-2 text-sm text-text-primary',
          'focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
          'transition-colors hover:border-border-focus',
          disabled && 'cursor-not-allowed bg-surface-subtle text-text-muted',
          open && 'border-border-focus ring-2 ring-border-focus',
          className,
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-text-muted')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {loading && (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-text-muted" />
          )}
          {selectedOption && !disabled && (
            <span
              role="button"
              aria-label="Zrušiť výber"
              tabIndex={0}
              onClick={clearSelection}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(null);
                }
              }}
              className="rounded p-0.5 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 text-text-muted transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border-default bg-surface-card shadow-lg">
          {/* Search input */}
          <div className="border-b border-border-subtle px-2 py-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              placeholder="Hľadať…"
              className="w-full rounded-md bg-surface-subtle px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>

          {/* Options list */}
          <ul ref={listRef} id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {visible.length === 0 && !showCreate && (
              <li className="px-3 py-2 text-sm text-text-muted">Žiadne výsledky.</li>
            )}

            {visible.map((option, idx) => {
              const isSelected = option.id === value;
              const isActive = idx === activeIndex;
              const isRenaming = renamingId === option.id;

              return (
                <li
                  key={option.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={-1}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 text-sm',
                    isActive && 'bg-surface-subtle',
                    !isRenaming && 'cursor-pointer hover:bg-surface-subtle',
                  )}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    if (!isRenaming) selectOption(option.id);
                  }}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isRenaming) {
                      e.preventDefault();
                      selectOption(option.id);
                    }
                  }}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'h-4 w-4 shrink-0 text-brand-primary transition-opacity',
                      isSelected ? 'opacity-100' : 'opacity-0',
                    )}
                  />

                  {isRenaming ? (
                    <div
                      role="presentation"
                      className="flex flex-1 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitRename(option.id);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        className="flex-1 rounded border border-border-focus bg-surface-subtle px-2 py-0.5 text-sm text-text-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={renameLoading}
                        onClick={() => void commitRename(option.id)}
                        className="rounded px-1.5 py-0.5 text-xs font-medium text-brand-primary hover:bg-surface-subtle disabled:opacity-50"
                      >
                        {renameLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Uložiť'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        className="rounded p-0.5 text-text-muted hover:text-text-primary"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 truncate">{option.label}</span>
                      {canRename && (
                        <button
                          type="button"
                          aria-label={`Premenovať ${option.label}`}
                          onClick={(e) => startRename(option, e)}
                          className="shrink-0 rounded p-0.5 text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus focus-visible:ring-offset-0"
                          tabIndex={-1}
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}

            {hasMore && (
              <li className="px-3 py-1.5 text-xs text-text-muted">
                Zobrazených {VISIBLE_LIMIT} z {filtered.length}. Píšte pre vyhľadanie.
              </li>
            )}

            {showCreate && (
              <li
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-t border-border-subtle px-3 py-2 text-sm font-medium text-brand-primary',
                  activeIndex === createIndex && 'bg-surface-subtle',
                )}
                onMouseEnter={() => setActiveIndex(createIndex)}
                onClick={() => void handleCreate()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
              >
                {createLoading ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <span>+ Vytvoriť &ldquo;{queryTrimmed}&rdquo;</span>
                )}
              </li>
            )}
          </ul>

          {!query && totalAll > VISIBLE_LIMIT && (
            <div className="border-t border-border-subtle px-3 py-1.5 text-xs text-text-muted">
              Zobrazených {VISIBLE_LIMIT} z {totalAll}. Píšte pre vyhľadanie.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
