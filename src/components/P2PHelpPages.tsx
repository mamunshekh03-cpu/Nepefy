import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  FileCheck2,
  Lock,
  MessageSquare,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { formatDateTime, formatUsd } from '../lib/api';
import { formatFiatAmount } from '../lib/currencies';
import type { P2POrder } from '../types';

interface HelpPageBaseProps {
  onBackToMarket: () => void;
  p2pFeeUsd?: number;
}

/* 1. Beginner's P2P User Guide Page */
export const P2PUserGuidePage: React.FC<HelpPageBaseProps> = ({ onBackToMarket, p2pFeeUsd = 0.1 }) => {
  const [guideSide, setGuideSide] = useState<'BUY' | 'SELL'>('BUY');

  return (
    <section className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Beginner&apos;s P2P User Guide</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Step-by-step walkthrough for buying and selling USDT safely with bKash, Nagad, Rocket, and Bank transfers
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToMarket}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to P2P Market</span>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">How P2P Trading Works on Nepefy</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select Buy or Sell mode below to view the exact steps for your trade.
            </p>
          </div>

          <div className="inline-flex items-center p-1 border border-slate-200 rounded-lg bg-slate-50">
            <button
              type="button"
              onClick={() => setGuideSide('BUY')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                guideSide === 'BUY' ? 'bg-[#0ECB81] text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              How to Buy USDT
            </button>
            <button
              type="button"
              onClick={() => setGuideSide('SELL')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                guideSide === 'SELL' ? 'bg-[#F6465D] text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              How to Sell USDT
            </button>
          </div>
        </div>

        {guideSide === 'BUY' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">01. Select a Verified Advertiser</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Filter offers by fiat amount, currency (e.g., BDT, USD), and payment method (bKash, Nagad, Rocket,
                Binance Pay, Bank Wire). Check the merchant&apos;s orders, completion rate, positive rating, and
                payment window before clicking <strong>Buy USDT</strong>.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">02. Open Escrow Order</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter the USDT quantity within the advertiser&apos;s Min–Max BDT/fiat limit and select your preferred
                payment method. The seller&apos;s USDT is locked immediately inside Nepefy Smart Escrow.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">03. Send Fiat &amp; Mark as Paid</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Transfer the exact fiat amount to the seller&apos;s displayed payment account before the timer expires
                (typically <span className="font-mono-tabular">15 min</span>), share the TrxID or screenshot in Order
                Chat, and click <strong>Mark as Paid</strong>.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">04. Receive USDT in Main Balance</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Once the seller verifies receipt in their wallet or bank app, escrowed USDT is released straight into
                your Main Balance with a permanent ledger record.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">01. Prepare Balance &amp; Payment Account</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Ensure your Main Balance covers the USDT trade amount plus the{' '}
                <span className="font-mono-tabular">${formatUsd(p2pFeeUsd)}</span> escrow fee, and save your receiving account (bKash,
                Nagad, Rocket, or Bank Wire) under Profile &amp; Security → Payment Methods.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">02. Accept a Buy Offer or Post an Ad</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Click <strong>Sell USDT</strong> on any matching buyer offer, or click <strong>Post P2P Offer</strong>{' '}
                to publish your own exchange rate, limits, supported payment channels, and release window.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">03. Confirm Fiat Inside Your App</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your USDT stays locked safely in escrow while the buyer transfers fiat. Never release based solely on an
                SMS—always verify the settled balance directly inside your banking or mobile wallet app.
              </p>
            </div>
            <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
              <div className="text-sm font-semibold text-slate-900">04. Release Escrowed USDT</div>
              <p className="text-xs text-slate-600 leading-relaxed">
                Once you confirm the full amount from an account matching the buyer&apos;s verified name, click{' '}
                <strong>Release USDT</strong> inside the Order Room to complete the trade.
              </p>
            </div>
          </div>
        )}

        <div className="border border-slate-200 rounded-xl bg-slate-50/70 p-5 space-y-2.5">
          <div className="text-xs font-semibold text-slate-900">Reading Advertiser Metrics Before You Trade</div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Orders &amp; Completion:</strong> Total completed P2P trades and the percentage of orders settled
                without cancellation.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Rating (%):</strong> Positive counterparty feedback ratio across settled P2P trades.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Payment Window (min):</strong> Maximum time allowed for completing the fiat transfer and
                marking the order paid.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>In-App Order Chat:</strong> Keep all TrxIDs, payment screenshots, and messages inside Nepefy
                Order Chat.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
};

