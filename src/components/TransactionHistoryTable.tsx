import React, { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Download, Search } from 'lucide-react';
import { formatDateTime, formatUsd } from '../lib/api';
import type { LedgerEntry, LedgerStatus } from '../types';

interface TransactionHistoryTableProps {
  ledger: LedgerEntry[];
  title?: string;
}

function getNormalizedStatus(entry: LedgerEntry): LedgerStatus {
  if (entry.status) return entry.status;
  if (entry.tx_type === 'SPOT_LIQUIDATION') return 'FAILED';
  return 'SUCCESS';
}

function formatEventLabel(txType: string): string {
  const upperType = txType.toUpperCase();
  if (upperType === 'WITHDRAW_HOLD') return 'Withdraw';
  if (upperType === 'SEND_OUT') return 'Send';

  return txType
    .split('_')
    .filter(Boolean)
    .map((word) => {
      const upper = word.toUpperCase();
      if (upper === 'P2P') return 'P2P';
      if (upper === 'PNL') return 'PnL';
      return upper.charAt(0) + upper.slice(1).toLowerCase();
    })
    .join(' ');
}

function formatPriceText(rawPrice: string): string {
  const num = Number(String(rawPrice).replace(/,/g, ''));
  if (!Number.isFinite(num)) return `$${rawPrice}`;
  return `$${num.toLocaleString('en-US', { maximumFractionDigits: num >= 100 ? 2 : 6 })}`;
}

function formatSimpleDescription(entry: LedgerEntry): string {
  const raw = String(entry.description || '').trim();
  if (!raw) return formatEventLabel(entry.tx_type);

  // Closed Spot with P&L: "Closed Spot 0.00082 BTC @ $60928.46 (P&L: $-0.09)"
  const closedSpotMatch = raw.match(/^Closed Spot\s+([\d.]+)\s+([A-Z0-9]+)\s+@\s+\$?([\d.,]+)\s+\(P&L:\s*([^)]+)\)/i);
  if (closedSpotMatch) {
    const [, qty, asset, price, pnlRaw] = closedSpotMatch;
    const pnlNum = Number(pnlRaw.replace(/[^0-9.-]/g, ''));
    const pnlText = Number.isFinite(pnlNum)
      ? pnlNum >= 0
        ? `Profit +$${pnlNum.toFixed(2)}`
        : `Loss -$${Math.abs(pnlNum).toFixed(2)}`
      : pnlRaw;
    return `Sold ${qty} ${asset} at ${formatPriceText(price)} · ${pnlText}`;
  }

  // Limit / Spot Filled or Market Spot Buy/Sell
  const spotFilledMatch = raw.match(/^(Limit Buy Filled|Limit Sell Filled|Spot Buy|Spot Sell)\s+([\d.]+)\s+([A-Z0-9]+)\s+@\s+\$?([\d.,]+)/i);
  if (spotFilledMatch) {
    const [, kind, qty, asset, price] = spotFilledMatch;
    const verb = kind.toLowerCase().includes('sell') ? 'Sold' : 'Bought';
    return `${verb} ${qty} ${asset} at ${formatPriceText(price)}`;
  }

  // Open Limit Order
  const openLimitMatch = raw.match(/^Open Limit (Buy|Sell)\s+([\d.]+)\s+([A-Z0-9]+)\s+@\s+\$?([\d.,]+)/i);
  if (openLimitMatch) {
    const [, side, qty, asset, price] = openLimitMatch;
    return `Limit ${side} order · ${qty} ${asset} at ${formatPriceText(price)}`;
  }

  // Canceled Limit Order
  if (/^Cancel(ed|led) Limit/i.test(raw)) {
    const m = raw.match(/Limit (Buy|Sell)\s+([\d.]+)\s+([A-Z0-9]+)/i);
    return m ? `Canceled ${m[1]} order (${m[2]} ${m[3]})` : 'Canceled limit order';
  }

  // Jackpot purchase: "Purchased 5 Jackpot ticket(s) (#...) for Q4 2026"
  const jackpotMatch = raw.match(/^Purchased\s+(\d+)\s+Jackpot ticket\(s\).*?\bfor\s+(.+)$/i);
  if (jackpotMatch) {
    const [, count, round] = jackpotMatch;
    const n = Number(count);
    return `Bought ${count} Jackpot ${n === 1 ? 'ticket' : 'tickets'} (${round.trim()})`;
  }

  // Presale purchase: "Purchased 2 lot(s) of TOKEN (...)"
  const presaleMatch = raw.match(/^Purchased\s+(\d+)\s+lot\(s\)\s+of\s+([A-Z0-9]+)/i);
  if (presaleMatch) {
    const [, lots, sym] = presaleMatch;
    const n = Number(lots);
    return `Bought ${lots} ${sym} presale ${n === 1 ? 'lot' : 'lots'}`;
  }

  // Staking subscription
  const stakeSubMatch = raw.match(/^Subscribed to\s+([A-Z0-9]+)\s+Staking Plan\s+\(([^·)]+)/i);
  if (stakeSubMatch) {
    return `Staked in ${stakeSubMatch[1]} Vault (${stakeSubMatch[2].trim()})`;
  }

  // Monthly staking profit withdrawal
  const stakeMonthlyMatch = raw.match(/^Monthly Staking Profit Withdrawal\s+\((\d+\s*mo)\s*·\s*([^@)]+)/i);
  if (stakeMonthlyMatch) {
    return `Monthly staking profit (${stakeMonthlyMatch[2].trim()} Vault)`;
  }

  // Final staking payout
  const stakeFinalMatch = raw.match(/^Final Monthly(?: Staking)? Profit.*?Principal Release\s+\(([^)]+)\)/i);
  if (stakeFinalMatch) {
    return `Staking matured & principal returned (${stakeFinalMatch[1]})`;
  }

  // Emergency staking payout
  const stakeEmergMatch = raw.match(/^Emergency Staking Payout\s+\(([A-Z0-9]+).*?penalty\s+\$([\d.,]+)\)/i);
  if (stakeEmergMatch) {
    return `Emergency vault exit (${stakeEmergMatch[1]} · $${stakeEmergMatch[2]} fee)`;
  }

  // Deposit approved
  const depMatch = raw.match(/^Approved\s+(.+?)\s+deposit/i);
  if (depMatch) {
    return `Deposit approved (${depMatch[1].trim()})`;
  }

  // Withdrawal processed / refunded / hold
  const wdrDoneMatch = raw.match(/^Withdrawal processed via\s+([^\s(]+)/i);
  if (wdrDoneMatch) {
    return `Withdrawal completed (${wdrDoneMatch[1]})`;
  }
  const wdrRefundMatch = raw.match(/^Withdrawal rejected & refunded\s+\$([\d.,]+)/i);
  if (wdrRefundMatch) {
    return `Withdrawal refunded ($${wdrRefundMatch[1]})`;
  }

  return raw;
}

