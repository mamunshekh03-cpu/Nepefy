import React from 'react';
import { Eye, Search } from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../../lib/api';
import { GatewayLogo } from '../CryptoIcon';
import { SelectDropdown } from '../SelectDropdown';
import type { DepositRequest, LedgerEntry, WithdrawRequest } from '../../types';
import type { AdminMetrics, AdminOverviewData, RunActionFn } from './adminTypes';

interface AdminDepositsTabProps {
  data: AdminOverviewData;
  metrics: AdminMetrics;
  filteredDeposits: DepositRequest[];
  depositStatusFilter: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
  setDepositStatusFilter: (v: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED') => void;
  depositGatewayFilter: 'ALL' | 'Binance' | 'Bybit';
  setDepositGatewayFilter: (v: 'ALL' | 'Binance' | 'Bybit') => void;
  depositSearch: string;
  setDepositSearch: (v: string) => void;
  setPreviewImg: (src: string | null) => void;
  runAction: RunActionFn;
}

export const AdminDepositsTab: React.FC<AdminDepositsTabProps> = ({
  data,
  metrics,
  filteredDeposits,
  depositStatusFilter,
  setDepositStatusFilter,
  depositGatewayFilter,
  setDepositGatewayFilter,
  depositSearch,
  setDepositSearch,
  setPreviewImg,
  runAction,
}) => {
  return (
    <div className="space-y-5">
      {/* Hairline KPI Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Pending Verification</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-amber-600">
            {metrics.pendingDepositsCount} · ${formatUsd(metrics.pendingDepositsAmt)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Total Approved Deposits</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600">
            ${formatUsd(metrics.approvedDepositsTotal)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Total Requests Logged</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">{data.deposits.length}</div>
        </div>
      </div>

      {/* Unified Deposits Table Card */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setDepositStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    depositStatusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'Binance', 'Bybit'] as const).map((gw) => (
                <button
                  key={gw}
                  type="button"
                  onClick={() => setDepositGatewayFilter(gw)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    depositGatewayFilter === gw ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {gw === 'ALL' ? 'All Gateways' : gw}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={depositSearch}
              onChange={(e) => setDepositSearch(e.target.value)}
              placeholder="Search user or TrxID..."
              className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">ID · Submitted</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Gateway · TrxID</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Proof</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredDeposits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                    No deposits match the current filters.
                  </td>
                </tr>
              ) : (
                filteredDeposits.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono-tabular">
                      <div className="font-medium text-slate-900">{d.id}</div>
                      <div className="text-slate-500">{formatDateTime(d.created_at)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{d.user_name}</div>
                      <div className="text-slate-500 font-mono-tabular">{d.user_email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <GatewayLogo gateway={d.gateway} size="sm" />
                      <div className="font-mono-tabular text-slate-500 mt-0.5">{d.trx_id}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                      ${formatUsd(d.amount)}
                    </td>
                    <td className="py-3 px-4">
                      {d.screenshot_data ? (
                        <button
                          type="button"
                          onClick={() => setPreviewImg(d.screenshot_data)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>
                      ) : (
                        <span className="text-slate-400">No proof</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium">
                      <span
                        className={
                          d.status === 'APPROVED'
                            ? 'text-emerald-600'
                            : d.status === 'REJECTED'
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {d.status === 'PENDING' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/deposits/${d.id}/review`, {
                                  method: 'POST',
                                  body: JSON.stringify({ decision: 'APPROVE' }),
                                });
                                return `Approved deposit ${d.id} ($${formatUsd(d.amount)}) to ${d.user_name}'s Main Balance.`;
                              })
                            }
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg whitespace-nowrap"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/deposits/${d.id}/review`, {
                                  method: 'POST',
                                  body: JSON.stringify({ decision: 'REJECT', admin_note: 'Invalid TrxID' }),
                                });
                                return `Rejected deposit ${d.id}.`;
                              })
                            }
                            className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 font-medium rounded-lg whitespace-nowrap"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono-tabular">
                          {d.reviewed_at ? formatDateTime(d.reviewed_at) : 'Reviewed'}
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
    </div>
  );
};

interface AdminWithdrawalsTabProps {
  data: AdminOverviewData;
  metrics: AdminMetrics;
  filteredWithdrawals: WithdrawRequest[];
  withdrawStatusFilter: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
  setWithdrawStatusFilter: (v: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED') => void;
  withdrawGatewayFilter: 'ALL' | 'Binance' | 'Bybit';
  setWithdrawGatewayFilter: (v: 'ALL' | 'Binance' | 'Bybit') => void;
  withdrawSearch: string;
  setWithdrawSearch: (v: string) => void;
  runAction: RunActionFn;
}

export const AdminWithdrawalsTab: React.FC<AdminWithdrawalsTabProps> = ({
  data,
  metrics,
  filteredWithdrawals,
  withdrawStatusFilter,
  setWithdrawStatusFilter,
  withdrawGatewayFilter,
  setWithdrawGatewayFilter,
  withdrawSearch,
  setWithdrawSearch,
  runAction,
}) => {
  return (
    <div className="space-y-5">
      {/* Hairline KPI Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Pending Payouts (Escrowed)</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-amber-600">
            {metrics.pendingWithdrawalsCount} · ${formatUsd(metrics.pendingWithdrawalsAmt)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Approved Payout Volume</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-blue-600">
            ${formatUsd(metrics.approvedWithdrawalsTotal)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Total Withdrawals Logged</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">{data.withdrawals.length}</div>
        </div>
      </div>

      {/* Unified Withdrawals Table Card */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setWithdrawStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    withdrawStatusFilter === st ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All' : st.charAt(0) + st.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'Binance', 'Bybit'] as const).map((gw) => (
                <button
                  key={gw}
                  type="button"
                  onClick={() => setWithdrawGatewayFilter(gw)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    withdrawGatewayFilter === gw ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {gw === 'ALL' ? 'All Gateways' : gw}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={withdrawSearch}
              onChange={(e) => setWithdrawSearch(e.target.value)}
              placeholder="Search user or destination..."
              className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">ID · Requested</th>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Gateway · Destination</th>
                <th className="py-3 px-4 text-right">Held Amount</th>
                <th className="py-3 px-4">Note</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredWithdrawals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                    No withdrawal requests match the current filters.
                  </td>
                </tr>
              ) : (
                filteredWithdrawals.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono-tabular">
                      <div className="font-medium text-slate-900">{w.id}</div>
                      <div className="text-slate-500">{formatDateTime(w.created_at)}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{w.user_name}</div>
                      <div className="text-slate-500 font-mono-tabular">{w.user_email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <GatewayLogo gateway={w.gateway} size="sm" />
                      <div className="font-mono-tabular text-slate-500 mt-0.5">{w.destination_address}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular">
                      <div className="font-semibold text-slate-900">${formatUsd(w.amount)}</div>
                      <div className="text-slate-500">Fee ${formatUsd(w.fee_usd ?? 0)}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{w.proof_note || '—'}</td>
                    <td className="py-3 px-4 font-medium">
                      <span
                        className={
                          w.status === 'APPROVED'
                            ? 'text-emerald-600'
                            : w.status === 'REJECTED'
                            ? 'text-red-600'
                            : 'text-amber-600'
                        }
                      >
                        {w.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {w.status === 'PENDING' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/withdrawals/${w.id}/review`, {
                                  method: 'POST',
                                  body: JSON.stringify({ decision: 'APPROVE' }),
                                });
                                return `Approved withdrawal ${w.id} ($${formatUsd(w.amount)}).`;
                              })
                            }
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg whitespace-nowrap"
                          >
                            Approve Payout
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              runAction(async () => {
                                await apiFetch(`/api/admin/withdrawals/${w.id}/review`, {
                                  method: 'POST',
                                  body: JSON.stringify({ decision: 'REJECT', admin_note: 'Returned to Main Balance' }),
                                });
                                return `Rejected withdrawal ${w.id} and refunded Main Balance.`;
                              })
                            }
                            className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 font-medium rounded-lg whitespace-nowrap"
                          >
                            Reject &amp; Refund
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono-tabular">
                          {w.reviewed_at ? formatDateTime(w.reviewed_at) : 'Processed'}
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
    </div>
  );
};

interface AdminSendTabProps {
  data: AdminOverviewData;
  sendMode: 'TREASURY_SEND' | 'USER_TO_USER';
  setSendMode: (m: 'TREASURY_SEND' | 'USER_TO_USER') => void;
  sendFromId: string;
  setSendFromId: (id: string) => void;
  sendToId: string;
  setSendToId: (id: string) => void;
  sendWalletType: 'MAIN' | 'CLAIMABLE';
  setSendWalletType: (w: 'MAIN' | 'CLAIMABLE') => void;
  sendAmount: string;
  setSendAmount: (v: string) => void;
  sendNote: string;
  setSendNote: (v: string) => void;
  sendSearch: string;
  setSendSearch: (v: string) => void;
  sendTransactions: LedgerEntry[];
  runAction: RunActionFn;
}

export const AdminSendTab: React.FC<AdminSendTabProps> = ({
  data,
  sendMode,
  setSendMode,
  sendFromId,
  setSendFromId,
  sendToId,
  setSendToId,
  sendWalletType,
  setSendWalletType,
  sendAmount,
  setSendAmount,
  sendNote,
  setSendNote,
  sendSearch,
  setSendSearch,
  sendTransactions,
  runAction,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAction(async () => {
            const res = await apiFetch<{ referenceId: string; amount: number }>('/api/admin/send', {
              method: 'POST',
              body: JSON.stringify({
                mode: sendMode,
                from_user_id: sendMode === 'USER_TO_USER' ? sendFromId : undefined,
                to_user_id: sendToId,
                wallet_type: sendMode === 'TREASURY_SEND' ? sendWalletType : 'MAIN',
                amount: Number(sendAmount),
                note: sendNote,
              }),
            });
            setSendNote('');
            return `Transfer ${res.referenceId} completed ($${formatUsd(res.amount)}).`;
          });
        }}
        className="lg:col-span-4 border border-slate-200 rounded-xl bg-white p-5 flex flex-col justify-between space-y-5"
      >
        <div className="space-y-4">
          <div className="pb-3.5 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Direct Send &amp; Treasury Transfer</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Send USDT from platform treasury or route peer transfers between accounts.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSendMode('TREASURY_SEND')}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                sendMode === 'TREASURY_SEND' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Treasury → User
            </button>
            <button
              type="button"
              onClick={() => setSendMode('USER_TO_USER')}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors ${
                sendMode === 'USER_TO_USER' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              User → User
            </button>
          </div>

          {sendMode === 'USER_TO_USER' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Sender Account</label>
              <SelectDropdown
                value={sendFromId}
                onChange={setSendFromId}
                options={data.users.map((u) => ({
                  value: u.id,
                  label: `${u.full_name} (${u.id})`,
                  hint: `$${formatUsd(u.main_balance)}`,
                }))}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Recipient Account</label>
            <SelectDropdown
              value={sendToId}
              onChange={setSendToId}
              options={data.users.map((u) => ({
                value: u.id,
                label: `${u.full_name} (${u.id})`,
                hint: `$${formatUsd(u.main_balance)}`,
              }))}
            />
          </div>

          {sendMode === 'TREASURY_SEND' && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Target Wallet</label>
              <div className="grid grid-cols-2 gap-2">
                {(['MAIN', 'CLAIMABLE'] as const).map((wt) => (
                  <button
                    key={wt}
                    type="button"
                    onClick={() => setSendWalletType(wt)}
                    className={`h-9 text-xs font-medium rounded-lg border ${
                      sendWalletType === wt
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {wt === 'MAIN' ? 'Main Balance' : 'Claimable Wallet'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Amount (USDT)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Reference Note</label>
            <input
              type="text"
              value={sendNote}
              onChange={(e) => setSendNote(e.target.value)}
              placeholder="Settlement, bonus, or OTC transfer"
              className="w-full h-10 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!sendToId || (sendMode === 'USER_TO_USER' && !sendFromId)}
          className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Execute Transfer Now
        </button>
      </form>

      <div className="lg:col-span-8 border border-slate-200 rounded-xl bg-white flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Send &amp; Internal Transfer Feed</h2>
            <p className="text-xs text-slate-500">All peer-to-peer sends, treasury disbursements, and manual wallet adjustments.</p>
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={sendSearch}
              onChange={(e) => setSendSearch(e.target.value)}
              placeholder="Filter user or ref ID..."
              className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-2.5 px-4">Ref · Time</th>
                <th className="py-2.5 px-4">Account</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Details</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {sendTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                    No transfer records found.
                  </td>
                </tr>
              ) : (
                sendTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 font-mono-tabular whitespace-nowrap">
                      <div className="font-medium text-slate-900">{tx.reference_id}</div>
                      <div className="text-slate-500">{formatDateTime(tx.created_at)}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{tx.user_name}</div>
                      <div className="text-slate-500 font-mono-tabular">{tx.user_id}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-700">
                      {tx.tx_type} · {tx.wallet_type}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{tx.description}</td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                        tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {tx.amount >= 0 ? '+' : ''}${formatUsd(tx.amount)}
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
