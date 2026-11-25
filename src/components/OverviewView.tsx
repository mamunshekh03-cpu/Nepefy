import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Gift,
  Layers,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';
import { apiFetch, formatUsd, getPriceDecimals, getQtyDecimals } from '../lib/api';
import { getCountryShortCode } from '../lib/countries';
import { formatFiatAmount, getCurrencyMeta } from '../lib/currencies';
import type {
  CoinHolding,
  LedgerEntry,
  MarketPair,
  SpotTrade,
  StakingDailyLog,
  StakingPosition,
  UserProfile,
} from '../types';
import { CryptoIcon } from './CryptoIcon';
import { TransactionHistoryTable } from './TransactionHistoryTable';

interface OverviewViewProps {
  user: UserProfile;
  holdings: CoinHolding[];
  ledger: LedgerEntry[];
  markets: MarketPair[];
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string, symbol?: string) => void;
}

type EquityRange = '24H' | '7D' | '30D';

const toLocalDayKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Ledger types representing external / non-trade / non-staking equity flows
// (Trading PnL, staking accruals/penalties & open unrealized PnL are computed directly from trades & staking logs)
const EQUITY_IMPACTING_TX_TYPES = new Set([
  'DEPOSIT',
  'WITHDRAW_HOLD',
  'SEND_IN',
  'SEND_OUT',
  'SEND_FEE',
  'P2P_ESCROW_LOCK',
  'P2P_RELEASE',
  'REFERRAL_BONUS',
  'REFERRAL_MILESTONE',
  'ADMIN_ADJUST',
  'LUCKY_DRAW',
  'JACKPOT_BUY',
  'PRESALE_BUY',
  'PRESALE_WIN',
  'PRESALE_REFUND',
]);

