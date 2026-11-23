import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { formatDateTime } from '../../lib/api';
import type { AdminAuditLog } from '../../types';

interface AdminAuditLogsTabProps {
  logs: AdminAuditLog[];
}

export const AdminAuditLogsTab: React.FC<AdminAuditLogsTabProps> = ({ logs }) => {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');

  const actionTypes = useMemo(() => {
    const set = new Set<string>(logs.map((l) => l.action_type));
    return ['ALL', ...Array.from(set).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((log) => {
      if (actionFilter !== 'ALL' && log.action_type !== actionFilter) return false;
      if (!q) return true;
      return (
        log.admin_email.toLowerCase().includes(q) ||
        log.action_type.toLowerCase().includes(q) ||
        log.target_type.toLowerCase().includes(q) ||
        log.target_id.toLowerCase().includes(q) ||
        log.summary.toLowerCase().includes(q) ||
        log.ip_address.toLowerCase().includes(q)
      );
    });
  }, [logs, search, actionFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>Admin Security &amp; Audit Trail</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable operational log of administrative approvals, balance adjustments, KYC reviews, role changes, and settings updates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
          >
            {actionTypes.map((type) => (
              <option key={type} value={type}>
                {type === 'ALL' ? 'All Action Types' : type}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search admin, target ID, IP..."
              className="h-9 pl-8 pr-3 w-56 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">Administrator</th>
              <th className="py-3 px-4">Action</th>
              <th className="py-3 px-4">Target</th>
              <th className="py-3 px-4">Summary</th>
              <th className="py-3 px-4">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                  No matching audit log entries recorded yet.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50/60">
                  <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{entry.admin_email}</div>
                    <div className="text-[11px] font-mono-tabular text-slate-400">{entry.admin_id}</div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono-tabular font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                      {entry.action_type}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono-tabular text-slate-700">
                    <div>{entry.target_type}</div>
                    <div className="text-[11px] text-slate-400">{entry.target_id}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-800 max-w-md">{entry.summary}</td>
                  <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">{entry.ip_address}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
