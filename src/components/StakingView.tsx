import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  Lock,
  Search,
  ShieldAlert,
  TrendingUp,
  Unlock,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type {
  PlatformSettings,
  StakingDailyLog,
  StakingPosition,
  StakingProfitSummary,
  UserProfile,
} from '../types';

interface StakingViewProps {
  user: UserProfile;
  onRefresh: () => Promise<void>;
}

const PACKAGES = [
  {
    code: '6M' as const,
    label: '6 Months Term',
    audience: 'Short-term liquidity',
    roi: 18,
    months: 6,
    minUsd: 50,
  },
  {
    code: '12M' as const,
    label: '12 Months Term',
    audience: 'Balanced annual yield',
    roi: 20,
    months: 12,
    minUsd: 50,
  },
  {
    code: '24M' as const,
    label: '24 Months Term',
    audience: 'Extended compounding',
    roi: 22,
    months: 24,
    minUsd: 50,
  },
  {
    code: '36M' as const,
    label: '36 Months Term',
    audience: 'Maximum institutional APR',
    roi: 25,
    months: 36,
    minUsd: 50,
  },
];

const EMERGENCY_PENALTY_RATE = 0.005;

type PositionFilter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'EMERGENCY_WITHDRAWN';
type LedgerTab = 'POSITIONS' | 'DAILY_LOGS';

const formatDailyRate = (val: number): string => {
  if (!Number.isFinite(val) || val <= 0) return '0.00';
  return val < 0.1 ? val.toFixed(3) : formatUsd(val);
};

