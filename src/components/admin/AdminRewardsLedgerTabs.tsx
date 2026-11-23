import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Search, ShieldAlert } from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../../lib/api';
import { SelectDropdown } from '../SelectDropdown';
import type { JackpotTicket, LedgerEntry, ReferralItem } from '../../types';
import type { AdminOverviewData, JackpotStats, RunActionFn } from './adminTypes';

interface AdminRewardsTabProps {
  data: AdminOverviewData;
  rewardsSubTab: 'JACKPOT' | 'REFERRALS';
  setRewardsSubTab: (v: 'JACKPOT' | 'REFERRALS') => void;
  jackpotStats: JackpotStats;
  poolInput: string;
  setPoolInput: (v: string) => void;
  quarterInput: string;
  setQuarterInput: (v: string) => void;
  jackpotTitleInput: string;
  setJackpotTitleInput: (v: string) => void;
  jackpotTicketPriceInput: string;
  setJackpotTicketPriceInput: (v: string) => void;
  jackpotDrawAtInput: string;
  setJackpotDrawAtInput: (v: string) => void;
  jackpotTicketFilter: 'ALL' | 'ACTIVE' | 'WON' | 'LOST';
  setJackpotTicketFilter: (v: 'ALL' | 'ACTIVE' | 'WON' | 'LOST') => void;
  jackpotSearch: string;
  setJackpotSearch: (v: string) => void;
  filteredJackpotTickets: JackpotTicket[];
  referralFilter: 'ALL' | 'PENDING_DEPOSIT' | 'CREDITED_CLAIMABLE';
  setReferralFilter: (v: 'ALL' | 'PENDING_DEPOSIT' | 'CREDITED_CLAIMABLE') => void;
  filteredReferrals: ReferralItem[];
  runAction: RunActionFn;
}

