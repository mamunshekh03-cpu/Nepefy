import React, { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Eye,
  FileCheck2,
  MessageSquare,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../../lib/api';
import type { UserProfile } from '../../types';
import type { AdminMetrics, AdminOverviewData, AdminTab, RunActionFn, UserFilter } from './adminTypes';

interface AdminUsersTabProps {
  currentUserId: string;
  data: AdminOverviewData;
  metrics: AdminMetrics;
  filteredUsers: UserProfile[];
  userFilter: UserFilter;
  setUserFilter: (f: UserFilter) => void;
  userSearch: string;
  setUserSearch: (s: string) => void;
  runAction: RunActionFn;
  onOpenWalletAdjust: (u: UserProfile) => void;
  onOpenChat: (userId: string) => void;
  onPreviewImage: (src: string) => void;
  setTab: (t: AdminTab) => void;
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  currentUserId,
  data,
  metrics,
  filteredUsers,
  userFilter,
  setUserFilter,
  userSearch,
  setUserSearch,
  runAction,
  onOpenWalletAdjust,
  onOpenChat,
  onPreviewImage,
  setTab,
}) => {
  const [subView, setSubView] = useState<'ACCOUNTS' | 'KYC_QUEUE'>('ACCOUNTS');
  const [kycStatusFilter, setKycStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [kycNoteMap, setKycNoteMap] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingUser, setDeletingUser] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const kycSubmissions = data.kycSubmissions || [];
  const pendingKycCount = kycSubmissions.filter((k) => k.status === 'PENDING').length;
  const filteredKyc = kycSubmissions.filter(
    (k) => kycStatusFilter === 'ALL' || k.status === kycStatusFilter
  );

  return (
    <div className="space-y-5">
      {/* Hairline-Divided User Cohort Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
        {[
          { label: 'Total Accounts', value: data.users.length, color: 'text-slate-900', action: () => { setSubView('ACCOUNTS'); setUserFilter('ALL'); } },
          { label: 'Active Status', value: metrics.activeUsers, color: 'text-emerald-600', action: () => { setSubView('ACCOUNTS'); setUserFilter('ACTIVE'); } },
          { label: 'KYC Verified', value: metrics.verifiedUsers, color: 'text-blue-600', action: () => { setSubView('ACCOUNTS'); setUserFilter('VERIFIED'); } },
          { label: 'Pending ID Reviews', value: pendingKycCount, color: pendingKycCount > 0 ? 'text-amber-600' : 'text-slate-700', action: () => { setSubView('KYC_QUEUE'); setKycStatusFilter('PENDING'); } },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="p-4 text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="text-xs text-slate-500">{item.label}</div>
            <div className={`mt-1 text-xl font-bold font-mono-tabular ${item.color}`}>{item.value}</div>
          </button>
        ))}
      </div>

      {/* Section Switcher */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setSubView('ACCOUNTS')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            subView === 'ACCOUNTS' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          User Accounts ({data.users.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('KYC_QUEUE')}
          className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            subView === 'KYC_QUEUE' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>KYC Document Queue</span>
          {pendingKycCount > 0 && (
            <span className="font-mono-tabular font-bold text-amber-600">{pendingKycCount}</span>
          )}
        </button>
      </div>

      {subView === 'ACCOUNTS' ? (
        /* Unified User Table Card */
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  ['ALL', `All (${data.users.length})`],
                  ['ACTIVE', `Active (${metrics.activeUsers})`],
                  ['INACTIVE', `Inactive (${metrics.inactiveUsers})`],
                  ['VERIFIED', `Verified (${metrics.verifiedUsers})`],
                  ['UNVERIFIED', `Unverified (${metrics.unverifiedUsers})`],
                ] as [UserFilter, string][]
              ).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setUserFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    userFilter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search name, email, ID, ref code..."
                className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Account</th>
                  <th className="py-3 px-4">Role · Ref Code</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4">KYC Status</th>
                  <th className="py-3 px-4 text-right">Main Balance</th>
                  <th className="py-3 px-4 text-right">Profit Balance</th>
                  <th className="py-3 px-4 text-right">Claimable</th>
                  <th className="py-3 px-4 text-right">Escrow</th>
                  <th className="py-3 px-4 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 px-4 text-center text-slate-500">
                      No user accounts match the selected filter.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isActive = (u.status || 'ACTIVE') === 'ACTIVE';
                    const isVerified = (u.kyc_status || 'UNVERIFIED') === 'VERIFIED';
                    const isSelf = u.id === currentUserId;
                    const isAdmin = u.role === 'ADMIN';
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{u.full_name}</div>
                          <div className="text-slate-500 font-mono-tabular">
                            {u.id} · {u.email}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-600">
                          <span className={isAdmin ? 'text-blue-600 font-semibold' : 'text-slate-800 font-medium'}>
                            {u.role}
                          </span>{' '}
                          · {u.referral_code}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 font-medium ${
                              isActive ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                            <span>{isActive ? 'Active' : 'Inactive'}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1.5 font-medium ${
                              isVerified ? 'text-blue-700' : 'text-amber-600'
                            }`}
                          >
                            {isVerified ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                            <span>{isVerified ? 'Verified' : 'Unverified'}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                          ${formatUsd(u.main_balance)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-medium text-emerald-600">
                          ${formatUsd(u.profit_balance || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-blue-600">
                          ${formatUsd(u.claimable_balance)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                          ${formatUsd(u.locked_balance)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() =>
                                runAction(async () => {
                                  const next = isActive ? 'INACTIVE' : 'ACTIVE';
                                  await apiFetch(`/api/admin/users/${u.id}/status`, {
                                    method: 'POST',
                                    body: JSON.stringify({ status: next }),
                                  });
                                  return `Set ${u.full_name} account status to ${next}.`;
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap disabled:opacity-40 ${
                                isActive
                                  ? 'border-red-200 text-red-600 hover:bg-red-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {isActive ? <UserX className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                              <span>{isActive ? 'Deactivate' : 'Activate'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                runAction(async () => {
                                  const next = isVerified ? 'UNVERIFIED' : 'VERIFIED';
                                  await apiFetch(`/api/admin/users/${u.id}/status`, {
                                    method: 'POST',
                                    body: JSON.stringify({ kyc_status: next }),
                                  });
                                  return `Marked ${u.full_name} KYC as ${next}.`;
                                })
                              }
                              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-medium whitespace-nowrap"
                            >
                              {isVerified ? 'Unverify' : 'Verify KYC'}
                            </button>

                            <button
                              type="button"
                              disabled={isSelf}
                              title={isSelf ? 'Cannot demote active admin session' : 'Toggle User/Admin role'}
                              onClick={() =>
                                runAction(async () => {
                                  const nextRole = isAdmin ? 'USER' : 'ADMIN';
                                  await apiFetch(`/api/admin/users/${u.id}/status`, {
                                    method: 'POST',
                                    body: JSON.stringify({ role: nextRole }),
                                  });
                                  return `Updated ${u.full_name} role to ${nextRole}.`;
                                })
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap disabled:opacity-40 ${
                                isAdmin
                                  ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                                  : 'border-indigo-200 text-indigo-700 hover:bg-indigo-50'
                              }`}
                            >
                              <Shield className="w-3 h-3" />
                              <span>{isAdmin ? 'Set User' : 'Make Admin'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onOpenWalletAdjust(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-medium whitespace-nowrap"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>Wallet</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                onOpenChat(u.id);
                                setTab('SUPPORT');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium whitespace-nowrap"
                            >
                              <MessageSquare className="w-3 h-3" />
                              <span>Chat</span>
                            </button>

                            <button
                              type="button"
                              disabled={isSelf || isAdmin}
                              title={
                                isSelf
                                  ? 'Cannot delete your active admin session'
                                  : isAdmin
                                  ? 'Demote admin to USER before deleting'
                                  : 'Permanently delete user account'
                              }
                              onClick={() => {
                                setDeleteTarget(u);
                                setDeleteConfirmText('');
                                setDeleteError(null);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50/70 hover:bg-red-100 text-red-700 font-medium whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete</span>
                            </button>
                          </div>
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
        /* Document KYC Submission Queue */
        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setKycStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    kycStatusFilter === status ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'ALL' ? `All (${kycSubmissions.length})` : status}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500">
              Inspect government ID photos before approving account verification
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Document Type · ID Number</th>
                  <th className="py-3 px-4">Submitted Photos</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Review Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredKyc.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 px-4 text-center text-slate-500">
                      No KYC document submissions match this status filter.
                    </td>
                  </tr>
                ) : (
                  filteredKyc.map((sub) => {
                    const noteVal = kycNoteMap[sub.id] ?? '';
                    return (
                      <tr key={sub.id} className="hover:bg-slate-50/60 align-top">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{sub.legal_name}</div>
                          <div className="text-slate-500 font-mono-tabular">
                            {sub.user_name || sub.user_id} · {sub.user_email}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono-tabular mt-0.5">
                            {formatDateTime(sub.created_at)}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{sub.doc_type.replace('_', ' ')}</div>
                          <div className="font-mono-tabular text-slate-600 mt-0.5">#{sub.doc_number}</div>
                          {sub.admin_note && (
                            <div className="text-[11px] text-slate-500 mt-1">Note: {sub.admin_note}</div>
                          )}
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onPreviewImage(sub.doc_front_data)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-blue-600 font-medium whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>ID Front</span>
                            </button>
                            {sub.selfie_data && (
                              <button
                                type="button"
                                onClick={() => onPreviewImage(sub.selfie_data!)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-blue-600 font-medium whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Selfie</span>
                              </button>
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              sub.status === 'APPROVED'
                                ? 'text-emerald-600'
                                : sub.status === 'REJECTED'
                                ? 'text-red-600'
                                : 'text-amber-600'
                            }`}
                          >
                            {sub.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          {sub.status === 'PENDING' ? (
                            <div className="inline-flex flex-col sm:flex-row items-end sm:items-center gap-1.5">
                              <input
                                type="text"
                                value={noteVal}
                                onChange={(e) =>
                                  setKycNoteMap((prev) => ({ ...prev, [sub.id]: e.target.value }))
                                }
                                placeholder="Optional review note..."
                                className="h-8 px-2.5 text-xs border border-slate-200 rounded-lg bg-white w-44 focus:outline-none focus:border-blue-600"
                              />
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    runAction(async () => {
                                      await apiFetch(`/api/admin/kyc/${sub.id}/review`, {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          decision: 'APPROVE',
                                          admin_note: noteVal,
                                        }),
                                      });
                                      return `Approved KYC for ${sub.legal_name}.`;
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Approve</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    runAction(async () => {
                                      await apiFetch(`/api/admin/kyc/${sub.id}/review`, {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          decision: 'REJECT',
                                          admin_note: noteVal || 'Document unclear or mismatched',
                                        }),
                                      });
                                      return `Rejected KYC submission for ${sub.legal_name}.`;
                                    })
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold whitespace-nowrap"
                                >
                                  <XCircle className="w-3 h-3" />
                                  <span>Reject</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 font-mono-tabular">
                              {sub.reviewed_at ? formatDateTime(sub.reviewed_at) : 'Reviewed'}
                            </span>
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
      )}

      {/* Safe Delete User Confirmation Modal */}
      {deleteTarget && (
        <div
          onClick={() => {
            if (!deletingUser) setDeleteTarget(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-lg"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center text-red-600 shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Delete User Permanently</h3>
                  <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone.</p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingUser}
                onClick={() => setDeleteTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-3 space-y-1.5 text-xs">
              <div className="font-semibold text-slate-900">{deleteTarget.full_name}</div>
              <div className="text-slate-600 font-mono-tabular break-all">
                {deleteTarget.email} · {deleteTarget.id}
              </div>
              <div className="flex flex-wrap gap-3 pt-1 text-[11px] font-mono-tabular text-slate-600">
                <span>Main: ${formatUsd(deleteTarget.main_balance)}</span>
                <span>Claimable: ${formatUsd(deleteTarget.claimable_balance)}</span>
                <span>Escrow: ${formatUsd(deleteTarget.locked_balance)}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Deleting this account removes the user profile, sessions, ledger records, KYC submissions, and OTP logs,
              allowing the email to be registered again. Accounts with active or disputed P2P escrow orders cannot be
              deleted until resolved.
            </p>

            {deleteError && (
              <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg">
                {deleteError}
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (deleteConfirmText.trim().toUpperCase() !== 'DELETE' || deletingUser) return;
                const target = deleteTarget;
                setDeletingUser(true);
                setDeleteError(null);
                try {
                  await apiFetch(`/api/admin/users/${target.id}`, {
                    method: 'DELETE',
                  });
                  setDeleteTarget(null);
                  setDeleteConfirmText('');
                  await runAction(async () => `Permanently deleted user ${target.full_name} (${target.email}).`);
                } catch (err: any) {
                  setDeleteError(err?.message || 'Failed to delete user account');
                } finally {
                  setDeletingUser(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Type <span className="font-mono-tabular font-bold text-red-600">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={deletingUser}
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 h-9 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletingUser || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                  className="inline-flex items-center gap-1.5 px-4 h-9 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-45 text-white rounded-lg cursor-pointer disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{deletingUser ? 'Deleting...' : 'Delete Permanently'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