export const StakingView: React.FC<StakingViewProps> = ({ user, onRefresh }) => {
  const [positions, setPositions] = useState<StakingPosition[]>([]);
  const [dailyLogs, setDailyLogs] = useState<StakingDailyLog[]>([]);
  const [profitSummary, setProfitSummary] = useState<StakingProfitSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPkg, setSelectedPkg] = useState<'6M' | '12M' | '24M' | '36M'>('12M');
  const [amount, setAmount] = useState('1000');
  const [profitDestination, setProfitDestination] = useState<'MAIN' | 'CLAIMABLE'>('MAIN');
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>('POSITIONS');
  const [statusFilter, setStatusFilter] = useState<PositionFilter>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);
  const [emergencyTarget, setEmergencyTarget] = useState<StakingPosition | null>(null);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [movingClaimable, setMovingClaimable] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [penaltyRate, setPenaltyRate] = useState(EMERGENCY_PENALTY_RATE);

  const loadPositions = async () => {
    try {
      const [posRes, setRes] = await Promise.all([
        apiFetch<{
          positions: StakingPosition[];
          dailyLogs?: StakingDailyLog[];
          profitSummary?: StakingProfitSummary;
        }>('/api/staking/positions'),
        apiFetch<{ settings: PlatformSettings }>('/api/public/settings').catch(() => ({ settings: null as any })),
      ]);
      setPositions(Array.isArray(posRes.positions) ? posRes.positions : []);
      setDailyLogs(Array.isArray(posRes.dailyLogs) ? posRes.dailyLogs : []);
      if (posRes.profitSummary) setProfitSummary(posRes.profitSummary);
      if (setRes?.settings && typeof setRes.settings.stakingEmergencyPenaltyRate === 'number') {
        setPenaltyRate(setRes.settings.stakingEmergencyPenaltyRate);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPositions().catch(() => {});
  }, []);

  const penaltyPctLabel = `${Number((penaltyRate * 100).toFixed(2))}%`;
  const activePkg = PACKAGES.find((p) => p.code === selectedPkg)!;
  const principalNum = Math.max(0, Number(amount || 0));
  const monthlyPayoutExact = (principalNum * (activePkg.roi / 100)) / 12;
  const monthlyPayout = Number(monthlyPayoutExact.toFixed(2));
  const dailyPayout = monthlyPayoutExact / 30;
  const totalYield = Number((monthlyPayoutExact * activePkg.months).toFixed(2));
  const maturityTotal = Number((principalNum + totalYield).toFixed(2));
  const previewEmergencyPenalty = Number((principalNum * penaltyRate).toFixed(2));
  const previewEmergencyNet = Number((principalNum - previewEmergencyPenalty).toFixed(2));

  const portfolioMetrics = useMemo(() => {
    const activePositions = positions.filter((p) => p.status === 'ACTIVE');
    const activePrincipal = activePositions.reduce((sum, p) => sum + Number(p.principal_amount || 0), 0);
    const totalProfitPaid = positions.reduce((sum, p) => sum + Number(p.total_profit_paid || 0), 0);
    const totalMonthsPaid = positions.reduce(
      (sum, p) => sum + Number(p.months_paid ?? Math.min(p.duration_months, (p.quarters_paid || 0) * 3)),
      0
    );
    const totalAccruedBalance =
      profitSummary?.totalProfitBalance ??
      Number(
        activePositions
          .reduce((sum, p) => sum + Number(p.accrued_profit || 0), 0)
          .toFixed(2)
      );
    const unlockedProfit =
      profitSummary?.unlockedWithdrawableProfit ??
      Number(activePositions.reduce((sum, p) => sum + Number(p.claimable_profit || 0), 0).toFixed(2));
    const lockedDailyProfit =
      profitSummary?.lockedDailyProfit ??
      Number(Math.max(0, totalAccruedBalance - unlockedProfit).toFixed(2));
    const dailyRateTotal =
      profitSummary?.dailyRateTotal ??
      activePositions.reduce(
        (sum, p) => sum + Number(p.daily_profit ?? (p.principal_amount * (p.annual_roi_pct / 100)) / 360),
        0
      );
    const monthlyRateTotal =
      profitSummary?.monthlyRateTotal ??
      activePositions.reduce(
        (sum, p) => sum + Number(p.monthly_profit ?? (p.principal_amount * (p.annual_roi_pct / 100)) / 12),
        0
      );
    const readyCount = activePositions.filter((p) => p.can_claim && Number(p.claimable_profit || 0) > 0).length;
    const nextDaysList = activePositions
      .map((p) => Number(p.days_until_next_payout || 0))
      .filter((d) => d > 0);
    const soonestUnlockDays = nextDaysList.length > 0 ? Math.min(...nextDaysList) : 0;

    return {
      activeCount: activePositions.length,
      activePrincipal: Number(activePrincipal.toFixed(2)),
      totalProfitPaid: Number(totalProfitPaid.toFixed(2)),
      totalMonthsPaid,
      totalProfitBalance: Number((user.profit_balance ?? totalAccruedBalance).toFixed(2)),
      unlockedProfit,
      lockedDailyProfit,
      dailyRateTotal,
      monthlyRateTotal: Number(monthlyRateTotal.toFixed(2)),
      readyCount,
      soonestUnlockDays,
    };
  }, [positions, profitSummary, user.profit_balance]);

  const filteredPositions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return positions.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (q) {
        const matchesId = p.id.toLowerCase().includes(q);
        const matchesPkg = p.package_code.toLowerCase().includes(q);
        if (!matchesId && !matchesPkg) return false;
      }
      return true;
    });
  }, [positions, statusFilter, searchQuery]);

  const setPresetPercent = (pct: number) => {
    const available = Math.max(0, Number(user.main_balance || 0));
    const computed = Math.floor(available * pct * 100) / 100;
    setAmount(computed > 0 ? String(computed) : '50');
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      await apiFetch('/api/staking/subscribe', {
        method: 'POST',
        body: JSON.stringify({ package_code: selectedPkg, amount: principalNum }),
      });
      setNotice({
        type: 'ok',
        text: `Subscribed $${formatUsd(principalNum)} USDT into ${selectedPkg} (${activePkg.roi}% APR) vault. Daily profits accrue to Profit Balance every 24h and unlock monthly.`,
      });
      await Promise.all([loadPositions(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Staking subscription failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleClaimMonthlyProfit = async (pos: StakingPosition) => {
    setNotice(null);
    setClaimingId(pos.id);
    try {
      const res = await apiFetch<{
        creditedAmount: number;
        principalReturned: number;
        totalCredited: number;
        monthsClaimed: number;
        destination: 'MAIN' | 'CLAIMABLE';
      }>(`/api/staking/positions/${pos.id}/claim-profit`, {
        method: 'POST',
        body: JSON.stringify({ destination: profitDestination }),
      });
      const destLabel = res.destination === 'MAIN' ? 'Main Balance' : 'Claimable Wallet';
      setNotice({
        type: 'ok',
        text:
          res.principalReturned > 0
            ? `Vault matured! Withdrew +$${formatUsd(res.creditedAmount)} final profit and $${formatUsd(res.principalReturned)} principal to your ${destLabel}.`
            : `Withdrew +$${formatUsd(res.creditedAmount)} (${res.monthsClaimed} month${res.monthsClaimed > 1 ? 's' : ''} unlocked profit) from ${pos.package_code} vault to your ${destLabel}.`,
      });
      await Promise.all([loadPositions(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to withdraw monthly profit.' });
    } finally {
      setClaimingId(null);
    }
  };

  const handleClaimAllUnlocked = async () => {
    setNotice(null);
    setClaimingAll(true);
    try {
      const res = await apiFetch<{
        vaultsProcessed: number;
        creditedAmount: number;
        principalReturned: number;
        totalCredited: number;
        destination: 'MAIN' | 'CLAIMABLE';
      }>('/api/staking/claim-unlocked', {
        method: 'POST',
        body: JSON.stringify({ destination: profitDestination }),
      });
      const destLabel = res.destination === 'MAIN' ? 'Main Balance' : 'Claimable Wallet';
      setNotice({
        type: 'ok',
        text: `Withdrew +$${formatUsd(res.totalCredited)} unlocked profit across ${res.vaultsProcessed} vault(s) to ${destLabel}. Locked daily profits stay accruing in Profit Balance.`,
      });
      await Promise.all([loadPositions(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'No unlocked monthly profit available yet.' });
    } finally {
      setClaimingAll(false);
    }
  };

  const handleConfirmEmergencyPayout = async () => {
    if (!emergencyTarget) return;
    setNotice(null);
    setEmergencyBusy(true);
    try {
      const res = await apiFetch<{
        penaltyAmount: number;
        netPrincipalReturned: number;
        unlockedProfitPaid: number;
        totalPayout: number;
      }>(`/api/staking/positions/${emergencyTarget.id}/emergency-payout`, {
        method: 'POST',
      });
      setNotice({
        type: 'ok',
        text: `Emergency payout completed for ${emergencyTarget.id}. Credited $${formatUsd(res.totalPayout)} USDT to Main Balance after ${penaltyPctLabel} penalty (-$${formatUsd(res.penaltyAmount)})${
          res.unlockedProfitPaid > 0 ? ` including +$${formatUsd(res.unlockedProfitPaid)} unlocked profit.` : '.'
        }`,
      });
      setEmergencyTarget(null);
      await Promise.all([loadPositions(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to process emergency payout.' });
    } finally {
      setEmergencyBusy(false);
    }
  };

  const handleMoveClaimableToMain = async () => {
    setNotice(null);
    setMovingClaimable(true);
    try {
      const res = await apiFetch<{ claimedAmount: number }>('/api/wallet/claim', { method: 'POST' });
      setNotice({
        type: 'ok',
        text: `Moved $${formatUsd(res.claimedAmount)} USDT from Claimable Wallet to Main Balance.`,
      });
      await onRefresh();
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to move claimable funds.' });
    } finally {
      setMovingClaimable(false);
    }
  };

  const modalPrincipal = Number(emergencyTarget?.principal_amount || 0);
  const modalPenalty = Number((emergencyTarget?.emergency_penalty_amount ?? modalPrincipal * penaltyRate).toFixed(2));
  const modalNetPrincipal = Number((emergencyTarget?.emergency_net_principal ?? modalPrincipal - modalPenalty).toFixed(2));
  const modalUnlockedProfit = Number(emergencyTarget?.claimable_profit || 0);
  const modalLockedDaily = Number(emergencyTarget?.locked_daily_profit || 0);
  const modalTotalPayout = Number((modalNetPrincipal + modalUnlockedProfit).toFixed(2));

  return (
    <div className="space-y-6">
      {/* Dark Slate Institutional Hero & Profit Balance Anchor */}
      <section className="rounded-xl border border-slate-800 bg-[#0F172A] text-white overflow-hidden">
        <div className="p-6 lg:p-7 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left: Vault Identity & Wallet Strip */}
          <div className="lg:col-span-7 space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-emerald-400">
                Fixed-Term USDT Yield · Daily Accrual · 30-Day Monthly Unlock
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance">
                Nepefy Staking Vaults
              </h1>
              <p className="text-sm text-slate-300 max-w-xl leading-relaxed">
                Your vaults generate daily returns added directly to your Profit Balance. Track daily growth in real time, then withdraw completed 30-day profit cycles directly to your wallet.
              </p>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-mono-tabular text-slate-300 border-t border-slate-800">
              <div>
                <span className="text-slate-400 font-sans">Main Balance </span>
                <span className="font-bold text-white">${formatUsd(user.main_balance)} USDT</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div>
                  <span className="text-slate-400 font-sans">Claimable </span>
                  <span className="font-bold text-sky-400">${formatUsd(user.claimable_balance)}</span>
                </div>
                {user.claimable_balance > 0 && (
                  <button
                    type="button"
                    onClick={handleMoveClaimableToMain}
                    disabled={movingClaimable}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-sans text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    {movingClaimable ? 'Moving...' : 'Move to Main'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Global Profit Balance & Monthly Unlock Split */}
          <div className="lg:col-span-5 lg:border-l lg:border-slate-800 lg:pl-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-slate-400">Global Profit Balance</div>
                <div className="mt-1 text-3xl sm:text-4xl font-bold font-mono-tabular text-emerald-400">
                  ${formatUsd(portfolioMetrics.totalProfitBalance)}
                </div>
              </div>
              <div className="text-right font-mono-tabular">
                <div className="text-[11px] text-slate-400">Daily Rate</div>
                <div className="text-sm font-semibold text-white">
                  +${formatDailyRate(portfolioMetrics.dailyRateTotal)}/day
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs">
              <div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Locked Daily</span>
                </div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-amber-300">
                  ${formatUsd(portfolioMetrics.lockedDailyProfit)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {portfolioMetrics.soonestUnlockDays > 0
                    ? `Unlocks in ${portfolioMetrics.soonestUnlockDays}d`
                    : 'Non-withdrawable mid-cycle'}
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Monthly Unlocked</span>
                </div>
                <div className="mt-1 text-base font-bold font-mono-tabular text-emerald-400">
                  ${formatUsd(portfolioMetrics.unlockedProfit)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {portfolioMetrics.unlockedProfit > 0 ? 'Ready for withdrawal' : 'Unlocks every 30 days'}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={claimingAll || portfolioMetrics.unlockedProfit <= 0}
              onClick={handleClaimAllUnlocked}
              className={`w-full h-10 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                portfolioMetrics.unlockedProfit > 0
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed'
              }`}
            >
              {portfolioMetrics.unlockedProfit > 0 ? (
                <>
                  <Unlock className="w-3.5 h-3.5" />
                  <span>
                    {claimingAll
                      ? 'Withdrawing Monthly Profit...'
                      : `Withdraw Monthly Profit (+$${formatUsd(portfolioMetrics.unlockedProfit)})`}
                  </span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    {portfolioMetrics.soonestUnlockDays > 0
                      ? `Daily Profit Locked · Next Unlock in ${portfolioMetrics.soonestUnlockDays} Day${portfolioMetrics.soonestUnlockDays === 1 ? '' : 's'}`
                      : 'Monthly Withdrawal Unlocks Every 30 Days'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {notice && (
        <div
          className={`border text-xs px-4 py-3 rounded-lg flex items-center justify-between gap-3 ${
            notice.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold hover:underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {/* 4-Column Executive Portfolio KPI Strip (Single Flat Container) */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Active Staked Principal</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
            ${formatUsd(portfolioMetrics.activePrincipal)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-tabular">
            {portfolioMetrics.activeCount} active vault{portfolioMetrics.activeCount === 1 ? '' : 's'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Daily Profit Accrual</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-emerald-600">
            +${formatDailyRate(portfolioMetrics.dailyRateTotal)}/day
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Added every 24h to Profit Balance
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Monthly Unlock Rate</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-blue-600">
            +${formatUsd(portfolioMetrics.monthlyRateTotal)}/mo
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-tabular">
            {portfolioMetrics.readyCount > 0
              ? `${portfolioMetrics.readyCount} vault${portfolioMetrics.readyCount === 1 ? '' : 's'} unlocked now`
              : portfolioMetrics.soonestUnlockDays > 0
              ? `Next unlock in ${portfolioMetrics.soonestUnlockDays} day${portfolioMetrics.soonestUnlockDays === 1 ? '' : 's'}`
              : 'Stake below to begin earning'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Total Yield Withdrawn</div>
          <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
            +${formatUsd(portfolioMetrics.totalProfitPaid)}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono-tabular">
            {portfolioMetrics.totalMonthsPaid} monthly payout{portfolioMetrics.totalMonthsPaid === 1 ? '' : 's'} · {penaltyPctLabel} early fee
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Left = Vault Plans + Mechanics | Right = Subscription Ticket */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Vault Term Selection & Settlement Mechanics */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="border border-slate-200 rounded-xl bg-white p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Select Fixed-Term Staking Plan</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Daily profit adds automatically to Profit Balance · Full cycle unlocks every 30 days
                </p>
              </div>
              <span className="text-xs font-mono-tabular text-slate-500">USDT · Min $50.00</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PACKAGES.map((pkg) => {
                const active = pkg.code === selectedPkg;
                const estMonthlyExact = (principalNum * (pkg.roi / 100)) / 12;
                const estMonthly = Number(estMonthlyExact.toFixed(2));
                const estDaily = estMonthlyExact / 30;
                return (
                  <button
                    key={pkg.code}
                    type="button"
                    onClick={() => setSelectedPkg(pkg.code)}
                    className={`text-left p-5 rounded-xl border transition-all duration-150 ${
                      active
                        ? 'border-[#0F172A] bg-[#0F172A] text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-900'}`}>
                        {pkg.label}
                      </span>
                      <span
                        className={`text-xs font-mono-tabular font-bold ${
                          active ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {pkg.code}
                      </span>
                    </div>

                    <div className="mt-3 flex items-baseline justify-between gap-2">
                      <div>
                        <span className={`text-3xl font-bold font-mono-tabular ${active ? 'text-white' : 'text-slate-900'}`}>
                          {pkg.roi}%
                        </span>
                        <span className={`ml-1.5 text-xs ${active ? 'text-slate-300' : 'text-slate-500'}`}>APR</span>
                      </div>
                      <div className="text-right font-mono-tabular">
                        <div className={`text-sm font-bold ${active ? 'text-emerald-400' : 'text-emerald-600'}`}>
                          +${formatDailyRate(estDaily)}/day
                        </div>
                        <div className={`text-[11px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                          +${formatUsd(estMonthly)}/mo
                        </div>
                      </div>
                    </div>

                    <div
                      className={`mt-4 pt-3 border-t flex items-center justify-between text-[11px] ${
                        active ? 'border-slate-800 text-slate-300' : 'border-slate-100 text-slate-500'
                      }`}
                    >
                      <span>{pkg.audience}</span>
                      <span className="font-mono-tabular">{pkg.months} monthly unlocks</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3-Step Settlement & Profit Balance Policy Strip */}
          <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-900">01. Daily Profit Accrual</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Every 24 hours, daily APR yield is added directly to your global Profit Balance across all vaults.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-900">02. Monthly Unlock Rule</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Daily earnings stay visible in Profit Balance (locked mid-month) and unlock for withdrawal every 30 days.
              </p>
            </div>
            <div className="p-4 space-y-1">
              <div className="text-xs font-semibold text-slate-900">03. Instant Exit Policy</div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Need principal before term maturity? Trigger Emergency Payout anytime with a flat {penaltyPctLabel} exit fee.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Institutional Allocation Order Ticket */}
        <form
          onSubmit={handleSubscribe}
          className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-6 flex flex-col justify-between space-y-5"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Subscribe · {activePkg.code} Vault
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activePkg.roi}% fixed APR · {activePkg.months} monthly unlocks
                </p>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-blue-600">
                {activePkg.months} Months
              </span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="stake-amount-input" className="font-medium text-slate-700">
                  Stake Amount (USDT)
                </label>
                <span className="text-emerald-600 font-semibold font-mono-tabular">
                  Avail: ${formatUsd(user.main_balance)}
                </span>
              </div>

              <input
                id="stake-amount-input"
                type="number"
                min="50"
                step="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-11 px-3.5 text-base font-semibold font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '$100', val: '100' },
                  { label: '$500', val: '500' },
                  { label: '$1,000', val: '1000' },
                  { label: '$5,000', val: '5000' },
                ].map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => setAmount(q.val)}
                    className={`py-1.5 text-xs font-mono-tabular font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                      amount === q.val
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'text-slate-700 bg-slate-50 hover:bg-slate-100 border-slate-200'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: '25%', pct: 0.25 },
                  { label: '50%', pct: 0.5 },
                  { label: '75%', pct: 0.75 },
                  { label: 'Max', pct: 1 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPresetPercent(preset.pct)}
                    className="py-1.5 text-xs font-mono-tabular font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Clean Hairline Yield & Policy Breakdown */}
            <div className="border-t border-slate-200 pt-3 divide-y divide-slate-100 text-xs">
              <div className="py-2 flex justify-between items-center">
                <span className="text-slate-500">Subscription Date</span>
                <span className="font-mono-tabular font-medium text-slate-900">
                  {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · First accrual +24h
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500">Daily Profit (to Profit Balance)</span>
                <span className="font-mono-tabular font-bold text-emerald-600">
                  +${formatDailyRate(dailyPayout)} / day
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500">Monthly Unlock (Every 30 days)</span>
                <span className="font-mono-tabular font-bold text-blue-600">
                  +${formatUsd(monthlyPayout)} / mo
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500">Total Term Profit ({activePkg.months} mo)</span>
                <span className="font-mono-tabular font-semibold text-slate-900">
                  +${formatUsd(totalYield)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500">Maturity Total Return</span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  ${formatUsd(maturityTotal)}
                </span>
              </div>
              <div className="py-2.5 flex justify-between items-center">
                <span className="text-slate-500">Emergency Exit ({penaltyPctLabel} Fee)</span>
                <span className="font-mono-tabular text-amber-700 font-medium">
                  -${formatUsd(previewEmergencyPenalty)} fee → ${formatUsd(previewEmergencyNet)} net
                </span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || principalNum < 50}
            className="w-full h-11 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>
              {busy ? 'Locking Allocation...' : `Confirm & Stake $${formatUsd(principalNum)} USDT`}
            </span>
            {!busy && <ArrowUpRight className="w-4 h-4" />}
          </button>
        </form>
      </div>

      {/* Vault Positions & Daily Profit Log Ledger */}
      <section className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setLedgerTab('POSITIONS')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                ledgerTab === 'POSITIONS'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Vault Positions ({positions.length})
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('DAILY_LOGS')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                ledgerTab === 'DAILY_LOGS'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Daily Profit History ({dailyLogs.length})
            </button>
          </div>

          <div className="flex items-center gap-2.5 text-xs shrink-0">
            <span className="text-slate-500 whitespace-nowrap">Monthly Withdraw To:</span>
            <div className="flex items-center p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setProfitDestination('MAIN')}
                className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                  profitDestination === 'MAIN'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Main Balance
              </button>
              <button
                type="button"
                onClick={() => setProfitDestination('CLAIMABLE')}
                className={`px-3 py-1 rounded-md font-medium transition-colors whitespace-nowrap shrink-0 ${
                  profitDestination === 'CLAIMABLE'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Claimable
              </button>
            </div>
          </div>
        </div>

        {ledgerTab === 'POSITIONS' ? (
          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
                {(
                  [
                    ['ACTIVE', 'Active'],
                    ['COMPLETED', 'Completed'],
                    ['EMERGENCY_WITHDRAWN', 'Emergency'],
                    ['ALL', 'All'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === key
                        ? 'bg-white text-slate-900 font-semibold shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID or plan..."
                  className="h-9 pl-8 pr-3 w-full text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4 whitespace-nowrap">Vault &amp; Plan</th>
                    <th className="py-3 px-4 whitespace-nowrap">Subscribed</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Principal</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Daily / Monthly</th>
                    <th className="py-3 px-4 whitespace-nowrap">30d Cycle &amp; Term</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Profit Balance</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Paid Total</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {loading ? (
                    Array.from({ length: 3 }).map((_, idx) => (
                      <tr key={idx}>
                        <td colSpan={8} className="py-4 px-4">
                          <div className="h-5 bg-slate-100 rounded animate-pulse w-full" />
                        </td>
                      </tr>
                    ))
                  ) : filteredPositions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 px-4 text-center text-slate-500">
                        {positions.length === 0
                          ? 'No staking positions yet. Subscribe above to start earning daily profits.'
                          : 'No staking positions match the selected filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredPositions.map((pos) => {
                      const monthlyUnit =
                        pos.monthly_profit ?? Number(((pos.principal_amount * (pos.annual_roi_pct / 100)) / 12).toFixed(2));
                      const dailyUnit =
                        pos.daily_profit ?? (pos.principal_amount * (pos.annual_roi_pct / 100)) / 360;
                      const monthsPaid =
                        pos.months_paid ?? Math.min(pos.duration_months, (pos.quarters_paid || 0) * 3);
                      const cycleDay = pos.cycle_day ?? 0;
                      const cyclePct = Math.min(100, Math.round((cycleDay / 30) * 100));
                      const accruedProfit = Number(pos.accrued_profit || 0);
                      const lockedDaily = Number(pos.locked_daily_profit ?? accruedProfit);
                      const canClaim = Boolean(pos.can_claim && (pos.claimable_profit || 0) > 0);
                      const isEmergency = pos.status === 'EMERGENCY_WITHDRAWN';
                      const isCompleted = pos.status === 'COMPLETED';
                      const daysLeft = pos.days_until_next_payout ?? 0;

                      return (
                        <tr key={pos.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="font-semibold text-slate-900">
                              {pos.package_code} · {pos.annual_roi_pct}% APR
                            </div>
                            <div className="text-slate-400 font-mono-tabular text-[11px]">{pos.id}</div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap font-mono-tabular text-slate-700">
                            <div>
                              {new Date(pos.created_at).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {new Date(pos.created_at).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                            ${formatUsd(pos.principal_amount)}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono-tabular whitespace-nowrap">
                            <div className="font-semibold text-emerald-600">+${formatDailyRate(dailyUnit)}/day</div>
                            <div className="text-[11px] text-slate-400">+${formatUsd(monthlyUnit)}/mo</div>
                          </td>

                          <td className="py-3.5 px-4 min-w-[165px]">
                            {isCompleted ? (
                              <div className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>
                                  Matured ({monthsPaid}/{pos.duration_months} mo)
                                </span>
                              </div>
                            ) : isEmergency ? (
                              <div className="text-amber-700 font-medium">
                                Exited early ({monthsPaid}/{pos.duration_months} mo)
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-slate-600 mb-1">
                                  <span>
                                    Cycle: Day {cycleDay}/30
                                  </span>
                                  <span>
                                    {monthsPaid}/{pos.duration_months} mo
                                  </span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${canClaim ? 'bg-emerald-500' : 'bg-blue-600'}`}
                                    style={{ width: `${cyclePct}%` }}
                                  />
                                </div>
                                <div className="mt-1 text-[10.5px] text-slate-400 font-mono-tabular flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {canClaim
                                    ? `Unlocked (${pos.claimable_months} mo ready)`
                                    : `Unlocks in ${daysLeft}d (${formatDateTime(pos.next_payout_at).split(',')[0]})`}
                                </div>
                              </>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono-tabular whitespace-nowrap">
                            {pos.status !== 'ACTIVE' ? (
                              <span className="text-slate-400">$0.00</span>
                            ) : canClaim ? (
                              <div>
                                <div className="font-bold text-emerald-600">
                                  +${formatUsd(pos.claimable_profit || 0)}
                                </div>
                                <div className="text-[10.5px] text-emerald-700">
                                  Unlocked{lockedDaily > 0 ? ` · +$${formatUsd(lockedDaily)} locked` : ''}
                                </div>
                              </div>
                            ) : (
                              <div>
                                <div className="font-semibold text-amber-700">
                                  +${formatUsd(accruedProfit)}
                                </div>
                                <div className="text-[10.5px] text-slate-400 inline-flex items-center gap-1 justify-end">
                                  <Lock className="w-2.5 h-2.5" />
                                  <span>Locked until Day 30</span>
                                </div>
                              </div>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                            +${formatUsd(pos.total_profit_paid)}
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            {isCompleted ? (
                              <span className="font-semibold text-emerald-600">Principal Returned</span>
                            ) : isEmergency ? (
                              <span className="font-medium text-amber-700">
                                Exited (-{penaltyPctLabel})
                              </span>
                            ) : (
                              <div className="inline-flex items-center gap-2 justify-end">
                                {canClaim ? (
                                  <button
                                    type="button"
                                    onClick={() => handleClaimMonthlyProfit(pos)}
                                    disabled={claimingId === pos.id}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                                  >
                                    {claimingId === pos.id
                                      ? 'Withdrawing...'
                                      : `Withdraw +$${formatUsd(pos.claimable_profit || monthlyUnit)}`}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    title="Daily profits accumulate visibly in Profit Balance and unlock for withdrawal every 30 days."
                                    className="px-3 py-1.5 bg-slate-100 text-slate-500 border border-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1 cursor-not-allowed whitespace-nowrap shrink-0"
                                  >
                                    <Lock className="w-3 h-3" />
                                    <span>{daysLeft > 0 ? `Locked (${daysLeft}d)` : 'Locked (30d)'}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setEmergencyTarget(pos)}
                                  className="px-3 py-1.5 border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
                                >
                                  Emergency Payout
                                </button>
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
        ) : (
          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                <span>Every 24-hour daily profit accrual credited into your Profit Balance</span>
              </div>
              <span className="text-xs font-mono-tabular font-semibold text-emerald-600">
                Profit Balance: ${formatUsd(portfolioMetrics.totalProfitBalance)}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4 whitespace-nowrap">Credited At</th>
                    <th className="py-3 px-4 whitespace-nowrap">Vault &amp; Plan</th>
                    <th className="py-3 px-4 whitespace-nowrap">Day #</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Daily Profit Added</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Vault Profit Balance</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Withdrawal Rule</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {dailyLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                        <div className="inline-flex flex-col items-center gap-1.5">
                          <Clock className="w-5 h-5 text-slate-400" />
                          <span>
                            No daily profit accruals logged yet. Daily profits credit every 24 hours after subscribing to a vault.
                          </span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    dailyLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                          {formatDateTime(log.credited_at)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-semibold text-slate-900">{log.package_code}</span>{' '}
                          <span className="text-slate-400 font-mono-tabular">· {log.position_id}</span>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                          Day {log.day_number}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-emerald-600 whitespace-nowrap">
                          +${formatUsd(log.daily_amount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                          ${formatUsd(log.total_accrued)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <span className="text-slate-500">
                            {log.day_number % 30 === 0 ? '30d Cycle Unlocked' : 'Locked until Day 30'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Emergency Payout Confirmation Modal (0.5% Penalty) */}
      {emergencyTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-rose-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Emergency Vault Payout</h3>
                  <p className="text-[11px] text-slate-500 font-mono-tabular">
                    {emergencyTarget.id} · {emergencyTarget.package_code} ({emergencyTarget.annual_roi_pct}% APR) · Subscribed{' '}
                    {formatDateTime(emergencyTarget.created_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !emergencyBusy && setEmergencyTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  Withdrawing principal before term maturity closes the vault permanently and deducts a{' '}
                  <strong>{penaltyPctLabel} emergency exit penalty</strong> from your locked principal.
                  {modalLockedDaily > 0
                    ? ` Mid-month locked daily profit (+$${formatUsd(modalLockedDaily)}) is forfeited if exited before Day 30.`
                    : ''}
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg bg-slate-50 p-4 space-y-2.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Locked Principal</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    ${formatUsd(modalPrincipal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Emergency Penalty ({penaltyPctLabel})</span>
                  <span className="font-mono-tabular font-semibold text-rose-600">
                    -${formatUsd(modalPenalty)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Net Principal Returned</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    ${formatUsd(modalNetPrincipal)}
                  </span>
                </div>
                {modalUnlockedProfit > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      Unlocked Monthly Profit ({emergencyTarget.claimable_months} mo)
                    </span>
                    <span className="font-mono-tabular font-semibold text-emerald-600">
                      +${formatUsd(modalUnlockedProfit)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center border-t border-slate-200 pt-2.5 text-sm">
                  <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Wallet className="w-4 h-4 text-blue-600" />
                    Credited to Main Balance
                  </span>
                  <span className="font-mono-tabular font-bold text-blue-600">
                    ${formatUsd(modalTotalPayout)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={emergencyBusy}
                  onClick={() => setEmergencyTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                >
                  Keep Staking
                </button>
                <button
                  type="button"
                  disabled={emergencyBusy}
                  onClick={handleConfirmEmergencyPayout}
                  className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg"
                >
                  {emergencyBusy ? 'Processing...' : `Confirm Emergency Payout ($${formatUsd(modalTotalPayout)})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
