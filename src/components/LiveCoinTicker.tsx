import React, { useEffect, useRef } from 'react';
import type { MarketPair } from '../types';
import { CryptoIcon } from './CryptoIcon';

interface LiveCoinTickerProps {
  markets: MarketPair[];
  onSelectCoin?: (symbol: string) => void;
}

function formatTickerPrice(price: number): string {
  if (!Number.isFinite(price)) return '0.00';
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (price >= 0.01) {
    return price.toFixed(4);
  }
  return price.toFixed(6);
}

const SPEED_PX_PER_SEC = 32; // Calm, readable right-to-left speed

export const LiveCoinTicker: React.FC<LiveCoinTickerProps> = ({ markets, onSelectCoin }) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const firstCopyRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const pausedRef = useRef(false);
  const hasMarkets = markets.length > 0;

  useEffect(() => {
    if (!hasMarkets) return;

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;

      const track = trackRef.current;
      const firstCopy = firstCopyRef.current;
      if (track && firstCopy) {
        const loopWidth = firstCopy.offsetWidth;
        if (loopWidth > 0) {
          if (!pausedRef.current) {
            offsetRef.current += dt * SPEED_PX_PER_SEC;
            if (offsetRef.current >= loopWidth) {
              offsetRef.current -= loopWidth;
            }
          }
          track.style.transform = `translate3d(-${offsetRef.current.toFixed(2)}px, 0, 0)`;
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [hasMarkets]);

  if (!hasMarkets) {
    return (
      <div className="h-9 flex-1 min-w-0 flex items-center text-xs text-slate-400">
        Connecting live market feed...
      </div>
    );
  }

  const renderTrackItems = (trackKey: string, refProp?: React.RefObject<HTMLDivElement | null>) => (
    <div ref={refProp} className="flex items-center shrink-0" key={trackKey}>
      {markets.map((pair) => {
        const up = Number(pair.change_24h_pct || 0) >= 0;
        return (
          <button
            key={`${trackKey}-${pair.symbol}`}
            type="button"
            onClick={() => onSelectCoin?.(pair.symbol)}
            title={`Trade ${pair.symbol} on Spot Market`}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs hover:bg-slate-100/70 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <CryptoIcon symbol={pair.base_asset} size="xs" />
            <span className="font-semibold text-slate-900">{pair.base_asset}</span>
            <span className="font-mono-tabular font-medium text-slate-700">
              ${formatTickerPrice(pair.current_price)}
            </span>
            <span
              className={`font-mono-tabular font-semibold ${
                up ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {up ? '+' : ''}
              {Number(pair.change_24h_pct || 0).toFixed(2)}%
            </span>
            <span className="ml-1.5 text-slate-300 select-none" aria-hidden="true">
              |
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      className="relative flex-1 min-w-0 h-9 overflow-hidden flex items-center"
      aria-label="Live cryptocurrency market prices"
    >
      {/* Subtle Left & Right Edge Fades */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent z-10" />

      <div ref={trackRef} className="flex items-center w-max shrink-0 will-change-transform">
        {renderTrackItems('track-a', firstCopyRef)}
        {renderTrackItems('track-b')}
      </div>
    </div>
  );
};
