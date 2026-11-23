import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { formatUsd, getPriceDecimals } from '../lib/api';
import type { MarketPair } from '../types';
import { CryptoIcon } from './CryptoIcon';

interface HeroAnimatedExchangeVisualProps {
  markets: MarketPair[];
  onTradeClick: () => void;
}

const FEATURED_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];

const formatTurnover = (value: number | undefined): string => {
  const num = Number(value || 0);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${formatUsd(num)}`;
};

export const HeroAnimatedExchangeVisual: React.FC<HeroAnimatedExchangeVisualProps> = ({
  markets,
  onTradeClick,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC/USDT');
  const [userPinned, setUserPinned] = useState(false);
  const historyMapRef = useRef<Record<string, number[]>>({});

  const featuredPairs = useMemo(() => {
    const picked = FEATURED_SYMBOLS.map((sym) => markets.find((m) => m.symbol === sym)).filter(
      (m): m is MarketPair => Boolean(m)
    );
    return picked.length > 0 ? picked : markets.slice(0, 4);
  }, [markets]);

  const activePair = useMemo(() => {
    return (
      featuredPairs.find((m) => m.symbol === selectedSymbol) ||
      featuredPairs[0] || {
        symbol: 'BTC/USDT',
        base_asset: 'BTC',
        name: 'Bitcoin',
        current_price: 64750,
        spread_bps: 10,
        volatility_pct: 0.6,
        auto_drift: 1,
        change_24h_pct: 1.85,
        high_24h: 65820,
        low_24h: 62910,
        turnover_24h: 3_420_000_000,
        updated_at: new Date().toISOString(),
      }
    );
  }, [featuredPairs, selectedSymbol]);

  // Gently auto-rotate featured pair every 6s until user picks one manually
  useEffect(() => {
    if (userPinned || featuredPairs.length < 2 || prefersReducedMotion) return;
    const timer = setInterval(() => {
      setSelectedSymbol((prev) => {
        const idx = featuredPairs.findIndex((p) => p.symbol === prev);
        const next = featuredPairs[(idx + 1) % featuredPairs.length];
        return next ? next.symbol : prev;
      });
    }, 6000);
    return () => clearInterval(timer);
  }, [featuredPairs, userPinned, prefersReducedMotion]);

  // Track real live WebSocket price ticks per symbol
  const liveSeries = useMemo(() => {
    const sym = activePair.symbol;
    const price = Number(activePair.current_price || 0);
    const chgPct = Number(activePair.change_24h_pct || 0);
    const hasRealMarket = markets.some((m) => m.symbol === sym);

    const buildSeededCurve = (anchorPrice: number) => {
      const seeded: number[] = [];
      const high = Number(activePair.high_24h || anchorPrice * 1.02);
      const low = Number(activePair.low_24h || anchorPrice * 0.98);
      const span = Math.max(anchorPrice * 0.008, high - low);
      const denom = 1 + chgPct / 100;
      const startPrice = denom > 0.1 ? anchorPrice / denom : anchorPrice;
      for (let i = 0; i < 17; i++) {
        const t = i / 17;
        const wave = Math.sin(i * 0.85) * 0.22 + Math.cos(i * 1.4) * 0.14;
        const interp = startPrice + (anchorPrice - startPrice) * t + wave * span * 0.35;
        seeded.push(Math.max(anchorPrice * 0.5, interp));
      }
      seeded.push(anchorPrice);
      return seeded;
    };

    if (!hasRealMarket) {
      return buildSeededCurve(price);
    }

    const prevList = historyMapRef.current[sym] || [];
    if (prevList.length === 0 && price > 0) {
      const seeded = buildSeededCurve(price);
      historyMapRef.current[sym] = seeded;
      return seeded;
    }

    if (price > 0 && prevList[prevList.length - 1] !== price) {
      const updated = [...prevList.slice(-17), price];
      historyMapRef.current[sym] = updated;
      return updated;
    }

    return prevList;
  }, [markets, activePair.symbol, activePair.current_price, activePair.change_24h_pct, activePair.high_24h, activePair.low_24h]);

  const dec = getPriceDecimals(activePair.current_price);
  const chg = Number(activePair.change_24h_pct || 0);
  const isUp = chg >= 0;
  const highVal = Number(activePair.high_24h || activePair.current_price);
  const lowVal = Number(activePair.low_24h || activePair.current_price);

  // Build smooth SVG candles + curve coordinates
  const chartGeom = useMemo(() => {
    const w = 480;
    const h = 190;
    const padX = 14;
    const padTop = 18;
    const padBottom = 18;
    const pts = liveSeries.length >= 2 ? liveSeries : [activePair.current_price, activePair.current_price];
    const minP = Math.min(...pts);
    const maxP = Math.max(...pts);
    const span = Math.max(maxP - minP, activePair.current_price * 0.003, 1e-8);
    const yMin = minP - span * 0.18;
    const yMax = maxP + span * 0.18;

    const toY = (val: number) =>
      padTop + (1 - (val - yMin) / Math.max(1e-9, yMax - yMin)) * (h - padTop - padBottom);

    const coords = pts.map((val, idx) => {
      const x = padX + (idx / Math.max(1, pts.length - 1)) * (w - padX * 2);
      const y = toY(val);
      const prevVal = idx > 0 ? pts[idx - 1] : val * 0.999;
      const openY = toY(prevVal);
      const closeY = y;
      const candleTop = Math.min(openY, closeY);
      const candleH = Math.max(4, Math.abs(closeY - openY));
      const wickPad = 5 + ((idx * 7) % 9);
      const wickTop = Math.max(padTop - 4, candleTop - wickPad);
      const wickBottom = Math.min(h - padBottom + 4, candleTop + candleH + wickPad);
      const bullish = val >= prevVal;
      return { x, y, candleTop, candleH, wickTop, wickBottom, bullish };
    });

    // Smooth cubic path
    let linePath = '';
    coords.forEach((c, i) => {
      if (i === 0) {
        linePath = `M ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
      } else {
        const prev = coords[i - 1];
        const cx = ((prev.x + c.x) / 2).toFixed(1);
        linePath += ` C ${cx} ${prev.y.toFixed(1)}, ${cx} ${c.y.toFixed(1)}, ${c.x.toFixed(1)} ${c.y.toFixed(1)}`;
      }
    });

    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath =
      coords.length > 0
        ? `${linePath} L ${last.x.toFixed(1)} ${(h - padBottom).toFixed(1)} L ${first.x.toFixed(1)} ${(h - padBottom).toFixed(1)} Z`
        : '';

    return { w, h, coords, linePath, areaPath, last };
  }, [liveSeries, activePair.current_price]);

  const floatingCoins = [
    { symbol: 'BTC', pos: '-top-3 -right-2 sm:top-2 sm:-right-4', delay: 0, duration: 4.2 },
    { symbol: 'ETH', pos: '-bottom-3 -left-2 sm:bottom-4 sm:-left-4', delay: 0.7, duration: 4.8 },
    { symbol: 'SOL', pos: 'top-16 -left-3 hidden sm:flex', delay: 1.2, duration: 5.2 },
    { symbol: 'BNB', pos: 'bottom-20 -right-3 hidden sm:flex', delay: 0.4, duration: 4.5 },
  ];

  return (
    <div className="relative py-4 sm:px-5 select-none">
      {/* Rotating Cosmic Orbital Rings Behind Terminal */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
      >
        <motion.svg
          viewBox="0 0 500 500"
          className="w-[420px] h-[420px] sm:w-[490px] sm:h-[490px] opacity-40"
          animate={prefersReducedMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 42, repeat: Infinity, ease: 'linear' }}
        >
          <defs>
            <linearGradient id="hero-orbit-grad-1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#bd24df" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#2d6ade" stopOpacity="0.15" />
            </linearGradient>
          </defs>
          <circle
            cx="250"
            cy="250"
            r="225"
            fill="none"
            stroke="url(#hero-orbit-grad-1)"
            strokeWidth="1.25"
            strokeDasharray="10 14"
          />
          <circle
            cx="250"
            cy="250"
            r="175"
            fill="none"
            stroke="#2d6ade"
            strokeOpacity="0.28"
            strokeWidth="1"
            strokeDasharray="5 12"
          />
        </motion.svg>
      </div>

      {/* Levitating Crypto Coin Medallions */}
      {floatingCoins.map((coin) => {
        const pairMatch = markets.find((m) => m.base_asset === coin.symbol);
        const isSelected = activePair.base_asset === coin.symbol;
        return (
          <motion.button
            key={coin.symbol}
            type="button"
            onClick={() => {
              if (pairMatch) {
                setUserPinned(true);
                setSelectedSymbol(pairMatch.symbol);
              }
            }}
            title={`View ${coin.symbol}/USDT live chart`}
            aria-label={`Switch chart to ${coin.symbol}/USDT`}
            animate={
              prefersReducedMotion
                ? undefined
                : {
                    y: [0, -9, 0],
                    rotate: [0, 3, -2, 0],
                  }
            }
            transition={{
              duration: coin.duration,
              delay: coin.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            whileHover={{ scale: 1.12 }}
            className={`absolute ${coin.pos} z-20 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#091945]/95 border ${
              isSelected
                ? 'border-[#bd24df] shadow-lg shadow-[#bd24df]/40'
                : 'border-[#2d6ade]/60 shadow-lg shadow-[#2d6ade]/25'
            } flex items-center justify-center backdrop-blur-md cursor-pointer transition-colors`}
          >
            <CryptoIcon symbol={coin.symbol} size="md" />
          </motion.button>
        );
      })}

      {/* Main Glass Live Chart Card */}
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="relative z-10 rounded-2xl bg-[#091945]/95 border border-[#1e326d] shadow-2xl shadow-[#2d6ade]/20 backdrop-blur-md p-5 sm:p-6 space-y-4"
      >
        {/* Top Row: Active Coin & Live Streaming Price */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#040d26] border border-[#1e326d] flex items-center justify-center shrink-0">
              <CryptoIcon symbol={activePair.symbol} size="md" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-white whitespace-nowrap">
                  {activePair.symbol}
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  LIVE
                </span>
              </div>
              <div className="text-xs text-[#8a9bca] truncate">{activePair.name} Spot Index</div>
            </div>
          </div>

          <div className="text-right shrink-0">
            <motion.div
              key={`${activePair.symbol}-${activePair.current_price}`}
              initial={prefersReducedMotion ? false : { opacity: 0.7, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="text-xl sm:text-2xl font-bold font-mono-tabular text-white"
            >
              ${formatUsd(activePair.current_price, dec)}
            </motion.div>
            <div
              className={`mt-0.5 inline-flex items-center justify-end gap-1 text-xs font-semibold font-mono-tabular ${
                isUp ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isUp ? (
                <TrendingUp className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {isUp ? '+' : ''}
                {chg.toFixed(2)}% (24h)
              </span>
            </div>
          </div>
        </div>

        {/* Pair Switcher Bar */}
        <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#040d26] border border-[#132259]">
          {featuredPairs.slice(0, 4).map((pair) => {
            const active = pair.symbol === activePair.symbol;
            const pairUp = Number(pair.change_24h_pct || 0) >= 0;
            return (
              <button
                key={pair.symbol}
                type="button"
                onClick={() => {
                  setUserPinned(true);
                  setSelectedSymbol(pair.symbol);
                }}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-r from-[#bd24df] to-[#2d6ade] text-white shadow-sm'
                    : 'text-[#8a9bca] hover:text-white hover:bg-[#091945]'
                }`}
              >
                <span>{pair.base_asset}</span>
                <span
                  className={`hidden sm:inline font-mono-tabular text-[10px] ${
                    active ? 'text-white/90' : pairUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {pairUp ? '+' : ''}
                  {Number(pair.change_24h_pct || 0).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>

        {/* Animated Candlestick + Neon Gradient Area Chart */}
        <div className="relative rounded-xl bg-[#040d26]/90 border border-[#132259] px-2 pt-2 pb-1 overflow-hidden">
          <svg
            viewBox={`0 0 ${chartGeom.w} ${chartGeom.h}`}
            className="w-full h-44 sm:h-48 overflow-visible"
            role="img"
            aria-label={`Animated live price chart for ${activePair.symbol}`}
          >
            <defs>
              <linearGradient id="hero-chart-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#bd24df" />
                <stop offset="100%" stopColor="#2d6ade" />
              </linearGradient>
              <linearGradient id="hero-chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#bd24df" stopOpacity="0.32" />
                <stop offset="60%" stopColor="#2d6ade" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#040d26" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Subtle Horizontal Grid Lines */}
            {[0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1={10}
                y1={chartGeom.h * ratio}
                x2={chartGeom.w - 10}
                y2={chartGeom.h * ratio}
                stroke="#132259"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
            ))}

            {/* Animated Candlesticks Behind Line */}
            {chartGeom.coords.map((c, idx) => (
              <motion.g
                key={`${activePair.symbol}-candle-${idx}`}
                initial={prefersReducedMotion ? false : { opacity: 0, scaleY: 0.4 }}
                animate={{ opacity: 0.65, scaleY: 1 }}
                transition={{ duration: 0.35, delay: idx * 0.02 }}
                style={{ originY: '50%' }}
              >
                <line
                  x1={c.x}
                  y1={c.wickTop}
                  x2={c.x}
                  y2={c.wickBottom}
                  stroke={c.bullish ? '#34d399' : '#bd24df'}
                  strokeWidth="1.2"
                  strokeOpacity="0.65"
                />
                <rect
                  x={c.x - 4.5}
                  y={c.candleTop}
                  width={9}
                  height={c.candleH}
                  rx={2}
                  fill={c.bullish ? '#10b981' : '#bd24df'}
                  fillOpacity="0.38"
                />
              </motion.g>
            ))}

            {/* Gradient Area */}
            {chartGeom.areaPath && (
              <motion.path
                key={`area-${activePair.symbol}`}
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
                d={chartGeom.areaPath}
                fill="url(#hero-chart-fill)"
              />
            )}

            {/* Animated Price Trajectory Line */}
            {chartGeom.linePath && (
              <motion.path
                key={`line-${activePair.symbol}`}
                initial={prefersReducedMotion ? false : { pathLength: 0.15, opacity: 0.6 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.85, ease: 'easeOut' }}
                d={chartGeom.linePath}
                fill="none"
                stroke="url(#hero-chart-stroke)"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            )}

            {/* Live Horizontal Reference Line & Pulsing Beacon */}
            {chartGeom.last && (
              <g>
                <line
                  x1={10}
                  y1={chartGeom.last.y}
                  x2={chartGeom.last.x}
                  y2={chartGeom.last.y}
                  stroke="#2d6ade"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {!prefersReducedMotion && (
                  <motion.circle
                    cx={chartGeom.last.x}
                    cy={chartGeom.last.y}
                    r="9"
                    fill="#bd24df"
                    animate={{ r: [5, 13, 5], opacity: [0.55, 0, 0.55] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <circle
                  cx={chartGeom.last.x}
                  cy={chartGeom.last.y}
                  r="4.5"
                  fill="#ffffff"
                  stroke="#bd24df"
                  strokeWidth="2.5"
                />
              </g>
            )}
          </svg>
        </div>

        {/* Bottom Live Stats & Quick Action */}
        <div className="pt-1 flex flex-wrap items-center justify-between gap-3 border-t border-[#132259] text-xs">
          <div className="grid grid-cols-3 gap-4 sm:gap-6 flex-1 min-w-0">
            <div>
              <div className="text-[#8a9bca]">24h High</div>
              <div className="mt-0.5 font-mono-tabular font-semibold text-white">
                ${formatUsd(highVal, dec)}
              </div>
            </div>
            <div>
              <div className="text-[#8a9bca]">24h Low</div>
              <div className="mt-0.5 font-mono-tabular font-semibold text-white">
                ${formatUsd(lowVal, dec)}
              </div>
            </div>
            <div>
              <div className="text-[#8a9bca]">24h Turnover</div>
              <div className="mt-0.5 font-mono-tabular font-semibold text-white">
                {formatTurnover(activePair.turnover_24h)}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onTradeClick}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-all"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Trade {activePair.base_asset}</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
};