/* 2. Escrow Protection Rules Page */
export const P2PEscrowRulesPage: React.FC<HelpPageBaseProps> = ({ onBackToMarket, p2pFeeUsd = 0.1 }) => {
  return (
    <section className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Escrow Protection Rules</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Smart escrow safeguards, fee schedules, name-match policies, and trade finality standards
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onBackToMarket}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to P2P Market</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Lock className="w-4 h-4 text-blue-600" />
            <span>1. 100% Upfront Escrow Lock</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Whenever a P2P order is opened, the seller&apos;s USDT amount plus the{' '}
            <strong className="font-mono-tabular text-slate-900">${formatUsd(p2pFeeUsd)} USDT</strong> platform escrow fee is locked out of
            their Main Balance before the buyer sends any fiat. Sellers cannot withdraw or double-spend locked USDT.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Clock className="w-4 h-4 text-blue-600" />
            <span>2. Payment Window &amp; Auto-Return</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Buyers must complete payment and click <strong>Mark as Paid</strong> within the offer&apos;s timer (
            <span className="font-mono-tabular">15, 30, 45, or 60 min</span>). Unpaid cancelled orders automatically
            return locked USDT and the escrow fee to the seller&apos;s Main Balance.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <FileCheck2 className="w-4 h-4 text-emerald-600" />
            <span>3. Name-Match &amp; No Third-Party Transfers</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Fiat sent via bKash, Nagad, Rocket, Binance Pay, Bybit Pay, or Bank Wire must originate from an account
            registered under the buyer&apos;s verified Nepefy profile name. Third-party payments may be rejected and
            disputed.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span>4. Release Finality &amp; Zero Off-Platform Trades</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Once a seller clicks <strong>Release USDT</strong>, ownership transfers irreversibly to the buyer. Never
            release USDT based on unverified SMS alerts, edited receipts, or promises to settle outside Nepefy Escrow.
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
          <h3 className="text-xs font-semibold text-slate-900">Escrow Fee &amp; Limits Schedule</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-5">
            <div className="text-xs text-slate-500">Completed Trade Escrow Fee</div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900">${formatUsd(p2pFeeUsd)} USDT</div>
            <div className="mt-0.5 text-xs text-slate-500">Flat fee per settled escrow order</div>
          </div>
          <div className="p-5">
            <div className="text-xs text-slate-500">Cancelled Order Fee</div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-emerald-600">$0.00 USDT</div>
            <div className="mt-0.5 text-xs text-slate-500">100% locked principal &amp; fee refunded</div>
          </div>
          <div className="p-5">
            <div className="text-xs text-slate-500">Minimum P2P Offer Size</div>
            <div className="mt-1 text-lg font-bold font-mono-tabular text-slate-900">$10.00 USDT</div>
            <div className="mt-0.5 text-xs text-slate-500">Applies to both Buy &amp; Sell ads</div>
          </div>
        </div>
      </div>
    </section>
  );
};

/* 3. Order Appeals & Support Page */
interface P2PAppealsSupportPageProps extends HelpPageBaseProps {
  orders: P2POrder[];
  currentUserId: string;
  onOpenOrderRoom: (order: P2POrder) => void;
  onGoToOrders: () => void;
  onOpenSupportChat?: () => void;
}

