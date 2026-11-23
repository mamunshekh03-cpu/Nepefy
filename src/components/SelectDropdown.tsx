import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  isOpen: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const el = ref.current;
      if (!el || !el.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, isOpen, onClose]);
}

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  searchText?: string;
  icon?: React.ReactNode;
}

interface SelectDropdownProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function SelectDropdown<T extends string | number>({
  value,
  options,
  onChange,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
  searchable = false,
  searchPlaceholder = 'Search...',
}: SelectDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(containerRef, open, () => setOpen(false));

  useEffect(() => {
    if (open && searchable) {
      setQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [open, searchable]);

  const filteredOptions = useMemo(() => {
    if (!searchable) return options;
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const hay = `${opt.label} ${String(opt.value)} ${opt.searchText || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query, searchable]);

  const selected = options.find((opt) => opt.value === value) || options[0];

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`flex items-center justify-between gap-2 text-left transition-colors ${buttonClassName}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? String(value)}</span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`absolute ${
            align === 'right' ? 'right-0' : 'left-0'
          } top-full mt-1.5 min-w-full bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden`}
        >
          {searchable && (
            <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/70">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full text-xs bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="text-slate-400 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className={`py-1 ${menuClassName}`}>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No matches found.</div>
            ) : (
              filteredOptions.map((opt) => {
                const active = opt.value === value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors whitespace-nowrap ${
                      active ? 'bg-blue-50/70 text-blue-600 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {opt.icon}
                      <span className="truncate">{opt.label}</span>
                    </span>
                    {active && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
