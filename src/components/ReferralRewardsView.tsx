import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Check,
  CheckCircle2,
  Copy,
  Gift,
  Link2,
  Lock,
  ShieldCheck,
  Sparkles,
  Unlock,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type { ReferralItem, ReferralMilestone, ReferralOverviewStats, UserProfile } from '../types';

interface ReferralRewardsViewProps {
  user: UserProfile;
  onRefreshUser?: () => Promise<void>;
}

type InviteFilter = 'ALL' | 'CREDITED' | 'PENDING_BALANCE' | 'VERIFIED';

export const ReferralRewardsView: React.FC<ReferralRewardsViewProps> = ({ user, onRefreshUser }) => {
  const [referralCode, setReferralCode] = useState(user.referral_code);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [stats, setStats] = useState<ReferralOverviewStats>({
    perReferralUsdt: 15,
    balanceThresholdUsdt: 500,
    requiredVerifiedSignups: 10,
    verifiedSignupsCount: 0,
    incomeActive: false,
    totalInvitedCount: 0,
    balanceQualifiedCount: 0,
    creditedCount: 0,
    queuedCount: 0,
    queuedUsd: 0,
    totalReferralEarnedUsd: 0,
    totalMilestoneEarnedUsd: 0,
  });
  const [milestones, setMilestones] = useState<ReferralMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>('ALL');
  const [claimingTier, setClaimingTier] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadReferrals = useCallback(async () => {
    try {
      const res = await apiFetch<{
        referralCode: string;
        referrals: ReferralItem[];
        referralStats?: ReferralOverviewStats;
        milestones?: ReferralMilestone[];
      }>('/api/rewards/overview');
      setReferralCode(res.referralCode);
      setReferrals(Array.isArray(res.referrals) ? res.referrals : []);
      if (res.referralStats) setStats(res.referralStats);
      if (Array.isArray(res.milestones)) setMilestones(res.milestones);
    } catch {
      // ignore transient fetch errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  const referralLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${encodeURIComponent(referralCode)}`
      : `/?ref=${referralCode}`;

  const copyCode = () => {
    navigator.clipboard?.writeText(referralCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(referralLink).catch(() => {});
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  };

  const handleClaimMilestone = async (tier: ReferralMilestone) => {
    setNotice(null);
    setClaimingTier(tier.tierCode);
    try {
      const res = await apiFetch<{
        bonusUsd: number;
        referrals?: ReferralItem[];
        referralStats?: ReferralOverviewStats;
        milestones?: ReferralMilestone[];
      }>('/api/rewards/milestones/claim', {
        method: 'POST',
        body: JSON.stringify({ tier_code: tier.tierCode }),
      });
      if (Array.isArray(res.referrals)) setReferrals(res.referrals);
      if (res.referralStats) setStats(res.referralStats);
      if (Array.isArray(res.milestones)) setMilestones(res.milestones);
      setNotice({
        type: 'ok',
        text: `${tier.title} milestone bonus (+$${formatUsd(tier.bonusUsd)} USDT) credited to your Claimable Wallet.`,
      });
      await onRefreshUser?.();
    } catch (err: any) {
      setNotice({ type: 'err', text: err?.message || 'Unable to claim milestone bonus.' });
    } finally {
      setClaimingTier(null);
    }
  };

  const filteredReferrals = useMemo(() => {
    return referrals.filter((r) => {
      if (inviteFilter === 'CREDITED') return r.status === 'CREDITED_CLAIMABLE' || r.balance_qualified;
      if (inviteFilter === 'PENDING_BALANCE') return r.status !== 'CREDITED_CLAIMABLE' && !r.balance_qualified;
      if (inviteFilter === 'VERIFIED') return r.referred_kyc_status === 'VERIFIED';
      return true;
    });
  }, [referrals, inviteFilter]);

  const activationPct = Math.min(
    100,
    Math.round((stats.verifiedSignupsCount / Math.max(1, stats.requiredVerifiedSignups)) * 100)
  );
  const remainingVerified = Math.max(0, stats.requiredVerifiedSignups - stats.verifiedSignupsCount);
  const totalCombinedEarned = Number((stats.totalReferralEarnedUsd + stats.totalMilestoneEarnedUsd).toFixed(2));

  if (loading && referrals.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 bg-slate-100 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-60 border border-slate-200 rounded-xl bg-slate-50/60 animate-pulse" />
          <div className="lg:col-span-5 h-60 border border-slate-200 rounded-xl bg-slate-50/60 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Referral Program &amp; Milestone Bonuses</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Earn <strong className="text-slate-800">$15.00 USDT</strong> per qualified friend whose balance reaches{' '}
            <strong className="text-slate-800">$500.00</strong> — unlocked once{' '}
            <strong className="text-slate-800">10 verified users</strong> sign up with your code.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg bg-white whitespace-nowrap">
            <Gift className="w-3.5 h-3.5 text-blue-600" />
            <span>$15.00 USDT / Referral</span>
          </div>
          <div
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border whitespace-nowrap ${
              stats.incomeActive
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}
          >
            {stats.incomeActive ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{stats.incomeActive ? 'Referral Income Active' : `Locked (${stats.verifiedSignupsCount}/10 Verified)`}</span>
          </div>
        </div>
      </div>

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

      {/* Top Row: Partner Invite Card + Activation Gate & Earnings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Referral Share & 3-Step Rules */}
        <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-blue-600">Partner Rewards Program</div>
                <h2 className="mt-0.5 text-xl font-bold text-slate-900">
                  Invite Friends · Earn $15.00 USDT Each + Milestones
                </h2>
              </div>
              <span className="text-xs font-mono-tabular font-semibold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                Threshold: $500.00 Balance
              </span>
            </div>

            {/* 3-Step Rule Breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-slate-200 rounded-lg bg-slate-50/70 p-3 space-y-1">
                <div className="text-[11px] font-semibold text-blue-600">Step 1 · Share &amp; Sign Up</div>
                <div className="text-xs font-semibold text-slate-900">10 Verified Signups</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Reach 10 KYC-verified referrals to permanently activate referral payouts.
                </p>
              </div>
              <div className="border border-slate-200 rounded-lg bg-slate-50/70 p-3 space-y-1">
                <div className="text-[11px] font-semibold text-emerald-600">Step 2 · Balance Reach</div>
                <div className="text-xs font-semibold text-slate-900">$500.00 Account Balance</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Each friend qualifies for $15.00 USDT once their balance reaches $500.00.
                </p>
              </div>
              <div className="border border-slate-200 rounded-lg bg-slate-50/70 p-3 space-y-1">
                <div className="text-[11px] font-semibold text-amber-600">Step 3 · Extra Tiers</div>
                <div className="text-xs font-semibold text-slate-900">Up to $1,100 Milestones</div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Unlock $100, $200, $300, and $500 extra tier rewards as your network scales.
                </p>
              </div>
            </div>
          </div>

          {/* Code & Shareable Link Box */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
            <div className="sm:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500">Referral Code</div>
                <div className="mt-0.5 text-base font-bold font-mono-tabular text-slate-900 truncate">
                  {referralCode}
                </div>
              </div>
              <button
                type="button"
                onClick={copyCode}
                className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors inline-flex items-center gap-1.5 shrink-0"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="sm:col-span-7 bg-slate-50 border border-slate-200 rounded-lg p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  <span>Invite Signup Link</span>
                </div>
                <div className="mt-0.5 text-xs font-mono-tabular text-slate-700 truncate">{referralLink}</div>
              </div>
              <button
                type="button"
                onClick={copyLink}
                className="px-3 py-1.5 text-xs font-medium bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 shrink-0"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right: 10 Verified Signups Activation Gate & Earnings KPIs */}
        <div className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-6 flex flex-col justify-between space-y-5">
          {/* Activation Gate Meter */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 ${stats.incomeActive ? 'text-emerald-600' : 'text-amber-600'}`} />
                <span className="text-sm font-semibold text-slate-900">Referral Income Activation</span>
              </div>
              <span className="text-xs font-bold font-mono-tabular text-slate-900">
                {stats.verifiedSignupsCount} / {stats.requiredVerifiedSignups} Verified
              </span>
            </div>

            <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200/70">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  stats.incomeActive ? 'bg-[#0ECB81]' : 'bg-blue-600'
                }`}
                style={{ width: `${activationPct}%` }}
              />
            </div>

            <p className="text-xs text-slate-500">
              {stats.incomeActive ? (
                <span className="text-emerald-700 font-medium">
                  Referral income is active! Every referral reaching $500.00 balance credits $15.00 USDT automatically.
                </span>
              ) : (
                <span>
                  <strong className="text-slate-800">{remainingVerified} more verified signup{remainingVerified === 1 ? '' : 's'}</strong>{' '}
                  needed to activate referral income payouts.
                  {stats.queuedCount > 0 && (
                    <span className="text-amber-700 font-medium">
                      {' '}
                      (${formatUsd(stats.queuedUsd)} queued from {stats.queuedCount} user
                      {stats.queuedCount === 1 ? '' : 's'} at $500+)
                    </span>
                  )}
                </span>
              )}
            </p>
          </div>

          {/* 3 Stat Tiles */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[11px] text-slate-500">Total Invited</div>
              <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900">
                {stats.totalInvitedCount}
              </div>
              <div className="text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                {stats.verifiedSignupsCount} verified
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[11px] text-slate-500">Reached $500</div>
              <div className="mt-1 text-lg font-bold font-mono-tabular text-blue-600">
                {stats.balanceQualifiedCount}
              </div>
              <div className="text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                {stats.creditedCount} paid
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[11px] text-slate-500">Total Earned</div>
              <div className="mt-1 text-lg font-bold font-mono-tabular text-emerald-600">
                ${formatUsd(totalCombinedEarned)}
              </div>
              <div className="text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                +${formatUsd(stats.totalMilestoneEarnedUsd)} tier
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Milestone Bonuses Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Award className="w-4 h-4 text-blue-600" />
              <span>Referral Milestone Bonuses</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Earn cumulative cash bonuses when your qualified referrals (balance ≥ $500.00) reach each milestone tier.
            </p>
          </div>
          <span className="text-xs font-mono-tabular text-slate-600">
            Milestone Earned:{' '}
            <strong className="text-emerald-600 font-semibold">${formatUsd(stats.totalMilestoneEarnedUsd)} USDT</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {milestones.map((tier) => {
            const pct = Math.min(100, Math.round((tier.currentCount / Math.max(1, tier.targetCount)) * 100));
            const remainingRefs = Math.max(0, tier.targetCount - tier.currentCount);
            const canClaim = tier.unlocked && !tier.claimed;

            const tierThemeMap: Record<
              string,
              {
                card: string;
                title: string;
                dot: string;
                countBadge: string;
                bar: string;
                track: string;
                gapText: string;
                bonusText: string;
              }
            > = {
              TIER_10: {
                card: 'border-orange-200 bg-gradient-to-b from-orange-50/45 to-white',
                title: 'text-orange-800',
                dot: 'bg-orange-500',
                countBadge: 'bg-orange-50 text-orange-700 border-orange-200',
                bar: 'bg-orange-500',
                track: 'bg-orange-100/70',
                gapText: 'text-orange-700',
                bonusText: 'text-orange-700',
              },
              TIER_25: {
                card: 'border-indigo-200 bg-gradient-to-b from-indigo-50/45 to-white',
                title: 'text-indigo-800',
                dot: 'bg-indigo-500',
                countBadge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
                bar: 'bg-indigo-500',
                track: 'bg-indigo-100/70',
                gapText: 'text-indigo-700',
                bonusText: 'text-indigo-700',
              },
              TIER_50: {
                card: 'border-amber-300 bg-gradient-to-b from-amber-50/55 to-white',
                title: 'text-amber-800',
                dot: 'bg-amber-500',
                countBadge: 'bg-amber-50 text-amber-800 border-amber-200',
                bar: 'bg-amber-500',
                track: 'bg-amber-100/70',
                gapText: 'text-amber-700',
                bonusText: 'text-amber-700',
              },
              TIER_100: {
                card: 'border-cyan-200 bg-gradient-to-b from-cyan-50/50 to-white',
                title: 'text-cyan-800',
                dot: 'bg-cyan-500',
                countBadge: 'bg-cyan-50 text-cyan-800 border-cyan-200',
                bar: 'bg-cyan-500',
                track: 'bg-cyan-100/70',
                gapText: 'text-cyan-700',
                bonusText: 'text-cyan-700',
              },
            };

            const theme = tierThemeMap[tier.tierCode] || tierThemeMap.TIER_10;

            return (
              <div
                key={tier.tierCode}
                className={`border rounded-xl p-5 flex flex-col justify-between space-y-4 transition-colors ${
                  tier.claimed
                    ? 'border-emerald-200 bg-emerald-50/25'
                    : canClaim
                    ? 'border-blue-300 bg-gradient-to-b from-blue-50/40 to-white shadow-xs'
                    : theme.card
                }`}
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${tier.claimed ? 'text-emerald-800' : theme.title}`}>
                      <span className={`w-2 h-2 rounded-full ${tier.claimed ? 'bg-emerald-500' : theme.dot}`} />
                      {tier.title}
                    </span>
                    {tier.claimed ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        <CheckCircle2 className="w-3 h-3" />
                        Claimed
                      </span>
                    ) : canClaim ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        <Sparkles className="w-3 h-3" />
                        Ready
                      </span>
                    ) : (
                      <span className={`inline-flex items-center text-[11px] font-bold font-mono-tabular px-2 py-0.5 rounded-md border ${theme.countBadge}`}>
                        {tier.currentCount} / {tier.targetCount}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline justify-between gap-2">
                    <div className={`text-2xl font-bold font-mono-tabular ${tier.claimed ? 'text-emerald-700' : theme.bonusText}`}>
                      +${formatUsd(tier.bonusUsd)}
                    </div>
                    <div className="text-xs font-medium text-slate-500">USDT Bonus</div>
                  </div>

                  <div className="text-xs text-slate-600">
                    Target: <strong className="font-mono-tabular text-slate-900">{tier.targetCount}</strong> qualified referrals ($500+)
                  </div>

                  <div className={`h-2 w-full rounded-full overflow-hidden ${tier.claimed ? 'bg-emerald-100' : canClaim ? 'bg-blue-100' : theme.track}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        tier.claimed ? 'bg-[#0ECB81]' : canClaim ? 'bg-blue-600' : theme.bar
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {tier.claimed ? (
                  <div className="text-[11px] text-emerald-700 font-mono-tabular pt-1">
                    Credited {tier.claimedAt ? formatDateTime(tier.claimedAt) : ''}
                  </div>
                ) : canClaim ? (
                  <button
                    type="button"
                    disabled={claimingTier === tier.tierCode}
                    onClick={() => handleClaimMilestone(tier)}
                    className="w-full py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors"
                  >
                    {claimingTier === tier.tierCode ? 'Claiming...' : `Claim +$${formatUsd(tier.bonusUsd)} USDT`}
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2 text-[11px] pt-1">
                    <span className={`font-medium ${theme.gapText}`}>
                      {!stats.incomeActive && remainingRefs === 0
                        ? `Activate income (10 verified signups) to claim`
                        : `${remainingRefs} more $500+ referral${remainingRefs === 1 ? '' : 's'} needed`}
                    </span>
                    <span className="font-mono-tabular font-semibold text-slate-500">{pct}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Invited Users & $500 Balance Progress Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-900">Invited Users Progress</h2>
            <span className="text-xs text-slate-500 font-mono-tabular">({referrals.length})</span>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['ALL', 'All Invites'],
                ['CREDITED', 'Balance ≥ $500'],
                ['PENDING_BALANCE', 'Awaiting $500'],
                ['VERIFIED', 'Verified Only'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setInviteFilter(key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  inviteFilter === key ? 'bg-white text-slate-900 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">Referred User</th>
                <th className="py-3 px-4">Verification</th>
                <th className="py-3 px-4">Balance Toward $500.00</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4 text-right">Reward</th>
                <th className="py-3 px-4 text-right">Payout Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredReferrals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                    {referrals.length === 0 ? (
                      <>
                        No referred users yet. Share your code{' '}
                        <span className="font-mono-tabular font-semibold text-slate-800">{referralCode}</span> to start
                        earning $15.00 bonuses.
                      </>
                    ) : (
                      'No invited users match this filter.'
                    )}
                  </td>
                </tr>
              ) : (
                filteredReferrals.map((r) => {
                  const bal = Number(r.referred_balance ?? 0);
                  const balPct = Math.min(100, Math.round((bal / 500) * 100));
                  const isVerified = r.referred_kyc_status === 'VERIFIED';
                  const isCredited = r.status === 'CREDITED_CLAIMABLE';
                  const isQueued = !isCredited && Boolean(r.balance_qualified);
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{r.referred_name}</div>
                        <div className="text-slate-500">{r.referred_email}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                            isVerified
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-slate-100 border-slate-200 text-slate-600'
                          }`}
                        >
                          {isVerified ? <CheckCircle2 className="w-3 h-3" /> : null}
                          <span>{isVerified ? 'Verified' : 'Unverified'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 min-w-[190px]">
                        <div className="flex items-center justify-between text-[11px] font-mono-tabular mb-1">
                          <span className="font-semibold text-slate-800 flex items-center gap-1">
                            <Wallet className="w-3 h-3 text-slate-400" />${formatUsd(bal)}
                          </span>
                          <span className="text-slate-400">/ $500.00</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              bal >= 500 || isCredited ? 'bg-[#0ECB81]' : 'bg-blue-600'
                            }`}
                            style={{ width: `${isCredited ? 100 : balPct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                        ${formatUsd(r.bonus_amount)} USDT
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium whitespace-nowrap">
                        {isCredited ? (
                          <span className="text-emerald-600 font-semibold">Credited to Claimable</span>
                        ) : isQueued ? (
                          <span className="text-blue-600 font-semibold">Queued · Needs 10 Verified</span>
                        ) : (
                          <span className="text-amber-600">Awaiting $500.00 Balance</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