function shortenHash(hash?: string | null): string {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export const AdminRewardsTab: React.FC<AdminRewardsTabProps> = ({
  data,
  rewardsSubTab,
  setRewardsSubTab,
  jackpotStats,
  poolInput,
  setPoolInput,
  quarterInput,
  setQuarterInput,
  jackpotTitleInput,
  setJackpotTitleInput,
  jackpotTicketPriceInput,
  setJackpotTicketPriceInput,
  jackpotDrawAtInput,
  setJackpotDrawAtInput,
  jackpotTicketFilter,
  setJackpotTicketFilter,
  jackpotSearch,
  setJackpotSearch,
  filteredJackpotTickets,
  referralFilter,
  setReferralFilter,
  filteredReferrals,
  runAction,
}) => {
  const [roundInspectorTab, setRoundInspectorTab] = useState<'ROUNDS' | 'LEADERBOARD'>('ROUNDS');
  const [drawMethod, setDrawMethod] = useState<'BY_NUMBER' | 'AUTO_RANDOM'>('BY_NUMBER');
  const [winningTicketInput, setWinningTicketInput] = useState('');
  const [confirmExecuteOpen, setConfirmExecuteOpen] = useState(false);
  const [copiedDrawId, setCopiedDrawId] = useState<string | null>(null);

  const openDrawPool = Number(jackpotStats.openDraw?.prize_pool ?? 0);
  const seedSharePct =
    openDrawPool > 0 ? Math.min(100, Math.max(0, (jackpotStats.basePoolUsd / openDrawPool) * 100)) : 100;

  const activeTicketEntries = useMemo(() => {
    const openId = jackpotStats.openDraw?.id;
    if (!openId) return [];
    const list: { ticketNumber: string; ticket: JackpotTicket }[] = [];
    for (const t of data.jackpotTickets || []) {
      if (t.draw_id !== openId || t.status !== 'ACTIVE') continue;
      for (const num of t.ticket_numbers || []) {
        list.push({ ticketNumber: num, ticket: t });
      }
    }
    return list;
  }, [data.jackpotTickets, jackpotStats.openDraw?.id]);

  const normalizedWinningNumber = winningTicketInput.trim().replace(/^#/, '');
  const matchedWinningEntry = useMemo(() => {
    if (!normalizedWinningNumber) return null;
    return activeTicketEntries.find((item) => item.ticketNumber === normalizedWinningNumber) || null;
  }, [activeTicketEntries, normalizedWinningNumber]);

  const activeRoundLeaderboard = useMemo(() => {
    const openId = jackpotStats.openDraw?.id;
    if (!openId) return [];
    const activeTickets = (data.jackpotTickets || []).filter((t) => t.draw_id === openId);
    const totalSold = activeTickets.reduce((sum, t) => sum + Number(t.ticket_count || 0), 0);

    const grouped = new Map<
      string,
      {
        userId: string;
        userName: string;
        userEmail: string;
        tickets: number;
        spent: number;
      }
    >();

    for (const t of activeTickets) {
      const existing = grouped.get(t.user_id) || {
        userId: t.user_id,
        userName: t.user_name || t.user_id,
        userEmail: t.user_email || '',
        tickets: 0,
        spent: 0,
      };
      existing.tickets += Number(t.ticket_count || 0);
      existing.spent += Number(t.cost_usd || 0);
      grouped.set(t.user_id, existing);
    }

    return Array.from(grouped.values())
      .sort((a, b) => b.tickets - a.tickets || b.spent - a.spent)
      .slice(0, 20)
      .map((item, idx) => ({
        rank: idx + 1,
        ...item,
        sharePct: totalSold > 0 ? Number(((item.tickets / totalSold) * 100).toFixed(2)) : 0,
      }));
  }, [data.jackpotTickets, jackpotStats.openDraw?.id]);

  const handleCopyProof = async (drawId: string, hash?: string | null) => {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedDrawId(drawId);
      setTimeout(() => setCopiedDrawId((prev) => (prev === drawId ? null : prev)), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleExportTicketsCsv = () => {
    const header = [
      'Ticket ID',
      'Draw ID',
      'Quarter',
      'User Name',
      'User Email',
      'Ticket Qty',
      'Generated Ticket Numbers',
      'Winning Ticket #',
      'Cost USDT',
      'Prize Won USDT',
      'Status',
      'Purchased At',
    ];
    const rows = filteredJackpotTickets.map((t) => [
      t.id,
      t.draw_id,
      `"${(t.quarter_label || '').replace(/"/g, '""')}"`,
      `"${(t.user_name || '').replace(/"/g, '""')}"`,
      t.user_email || '',
      String(t.ticket_count),
      `"${(t.ticket_numbers || []).map((n) => `#${n}`).join(' ')}"`,
      t.winning_ticket_number ? `#${t.winning_ticket_number}` : '',
      Number(t.cost_usd || 0).toFixed(2),
      Number(t.prize_won || 0).toFixed(2),
      t.status,
      t.created_at,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jackpot-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Jackpot &amp; Referral Rewards Control</h2>
          <p className="text-xs text-slate-500">
            Manage the 3-month scheduled jackpot cycle, pool seeding, draw proofs, and $15.00 partner referral bonuses.
          </p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setRewardsSubTab('JACKPOT')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              rewardsSubTab === 'JACKPOT' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Quarterly Jackpot ({jackpotStats.activeTicketsSold})
          </button>
          <button
            type="button"
            onClick={() => setRewardsSubTab('REFERRALS')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              rewardsSubTab === 'REFERRALS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Referral Program ({data.referrals.length})
          </button>
        </div>
      </div>

      {rewardsSubTab === 'JACKPOT' ? (
        <>
          {/* Hairline Jackpot KPI Strip */}
          <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-4">
              <div className="text-xs text-slate-500">Active Quarterly Jackpot Pool</div>
              <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
                ${formatUsd(openDrawPool)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
                Seed ${formatUsd(jackpotStats.basePoolUsd)} + Ticket 80% ${formatUsd(jackpotStats.ticketContributionUsd)}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs text-slate-500">Active Tickets &amp; Participants</div>
              <div className="mt-1 text-xl font-bold font-mono-tabular text-blue-600">
                {jackpotStats.activeTicketsSold}{' '}
                <span className="text-xs font-medium text-slate-500">
                  ({jackpotStats.uniqueParticipantsCount} users)
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
                {jackpotStats.openDraw
                  ? `${jackpotStats.openDraw.quarter_label} · ${jackpotStats.daysRemaining}d remaining`
                  : 'No active round'}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs text-slate-500">Active Sales &amp; All-Time Treasury Fee</div>
              <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
                ${formatUsd(jackpotStats.activeTicketRevenueUsd)}
              </div>
              <div className="mt-1 text-[11px] text-emerald-600 font-mono-tabular font-medium">
                All-Time 20% Treasury Fee: +${formatUsd(jackpotStats.platformFeeUsd)}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs text-slate-500">Completed 3-Month Jackpots</div>
              <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
                ${formatUsd(jackpotStats.totalPrizesPaid)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
                {jackpotStats.completedCount} completed draw(s) settled
              </div>
            </div>
          </div>

          {/* Active Pool Funding Composition Strip */}
          <div className="border border-slate-200 rounded-xl bg-white px-5 py-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800">Active Round Pool Composition</span>
              <div className="flex flex-wrap items-center gap-3 font-mono-tabular text-slate-600">
                <span>
                  Base Seed: <strong className="text-slate-900">${formatUsd(jackpotStats.basePoolUsd)}</strong> (
                  {seedSharePct.toFixed(1)}%)
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  Ticket Pool (80%):{' '}
                  <strong className="text-emerald-600">+${formatUsd(jackpotStats.ticketContributionUsd)}</strong> (
                  {(100 - seedSharePct).toFixed(1)}%)
                </span>
                <span className="text-slate-300">·</span>
                <span>
                  Unit Price:{' '}
                  <strong className="text-slate-900">${formatUsd(jackpotStats.openDraw?.ticket_price ?? 1)}</strong>
                </span>
              </div>
            </div>
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <div className="bg-slate-900 h-full transition-all duration-300" style={{ width: `${seedSharePct}%` }} />
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${Math.max(0, 100 - seedSharePct)}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Left: Round Schedule, Pool Control & Safe Two-Step Execution */}
            <div className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-5 flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div className="pb-3.5 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">3-Month Jackpot Schedule &amp; Pool</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure round metadata, base prize pool, ticket pricing, or settle the active draw safely.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Jackpot Round Title</label>
                  <input
                    type="text"
                    value={jackpotTitleInput}
                    onChange={(e) => setJackpotTitleInput(e.target.value)}
                    className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Quarter Label</label>
                    <input
                      type="text"
                      value={quarterInput}
                      onChange={(e) => setQuarterInput(e.target.value)}
                      className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Prize Pool ($)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={poolInput}
                      onChange={(e) => setPoolInput(e.target.value)}
                      className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Ticket Price ($)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={jackpotTicketPriceInput}
                      onChange={(e) => setJackpotTicketPriceInput(e.target.value)}
                      className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-500">Quick Pool Target:</span>
                  <div className="flex items-center gap-1.5">
                    {[2500, 5000, 10000, 25000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setPoolInput(String(preset))}
                        className={`px-2 py-1 rounded-md border font-mono-tabular transition-colors whitespace-nowrap ${
                          Number(poolInput) === preset
                            ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        ${(preset / 1000).toFixed(preset % 1000 === 0 ? 0 : 1)}k
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700">Scheduled Draw Date (3-Month Cycle)</label>
                    <button
                      type="button"
                      onClick={() => {
                        const dt = new Date();
                        dt.setMonth(dt.getMonth() + 3);
                        const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
                          .toISOString()
                          .slice(0, 16);
                        setJackpotDrawAtInput(localIso);
                      }}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      Set +3 Months from Now
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={jackpotDrawAtInput}
                    onChange={(e) => setJackpotDrawAtInput(e.target.value)}
                    className="w-full h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-200">
                {/* Draw Settlement Mode Selector */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">Win / Loss Settlement Mode</span>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setDrawMethod('BY_NUMBER');
                          setConfirmExecuteOpen(false);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                          drawMethod === 'BY_NUMBER'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        By Ticket #
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDrawMethod('AUTO_RANDOM');
                          setConfirmExecuteOpen(false);
                        }}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                          drawMethod === 'AUTO_RANDOM'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Auto CSPRNG
                      </button>
                    </div>
                  </div>

                  {drawMethod === 'BY_NUMBER' ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={winningTicketInput}
                          onChange={(e) => {
                            setWinningTicketInput(e.target.value);
                            setConfirmExecuteOpen(false);
                          }}
                          placeholder="Enter ticket # (e.g. 482917)"
                          className="h-9 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                        />
                        <SelectDropdown
                          value={matchedWinningEntry ? matchedWinningEntry.ticketNumber : ''}
                          onChange={(val) => {
                            setWinningTicketInput(val);
                            setConfirmExecuteOpen(false);
                          }}
                          options={[
                            {
                              value: '',
                              label:
                                activeTicketEntries.length > 0
                                  ? `Select from ${activeTicketEntries.length} active #`
                                  : 'No active ticket numbers',
                            },
                            ...activeTicketEntries.map((item) => ({
                              value: item.ticketNumber,
                              label: `#${item.ticketNumber} · ${item.ticket.user_name || item.ticket.user_id}`,
                            })),
                          ]}
                        />
                      </div>

                      {normalizedWinningNumber ? (
                        matchedWinningEntry ? (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-900 space-y-0.5">
                            <div className="font-semibold">
                              Matched Winner: #{matchedWinningEntry.ticketNumber} ({matchedWinningEntry.ticket.user_name})
                            </div>
                            <div className="text-[11px] font-mono-tabular text-emerald-700">
                              {matchedWinningEntry.ticket.user_email} · Order {matchedWinningEntry.ticket.id} · All other
                              active tickets mark LOST
                            </div>
                          </div>
                        ) : (
                          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                            Ticket number #{normalizedWinningNumber} does not match any active ticket in this round.
                          </div>
                        )
                      ) : (
                        <div className="text-[11px] text-slate-500">
                          Enter a ticket number above or click any number badge in the Audit Table below to declare Win/Loss.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-slate-50/70 rounded-lg px-3 py-2 text-[11px] text-slate-600">
                      Cryptographic CSPRNG randomly selects one winning ticket number across all active tickets &amp;
                      qualified accounts, marking the winner WON and others LOST.
                    </div>
                  )}
                </div>

                {confirmExecuteOpen ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 space-y-3">
                    <div className="flex items-start gap-2 text-xs text-amber-900">
                      <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">
                          {drawMethod === 'BY_NUMBER' && matchedWinningEntry
                            ? `Confirm Winner Declaration · Ticket #${matchedWinningEntry.ticketNumber}`
                            : 'Confirm Immediate Auto Draw Execution'}
                        </div>
                        <div className="text-amber-800 mt-0.5">
                          {drawMethod === 'BY_NUMBER' && matchedWinningEntry ? (
                            <>
                              Ticket <span className="font-mono-tabular font-semibold">#{matchedWinningEntry.ticketNumber}</span>{' '}
                              ({matchedWinningEntry.ticket.user_name}) will be declared <strong>WON</strong> (+$
                              <span className="font-mono-tabular font-semibold">{formatUsd(openDrawPool)}</span> to
                              Claimable Wallet) and all other active tickets in{' '}
                              <span className="font-mono-tabular font-semibold">
                                {jackpotStats.openDraw?.quarter_label || quarterInput}
                              </span>{' '}
                              will be marked <strong>LOST</strong>.
                            </>
                          ) : (
                            <>
                              Settling{' '}
                              <span className="font-mono-tabular font-semibold">
                                {jackpotStats.openDraw?.quarter_label || quarterInput}
                              </span>{' '}
                              will award{' '}
                              <span className="font-mono-tabular font-semibold">${formatUsd(openDrawPool)}</span> across{' '}
                              <span className="font-mono-tabular font-semibold">{jackpotStats.activeTicketsSold}</span>{' '}
                              tickets and automatically open the next 3-month round.
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmExecuteOpen(false)}
                        className="flex-1 h-9 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg whitespace-nowrap"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const targetWinNumber =
                            drawMethod === 'BY_NUMBER' && matchedWinningEntry
                              ? matchedWinningEntry.ticketNumber
                              : undefined;
                          setConfirmExecuteOpen(false);
                          runAction(async () => {
                            const res = await apiFetch<{
                              winnerName: string;
                              prizePool: number;
                              winningTicketNumber?: string | null;
                              nextQuarterLabel: string;
                              drawHash?: string;
                            }>('/api/admin/lucky-draw/execute', {
                              method: 'POST',
                              body: JSON.stringify(targetWinNumber ? { winning_ticket_number: targetWinNumber } : {}),
                            });
                            setWinningTicketInput('');
                            return `3-Month Jackpot won by ${res.winnerName}${
                              res.winningTicketNumber ? ` (Ticket #${res.winningTicketNumber})` : ''
                            } — $${formatUsd(res.prizePool)} credited${
                              res.drawHash ? ` · Proof ${res.drawHash.slice(0, 12)}` : ''
                            }. Opened ${res.nextQuarterLabel} cycle.`;
                          });
                        }}
                        className="flex-1 h-9 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                      >
                        Confirm Win/Loss Draw
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        runAction(async () => {
                          await apiFetch('/api/admin/lucky-draw/update-pool', {
                            method: 'POST',
                            body: JSON.stringify({
                              title: jackpotTitleInput,
                              quarter_label: quarterInput,
                              prize_pool: Number(poolInput),
                              ticket_price: Number(jackpotTicketPriceInput),
                              draw_at: jackpotDrawAtInput ? new Date(jackpotDrawAtInput).toISOString() : undefined,
                            }),
                          });
                          return `Saved 3-month Jackpot configuration (${quarterInput} · Pool $${formatUsd(
                            Number(poolInput)
                          )}).`;
                        })
                      }
                      className="flex-1 h-10 border border-slate-200 hover:bg-slate-50 text-slate-900 text-xs font-semibold rounded-lg whitespace-nowrap"
                    >
                      Save Schedule &amp; Pool
                    </button>
                    <button
                      type="button"
                      disabled={!jackpotStats.openDraw || (drawMethod === 'BY_NUMBER' && !matchedWinningEntry)}
                      onClick={() => setConfirmExecuteOpen(true)}
                      className="flex-1 h-10 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                    >
                      {drawMethod === 'BY_NUMBER'
                        ? matchedWinningEntry
                          ? `Declare #${matchedWinningEntry.ticketNumber} Winner`
                          : 'Select Winning Ticket #'
                        : 'Execute Auto CSPRNG Draw'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Dual Tab Inspector (Quarterly Rounds | Pool Leaderboard) */}
            <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  {roundInspectorTab === 'ROUNDS'
                    ? 'Quarterly Jackpot Rounds'
                    : 'Active Round Concentration Leaderboard'}
                </h2>
                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setRoundInspectorTab('ROUNDS')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      roundInspectorTab === 'ROUNDS'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Quarterly Rounds ({data.luckyDraws.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoundInspectorTab('LEADERBOARD')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      roundInspectorTab === 'LEADERBOARD'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Pool Leaderboard ({activeRoundLeaderboard.length})
                  </button>
                </div>
              </div>

              {roundInspectorTab === 'ROUNDS' ? (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-4">Quarter / Title</th>
                        <th className="py-2.5 px-4 text-right">Sold · Users</th>
                        <th className="py-2.5 px-4 text-right">Prize Pool</th>
                        <th className="py-2.5 px-4">Winner</th>
                        <th className="py-2.5 px-4">Proof Hash</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-4 text-right">Draw Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {data.luckyDraws.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900">{d.quarter_label}</div>
                            <div className="text-slate-500">{d.title || 'Quarterly Jackpot'}</div>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                            {d.tickets_sold ?? 0}
                            {typeof d.unique_participants === 'number' && (
                              <span className="text-slate-400"> · {d.unique_participants}u</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                            ${formatUsd(d.prize_pool)}
                          </td>
                          <td className="py-2.5 px-4 font-mono-tabular text-slate-600">
                            <div>{d.winner_email || 'Awaiting 3M Draw'}</div>
                            {d.winning_ticket_number && (
                              <div className="text-[11px] font-semibold text-emerald-700">
                                Ticket #{d.winning_ticket_number}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            {d.draw_hash ? (
                              <button
                                type="button"
                                onClick={() => handleCopyProof(d.id, d.draw_hash)}
                                title={d.draw_hash}
                                className="inline-flex items-center gap-1 font-mono-tabular text-slate-600 hover:text-blue-600"
                              >
                                <span>{shortenHash(d.draw_hash)}</span>
                                {copiedDrawId === d.id ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3 text-slate-400" />
                                )}
                              </button>
                            ) : (
                              <span className="font-mono-tabular text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-medium">
                            <span className={d.status === 'OPEN' ? 'text-blue-600' : 'text-emerald-600'}>
                              {d.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-500 whitespace-nowrap">
                            {formatDateTime(d.draw_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-4 w-14">Rank</th>
                        <th className="py-2.5 px-4">Account</th>
                        <th className="py-2.5 px-4 text-right">Tickets</th>
                        <th className="py-2.5 px-4 text-right">Spent</th>
                        <th className="py-2.5 px-4 text-right">Ticket Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {activeRoundLeaderboard.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                            No ticket purchases recorded yet for the active round.
                          </td>
                        </tr>
                      ) : (
                        activeRoundLeaderboard.map((row) => (
                          <tr key={row.userId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 font-mono-tabular font-bold text-slate-900">#{row.rank}</td>
                            <td className="py-2.5 px-4">
                              <div className="font-medium text-slate-900">{row.userName}</div>
                              <div className="font-mono-tabular text-slate-500">{row.userEmail || row.userId}</div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-tabular font-semibold text-blue-600">
                              {row.tickets}x
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-tabular text-slate-900">
                              ${formatUsd(row.spent)}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <div className="inline-flex items-center justify-end gap-2">
                                <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-blue-600"
                                    style={{ width: `${Math.min(100, row.sharePct)}%` }}
                                  />
                                </div>
                                <span className="font-mono-tabular font-semibold text-slate-900 w-12 text-right">
                                  {row.sharePct.toFixed(2)}%
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
            </div>
          </div>

          {/* Unified Ticket Audit Card */}
          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Jackpot Ticket Entries Audit</h2>
                <p className="text-xs text-slate-500">Every ticket purchased across active and past 3-month jackpot cycles.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['ALL', 'ACTIVE', 'WON', 'LOST'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setJackpotTicketFilter(st)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        jackpotTicketFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={jackpotSearch}
                    onChange={(e) => setJackpotSearch(e.target.value)}
                    placeholder="Search user, ticket #, quarter..."
                    className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExportTicketsCsv}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4">Ticket ID · Quarter</th>
                    <th className="py-3 px-4">Participant</th>
                    <th className="py-3 px-4">Generated Ticket Numbers</th>
                    <th className="py-3 px-4 text-right">Qty / Cost</th>
                    <th className="py-3 px-4 text-right">Prize Won</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Purchased</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {filteredJackpotTickets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                        No jackpot tickets match your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredJackpotTickets.map((t) => {
                      const isActiveInOpen = t.status === 'ACTIVE' && t.draw_id === jackpotStats.openDraw?.id;
                      return (
                        <tr key={t.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className="font-mono-tabular font-medium text-slate-900">{t.id}</div>
                            <div className="text-slate-500 font-semibold">{t.quarter_label}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900">{t.user_name}</div>
                            <div className="text-slate-500 font-mono-tabular">{t.user_email}</div>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            {t.ticket_numbers && t.ticket_numbers.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {t.ticket_numbers.map((num) => {
                                  const isWinNum = t.status === 'WON' && t.winning_ticket_number === num;
                                  const isSelected = normalizedWinningNumber === num;
                                  if (isActiveInOpen) {
                                    return (
                                      <button
                                        key={num}
                                        type="button"
                                        title={`Select #${num} as Winning Ticket Number`}
                                        onClick={() => {
                                          setDrawMethod('BY_NUMBER');
                                          setWinningTicketInput(num);
                                          setConfirmExecuteOpen(true);
                                        }}
                                        className={`px-1.5 py-0.5 text-[11px] font-mono-tabular rounded border transition-colors ${
                                          isSelected
                                            ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                                            : 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50 text-slate-800'
                                        }`}
                                      >
                                        #{num}
                                      </button>
                                    );
                                  }
                                  return (
                                    <span
                                      key={num}
                                      className={`px-1.5 py-0.5 text-[11px] font-mono-tabular rounded border ${
                                        isWinNum
                                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold'
                                          : 'border-slate-200 bg-slate-50 text-slate-600'
                                      }`}
                                    >
                                      #{num}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-slate-400 font-mono-tabular">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                            <div className="font-semibold text-blue-600">{t.ticket_count}x</div>
                            <div className="text-slate-900">${formatUsd(t.cost_usd)}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap">
                            {t.prize_won > 0 ? (
                              <div>
                                <div className="text-emerald-600">+${formatUsd(t.prize_won)}</div>
                                {t.winning_ticket_number && (
                                  <div className="text-[11px] font-normal text-emerald-700">
                                    #{t.winning_ticket_number}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">$0.00</span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-semibold whitespace-nowrap">
                            <span
                              className={
                                t.status === 'WON'
                                  ? 'text-emerald-600'
                                  : t.status === 'ACTIVE'
                                  ? 'text-blue-600'
                                  : 'text-slate-500'
                              }
                            >
                              {t.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-tabular text-slate-500 whitespace-nowrap">
                            {formatDateTime(t.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        /* Unified Referral Audit Card */
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Referral Bonus Program Audit</h2>
              <p className="text-xs text-slate-500">
                $15.00 USDT bonus auto-credits upon referred user’s qualification ($500 balance &amp; 10 KYC), or credit manually.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['ALL', 'All Referrals'],
                  ['PENDING_DEPOSIT', 'Pending Qualification'],
                  ['CREDITED_CLAIMABLE', 'Credited'],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setReferralFilter(st)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    referralFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Referral ID</th>
                  <th className="py-3 px-4">Referrer</th>
                  <th className="py-3 px-4">Referred User</th>
                  <th className="py-3 px-4 text-right">Bonus</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Admin Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredReferrals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                      No referral records match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredReferrals.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono-tabular font-medium text-slate-900">{r.id}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{r.referrer_name || r.referrer_id}</div>
                        <div className="text-slate-500 font-mono-tabular">{r.referrer_email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{r.referred_name}</div>
                        <div className="text-slate-500 font-mono-tabular">{r.referred_email}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                        ${formatUsd(r.bonus_amount)}
                      </td>
                      <td className="py-3 px-4 font-medium">
                        <span className={r.status === 'CREDITED_CLAIMABLE' ? 'text-emerald-600' : 'text-amber-600'}>
                          {r.status === 'CREDITED_CLAIMABLE' ? 'Credited to Claimable' : 'Pending $500 / 10 Verified'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {r.status === 'PENDING_DEPOSIT' ? (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/referrals/${r.id}/credit`, { method: 'POST' });
                                return `Credited $${formatUsd(r.bonus_amount)} referral bonus to ${
                                  r.referrer_name || r.referrer_id
                                }'s Claimable Wallet.`;
                              })
                            }
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium whitespace-nowrap"
                          >
                            Credit Bonus
                          </button>
                        ) : (
                          <span className="text-slate-400 font-mono-tabular">
                            {r.credited_at ? formatDateTime(r.credited_at) : 'Paid'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface AdminTransactionsTabProps {
  txWalletFilter: 'ALL' | 'MAIN' | 'CLAIMABLE';
  setTxWalletFilter: (v: 'ALL' | 'MAIN' | 'CLAIMABLE') => void;
  txTypeFilter: string;
  setTxTypeFilter: (v: string) => void;
  txTypes: string[];
  txSearch: string;
  setTxSearch: (v: string) => void;
  filteredTransactions: LedgerEntry[];
  exportTransactionsCsv: () => void;
}

export const AdminTransactionsTab: React.FC<AdminTransactionsTabProps> = ({
  txWalletFilter,
  setTxWalletFilter,
  txTypeFilter,
  setTxTypeFilter,
  txTypes,
  txSearch,
  setTxSearch,
  filteredTransactions,
  exportTransactionsCsv,
}) => {
  return (
    <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'MAIN', 'CLAIMABLE'] as const).map((wt) => (
              <button
                key={wt}
                type="button"
                onClick={() => setTxWalletFilter(wt)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  txWalletFilter === wt ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {wt === 'ALL' ? 'All Wallets' : wt === 'MAIN' ? 'Main Balance' : 'Claimable Wallet'}
              </button>
            ))}
          </div>

          <div className="w-52">
            <SelectDropdown
              value={txTypeFilter}
              onChange={setTxTypeFilter}
              options={txTypes.map((t) => ({
                value: t,
                label: t === 'ALL' ? 'All Transaction Types' : t,
              }))}
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={txSearch}
              onChange={(e) => setTxSearch(e.target.value)}
              placeholder="Search user, ref ID, description..."
              className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <button
            type="button"
            onClick={exportTransactionsCsv}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
              <th className="py-3 px-4">Timestamp · ID</th>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">Wallet · Type</th>
              <th className="py-3 px-4">Reference</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-right">Balance After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                  No transactions match your search or filter criteria.
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50/60">
                  <td className="py-3 px-4 font-mono-tabular whitespace-nowrap">
                    <div className="text-slate-900">{formatDateTime(tx.created_at)}</div>
                    <div className="text-slate-400">{tx.id}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{tx.user_name}</div>
                    <div className="text-slate-500 font-mono-tabular">{tx.user_email}</div>
                  </td>
                  <td className="py-3 px-4 font-mono-tabular">
                    <span className={tx.wallet_type === 'CLAIMABLE' ? 'text-blue-600 font-medium' : 'text-slate-800 font-medium'}>
                      {tx.wallet_type}
                    </span>{' '}
                    · {tx.tx_type}
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-slate-500">{tx.reference_id}</td>
                  <td className="py-3 px-4 text-slate-700 max-w-md">{tx.description}</td>
                  <td
                    className={`py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                      tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {tx.amount >= 0 ? '+' : ''}${formatUsd(tx.amount)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                    {tx.balance_after === null || tx.balance_after === undefined ? '—' : `$${formatUsd(tx.balance_after)}`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
