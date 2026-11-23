import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Search, X } from 'lucide-react';
import { COUNTRIES } from '../lib/countries';
import { useClickOutside } from './SelectDropdown';

interface CountrySelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  hasError?: boolean;
}

export const CountrySelect: React.FC<CountrySelectProps> = ({
  value,
  onChange,
  disabled = false,
  placeholder = 'Select Country / Region',
  hasError = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useClickOutside(containerRef, open, () => setOpen(false));

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [open]);

  const filteredCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase() === q ||
        (c.aliases && c.aliases.toLowerCase().includes(q))
    );
  }, [query]);

  const matchedMeta = useMemo(
    () => COUNTRIES.find((c) => c.name.toLowerCase() === value.trim().toLowerCase()),
    [value]
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        aria-expanded={open}
        className={`w-full h-10 px-3 text-sm border rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
          disabled
            ? 'bg-slate-50 text-slate-700 border-slate-200 cursor-default'
            : hasError
            ? 'bg-red-50/40 text-slate-900 border-red-500 hover:border-red-600'
            : open
            ? 'bg-white text-slate-900 border-blue-600'
            : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {value ? (
            <span className="truncate font-medium text-slate-900">
              {value}
              {matchedMeta ? (
                <span className="ml-1.5 text-xs font-mono-tabular text-slate-400">
                  ({matchedMeta.code})
                </span>
              ) : null}
            </span>
          ) : (
            <span className="truncate text-slate-400">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            open ? 'rotate-180 text-blue-600' : ''
          }`}
        />
      </button>

      {open && !disabled && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50/70">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country (e.g. Bangladesh, US, UK)..."
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

          <div className="max-h-60 overflow-y-auto py-1">
            {value && !query && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50 border-b border-slate-100"
              >
                Clear selection
              </button>
            )}

            {filteredCountries.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">
                No matching countries found.
              </div>
            ) : (
              filteredCountries.map((item) => {
                const active = item.name.toLowerCase() === value.trim().toLowerCase();
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      onChange(item.name);
                      setOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors ${
                      active ? 'bg-blue-50/70 text-blue-600 font-semibold' : 'text-slate-700'
                    }`}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono-tabular text-slate-400">{item.code}</span>
                      {active && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
