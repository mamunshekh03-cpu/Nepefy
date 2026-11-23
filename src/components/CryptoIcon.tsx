import React, { useState } from 'react';

interface CryptoIconProps {
  symbol: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md' | 'lg', string> = {
  xs: 'w-4 h-4',
  sm: 'w-5 h-5',
  md: 'w-7 h-7',
  lg: 'w-9 h-9',
};

const CDN_COINS = new Set([
  'DOGE',
  'ADA',
  'TRX',
  'AVAX',
  'LINK',
  'DOT',
  'BCH',
  'LTC',
  'UNI',
  'ICP',
  'ETC',
  'XLM',
  'FIL',
  'ATOM',
]);

const BRAND_COLORS: Record<string, { bg: string; fg: string }> = {
  DOGE: { bg: '#C2A633', fg: '#FFFFFF' },
  ADA: { bg: '#0033AD', fg: '#FFFFFF' },
  TRX: { bg: '#EB0029', fg: '#FFFFFF' },
  AVAX: { bg: '#E84142', fg: '#FFFFFF' },
  LINK: { bg: '#2A5ADA', fg: '#FFFFFF' },
  DOT: { bg: '#E6007A', fg: '#FFFFFF' },
  BCH: { bg: '#0AC18E', fg: '#FFFFFF' },
  LTC: { bg: '#345D9D', fg: '#FFFFFF' },
  UNI: { bg: '#FF007A', fg: '#FFFFFF' },
  ICP: { bg: '#29ABE2', fg: '#FFFFFF' },
  ETC: { bg: '#328332', fg: '#FFFFFF' },
  XLM: { bg: '#141B29', fg: '#FFFFFF' },
  FIL: { bg: '#0090FF', fg: '#FFFFFF' },
  ATOM: { bg: '#2E3148', fg: '#FFFFFF' },
};

