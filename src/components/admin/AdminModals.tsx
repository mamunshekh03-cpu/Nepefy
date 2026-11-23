import React from 'react';
import { X } from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../../lib/api';
import type { P2PMessage, P2POrder, UserProfile } from '../../types';
import type { RunActionFn } from './adminTypes';

interface AdminModalsProps {
  adjustTarget: UserProfile | null;
  setAdjustTarget: (u: UserProfile | null) => void;
  adjustWallet: 'MAIN' | 'CLAIMABLE';
  setAdjustWallet: (w: 'MAIN' | 'CLAIMABLE') => void;
  adjustDir: 'CREDIT' | 'DEBIT';
  setAdjustDir: (d: 'CREDIT' | 'DEBIT') => void;
  adjustAmount: string;
  setAdjustAmount: (v: string) => void;
  adjustNote: string;
  setAdjustNote: (v: string) => void;
  previewImg: string | null;
  setPreviewImg: (src: string | null) => void;
  inspectP2pOrder: P2POrder | null;
  setInspectP2pOrder: (o: P2POrder | null) => void;
  inspectP2pMessages: P2PMessage[];
  loadingInspectChat: boolean;
  runAction: RunActionFn;
}

export const AdminModals: React.FC<AdminModalsProps> = ({
  adjustTarget,
  setAdjustTarget,
  adjustWallet,
  setAdjustWallet,
  adjustDir,
  setAdjustDir,
  adjustAmount,
  setAdjustAmount,
  adjustNote,
  setAdjustNote,
  previewImg,
  setPreviewImg,
  inspectP2pOrder,
  setInspectP2pOrder,
  inspectP2pMessages,
  loadingInspectChat,
  runAction,
}) => {
  return (
    <>
      {/* Wallet Balance Adjustment Modal */}
      {adjustTarget && (
        <div
          onClick={() => setAdjustTarget(null)}
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Adjust User Wallet Balance</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                  {adjustTarget.full_name} · {adjustTarget.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const target = adjustTarget;
                runAction(async () => {
                  await apiFetch(`/api/admin/users/${target.id}/adjust-balance`, {
                    method: 'POST',
                    body: JSON.stringify({
                      wallet_type: adjustWallet,
                      direction: adjustDir,
                      amount: Number(adjustAmount),
                      note: adjustNote,
                    }),
                  });
                  setAdjustTarget(null);
                  return `${adjustDir === 'CREDIT' ? 'Credited' : 'Debited'} $${formatUsd(Number(adjustAmount))} (${adjustWallet}) for ${target.full_name}.`;
                });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-2">
                {(['MAIN', 'CLAIMABLE'] as const).map((wt) => (
                  <button
                    key={wt}
                    type="button"
                    onClick={() => setAdjustWallet(wt)}
                    className={`h-9 text-xs font-medium rounded-lg border font-mono-tabular ${
                      adjustWallet === wt
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {wt === 'MAIN'
                      ? `Main ($${formatUsd(adjustTarget.main_balance)})`
                      : `Claimable ($${formatUsd(adjustTarget.claimable_balance)})`}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['CREDIT', 'DEBIT'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    onClick={() => setAdjustDir(dir)}
                    className={`h-9 text-xs font-medium rounded-lg border ${
                      adjustDir === dir
                        ? dir === 'CREDIT'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-red-600 bg-red-50 text-red-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {dir === 'CREDIT' ? 'Credit (+)' : 'Debit (-)'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Amount (USDT)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                  className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Audit Reason</label>
                <input
                  type="text"
                  required
                  value={adjustNote}
                  onChange={(e) => setAdjustNote(e.target.value)}
                  placeholder="Manual reconciliation / bonus / fee reversal"
                  className="w-full h-10 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="px-4 h-9 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 h-9 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Apply Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deposit Screenshot Proof Preview */}
      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Submitted Payment Proof</h3>
              <button
                type="button"
                onClick={() => setPreviewImg(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewImg}
              alt="User deposit screenshot"
              referrerPolicy="no-referrer"
              className="w-full max-h-96 object-contain rounded-lg border border-slate-200"
            />
          </div>
        </div>
      )}

      {/* P2P Order Chat & Payment Proof Inspection */}
      {inspectP2pOrder && (
        <div
          onClick={() => setInspectP2pOrder(null)}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Order {inspectP2pOrder.id} · Chat &amp; Payment Proof Audit
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                  Buyer: {inspectP2pOrder.buyer_name} · Seller: {inspectP2pOrder.seller_name} · Ref:{' '}
                  {inspectP2pOrder.payment_reference || 'None'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectP2pOrder(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 bg-slate-50/40 text-xs">
              {loadingInspectChat ? (
                <div className="text-center py-8 text-slate-500">Loading order chat...</div>
              ) : inspectP2pMessages.length === 0 ? (
                <div className="text-center py-8 text-slate-500">No chat messages recorded for this order.</div>
              ) : (
                inspectP2pMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`border rounded-lg p-3 space-y-1.5 ${
                      m.msg_type === 'RELEASE_REQUEST'
                        ? 'bg-amber-50 border-amber-200'
                        : m.sender_role === 'SYSTEM'
                        ? 'bg-slate-100 border-slate-200'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono-tabular">
                      <span className="font-semibold text-slate-800">
                        {m.sender_role} {m.sender_name ? `(${m.sender_name})` : ''}
                      </span>
                      <span>{formatDateTime(m.created_at)}</span>
                    </div>
                    <div className="text-slate-800 whitespace-pre-wrap">{m.body}</div>
                    {m.attachment_data && (
                      <button
                        type="button"
                        onClick={() => setPreviewImg(m.attachment_data || null)}
                        className="inline-block border border-slate-200 rounded-lg overflow-hidden mt-1"
                      >
                        <img src={m.attachment_data} alt="Submitted proof" className="max-h-40 object-contain" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
