import React, { useEffect, useState } from 'react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type { PresaleRound, PresaleTicket, UserProfile } from '../types';
import { CryptoIcon } from './CryptoIcon';

interface PresaleViewProps {
  user: UserProfile;
  onRefresh: () => Promise<void>;
}

export const PresaleView: React.FC<PresaleViewProps> = ({ user, onRefresh }) => {
  const [rounds, setRounds] = useState<PresaleRound[]>([]);
  const [tickets, setTickets] = useState<PresaleTicket[]>([]);
  const [lotCounts, setLotCounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadPresale = async () => {
    const res = await apiFetch<{ rounds: PresaleRound[]; tickets: PresaleTicket[] }>('/api/presale/rounds');
    setRounds(res.rounds);
    setTickets(res.tickets);
  };

  useEffect(() => {
    loadPresale().catch(() => {});
  }, []);

  const handleBuyLots = async (round: PresaleRound) => {
    setNotice(null);
    setBusyId(round.id);
    const lots = Math.max(1, Math.floor(Number(lotCounts[round.id] || 1)));
    try {
      await apiFetch('/api/presale/buy', {
        method: 'POST',
        body: JSON.stringify({ round_id: round.id, lots_count: lots }),
      });
      setNotice({
        type: 'ok',
        text: `Purchased ${lots} lot(s) of ${round.token_symbol} ($${formatUsd(lots * round.lot_price)} principal + $${formatUsd(round.network_fee)} fixed network fee).`,
      });
      await Promise.all([loadPresale(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Coin Presale</h1>
          <p className="text-sm text-slate-500 mt-1">
            Subscribe to pre-listing token lots with a fixed per-ticket network fee. Non-winning lots automatically refund principal to Claimable Wallet.
          </p>
        </div>
        <div className="text-xs font-mono-tabular text-slate-600">
          Main Balance: <span className="font-semibold text-slate-900">${formatUsd(user.main_balance)}</span>
        </div>
      </div>

      {notice && (
        <div
          className={`border text-xs px-4 py-3 rounded-lg ${
            notice.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Active IPO Rounds */}
      {rounds.length === 0 ? (
        <div className="border border-slate-200 rounded-xl bg-white p-10 text-center text-sm text-slate-500">
          No active presale rounds right now. New token lot offerings will appear here once launched.
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {rounds.map((r) => {
          const lots = Math.max(1, Math.floor(Number(lotCounts[r.id] || 1)));
          const principal = lots * r.lot_price;
          const totalCost = principal + r.network_fee;
          const remaining = r.total_lots - r.sold_lots;

          return (
            <div key={r.id} className="border border-slate-200 rounded-xl bg-white p-6 flex flex-col justify-between space-y-5">
              <div>
                <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-3">
                    <CryptoIcon symbol={r.token_symbol} size="lg" />
                    <div>
                      <div className="text-xs font-medium text-blue-600">Presale Lot Offering · {r.status}</div>
                      <h2 className="mt-0.5 text-xl font-bold text-slate-900">
                        {r.token_symbol} — {r.token_name}
                      </h2>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Lot Price</div>
                    <div className="text-xl font-bold font-mono-tabular text-slate-900">${formatUsd(r.lot_price)}</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-slate-500">Win Allocation</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-slate-900">
                      {r.tokens_per_lot} {r.token_symbol}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Win Cash Payout</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-emerald-600">
                      ${formatUsd(r.projected_win_payout)} / lot
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Lots Remaining</div>
                    <div className="mt-1 font-mono-tabular font-semibold text-slate-900">
                      {remaining} / {r.total_lots}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xs font-medium text-slate-700">Number of Lots</label>
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, remaining)}
                    value={lotCounts[r.id] ?? '1'}
                    onChange={(e) => setLotCounts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    className="w-28 h-9 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg text-right"
                  />
                </div>
                <div className="text-xs space-y-1 border-t border-slate-200 pt-2.5">
                  <div className="flex justify-between text-slate-600">
                    <span>Principal ({lots} × ${formatUsd(r.lot_price)})</span>
                    <span className="font-mono-tabular">${formatUsd(principal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Fixed Network Fee (Non-refundable)</span>
                    <span className="font-mono-tabular">${formatUsd(r.network_fee)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900 pt-1">
                    <span>Total Deduction (Main Balance)</span>
                    <span className="font-mono-tabular">${formatUsd(totalCost)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busyId === r.id || r.status !== 'OPEN' || remaining <= 0}
                  onClick={() => handleBuyLots(r)}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  {busyId === r.id ? 'Processing Lot Purchase...' : `Purchase ${lots} Lot(s) for $${formatUsd(totalCost)}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* User's Presale Tickets */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">My Presale Draw Tickets</h2>
        <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                <th className="py-3 px-4">Ticket ID / Date</th>
                <th className="py-3 px-4">Token</th>
                <th className="py-3 px-4 text-right">Lots</th>
                <th className="py-3 px-4 text-right">Principal Paid</th>
                <th className="py-3 px-4 text-right">Network Fee</th>
                <th className="py-3 px-4">Draw Result</th>
                <th className="py-3 px-4 text-right">Claimable Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-slate-500">
                    No presale lots purchased yet.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono-tabular">
                      <div className="text-slate-900">{t.id}</div>
                      <div className="text-slate-400">{formatDateTime(t.created_at)}</div>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{t.token_symbol}</td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-800">{t.lots_count}</td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-900">
                      ${formatUsd(t.principal_paid)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-500">
                      ${formatUsd(t.fee_paid)}
                    </td>
                    <td className="py-3 px-4 font-semibold">
                      <span
                        className={
                          t.result === 'WIN'
                            ? 'text-emerald-600'
                            : t.result === 'LOSS'
                            ? 'text-amber-600'
                            : 'text-blue-600'
                        }
                      >
                        {t.result === 'LOSS' ? 'LOSS (Principal Refunded)' : t.result}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-slate-900">
                      {t.result === 'PENDING' ? 'Pending Draw' : `+$${formatUsd(t.payout_amount)}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