export const CryptoIcon: React.FC<CryptoIconProps> = ({ symbol, size = 'sm', className }) => {
  const sym = symbol.split('/')[0].toUpperCase();
  const box = className || SIZE_CLASSES[size];
  const [imgFailed, setImgFailed] = useState(false);

  if (sym === 'BTC') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Bitcoin (BTC)">
        <circle cx="16" cy="16" r="16" fill="#F7931A" />
        <path
          fill="#FFFFFF"
          d="M22.5 13.8c.3-2.1-1.3-3.2-3.5-4l.7-2.8-1.7-.4-.7 2.7c-.4-.1-.9-.2-1.4-.3l.7-2.8-1.7-.4-.7 2.8c-.4-.1-.7-.2-1.1-.3l-2.4-.6-.5 1.8s1.3.3 1.2.3c.7.2.8.6.8 1l-.8 3.2c0 .1.1.1.2.1l-.2-.1-1.1 4.5c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.6c.4.1.8.2 1.2.3l-.7 2.9 1.7.4.7-2.8c.5.1.9.2 1.4.3l-.7 2.8 1.7.4.7-2.9c3 .6 5.2.3 6.2-2.4.8-2.2 0-3.4-1.6-4.2 1.1-.2 2-.9 2.2-2.3zm-4 5.5c-.6 2.2-4.3 1-5.5.7l1-3.9c1.2.3 5.1.9 4.5 3.2zm.6-5.5c-.5 2-3.6 1-4.6.7l.9-3.6c1 .3 4.2.7 3.7 2.9z"
        />
      </svg>
    );
  }

  if (sym === 'ETH') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Ethereum (ETH)">
        <circle cx="16" cy="16" r="16" fill="#627EEA" />
        <g fill="#FFFFFF">
          <polygon fillOpacity="0.65" points="16.4,5 16.4,13.2 23.1,16.2" />
          <polygon points="16.4,5 9.7,16.2 16.4,13.2" />
          <polygon fillOpacity="0.65" points="16.4,21.5 16.4,27 23.1,17.5" />
          <polygon points="16.4,27 16.4,21.5 9.7,17.5" />
          <polygon fillOpacity="0.3" points="16.4,20.2 23.1,16.2 16.4,13.2" />
          <polygon fillOpacity="0.75" points="9.7,16.2 16.4,20.2 16.4,13.2" />
        </g>
      </svg>
    );
  }

  if (sym === 'SOL') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Solana (SOL)">
        <defs>
          <linearGradient id="nepefy-sol-grad" x1="6" y1="26" x2="26" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9945FF" />
            <stop offset="52%" stopColor="#26C6DA" />
            <stop offset="100%" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="#0F172A" />
        <path
          fill="url(#nepefy-sol-grad)"
          d="M9.6 20.6c.2-.2.4-.3.7-.3h13.5c.4 0 .7.5.4.8l-2.2 2.2c-.2.2-.4.3-.7.3H7.8c-.4 0-.7-.5-.4-.8l2.2-2.2zm0-11.2c.2-.2.4-.3.7-.3h13.5c.4 0 .7.5.4.8L22 12.1c-.2.2-.4.3-.7.3H7.8c-.4 0-.7-.5-.4-.8l2.2-2.2zm12.4 5.4c-.2-.2-.4-.3-.7-.3H7.8c-.4 0-.7.5-.4.8l2.2 2.2c.2.2.4.3.7.3h13.5c.4 0 .7-.5.4-.8L22 14.8z"
        />
      </svg>
    );
  }

  if (sym === 'BNB') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="BNB Chain (BNB)">
        <circle cx="16" cy="16" r="16" fill="#F3BA2F" />
        <path
          fill="#FFFFFF"
          d="M12.1 14.3L16 10.4l3.9 3.9 2.3-2.3L16 5.8l-6.2 6.2 2.3 2.3zm-6.3 1.7L8.1 13.7l2.3 2.3-2.3 2.3L5.8 16zm6.3 1.7L16 21.6l3.9-3.9 2.3 2.3L16 26.2l-6.2-6.2 2.3-2.3zm11.8-1.7l2.3-2.3L28.5 16l-2.3 2.3L23.9 16zM18.3 16L16 13.7 14.3 15.4l-.2.2-.4.4 2.3 2.3 2.3-2.3z"
        />
      </svg>
    );
  }

  if (sym === 'XRP') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Ripple (XRP)">
        <circle cx="16" cy="16" r="16" fill="#23292F" />
        <path
          fill="#FFFFFF"
          d="M23.1 8.5h2.7l-5.6 5.5c-2.3 2.3-6.1 2.3-8.4 0L6.2 8.5h2.7l4.2 4.2c1.6 1.6 4.2 1.6 5.8 0l4.2-4.2zm-14.2 15H6.2l5.6-5.5c2.3-2.3 6.1-2.3 8.4 0l5.6 5.5h-2.7l-4.2-4.2c-1.6-1.6-4.2-1.6-5.8 0l-4.2 4.2z"
        />
      </svg>
    );
  }

  if (sym === 'USDT') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Tether (USDT)">
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <path
          fill="#FFFFFF"
          d="M17.9 17.4v-.02c-.1.01-.67.04-1.92.04-1 0-1.7-.03-1.95-.04v.03c-3.85-.17-6.72-.84-6.72-1.64 0-.8 2.87-1.47 6.72-1.64v2.61c.25.02.97.06 1.97.06 1.19 0 1.79-.05 1.9-.06v-2.6c3.84.17 6.7.84 6.7 1.64 0 .8-2.86 1.47-6.7 1.63zm0-3.54v-2.33h5.35V8.3H8.75v3.23h5.28v2.33c-4.3.2-7.53 1.04-7.53 2.05 0 1.02 3.23 1.86 7.53 2.06V25h3.87v-7.03c4.29-.2 7.5-1.04 7.5-2.06 0-1.01-3.21-1.85-7.5-2.05z"
        />
      </svg>
    );
  }

  if (sym === 'TON') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Toncoin (TON)">
        <circle cx="16" cy="16" r="16" fill="#0098EA" />
        <path
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2.1"
          strokeLinejoin="round"
          d="M9.6 10.6h12.8c1 0 1.6 1.1 1.1 2L16 25.1 8.5 12.6c-.5-.9.1-2 1.1-2zm6.4 0v14.5"
        />
      </svg>
    );
  }

  if (sym === 'SHIB') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Shiba Inu (SHIB)">
        <circle cx="16" cy="16" r="16" fill="#FFA409" />
        <circle cx="16" cy="16" r="13.2" fill="#E83F25" />
        {/* Stylized Shiba Inu ears & geometric face */}
        <path fill="#FFFFFF" d="M8.5 8.5l4.8 3.2 2.7-.7 2.7.7 4.8-3.2-1 6.7c.9 1.3 1.3 2.8 1 4.4-.5 3.1-3.6 5.4-7.5 5.4s-7-2.3-7.5-5.4c-.3-1.6.1-3.1 1-4.4l-1-6.7z" />
        <circle cx="13.1" cy="16.3" r="1.15" fill="#1E293B" />
        <circle cx="18.9" cy="16.3" r="1.15" fill="#1E293B" />
        <path fill="#1E293B" d="M14.7 19.3h2.6l-1.3 1.6z" />
      </svg>
    );
  }

  if (sym === 'SUI') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Sui (SUI)">
        <circle cx="16" cy="16" r="16" fill="#4DA2FF" />
        <path
          fill="#FFFFFF"
          d="M16 6.8c2.9 3.6 6 7.5 6 11.4a6 6 0 1 1-12 0c0-3.9 3.1-7.8 6-11.4zm0 4.5c-1.8 2.4-3.4 4.8-3.4 6.9a3.4 3.4 0 0 0 1.1 2.5c-.2-1.8 1-2.8 2.3-3.6 1.5-.9 2.4-1.8 2.4-3.1 0-.9-.9-2-2.4-2.7z"
        />
      </svg>
    );
  }

  if (sym === 'NEAR') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="NEAR Protocol (NEAR)">
        <circle cx="16" cy="16" r="16" fill="#0F172A" />
        <path
          fill="#FFFFFF"
          d="M22.2 9.4l-3.8 5.6a.6.6 0 0 0 .9.8l3.1-2.5v8.8a.4.4 0 0 1-.7.2L11.2 9.5a2 2 0 0 0-3.5 1.3v10.4a2 2 0 0 0 3.7 1l3.8-5.6a.6.6 0 0 0-.9-.8l-3.1 2.5V9.5a.4.4 0 0 1 .7-.2l10.5 12.8a2 2 0 0 0 3.5-1.3V10.4a2 2 0 0 0-3.7-1z"
        />
      </svg>
    );
  }

  if (sym === 'APT') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Aptos (APT)">
        <circle cx="16" cy="16" r="16" fill="#111827" />
        <path
          fill="#FFFFFF"
          d="M20.8 10.2h-9.4l-1.8 2h7.9l-1.1 1.4h-8.1l-1.5 2h10.8l-1.1 1.4H6.7l1.2 2h7.6l-1.2 1.5H9.6l1.7 1.8h10.4l1.6-2h-7.4l1.1-1.5h7.6l1.3-1.8H16l1.1-1.4h8.2l1.4-2h-8.4l1.2-1.4h6.4z"
        />
      </svg>
    );
  }

  if (sym === 'PEPE') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Pepe (PEPE)">
        <circle cx="16" cy="16" r="16" fill="#3D9B35" />
        {/* Clean Pepe frog emblem */}
        <circle cx="11.5" cy="13" r="3.4" fill="#FFFFFF" />
        <circle cx="20.5" cy="13" r="3.4" fill="#FFFFFF" />
        <circle cx="12" cy="13.1" r="1.5" fill="#111827" />
        <circle cx="21" cy="13.1" r="1.5" fill="#111827" />
        <path d="M9.5 19.8c2.2 2.1 10.8 2.1 13 0" fill="none" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M10.5 21.8c3 1.5 8 1.5 11 0" fill="none" stroke="#166534" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (sym === 'HBAR') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Hedera (HBAR)">
        <circle cx="16" cy="16" r="16" fill="#111827" />
        <path
          fill="#FFFFFF"
          d="M10 8.5h2.4v5.1h7.2V8.5H22v15h-2.4v-5.1h-7.2v5.1H10v-15zm2.4 7v1.1h7.2v-1.1h-7.2z"
        />
        <rect x="12.4" y="13.8" width="7.2" height="1.4" fill="#FFFFFF" />
        <rect x="12.4" y="16.8" width="7.2" height="1.4" fill="#FFFFFF" />
      </svg>
    );
  }

  if (sym === 'ARB') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Arbitrum (ARB)">
        <circle cx="16" cy="16" r="16" fill="#213147" />
        <path
          fill="#12AAFF"
          d="M16 6.5l8 4.6v9.8l-8 4.6-8-4.6v-9.8l8-4.6z"
          fillOpacity="0.22"
          stroke="#12AAFF"
          strokeWidth="1.8"
        />
        <path fill="#FFFFFF" d="M14.7 11.2l-4.2 9.4h2.5l2.8-6.4 1.6 3.5h-2.1l-.8 1.9h4.6l.4 1h2.4l-4.3-9.4h-2.9z" />
        <path fill="#12AAFF" d="M17.3 11.2l4.2 9.4h-2.2l-3.1-6.9z" />
      </svg>
    );
  }

  if (sym === 'OP') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Optimism (OP)">
        <circle cx="16" cy="16" r="16" fill="#FF0420" />
        <path
          fill="#FFFFFF"
          d="M11.6 20.5c-2.4 0-3.9-1.5-3.9-3.9 0-3 2-5.2 4.9-5.2 2.4 0 3.9 1.5 3.9 3.9 0 3-2 5.2-4.9 5.2zm.3-2.1c1.3 0 2.2-1.2 2.2-3 0-1.2-.6-1.9-1.6-1.9-1.3 0-2.2 1.2-2.2 3 0 1.2.6 1.9 1.6 1.9zm5.9 1.9l1.7-8.7h3.5c1.9 0 3 1 3 2.6 0 2.1-1.5 3.6-3.7 3.6h-1.8l-.5 2.5h-2.2zm3.2-4.4h1.3c1 0 1.7-.6 1.7-1.6 0-.7-.5-1.1-1.3-1.1h-1.1l-.6 2.7z"
        />
      </svg>
    );
  }

  if (sym === 'INJ') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Injective (INJ)">
        <defs>
          <linearGradient id="nepefy-inj-grad" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0082FF" />
            <stop offset="100%" stopColor="#00F2FE" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill="url(#nepefy-inj-grad)" />
        <path
          fill="#FFFFFF"
          d="M21.2 9.4c-3.9-2.2-8.9-1-11.2 2.7-1.7 2.8-1.4 6.3.7 8.7.6-.8 1.5-1.3 2.6-1.3-1.4-1.6-1.6-4-.4-5.9 1.5-2.4 4.7-3.2 7.2-1.8.8.4 1.4 1.1 1.9 1.8l1.7-1.7a9.4 9.4 0 0 0-2.5-2.5zm-10.4 13.2c3.9 2.2 8.9 1 11.2-2.7 1.7-2.8 1.4-6.3-.7-8.7-.6.8-1.5 1.3-2.6 1.3 1.4 1.6 1.6 4 .4 5.9-1.5 2.4-4.7 3.2-7.2 1.8-.8-.4-1.4-1.1-1.9-1.8l-1.7 1.7c.7 1 1.5 1.8 2.5 2.5z"
        />
      </svg>
    );
  }

  if (sym === 'RENDER') {
    return (
      <svg viewBox="0 0 32 32" className={`${box} shrink-0`} aria-label="Render (RENDER)">
        <circle cx="16" cy="16" r="16" fill="#0A0A0A" />
        <path
          fill="#FFFFFF"
          d="M16 7a9 9 0 1 0 7.7 13.6l-3.5-2.1a4.9 4.9 0 1 1-4.2-7.4 4.8 4.8 0 0 1 4.6 3.5l3.9-1.1A9 9 0 0 0 16 7z"
        />
        <circle cx="21.5" cy="18.2" r="2.1" fill="#FFFFFF" />
      </svg>
    );
  }

  if (CDN_COINS.has(sym) && !imgFailed) {
    return (
      <img
        src={`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${sym.toLowerCase()}.svg`}
        alt={`${sym} logo`}
        className={`${box} shrink-0 rounded-full object-contain`}
        onError={() => setImgFailed(true)}
        loading="lazy"
      />
    );
  }

  const brand = BRAND_COLORS[sym];
  if (brand) {
    return (
      <div
        className={`${box} shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold`}
        style={{ backgroundColor: brand.bg, color: brand.fg }}
        aria-label={sym}
      >
        {sym.slice(0, 3)}
      </div>
    );
  }

  return (
    <div
      className={`${box} shrink-0 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center text-[10px] font-bold text-blue-600`}
      aria-label={sym}
    >
      {sym.slice(0, 3)}
    </div>
  );
};