export const P2PAppealsSupportPage: React.FC<P2PAppealsSupportPageProps> = ({
  orders,
  currentUserId,
  onBackToMarket,
  onOpenOrderRoom,
  onGoToOrders,
  onOpenSupportChat,
}) => {
  const actionableOrders = (orders ?? []).filter(
    (o) => o.status === 'ESCROW_LOCKED' || o.status === 'PAID' || o.status === 'DISPUTED'
  );

  return (
    <section className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Order Appeals &amp; Support</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispute resolution workflow, required payment evidence, and direct access to open escrow orders
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenSupportChat && (
            <button
              type="button"
              onClick={onOpenSupportChat}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Live Admin Support Chat</span>
            </button>
          )}
          <button
            type="button"
            onClick={onBackToMarket}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to P2P Market</span>
          </button>
        </div>
      </div>

      {/* 3-Step Dispute Escalation Process */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">01. Upload Proof in Order Chat</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Attach a clear screenshot of your bKash/Nagad/Rocket or bank transfer along with the TrxID inside the
            Order Room chat.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">02. Raise a Dispute</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            If the counterparty does not release or disputes receipt, click <strong>Raise Dispute</strong> in the Order
            Room and enter a concise reason.
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-sm font-semibold text-slate-900">03. Escrow Arbitration</div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Nepefy arbitrators inspect the locked order, timestamps, and chat receipts to award funds (
            <span className="font-mono-tabular">RESOLVED_BUYER</span> or{' '}
            <span className="font-mono-tabular">RESOLVED_SELLER</span>).
          </p>
        </div>
      </div>

      {/* Active & Disputed Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Your Active &amp; Disputed Orders</h3>
            <p className="text-xs text-slate-500">
              Open any active order room to submit payment proof or escalate a dispute
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToOrders}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
          >
            <span>View All Orders ({(orders ?? []).length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {actionableOrders.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-sm font-medium text-slate-900">No Active or Disputed Orders</div>
            <p className="text-xs text-slate-500">
              You currently have no open escrow trades requiring support or appeal.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {actionableOrders.map((ord) => {
              const amBuyer = ord.buyer_id === currentUserId;
              return (
                <div
                  key={ord.id}
                  className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50/60"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono-tabular font-semibold text-slate-900">{ord.id}</span>
                      <span className="text-slate-300">|</span>
                      <span
                        className={`font-semibold ${
                          ord.status === 'DISPUTED' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      >
                        {ord.status}
                      </span>
                      <span className="text-slate-300">|</span>
                      <span className="text-slate-500">{formatDateTime(ord.created_at)}</span>
                    </div>
                    <div className="text-xs text-slate-600 font-mono-tabular">
                      {amBuyer ? 'Buying' : 'Selling'} {formatUsd(ord.amount_vusd)} USDT (
                      {formatFiatAmount(ord.fiat_total, ord.fiat_currency || 'USD')}{' '}
                      {String(ord.fiat_currency || 'USD').toUpperCase()}) via {ord.payment_method}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenOrderRoom(ord)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Open Order Room</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Common Appeal Scenarios */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Common Appeal Scenarios</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-slate-800">Paid, Seller Has Not Released</div>
            <p className="mt-1 leading-relaxed">
              Wait a few minutes after clicking Mark as Paid, message the seller with your TrxID screenshot, and click
              Raise Dispute if unresponsive.
            </p>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Buyer Marked Paid Without Sending</div>
            <p className="mt-1 leading-relaxed">
              Do not click Release USDT. Check your app balance, request the transfer receipt in chat, and raise a
              dispute if no payment arrived.
            </p>
          </div>
          <div>
            <div className="font-semibold text-slate-800">Wrong Amount or Third-Party Account</div>
            <p className="mt-1 leading-relaxed">
              Keep funds untouched, document the mismatch inside the Order Room chat, and escalate to an arbitrator for
              refund or adjustment.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
