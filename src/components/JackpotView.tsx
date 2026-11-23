import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Ticket,
  Trophy,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type { JackpotOverviewData, UserProfile } from '../types';

interface JackpotViewProps {
  user: UserProfile;
  onRefreshUser: () => Promise<void>;
}

interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function getCountdownParts(targetIso?: string | null): CountdownParts {
  if (!targetIso) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: false };
  }
  const diffMs = Math.max(0, Date.parse(targetIso) - Date.now());
  if (diffMs <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds, expired: false };
}

function getCycleElapsedPct(createdAt?: string | null, drawAt?: string | null): number {
  if (!createdAt || !drawAt) return 0;
  const start = Date.parse(createdAt);
  const end = Date.parse(drawAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const pct = ((Date.now() - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, Number(pct.toFixed(1))));
}

function shortenHash(hash?: string | null): string {
  if (!hash) return '—';
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

export const JackpotView: React.FC<JackpotViewProps> = ({ user, onRefreshUser }) => {
  const [jackpot, setJackpot] = useState<JackpotOverviewData | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ticketCount, setTicketCount] = useState('5');
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [stageTab, setStageTab] = useState<'MY_TICKETS' | 'LIVE_FEED' | 'LEADERBOARD' | 'WINNERS' | 'RULES'>(
    'MY_TICKETS'
  );
  const [myTicketFilter, setMyTicketFilter] = useState<'ALL' | 'ACTIVE' | 'WON' | 'LOST'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const expirySyncTriggeredRef = useRef<string | null>(null);
  const ticketInputRef = useRef<HTMLInputElement | null>(null);

  const [countdown, setCountdown] = useState<CountdownParts>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired: false,
  });

  const loadAll = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const jpRes = await apiFetch<JackpotOverviewData>('/api/jackpot/overview');
      setJackpot(jpRes);
      setCountdown(getCountdownParts(jpRes.activeDraw?.draw_at));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Unable to load quarterly jackpot pool data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const target = jackpot?.activeDraw?.draw_at;
    if (!target) return;
    setCountdown(getCountdownParts(target));
    const timer = setInterval(() => {
      setCountdown(getCountdownParts(target));
    }, 1000);
    return () => clearInterval(timer);
  }, [jackpot?.activeDraw?.draw_at]);

  // Auto-sync round settlement once countdown reaches 00:00:00:00
  useEffect(() => {
    const drawId = jackpot?.activeDraw?.id;
    if (!drawId || !countdown.expired) return;
    if (expirySyncTriggeredRef.current === drawId) return;
    expirySyncTriggeredRef.current = drawId;
    const t = setTimeout(() => {
      Promise.all([loadAll(), onRefreshUser()]).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [countdown.expired, jackpot?.activeDraw?.id, loadAll, onRefreshUser]);

  const activeDraw = jackpot?.activeDraw ?? null;
  const ticketPrice = Math.max(0.01, Number(activeDraw?.ticket_price ?? 1));
  const availableMainBalance = Math.max(0, Number(user.main_balance || 0));
  const maxAffordableTickets = Math.min(100, Math.floor(availableMainBalance / ticketPrice));

  const parsedCount = Math.max(0, Math.min(100, Math.floor(Number(ticketCount) || 0)));
  const totalCost = Number((parsedCount * ticketPrice).toFixed(2));
  const poolContribution = Number((totalCost * 0.8).toFixed(2));
  const treasuryFee = Number((totalCost * 0.2).toFixed(2));

  const myActiveTicketCount = jackpot?.myActiveTicketCount ?? 0;
  const totalActiveTickets = jackpot?.totalActiveTickets ?? 0;
  const myTicketsAfter = myActiveTicketCount + parsedCount;
  const totalTicketsAfter = totalActiveTickets + parsedCount;

  const currentOddsPct = jackpot?.myWinChancePct ?? 0;
  const projectedOddsPct =
    totalTicketsAfter > 0 ? Number(((myTicketsAfter / totalTicketsAfter) * 100).toFixed(2)) : 0;
  const oddsDeltaPct = Number(Math.max(0, projectedOddsPct - currentOddsPct).toFixed(2));

  const totalPool = Number(activeDraw?.prize_pool ?? 0);
  const ticketContributionUsd = Number(
    jackpot?.ticketContributionUsd ?? Number(((activeDraw?.ticket_revenue_usd ?? 0) * 0.8).toFixed(2))
  );
  const basePoolUsd = Number(jackpot?.basePoolUsd ?? Math.max(0, totalPool - ticketContributionUsd));
  const seedSharePct = totalPool > 0 ? Math.min(100, Math.max(0, (basePoolUsd / totalPool) * 100)) : 100;
  const boostSharePct =
    totalPool > 0 ? Math.max(0, Math.min(100 - seedSharePct, (ticketContributionUsd / totalPool) * 100)) : 0;
  const cycleElapsedPct = getCycleElapsedPct(activeDraw?.created_at, activeDraw?.draw_at);

  const normalizedQuery = searchQuery.trim().toLowerCase().replace(/^#/, '');

  const filteredMyTickets = useMemo(() => {
    const rows = jackpot?.myTickets || [];
    return rows.filter((t) => {
      if (myTicketFilter !== 'ALL' && t.status !== myTicketFilter) return false;
      if (!normalizedQuery) return true;
      const matchId = t.id.toLowerCase().includes(normalizedQuery);
      const matchQuarter = (t.quarter_label || '').toLowerCase().includes(normalizedQuery);
      const matchNumbers = (t.ticket_numbers || []).some((n) => n.toLowerCase().includes(normalizedQuery));
      return matchId || matchQuarter || matchNumbers;
    });
  }, [jackpot?.myTickets, myTicketFilter, normalizedQuery]);

  const filteredRecentParticipants = useMemo(() => {
    const rows = jackpot?.recentParticipants || [];
    if (!normalizedQuery) return rows;
    return rows.filter((p) => {
      const matchName = p.user_name.toLowerCase().includes(normalizedQuery);
      const matchUid = (p.uid || '').toLowerCase().includes(normalizedQuery);
      const matchNumbers = (p.ticket_numbers || []).some((n) => n.toLowerCase().includes(normalizedQuery));
      return matchName || matchUid || matchNumbers;
    });
  }, [jackpot?.recentParticipants, normalizedQuery]);

  const filteredLeaderboard = useMemo(() => {
    const rows = jackpot?.leaderboard || [];
    if (!normalizedQuery) return rows;
    return rows.filter(
      (entry) =>
        entry.user_name.toLowerCase().includes(normalizedQuery) ||
        entry.uid.toLowerCase().includes(normalizedQuery)
    );
  }, [jackpot?.leaderboard, normalizedQuery]);

  const filteredWinners = useMemo(() => {
    const rows = jackpot?.history || [];
    if (!normalizedQuery) return rows;
    return rows.filter(
      (d) =>
        d.quarter_label.toLowerCase().includes(normalizedQuery) ||
        (d.title || '').toLowerCase().includes(normalizedQuery) ||
        (d.winner_name || '').toLowerCase().includes(normalizedQuery) ||
        (d.winning_ticket_number || '').toLowerCase().includes(normalizedQuery)
    );
  }, [jackpot?.history, normalizedQuery]);

  const handleStepQuantity = (delta: number) => {
    const next = Math.max(1, Math.min(100, (parsedCount || 1) + delta));
    setTicketCount(String(next));
  };

  const handleCopyText = async (key: string, value?: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      // ignore clipboard permission error
    }
  };

  const handleBuyTickets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDraw || parsedCount < 1 || submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await apiFetch<{ generated_numbers?: string[] }>('/api/jackpot/buy', {
        method: 'POST',
        body: JSON.stringify({ ticket_count: parsedCount }),
      });
      await Promise.all([loadAll(), onRefreshUser()]);
      const numsText =
        res.generated_numbers && res.generated_numbers.length > 0
          ? ` Assigned Numbers: ${res.generated_numbers.map((n) => `#${n}`).join(', ')}.`
          : '';
      setStageTab('MY_TICKETS');
      setBanner({
        type: 'success',
        text: `Confirmed ${parsedCount} Jackpot ticket${parsedCount === 1 ? '' : 's'} for ${activeDraw.quarter_label}.${numsText} +$${formatUsd(poolContribution)} added directly to the prize pool.`,
      });
    } catch (err: any) {
      setBanner({
        type: 'error',
        text: err.message || 'Unable to complete ticket purchase.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const focusMintDesk = (suggestedQty = 5) => {
    setTicketCount(String(suggestedQty));
    ticketInputRef.current?.focus();
    ticketInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // SVG Donut math for Pool Capital Breakdown (Seed vs Ticket Boost 80%)
  const donutRadius = 34;
  const donutCirc = 2 * Math.PI * donutRadius;
  const seedDash = (seedSharePct / 100) * donutCirc;
  const boostDash = (boostSharePct / 100) * donutCirc;

  if (loading && !jackpot) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-12 border-b border-slate-200 flex items-center justify-between">
          <div className="h-5 w-56 bg-slate-200 rounded" />
          <div className="h-8 w-28 bg-slate-100 rounded-lg" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 space-y-6">
            <div className="h-72 border border-slate-200 rounded-xl bg-white" />
            <div className="h-80 border border-slate-200 rounded-xl bg-white" />
          </div>
          <div className="xl:col-span-4 h-[520px] border border-slate-200 rounded-xl bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Slim Top Terminal Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 text-balance">
            Quarterly Grand Jackpot
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{activeDraw?.quarter_label || 'Quarterly Round'}</span>
            <span aria-hidden="true">·</span>
            <span>90-Day CSPRNG Prize Pool</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">
              Settlement: {activeDraw ? formatDateTime(activeDraw.draw_at) : 'TBA'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 font-mono-tabular">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            {cycleElapsedPct.toFixed(1)}% elapsed
          </span>
          <button
            type="button"
            onClick={() => loadAll(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </header>

      {/* Error Recovery Surface */}
      {loadError && (
        <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </span>
          <button
            type="button"
            onClick={() => loadAll(true)}
            className="px-3 py-1 rounded-md bg-white border border-red-200 text-red-700 font-semibold hover:bg-red-100/50 transition-colors shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Action Confirmation / Error Banner */}
      {banner && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            banner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2 leading-relaxed">
            {banner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{banner.text}</span>
          </span>
          <button type="button" onClick={() => setBanner(null)} className="font-semibold hover:underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* Rotated Terminal Layout: 8-Col Main Stage (Vault + KPIs + Tabbed Ledger) | 4-Col Sticky Order Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* LEFT 8 COLUMNS: MAIN STAGE */}
        <div className="xl:col-span-8 space-y-6 min-w-0">
          {/* Vault Overview Card (Architectural Light Surface + Pool Donut Gauge + Countdown Matrix + 4 KPIs) */}
          <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {/* Left 7/12: Prize Pool Hero & Donut Capital Breakdown */}
              <div className="md:col-span-7 p-6 flex flex-col justify-between gap-5">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Trophy className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span className="font-semibold text-slate-800">{activeDraw?.title || 'Quarterly Grand Jackpot'}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{jackpot?.uniqueParticipantsCount ?? 0} participants</span>
                  </div>
                  <div className="mt-2.5 flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-bold font-mono-tabular tracking-tight text-slate-900">
                      ${formatUsd(totalPool)}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">USDT Prize Pool</span>
                  </div>
                </div>

                {/* SVG Radial Donut Gauge + Capital Split */}
                <div className="flex items-center gap-5 pt-4 border-t border-slate-100">
                  <div className="relative w-[88px] h-[88px] shrink-0">
                    <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
                      <circle cx="44" cy="44" r={donutRadius} fill="none" stroke="#F1F5F9" strokeWidth="9" />
                      {seedSharePct > 0 && (
                        <circle
                          cx="44"
                          cy="44"
                          r={donutRadius}
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth="9"
                          strokeDasharray={`${seedDash} ${donutCirc}`}
                          strokeDashoffset="0"
                        />
                      )}
                      {boostSharePct > 0 && (
                        <circle
                          cx="44"
                          cy="44"
                          r={donutRadius}
                          fill="none"
                          stroke="#047857"
                          strokeWidth="9"
                          strokeDasharray={`${boostDash} ${donutCirc}`}
                          strokeDashoffset={-seedDash}
                        />
                      )}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                      <span className="text-[11px] font-bold font-mono-tabular text-slate-900">
                        {boostSharePct.toFixed(0)}%
                      </span>
                      <span className="text-[9px] font-medium text-slate-400">Boost</span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Guaranteed Base Seed ({seedSharePct.toFixed(1)}%)</span>
                      <span className="font-mono-tabular font-bold text-blue-600">${formatUsd(basePoolUsd)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">Ticket Sales Boost 80% ({boostSharePct.toFixed(1)}%)</span>
                      <span className="font-mono-tabular font-bold text-[#047857]">
                        +${formatUsd(ticketContributionUsd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                      <span>Total Tickets Minted</span>
                      <span className="font-mono-tabular font-semibold text-slate-800">
                        {totalActiveTickets} {totalActiveTickets === 1 ? 'ticket' : 'tickets'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right 5/12: 2x2 Settlement Clock Matrix */}
              <div className="md:col-span-5 p-6 bg-slate-50/40 flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-600" />
                    {countdown.expired ? 'Round Settling' : 'Draw Countdown'}
                  </span>
                  <span className="font-mono-tabular text-slate-500">{cycleElapsedPct.toFixed(1)}%</span>
                </div>

                <div className="grid grid-cols-2 border border-slate-200 rounded-lg bg-white divide-x divide-y divide-slate-200 overflow-hidden">
                  {[
                    { label: 'Days', value: countdown.days },
                    { label: 'Hours', value: countdown.hours },
                    { label: 'Minutes', value: countdown.minutes },
                    { label: 'Seconds', value: countdown.seconds },
                  ].map((unit) => (
                    <div key={unit.label} className="py-2.5 px-3 text-center">
                      <div className="text-xl font-bold font-mono-tabular text-slate-900">
                        {String(unit.value).padStart(2, '0')}
                      </div>
                      <div className="text-[10px] font-medium text-slate-500">{unit.label}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-500"
                      style={{ width: `${cycleElapsedPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Auto Payout</span>
                    <span className="font-semibold text-[#047857]">Claimable Wallet</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom 4-Column Hairline KPI Footer */}
            <div className="border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/30">
              <div className="p-4">
                <div className="text-[11px] font-medium text-slate-500">My Active Tickets</div>
                <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900">{myActiveTicketCount}</div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  {myActiveTicketCount > 0 ? `$${formatUsd(myActiveTicketCount * ticketPrice)} committed` : 'No active tickets'}
                </div>
              </div>
              <div className="p-4">
                <div className="text-[11px] font-medium text-slate-500">Win Probability</div>
                <div className="mt-1 text-lg font-bold font-mono-tabular text-blue-600">
                  {currentOddsPct.toFixed(2)}%
                </div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  {myActiveTicketCount} / {totalActiveTickets} tickets
                </div>
              </div>
              <div className="p-4">
                <div className="text-[11px] font-medium text-slate-500">Round Tickets Sold</div>
                <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900">{totalActiveTickets}</div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  {jackpot?.uniqueParticipantsCount ?? 0} participant{(jackpot?.uniqueParticipantsCount ?? 0) === 1 ? '' : 's'}
                </div>
              </div>
              <div className="p-4">
                <div className="text-[11px] font-medium text-slate-500">All-Time Awarded</div>
                <div className="mt-1 text-lg font-bold font-mono-tabular text-[#047857]">
                  ${formatUsd(jackpot?.totalPrizesWonAllTime ?? 0)}
                </div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  {jackpot?.history.length ?? 0} settled rounds
                </div>
              </div>
            </div>
          </section>

          {/* Main Stage Tabbed Workbench */}
          <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            {/* Row 1: Full-Width Tab Navigation Bar (Zero Clipping / Zero Scrollbar) */}
            <div className="px-5 pt-3 border-b border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              {(
                [
                  ['MY_TICKETS', `My Tickets (${jackpot?.myTickets.length ?? 0})`],
                  ['LIVE_FEED', `Live Feed (${jackpot?.recentParticipants.length ?? 0})`],
                  ['LEADERBOARD', `Leaderboard (${jackpot?.leaderboard?.length ?? 0})`],
                  ['WINNERS', `Past Winners (${jackpot?.history.length ?? 0})`],
                  ['RULES', 'Rules & Math'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStageTab(key)}
                  className={`pb-3 border-b-2 font-medium transition-colors whitespace-nowrap shrink-0 ${
                    stageTab === key
                      ? 'border-blue-600 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Row 2: Dedicated Filter & Search Utility Sub-Bar */}
            {stageTab !== 'RULES' && (
              <div className="px-5 py-2.5 bg-slate-50/50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                {stageTab === 'MY_TICKETS' ? (
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                    {(['ALL', 'ACTIVE', 'WON', 'LOST'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setMyTicketFilter(st)}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                          myTicketFilter === st
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st === 'ALL' ? 'All' : st === 'LOST' ? 'Closed' : st.charAt(0) + st.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs font-medium text-slate-500">
                    {stageTab === 'LIVE_FEED'
                      ? `Showing ${filteredRecentParticipants.length} active round entries`
                      : stageTab === 'LEADERBOARD'
                      ? `Showing ${filteredLeaderboard.length} ranked participants`
                      : `Showing ${filteredWinners.length} settled quarterly draws`}
                  </span>
                )}

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      stageTab === 'MY_TICKETS'
                        ? 'Search ticket ID or #number...'
                        : stageTab === 'LIVE_FEED'
                        ? 'Search participant, UID, or #number...'
                        : stageTab === 'LEADERBOARD'
                        ? 'Search participant or UID...'
                        : 'Search quarter, winner, or #number...'
                    }
                    className="w-full h-8 pl-8 pr-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            )}

            {/* TAB: MY TICKETS */}
            {stageTab === 'MY_TICKETS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                      <th className="py-2.5 px-5">Ticket ID · Assigned Numbers</th>
                      <th className="py-2.5 px-4 text-right">Qty</th>
                      <th className="py-2.5 px-4 text-right">Cost</th>
                      <th className="py-2.5 px-5 text-right">Status / Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredMyTickets.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 px-5 text-center">
                          <div className="text-slate-500">
                            {normalizedQuery || myTicketFilter !== 'ALL'
                              ? 'No jackpot tickets match your current filter.'
                              : 'You have not minted any tickets for this quarterly draw yet.'}
                          </div>
                          <div className="mt-3">
                            {normalizedQuery || myTicketFilter !== 'ALL' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSearchQuery('');
                                  setMyTicketFilter('ALL');
                                }}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                              >
                                Clear Filters
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => focusMintDesk(5)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#047857] hover:bg-[#065F46] text-white text-xs font-semibold transition-colors"
                              >
                                Mint First Ticket
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredMyTickets.map((t) => {
                        const nums = t.ticket_numbers || [];
                        return (
                          <tr key={t.id} className="hover:bg-slate-50/60">
                            <td className="py-3 px-5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono-tabular font-semibold text-slate-900">{t.id}</span>
                                <span className="text-slate-300" aria-hidden="true">·</span>
                                <span className="text-slate-500">{t.quarter_label}</span>
                                <span className="text-slate-300" aria-hidden="true">·</span>
                                <span className="font-mono-tabular text-slate-400">{formatDateTime(t.created_at)}</span>
                              </div>
                              {nums.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono-tabular text-[11px]">
                                  {nums.slice(0, 8).map((num) => {
                                    const isWinNum = t.status === 'WON' && t.winning_ticket_number === num;
                                    return (
                                      <span
                                        key={num}
                                        className={
                                          isWinNum
                                            ? 'font-bold text-[#047857] underline decoration-emerald-400 underline-offset-2'
                                            : 'text-slate-600'
                                        }
                                      >
                                        #{num}
                                      </span>
                                    );
                                  })}
                                  {nums.length > 8 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleCopyText(`tkt-${t.id}`, nums.map((n) => `#${n}`).join(', '))
                                      }
                                      className="text-blue-600 hover:underline font-medium"
                                      title="Copy all ticket numbers"
                                    >
                                      {copiedKey === `tkt-${t.id}` ? 'Copied all' : `+${nums.length - 8} more (Copy all)`}
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                              {t.ticket_count}x
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular text-slate-600 whitespace-nowrap">
                              ${formatUsd(t.cost_usd)}
                            </td>
                            <td className="py-3 px-5 text-right font-mono-tabular font-semibold whitespace-nowrap">
                              {t.status === 'WON' ? (
                                <div>
                                  <div className="text-[#047857]">WON +${formatUsd(t.prize_won)}</div>
                                  {t.winning_ticket_number && (
                                    <div className="text-[11px] font-normal text-[#047857]">
                                      Ticket #{t.winning_ticket_number}
                                    </div>
                                  )}
                                </div>
                              ) : t.status === 'LOST' ? (
                                <span className="text-slate-500">Closed</span>
                              ) : (
                                <span className="text-blue-600">Active</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: LIVE ROUND FEED */}
            {stageTab === 'LIVE_FEED' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                      <th className="py-2.5 px-5">Participant</th>
                      <th className="py-2.5 px-4">Ticket Numbers</th>
                      <th className="py-2.5 px-4 text-right">Qty</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                      <th className="py-2.5 px-5 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredRecentParticipants.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 px-5 text-center text-slate-500">
                          {normalizedQuery
                            ? 'No live entries match your search.'
                            : 'No tickets purchased yet for this quarterly cycle.'}
                        </td>
                      </tr>
                    ) : (
                      filteredRecentParticipants.map((p) => (
                        <tr key={p.id} className={p.is_me ? 'bg-blue-50/35 hover:bg-blue-50/55' : 'hover:bg-slate-50/60'}>
                          <td className="py-3 px-5">
                            <div className="font-medium text-slate-900">{p.user_name}</div>
                            {p.uid && <div className="text-[11px] font-mono-tabular text-slate-400">{p.uid}</div>}
                          </td>
                          <td className="py-3 px-4">
                            {p.ticket_numbers && p.ticket_numbers.length > 0 ? (
                              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-mono-tabular text-slate-600">
                                {p.ticket_numbers.slice(0, 5).map((num) => (
                                  <span key={num}>#{num}</span>
                                ))}
                                {p.ticket_numbers.length > 5 && (
                                  <span className="text-slate-400">+{p.ticket_numbers.length - 5} more</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-blue-600 whitespace-nowrap">
                            {p.ticket_count}x
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                            ${formatUsd(p.cost_usd)}
                          </td>
                          <td className="py-3 px-5 text-right font-mono-tabular text-slate-500 whitespace-nowrap">
                            {formatDateTime(p.created_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: LEADERBOARD */}
            {stageTab === 'LEADERBOARD' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                      <th className="py-2.5 px-5 w-14">Rank</th>
                      <th className="py-2.5 px-4">Participant</th>
                      <th className="py-2.5 px-4 text-right">Tickets</th>
                      <th className="py-2.5 px-4 text-right">Spent</th>
                      <th className="py-2.5 px-5 text-right">Pool Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredLeaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 px-5 text-center text-slate-500">
                          {normalizedQuery
                            ? 'No leaderboard participants match your search.'
                            : 'No active round leaderboard entries yet.'}
                        </td>
                      </tr>
                    ) : (
                      filteredLeaderboard.map((entry) => (
                        <tr
                          key={`${entry.rank}-${entry.uid}`}
                          className={entry.is_me ? 'bg-blue-50/35 hover:bg-blue-50/55' : 'hover:bg-slate-50/60'}
                        >
                          <td className="py-3 px-5 font-mono-tabular font-bold text-slate-900">#{entry.rank}</td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{entry.user_name}</div>
                            <div className="text-[11px] font-mono-tabular text-slate-400">{entry.uid}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-blue-600">
                            {entry.ticket_count}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular text-slate-900">
                            ${formatUsd(entry.cost_usd)}
                          </td>
                          <td className="py-3 px-5 text-right">
                            <div className="inline-flex items-center justify-end gap-2.5 min-w-[130px]">
                              <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-600"
                                  style={{ width: `${Math.min(100, entry.entry_share_pct)}%` }}
                                />
                              </div>
                              <span className="font-mono-tabular font-semibold text-slate-900 w-12 text-right">
                                {entry.entry_share_pct.toFixed(2)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: PAST WINNERS */}
            {stageTab === 'WINNERS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/60">
                      <th className="py-2.5 px-5">Quarter · Round</th>
                      <th className="py-2.5 px-4 text-right">Tickets</th>
                      <th className="py-2.5 px-4 text-right">Final Pool</th>
                      <th className="py-2.5 px-4">Verified Winner</th>
                      <th className="py-2.5 px-4">SHA-256 Proof</th>
                      <th className="py-2.5 px-5 text-right">Settled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {filteredWinners.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 px-5 text-center text-slate-500">
                          {normalizedQuery
                            ? 'No past draw records match your search.'
                            : 'No completed quarterly draws yet.'}
                        </td>
                      </tr>
                    ) : (
                      filteredWinners.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-5">
                            <div className="font-semibold text-slate-900">{d.quarter_label}</div>
                            <div className="text-[11px] text-slate-500">{d.title || 'Quarterly Jackpot'}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                            {d.tickets_sold ?? 0}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-bold text-[#047857] whitespace-nowrap">
                            ${formatUsd(d.prize_pool)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{d.winner_name || 'Verified Winner'}</div>
                            <div className="font-mono-tabular text-slate-500">{d.winner_email || '—'}</div>
                            {d.winning_ticket_number && (
                              <div className="mt-0.5 text-[11px] font-mono-tabular font-semibold text-[#047857]">
                                Winning Ticket #{d.winning_ticket_number}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {d.draw_hash ? (
                              <button
                                type="button"
                                onClick={() => handleCopyText(`hash-${d.id}`, d.draw_hash)}
                                title={d.draw_hash}
                                className="inline-flex items-center gap-1.5 font-mono-tabular text-slate-600 hover:text-blue-600 transition-colors"
                              >
                                <span>{shortenHash(d.draw_hash)}</span>
                                {copiedKey === `hash-${d.id}` ? (
                                  <Check className="w-3.5 h-3.5 text-[#047857]" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                                )}
                              </button>
                            ) : (
                              <span className="font-mono-tabular text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-5 text-right font-mono-tabular text-slate-500 whitespace-nowrap">
                            {formatDateTime(d.draw_at)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: RULES & LIVE FORMULAS */}
            {stageTab === 'RULES' && (
              <div className="divide-y divide-slate-200">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200">
                  <div className="divide-y divide-slate-200">
                    <div className="p-5 space-y-1.5">
                      <div className="text-xs font-semibold text-blue-600">01. Pool Funding Architecture (80 / 20)</div>
                      <h3 className="text-sm font-semibold text-slate-900">Guaranteed Base Seed + Ticket Growth</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Every quarterly round opens with a guaranteed USDT seed pool. 80% of every ticket purchase is
                        credited directly to the prize pool while 20% funds treasury and security reserves.
                      </p>
                    </div>
                    <div className="p-5 space-y-1.5">
                      <div className="text-xs font-semibold text-blue-600">02. Direct Ticket Weighting</div>
                      <h3 className="text-sm font-semibold text-slate-900">1 Purchased Ticket = 1 Draw Entry</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Every ticket you purchase assigns a unique 6-digit number and equals exactly 1 weighted entry
                        in the draw pool. Only purchased tickets count toward draw odds and settlement.
                      </p>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-200">
                    <div className="p-5 space-y-1.5">
                      <div className="text-xs font-semibold text-blue-600">03. Automated 90-Day Settlement</div>
                      <h3 className="text-sm font-semibold text-slate-900">Zero-Delay Claimable Wallet Payout</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        At cycle maturity, a server-side cryptographically secure RNG selects one winning ticket, credits
                        100% of the prize pool directly to the winner&apos;s Claimable Wallet, and opens the next quarter.
                      </p>
                    </div>
                    <div className="p-5 space-y-1.5">
                      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>04. SHA-256 Audit Verification</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">Deterministic Settlement Receipt</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Completed draws store an immutable SHA-256 hash derived from Round ID, Winner ID, Winning Ticket
                        Number, Final Pool Value, Execution Timestamp, and Total Pool Size.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/40 text-xs">
                  <div>
                    <div className="text-slate-500 font-medium">Live Prize Pool Formula</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-slate-900">
                      ${formatUsd(basePoolUsd)} + (Sales × 80%) = ${formatUsd(totalPool)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-medium">Your Win Probability Formula</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-blue-600">
                      {myActiveTicketCount} ÷ {totalActiveTickets || 0} = {currentOddsPct.toFixed(2)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-medium">Current Selection Split</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-slate-900">
                      80% Pool (${formatUsd(poolContribution)}) · 20% Reserve (${formatUsd(treasuryFee)})
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT 4 COLUMNS: STICKY TRADING-STYLE TICKET ORDER SIDEBAR */}
        <aside className="xl:col-span-4 xl:sticky xl:top-6">
          <form
            onSubmit={handleBuyTickets}
            className="border border-slate-200 rounded-xl bg-white p-5 space-y-5"
          >
            {/* Sidebar Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-[#047857]" />
                <h2 className="text-sm font-bold text-slate-900">Ticket Order Desk</h2>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-slate-600">
                ${formatUsd(ticketPrice)} / ticket
              </span>
            </div>

            {/* Available Main Balance + Max */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Available Balance</span>
              <div className="flex items-center gap-2">
                <span className="font-mono-tabular font-bold text-slate-900">
                  ${formatUsd(availableMainBalance)} USDT
                </span>
                {maxAffordableTickets > 0 && (
                  <button
                    type="button"
                    onClick={() => setTicketCount(String(maxAffordableTickets))}
                    className="text-[11px] font-semibold text-blue-600 hover:underline whitespace-nowrap"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            {/* Quantity Presets + Stepper Input */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-6 gap-1.5">
                {[1, 5, 10, 25, 50, 100].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTicketCount(String(preset))}
                    className={`h-8 text-xs font-mono-tabular font-semibold rounded-md border transition-colors whitespace-nowrap ${
                      parsedCount === preset
                        ? 'bg-[#047857] border-[#047857] text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStepQuantity(-1)}
                  disabled={parsedCount <= 1}
                  aria-label="Decrease ticket quantity"
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 shrink-0 transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <div className="relative flex-1">
                  <input
                    id="jackpot-ticket-qty"
                    ref={ticketInputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    required
                    aria-label="Ticket quantity"
                    value={ticketCount}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '');
                      if (!digits) {
                        setTicketCount('');
                        return;
                      }
                      const clamped = Math.min(100, Number(digits));
                      setTicketCount(String(clamped));
                    }}
                    onBlur={() => {
                      if (!ticketCount || Number(ticketCount) < 1) {
                        setTicketCount('1');
                      }
                    }}
                    className="w-full h-10 pl-3 pr-14 text-right text-sm font-mono-tabular font-bold border border-slate-200 rounded-lg bg-slate-50/60 focus:bg-white focus:outline-none focus:border-[#047857]"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-slate-400 pointer-events-none">
                    Tickets
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleStepQuantity(1)}
                  disabled={parsedCount >= 100}
                  aria-label="Increase ticket quantity"
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 shrink-0 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Live Win Probability Simulator Meter */}
            <div className="p-3.5 rounded-lg bg-slate-50/80 border border-slate-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-medium">Win Chance Impact</span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  {currentOddsPct.toFixed(2)}% →{' '}
                  <span className="text-[#047857]">{projectedOddsPct.toFixed(2)}%</span>
                </span>
              </div>
              <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
                <div
                  className="bg-blue-600 h-full transition-all duration-200"
                  style={{ width: `${Math.min(100, currentOddsPct)}%` }}
                />
                {oddsDeltaPct > 0 && (
                  <div
                    className="bg-[#047857] h-full transition-all duration-200"
                    style={{ width: `${Math.min(100 - Math.min(100, currentOddsPct), oddsDeltaPct)}%` }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-tabular">
                <span>After: {myTicketsAfter} / {totalTicketsAfter} tickets</span>
                {oddsDeltaPct > 0 && <span className="text-[#047857] font-semibold">+{oddsDeltaPct.toFixed(2)}%</span>}
              </div>
            </div>

            {/* Cost Breakdown Ledger */}
            <div className="divide-y divide-slate-100 text-xs">
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-500">Order Total</span>
                <span className="font-mono-tabular font-bold text-slate-900">${formatUsd(totalCost)} USDT</span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-500">Prize Pool Boost (80%)</span>
                <span className="font-mono-tabular font-semibold text-[#047857]">+${formatUsd(poolContribution)}</span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-slate-500">Treasury Reserve (20%)</span>
                <span className="font-mono-tabular text-slate-600">${formatUsd(treasuryFee)}</span>
              </div>
            </div>

            {/* Primary Execution CTA */}
            <button
              type="submit"
              disabled={!activeDraw || parsedCount < 1 || totalCost > availableMainBalance || submitting}
              className="w-full h-11 px-4 bg-[#047857] hover:bg-[#065F46] disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
            >
              {submitting
                ? 'Minting Tickets...'
                : !activeDraw
                ? 'Round Settling — Please Wait'
                : totalCost > availableMainBalance
                ? `Insufficient Balance (Need $${formatUsd(totalCost)})`
                : `Buy ${parsedCount} Ticket${parsedCount === 1 ? '' : 's'} · $${formatUsd(totalCost)}`}
            </button>

            {/* Footer Protocol Specs */}
            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
              <div className="flex items-center justify-between">
                <span>Number Assignment</span>
                <span className="font-mono-tabular font-semibold text-slate-700">Unique 6-Digit RNG</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Settlement Verification</span>
                <span className="font-mono-tabular font-semibold text-slate-700">CSPRNG · SHA-256</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Payout Destination</span>
                <span className="font-semibold text-slate-700">Claimable Wallet</span>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
};