export const OverviewView: React.FC<OverviewViewProps> = ({
  user,
  holdings,
  ledger,
  markets,
  onRefresh,
  onNavigate,
}) => {
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [trades, setTrades] = useState<SpotTrade[]>([]);
  const [stakingPositions, setStakingPositions] = useState<StakingPosition[]>([]);
  const [stakingDailyLogs, setStakingDailyLogs] = useState<StakingDailyLog[]>([]);
  const [chartRange, setChartRange] = useState<EquityRange>('7D');
  const [hoverPointIdx, setHoverPointIdx] = useState<number | null>(null);
  const [mobileMode, setMobileMode] = useState<'PORTFOLIO' | 'MARKETS'>('PORTFOLIO');
  const [mobileSearch, setMobileSearch] = useState('');
  const [hideBalance, setHideBalance] = useState(false);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(560);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 120) setChartWidth(next);
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{ trades?: SpotTrade[] }>('/api/trades').catch(() => ({ trades: [] })),
      apiFetch<{ positions?: StakingPosition[]; dailyLogs?: StakingDailyLog[] }>('/api/staking/positions').catch(() => ({
        positions: [],
        dailyLogs: [],
      })),
    ]).then(([tRes, sRes]) => {
      if (!active) return;
      setTrades(Array.isArray(tRes?.trades) ? tRes.trades : []);
      setStakingPositions(Array.isArray(sRes?.positions) ? sRes.positions : []);
      setStakingDailyLogs(Array.isArray(sRes?.dailyLogs) ? sRes.dailyLogs : []);
    });
    return () => {
      active = false;
    };
  }, [user.id, ledger.length]);

  const accountId = user.uid || user.id;
  const countryShortCode = getCountryShortCode(user.country);
  const isVerified = user.kyc_status === 'VERIFIED' || Boolean(user.verification?.verified);

  const handleCopyId = () => {
    navigator.clipboard?.writeText(accountId).catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1600);
  };

  const handleClaim = async () => {
    setClaiming(true);
    setClaimMessage(null);
    try {
      const res = await apiFetch<{ claimedAmount: number }>('/api/wallet/claim', { method: 'POST' });
      setClaimMessage(`Successfully moved $${formatUsd(res.claimedAmount)} from Claimable Wallet to Main Balance.`);
      await onRefresh();
    } catch (err: any) {
      setClaimMessage(err.message || 'Unable to claim funds');
    } finally {
      setClaiming(false);
    }
  };

  const priceByAsset = new Map<string, number>();
  const priceBySymbol = new Map<string, number>();
  markets.forEach((m) => {
    priceByAsset.set(m.base_asset, m.current_price);
    priceBySymbol.set(m.symbol, m.current_price);
  });

  const portfolioValue = holdings.reduce((acc, h) => {
    const livePrice = priceByAsset.get(h.asset) ?? h.avg_entry_price;
    return acc + Number((h.quantity * livePrice).toFixed(2));
  }, 0);

  const holdingsUnrealizedPnl = holdings.reduce((acc, h) => {
    const livePrice = priceByAsset.get(h.asset) ?? h.avg_entry_price;
    const val = Number((h.quantity * livePrice).toFixed(2));
    const costBasis = Number((h.quantity * h.avg_entry_price).toFixed(2));
    return acc + Number((val - costBasis).toFixed(2));
  }, 0);

  const computePositionPnl = (t: SpotTrade): number => {
    if (t.admin_override === 'FORCE_WIN') return Number((t.amount_usd * 0.35).toFixed(2));
    if (t.admin_override === 'FORCE_LOSS') return Number((-t.amount_usd * 0.45).toFixed(2));
    const marketPrice = priceBySymbol.get(t.symbol) ?? t.entry_price;
    if (!t.entry_price) return 0;
    const priceMovePct = (marketPrice - t.entry_price) / t.entry_price;
    const directional = t.side === 'LONG' ? priceMovePct : -priceMovePct;
    const rawPnl = t.amount_usd * directional * 5;
    return Number(Math.max(-t.amount_usd, rawPnl).toFixed(2));
  };

  const escrowedLimitSellOrders = trades.filter(
    (t) => t.order_mode === 'LIMIT' && t.side === 'SELL' && t.status === 'OPEN'
  );
  const escrowedLimitSellValue = escrowedLimitSellOrders.reduce((acc, t) => {
    const livePrice = priceBySymbol.get(t.symbol) ?? t.entry_price;
    return acc + Number(t.quantity || 0) * livePrice;
  }, 0);
  const escrowedLimitSellPnl = escrowedLimitSellOrders.reduce((acc, t) => {
    const livePrice = priceBySymbol.get(t.symbol) ?? t.entry_price;
    return acc + Number(t.quantity || 0) * (livePrice - Number(t.entry_price || 0));
  }, 0);

  const openPositions = trades.filter((t) => t.order_mode === 'POSITION' && t.status === 'OPEN');
  const openPositionCollateral = openPositions.reduce((acc, t) => acc + Number(t.amount_usd || 0), 0);
  const openPositionsPnl = openPositions.reduce((acc, t) => acc + computePositionPnl(t), 0);

  const nowDate = new Date();
  const startOfTodayMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const getSettledTradePnl = (t: SpotTrade): number | null => {
    if (t.status !== 'SETTLED') return null;
    if (t.order_mode === 'POSITION') {
      return t.is_liquidated === 1 ? -Number(t.amount_usd || 0) : Number(t.pnl_usd || 0);
    }
    if ((t.order_mode === 'SPOT' || t.order_mode === 'LIMIT') && t.side === 'SELL') {
      return Number(t.pnl_usd || 0);
    }
    return null;
  };

  const realizedTodayPnl = trades.reduce((acc, t) => {
    const pnl = getSettledTradePnl(t);
    if (pnl === null) return acc;
    const settledTs = Date.parse(t.settled_at || t.created_at);
    return Number.isFinite(settledTs) && settledTs >= startOfTodayMs ? acc + pnl : acc;
  }, 0);

  const rawUnrealizedPnl = holdingsUnrealizedPnl + escrowedLimitSellPnl + openPositionsPnl;
  const roundedUnrealized = Number(rawUnrealizedPnl.toFixed(2));
  const roundedRealizedToday = Number(realizedTodayPnl.toFixed(2));
  const unrealizedPnl = Math.abs(roundedUnrealized) < 0.005 ? 0 : roundedUnrealized;
  const cleanRealizedTodayPnl = Math.abs(roundedRealizedToday) < 0.005 ? 0 : roundedRealizedToday;
  const rawTodayPnl = Number((unrealizedPnl + cleanRealizedTodayPnl).toFixed(2));
  const todayPnl = Math.abs(rawTodayPnl) < 0.005 ? 0 : rawTodayPnl;

  const activeStakedPrincipal = stakingPositions
    .filter((p) => p.status === 'ACTIVE')
    .reduce((acc, p) => acc + Number(p.principal_amount || 0), 0);

  const openPositionEquity = openPositionCollateral + openPositionsPnl;
  const totalOpenExposure = portfolioValue + escrowedLimitSellValue + openPositionEquity;
  const cashAndClaimable = user.main_balance + user.claimable_balance + Number(user.profit_balance || 0);
  const totalEquity =
    cashAndClaimable +
    user.locked_balance +
    activeStakedPrincipal +
    portfolioValue +
    escrowedLimitSellValue +
    openPositionEquity;
  const baseEquity = totalEquity - todayPnl;
  const todayPnlPct = baseEquity > 0 ? (todayPnl / baseEquity) * 100 : 0;

  const formatSignedUsd = (val: number) =>
    val >= 0 ? `+$${formatUsd(val)}` : `-$${formatUsd(Math.abs(val))}`;

  // Build accurate equity trajectory grounded in external cashflows, realized/unrealized trade PnL & staking accruals
  const chartSeries = useMemo(() => {
    const now = new Date();
    const createdMs = Date.parse(user.created_at || '');
    const createdDayKey = Number.isFinite(createdMs) ? toLocalDayKey(new Date(createdMs)) : '';
    const validEntries = ledger.filter((entry) => {
      const st = (entry.status || '').toUpperCase();
      const tx = (entry.tx_type || '').toUpperCase();
      if (st === 'REJECTED' || st === 'FAILED') return false;
      if (st === 'PENDING' && (tx === 'WITHDRAW_HOLD' || tx === 'P2P_ESCROW_LOCK')) return false;
      return EQUITY_IMPACTING_TX_TYPES.has(tx);
    });

    const equityEvents: { ts: number; delta: number }[] = [];
    for (const e of validEntries) {
      const ts = Date.parse(e.created_at);
      if (Number.isFinite(ts)) {
        equityEvents.push({ ts, delta: Number(e.amount || 0) });
      }
    }
    for (const t of trades) {
      const pnl = getSettledTradePnl(t);
      if (pnl === null) continue;
      const ts = Date.parse(t.settled_at || t.created_at);
      if (Number.isFinite(ts)) {
        equityEvents.push({ ts, delta: pnl });
      }
    }
    for (const log of stakingDailyLogs) {
      const ts = Date.parse(log.credited_at);
      const amt = Number(log.daily_amount || 0);
      if (Number.isFinite(ts) && amt !== 0) {
        equityEvents.push({ ts, delta: amt });
      }
    }
    for (const pos of stakingPositions) {
      if (pos.status === 'EMERGENCY_WITHDRAWN' && Number(pos.penalty_amount || 0) > 0) {
        const ts = Date.parse(pos.emergency_payout_at || pos.created_at);
        if (Number.isFinite(ts)) {
          equityEvents.push({ ts, delta: -Number(pos.penalty_amount || 0) });
        }
      }
    }

    if (chartRange === '24H') {
      const slots = 12;
      const twoHoursMs = 2 * 60 * 60 * 1000;
      const nowMs = now.getTime();
      const bucketStarts = Array.from({ length: slots }, (_, idx) => nowMs - (slots - 1 - idx) * twoHoursMs);

      const values = new Array<number>(slots);
      let running = Math.max(0, totalEquity);
      values[slots - 1] = Number(running.toFixed(2));

      for (let idx = slots - 1; idx >= 1; idx--) {
        const winEnd = bucketStarts[idx];
        const winStart = bucketStarts[idx - 1];
        let delta = 0;
        for (const ev of equityEvents) {
          if (ev.ts > winStart && ev.ts <= winEnd) {
            delta += ev.delta;
          }
        }
        if (idx === slots - 1) {
          delta += unrealizedPnl;
        }
        running = Math.max(0, running - delta);
        if (Number.isFinite(createdMs) && winStart < createdMs - twoHoursMs) {
          values[idx - 1] = 0;
        } else {
          values[idx - 1] = Number(running.toFixed(2));
        }
      }

      const points = bucketStarts.map((ts, idx) => ({
        key: String(ts),
        label:
          idx === slots - 1
            ? 'Now'
            : new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        value: values[idx],
      }));
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const startVal = values[0] ?? totalEquity;
      const endVal = values[values.length - 1] ?? totalEquity;
      const periodDelta = endVal - startVal;
      const periodPct = startVal > 0 ? (periodDelta / startVal) * 100 : endVal > 0 ? 100 : 0;

      return { points, minVal, maxVal, startVal, endVal, periodDelta, periodPct };
    }

    const totalDays = chartRange === '7D' ? 7 : 30;
    const dayKeys: string[] = [];
    const labels: string[] = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      dayKeys.push(toLocalDayKey(d));
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }

    const dailyNet = new Map<string, number>();
    for (const ev of equityEvents) {
      const k = toLocalDayKey(new Date(ev.ts));
      dailyNet.set(k, (dailyNet.get(k) || 0) + ev.delta);
    }

    const values = new Array<number>(dayKeys.length);
    let running = Math.max(0, totalEquity);
    for (let i = dayKeys.length - 1; i >= 0; i--) {
      const k = dayKeys[i];
      if (createdDayKey && k < createdDayKey) {
        values[i] = 0;
        continue;
      }
      values[i] = Number(running.toFixed(2));
      let netDelta = dailyNet.get(k) || 0;
      if (i === dayKeys.length - 1) {
        netDelta += unrealizedPnl;
      }
      running = Math.max(0, running - netDelta);
    }

    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const startVal = values[0] ?? totalEquity;
    const endVal = values[values.length - 1] ?? totalEquity;
    const periodDelta = endVal - startVal;
    const periodPct = startVal > 0 ? (periodDelta / startVal) * 100 : endVal > 0 ? 100 : 0;

    return {
      points: dayKeys.map((key, idx) => ({ key, label: labels[idx], value: values[idx] })),
      minVal,
      maxVal,
      startVal,
      endVal,
      periodDelta,
      periodPct,
    };
  }, [chartRange, ledger, trades, stakingPositions, stakingDailyLogs, totalEquity, unrealizedPnl, user.created_at]);

  const allocationItems = useMemo(() => {
    const stakingTotal = Math.max(0, activeStakedPrincipal + Number(user.profit_balance || 0));
    const items = [
      { key: 'main', label: 'Main USDT', amount: Math.max(0, user.main_balance), barClass: 'bg-blue-600', dotClass: 'bg-blue-600' },
      { key: 'spot', label: 'Spot Assets', amount: Math.max(0, portfolioValue + escrowedLimitSellValue), barClass: 'bg-amber-500', dotClass: 'bg-amber-500' },
      {
        key: 'profit',
        label: activeStakedPrincipal > 0 ? 'Staking & Profit' : 'Staking Profit',
        amount: stakingTotal,
        barClass: 'bg-emerald-500',
        dotClass: 'bg-emerald-500',
      },
      { key: 'other', label: 'Escrow & Claimable', amount: Math.max(0, user.locked_balance + user.claimable_balance + openPositionEquity), barClass: 'bg-slate-400', dotClass: 'bg-slate-400' },
    ];
    const sum = items.reduce((s, it) => s + it.amount, 0);
    return items.map((it) => ({
      ...it,
      pct: sum > 0 ? (it.amount / sum) * 100 : 0,
    }));
  }, [user.main_balance, user.profit_balance, user.locked_balance, user.claimable_balance, activeStakedPrincipal, portfolioValue, escrowedLimitSellValue, openPositionEquity]);

  const mobileSearchTerm = mobileSearch.trim().toLowerCase();
  const filteredMobileHoldings = holdings.filter(
    (h) => !mobileSearchTerm || h.asset.toLowerCase().includes(mobileSearchTerm)
  );
  const filteredMobileMarkets = markets.filter(
    (m) =>
      !mobileSearchTerm ||
      m.base_asset.toLowerCase().includes(mobileSearchTerm) ||
      m.symbol.toLowerCase().includes(mobileSearchTerm)
  );

  return (
    <>
      {/* MOBILE RESPONSIVE CRYPTO WALLET HOME (< 1024px) */}
      <div className="lg:hidden space-y-4">
        {/* Top Segmented Switcher: Portfolio | Markets */}
        <div className="flex items-center justify-center">
          <div className="inline-grid grid-cols-2 p-1 bg-slate-100 rounded-xl w-full max-w-[260px]">
            <button
              type="button"
              onClick={() => setMobileMode('PORTFOLIO')}
              className={`min-h-[36px] text-xs font-semibold rounded-lg transition-colors ${
                mobileMode === 'PORTFOLIO'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Portfolio
            </button>
            <button
              type="button"
              onClick={() => setMobileMode('MARKETS')}
              className={`min-h-[36px] text-xs font-semibold rounded-lg transition-colors ${
                mobileMode === 'MARKETS'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Markets
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={mobileSearch}
            onChange={(e) => setMobileSearch(e.target.value)}
            placeholder="Search coin, pair, or symbol..."
            className="w-full h-11 pl-10 pr-4 text-sm bg-slate-100/90 border border-slate-200/80 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-600"
          />
        </div>

        {/* Hero Dark Wallet Card (Center Screen Pattern) */}
        <section className="rounded-xl border border-slate-800 bg-[#0F172A] text-white p-5 space-y-5 ring-1 ring-emerald-500/10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 truncate">Main Wallet</span>
              <button
                type="button"
                onClick={() => setHideBalance((v) => !v)}
                aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
                className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleCopyId}
                title={`Copy UID: ${accountId}`}
                className="h-8 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 inline-flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-200 transition-colors"
              >
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>{copiedId ? 'Copied' : accountId}</span>
              </button>
              {!isVerified && (
                <button
                  type="button"
                  onClick={() => onNavigate('profile')}
                  className="h-8 px-2.5 rounded-lg bg-amber-500/15 border border-amber-400/30 text-[11px] font-semibold text-amber-300"
                >
                  Verify KYC
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[32px] font-bold tracking-tight font-mono-tabular leading-none text-emerald-400">
              {hideBalance ? '••••••' : `$${formatUsd(totalEquity)}`}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <span
                className={`inline-flex items-center gap-1 font-semibold font-mono-tabular ${
                  todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {todayPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>
                  {hideBalance
                    ? '••••'
                    : `${formatSignedUsd(todayPnl)} (${todayPnlPct >= 0 ? '+' : ''}${todayPnlPct.toFixed(2)}%)`}
                </span>
              </span>
              <span className="text-slate-400">Today&apos;s PnL</span>
              {!hideBalance && countryShortCode && countryShortCode !== 'USD' && (
                <span className="text-slate-400 font-mono-tabular">
                  · ≈ {formatFiatAmount(totalEquity * getCurrencyMeta(countryShortCode).referenceRatePerUsdt, countryShortCode)} {countryShortCode}
                </span>
              )}
            </div>
          </div>

          {/* 4 Circular Quick Action Buttons */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            {(
              [
                { label: 'Deposit', icon: ArrowDownLeft, tab: 'funding' },
                { label: 'Send', icon: ArrowUpRight, tab: 'funding' },
                { label: 'Trade', icon: ArrowLeftRight, tab: 'spot' },
                { label: 'P2P', icon: Users, tab: 'p2p' },
              ] as const
            ).map((act) => {
              const Icon = act.icon;
              return (
                <button
                  key={act.label}
                  type="button"
                  onClick={() => onNavigate(act.tab)}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <span className="w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 group-active:scale-95 transition-all flex items-center justify-center text-emerald-300 border border-slate-700">
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className="text-xs font-medium text-slate-200">{act.label}</span>
                </button>
              );
            })}
          </div>

          {/* Compact Balance Breakdown Footer Strip */}
          <div className="pt-3 border-t border-slate-800 grid grid-cols-3 gap-2 text-left">
            <button
              type="button"
              onClick={() => onNavigate('funding')}
              className="rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 px-2.5 py-2 transition-colors"
            >
              <div className="text-[10px] text-slate-400">Main USDT</div>
              <div className="text-xs font-bold font-mono-tabular text-white mt-0.5 truncate">
                {hideBalance ? '••••' : `$${formatUsd(user.main_balance)}`}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('staking')}
              className="rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 px-2.5 py-2 transition-colors"
            >
              <div className="text-[10px] text-slate-400">Staked &amp; Profit</div>
              <div className="text-xs font-bold font-mono-tabular text-emerald-400 mt-0.5 truncate">
                {hideBalance ? '••••' : `$${formatUsd(activeStakedPrincipal + Number(user.profit_balance || 0))}`}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('spot')}
              className="rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 px-2.5 py-2 transition-colors"
            >
              <div className="text-[10px] text-slate-400">Spot Value</div>
              <div className="text-xs font-bold font-mono-tabular text-white mt-0.5 truncate">
                {hideBalance ? '••••' : `$${formatUsd(portfolioValue + escrowedLimitSellValue)}`}
              </div>
            </button>
          </div>
        </section>

        {user.claimable_balance > 0 && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                ${formatUsd(user.claimable_balance)} Claimable Rewards
              </div>
              <div className="text-[11px] text-slate-600">Move funds into Main Balance anytime</div>
            </div>
            <button
              type="button"
              onClick={handleClaim}
              disabled={claiming}
              className="min-h-[38px] px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              {claiming ? 'Claiming...' : 'Claim'}
            </button>
          </div>
        )}

        {claimMessage && (
          <div className="border border-blue-200 bg-blue-50 text-blue-800 text-xs px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-2">
            <span>{claimMessage}</span>
            <button onClick={() => setClaimMessage(null)} className="text-blue-600 font-semibold shrink-0">
              Dismiss
            </button>
          </div>
        )}

        {mobileMode === 'PORTFOLIO' ? (
          <>
            {/* Crypto Holdings Section (Matches Center Screen List) */}
            <section className="space-y-2.5">
              <div className="flex items-center justify-between px-0.5">
                <h2 className="text-sm font-bold text-slate-900">
                  Crypto <span className="text-slate-400 font-normal">({filteredMobileHoldings.length})</span>
                </h2>
                <button
                  type="button"
                  onClick={() => setMobileMode('MARKETS')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                >
                  <span>All Markets</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                {filteredMobileHoldings.length === 0 ? (
                  <div className="p-5 text-center space-y-2.5">
                    <div className="text-xs text-slate-500">
                      {mobileSearchTerm
                        ? 'No matching coin holdings found.'
                        : 'No active coin holdings yet. Tap Trade to buy BTC, ETH, or SOL.'}
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('spot', 'BTC/USDT')}
                      className="min-h-[40px] px-4 rounded-xl bg-slate-900 text-white text-xs font-semibold"
                    >
                      Trade Spot Crypto
                    </button>
                  </div>
                ) : (
                  filteredMobileHoldings.map((h) => {
                    const market = markets.find((m) => m.base_asset === h.asset);
                    const mark = market ? market.current_price : h.avg_entry_price;
                    const changePct = market ? market.change_24h_pct : 0;
                    const costBasis = Number((h.quantity * h.avg_entry_price).toFixed(2));
                    const val = Number((h.quantity * mark).toFixed(2));
                    const pnlUsd = Number((val - costBasis).toFixed(2));
                    const sym = market ? market.symbol : `${h.asset}/USDT`;

                    return (
                      <button
                        key={`mob-h-${h.asset}`}
                        type="button"
                        onClick={() => onNavigate('spot', sym)}
                        className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors min-h-[64px]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <CryptoIcon symbol={h.asset} className="w-9 h-9" />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900">{h.asset}</div>
                            <div className="text-[11px] font-mono-tabular text-slate-500 flex items-center gap-1.5">
                              <span>${formatUsd(mark, getPriceDecimals(mark))}</span>
                              <span className={changePct >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                                {changePct >= 0 ? '+' : ''}
                                {changePct.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono-tabular shrink-0">
                          <div className="text-sm font-bold text-slate-900">
                            {hideBalance ? '••••' : h.quantity.toFixed(getQtyDecimals(mark))}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {hideBalance ? '••••' : (
                              <>
                                ${formatUsd(val)}{' '}
                                <span className={pnlUsd >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                  ({formatSignedUsd(pnlUsd)})
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* Quick Explore & Earn Tiles */}
            <section className="space-y-2.5">
              <h2 className="text-sm font-bold text-slate-900 px-0.5">Earn &amp; Ecosystem</h2>
              <div className="grid grid-cols-2 gap-2.5">
                {(
                  [
                    {
                      title: 'Staking Vaults',
                      sub: 'Up to 25% APR yield',
                      icon: Layers,
                      tone: 'text-emerald-600 bg-emerald-50',
                      tab: 'staking',
                    },
                    {
                      title: 'Coin Presale',
                      sub: 'Early token allocations',
                      icon: Sparkles,
                      tone: 'text-violet-600 bg-violet-50',
                      tab: 'presale',
                    },
                    {
                      title: 'Jackpot Draw',
                      sub: 'Quarterly prize pool',
                      icon: Trophy,
                      tone: 'text-amber-600 bg-amber-50',
                      tab: 'rewards',
                    },
                    {
                      title: 'Referrals',
                      sub: 'Earn USDT bonuses',
                      icon: Gift,
                      tone: 'text-blue-600 bg-blue-50',
                      tab: 'referrals',
                    },
                  ] as const
                ).map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.title}
                      type="button"
                      onClick={() => onNavigate(card.tab)}
                      className="rounded-2xl border border-slate-200 bg-white p-3.5 text-left hover:bg-slate-50 active:scale-[0.99] transition-all flex items-start gap-2.5"
                    >
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${card.tone}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">{card.title}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 leading-tight">{card.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          /* Live Markets Directory (Tapping any opens Coin Chart / Trade) */
          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-0.5">
              <h2 className="text-sm font-bold text-slate-900">
                Live Spot Markets <span className="text-slate-400 font-normal">({filteredMobileMarkets.length})</span>
              </h2>
              <span className="text-[11px] text-slate-400">Tap coin to trade</span>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
              {filteredMobileMarkets.map((m) => {
                const pDec = getPriceDecimals(m.current_price);
                return (
                  <button
                    key={`mob-mkt-${m.symbol}`}
                    type="button"
                    onClick={() => onNavigate('spot', m.symbol)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors min-h-[60px]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <CryptoIcon symbol={m.base_asset} className="w-9 h-9" />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900">
                          {m.base_asset}
                          <span className="text-xs font-normal text-slate-400">/USDT</span>
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">{m.name || m.symbol}</div>
                      </div>
                    </div>

                    <div className="text-right font-mono-tabular shrink-0">
                      <div className="text-sm font-bold text-slate-900">${formatUsd(m.current_price, pDec)}</div>
                      <div
                        className={`text-[11px] font-semibold ${
                          m.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {m.change_24h_pct >= 0 ? '+' : ''}
                        {m.change_24h_pct.toFixed(2)}%
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <TransactionHistoryTable ledger={ledger} title="Recent Activity" />
      </div>

      {/* DESKTOP OVERVIEW (100% PRESERVED >= 1024px) */}
      <div className="hidden lg:block space-y-6">
      {claimMessage && (
        <div className="border border-blue-200 bg-blue-50 text-blue-800 text-xs px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{claimMessage}</span>
          <button onClick={() => setClaimMessage(null)} className="text-blue-600 font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Portfolio Equity Hero — Staking Vaults slate + emerald palette */}
      <section className="rounded-xl border border-slate-800 bg-[#0F172A] text-white overflow-hidden ring-1 ring-emerald-500/10">
        {/* Top Row: Compact Hero Equity + PnL Metrics */}
        <div className="px-5 py-4 lg:px-6 lg:py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Overview</h1>
              <div className="mt-0.5 text-[10px] text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span>
                  Account ID:{' '}
                  <span className="font-mono-tabular font-medium text-slate-200">{accountId}</span>
                </span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  aria-label="Copy Account ID"
                  title="Copy Account ID"
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  {copiedId ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <span aria-hidden="true">·</span>
                <span>{user.email}</span>
                {countryShortCode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      title={user.country}
                      className="font-mono-tabular font-medium text-slate-200"
                    >
                      {countryShortCode}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                {isVerified ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-400 whitespace-nowrap">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>Verified</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate('profile')}
                    title="Complete account verification in Profile & KYC"
                    className="inline-flex items-center gap-1 font-medium text-amber-300 hover:text-amber-200 hover:underline transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Unverified</span>
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Estimated Total Equity</span>
              </div>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-2xl lg:text-3xl font-bold tracking-tight font-mono-tabular text-white">
                ${formatUsd(totalEquity)}
              </span>
              {countryShortCode && countryShortCode !== 'USD' && (
                <span className="text-xs font-mono-tabular text-slate-400">
                  ≈ {formatFiatAmount(totalEquity * getCurrencyMeta(countryShortCode).referenceRatePerUsdt, countryShortCode)} {countryShortCode}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-slate-400">Today&apos;s PnL</span>
              <span
                className={`inline-flex items-center gap-1 font-semibold font-mono-tabular ${
                  todayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {todayPnl >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                <span>
                  {formatSignedUsd(todayPnl)} ({todayPnlPct >= 0 ? '+' : ''}
                  {todayPnlPct.toFixed(2)}%)
                </span>
              </span>
            </div>
          </div>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-4 lg:border-l lg:border-slate-800 lg:pl-5">
            <div>
              <div className="text-[10px] font-medium text-slate-400">Unrealized PnL</div>
              <div
                className={`mt-0.5 text-xs font-semibold font-mono-tabular ${
                  unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatSignedUsd(unrealizedPnl)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-400">Realized Today</div>
              <div
                className={`mt-0.5 text-xs font-semibold font-mono-tabular ${
                  cleanRealizedTodayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {formatSignedUsd(cleanRealizedTodayPnl)}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-400">Open Positions</div>
              <div className="mt-0.5 text-xs font-semibold font-mono-tabular text-white">
                ${formatUsd(totalOpenExposure)}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row: Compact 5-Column Account Balances */}
        <div className="border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
          <div className="px-5 py-4 space-y-1 transition-colors hover:bg-slate-800/30">
            <div className="flex items-center gap-2 min-h-[26px] text-xs font-medium text-slate-400">
              <CryptoIcon symbol="USDT" className="w-5 h-5" />
              <span>Main Balance</span>
            </div>
            <div className="text-base font-bold font-mono-tabular text-white">
              ${formatUsd(user.main_balance)}
            </div>
            <div className="text-[10px] text-slate-400">Available for Spot, P2P &amp; Withdrawals</div>
          </div>

          <div className="px-5 py-4 space-y-1 bg-slate-800/20 transition-colors hover:bg-slate-800/40">
            <div className="flex items-center justify-between gap-2 min-h-[26px] text-xs">
              <span className="font-medium text-slate-400">
                {activeStakedPrincipal > 0 ? 'Staking & Profit' : 'Profit Balance'}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('staking')}
                className="text-emerald-400 hover:text-emerald-300 hover:underline font-medium whitespace-nowrap"
              >
                Vaults →
              </button>
            </div>
            <div className="text-base font-bold font-mono-tabular text-emerald-400">
              ${formatUsd(activeStakedPrincipal + Number(user.profit_balance || 0))}
            </div>
            <div className="text-[10px] text-slate-400">
              {activeStakedPrincipal > 0
                ? `$${formatUsd(activeStakedPrincipal)} staked · +$${formatUsd(user.profit_balance || 0)} profit`
                : 'Daily staking profit · Monthly unlock'}
            </div>
          </div>

          <div className="px-5 py-4 space-y-1 transition-colors hover:bg-slate-800/30">
            <div className="flex items-center justify-between gap-2 min-h-[26px] text-xs">
              <span className="font-medium text-slate-400">Claimable Wallet</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-base font-bold font-mono-tabular text-white">
                ${formatUsd(user.claimable_balance)}
              </div>
              <button
                onClick={handleClaim}
                disabled={claiming || user.claimable_balance <= 0}
                className="h-7 px-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-slate-950 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <ArrowDownToLine className="w-3 h-3" />
                <span>{claiming ? 'Claiming...' : 'Claim'}</span>
              </button>
            </div>
            <div className="text-[10px] text-slate-400">Transfer rewards to Main Balance</div>
          </div>

          <div className="px-5 py-4 space-y-1 transition-colors hover:bg-slate-800/30">
            <div className="flex items-center min-h-[26px] text-xs font-medium text-slate-400">Escrow &amp; Withdrawal Hold</div>
            <div className="text-base font-bold font-mono-tabular text-white">
              ${formatUsd(user.locked_balance)}
            </div>
            <div className="text-[10px] text-slate-400">Locked in pending withdrawals or P2P</div>
          </div>

          <div className="px-5 py-4 space-y-1 transition-colors hover:bg-slate-800/30">
            <div className="flex items-center min-h-[26px] text-xs font-medium text-slate-400">Spot Coin Holdings</div>
            <div className="text-base font-bold font-mono-tabular text-white">
              ${formatUsd(portfolioValue + escrowedLimitSellValue)}
            </div>
            <div className="text-[10px] text-slate-400">
              {holdings.length} active asset{holdings.length === 1 ? '' : 's'} marked to live feed
            </div>
          </div>
        </div>
      </section>

      {/* Compact Side-by-Side Analytics: Portfolio Equity Trend (Left) + Asset Allocation & Holdings (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left: Compact Full-Bleed Portfolio Equity Trend */}
        <section className="lg:col-span-7 border border-slate-200 rounded-xl bg-white p-4 sm:p-5 flex flex-col justify-between gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Portfolio Equity Trend</h2>
                <span
                  className={`text-xs font-semibold font-mono-tabular ${
                    chartSeries.periodDelta >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {formatSignedUsd(chartSeries.periodDelta)} ({chartSeries.periodDelta >= 0 ? '+' : ''}
                  {chartSeries.periodPct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono-tabular text-slate-500 mt-1">
                <span>
                  High <strong className="text-slate-800">${formatUsd(chartSeries.maxVal)}</strong>
                </span>
                <span>
                  Low <strong className="text-slate-800">${formatUsd(chartSeries.minVal)}</strong>
                </span>
                <span>
                  Now <strong className="text-slate-900">${formatUsd(chartSeries.endVal)}</strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg shrink-0">
              {(['24H', '7D', '30D'] as const).map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => {
                    setChartRange(range);
                    setHoverPointIdx(null);
                  }}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                    chartRange === range
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const w = Math.max(280, chartWidth);
            const h = 136;
            const yAxisPad = 48;
            const padLeft = 4;
            const padRight = w - yAxisPad;
            const padTop = 10;
            const padBottom = 14;
            const pts = chartSeries.points;
            const rawSpan = chartSeries.maxVal - chartSeries.minVal;
            const span = rawSpan > 0.01 ? rawSpan : Math.max(10, chartSeries.maxVal * 0.1 || 10);
            const yLow = Math.max(0, chartSeries.minVal - span * 0.08);
            const yHigh = chartSeries.maxVal + span * 0.1;
            const yMid = (yLow + yHigh) / 2;
            const strokeColor = chartSeries.periodDelta >= 0 ? '#2563EB' : '#DC2626';

            const coords = pts.map((p, idx) => {
              const x =
                pts.length <= 1
                  ? (padLeft + padRight) / 2
                  : padLeft + (idx / (pts.length - 1)) * (padRight - padLeft);
              const y =
                padTop +
                (1 - (p.value - yLow) / Math.max(1e-6, yHigh - yLow)) * (h - padTop - padBottom);
              return { ...p, x, y };
            });

            const linePath = coords
              .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
              .join(' ');
            const areaPath =
              coords.length > 0
                ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(h - padBottom).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(h - padBottom).toFixed(1)} Z`
                : '';

            const hoveredPt = hoverPointIdx !== null && coords[hoverPointIdx] ? coords[hoverPointIdx] : null;
            const activePt = hoveredPt || coords[coords.length - 1];
            const yTicks = [
              { val: yHigh, y: padTop },
              { val: yMid, y: padTop + (h - padTop - padBottom) / 2 },
              { val: yLow, y: h - padBottom },
            ];
            const formatCompactUsd = (v: number) =>
              v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;

            return (
              <div className="space-y-1.5">
                <div ref={chartWrapRef} className="relative w-full select-none">
                  {hoveredPt && (
                    <div
                      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-mono-tabular text-white shadow-sm whitespace-nowrap"
                      style={{
                        left: `${Math.min(Math.max((hoveredPt.x / w) * 100, 14), 80)}%`,
                      }}
                    >
                      <span className="text-slate-300 mr-1.5">{hoveredPt.label}</span>
                      <span className="font-semibold">${formatUsd(hoveredPt.value)}</span>
                    </div>
                  )}
                  <svg
                    viewBox={`0 0 ${w} ${h}`}
                    width={w}
                    height={h}
                    className="w-full h-[136px] block overflow-visible"
                    onMouseLeave={() => setHoverPointIdx(null)}
                  >
                    <defs>
                      <linearGradient id="overview-equity-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={strokeColor} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {yTicks.map((tk, i) => (
                      <g key={i}>
                        <line
                          x1={padLeft}
                          y1={tk.y}
                          x2={padRight}
                          y2={tk.y}
                          stroke={i === yTicks.length - 1 ? '#E2E8F0' : '#F1F5F9'}
                          strokeDasharray={i === yTicks.length - 1 ? undefined : '3 3'}
                          strokeWidth="1"
                        />
                        <text
                          x={w}
                          y={tk.y + 3}
                          textAnchor="end"
                          className="fill-slate-400 text-[10px] font-mono-tabular"
                        >
                          {formatCompactUsd(tk.val)}
                        </text>
                      </g>
                    ))}

                    {hoveredPt && (
                      <line
                        x1={hoveredPt.x}
                        y1={padTop}
                        x2={hoveredPt.x}
                        y2={h - padBottom}
                        stroke="#94A3B8"
                        strokeDasharray="2 2"
                        strokeWidth="1"
                      />
                    )}

                    {areaPath && <path d={areaPath} fill="url(#overview-equity-grad)" />}
                    {linePath && (
                      <path
                        d={linePath}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {activePt && (
                      <circle
                        cx={activePt.x}
                        cy={activePt.y}
                        r="4"
                        fill={strokeColor}
                        stroke="#FFFFFF"
                        strokeWidth="2"
                      />
                    )}

                    {coords.map((c, idx) => (
                      <rect
                        key={c.key}
                        x={c.x - (padRight - padLeft) / Math.max(2, coords.length * 2)}
                        y={0}
                        width={(padRight - padLeft) / Math.max(1, coords.length)}
                        height={h}
                        fill="transparent"
                        className="cursor-crosshair"
                        onMouseEnter={() => setHoverPointIdx(idx)}
                      />
                    ))}
                  </svg>
                </div>

                <div
                  className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-400"
                  style={{ paddingRight: '48px' }}
                >
                  <span>{pts[0]?.label}</span>
                  <span>{pts[Math.floor(pts.length / 2)]?.label}</span>
                  <span>{pts[pts.length - 1]?.label}</span>
                </div>
              </div>
            );
          })()}
        </section>

        {/* Right: Compact Asset Allocation & Spot Holdings */}
        <section className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-4 sm:p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Portfolio Mix &amp; Holdings</h2>
              <button
                type="button"
                onClick={() => onNavigate('spot')}
                className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
              >
                Trade Spot →
              </button>
            </div>

            {/* Segmented Allocation Bar */}
            <div className="space-y-2">
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
                {allocationItems.map((it) =>
                  it.pct > 0.5 ? (
                    <div
                      key={it.key}
                      className={`${it.barClass} h-full transition-all duration-300`}
                      style={{ width: `${it.pct}%` }}
                    />
                  ) : null
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                {allocationItems.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-1.5">
                    <span className="flex items-center gap-1.5 text-slate-600 truncate">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${it.dotClass}`} />
                      <span className="truncate">{it.label}</span>
                    </span>
                    <span className="font-mono-tabular font-medium text-slate-800 shrink-0">
                      {it.pct.toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Compact Spot & Presale Asset List */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span>Spot &amp; Presale Assets ({holdings.length})</span>
              <span>Live Mark / Value</span>
            </div>

            {holdings.length === 0 ? (
              <div className="py-5 text-center text-xs text-slate-500 bg-slate-50/60 rounded-lg border border-slate-100">
                No active coin holdings yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-[155px] overflow-y-auto pr-0.5">
                {holdings.map((h) => {
                  const mark = priceByAsset.get(h.asset) ?? h.avg_entry_price;
                  const costBasis = Number((h.quantity * h.avg_entry_price).toFixed(2));
                  const val = Number((h.quantity * mark).toFixed(2));
                  const pnlUsd = Number((val - costBasis).toFixed(2));
                  const pnlPct = costBasis > 0 ? (pnlUsd / costBasis) * 100 : 0;
                  return (
                    <div key={h.asset} className="py-2 first:pt-1 last:pb-0 flex items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <CryptoIcon symbol={h.asset} size="sm" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{h.asset}</span>
                            <span className="font-mono-tabular font-normal text-slate-500">
                              {h.quantity.toFixed(getQtyDecimals(mark))}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono-tabular text-slate-400 truncate">
                            Entry ${formatUsd(h.avg_entry_price, getPriceDecimals(h.avg_entry_price))} · Mark $
                            {formatUsd(mark, getPriceDecimals(mark))}
                          </div>
                        </div>
                      </div>
                      <div className="text-right font-mono-tabular shrink-0">
                        <div className="font-semibold text-slate-900">${formatUsd(val)}</div>
                        <div className={`text-[11px] font-medium ${pnlUsd >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {formatSignedUsd(pnlUsd)} ({pnlPct >= 0 ? '+' : ''}
                          {pnlPct.toFixed(2)}%)
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

        <TransactionHistoryTable ledger={ledger} />
      </div>
    </>
  );
};
