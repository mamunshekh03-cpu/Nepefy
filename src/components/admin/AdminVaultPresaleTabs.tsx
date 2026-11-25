import React, { useMemo, useState } from 'react';
import { Building2, Calendar, CheckCircle2, ChevronDown, ChevronUp, Clock, Coins, DollarSign, Info, Layers, RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../../lib/api';
import type { PresaleTicket, StakingPosition } from '../../types';
import type { AdminMetrics, AdminOverviewData, RunActionFn } from './adminTypes';

interface AdminStakingTabProps {
  metrics: AdminMetrics;
  stakingFilter: 'ALL' | 'ACTIVE' | 'COMPLETED' | 'EMERGENCY_WITHDRAWN';
  setStakingFilter: (v: 'ALL' | 'ACTIVE' | 'COMPLETED' | 'EMERGENCY_WITHDRAWN') => void;
  filteredStaking: StakingPosition[];
  runAction: RunActionFn;
}

export const AdminStakingTab: React.FC<AdminStakingTabProps> = ({
  metrics,
  stakingFilter,
  setStakingFilter,
  filteredStaking,
  runAction,
}) => {
  return (
    <div className="space-y-5">
      {/* Hairline 4-Column Vault Operations Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-slate-200">
        <div className="p-5 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-xs font-medium text-slate-500">Vault Custody TVL</div>
            <div className="mt-1 text-2xl font-bold font-mono-tabular text-slate-900">
              ${formatUsd(metrics.totalStakedPrincipal)}
            </div>
            <p className="mt-1 text-xs text-slate-500 font-mono-tabular">
              {metrics.activeStakingCount} active · ${formatUsd(metrics.totalStakingProfitPaid)} paid
            </p>
          </div>
          <div className="text-xs text-slate-500 pt-2 border-t border-slate-100 font-mono-tabular">
            Plans: 6M (18%) · 12M (20%) · 24M (22%) · 36M (25%)
          </div>
        </div>

        <div className="p-5 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-xs font-medium text-emerald-600">Daily Profit Engine</div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">Run Daily Profit (+1 Day)</h3>
            <p className="mt-1 text-xs text-slate-500">
              Credits 1 day of APR profit to users&apos; Profit Balance (locked until 30-day cycle completes).
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              runAction(async () => {
                const res = await apiFetch<{ positionsAccrued: number; totalDailyCredited: number }>(
                  '/api/admin/staking/run-daily-accrual',
                  { method: 'POST' }
                );
                return `Accrued +$${formatUsd(res.totalDailyCredited)} daily profit to Profit Balance across ${res.positionsAccrued} active vault(s).`;
              })
            }
            className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg"
          >
            Credit Daily Profit (+1 Day)
          </button>
        </div>

        <div className="p-5 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-xs font-medium text-blue-600">Monthly Yield Distribution</div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">Run Monthly Staking Payout</h3>
            <p className="mt-1 text-xs text-slate-500">
              Credits 1 month of APR profit for active staking positions directly to Claimable Wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              runAction(async () => {
                const res = await apiFetch<{ positionsProcessed: number; totalPaid: number }>(
                  '/api/admin/staking/run-monthly-payout',
                  { method: 'POST' }
                );
                return `Distributed $${formatUsd(res.totalPaid)} monthly yield across ${res.positionsProcessed} active staking position(s).`;
              })
            }
            className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg"
          >
            Distribute Monthly Profits
          </button>
        </div>

        <div className="p-5 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-xs font-medium text-blue-600">Staker Monthly Incentive</div>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">Run Monthly Staking Draw</h3>
            <p className="mt-1 text-xs text-slate-500">
              Selects an active staker and credits a $150.00 monthly draw bonus into Claimable Wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              runAction(async () => {
                const res = await apiFetch<{ winnerName: string; bonus: number }>(
                  '/api/admin/staking/run-monthly-draw',
                  { method: 'POST' }
                );
                return `Monthly Staking Draw won by ${res.winnerName} (+$${formatUsd(res.bonus)} to Claimable Wallet).`;
              })
            }
            className="w-full h-9 border border-slate-200 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-lg"
          >
            Execute Monthly Staking Draw
          </button>
        </div>
      </div>

      {/* Unified Staking Positions Table Card */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Staking Vault Positions</h2>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'ACTIVE', 'COMPLETED', 'EMERGENCY_WITHDRAWN'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStakingFilter(st)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${stakingFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                {st === 'ALL' ? 'All' : st === 'EMERGENCY_WITHDRAWN' ? 'Emergency' : st.charAt(0) + st.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">Position ID</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Plan · APR</th>
                <th className="py-3 px-4">Subscribed</th>
                <th className="py-3 px-4 text-right">Principal</th>
                <th className="py-3 px-4 text-right">Months Paid</th>
                <th className="py-3 px-4 text-right">Profit Balance</th>
                <th className="py-3 px-4 text-right">Profit Paid</th>
                <th className="py-3 px-4">Next Payout</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredStaking.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 px-4 text-center text-slate-500">
                    No staking positions match this filter.
                  </td>
                </tr>
              ) : (
                filteredStaking.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono-tabular font-medium text-slate-900">{s.id}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{s.user_name}</div>
                      <div className="text-slate-500 font-mono-tabular">{s.user_email}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 font-mono-tabular">
                      {s.package_code} · {s.annual_roi_pct}% APR
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                      ${formatUsd(s.principal_amount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular">
                      {s.months_paid ?? Math.min(s.duration_months, (s.quarters_paid || 0) * 3)} / {s.duration_months}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-medium text-blue-600">
                      ${formatUsd(s.accrued_profit || 0)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-emerald-600">
                      +${formatUsd(s.total_profit_paid)}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-slate-500">{formatDateTime(s.next_payout_at)}</td>
                    <td className="py-3 px-4 font-medium">
                      {s.status === 'EMERGENCY_WITHDRAWN' ? (
                        <span className="text-amber-700 font-semibold font-mono-tabular">
                          Emergency (-${formatUsd(s.penalty_amount || 0)})
                        </span>
                      ) : (
                        <span className={s.status === 'ACTIVE' ? 'text-blue-600' : 'text-emerald-600'}>{s.status}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

interface PresaleUserTicketGroup {
  userId: string;
  userName: string;
  userEmail: string;
  tickets: PresaleTicket[];
}

interface AdminPresaleTabProps {
  data: AdminOverviewData;
  newTokenSym: string;
  setNewTokenSym: (v: string) => void;
  newTokenName: string;
  setNewTokenName: (v: string) => void;
  newLotPrice: string;
  setNewLotPrice: (v: string) => void;
  newTokensPerLot: string;
  setNewTokensPerLot: (v: string) => void;
  newWinPayout: string;
  setNewWinPayout: (v: string) => void;
  newTotalLots: string;
  setNewTotalLots: (v: string) => void;
  ticketFilter: 'ALL' | 'PENDING' | 'WIN' | 'LOSS';
  setTicketFilter: (v: 'ALL' | 'PENDING' | 'WIN' | 'LOSS') => void;
  filteredPresaleTickets: PresaleTicket[];
  runAction: RunActionFn;
}

export const AdminPresaleTab: React.FC<AdminPresaleTabProps> = ({
  data,
  newTokenSym,
  setNewTokenSym,
  newTokenName,
  setNewTokenName,
  newLotPrice,
  setNewLotPrice,
  newTokensPerLot,
  setNewTokensPerLot,
  newWinPayout,
  setNewWinPayout,
  newTotalLots,
  setNewTotalLots,
  ticketFilter,
  setTicketFilter,
  filteredPresaleTickets,
  runAction,
}) => {
  const [newRoundStatus, setNewRoundStatus] = useState<'OPEN' | 'UPCOMING'>('OPEN');
  const [newLotSize, setNewLotSize] = useState('500');
  const [publishing, setPublishing] = useState(false);
  const [drawRoundId, setDrawRoundId] = useState('');
  const [drawWinningNumber, setDrawWinningNumber] = useState('');
  const [newListingDate, setNewListingDate] = useState(() => {
    const d = new Date(Date.now() + 30 * 86400000);
    return d.toISOString().split('T')[0];
  });
  const [expandedUserIds, setExpandedUserIds] = useState<string[]>([]);

  const presaleTicketGroups = useMemo(() => {
    const grouped = new Map<string, PresaleUserTicketGroup>();
    for (const ticket of filteredPresaleTickets) {
      const existing = grouped.get(ticket.user_id);
      if (existing) {
        existing.tickets.push(ticket);
      } else {
        grouped.set(ticket.user_id, {
          userId: ticket.user_id,
          userName: ticket.user_name || 'Unknown user',
          userEmail: ticket.user_email || 'No email',
          tickets: [ticket],
        });
      }
    }
    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        tickets: [...group.tickets].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }))
      .sort((a, b) => b.tickets.length - a.tickets.length || a.userName.localeCompare(b.userName));
  }, [filteredPresaleTickets]);

  const toggleUserTickets = (userId: string) => {
    setExpandedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  };

  const handleLotSizeChange = (val: string) => {
    setNewLotSize(val);
    setNewTokensPerLot(val);
  };

  const calcTotalLots = Number(newTotalLots) || 0;
  const oneLotCost = Number(newLotPrice) || 0;
  const calcLotSize = Math.max(1, Number(newLotSize) || 500);
  const calcSharePrice = Number((oneLotCost / calcLotSize).toFixed(4));
  const calcTotalIssue = Number((calcTotalLots * oneLotCost).toFixed(2));
  const calcWinPayout = Number(newWinPayout) || 0;
  const winMultiplier = oneLotCost > 0 ? (calcWinPayout / oneLotCost).toFixed(1) : '0';
  const adminNetworkFee = data.platformSettings?.presaleNetworkFeeUsd ?? 0.10;

  return (
    <div className="space-y-5">
      {/* Launch New Presale Round Form */}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (publishing) return;
          setPublishing(true);
          try {
            await runAction(async () => {
              await apiFetch('/api/admin/presale/rounds', {
                method: 'POST',
                body: JSON.stringify({
                  token_symbol: newTokenSym,
                  token_name: newTokenName,
                  lot_size: calcLotSize,
                  one_lot_price: oneLotCost || 500.0,
                  lot_price: calcSharePrice || 1.0,
                  tokens_per_lot: calcLotSize,
                  projected_win_payout: Number(newWinPayout) || 300.0,
                  total_lots: Number(newTotalLots) || 100000,
                  total_issue_size: calcTotalIssue,
                  listing_date: newListingDate,
                  status: newRoundStatus,
                }),
              });
              const createdSym = newTokenSym.toUpperCase();
              setNewTokenSym('');
              setNewTokenName('');
              return `Launched new IPO Share round (${createdSym}) as ${newRoundStatus}.`;
            });
          } finally {
            setPublishing(false);
          }
        }}
        className="border border-slate-200 rounded-xl bg-white p-5 space-y-4"
      >
        <div className="pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Launch New Coin Presale / IPO Round</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure Share Price, Lot Size (tokens per share), Win Payout, and Total Shares (${formatUsd(adminNetworkFee)} network fee per share).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Initial Status:</span>
            <select
              value={newRoundStatus}
              onChange={(e) => setNewRoundStatus(e.target.value as 'OPEN' | 'UPCOMING')}
              className="h-8 px-2.5 border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-800 focus:outline-none focus:border-blue-600"
            >
              <option value="OPEN">OPEN (Active IPO)</option>
              <option value="UPCOMING">UPCOMING (Scheduled)</option>
            </select>
          </div>
        </div>

        {/* Section 1: Company Profile & Schedule */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Stock / Token Symbol</label>
            <input
              type="text"
              required
              placeholder="e.g. BD or REX"
              value={newTokenSym}
              onChange={(e) => setNewTokenSym(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 font-bold uppercase"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Company / Project Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Bangladesh IPO Ltd or Rexzone Amline PNL"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Draw &amp; Listing Date</label>
            <input
              type="date"
              value={newListingDate}
              onChange={(e) => setNewListingDate(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        {/* Section 2: Lot Size, Lot Price, Estimate Win Rate, Supply Lot Size */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Lot Size</label>
            <input
              type="number"
              required
              min="1"
              step="1"
              value={newLotSize}
              onChange={(e) => handleLotSizeChange(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 font-bold"
              placeholder="500"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">{calcLotSize} Shares per 1 Lot</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Lot Price ($)</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={newLotPrice}
              onChange={(e) => setNewLotPrice(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-blue-300 bg-blue-50/20 font-bold text-blue-900 rounded-lg focus:outline-none focus:border-blue-600"
              placeholder="500.00"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">1 Lot = ${formatUsd(oneLotCost)} (${formatUsd(calcSharePrice)}/share)</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Estimate Win Rate</label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={newWinPayout}
              onChange={(e) => setNewWinPayout(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-emerald-300 bg-emerald-50/20 font-bold text-emerald-800 rounded-lg focus:outline-none focus:border-emerald-600"
              placeholder="300.00"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">1 Lot ${formatUsd(calcWinPayout)}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Supply Lot Size</label>
            <input
              type="number"
              required
              min="1"
              step="1"
              value={newTotalLots}
              onChange={(e) => setNewTotalLots(e.target.value)}
              className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 font-bold"
              placeholder="100000"
            />
            <span className="text-[10px] text-slate-500 mt-0.5 block">{calcTotalLots.toLocaleString()} Lots</span>
          </div>
        </div>

        {/* Live Calculation & IPO Summary Preview Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-slate-600">
            <span className="flex items-center gap-1 font-semibold text-slate-900">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              IPO Summary:
            </span>
            <span>
              Lot Price: <strong className="text-slate-900 font-mono-tabular">${formatUsd(calcSharePrice)} × {calcLotSize} = ${formatUsd(oneLotCost)}</strong>
            </span>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span>
              Total Issue: <strong className="text-blue-700 font-mono-tabular">${formatUsd(calcTotalIssue)}</strong>
            </span>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span>
              Win Return: <strong className="text-emerald-700 font-mono-tabular">{winMultiplier}x (+${formatUsd(calcWinPayout)})</strong>
            </span>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span>
              Fee: <strong className="text-slate-900 font-mono-tabular">${formatUsd(adminNetworkFee)}/lot</strong>
            </span>
          </div>

          <button
            type="submit"
            disabled={publishing}
            className="w-full sm:w-auto h-9 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-wait text-white text-xs font-bold rounded-lg transition-colors shadow-xs whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
          >
            {publishing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Process for Publish...</span>
              </>
            ) : (
              <>
                <Coins className="w-3.5 h-3.5" />
                <span>Launch IPO Round</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Active & Historical Presale Rounds */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Active &amp; Historical Presale Rounds</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono-tabular">
            {data.presaleRounds.length} round(s) configured
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">Token / Company</th>
                <th className="py-3 px-3 text-right">Lot Size</th>
                <th className="py-3 px-3 text-right">Lot Price</th>
                <th className="py-3 px-3 text-right">Estimate Win Rate</th>
                <th className="py-3 px-4 text-right">Supply Lot Size</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Round Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {data.presaleRounds.map((r) => {
                const mLot = r.tokens_per_lot || r.lot_size || 500;
                const oneLotCost = Number((mLot * r.lot_price).toFixed(2));
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{r.token_symbol}</div>
                      <div className="text-slate-500 text-[11px] truncate max-w-[160px]">{r.token_name}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-slate-900">
                      {mLot} Shares
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular font-medium text-blue-700">
                      ${formatUsd(oneLotCost)}
                      <div className="text-[10px] text-slate-400">${formatUsd(r.lot_price)}/share</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular text-emerald-600 font-semibold">
                      1 Lot ${formatUsd(r.projected_win_payout)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular">
                      <span className="font-semibold text-slate-900">{r.sold_lots.toLocaleString()}</span>
                      <span className="text-slate-400"> / {r.total_lots.toLocaleString()}</span>
                    </td>
                    <td className="py-3 px-4 font-medium">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'OPEN'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : r.status === 'UPCOMING'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {r.status !== 'OPEN' && (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/presale/rounds/${r.id}/status`, {
                                  method: 'POST',
                                  body: JSON.stringify({ status: 'OPEN' }),
                                });
                                return `Presale round ${r.token_symbol} set to OPEN (Active).`;
                              })
                            }
                            className="px-2.5 py-1.5 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg font-medium whitespace-nowrap"
                          >
                            Open IPO
                          </button>
                        )}
                        {r.status !== 'UPCOMING' && (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/presale/rounds/${r.id}/status`, {
                                  method: 'POST',
                                  body: JSON.stringify({ status: 'UPCOMING' }),
                                });
                                return `Presale round ${r.token_symbol} set to UPCOMING.`;
                              })
                            }
                            className="px-2.5 py-1.5 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-medium whitespace-nowrap"
                          >
                            Set Upcoming
                          </button>
                        )}
                        {r.status !== 'CLOSED' && (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/presale/rounds/${r.id}/status`, {
                                  method: 'POST',
                                  body: JSON.stringify({ status: 'CLOSED' }),
                                });
                                return `Presale round ${r.token_symbol} set to CLOSED (Previous).`;
                              })
                            }
                            className="px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg font-medium whitespace-nowrap"
                          >
                            Close Round
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(`Delete ${r.token_symbol} (${r.id})? Any pending tickets will be refunded and all round history removed.`)) return;
                            runAction(async () => {
                              const res = await apiFetch<{ tokenSymbol: string; refundedCount: number }>(`/api/admin/presale/rounds/${r.id}`, {
                                method: 'DELETE',
                              });
                              return `Deleted presale round ${res.tokenSymbol} (${res.refundedCount} pending ticket(s) refunded).`;
                            });
                          }}
                          className="px-2.5 py-1.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg font-medium whitespace-nowrap"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Presale Draw Tickets Settlement Queue */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Presale Draw Tickets — Settle Win / Loss Results</h2>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'PENDING', 'WIN', 'LOSS'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setTicketFilter(st)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${ticketFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                {st === 'ALL' ? 'All' : st}
              </button>
            ))}
          </div>
        </div>

        {/* 6-Digit Winning Number Draw Control */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const targetRoundId = drawRoundId || data.presaleRounds[0]?.id;
            if (!targetRoundId) return;
            runAction(async () => {
              const res = await apiFetch<{ tokenSymbol: string; winningNumber: string; winCount: number; lossCount: number }>(
                `/api/admin/presale/rounds/${targetRoundId}/draw-number`,
                {
                  method: 'POST',
                  body: JSON.stringify({ winning_number: drawWinningNumber }),
                }
              );
              setDrawWinningNumber('');
              return `Declared #${res.winningNumber} as ${res.tokenSymbol} winner! ${res.winCount} ticket(s) won, ${res.lossCount} ticket(s) 100% refunded.`;
            });
          }}
          className="px-4 py-3 border-b border-slate-200 bg-blue-50/40 flex flex-wrap items-center gap-3 text-xs"
        >
          <span className="font-semibold text-slate-800 whitespace-nowrap">Declare 6-Digit Winning Number:</span>
          <select
            value={drawRoundId || data.presaleRounds[0]?.id || ''}
            onChange={(e) => setDrawRoundId(e.target.value)}
            className="h-8 px-2.5 border border-slate-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-none focus:border-blue-600"
          >
            {data.presaleRounds.map((round) => (
              <option key={round.id} value={round.id}>
                {round.token_symbol} ({round.status})
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            maxLength={6}
            pattern="\d{6}"
            placeholder="6-digit # (click number below)"
            value={drawWinningNumber}
            onChange={(e) => setDrawWinningNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="h-8 w-48 px-3 border border-slate-200 rounded-lg bg-white font-mono-tabular font-bold text-slate-900 focus:outline-none focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={!data.presaleRounds.length || drawWinningNumber.length !== 6}
            className="h-8 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
          >
            Declare Winner &amp; Refund Others
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4 text-right">IPO Rounds</th>
                <th className="py-3 px-4 text-right">Tickets</th>
                <th className="py-3 px-4 text-right">Lots</th>
                <th className="py-3 px-4 text-right">Principal</th>
                <th className="py-3 px-4 text-right">Pending</th>
                <th className="py-3 px-4 text-right">WIN</th>
                <th className="py-3 px-4 text-right">LOSS</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {presaleTicketGroups.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 px-4 text-center text-slate-500">
                    No presale tickets match this filter.
                  </td>
                </tr>
              ) : (
                presaleTicketGroups.map((group) => {
                  const isExpanded = expandedUserIds.includes(group.userId);
                  const roundCount = new Set(group.tickets.map((ticket) => ticket.round_id)).size;
                  const totalLots = group.tickets.reduce((sum, ticket) => sum + Number(ticket.lots_count || 0), 0);
                  const totalPrincipal = group.tickets.reduce((sum, ticket) => sum + Number(ticket.principal_paid || 0), 0);
                  const pendingCount = group.tickets.filter((ticket) => ticket.result === 'PENDING').length;
                  const winCount = group.tickets.filter((ticket) => ticket.result === 'WIN').length;
                  const lossCount = group.tickets.filter((ticket) => ticket.result === 'LOSS').length;
                  return (
                    <React.Fragment key={group.userId}>
                      <tr className="hover:bg-slate-50/60">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{group.userName}</div>
                          <div className="text-slate-500">{group.userEmail}</div>
                          <div className="font-mono-tabular text-[10px] text-slate-400">{group.userId}</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">{roundCount}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">{group.tickets.length}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular">{totalLots}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">${formatUsd(totalPrincipal)}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-blue-600">{pendingCount}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-emerald-600">{winCount}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-amber-600">{lossCount}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => toggleUserTickets(group.userId)}
                            aria-expanded={isExpanded}
                            className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                          >
                            {isExpanded ? 'Hide' : 'View'}
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="w-0 min-w-full">
                            <div className="mb-2 text-xs font-semibold text-slate-700">{group.userName}&apos;s IPO purchases</div>
                            <div className="w-full min-w-0 bg-white text-left">
                              <div className="grid w-full grid-cols-7 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                                <div className="min-w-0 px-3 py-2.5 text-left">IPO / Ticket</div>
                                <div className="min-w-0 px-3 py-2.5 text-left">Purchased</div>
                                <div className="min-w-0 px-3 py-2.5 text-left">6-Digit Lot Numbers</div>
                                <div className="min-w-0 px-3 py-2.5 text-right">Lots</div>
                                <div className="min-w-0 px-3 py-2.5 text-right">Principal</div>
                                <div className="min-w-0 px-3 py-2.5 text-left">Result</div>
                                <div className="min-w-0 px-3 py-2.5 text-right">Admin Settlement</div>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {group.tickets.map((ticket) => (
                                  <div key={ticket.id} className="grid w-full grid-cols-7">
                                    <div className="min-w-0 px-3 py-3">
                                      <div className="font-semibold text-slate-900">{ticket.token_symbol}</div>
                                      <div className="break-all font-mono-tabular text-[10px] text-slate-500">{ticket.id}</div>
                                    </div>
                                    <div className="min-w-0 px-3 py-3 font-mono-tabular text-slate-500">{formatDateTime(ticket.created_at)}</div>
                                    <div className="min-w-0 px-3 py-3">
                                      {ticket.ticket_numbers && ticket.ticket_numbers.length > 0 ? (
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                          {ticket.ticket_numbers.map((num, index) => {
                                            const isWinningNum = Boolean(ticket.winning_number && ticket.winning_number === num);
                                            return (
                                              <React.Fragment key={num}>
                                                {index > 0 && <span className="text-slate-300">,</span>}
                                                <button
                                                  type="button"
                                                  title={ticket.result === 'PENDING' ? 'Click to select as winning number' : undefined}
                                                  onClick={() => {
                                                    if (ticket.result === 'PENDING') {
                                                      setDrawRoundId(ticket.round_id);
                                                      setDrawWinningNumber(num);
                                                    }
                                                  }}
                                                  className={`font-mono-tabular font-semibold ${
                                                    isWinningNum
                                                      ? 'text-emerald-700'
                                                      : ticket.result === 'PENDING'
                                                      ? 'text-blue-700 hover:underline'
                                                      : 'text-slate-600'
                                                  }`}
                                                >
                                                  #{num}
                                                </button>
                                              </React.Fragment>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <span className="text-slate-400">—</span>
                                      )}
                                    </div>
                                    <div className="min-w-0 px-3 py-3 text-right font-mono-tabular">{ticket.lots_count}</div>
                                    <div className="min-w-0 px-3 py-3 text-right font-mono-tabular font-semibold text-slate-900">
                                      ${formatUsd(ticket.principal_paid)}
                                      <div className="text-[10px] font-normal text-slate-400">Fee ${formatUsd(ticket.fee_paid)}</div>
                                    </div>
                                    <div className="min-w-0 px-3 py-3 font-semibold">
                                      <span
                                        className={
                                          ticket.result === 'WIN'
                                            ? 'text-emerald-600'
                                            : ticket.result === 'LOSS'
                                            ? 'text-amber-600'
                                            : 'text-blue-600'
                                        }
                                      >
                                        {ticket.result}
                                      </span>
                                    </div>
                                    <div className="min-w-0 px-3 py-3 text-right">
                                      {ticket.result === 'PENDING' ? (
                                        <div className="inline-flex max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              runAction(async () => {
                                                await apiFetch(`/api/admin/presale/tickets/${ticket.id}/settle`, {
                                                  method: 'POST',
                                                  body: JSON.stringify({ result: 'WIN' }),
                                                });
                                                return `Settled ${ticket.id} as WIN — credited tokens + profit to ${ticket.user_name}'s Claimable Wallet.`;
                                              })
                                            }
                                            className="font-semibold text-emerald-700 hover:underline"
                                          >
                                            WIN
                                          </button>
                                          <span className="text-slate-300">/</span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              runAction(async () => {
                                                await apiFetch(`/api/admin/presale/tickets/${ticket.id}/settle`, {
                                                  method: 'POST',
                                                  body: JSON.stringify({ result: 'LOSS' }),
                                                });
                                                return `Settled ${ticket.id} as LOSS — refunded $${formatUsd(ticket.principal_paid)} principal (excl. $${formatUsd(ticket.fee_paid)} fee) to Claimable Wallet.`;
                                              })
                                            }
                                            className="font-semibold text-amber-700 hover:underline"
                                          >
                                            Refund
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="font-mono-tabular text-slate-500">Paid ${formatUsd(ticket.payout_amount)}</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