export const TransactionHistoryTable: React.FC<TransactionHistoryTableProps> = ({
  ledger,
  title = 'Transaction History',
}) => {
  const [search, setSearch] = useState('');

  const filteredLedger = ledger.filter((entry) => {
    const status = getNormalizedStatus(entry);
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        entry.description.toLowerCase().includes(q) ||
        formatSimpleDescription(entry).toLowerCase().includes(q) ||
        entry.tx_type.toLowerCase().includes(q) ||
        formatEventLabel(entry.tx_type).toLowerCase().includes(q) ||
        entry.reference_id.toLowerCase().includes(q) ||
        status.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getTradeFee = (entry: LedgerEntry): { feeUsd: number; feeRole: string | null } | null => {
    if (Number(entry.fee_usd || 0) > 0) {
      return { feeUsd: Number(entry.fee_usd), feeRole: entry.fee_role || null };
    }
    const raw = String(entry.description || '');
    if (/^(Open Limit|Cancel)/i.test(raw)) return null;
    const feeMatch = raw.match(/(Maker|Taker)\s+fee:\s*\$([\d.,]+)/i);
    if (feeMatch) {
      const val = Number(feeMatch[2].replace(/,/g, ''));
      if (Number.isFinite(val) && val > 0) {
        return { feeUsd: val, feeRole: feeMatch[1].toUpperCase() };
      }
    }
    return null;
  };

  const handleExportCsv = () => {
    const headers = ['ID', 'Timestamp', 'Wallet', 'Event', 'Status', 'Fee USDT', 'Amount USDT', 'Balance After', 'Reference ID', 'Description'];
    const rows = filteredLedger.map((item) => {
      const feeInfo = getTradeFee(item);
      return [
        item.id,
        item.created_at,
        item.wallet_type,
        item.tx_type,
        getNormalizedStatus(item),
        feeInfo ? feeInfo.feeUsd.toFixed(2) : '0.00',
        item.amount.toFixed(2),
        item.balance_after === null || item.balance_after === undefined ? '' : item.balance_after.toFixed(2),
        item.reference_id,
        `"${formatSimpleDescription(item).replace(/"/g, '""')}"`,
      ];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nepefy-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Trx, Ref ID or Status..."
              className="w-full h-9 pl-9 pr-3 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-blue-600"
            />
          </div>
          <button
            type="button"
            disabled={filteredLedger.length === 0}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Mobile Native Activity Feed (< md) */}
      <div className="md:hidden border border-slate-200 rounded-2xl bg-white divide-y divide-slate-100 overflow-hidden">
        {filteredLedger.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-slate-500">
            No transaction records match the search query.
          </div>
        ) : (
          filteredLedger.map((item) => {
            const status = getNormalizedStatus(item);
            const isNegativeState = status === 'REJECTED' || status === 'FAILED';
            const isPending = status === 'PENDING';
            const feeInfo = getTradeFee(item);
            const isInflow = item.amount >= 0 && !isNegativeState;
            const amountColor = isNegativeState
              ? 'text-red-600'
              : item.amount > 0
              ? 'text-emerald-600'
              : item.amount < 0
              ? 'text-red-600'
              : 'text-slate-700';
            const formattedAmount =
              item.amount > 0
                ? isNegativeState
                  ? `$${formatUsd(item.amount)}`
                  : `+$${formatUsd(item.amount)}`
                : item.amount < 0
                ? `-$${formatUsd(Math.abs(item.amount))}`
                : `$${formatUsd(0)}`;
            const statusLabel =
              status === 'SUCCESS'
                ? 'Success'
                : status === 'PENDING'
                ? 'Pending'
                : status === 'FAILED'
                ? 'Failed'
                : 'Rejected';

            return (
              <div key={`m-${item.id}`} className="px-4 py-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                      isNegativeState
                        ? 'bg-red-50 text-red-600'
                        : isPending
                        ? 'bg-amber-50 text-amber-600'
                        : isInflow
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {isInflow ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {formatEventLabel(item.tx_type)}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {formatSimpleDescription(item)}
                    </div>
                    <div className="text-[10.5px] font-mono-tabular text-slate-400 mt-0.5">
                      {formatDateTime(item.created_at)} ·{' '}
                      <span
                        className={
                          status === 'SUCCESS'
                            ? 'text-emerald-600 font-medium'
                            : isPending
                            ? 'text-amber-600 font-medium'
                            : 'text-red-600 font-medium'
                        }
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono-tabular shrink-0">
                  <div className={`text-xs font-bold ${amountColor}`}>{formattedAmount}</div>
                  {feeInfo ? (
                    <div className="text-[10px] text-slate-400 mt-0.5">Fee ${formatUsd(feeInfo.feeUsd)}</div>
                  ) : item.balance_after !== null && item.balance_after !== undefined ? (
                    <div className="text-[10px] text-slate-400 mt-0.5">Bal ${formatUsd(item.balance_after)}</div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop Full Table (>= md) */}
      <div className="hidden md:block border border-slate-200 rounded-xl bg-white overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
              <th className="py-3 px-4">Timestamp</th>
              <th className="py-3 px-4">Wallet</th>
              <th className="py-3 px-4">Event</th>
              <th className="py-3 px-4">Description</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Fee</th>
              <th className="py-3 px-4 text-right">Amount</th>
              <th className="py-3 px-4 text-right">Balance After</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {filteredLedger.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 px-4 text-center text-slate-500">
                  No transaction records match the search query.
                </td>
              </tr>
            ) : (
              filteredLedger.map((item) => {
                const status = getNormalizedStatus(item);
                const isNegativeState = status === 'REJECTED' || status === 'FAILED';
                const isPending = status === 'PENDING';
                const feeInfo = getTradeFee(item);

                const statusColor =
                  status === 'SUCCESS'
                    ? 'text-emerald-600'
                    : isPending
                    ? 'text-amber-600'
                    : 'text-red-600';

                const statusLabel =
                  status === 'SUCCESS'
                    ? 'Success'
                    : status === 'PENDING'
                    ? 'Pending'
                    : status === 'FAILED'
                    ? 'Failed'
                    : 'Rejected';

                const amountColor = isNegativeState
                  ? 'text-red-600'
                  : item.amount > 0
                  ? 'text-emerald-600'
                  : item.amount < 0
                  ? 'text-red-600'
                  : 'text-slate-600';

                const eventColor = isNegativeState
                  ? 'text-red-600'
                  : item.amount > 0
                  ? 'text-emerald-600'
                  : item.amount < 0
                  ? 'text-red-600'
                  : 'text-slate-700';

                const formattedAmount =
                  item.amount > 0
                    ? isNegativeState
                      ? `$${formatUsd(item.amount)}`
                      : `+$${formatUsd(item.amount)}`
                    : item.amount < 0
                    ? `-$${formatUsd(Math.abs(item.amount))}`
                    : `$${formatUsd(0)}`;

                return (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4 font-mono-tabular text-slate-500 whitespace-nowrap">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium whitespace-nowrap">
                      {item.wallet_type === 'MAIN' ? 'Main Balance' : 'Claimable'}
                    </td>
                    <td className={`py-3 px-4 font-medium whitespace-nowrap ${eventColor}`}>
                      {formatEventLabel(item.tx_type)}
                    </td>
                    <td className="py-3 px-4 text-slate-800">{formatSimpleDescription(item)}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                      {feeInfo ? (
                        <div className="inline-flex flex-col items-end leading-tight">
                          <span className="text-slate-700 font-medium">${formatUsd(feeInfo.feeUsd)}</span>
                          {feeInfo.feeRole && (
                            <span className="text-[10px] text-slate-400">
                              {feeInfo.feeRole === 'MAKER' ? 'Maker' : 'Taker'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${amountColor}`}>
                      {formattedAmount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-700 whitespace-nowrap">
                      {item.balance_after === null || item.balance_after === undefined ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        `$${formatUsd(item.balance_after)}`
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
  );
};
