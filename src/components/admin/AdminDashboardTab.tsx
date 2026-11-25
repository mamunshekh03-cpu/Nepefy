import React from 'react';
import { ArrowRight } from 'lucide-react';
import { formatDateTime, formatUsd } from '../../lib/api';
import type { AdminProjectSummary, LedgerEntry, MarketPair, PlatformSettings } from '../../types';
import type { AdminMetrics, AdminTab, SpotStats, UserFilter } from './adminTypes';

interface AdminDashboardTabProps {
  projectSummary: AdminProjectSummary;
  platformSettings?: PlatformSettings;
  registeredAccounts: number;
  activeP2pOffersCount: number;
  recentTransactions: LedgerEntry[];
  metrics: AdminMetrics;
  spotStats: SpotStats;
  displayMarkets: MarketPair[];
  supportUnread: number;
  setTab: (t: AdminTab) => void;
  jumpToUsers: (f: UserFilter) => void;
}

export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({
  projectSummary,
  platformSettings,
  registeredAccounts,
  activeP2pOffersCount,
  recentTransactions,
  metrics,
  spotStats,
  displayMarkets,
  supportUnread,
  setTab,
  jumpToUsers,
}) => {
  const pendingAlerts: { label: string; detail: string; target: AdminTab; urgent: boolean }[] = [
    ...(metrics.pendingDepositsCount > 0
      ? [
          {
            label: `${metrics.pendingDepositsCount} Pending Deposit${metrics.pendingDepositsCount > 1 ? 's' : ''}`,
            detail: `$${formatUsd(metrics.pendingDepositsAmt)} awaiting approval`,
            target: 'DEPOSITS' as AdminTab,
            urgent: true,
          },
        ]
      : []),
    ...(metrics.pendingWithdrawalsCount > 0
      ? [
          {
            label: `${metrics.pendingWithdrawalsCount} Pending Payout${metrics.pendingWithdrawalsCount > 1 ? 's' : ''}`,
            detail: `$${formatUsd(metrics.pendingWithdrawalsAmt)} held in escrow`,
            target: 'WITHDRAWALS' as AdminTab,
            urgent: true,
          },
        ]
      : []),
    ...(metrics.disputedP2p > 0
      ? [
          {
            label: `${metrics.disputedP2p} P2P Dispute${metrics.disputedP2p > 1 ? 's' : ''}`,
            detail: 'Escrow arbitration required',
            target: 'P2P' as AdminTab,
            urgent: true,
          },
        ]
      : []),
    ...(supportUnread > 0
      ? [
          {
            label: `${supportUnread} Support Message${supportUnread > 1 ? 's' : ''}`,
            detail: 'Unread user inquiries',
            target: 'SUPPORT' as AdminTab,
            urgent: false,
          },
        ]
      : []),
    ...(metrics.unverifiedUsers > 0
      ? [
          {
            label: `${metrics.unverifiedUsers} Pending KYC`,
            detail: 'Accounts awaiting verification',
            target: 'USERS' as AdminTab,
            urgent: false,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      {/* Priority Operations Queue Strip (Only shown when actionable queues exist) */}
      {pendingAlerts.length > 0 && (
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">Priority Review Queue</span>
            <span className="text-xs font-mono-tabular text-slate-500">
              {pendingAlerts.length} active queue{pendingAlerts.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
            {pendingAlerts.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setTab(item.target)}
                className="p-3.5 text-left hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <div className={`text-xs font-semibold ${item.urgent ? 'text-amber-700' : 'text-blue-700'}`}>
                    {item.label}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate font-mono-tabular">{item.detail}</div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Primary Custody & Operations KPI Strip (Unified hairline grid) */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4.5">
          <div className="text-xs text-slate-500">Total Custody Liquidity</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
            ${formatUsd(metrics.totalLiquidity)}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
            Main ${formatUsd(metrics.totalMain)} · Escrow ${formatUsd(metrics.totalLocked)}
          </div>
        </div>

        <div className="p-4.5">
          <div className="text-xs text-slate-500">Pending Action Queues</div>
          <div
            className={`mt-1 text-xl font-bold font-mono-tabular ${
              metrics.totalPendingQueue > 0 ? 'text-amber-600' : 'text-emerald-600'
            }`}
          >
            {metrics.totalPendingQueue}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
            {metrics.pendingDepositsCount} dep · {metrics.pendingWithdrawalsCount} payouts · {metrics.disputedP2p} disputes
          </div>
        </div>

        <div className="p-4.5">
          <div className="text-xs text-slate-500">Staking &amp; Spot Exposure</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
            ${formatUsd(metrics.totalStakedPrincipal + metrics.openTradesVolume)}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
            {metrics.activeStakingCount} active vaults · {metrics.openTradesCount} open trades
          </div>
        </div>

        <div className="p-4.5">
          <div className="text-xs text-slate-500">Registered Accounts</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">{registeredAccounts}</div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
            {metrics.activeUsers} active · {metrics.verifiedUsers} KYC · {metrics.unverifiedUsers} pending
          </div>
        </div>
      </div>

      {/* All-Project Profit / Loss & Settlement Summary */}
      {projectSummary && (
        <div className="space-y-5">
          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Platform Financial P&amp;L &amp; Treasury Cashflow</h2>
                <p className="text-xs text-slate-500">
                  Realized platform fees, liquidations, yield costs, and net deposit/withdrawal flow.
                </p>
              </div>
              <div className="text-xs font-mono-tabular text-slate-500">
                House Floating Risk:{' '}
                <span className={spotStats.liveUnrealizedPnl >= 0 ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                  {spotStats.liveUnrealizedPnl >= 0 ? '-' : '+'}${formatUsd(Math.abs(spotStats.liveUnrealizedPnl))}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
              <div className="p-4.5">
                <div className="text-xs text-slate-500">Net Project Profit / Loss</div>
                <div
                  className={`mt-1 text-xl font-bold font-mono-tabular ${
                    projectSummary.totals.netProjectPnlUsd >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {projectSummary.totals.netProjectPnlUsd >= 0 ? '+' : '-'}$
                  {formatUsd(Math.abs(projectSummary.totals.netProjectPnlUsd))}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
                  Rev ${formatUsd(projectSummary.totals.grossRevenueUsd)} · Exp $
                  {formatUsd(projectSummary.totals.grossExpensesUsd)}
                </div>
              </div>

              <div className="p-4.5">
                <div className="text-xs text-slate-500">Spot Taker &amp; Maker Fees</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600">
                  +${formatUsd(projectSummary.spot.totalFeeUsd)}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
                  Taker ${formatUsd(projectSummary.spot.takerFeeUsd)} ({projectSummary.spot.takerOrdersCount}) · Maker $
                  {formatUsd(projectSummary.spot.makerFeeUsd)} ({projectSummary.spot.makerOrdersCount})
                </div>
              </div>

              <div className="p-4.5">
                <div className="text-xs text-slate-500">Spot Liquidation Revenue</div>
                <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600">
                  +${formatUsd(projectSummary.spot.liquidationUsd)}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
                  {projectSummary.spot.liquidationCount} liquidated position(s) forfeited
                </div>
              </div>

              <div className="p-4.5">
                <div className="text-xs text-slate-500">Net Treasury Cashflow</div>
                <div
                  className={`mt-1 text-xl font-bold font-mono-tabular ${
                    projectSummary.settlements.netCashflowUsd >= 0 ? 'text-slate-900' : 'text-red-600'
                  }`}
                >
                  {projectSummary.settlements.netCashflowUsd >= 0 ? '+' : '-'}$
                  {formatUsd(Math.abs(projectSummary.settlements.netCashflowUsd))}
                </div>
                <div className="mt-1.5 text-[11px] text-slate-500 font-mono-tabular">
                  In ${formatUsd(projectSummary.settlements.depositsApprovedUsd)} · Out $
                  {formatUsd(projectSummary.settlements.withdrawalsApprovedUsd)}
                </div>
              </div>
            </div>
          </div>

          {/* Project-by-Project P&L Breakdown + Exchange Settlement Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/40">
                <h3 className="text-sm font-semibold text-slate-900">Project-Wise Profit &amp; Loss Breakdown</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Realized revenue and expense streams across every exchange module.
                </p>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-4">Project / Stream</th>
                      <th className="py-2.5 px-4">Activity &amp; Volume</th>
                      <th className="py-2.5 px-4 text-right">Platform P&amp;L</th>
                      <th className="py-2.5 px-4 text-right">Module</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {(() => {
                      const ps = projectSummary!;
                      const cfg = platformSettings;
                      const wFee = cfg?.withdrawFeeUsd ?? 1.0;
                      const pFee = cfg?.p2pFeeUsd ?? 0.1;
                      const sFee = cfg?.sendFeeUsd ?? 0.2;
                      const takerPctLabel = Number(cfg?.spotTakerFeePct ?? 0.03).toFixed(2);
                      const makerPctLabel = Number(cfg?.spotMakerFeePct ?? 0.02).toFixed(2);
                      const exitPenaltyPct = Number(((cfg?.stakingEmergencyPenaltyRate ?? 0.005) * 100).toFixed(2));
                      const positionHousePnl = Number((-ps.spot.settledPositionTraderPnl).toFixed(2));
                      const rows: { name: string; meta: string; pnl: number; target: AdminTab }[] = [
                        {
                          name: `Spot Trading — Taker Fees (${takerPctLabel}%)`,
                          meta: `${ps.spot.takerOrdersCount} taker order(s) · Spot/Position fills`,
                          pnl: ps.spot.takerFeeUsd,
                          target: 'SPOT',
                        },
                        {
                          name: `Spot Trading — Maker Fees (${makerPctLabel}%)`,
                          meta: `${ps.spot.makerOrdersCount} resting limit fill(s)`,
                          pnl: ps.spot.makerFeeUsd,
                          target: 'SPOT',
                        },
                        {
                          name: 'Spot Trading — Liquidations',
                          meta: `${ps.spot.liquidationCount} liquidated position(s) collateral`,
                          pnl: ps.spot.liquidationUsd,
                          target: 'SPOT',
                        },
                        {
                          name: 'Spot Trading — Closed Position Settlements',
                          meta: `${ps.spot.settledPositionCount} settled · Trader P&L ${
                            ps.spot.settledPositionTraderPnl >= 0 ? '+' : '-'
                          }$${formatUsd(Math.abs(ps.spot.settledPositionTraderPnl))}`,
                          pnl: positionHousePnl,
                          target: 'SPOT',
                        },
                        {
                          name: 'Coin Presale (IPO Lot Fees & Payouts)',
                          meta: `${ps.presale.totalTickets} ticket(s) · Fee $${formatUsd(ps.presale.networkFeesUsd)} · Win bonus $${formatUsd(
                            ps.presale.winBonusCostUsd
                          )}`,
                          pnl: ps.presale.platformNetPnl,
                          target: 'PRESALE',
                        },
                        {
                          name: `Wallet & Transfer Fees ($${formatUsd(wFee)} Out · $${formatUsd(pFee)} P2P · $${formatUsd(sFee)} Send)`,
                          meta: `Withdraw $${formatUsd(ps.settlements.withdrawFeesUsd ?? 0)} · P2P $${formatUsd(
                            ps.settlements.p2pFeesUsd ?? 0
                          )} · Send $${formatUsd(ps.settlements.sendFeesUsd ?? 0)}`,
                          pnl: Number(
                            (
                              (ps.settlements.withdrawFeesUsd ?? 0) +
                              (ps.settlements.p2pFeesUsd ?? 0) +
                              (ps.settlements.sendFeesUsd ?? 0)
                            ).toFixed(2)
                          ),
                          target: 'WITHDRAWALS',
                        },
                        {
                          name: `Staking Vault (Monthly ROI, Draw & ${exitPenaltyPct}% Exit Fee)`,
                          meta: `${ps.staking.activeCount} active ($${formatUsd(ps.staking.activePrincipalUsd)}) · ROI $${formatUsd(
                            ps.staking.roiPaidUsd
                          )} · Draw $${formatUsd(ps.staking.monthlyDrawPaidUsd)}${
                            (ps.staking.emergencyPenaltiesUsd ?? 0) > 0
                              ? ` · Penalty +$${formatUsd(ps.staking.emergencyPenaltiesUsd ?? 0)}`
                              : ''
                          }`,
                          pnl: ps.staking.platformNetPnl,
                          target: 'STAKING',
                        },
                        {
                          name: 'Rewards, Referrals & Lucky Draw',
                          meta: `${ps.rewards.referralsCreditedCount} referrals ($${formatUsd(
                            ps.rewards.referralsCreditedUsd
                          )})${
                            (ps.rewards.milestoneBonusPaidUsd ?? 0) > 0
                              ? ` · ${ps.rewards.milestoneClaimsCount ?? 0} milestones ($${formatUsd(
                                  ps.rewards.milestoneBonusPaidUsd ?? 0
                                )})`
                              : ''
                          } · ${ps.rewards.luckyDrawsCompletedCount} draws ($${formatUsd(
                            ps.rewards.luckyDrawPrizesPaidUsd
                          )})`,
                          pnl: ps.rewards.platformNetPnl,
                          target: 'REWARDS',
                        },
                      ];

                      return rows.map((row) => (
                        <tr key={row.name} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-medium text-slate-900">{row.name}</td>
                          <td className="py-2.5 px-4 font-mono-tabular text-slate-500">{row.meta}</td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                              row.pnl > 0 ? 'text-emerald-600' : row.pnl < 0 ? 'text-red-600' : 'text-slate-600'
                            }`}
                          >
                            {row.pnl >= 0 ? '+' : '-'}${formatUsd(Math.abs(row.pnl))}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => setTab(row.target)}
                              className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/80 text-xs font-semibold">
                      <td className="py-3 px-4 text-slate-900">Total Realized Project Net P&amp;L</td>
                      <td className="py-3 px-4 font-mono-tabular text-slate-500">
                        Spot Vol ${formatUsd(projectSummary.spot.totalVolumeUsd)} · {projectSummary.spot.totalOrders} orders
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono-tabular whitespace-nowrap ${
                          projectSummary.totals.netProjectPnlUsd >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {projectSummary.totals.netProjectPnlUsd >= 0 ? '+' : '-'}$
                        {formatUsd(Math.abs(projectSummary.totals.netProjectPnlUsd))}
                      </td>
                      <td className="py-3 px-4" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="lg:col-span-5 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
              <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/40">
                <h3 className="text-sm font-semibold text-slate-900">Settlement &amp; Custody Summary</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Completed settlements, escrows, and user wallet obligations.
                </p>
              </div>
              <div className="divide-y divide-slate-100 px-4 py-1 text-xs flex-1">
                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">Deposits Settled (Approved)</div>
                    <div className="text-slate-500 font-mono-tabular">
                      {projectSummary.settlements.depositsApprovedCount} approved ·{' '}
                      {projectSummary.settlements.depositsPendingCount} pending ($
                      {formatUsd(projectSummary.settlements.depositsPendingUsd)})
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-emerald-600 shrink-0">
                    +${formatUsd(projectSummary.settlements.depositsApprovedUsd)}
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">Withdrawals Settled (Paid Out)</div>
                    <div className="text-slate-500 font-mono-tabular">
                      {projectSummary.settlements.withdrawalsApprovedCount} completed ·{' '}
                      {projectSummary.settlements.withdrawalsPendingCount} held ($
                      {formatUsd(projectSummary.settlements.withdrawalsPendingUsd)})
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-red-600 shrink-0">
                    -${formatUsd(projectSummary.settlements.withdrawalsApprovedUsd)}
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">P2P Escrow Settlements</div>
                    <div className="text-slate-500 font-mono-tabular">
                      {projectSummary.settlements.p2pSettledCount} settled · Active escrow $
                      {formatUsd(projectSummary.settlements.p2pEscrowUsd)}
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-slate-900 shrink-0">
                    ${formatUsd(projectSummary.settlements.p2pSettledUsd)}
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">Presale Lot Settlements</div>
                    <div className="text-slate-500 font-mono-tabular">
                      {projectSummary.presale.winCount} WIN (${formatUsd(projectSummary.presale.winPayoutsUsd)}) ·{' '}
                      {projectSummary.presale.lossCount} refunded (${formatUsd(projectSummary.presale.lossRefundsUsd)})
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-slate-900 shrink-0">
                    ${formatUsd(projectSummary.presale.winPayoutsUsd + projectSummary.presale.lossRefundsUsd)}
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">Staking Principal &amp; Yield</div>
                    <div className="text-slate-500 font-mono-tabular">
                      Active ${formatUsd(projectSummary.staking.activePrincipalUsd)} · Returned $
                      {formatUsd(projectSummary.staking.completedPrincipalUsd)}
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-slate-900 shrink-0">
                    ${formatUsd(projectSummary.staking.totalCostUsd)} paid
                  </div>
                </div>

                <div className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">User Wallet Liabilities</div>
                    <div className="text-slate-500 font-mono-tabular">
                      Main ${formatUsd(projectSummary.settlements.userMainLiabilityUsd)} · Claimable $
                      {formatUsd(projectSummary.settlements.userClaimableLiabilityUsd)} · Locked $
                      {formatUsd(projectSummary.settlements.userLockedLiabilityUsd)}
                    </div>
                  </div>
                  <div className="font-mono-tabular font-bold text-slate-900 shrink-0">
                    ${formatUsd(projectSummary.settlements.userTotalLiabilityUsd)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Cohorts + Department Action Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-5 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Account &amp; Verification Status</h2>
              <p className="text-xs text-slate-500 mt-0.5">Click any cohort to open User Management.</p>
            </div>
            <button
              type="button"
              onClick={() => jumpToUsers('ALL')}
              className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
            >
              Manage all
            </button>
          </div>

          <div className="divide-y divide-slate-100 p-2 flex-1">
            {[
              {
                label: 'Active Users',
                desc: 'Accounts permitted to trade, stake, and transfer',
                count: metrics.activeUsers,
                color: 'text-emerald-600',
                filter: 'ACTIVE' as UserFilter,
              },
              {
                label: 'Inactive / Suspended Users',
                desc: 'Blocked from authentication and order execution',
                count: metrics.inactiveUsers,
                color: 'text-red-600',
                filter: 'INACTIVE' as UserFilter,
              },
              {
                label: 'Verified Users (KYC Passed)',
                desc: 'Identity and gateway compliance approved',
                count: metrics.verifiedUsers,
                color: 'text-blue-600',
                filter: 'VERIFIED' as UserFilter,
              },
              {
                label: 'Unverified Users (Pending KYC)',
                desc: 'Awaiting administrator verification review',
                count: metrics.unverifiedUsers,
                color: 'text-amber-600',
                filter: 'UNVERIFIED' as UserFilter,
              },
            ].map((row) => (
              <button
                key={row.filter}
                type="button"
                onClick={() => jumpToUsers(row.filter)}
                className="w-full py-3 px-2.5 flex items-center justify-between text-left hover:bg-slate-50/80 rounded-lg transition-colors"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-900">{row.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{row.desc}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-base font-bold font-mono-tabular ${row.color}`}>{row.count}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white overflow-hidden flex flex-col">
          <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/40">
            <h2 className="text-sm font-semibold text-slate-900">Department Operations Status</h2>
            <p className="text-xs text-slate-500 mt-0.5">Live operational workload across exchange modules.</p>
          </div>

          <div className="divide-y divide-slate-100 px-4 py-1 flex-1">
            {[
              {
                title: 'Manual Deposit Approvals',
                meta: `Approved volume: $${formatUsd(metrics.approvedDepositsTotal)}`,
                statusText:
                  metrics.pendingDepositsCount > 0
                    ? `${metrics.pendingDepositsCount} pending ($${formatUsd(metrics.pendingDepositsAmt)})`
                    : 'Queue clear',
                urgent: metrics.pendingDepositsCount > 0,
                target: 'DEPOSITS' as AdminTab,
              },
              {
                title: 'Withdrawal Payout Processing',
                meta: `Processed payouts: $${formatUsd(metrics.approvedWithdrawalsTotal)}`,
                statusText:
                  metrics.pendingWithdrawalsCount > 0
                    ? `${metrics.pendingWithdrawalsCount} awaiting payout ($${formatUsd(metrics.pendingWithdrawalsAmt)})`
                    : 'Queue clear',
                urgent: metrics.pendingWithdrawalsCount > 0,
                target: 'WITHDRAWALS' as AdminTab,
              },
              {
                title: 'P2P Market & Dispute Arbitration',
                meta: `${activeP2pOffersCount} active marketplace offers`,
                statusText: metrics.disputedP2p > 0 ? `${metrics.disputedP2p} disputed order(s)` : 'No disputes',
                urgent: metrics.disputedP2p > 0,
                target: 'P2P' as AdminTab,
              },
              {
                title: 'Spot Markets & Open Positions',
                meta: `${displayMarkets.length} live trading pairs`,
                statusText: `${metrics.openTradesCount} open trade(s) ($${formatUsd(metrics.openTradesVolume)})`,
                urgent: false,
                target: 'SPOT' as AdminTab,
              },
              {
                title: 'Staking Vaults, Presale & Referrals',
                meta: `Staking profits paid: $${formatUsd(metrics.totalStakingProfitPaid)}`,
                statusText: `${metrics.pendingPresaleTickets} presale ticket(s) · ${metrics.pendingReferrals} pending referral(s)`,
                urgent: metrics.pendingPresaleTickets > 0 || metrics.pendingReferrals > 0,
                target: metrics.pendingPresaleTickets > 0 ? ('PRESALE' as AdminTab) : ('REWARDS' as AdminTab),
              },
            ].map((q) => (
              <div key={q.title} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">{q.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono-tabular">{q.meta}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-medium font-mono-tabular ${q.urgent ? 'text-amber-600' : 'text-slate-600'}`}>
                    {q.statusText}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTab(q.target)}
                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Platform Ledger Activity */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50/40 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recent Platform Ledger Activity</h2>
            <p className="text-xs text-slate-500 mt-0.5">Latest 8 financial movements across user wallets.</p>
          </div>
          <button
            type="button"
            onClick={() => setTab('TRANSACTIONS')}
            className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
          >
            View all transactions
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Account</th>
                <th className="py-2.5 px-4">Wallet · Type</th>
                <th className="py-2.5 px-4">Description</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {recentTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                    {formatDateTime(tx.created_at)}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-medium text-slate-900">{tx.user_name}</span>{' '}
                    <span className="text-slate-400 font-mono-tabular">· {tx.user_id}</span>
                  </td>
                  <td className="py-2.5 px-4 font-mono-tabular text-slate-700">
                    {tx.wallet_type} · {tx.tx_type}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600 max-w-md truncate">{tx.description}</td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                      tx.amount >= 0 ? 'text-emerald-600' : 'text-slate-900'
                    }`}
                  >
                    {tx.amount >= 0 ? '+' : ''}${formatUsd(tx.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