interface GatewayLogoProps {
  gateway: string;
  size?: 'xs' | 'sm' | 'md';
  showText?: boolean;
}

export const GatewayLogo: React.FC<GatewayLogoProps> = ({ gateway, size = 'sm', showText = true }) => {
  const lower = gateway.toLowerCase();
  const isBybit = lower.includes('bybit');
  const isNagad = lower.includes('nagad');
  const isBkash = lower.includes('bkash');
  const isRocket = lower.includes('rocket');
  const isBankWire = lower.includes('bank');
  const iconBox = size === 'xs' ? 'w-4 h-4' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const bybitBox = size === 'xs' ? 'w-7 h-4' : size === 'sm' ? 'w-8 h-5' : 'w-10 h-6';
  const gapClass = size === 'xs' ? 'gap-1.5 text-[11px]' : 'gap-2';

  if (isBybit) {
    return (
      <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
        <span
          className={`${bybitBox} shrink-0 rounded-md bg-[#15182A] inline-flex items-center justify-center px-1`}
          aria-label="Bybit"
        >
          <svg viewBox="0 -1 13547 4515" className="w-full h-auto" aria-hidden="true">
            <polygon fill="#F6A500" points="9655,3480 9655,-1 10355,-1 10355,3480" />
            <path
              fill="#FFFFFF"
              d="M1500 4514l-1500 0 0 -3481 1440 0c700,0 1107,381 1107,978 0,386 -262,636 -443,719 216,98 493,318 493,782 0,650 -458,1002 -1097,1002zm-116 -2875l0 0 -685 0 0 802 685 0c297,0 463,-161 463,-401 0,-239 -166,-401 -463,-401zm45 1413l0 0 -730 0 0 856 730 0c317,0 468,-195 468,-430 0,-235 -151,-425 -468,-425z"
            />
            <polygon fill="#FFFFFF" points="4732,3086 4732,4514 4037,4514 4037,3086 2960,1033 3720,1033 4389,2436 5049,1033 5809,1033" />
            <path
              fill="#FFFFFF"
              d="M7793 4514l-1500 0 0 -3481 1440 0c700,0 1107,381 1107,978 0,386 -262,636 -443,719 216,98 493,318 493,782 0,650 -458,1002 -1097,1002zm-116 -2875l0 0 -685 0 0 802 685 0c297,0 463,-161 463,-401 0,-239 -166,-401 -463,-401zm45 1413l0 0 -730 0 0 856 730 0c317,0 468,-195 468,-430 0,-235 -151,-425 -468,-425z"
            />
            <polygon fill="#FFFFFF" points="12610,1639 12610,4514 11911,4514 11911,1639 10974,1639 10974,1033 13547,1033 13547,1639" />
          </svg>
        </span>
        {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
      </span>
    );
  }

  if (isNagad) {
    return (
      <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
        <span
          className={`${iconBox} shrink-0 rounded-md bg-white border border-slate-200 inline-flex items-center justify-center p-0.5`}
          aria-label="Nagad"
        >
          <svg viewBox="4 0 56 51" className="w-full h-full" aria-hidden="true">
            <path
              fill="#ED1C24"
              d="M53.2 28.1c0 .7 0 1.3-.1 1.9-.2 2.8-.9 5.4-2 7.8-.4 1-.9 1.9-1.5 2.8-4.2 6.6-11.6 11-20 11-3.6 0-7-.8-10-2.2C11.6 45.7 6 37.5 6 28.1 6 18.8 11.4 10.8 19.1 7c-.6.8-1.2 1.6-1.7 2.5 0 .1-.1.1-.1.2-.3.3-.6.5-.9.8-.4.3-.7.7-1.1 1l-.2.2-.2.2c-.1.1-.2.3-.4.4-.2.3-.5.6-.7.9-1 1.3-1.8 2.7-2.4 4.2-.1.1-.1.3-.2.4-.1.2-.1.4-.2.5 0 .1-.1.2-.1.3-.1.3-.2.5-.3.8-.1.2-.1.4-.2.5 0 .1-.1.2-.1.3 0 .2-.1.4-.1.6l-.3 1.8c0 .2 0 .3-.1.5v2.4c0 6.4 2.9 12.2 7.6 15.9 3.6 2.9 8.1 4.7 13 4.7 4.5 0 8.6-1.4 12-3.9 2.5-1.8 4.5-4.1 6-6.8.2-.4.4-.7.6-1.1 1.2-2.5 1.9-5.2 1.9-8.1v-.7c0-.7 0-1.3-.1-2l.1.1c.3.3.6.5.9.8.3-.5.6-.9.9-1.4.2.9.3 1.8.4 2.8.1.9.1 1.6.1 2.3z"
            />
            <path
              fill="#F7941D"
              d="M32.4 9.2L28 1.1c-7.3 3.3-12.3 10.6-12.3 19.1 0 4.3 1.3 8.3 3.5 11.6-.2-1.1-.2-2.2-.2-3.4.1-8.7 5.6-16.1 13.4-19.2z"
            />
            <path
              fill="#ED1C24"
              d="M35.9 13.2c1.8-.5 3.8-.7 5.7-.7 1.2 0 2.5.1 3.6.3l-.1-3.6-.2-7.2c-.8-.1-1.7-.2-2.6-.2-4 0-7.7 1.3-10.7 3.4L34 9.6c-4.3 1.5-7.8 4.5-10 8.4-1.1 1.9-1.9 4.1-2.2 6.4.6-1.2 1.3-2.3 2.1-3.3 2.9-3.8 7.1-6.7 12-7.9z"
            />
            <path
              fill="#F7941D"
              d="M46.4 9.1l.2 5.1c-1.7-.5-3.4-.8-5.3-.8-3.5 0-6.8 1-9.7 2.7-3.6 2.2-6.4 5.7-7.8 9.8 1.4-1.9 3.1-3.6 5.1-4.9 2.9-1.9 6.4-3 10.1-3 2.8 0 5.4.6 7.8 1.7 1.8.8 3.4 1.9 4.8 3.3l2.8-4.2 3.6-5.5c-3.2-2.6-7.2-4.2-11.6-4.2z"
            />
            <path
              fill="#F7941D"
              d="M50.9 25.7v.7c0 4.2-1.7 7.7-1.9 8.1-.2.4-.4.7-.6 1.1-1.5 2.7-3.5 5-6 6.8-3.4 2.4-7.5 3.9-12 3.9-4.9 0-9.5-1.7-13-4.7-4.6-3.8-7.6-9.5-7.6-15.9v-2.4c0-.2 0-.3.1-.5l.3-1.8c0-.2.1-.4.1-.6 0-.1.1-.2.1-.3.1-.2.1-.4.2-.5.1-.3.2-.6.3-.8 0-.1.1-.2.1-.3.1-.2.1-.4.2-.5.1-.1.1-.3.2-.4.6-1.5 1.5-2.9 2.4-4.2.2-.3.5-.6.7-.9.1-.1.2-.3.4-.4.1-.1.1-.2.2-.2.1-.1.1-.2.2-.2.3-.4.7-.7 1.1-1 .3-.3.6-.5.9-.8 0 .1-.1.1-.1.2s-.1.2-.1.2c-1.2 2.4-2 5.3-2.3 8.3-.1.8-.1 1.6-.1 2.5 0 10.8 6.3 19.5 14.1 19.5h.8c1.1 0 2.2-.2 3.3-.4 5.3-1.4 9.2-6.3 9.2-12v-.3c-.1-3.4-1.5-6.5-3.8-8.6 1.6 0 3.2.3 4.7.7 2.9.7 5.5 2.1 7.8 3.9l.1.1c-.1.4 0 1.1 0 1.7z"
            />
          </svg>
        </span>
        {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
      </span>
    );
  }

  if (isBkash) {
    return (
      <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
        <span
          className={`${iconBox} shrink-0 rounded-md bg-white border border-slate-200 inline-flex items-center justify-center p-0.5`}
          aria-label="bKash"
        >
          <svg viewBox="124 -4 126 121" className="w-full h-full" aria-hidden="true">
            <path fill="#D12053" d="M223.65 62.45l-53.03-8.31 7.03 31.6z" />
            <path fill="#E2136E" d="M223.65 62.45L183.69 6.93l-13.06 47.22z" />
            <path fill="#D12053" d="M169.39 53.51L127.52 0l54.83 6.55z" />
            <path fill="#9E1638" d="M150.32 31.15L127.07 9.24h6.12z" />
            <path fill="#D12053" d="M234.96 35.46l-9.84 26.69-15.95-22.06z" />
            <path fill="#E2136E" d="M183.84 84.14l38.61-15.51 1.62-4.93z" />
            <path fill="#9E1638" d="M152.96 113.41l16.54-58.02 8.39 37.75z" />
            <path fill="#E2136E" d="M236.5 35.67l-4.06 11.02 14.64-.24z" />
          </svg>
        </span>
        {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
      </span>
    );
  }

  if (isRocket) {
    return (
      <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
        <span
          className={`${iconBox} shrink-0 rounded-md bg-[#8C3494] inline-flex items-center justify-center p-0.5`}
          aria-label="Rocket"
        >
          <svg viewBox="82 -4 92 81" className="w-full h-full" aria-hidden="true">
            <path
              fill="#FFFFFF"
              fillRule="evenodd"
              d="M 148.546875 16.363281 L 119.070312 45.933594 L 121.101562 62.507812 L 126.5625 51.128906 L 143.367188 72.621094 L 166.894531 0 L 88.542969 32.660156 L 109.757812 43.824219 Z"
            />
          </svg>
        </span>
        {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
      </span>
    );
  }

  if (isBankWire) {
    return (
      <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
        <svg viewBox="0 0 32 32" className={`${iconBox} shrink-0`} aria-label="Bank Wire">
          <rect width="32" height="32" rx="7" fill="#0F172A" />
          <path
            d="M16 7.2L7.5 12v1.6h17V12L16 7.2zm-6.4 8.1v6.2h2.2v-6.2H9.6zm5.3 0v6.2h2.2v-6.2h-2.2zm5.3 0v6.2h2.2v-6.2h-2.2zM7.5 23v1.8h17V23h-17z"
            fill="#FFFFFF"
          />
        </svg>
        {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center ${gapClass} whitespace-nowrap`}>
      <svg viewBox="0 0 1024 1024" className={`${iconBox} shrink-0`} aria-label="Binance">
        <rect width="1024" height="1024" rx="220" fill="#F3BA2F" />
        <path
          fill="#FFFFFF"
          d="M404.9 468 512 360.9l107.1 107.2 62.3-62.3L512 236.3 342.6 405.7z"
        />
        <path
          transform="rotate(-45.001 298.629 511.998)"
          fill="#FFFFFF"
          d="M254.6 467.9h88.1V556h-88.1z"
        />
        <path
          fill="#FFFFFF"
          d="M404.9 556 512 663.1l107.1-107.2 62.4 62.3h-.1L512 787.7 342.6 618.3l-.1-.1z"
        />
        <path
          transform="rotate(-45.001 725.364 512.032)"
          fill="#FFFFFF"
          d="M681.3 468h88.1v88.1h-88.1z"
        />
        <path
          fill="#FFFFFF"
          d="M575.2 512 512 448.7l-46.7 46.8-5.4 5.3-11.1 11.1-.1.1.1.1 63.2 63.2 63.2-63.3z"
        />
      </svg>
      {showText && <span className="font-semibold text-slate-900">{gateway}</span>}
    </span>
  );
};
