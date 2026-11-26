import React, { useEffect, useId, useState } from 'react';

interface NepefyMarkProps {
  size?: number;
  loading?: boolean;
  cycleKey?: number;
  darkMode?: boolean;
  className?: string;
}

export const NepefyMark: React.FC<NepefyMarkProps> = ({
  size = 34,
  loading = false,
  cycleKey = 1,
  darkMode = false,
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const blueGradId = `nepefy-blue-${uid}`;

  return (
    <span
      key={loading ? 'loading' : `mark-${cycleKey}`}
      style={{ width: size, height: size }}
      className={`relative inline-flex items-center justify-center shrink-0 nepefy-mark-box ${
        loading ? 'nepefy-loading-box' : ''
      } ${className}`}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full block"
        shapeRendering="geometricPrecision"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={blueGradId} x1="26" y1="10" x2="40" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={darkMode ? '#BD24DF' : '#3B82F6'} />
            <stop offset="100%" stopColor={darkMode ? '#2D6ADE' : '#1D4ED8'} />
          </linearGradient>
        </defs>

        <path
          d="M11 37V11L20 20"
          stroke={darkMode ? '#FFFFFF' : '#0F172A'}
          strokeWidth="6.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={loading ? 'nepefy-loading-outer' : ''}
        />
        <path
          d="M37 11V37L28 28"
          stroke={`url(#${blueGradId})`}
          strokeWidth="6.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={loading ? 'nepefy-loading-inner' : ''}
        />
      </svg>
    </span>
  );
};

interface NepefyLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  loading?: boolean;
  darkMode?: boolean;
  className?: string;
}

export const NepefyLogo: React.FC<NepefyLogoProps> = ({
  size = 'md',
  showTagline = true,
  loading = false,
  darkMode = false,
  className = '',
}) => {
  const [pulseCycle, setPulseCycle] = useState(1);

  useEffect(() => {
    if (loading) return;
    const interval = setInterval(() => {
      setPulseCycle((c) => c + 1);
    }, 14000);
    return () => clearInterval(interval);
  }, [loading]);

  const markPx = size === 'lg' ? 46 : size === 'sm' ? 28 : 34;
  const textSize = size === 'lg' ? 'text-[22px]' : size === 'sm' ? 'text-lg' : 'text-[19px]';
  const taglineSize = size === 'lg' ? 'text-xs' : 'text-[10.5px]';

  return (
    <div
      className={`nepefy-logo-trigger inline-flex items-center gap-2 whitespace-nowrap shrink-0 select-none ${
        loading ? '' : 'cursor-pointer'
      } ${className}`}
      onClick={() => {
        if (!loading) setPulseCycle((c) => c + 1);
      }}
      title="Nepefy — Built for the Future"
    >
      <NepefyMark size={markPx} loading={loading} cycleKey={pulseCycle} darkMode={darkMode} />

      <div className="flex flex-col justify-center">
        <span className={`${textSize} font-bold tracking-tight leading-none ${darkMode ? 'text-white' : 'text-slate-900'}`}>
          Nepefy
        </span>
        {showTagline && (
          <span
            className={`${taglineSize} font-medium leading-none mt-1 tracking-tight ${
              darkMode ? 'text-[#B4C7ED]' : 'text-slate-500'
            }`}
          >
            Built for the Future
          </span>
        )}
      </div>
    </div>
  );
};
