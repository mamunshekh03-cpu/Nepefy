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
    const timer = setInterval(() => loadPresale(false), 5000);
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
    const feePerShare = Number(round.network_fee ?? 0.10);
    const networkFee = Number((lots * feePerShare).toFixed(2));
    const principal = Number((lots * lotPrice).toFixed(2));
    const totalCost = Number((principal + networkFee).toFixed(2));

    if (round.status !== 'OPEN' || remaining <= 0) {
      setNotice({ type: 'err', text: 'This presale round is closed or sold out.' });
      setBusyId(null);
      return;
    }
    if (lots > remaining) {
      setNotice({ type: 'err', text: `Only ${remaining} share(s) remaining.` });
      setBusyId(null);
      return;
    }
    if (user.main_balance < totalCost) {
      setNotice({
        type: 'err',
        text: `Insufficient balance. Need $${formatUsd(totalCost)}, have $${formatUsd(user.main_balance)}.`,
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
        text: `✓ Subscribed ${lots} share(s) of ${round.token_symbol}. $${formatUsd(principal)} + $${formatUsd(networkFee)} fee deducted.`,
      });
      await Promise.all([loadPresale(false), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Purchase failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const { activeRounds, upcomingRounds, previousRounds, displayedRounds } = useMemo(() => {
    const active = rounds.filter((r) => r.status === 'OPEN');
    const upcoming = rounds.filter((r) => r.status === 'UPCOMING');
    const previous = rounds.filter((r) => r.status !== 'OPEN' && r.status !== 'UPCOMING');
    const displayed =
      ipoTab === 'ACTIVE' ? active : ipoTab === 'UPCOMING' ? upcoming : previous;
    return { activeRounds: active, upcomingRounds: upcoming, previousRounds: previous, displayedRounds: displayed };
  }, [rounds, ipoTab]);

  const filteredTickets = useMemo(() => {
    if (ticketFilter === 'ALL') return tickets;
    return tickets.filter((t) => t.result === ticketFilter);
  }, [tickets, ticketFilter]);

  const ticketStats = useMemo(() => {
    let totalInvested = 0, totalWon = 0, totalRefunded = 0;
    tickets.forEach((t) => {
      totalInvested += Number(t.principal_paid || 0) + Number(t.fee_paid || 0);
      if (t.result === 'WIN') totalWon += Number(t.payout_amount || 0);
      else if (t.result === 'LOSS') totalRefunded += Number(t.payout_amount || 0);
    });
    return { totalTickets: tickets.length, totalInvested, totalWon, totalRefunded };
  }, [tickets]);

  return (
    <div className="space-y-6 pb-12">

      {/* ── Page Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-950 px-5 py-4 text-white shadow-md border border-slate-700/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-extrabold tracking-tight">Coin Presale</h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-medium">
                <Sparkles className="w-3 h-3" /> IPO Launchpad
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-lg">
              Subscribe to pre-listing shares. Non-winning subscriptions get 100% principal refund.
            </p>
            <div className="flex items-center gap-1.5 text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-300 font-medium">100% Principal Guaranteed</span>
              <span className="text-slate-600 mx-1">·</span>
              <Ticket className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-indigo-300 font-medium">${formatUsd(rounds[0]?.network_fee ?? 0.10)} Network Fee / Share</span>
            </div>
          </div>

          {/* Wallet balances */}
          <div className="flex items-stretch gap-3 shrink-0 bg-slate-800/80 px-4 py-3 rounded-xl border border-slate-700/60">
            <div className="pr-3 border-r border-slate-700/60">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Wallet className="w-3.5 h-3.5 text-blue-400" /> Main Balance
              </div>
              <div className="mt-0.5 text-lg font-bold font-mono-tabular text-white">${formatUsd(user.main_balance)}</div>
            </div>
            <div className="pl-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <RotateCcw className="w-3.5 h-3.5 text-emerald-400" /> Claimable
              </div>
              <div className="mt-0.5 text-lg font-bold font-mono-tabular text-emerald-400">${formatUsd(user.claimable_balance)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Global Notice ── */}
      {notice && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl text-sm border ${
          notice.type === 'ok'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {notice.type === 'ok'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            : <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
          <span className="flex-1 font-medium">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs opacity-50 hover:opacity-100 underline">Dismiss</button>
        </div>
      )}

      {/* ── IPO Rounds Section ── */}
      <section className="space-y-4">

        {/* Section header + tab switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" /> IPO Offerings
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
              {([
                { key: 'ACTIVE', label: 'Active', count: activeRounds.length, dot: 'bg-emerald-500 animate-pulse' },
                { key: 'UPCOMING', label: 'Upcoming', count: upcomingRounds.length, dot: 'bg-blue-500' },
                { key: 'PREVIOUS', label: 'Previous', count: previousRounds.length, dot: 'bg-slate-400' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setIpoTab(tab.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                    ipoTab === tab.key ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${tab.dot}`} />
                  {tab.label}
                  <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 text-[10px] font-mono-tabular">{tab.count}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => loadPresale(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-xs transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>
        </div>

        {/* Round cards */}
        {loading && rounds.length === 0 ? (
          <div className="border border-slate-200 rounded-2xl bg-white p-12 text-center space-y-3">
            <RefreshCw className="w-7 h-7 animate-spin mx-auto text-blue-500" />
            <p className="text-sm text-slate-500">Loading IPO offerings...</p>
          </div>
        ) : displayedRounds.length === 0 ? (
          <div className="border border-dashed border-slate-300 rounded-2xl bg-white p-12 text-center space-y-2">
            <Ticket className="w-9 h-9 mx-auto text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">
              {ipoTab === 'ACTIVE' ? 'No Active IPO Rounds' : ipoTab === 'UPCOMING' ? 'No Upcoming Rounds' : 'No Previous Rounds'}
            </p>
            <p className="text-xs text-slate-400 max-w-xs mx-auto">
              {ipoTab === 'ACTIVE' ? 'Check back later or watch the Upcoming tab.' : ipoTab === 'UPCOMING' ? 'New launches will appear here when scheduled.' : 'Completed rounds are archived here.'}
            </p>
          </div>
        ) : (
          <div className={displayedRounds.length === 1 ? 'space-y-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start'}>
            {displayedRounds.map((r) => {
              const lots = Math.max(1, Math.floor(Number(lotCounts[r.id] || 1)));
              const remaining = Math.max(0, r.total_lots - r.sold_lots);
              const lotPrice = Number(r.lot_price || 0);
              const feePerShare = Number(r.network_fee ?? 0.10);
              const networkFee = Number((lots * feePerShare).toFixed(2));
              const principal = Number((lots * lotPrice).toFixed(2));
              const totalCost = Number((principal + networkFee).toFixed(2));
              const percentSold = r.total_lots > 0 ? Math.min(100, Math.round((r.sold_lots / r.total_lots) * 100)) : 0;
              const lotSize = r.tokens_per_lot || r.lot_size || 50;
              const canAfford = user.main_balance >= totalCost;
              const isClosed = r.status !== 'OPEN' || remaining <= 0;
              const exceedsRemaining = !isClosed && lots > remaining;

              const setQty = (n: number) => {
                const v = Math.min(remaining, Math.max(1, n));
                setLotCounts((p) => ({ ...p, [r.id]: String(v) }));
              };
              const setMaxAffordable = () => {
                const unit = lotPrice + feePerShare;
                if (unit <= 0) return;
                const v = Math.min(remaining, Math.max(1, Math.floor(user.main_balance / unit)));
                setLotCounts((p) => ({ ...p, [r.id]: String(v) }));
              };

              return (
                <div key={r.id} className="border border-slate-200 rounded-2xl bg-white shadow-sm flex flex-col overflow-hidden">

                  {/* ── Card Header ── */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        <CryptoIcon symbol={r.token_symbol} size="md" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900 text-sm">{r.token_symbol}</span>
                          <span className="text-slate-500 text-xs truncate max-w-[160px]">· {r.token_name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 font-mono-tabular">
                            {lotSize} {r.token_symbol} / share
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span>Draw: {formatDateTime(r.draw_date)}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                      r.status === 'OPEN'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : r.status === 'UPCOMING'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'OPEN' ? 'bg-emerald-500 animate-pulse' : r.status === 'UPCOMING' ? 'bg-blue-500' : 'bg-slate-400'}`} />
                      {r.status === 'OPEN' ? 'Active / Open' : r.status === 'UPCOMING' ? 'Upcoming' : 'Closed'}
                    </span>
                  </div>

                  {/* ── Card Body ── */}
                  <div className="p-4 space-y-4 flex-1 flex flex-col">

                    {/* Subscription Progress */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-xs text-slate-600">
                        <span className="font-medium">Subscription Progress</span>
                        <span className="font-mono-tabular font-semibold text-slate-900">
                          {r.sold_lots} / {r.total_lots}
                          <span className="text-blue-600 ml-1">({percentSold}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: `${percentSold}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span className={remaining > 0 ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                          {remaining > 0 ? `${remaining} shares remaining` : 'Sold Out'}
                        </span>
                        <span>Auto-draw on close</span>
                      </div>
                    </div>

                    {/* Key Metrics — 4 simple fields in a row */}
                    <div className="grid grid-cols-4 divide-x divide-slate-100 border border-slate-100 rounded-xl overflow-hidden bg-slate-50/50">
                      <div className="px-3 py-2.5 text-center">
                        <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Share Price</div>
                        <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-900">${formatUsd(lotPrice)}</div>
                      </div>
                      <div className="px-3 py-2.5 text-center">
                        <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Lot Size</div>
                        <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-blue-600">{lotSize} <span className="text-xs text-slate-500">{r.token_symbol}</span></div>
                      </div>
                      <div className="px-3 py-2.5 text-center">
                        <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Win Payout</div>
                        <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-emerald-600">+${formatUsd(r.projected_win_payout)}</div>
                      </div>
                      <div className="px-3 py-2.5 text-center">
                        <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Network Fee</div>
                        <div className="mt-0.5 text-sm font-extrabold font-mono-tabular text-slate-700">${formatUsd(feePerShare)}</div>
                      </div>
                    </div>

                    {/* ── Purchase / Status Section ── */}
                    {r.status === 'UPCOMING' ? (
                      <div className="flex-1 flex items-center justify-center border border-blue-100 rounded-xl bg-blue-50/60 px-4 py-5 text-center">
                        <div>
                          <Clock className="w-6 h-6 text-blue-500 mx-auto mb-1.5" />
                          <p className="text-sm font-semibold text-slate-800">Opening Soon</p>
                          <p className="text-xs text-slate-500 mt-0.5">Subscription opens on <strong>{formatDateTime(r.draw_date)}</strong></p>
                        </div>
                      </div>
                    ) : r.status !== 'OPEN' ? (
                      <div className="flex-1 flex items-center justify-center border border-slate-100 rounded-xl bg-slate-50 px-4 py-5 text-center">
                        <div>
                          <CheckCircle2 className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                          <p className="text-sm font-semibold text-slate-700">Round Closed</p>
                          <p className="text-xs text-slate-400 mt-0.5">{r.sold_lots} / {r.total_lots} shares subscribed</p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 flex-1">
                        {/* Quantity selector */}
                        <div>
                          <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5">
                            <span className="font-semibold">Shares to Subscribe</span>
                            <span className="text-slate-400">Max available: <strong className="text-slate-700">{remaining}</strong></span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center border border-slate-200 rounded-xl bg-white overflow-hidden h-10 flex-1">
                              <button
                                type="button"
                                onClick={() => setQty(lots - 1)}
                                disabled={lots <= 1}
                                className="px-3 h-full text-slate-500 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min="1"
                                max={Math.max(1, remaining)}
                                value={lotCounts[r.id] ?? '1'}
                                onChange={(e) => setLotCounts((p) => ({ ...p, [r.id]: e.target.value }))}
                                className="w-full h-full text-center font-bold text-slate-900 font-mono-tabular border-x border-slate-100 focus:outline-none focus:bg-blue-50/30 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <button
                                type="button"
                                onClick={() => setQty(lots + 1)}
                                disabled={lots >= remaining}
                                className="px-3 h-full text-slate-500 hover:text-slate-900 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            {/* Quick presets */}
                            <div className="flex gap-1">
                              {[1, 5, 10].map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  disabled={p > remaining}
                                  onClick={() => setQty(p)}
                                  className={`px-2.5 py-2 text-xs font-semibold rounded-lg border transition-all disabled:opacity-30 disabled:pointer-events-none ${
                                    lots === p ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                  }`}
                                >
                                  {p}
                                </button>
                              ))}
                              <button
                                type="button"
                                onClick={setMaxAffordable}
                                disabled={remaining <= 0}
                                className="px-2.5 py-2 text-xs font-semibold rounded-lg border bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 transition-colors disabled:opacity-30"
                              >
                                Max
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Cost summary — single clean line */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <span>{lots} share{lots > 1 ? 's' : ''} × ${formatUsd(lotPrice)} + ${formatUsd(networkFee)} fee</span>
                            <span className="font-bold text-base text-slate-900 font-mono-tabular">${formatUsd(totalCost)}</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                            <span className="text-emerald-600 font-medium">If Win: +${formatUsd(lots * r.projected_win_payout)} & {lots * lotSize} {r.token_symbol}</span>
                            <span className="text-blue-600 font-medium">If Loss: +${formatUsd(principal)} refund</span>
                          </div>
                        </div>

                        {/* Validation warnings */}
                        {exceedsRemaining && (
                          <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            Only <strong>{remaining}</strong> share(s) left.
                          </div>
                        )}
                        {!canAfford && !exceedsRemaining && (
                          <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            Insufficient balance — ${formatUsd(user.main_balance)} available.
                          </div>
                        )}

                        {/* Subscribe button */}
                        <button
                          type="button"
                          disabled={busyId === r.id || exceedsRemaining || !canAfford}
                          onClick={() => handleBuyLots(r)}
                          className="w-full h-11 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
                        >
                          {busyId === r.id ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Processing...</>
                          ) : exceedsRemaining ? (
                            <span>Exceeds Remaining ({remaining})</span>
                          ) : !canAfford ? (
                            <span>Insufficient Balance</span>
                          ) : (
                            <><span>Subscribe {lots} Share{lots > 1 ? 's' : ''} · ${formatUsd(totalCost)}</span><ArrowRight className="w-4 h-4" /></>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── My Presale Tickets ── */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Ticket className="w-4 h-4 text-indigo-600" /> My Presale Tickets
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Your subscriptions, draw results, and refund history.</p>
          </div>
          <div className="flex items-center gap-0.5 bg-slate-100 p-1 rounded-xl text-xs font-medium">
            {([
              { key: 'ALL', label: 'All' },
              { key: 'PENDING', label: 'Pending' },
              { key: 'WIN', label: 'Winners' },
              { key: 'LOSS', label: 'Refunded' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTicketFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  ticketFilter === tab.key ? 'bg-white text-slate-900 font-bold shadow-xs' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Tickets', value: ticketStats.totalTickets.toString(), color: 'text-slate-900' },
            { label: 'Total Invested', value: `$${formatUsd(ticketStats.totalInvested)}`, color: 'text-slate-900' },
            { label: 'Total Won', value: `+$${formatUsd(ticketStats.totalWon)}`, color: 'text-emerald-600' },
            { label: 'Total Refunded', value: `+$${formatUsd(ticketStats.totalRefunded)}`, color: 'text-blue-600' },
          ].map((s) => (
            <div key={s.label} className="border border-slate-200 rounded-xl bg-white px-4 py-3">
              <div className="text-[11px] text-slate-400">{s.label}</div>
              <div className={`mt-0.5 text-base font-bold font-mono-tabular ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tickets table */}
        <div className="border border-slate-200 rounded-2xl bg-white overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50/80">
                  <th className="py-3 px-4">Ticket / Date</th>
                  <th className="py-3 px-4">Token</th>
                  <th className="py-3 px-4 text-center">Shares</th>
                  <th className="py-3 px-4 text-right">Paid</th>
                  <th className="py-3 px-4 text-center">Result</th>
                  <th className="py-3 px-4 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Ticket className="w-7 h-7 mx-auto mb-2 text-slate-300" />
                      {ticketFilter === 'ALL' ? 'No presale tickets yet.' : `No ${ticketFilter.toLowerCase()} tickets.`}
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map((t) => {
                    const isWin = t.result === 'WIN';
                    const isLoss = t.result === 'LOSS';
                    const totalPaid = Number(t.principal_paid || 0) + Number(t.fee_paid || 0);
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4 font-mono-tabular">
                          <div className="font-semibold text-slate-900 text-[11px]">{t.id}</div>
                          <div className="text-[11px] text-slate-400">{formatDateTime(t.created_at)}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <CryptoIcon symbol={t.token_symbol} size="sm" />
                            <div>
                              <div className="font-bold text-slate-900">{t.token_symbol}</div>
                              {t.token_name && <div className="text-[11px] text-slate-400 truncate max-w-[120px]">{t.token_name}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono-tabular">
                          <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-800">{t.lots_count}</span>
                          <div className="text-[10px] text-slate-400 mt-0.5">{Number(((t.lots_count || 0) * (t.tokens_per_lot || 0)).toFixed(0))} {t.token_symbol}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                          ${formatUsd(totalPaid)}
                          <div className="text-[10px] text-slate-400 font-normal">+${formatUsd(t.fee_paid)} fee</div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {t.result === 'PENDING' && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Pending
                            </span>
                          )}
                          {isWin && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Trophy className="w-3 h-3" /> Winner
                            </span>
                          )}
                          {isLoss && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              <ShieldCheck className="w-3 h-3" /> Refunded
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-bold">
                          {t.result === 'PENDING' && <span className="text-slate-400 font-normal text-[11px]">Awaiting draw</span>}
                          {isWin && <span className="text-emerald-600">+${formatUsd(t.payout_amount)}</span>}
                          {isLoss && <span className="text-blue-600">+${formatUsd(t.payout_amount)}</span>}
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
