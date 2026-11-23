import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  MessageSquare,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import { formatFiatAmount } from '../lib/currencies';
import type { P2PMessage, P2POrder, UserProfile } from '../types';
import { GatewayLogo } from './CryptoIcon';
import { SecurityConfirmModal, type SensitiveActionAuthPayload } from './SecurityConfirmModal';

export interface P2PLiveSignal {
  seq: number;
  type: 'P2P_ORDER_CREATED' | 'P2P_RELEASE_REQUEST' | 'P2P_ORDER_UPDATED' | 'P2P_CHAT_MESSAGE';
  orderId?: string;
  order?: P2POrder;
  message?: P2PMessage;
}

interface P2POrderRoomModalProps {
  order: P2POrder;
  user: UserProfile;
  liveSignal: P2PLiveSignal | null;
  onClose: () => void;
  onOrderUpdated: (updated: P2POrder) => Promise<void> | void;
}

interface ParsedPaymentSnapshot {
  method?: string;
  account_label?: string;
  account_number?: string;
  extra_details?: string;
}

function formatCountdown(expiresAt?: string | null, nowMs?: number): { label: string; expired: boolean } {
  if (!expiresAt) return { label: '15:00', expired: false };
  const target = Date.parse(expiresAt);
  if (Number.isNaN(target)) return { label: '15:00', expired: false };
  const diffSec = Math.max(0, Math.floor((target - (nowMs ?? Date.now())) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return {
    label: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    expired: diffSec <= 0,
  };
}

export const P2POrderRoomModal: React.FC<P2POrderRoomModalProps> = ({
  order: initialOrder,
  user,
  liveSignal,
  onClose,
  onOrderUpdated,
}) => {
  const [order, setOrder] = useState<P2POrder>(initialOrder);
  const [messages, setMessages] = useState<P2PMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Buyer Mark Paid form
  const [payRefInput, setPayRefInput] = useState(initialOrder.payment_reference || '');
  const [payReceiptData, setPayReceiptData] = useState<string | null>(null);

  // Seller Release security & confirmation
  const [sellerConfirmedReceipt, setSellerConfirmedReceipt] = useState(false);
  const [showReleaseSecurity, setShowReleaseSecurity] = useState(false);

  // Dispute form
  const [showDisputeBox, setShowDisputeBox] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  // Action busy state
  const [busyAction, setBusyAction] = useState(false);

  // Chat composer
  const [chatText, setChatText] = useState('');
  const [chatImage, setChatImage] = useState<string | null>(null);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  // Copy payment number feedback
  const [copiedAcc, setCopiedAcc] = useState(false);

  // Live 1s UI clock for countdown display
  const [nowMs, setNowMs] = useState(() => Date.now());
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  const payFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  useEffect(() => {
    if (order.status !== 'ESCROW_LOCKED') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [order.status]);

  // Initial load of chat messages + fresh order state
  useEffect(() => {
    let active = true;
    setLoadingChat(true);
    apiFetch<{ order: P2POrder; messages: P2PMessage[] }>(`/api/p2p/orders/${initialOrder.id}/messages`)
      .then((res) => {
        if (!active) return;
        if (res.order) setOrder(res.order);
        if (Array.isArray(res.messages)) setMessages(res.messages);
      })
      .catch((err: any) => {
        if (active) setError(err?.message || 'Unable to load order chat history.');
      })
      .finally(() => {
        if (active) setLoadingChat(false);
      });
    return () => {
      active = false;
    };
  }, [initialOrder.id]);

  // Real-time WebSocket updates scoped to this order
  useEffect(() => {
    if (!liveSignal) return;
    if (liveSignal.type === 'P2P_CHAT_MESSAGE' && liveSignal.orderId === order.id && liveSignal.message) {
      const incoming = liveSignal.message;
      setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
    }
    if (
      (liveSignal.type === 'P2P_ORDER_UPDATED' ||
        liveSignal.type === 'P2P_RELEASE_REQUEST' ||
        liveSignal.type === 'P2P_ORDER_CREATED') &&
      liveSignal.order?.id === order.id
    ) {
      setOrder(liveSignal.order);
    }
  }, [liveSignal, order.id]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const amBuyer = order.buyer_id === user.id;
  const amSeller = order.seller_id === user.id;
  const counterpartyName = amBuyer ? order.seller_name : order.buyer_name;
  const counterpartyUid = amBuyer ? order.seller_uid || order.seller_id : order.buyer_uid || order.buyer_id;
  const cur = String(order.fiat_currency || 'USD').toUpperCase();
  const countdown = useMemo(() => formatCountdown(order.expires_at, nowMs), [order.expires_at, nowMs]);

  const sellerSnapshot = useMemo<ParsedPaymentSnapshot | null>(() => {
    if (!order.seller_payment_snapshot) return null;
    try {
      return JSON.parse(order.seller_payment_snapshot);
    } catch {
      return null;
    }
  }, [order.seller_payment_snapshot]);

  const readImageFile = (file: File, onDone: (dataUrl: string) => void) => {
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Please select a PNG, JPG, GIF, or WebP image file.');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Receipt image must be smaller than 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setError(null);
        onDone(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleMarkPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (payRefInput.trim().length < 3) {
      setError('Please enter your Transaction ID / Payment Reference (at least 3 characters).');
      return;
    }
    setBusyAction(true);
    try {
      const res = await apiFetch<{ order: P2POrder; messages?: P2PMessage[] }>(
        `/api/p2p/orders/${order.id}/mark-paid`,
        {
          method: 'POST',
          body: JSON.stringify({
            payment_reference: payRefInput.trim(),
            ...(payReceiptData ? { screenshot_data: payReceiptData } : {}),
          }),
        }
      );
      setOrder(res.order);
      if (Array.isArray(res.messages)) {
        setMessages((prev) => {
          const next = [...prev];
          for (const m of res.messages!) {
            if (!next.some((x) => x.id === m.id)) next.push(m);
          }
          return next;
        });
      }
      setPayReceiptData(null);
      setSuccessMsg('Marked as Paid! Automatic USDT Release request sent to the seller.');
      await onOrderUpdated(res.order);
    } catch (err: any) {
      setError(err?.message || 'Unable to mark order as paid.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCancelOrder = async () => {
    setError(null);
    setSuccessMsg(null);
    setBusyAction(true);
    try {
      const res = await apiFetch<{ order: P2POrder; message?: P2PMessage }>(`/api/p2p/orders/${order.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setOrder(res.order);
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!]));
      }
      setSuccessMsg('Order cancelled and locked escrow refunded to Seller.');
      await onOrderUpdated(res.order);
    } catch (err: any) {
      setError(err?.message || 'Unable to cancel order.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleAuthorizeRelease = async (auth: SensitiveActionAuthPayload) => {
    const res = await apiFetch<{ order: P2POrder; message?: P2PMessage }>(`/api/p2p/orders/${order.id}/release`, {
      method: 'POST',
      body: JSON.stringify(auth),
    });
    setOrder(res.order);
    if (res.message) {
      setMessages((prev) => (prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!]));
    }
    setShowReleaseSecurity(false);
    setSellerConfirmedReceipt(false);
    setSuccessMsg('Escrow released! USDT has been credited to the Buyer.');
    await onOrderUpdated(res.order);
  };

  const handleOpenDispute = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setBusyAction(true);
    try {
      const res = await apiFetch<{ order: P2POrder; message?: P2PMessage }>(`/api/p2p/orders/${order.id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({
          reason: disputeReason.trim() || 'Payment / release verification dispute — requesting Admin arbitration',
        }),
      });
      setOrder(res.order);
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!]));
      }
      setShowDisputeBox(false);
      setDisputeReason('');
      setSuccessMsg('Dispute opened. Escrow remains frozen until Master Admin resolves it.');
      await onOrderUpdated(res.order);
    } catch (err: any) {
      setError(err?.message || 'Unable to open dispute.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText !== undefined ? customText : chatText).trim();
    const imgToSend = customText !== undefined ? null : chatImage;
    if (!textToSend && !imgToSend) return;

    setSendingMsg(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: P2PMessage }>(`/api/p2p/orders/${order.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: textToSend,
          ...(imgToSend ? { attachment_data: imgToSend } : {}),
        }),
      });
      if (res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }
      if (customText === undefined) {
        setChatText('');
        setChatImage(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to send message.');
    } finally {
      setSendingMsg(false);
    }
  };

  const stepIndex =
    order.status === 'ESCROW_LOCKED'
      ? 1
      : order.status === 'PAID'
      ? 2
      : order.status === 'COMPLETED' || order.status === 'RESOLVED_BUYER'
      ? 3
      : 2;

  const quickReplies = amBuyer
    ? [
        'Please share your payment account number.',
        'I have sent the fiat payment, please verify & release USDT.',
      ]
    : [
        'Please pay to my account and upload the receipt screenshot here.',
        'Payment received! Releasing your USDT from escrow now.',
      ];

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-3 sm:p-5"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-white border border-slate-200 rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl"
        >
          {/* Header */}
          <div className="px-5 py-4 bg-[#181A20] text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <ShieldCheck className="w-5 h-5 text-[#FCD535] shrink-0" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-white truncate">
                    {amBuyer ? 'Buy USDT' : 'Sell USDT'} · Order {order.id}
                  </h3>
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      order.status === 'COMPLETED' || order.status === 'RESOLVED_BUYER'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : order.status === 'DISPUTED'
                        ? 'bg-red-500/20 text-red-300'
                        : order.status === 'CANCELLED' || order.status === 'RESOLVED_SELLER'
                        ? 'bg-slate-700 text-slate-300'
                        : order.status === 'PAID'
                        ? 'bg-amber-400/20 text-[#FCD535]'
                        : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {order.status}
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Counterparty: <span className="font-semibold text-white">{counterpartyName}</span> (UID{' '}
                  <span className="font-mono-tabular">{counterpartyUid}</span>)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {order.status === 'ESCROW_LOCKED' && (
                <div className="flex items-center gap-1.5 text-xs font-mono-tabular bg-slate-800 border border-slate-700 px-3 py-1.5 rounded-lg">
                  <Clock className="w-3.5 h-3.5 text-[#FCD535]" />
                  <span>{countdown.expired ? 'Window Expired' : `Pay within ${countdown.label}`}</span>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                aria-label="Close order room"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Binance-Style 3-Step Escrow Progress Bar */}
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 grid grid-cols-3 gap-2 text-xs shrink-0">
            {[
              { step: 1, title: '1. Escrow Locked', sub: `${formatUsd(order.amount_vusd)} USDT held` },
              {
                step: 2,
                title: '2. Payment & Release Request',
                sub: order.status === 'ESCROW_LOCKED' ? 'Awaiting fiat transfer' : `Ref: ${order.payment_reference || 'Paid'}`,
              },
              {
                step: 3,
                title: '3. USDT Released',
                sub:
                  order.status === 'COMPLETED' || order.status === 'RESOLVED_BUYER'
                    ? 'Credited to Buyer'
                    : order.status === 'CANCELLED' || order.status === 'RESOLVED_SELLER'
                    ? 'Refunded to Seller'
                    : 'Pending seller release',
              },
            ].map((item) => {
              const done = stepIndex > item.step || (item.step === 3 && (order.status === 'COMPLETED' || order.status === 'RESOLVED_BUYER'));
              const active = stepIndex === item.step && !done;
              return (
                <div
                  key={item.step}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${
                    done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : active
                      ? 'border-blue-200 bg-blue-50/80 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-500'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                      done
                        ? 'bg-[#0ECB81] text-white'
                        : active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {done ? '✓' : item.step}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{item.title}</div>
                    <div className="text-[11px] opacity-80 truncate">{item.sub}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Alerts */}
          {(error || successMsg) && (
            <div className="px-5 pt-3 shrink-0 space-y-2">
              {error && (
                <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-2">
                  <span>{error}</span>
                  <button type="button" onClick={() => setError(null)} className="font-semibold hover:underline">
                    Dismiss
                  </button>
                </div>
              )}
              {successMsg && (
                <div className="border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs px-3.5 py-2.5 rounded-lg flex items-center justify-between gap-2">
                  <span>{successMsg}</span>
                  <button type="button" onClick={() => setSuccessMsg(null)} className="font-semibold hover:underline">
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Split Body: Left = Escrow & Payment Controls | Right = Real-Time User-to-User Chat */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto lg:overflow-hidden">
            {/* LEFT COLUMN */}
            <div className="lg:col-span-6 p-5 space-y-4 border-b lg:border-b-0 lg:border-r border-slate-200 lg:overflow-y-auto">
              {/* Order Summary Card */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Fiat Amount to {amBuyer ? 'Pay' : 'Receive'}</span>
                  <span className="text-lg font-bold font-mono-tabular text-slate-900">
                    {formatFiatAmount(order.fiat_total, cur)} {cur}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Escrowed Crypto</span>
                  <span className="font-bold font-mono-tabular text-slate-900">
                    {formatUsd(order.amount_vusd)} USDT
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Escrow Fee</span>
                  <span className="font-mono-tabular text-slate-700">${formatUsd(order.fee_usd ?? 0.1)} USDT</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Payment Method</span>
                  <GatewayLogo gateway={order.payment_method} size="sm" />
                </div>
                {order.payment_reference && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                    <span className="text-slate-500">Submitted TrxID / Ref</span>
                    <span className="font-mono-tabular font-semibold text-blue-700">{order.payment_reference}</span>
                  </div>
                )}
              </div>

              {/* Seller Payment Account Details */}
              <div className="border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="font-semibold text-slate-900 flex items-center justify-between">
                  <span>{amBuyer ? "Seller's Receiving Account" : 'Your Receiving Account'}</span>
                  <span className="text-[11px] font-normal text-slate-500">{order.payment_method}</span>
                </div>
                {sellerSnapshot ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Account Name</span>
                      <span className="font-semibold text-slate-900">{sellerSnapshot.account_label}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">Account / Pay ID</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono-tabular font-bold text-slate-900">
                          {sellerSnapshot.account_number}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(sellerSnapshot.account_number || '').catch(() => {});
                            setCopiedAcc(true);
                            setTimeout(() => setCopiedAcc(false), 1500);
                          }}
                          className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          title="Copy account number"
                        >
                          {copiedAcc ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    {sellerSnapshot.extra_details && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Bank / Branch Info</span>
                        <span className="text-slate-700">{sellerSnapshot.extra_details}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 leading-relaxed">
                    {amBuyer
                      ? `${order.seller_name} has not attached a saved ${order.payment_method} account yet. Message them in the live chat box to confirm their receiving number before paying.`
                      : `No saved ${order.payment_method} method found in your profile. Share your receiving number in the chat box on the right, or add it under Profile & Security → Payment Methods.`}
                  </p>
                )}
                {order.offer_terms && (
                  <div className="text-[11px] text-slate-500 pt-1">
                    <span className="font-semibold text-slate-700">Terms:</span> {order.offer_terms}
                  </div>
                )}
              </div>

              {/* ROLE-SPECIFIC ESCROW CONTROLS */}
              {amBuyer && order.status === 'ESCROW_LOCKED' && (
                <form onSubmit={handleMarkPaid} className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3 text-xs">
                  <div className="font-semibold text-slate-900">Step 2: Send Fiat &amp; Notify Seller</div>
                  <p className="text-slate-600 leading-relaxed">
                    Transfer{' '}
                    <span className="font-bold text-slate-900">{formatFiatAmount(order.fiat_total, cur)} {cur}</span>{' '}
                    via {order.payment_method}, enter the Transaction ID below, and click{' '}
                    <span className="font-semibold text-slate-900">Transferred, Notify Seller</span>. An automatic USDT release request will be sent to {order.seller_name}.
                  </p>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Transaction ID / Payment Reference *
                    </label>
                    <input
                      type="text"
                      required
                      value={payRefInput}
                      onChange={(e) => setPayRefInput(e.target.value)}
                      placeholder="e.g. BK9920184X or last 4 digits"
                      className="w-full h-9 px-3 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={payFileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) readImageFile(f, setPayReceiptData);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => payFileRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg font-medium whitespace-nowrap"
                    >
                      <ImagePlus className="w-3.5 h-3.5" />
                      <span>{payReceiptData ? 'Change Receipt Screenshot' : 'Attach Payment Receipt (Optional)'}</span>
                    </button>
                    {payReceiptData && (
                      <button
                        type="button"
                        onClick={() => setPayReceiptData(null)}
                        className="text-red-600 hover:underline font-medium"
                      >
                        Remove image
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="flex-1 h-10 px-4 bg-[#0ECB81] hover:bg-[#0BB574] disabled:opacity-60 text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      {busyAction ? 'Notifying Seller...' : 'Transferred, Notify Seller'}
                    </button>
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={handleCancelOrder}
                      className="h-10 px-4 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-lg whitespace-nowrap"
                    >
                      Cancel Order
                    </button>
                  </div>
                </form>
              )}

              {amBuyer && order.status === 'PAID' && (
                <div className="border border-amber-200 bg-amber-50/70 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <BellRing className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-950">
                        Automatic Release Request Sent to {order.seller_name}
                      </div>
                      <p className="text-amber-900 mt-1 leading-relaxed">
                        Your {formatUsd(order.amount_vusd)} USDT is strictly locked in Escrow so the seller cannot withdraw or spend it. Once {order.seller_name} verifies your payment, USDT will credit straight to your Main Balance.
                      </p>
                    </div>
                  </div>
                  {!showDisputeBox ? (
                    <button
                      type="button"
                      onClick={() => setShowDisputeBox(true)}
                      className="px-3.5 py-2 border border-red-200 bg-white hover:bg-red-50 text-red-700 font-semibold rounded-lg whitespace-nowrap"
                    >
                      Seller Not Releasing? Open Dispute / Appeal
                    </button>
                  ) : null}
                </div>
              )}

              {amSeller && order.status === 'ESCROW_LOCKED' && (
                <div className="border border-amber-200 bg-amber-50/70 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-amber-950">
                        Wait for Buyer Payment Before Releasing
                      </div>
                      <p className="text-amber-900 mt-1 leading-relaxed">
                        {formatUsd(order.amount_vusd)} USDT (+ ${formatUsd(order.fee_usd ?? 0.1)} fee) is safely locked in Escrow. Wait for{' '}
                        <span className="font-semibold">{order.buyer_name}</span> to send{' '}
                        <span className="font-semibold">{formatFiatAmount(order.fiat_total, cur)} {cur}</span> and click &ldquo;Transferred, Notify Seller&rdquo;.
                      </p>
                    </div>
                  </div>
                  {countdown.expired && (
                    <button
                      type="button"
                      disabled={busyAction}
                      onClick={handleCancelOrder}
                      className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold rounded-lg whitespace-nowrap"
                    >
                      {busyAction ? 'Refunding...' : 'Payment Timer Expired — Cancel & Refund Escrow'}
                    </button>
                  )}
                </div>
              )}

              {amSeller && order.status === 'PAID' && (
                <div className="border border-emerald-200 bg-emerald-50/70 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <BellRing className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-emerald-950">
                        Action Required: Buyer Marked Payment Sent (Release USDT)
                      </div>
                      <p className="text-emerald-900 mt-1 leading-relaxed">
                        {order.buyer_name} submitted Ref:{' '}
                        <span className="font-mono-tabular font-bold">{order.payment_reference}</span>. Open your{' '}
                        {order.payment_method} app/account to verify you actually received{' '}
                        <span className="font-bold">{formatFiatAmount(order.fiat_total, cur)} {cur}</span> before releasing.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 cursor-pointer select-none bg-white border border-emerald-200 rounded-lg p-2.5">
                    <input
                      type="checkbox"
                      checked={sellerConfirmedReceipt}
                      onChange={(e) => setSellerConfirmedReceipt(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-slate-800 font-medium leading-snug">
                      I have logged into my {order.payment_method} account and confirmed receipt of{' '}
                      {formatFiatAmount(order.fiat_total, cur)} {cur}.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!sellerConfirmedReceipt || busyAction}
                      onClick={() => setShowReleaseSecurity(true)}
                      className="flex-1 h-10 px-4 bg-[#0ECB81] hover:bg-[#0BB574] disabled:opacity-50 text-white font-semibold rounded-lg transition-colors whitespace-nowrap"
                    >
                      Confirm &amp; Release {formatUsd(order.amount_vusd)} USDT
                    </button>
                    {!showDisputeBox && (
                      <button
                        type="button"
                        onClick={() => setShowDisputeBox(true)}
                        className="h-10 px-3.5 border border-red-200 bg-white hover:bg-red-50 text-red-700 font-semibold rounded-lg whitespace-nowrap"
                      >
                        Not Received (Dispute)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Dispute Form */}
              {showDisputeBox && (order.status === 'ESCROW_LOCKED' || order.status === 'PAID') && (
                <form onSubmit={handleOpenDispute} className="border border-red-200 bg-red-50/60 rounded-xl p-4 space-y-3 text-xs">
                  <div className="font-semibold text-red-900">Escalate to Escrow Dispute (Master Admin Arbitration)</div>
                  <p className="text-red-800 leading-relaxed">
                    Escrowed USDT will remain frozen and protected. Upload payment receipts in the chat box so Admin can verify and award funds fairly.
                  </p>
                  <input
                    type="text"
                    required
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="Describe the issue (e.g., Paid via bKash TrxID..., Seller not releasing)"
                    className="w-full h-9 px-3 bg-white border border-red-200 rounded-lg focus:outline-none focus:border-red-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold rounded-lg whitespace-nowrap"
                    >
                      {busyAction ? 'Opening Dispute...' : 'Submit Dispute'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDisputeBox(false)}
                      className="px-3 py-2 text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Settled / Disputed / Cancelled State Cards */}
              {order.status === 'DISPUTED' && (
                <div className="border border-red-200 bg-red-50 rounded-xl p-4 space-y-1.5 text-xs">
                  <div className="font-semibold text-red-900">Order Under Dispute Review</div>
                  <p className="text-red-800">
                    Reason: {order.dispute_reason || 'Payment verification dispute'}. Escrowed {formatUsd(order.amount_vusd)} USDT is frozen while Master Admin inspects this order&apos;s chat &amp; receipts.
                  </p>
                </div>
              )}

              {(order.status === 'COMPLETED' || order.status === 'RESOLVED_BUYER') && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4 flex items-start gap-2.5 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-emerald-950">Order Completed</div>
                    <p className="text-emerald-800 mt-0.5">
                      {formatUsd(order.amount_vusd)} USDT was released from Escrow to {order.buyer_name}&apos;s Main Balance.
                      {order.admin_resolution_note ? ` (${order.admin_resolution_note})` : ''}
                    </p>
                  </div>
                </div>
              )}

              {(order.status === 'CANCELLED' || order.status === 'RESOLVED_SELLER') && (
                <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 text-xs text-slate-700">
                  <div className="font-semibold text-slate-900">
                    {order.status === 'CANCELLED' ? 'Order Cancelled' : 'Dispute Resolved in Seller Favor'}
                  </div>
                  <p className="mt-0.5">
                    Escrowed {formatUsd(order.amount_vusd)} USDT was returned to {order.seller_name}&apos;s Main Balance.
                    {order.admin_resolution_note ? ` (${order.admin_resolution_note})` : ''}
                  </p>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: LIVE USER-TO-USER CHAT BOX */}
            <div className="lg:col-span-6 flex flex-col min-h-[380px] lg:min-h-0 bg-white">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 shrink-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-semibold text-slate-900">
                    Live Escrow Chat with {counterpartyName}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">Encrypted · Admin Audited</span>
              </div>

              {/* Message Feed */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
                {loadingChat ? (
                  <div className="text-xs text-slate-500 text-center py-8">Loading chat messages...</div>
                ) : messages.length === 0 ? (
                  <div className="text-xs text-slate-500 text-center py-8">
                    No messages yet. Say hello or confirm payment details below.
                  </div>
                ) : (
                  messages.map((msg) => {
                    if (msg.msg_type === 'RELEASE_REQUEST') {
                      return (
                        <div
                          key={msg.id}
                          className="border border-amber-200 bg-amber-50 rounded-xl px-3.5 py-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-amber-900 font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              <BellRing className="w-3.5 h-3.5 text-amber-700" />
                              <span>Escrow Release Alert</span>
                            </span>
                            <span className="text-[10px] font-normal text-amber-700">
                              {formatDateTime(msg.created_at)}
                            </span>
                          </div>
                          <p className="text-amber-950 leading-relaxed">{msg.body}</p>
                        </div>
                      );
                    }

                    if (msg.msg_type === 'SYSTEM' || msg.sender_role === 'SYSTEM') {
                      return (
                        <div key={msg.id} className="flex justify-center">
                          <div className="max-w-[92%] bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-700 text-center leading-relaxed">
                            <span>{msg.body}</span>
                            <span className="block text-[10px] text-slate-400 mt-0.5">
                              {formatDateTime(msg.created_at)}
                            </span>
                          </div>
                        </div>
                      );
                    }

                    const isMine = msg.sender_id === user.id;
                    const senderTag =
                      msg.sender_role === 'ADMIN'
                        ? 'Master Admin'
                        : isMine
                        ? 'You'
                        : msg.sender_name || counterpartyName;

                    return (
                      <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                        <div className="text-[10px] text-slate-500 mb-1 px-1">
                          {senderTag} · {formatDateTime(msg.created_at)}
                        </div>
                        <div
                          className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs space-y-2 ${
                            msg.sender_role === 'ADMIN'
                              ? 'bg-slate-900 text-white'
                              : isMine
                              ? 'bg-blue-600 text-white'
                              : 'bg-white border border-slate-200 text-slate-900'
                          }`}
                        >
                          {msg.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>}
                          {msg.attachment_data && (
                            <button
                              type="button"
                              onClick={() => setPreviewImg(msg.attachment_data || null)}
                              className="block overflow-hidden rounded-lg border border-black/10 bg-white"
                            >
                              <img
                                src={msg.attachment_data}
                                alt="Payment receipt"
                                className="max-h-48 w-auto object-contain"
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Quick Replies + Composer */}
              <div className="p-3 border-t border-slate-200 bg-white space-y-2.5 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {quickReplies.map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={sendingMsg}
                      onClick={() => handleSendMessage(q)}
                      className="text-[11px] px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 text-slate-700 rounded-md transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                {chatImage && (
                  <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-slate-700 font-medium">Receipt image attached</span>
                    <button
                      type="button"
                      onClick={() => setChatImage(null)}
                      className="text-red-600 hover:underline font-medium"
                    >
                      Remove
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendMessage();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={chatFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) readImageFile(f, setChatImage);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => chatFileRef.current?.click()}
                    title="Attach payment receipt screenshot"
                    className="h-9 w-9 shrink-0 flex items-center justify-center border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder={`Message ${counterpartyName}...`}
                    className="flex-1 h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="submit"
                    disabled={sendingMsg || (!chatText.trim() && !chatImage)}
                    className="h-9 px-3.5 inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{sendingMsg ? 'Sending' : 'Send'}</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Receipt Lightbox */}
      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          className="fixed inset-0 z-[60] bg-slate-900/80 flex items-center justify-center p-4"
        >
          <div onClick={(e) => e.stopPropagation()} className="relative max-w-2xl w-full bg-white rounded-xl p-3">
            <button
              type="button"
              onClick={() => setPreviewImg(null)}
              className="absolute top-3 right-3 p-1.5 bg-slate-900/75 text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
            <img src={previewImg} alt="Receipt full view" className="w-full max-h-[80vh] object-contain rounded-lg" />
          </div>
        </div>
      )}

      {/* Security Verification Modal before Seller Releases Escrow */}
      <SecurityConfirmModal
        open={showReleaseSecurity}
        title={`Release ${formatUsd(order.amount_vusd)} USDT from Escrow`}
        description={`Verify your identity to permanently release ${formatUsd(order.amount_vusd)} USDT to ${order.buyer_name}. Make sure fiat funds are in your ${order.payment_method} account.`}
        authenticatorEnabled={Boolean(user.two_fa_enabled)}
        onClose={() => setShowReleaseSecurity(false)}
        onAuthorize={handleAuthorizeRelease}
      />
    </>
  );
};
