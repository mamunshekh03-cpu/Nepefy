import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type { PresaleRound, PresaleTicket, UserProfile } from '../types';
import { CryptoIcon } from './CryptoIcon';
import {
  ShieldCheck,
  Sparkles,
  Ticket,
  AlertCircle,
  Clock,
  CheckCircle2,
  Layers,
  RefreshCw,
  Wallet,
  Trophy,
  ArrowRight,
  Info,
  RotateCcw,
  Minus,
  Plus,
} from 'lucide-react';

interface PresaleViewProps {
  user: UserProfile;
  onRefresh: () => Promise<void>;
}

export const PresaleView: React.FC<PresaleViewProps> = ({ user, onRefresh }) => {
  const [rounds, setRounds] = useState<PresaleRound[]>([]);
  const [tickets, setTickets] = useState<PresaleTicket[]>([]);
  const [lotCounts, setLotCounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [ipoTab, setIpoTab] = useState<'ACTIVE' | 'UPCOMING' | 'PREVIOUS'>('ACTIVE');
  const [ticketFilter, setTicketFilter] = useState<'ALL' | 'PENDING' | 'WIN' | 'LOSS'>('ALL');

  const loadPresale = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await apiFetch<{ rounds: PresaleRound[]; tickets: PresaleTicket[] }>('/api/presale/rounds');
      setRounds(res.rounds || []);
      setTickets(res.tickets || []);
    } catch {
      // ignore background poll errors
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    loadPresale(true);
    const onFocus = () => loadPresale(false);
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => {
      loadPresale(false);
    }, 5000);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const handleBuyLots = async (round: PresaleRound) => {
    setNotice(null);
    setBusyId(round.id);
    const lots = Math.max(1, Math.floor(Number(lotCounts[round.id] || 1)));
    const remaining = Math.max(0, round.total_lots - round.sold_lots);
    const lotPrice = Number(round.lot_price || 0);
    const networkFee = Number(round.network_fee ?? 0.5);
    const principal = Number((lots * lotPrice).toFixed(2));
    const totalCost = Number((principal + networkFee).toFixed(2));

    if (round.status !== 'OPEN' || remaining <= 0) {
      setNotice({ type: 'err', text: 'This presale round is closed or sold out.' });
      setBusyId(null);
      return;
    }

    if (lots > remaining) {
      setNotice({ type: 'err', text: `Only ${remaining} lot(s) remaining in this round.` });
      setBusyId(null);
      return;
    }

    if (user.main_balance < totalCost) {
      setNotice({
        type: 'err',
        text: `Insufficient Main Balance. Required: $${formatUsd(totalCost)}, Available: $${formatUsd(user.main_balance)}. Please deposit or transfer funds first.`,
      });
      setBusyId(null);
      return;
    }

    try {
      await apiFetch('/api/presale/buy', {
        method: 'POST',
        body: JSON.stringify({ round_id: round.id, lots_count: lots }),
      });
      setNotice({
        type: 'ok',
        text: `Successfully subscribed to ${lots} share(s) of ${round.token_symbol}! $${formatUsd(principal)} principal + $${formatUsd(networkFee)} fixed network fee deducted.`,
      });
      await Promise.all([loadPresale(false), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Failed to complete presale share purchase' });
    } finally {
      setBusyId(null);
    }
  };

  // Categorize IPO rounds into Active, Upcoming, Previous
  const { activeRounds, upcomingRounds, previousRounds, displayedRounds } = useMemo(() => {
    const active = rounds.filter((r) => r.status === 'OPEN');
    const upcoming = rounds.filter((r) => r.status === 'UPCOMING');
    const previous = rounds.filter((r) => r.status !== 'OPEN' && r.status !== 'UPCOMING');
    const displayed =
      ipoTab === 'ACTIVE' ? active : ipoTab === 'UPCOMING' ? upcoming : previous;
    return {
      activeRounds: active,
      upcomingRounds: upcoming,
      previousRounds: previous,
      displayedRounds: displayed,
    };
  }, [rounds, ipoTab]);

  // Ticket stats calculations
  const filteredTickets = useMemo(() => {
    if (ticketFilter === 'ALL') return tickets;
    return tickets.filter((t) => t.result === ticketFilter);
  }, [tickets, ticketFilter]);

  const ticketStats = useMemo(() => {
    let totalInvested = 0;
    let totalWon = 0;
    let totalRefunded = 0;
    tickets.forEach((t) => {
      totalInvested += Number(t.principal_paid || 0) + Number(t.fee_paid || 0);
      if (t.result === 'WIN') {
        totalWon += Number(t.payout_amount || 0);
      } else if (t.result === 'LOSS') {
        totalRefunded += Number(t.payout_amount || 0);
      }
    });
    return {
      totalTickets: tickets.length,
      totalInvested,
      totalWon,
      totalRefunded,
    };
  }, [tickets]);

  return (
    <div className="space-y-6 pb-12">
      {/* Compact Top Header & Wallet Overview */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 p-4 sm:p-5 text-white shadow-md border border-slate-700/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
                Coin Presale
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-medium">
                <Sparkles className="w-3 h-3 text-blue-400" />
                <span>Allocation Launchpad</span>
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              Subscribe to pre-listing token lots with 100% principal protection. Non-winning lots automatically refund full principal to your Claimable Wallet.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-emerald-300 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>100% Principal Guaranteed</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-blue-300 font-medium">
                <Trophy className="w-3.5 h-3.5 text-blue-400" />
                <span>High Payout Allocation</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-indigo-300 font-medium">
                <Ticket className="w-3.5 h-3.5 text-indigo-400" />
                <span>Fixed ${formatUsd(rounds[0]?.network_fee ?? 0.5)} Network Fee</span>
              </span>
            </div>
          </div>

          {/* Compact Wallet Balances */}
          <div className="grid grid-cols-2 gap-3 shrink-0 bg-slate-800/80 px-4 py-3 rounded-xl border border-slate-700/60">
            <div className="border-r border-slate-700/60 pr-3 sm:pr-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Wallet className="w-3.5 h-3.5 text-blue-400" />
                <span>Main Balance</span>
              </div>
              <div className="mt-0.5 text-base sm:text-lg font-bold font-mono-tabular text-white">
                ${formatUsd(user.main_balance)}
              </div>
            </div>
            <div className="pl-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Claimable Wallet</span>
              </div>
              <div className="mt-0.5 text-base sm:text-lg font-bold font-mono-tabular text-emerald-400">
                ${formatUsd(user.claimable_balance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notice Message */}
      {notice && (
        <div
          className={`flex items-start gap-3 p-4 rounded-xl text-sm border shadow-sm transition-all ${
            notice.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50/90 text-emerald-800'
              : 'border-red-200 bg-red-50/90 text-red-800'
          }`}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 font-medium">{notice.text}</div>
          <button
            onClick={() => setNotice(null)}
            className="text-xs opacity-60 hover:opacity-100 underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active / Upcoming / Previous IPO Rounds Section */}
      <section className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <span>Coin Presale IPO Offerings</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Browse active subscriptions, upcoming scheduled launches, and previous completed IPO rounds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* IPO Status Tabs: Upcoming, Active, Previous */}
            <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setIpoTab('ACTIVE')}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
                  ipoTab === 'ACTIVE'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Active IPO</span>
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono-tabular text-[11px]">
                  {activeRounds.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIpoTab('UPCOMING')}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
                  ipoTab === 'UPCOMING'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>Upcoming IPO</span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 font-mono-tabular text-[11px]">
                  {upcomingRounds.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIpoTab('PREVIOUS')}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg transition-all ${
                  ipoTab === 'PREVIOUS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                <span>Previous IPO</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono-tabular text-[11px]">
                  {previousRounds.length}
                </span>
              </button>
            </div>

            <button
              onClick={() => loadPresale(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {loading && rounds.length === 0 ? (
          <div className="border border-slate-200 rounded-2xl bg-white p-12 text-center text-slate-500 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto text-blue-600" />
            <p className="text-sm font-medium">Loading presale IPO offerings...</p>
          </div>
        ) : displayedRounds.length === 0 ? (
          <div className="border border-dashed border-slate-300 rounded-2xl bg-white p-12 text-center text-slate-500 space-y-2">
            <Ticket className="w-10 h-10 mx-auto text-slate-400" />
            <h3 className="text-base font-semibold text-slate-800">
              {ipoTab === 'ACTIVE'
                ? 'No Active IPO Rounds Right Now'
                : ipoTab === 'UPCOMING'
                ? 'No Upcoming IPO Rounds Scheduled'
                : 'No Previous IPO Rounds Yet'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {ipoTab === 'ACTIVE'
                ? 'There are currently no open presale lot offerings. Check the Upcoming IPO tab or monitor announcements for new launches.'
                : ipoTab === 'UPCOMING'
                ? 'New upcoming token launches will appear here once scheduled by the exchange.'
                : 'Completed and closed presale IPO rounds will be archived here for reference.'}
            </p>
          </div>
        ) : (
          <div
            className={
              displayedRounds.length === 1
                ? 'space-y-6'
                : displayedRounds.length === 2
                ? 'grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch'
                : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch'
            }
          >
            {displayedRounds.map((r) => {
              const isSingle = displayedRounds.length === 1;
              const currentCountRaw = lotCounts[r.id] ?? '1';
              const lots = Math.max(1, Math.floor(Number(currentCountRaw) || 1));
              const remaining = Math.max(0, r.total_lots - r.sold_lots);
              const lotPrice = Number(r.lot_price || 0);
              const networkFee = Number(r.network_fee ?? 0.5);
              const principal = Number((lots * lotPrice).toFixed(2));
              const totalCost = Number((principal + networkFee).toFixed(2));
              const percentSold = r.total_lots > 0 ? Math.min(100, Math.round((r.sold_lots / r.total_lots) * 100)) : 0;
              const effectivePricePerToken = r.tokens_per_lot > 0 ? (lotPrice / r.tokens_per_lot).toFixed(4) : '0.00';
              const winMultiplier = lotPrice > 0 ? (r.projected_win_payout / lotPrice).toFixed(1) : '0';
              const canAfford = user.main_balance >= totalCost;
              const isClosed = r.status !== 'OPEN' || remaining <= 0;
              const exceedsRemaining = !isClosed && lots > remaining;

              const faceValue = r.face_value ?? 10.0;
              const rawMarketLot = r.lot_size && r.lot_size > 0 ? r.lot_size : (r.tokens_per_lot || 1);
              const rawIssuePrice = r.issue_price && r.issue_price > 0 ? r.issue_price : (lotPrice / rawMarketLot);
              const isSpecConsistent = Math.abs(rawMarketLot * rawIssuePrice - lotPrice) <= 0.05;
              const marketLot = isSpecConsistent ? rawMarketLot : (r.tokens_per_lot || rawMarketLot);
              const issuePrice = isSpecConsistent ? rawIssuePrice : (marketLot > 0 ? lotPrice / marketLot : lotPrice);
              const issuePriceDecimals = issuePrice > 0 && issuePrice < 0.1 ? 4 : 2;
              const totalIssueSize = r.total_issue_size && r.total_issue_size > 0 ? r.total_issue_size : (r.total_lots * lotPrice);
              const tokensPerLot = r.tokens_per_lot ?? marketLot;
              const totalSharesForLots = lots * marketLot;

              // Helper for quick share buttons
              const setQuantity = (qty: number) => {
                const target = Math.min(remaining, Math.max(1, qty));
                setLotCounts((prev) => ({ ...prev, [r.id]: String(target) }));
              };

              const setMaxAffordable = () => {
                if (lotPrice <= 0) return;
                const maxByBalance = Math.floor((user.main_balance - networkFee) / lotPrice);
                const maxAllowed = Math.min(remaining, Math.max(1, maxByBalance));
                setLotCounts((prev) => ({ ...prev, [r.id]: String(maxAllowed) }));
              };

              return (
                <div
                  key={r.id}
                  className="border border-slate-200 rounded-2xl bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
                >
                  {/* Round Header Bar */}
                  <div className="bg-slate-50/80 border-b border-slate-200 px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center shrink-0">
                        <CryptoIcon symbol={r.token_symbol} size="md" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-base font-bold text-slate-900 tracking-tight">
                            {r.token_symbol}
                          </h3>
                          <span className="text-xs text-slate-500 font-medium truncate max-w-[140px] sm:max-w-[180px]">
                            • {r.token_name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono-tabular bg-slate-200 text-slate-700">
                            {r.id}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 font-mono-tabular">
                            FV: ${formatUsd(faceValue)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono-tabular">
                            Lot: {marketLot} Sh
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">Draw: {formatDateTime(r.draw_date)}</span>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        r.status === 'OPEN'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : r.status === 'UPCOMING'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          r.status === 'OPEN'
                            ? 'bg-emerald-500 animate-pulse'
                            : r.status === 'UPCOMING'
                            ? 'bg-blue-500'
                            : 'bg-slate-400'
                        }`}
                      />
                      <span>
                        {r.status === 'OPEN'
                          ? 'Active / Open'
                          : r.status === 'UPCOMING'
                          ? 'Upcoming'
                          : 'Closed'}
                      </span>
                    </span>
                  </div>

                  <div
                    className={
                      isSingle
                        ? 'p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start'
                        : 'p-4 sm:p-5 space-y-4 flex-1 flex flex-col justify-between'
                    }
                  >
                    <div className={isSingle ? 'lg:col-span-7 space-y-4' : 'space-y-4'}>
                      {/* Lot Supply Progress Bar */}
                      <div className="bg-slate-50/70 rounded-xl p-3.5 border border-slate-200/80 space-y-1.5">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-medium text-slate-700">Subscription Progress</span>
                          <div className="font-mono-tabular text-slate-600 space-x-1">
                            <span className="font-bold text-slate-900">{r.sold_lots}</span>
                            <span className="text-slate-400">/</span>
                            <span>{r.total_lots}</span>
                            <span className="font-semibold text-blue-600">({percentSold}%)</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full rounded-full transition-all duration-500"
                            style={{ width: `${percentSold}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-slate-500">
                          <span className="text-emerald-700 font-medium">
                            {remaining > 0 ? `${remaining} Lots Remaining` : 'Sold Out'}
                          </span>
                          <span>Auto-draw on close</span>
                        </div>
                      </div>

                      {/* COMPLETE IPO SHARE SPECIFICATIONS BREAKDOWN */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-blue-600" />
                            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                              IPO Specifications &amp; Valuation
                            </h4>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono-tabular">
                            Allotment: {formatDateTime(r.draw_date)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-left">
                          {/* 1. Face Value */}
                          <div className="border border-slate-200 rounded-xl p-2.5 bg-gradient-to-br from-white to-slate-50">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                              Face Value (FV)
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-900">
                              ${formatUsd(faceValue)}
                            </div>
                            <div className="text-[10px] text-slate-500">Nominal Par Value</div>
                          </div>

                          {/* 2. Offer / Issue Price */}
                          <div className="border border-slate-200 rounded-xl p-2.5 bg-gradient-to-br from-white to-slate-50">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                              Issue / Offer Price
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-900">
                              ${formatUsd(issuePrice, issuePriceDecimals)}
                            </div>
                            <div className="text-[10px] text-slate-500">Per 1 Share / Token</div>
                          </div>

                          {/* 3. Market Lot Size */}
                          <div className="border border-blue-200/80 rounded-xl p-2.5 bg-gradient-to-br from-blue-50/30 to-white">
                            <div className="text-[10px] font-medium text-blue-900 uppercase tracking-wider">
                              Market Lot Size
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-blue-700">
                              {marketLot} Shares
                            </div>
                            <div className="text-[10px] text-slate-500">Min 1 Application Lot</div>
                          </div>

                          {/* 4. Lot Subscription Price */}
                          <div className="border border-blue-200/80 rounded-xl p-2.5 bg-gradient-to-br from-blue-50/40 to-white">
                            <div className="text-[10px] font-medium text-blue-900 uppercase tracking-wider">
                              Lot Subscription Price
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-900">
                              ${formatUsd(lotPrice)}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono-tabular">1 Lot = {marketLot} Sh × ${formatUsd(issuePrice, issuePriceDecimals)}</div>
                          </div>

                          {/* 5. Total Issue Size */}
                          <div className="border border-slate-200 rounded-xl p-2.5 bg-gradient-to-br from-white to-slate-50">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                              Total Issue Size
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-900">
                              ${formatUsd(totalIssueSize)}
                            </div>
                            <div className="text-[10px] text-slate-500">{r.total_lots.toLocaleString()} Total Lots</div>
                          </div>

                          {/* 6. Win Cash Jackpot */}
                          <div className="border border-emerald-200 rounded-xl p-2.5 bg-gradient-to-br from-emerald-50/50 to-white">
                            <div className="text-[10px] font-medium text-emerald-800 uppercase tracking-wider flex items-center justify-between gap-1">
                              <span className="truncate">Win Cash Jackpot</span>
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-mono-tabular shrink-0">
                                {winMultiplier}x
                              </span>
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-emerald-700">
                              +${formatUsd(r.projected_win_payout)}
                            </div>
                            <div className="text-[10px] text-emerald-700 font-medium">Into Claimable Wallet</div>
                          </div>

                          {/* 7. Guaranteed Loss Protection */}
                          <div className="border border-blue-200 rounded-xl p-2.5 bg-gradient-to-br from-blue-50/40 to-white">
                            <div className="text-[10px] font-medium text-blue-900 uppercase tracking-wider">
                              Draw Loss Protection
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-blue-700">
                              100% Refund
                            </div>
                            <div className="text-[10px] text-slate-600 font-mono-tabular">+${formatUsd(lotPrice)} to Claimable</div>
                          </div>

                          {/* 8. Token Yield */}
                          <div className="border border-slate-200 rounded-xl p-2.5 bg-gradient-to-br from-white to-slate-50">
                            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                              Token Allocation
                            </div>
                            <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-blue-600 truncate">
                              {tokensPerLot} {r.token_symbol}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono-tabular">Credited upon listing</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* REDESIGNED PURCHASE SUMMARY BOX (Active) or Status Info (Upcoming / Previous) */}
                    <div className={isSingle ? 'lg:col-span-5' : ''}>
                    {r.status === 'UPCOMING' ? (
                      <div className="border border-blue-200 rounded-2xl bg-blue-50/50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                            <Clock className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              Upcoming IPO — Subscription Opens Soon
                            </h4>
                            <p className="text-xs text-slate-600 mt-0.5">
                              This presale round is scheduled and not yet open for purchase. Once launched, it will move to the <strong className="text-blue-700">Active IPO</strong> tab.
                            </p>
                          </div>
                        </div>
                        <span className="px-4 py-2 rounded-xl bg-white border border-blue-200 text-blue-700 text-xs font-bold shrink-0 text-center">
                          Coming Soon
                        </span>
                      </div>
                    ) : r.status !== 'OPEN' ? (
                      <div className="border border-slate-200 rounded-2xl bg-slate-50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-600 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              Previous IPO — Round Completed
                            </h4>
                            <p className="text-xs text-slate-600 mt-0.5">
                              Total <strong className="font-mono-tabular text-slate-900">{r.sold_lots} / {r.total_lots}</strong> shares subscribed. Check your ticket outcomes in <strong className="text-slate-800">My Presale Draw Tickets</strong> below.
                            </p>
                          </div>
                        </div>
                        <span className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold shrink-0 text-center">
                          Round Closed
                        </span>
                      </div>
                    ) : (
                    <div className="border border-slate-200 rounded-2xl bg-gradient-to-b from-slate-50 to-white p-4 shadow-xs space-y-3.5">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center">
                            <Ticket className="w-3.5 h-3.5" />
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                            Purchase Summary
                          </h4>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          Via <strong className="text-slate-800">Main Balance</strong>
                        </span>
                      </div>

                      {/* Share Quantity Selector Controls */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700">
                          <label htmlFor={`lot-input-${r.id}`}>Shares (Lots):</label>
                          <span className="text-slate-500 font-normal">
                            Max: <strong className="text-slate-800">{remaining}</strong>
                          </span>
                        </div>

                        <div className="flex items-center border border-slate-300 rounded-xl bg-white shadow-inner overflow-hidden w-full h-10">
                          <button
                            type="button"
                            onClick={() => setQuantity(lots - 1)}
                            disabled={isClosed || lots <= 1}
                            className="px-3 h-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                            title="Decrease 1 share"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            id={`lot-input-${r.id}`}
                            type="number"
                            min="1"
                            max={Math.max(1, remaining)}
                            disabled={isClosed}
                            value={lotCounts[r.id] ?? '1'}
                            onChange={(e) => setLotCounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="w-full h-full text-center font-bold text-slate-900 font-mono-tabular border-x border-slate-200 focus:outline-hidden focus:bg-blue-50/30 text-sm disabled:bg-slate-100 disabled:text-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            onClick={() => setQuantity(lots + 1)}
                            disabled={isClosed || lots >= remaining}
                            className="px-3 h-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                            title="Increase 1 share"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Quick Preset Buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {[1, 5, 10, 25].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              disabled={isClosed || preset > remaining}
                              onClick={() => setQuantity(preset)}
                              className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border transition-all ${
                                lots === preset
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                                  : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                              } disabled:opacity-30 disabled:pointer-events-none`}
                            >
                              {preset}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={setMaxAffordable}
                            disabled={isClosed || remaining <= 0}
                            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors ml-auto disabled:opacity-30 disabled:pointer-events-none"
                          >
                            Max
                          </button>
                        </div>

                        {/* Shares / Lots breakdown strip */}
                        <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-950 font-medium">
                          <span>Subscribed Shares:</span>
                          <span className="font-bold font-mono-tabular text-blue-700">
                            {lots} Lots × {marketLot} = {totalSharesForLots} {r.token_symbol} Shares
                          </span>
                        </div>
                      </div>

                      {/* Detailed Financial Calculation Ledger */}
                      <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between items-center text-slate-600">
                          <span>Principal ({lots} × ${formatUsd(lotPrice)})</span>
                          <span className="font-mono-tabular font-semibold text-slate-900">
                            ${formatUsd(principal)}
                          </span>
                        </div>

                        <div className="flex justify-between items-center text-slate-600">
                          <span>Network Fee (Fixed)</span>
                          <span className="font-mono-tabular font-semibold text-slate-700">
                            ${formatUsd(networkFee)}
                          </span>
                        </div>

                        <div className="border-t border-slate-200 pt-1.5 flex justify-between items-center font-bold text-slate-900">
                          <span>Total Deduction</span>
                          <span className="font-mono-tabular text-sm text-blue-600">
                            ${formatUsd(totalCost)}
                          </span>
                        </div>

                        {/* Balance & Remaining Lot Check Notice */}
                        {exceedsRemaining && (
                          <div className="mt-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-1.5 text-[11px]">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                            <span>
                              Only <strong>{remaining}</strong> share(s) left.
                            </span>
                          </div>
                        )}
                        {!canAfford && (
                          <div className="mt-1.5 p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-1.5 text-[11px]">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                            <span>
                              Low Main Balance (${formatUsd(user.main_balance)} available).
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Compact Potential Draw Outcomes */}
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-lg p-2.5">
                          <div className="font-bold text-emerald-900 flex items-center gap-1">
                            <Trophy className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>If Win</span>
                          </div>
                          <div className="text-slate-700 mt-0.5 font-mono-tabular">
                            <strong className="text-emerald-700">+${formatUsd(lots * r.projected_win_payout)}</strong>{' '}
                            &amp; {lots * r.tokens_per_lot} {r.token_symbol}
                          </div>
                        </div>

                        <div className="bg-blue-50/70 border border-blue-200/80 rounded-lg p-2.5">
                          <div className="font-bold text-blue-900 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-blue-600 shrink-0" />
                            <span>If Not Drawn</span>
                          </div>
                          <div className="text-slate-700 mt-0.5 font-mono-tabular">
                            <strong className="text-blue-700">+${formatUsd(principal)}</strong>{' '}
                            100% Refund
                          </div>
                        </div>
                      </div>

                      {/* Submit / CTA Button */}
                      <button
                        type="button"
                        disabled={busyId === r.id || isClosed || exceedsRemaining || !canAfford}
                        onClick={() => handleBuyLots(r)}
                        className="w-full h-11 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
                      >
                        {busyId === r.id ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Processing...</span>
                          </>
                        ) : isClosed ? (
                          <span>Closed / Sold Out</span>
                        ) : exceedsRemaining ? (
                          <span>Exceeds Remaining ({remaining})</span>
                        ) : !canAfford ? (
                          <span>Insufficient Balance</span>
                        ) : (
                          <>
                            <span>Subscribe {lots} Lot(s) ({totalSharesForLots} Shares) • ${formatUsd(totalCost)}</span>
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                    )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* User's Presale Draw Tickets Section */}
      <section className="space-y-4 pt-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Ticket className="w-5 h-5 text-indigo-600" />
              <span>My Presale Draw Tickets</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live status of your submitted tickets, draw resolutions, and refund logs.
            </p>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-medium text-slate-600 self-start sm:self-auto">
            {(
              [
                { key: 'ALL', label: 'All Tickets' },
                { key: 'PENDING', label: 'Pending' },
                { key: 'WIN', label: 'Winners' },
                { key: 'LOSS', label: 'Refunded (Loss)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTicketFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  ticketFilter === tab.key
                    ? 'bg-white text-slate-900 font-bold shadow-xs'
                    : 'hover:text-slate-900 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Aggregate Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="border border-slate-200 rounded-xl bg-white p-3.5">
            <div className="text-slate-500">Total Tickets Subscribed</div>
            <div className="mt-1 text-base font-bold font-mono-tabular text-slate-900">
              {ticketStats.totalTickets}
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl bg-white p-3.5">
            <div className="text-slate-500">Total Invested (Principal + Fee)</div>
            <div className="mt-1 text-base font-bold font-mono-tabular text-slate-900">
              ${formatUsd(ticketStats.totalInvested)}
            </div>
          </div>
          <div className="border border-emerald-200 rounded-xl bg-emerald-50/50 p-3.5">
            <div className="text-emerald-800">Total Jackpot Won</div>
            <div className="mt-1 text-base font-bold font-mono-tabular text-emerald-600">
              +${formatUsd(ticketStats.totalWon)}
            </div>
          </div>
          <div className="border border-blue-200 rounded-xl bg-blue-50/50 p-3.5">
            <div className="text-blue-800">Total Principal Refunded</div>
            <div className="mt-1 text-base font-bold font-mono-tabular text-blue-600">
              +${formatUsd(ticketStats.totalRefunded)}
            </div>
          </div>
        </div>

        {/* Tickets Table */}
        <div className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50/80">
                  <th className="py-3.5 px-4">Ticket ID / Timestamp</th>
                  <th className="py-3.5 px-4">Token Offering</th>
                  <th className="py-3.5 px-4 text-center">Shares / Lots</th>
                  <th className="py-3.5 px-4 text-right">Principal Paid</th>
                  <th className="py-3.5 px-4 text-right">Network Fee</th>
                  <th className="py-3.5 px-4 text-center">Draw Result</th>
                  <th className="py-3.5 px-4 text-right">Claimable Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 px-4 text-center text-slate-500">
                      <Ticket className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <div className="font-medium text-slate-700">No Presale Tickets Found</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {ticketFilter === 'ALL'
                          ? 'You have not purchased any presale shares yet.'
                          : `No tickets matching filter "${ticketFilter}".`}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((t) => {
                    const isWin = t.result === 'WIN';
                    const isLoss = t.result === 'LOSS';
                    const isPending = t.result === 'PENDING';

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 px-4 font-mono-tabular">
                          <div className="font-semibold text-slate-900">{t.id}</div>
                          <div className="text-[11px] text-slate-400">{formatDateTime(t.created_at)}</div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <CryptoIcon symbol={t.token_symbol} size="sm" />
                            <div>
                              <div className="font-bold text-slate-900">{t.token_symbol}</div>
                              {t.token_name && (
                                <div className="text-[11px] text-slate-500 truncate max-w-[140px]">
                                  {t.token_name}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center font-mono-tabular">
                          <span className="inline-block px-2 py-0.5 rounded-md bg-slate-100 font-bold text-slate-800">
                            {t.lots_count} {t.lots_count === 1 ? 'Lot' : 'Lots'}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {Number(((t.lots_count || 0) * (t.tokens_per_lot || 0)).toFixed(2))} {t.token_symbol}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                          ${formatUsd(t.principal_paid)}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-500">
                          ${formatUsd(t.fee_paid)}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          {isPending && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              <span>Pending Draw</span>
                            </span>
                          )}
                          {isWin && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Trophy className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Jackpot Winner</span>
                            </span>
                          )}
                          {isLoss && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                              <span>Principal Refunded</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono-tabular font-bold">
                          {isPending && (
                            <span className="text-slate-400 font-normal">Awaiting Draw</span>
                          )}
                          {isWin && (
                            <div className="text-emerald-600">
                              +${formatUsd(t.payout_amount)}
                              <div className="text-[10px] font-normal text-emerald-700">Credited to Claimable</div>
                            </div>
                          )}
                          {isLoss && (
                            <div className="text-blue-600">
                              +${formatUsd(t.payout_amount)}
                              <div className="text-[10px] font-normal text-slate-500">100% Principal Returned</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};
