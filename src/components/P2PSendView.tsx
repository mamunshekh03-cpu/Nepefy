import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  BellRing,
  BookOpen,
  Check,
  ChevronDown,
  CircleEllipsis,
  FileText,
  HelpCircle,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  ShieldCheck,
  ThumbsUp,
  Timer,
  UserCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import {
  SUPPORTED_FIAT_CURRENCIES,
  formatFiatAmount,
  formatFiatRate,
  getCurrencyCountries,
  getCurrencyMeta,
} from '../lib/currencies';
import type { P2POffer, P2POrder, UserPaymentMethod, UserProfile } from '../types';
import { GatewayLogo } from './CryptoIcon';
import { P2PAppealsSupportPage, P2PEscrowRulesPage, P2PUserGuidePage } from './P2PHelpPages';
import { P2POrderRoomModal, type P2PLiveSignal } from './P2POrderRoomModal';
import { SelectDropdown, useClickOutside } from './SelectDropdown';

interface P2PSendViewProps {
  user: UserProfile;
  onRefresh: () => Promise<void>;
  liveSignal?: P2PLiveSignal | null;
  focusOrderId?: string | null;
  onClearFocusOrder?: () => void;
  onOpenSupportChat?: () => void;
}

const PAYMENT_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All payments' },
  { value: 'Binance Pay', label: 'Binance Pay' },
  { value: 'Bybit Pay', label: 'Bybit Pay' },
  { value: 'Nagad', label: 'Nagad' },
  { value: 'bKash', label: 'bKash' },
  { value: 'Rocket', label: 'Rocket' },
  { value: 'Bank Wire', label: 'Bank Wire' },
];

const CURRENCY_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Currencies', searchText: 'all global' },
  ...SUPPORTED_FIAT_CURRENCIES.map((c) => ({
    value: c.code,
    label: `${c.code} · ${c.name}`,
    searchText: `${c.code} ${c.name} ${c.region} ${getCurrencyCountries(c.code).join(' ')}`,
  })),
];

const CURRENCY_POST_OPTIONS = SUPPORTED_FIAT_CURRENCIES.map((c) => ({
  value: c.code,
  label: c.symbol.trim() ? `${c.code} (${c.symbol.trim()}) · ${c.region}` : `${c.code} · ${c.region}`,
  searchText: `${c.code} ${c.name} ${c.region} ${getCurrencyCountries(c.code).join(' ')}`,
}));

const SORT_OPTIONS = [
  { value: 'PRICE_ASC', label: 'Price: Lowest to Highest' },
  { value: 'PRICE_DESC', label: 'Price: Highest to Lowest' },
  { value: 'AVAILABLE_DESC', label: 'Available: High to Low' },
] as const;

type SortMode = (typeof SORT_OPTIONS)[number]['value'];

const AVAILABLE_PAYMENT_METHODS = [
  'bKash',
  'Nagad',
  'Rocket',
  'Binance Pay',
  'Bybit Pay',
  'Bank Wire',
] as const;

const PAYMENT_ACCENT_COLOR: Record<string, string> = {
  bKash: '#E2136E',
  Nagad: '#F97316',
  Rocket: '#16A34A',
  'Binance Pay': '#F0B90B',
  'Bybit Pay': '#0F172A',
  'Bank Wire': '#2563EB',
};

const WINDOW_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
];

function parseOfferMethods(rawMethod?: string | null): string[] {
  const parts = String(rawMethod || 'Binance Pay')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : ['Binance Pay'];
}

function formatLimitNumber(amount: number, code?: string | null): string {
  const cur = String(code || 'USD').toUpperCase();
  const isWholeFiat = cur === 'BDT' || getCurrencyMeta(cur).decimals === 0;
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: isWholeFiat ? 0 : 2,
    maximumFractionDigits: isWholeFiat ? 0 : 2,
  });
}

export const P2PSendView: React.FC<P2PSendViewProps> = ({
  user,
  onRefresh,
  liveSignal = null,
  focusOrderId = null,
  onClearFocusOrder,
  onOpenSupportChat,
}) => {
  const [offers, setOffers] = useState<P2POffer[]>([]);
  const [orders, setOrders] = useState<P2POrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Market navigation & filters (Binance-style: Buy tab shows SELL offers, Sell tab shows BUY offers)
  const [activeSection, setActiveSection] = useState<
    'MARKET' | 'ORDERS' | 'USER_CENTER' | 'HELP_USER_GUIDE' | 'HELP_ESCROW_RULES' | 'HELP_APPEALS_SUPPORT'
  >('MARKET');
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useClickOutside(helpMenuRef, helpMenuOpen, () => setHelpMenuOpen(false));
  useClickOutside(moreMenuRef, moreMenuOpen, () => setMoreMenuOpen(false));

  const [savedPaymentMethods, setSavedPaymentMethods] = useState<UserPaymentMethod[]>([]);
  const [tradeIntent, setTradeIntent] = useState<'BUY' | 'SELL'>('BUY');
  const [filterAmount, setFilterAmount] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('ALL');
  const [filterPayment, setFilterPayment] = useState('ALL');
  const [sortBy, setSortBy] = useState<SortMode>('PRICE_ASC');

  // Post Offer panel
  const [showPostOffer, setShowPostOffer] = useState(false);
  const [offerSide, setOfferSide] = useState<'BUY' | 'SELL'>('SELL');
  const [offerCurrency, setOfferCurrency] = useState('BDT');
  const [offerTotal, setOfferTotal] = useState('500');
  const [offerMin, setOfferMin] = useState('50');
  const [offerMax, setOfferMax] = useState('500');
  const [offerRate, setOfferRate] = useState('122.50');
  const [offerMethods, setOfferMethods] = useState<string[]>(['bKash']);
  const [offerMethodsOpen, setOfferMethodsOpen] = useState(false);
  const offerMethodsRef = useRef<HTMLDivElement>(null);
  useClickOutside(offerMethodsRef, offerMethodsOpen, () => setOfferMethodsOpen(false));
  const [offerWindowMin, setOfferWindowMin] = useState<number>(15);
  const [offerTerms, setOfferTerms] = useState('Instant release upon confirmation.');
  const [postingOffer, setPostingOffer] = useState(false);

  // Selected offer for Trade Drawer/Modal
  const [selectedOffer, setSelectedOffer] = useState<P2POffer | null>(null);
  const [selectedTradeMethod, setSelectedTradeMethod] = useState<string>('bKash');
  const [tradeAmount, setTradeAmount] = useState('');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [closingOfferId, setClosingOfferId] = useState<string | null>(null);

  // Active Order Room & Live Chat modal
  const [activeOrderRoom, setActiveOrderRoom] = useState<P2POrder | null>(null);
  const [p2pFeeUsd, setP2pFeeUsd] = useState<number>(0.1);

  const loadP2P = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const [offRes, ordRes] = await Promise.all([
        apiFetch<{ offers?: P2POffer[] }>('/api/p2p/offers'),
        apiFetch<{ orders?: P2POrder[] }>('/api/p2p/orders'),
      ]);
      const nextOffers = Array.isArray(offRes?.offers) ? offRes.offers : [];
      const nextOrders = Array.isArray(ordRes?.orders) ? ordRes.orders : [];
      setOffers(nextOffers);
      setOrders(nextOrders);
      return nextOrders;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadP2P().catch((err: any) => {
      setNotice({ type: 'err', text: err?.message || 'Unable to load P2P marketplace data.' });
      setLoading(false);
    });
    apiFetch<{ paymentMethods?: UserPaymentMethod[] }>('/api/profile/payment-methods')
      .then((res) => {
        if (Array.isArray(res?.paymentMethods)) {
          setSavedPaymentMethods(res.paymentMethods);
        }
      })
      .catch(() => {});
    apiFetch<{ settings?: { p2pFeeUsd?: number } }>('/api/public/settings')
      .then((res) => {
        if (typeof res?.settings?.p2pFeeUsd === 'number') {
          setP2pFeeUsd(res.settings.p2pFeeUsd);
        }
      })
      .catch(() => {});
  }, []);

  // Open specific order room when navigated from top-level live notification
  useEffect(() => {
    if (!focusOrderId) return;
    setActiveSection('ORDERS');
    const existing = orders.find((o) => o.id === focusOrderId);
    if (existing) {
      setActiveOrderRoom(existing);
      onClearFocusOrder?.();
    } else {
      loadP2P()
        .then((fresh) => {
          const found = fresh?.find((o) => o.id === focusOrderId);
          if (found) setActiveOrderRoom(found);
          onClearFocusOrder?.();
        })
        .catch(() => {});
    }
  }, [focusOrderId, orders]);

  // Real-time WebSocket updates for orders list & active order room
  useEffect(() => {
    if (!liveSignal) return;
    if (
      liveSignal.type === 'P2P_ORDER_CREATED' ||
      liveSignal.type === 'P2P_RELEASE_REQUEST' ||
      liveSignal.type === 'P2P_ORDER_UPDATED'
    ) {
      const incoming = liveSignal.order;
      if (incoming) {
        setOrders((prev) => {
          const exists = prev.some((o) => o.id === incoming.id);
          return exists ? prev.map((o) => (o.id === incoming.id ? incoming : o)) : [incoming, ...prev];
        });
        setActiveOrderRoom((prev) => (prev && prev.id === incoming.id ? incoming : prev));
      }
      loadP2P().catch(() => {});
    } else if (liveSignal.type === 'P2P_CHAT_MESSAGE' && liveSignal.orderId && liveSignal.message) {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === liveSignal.orderId
            ? {
                ...o,
                last_message: liveSignal.message!.body,
                last_message_at: liveSignal.message!.created_at,
                message_count: Number(o.message_count || 0) + 1,
              }
            : o
        )
      );
    }
  }, [liveSignal]);

  const activeOrdersCount = useMemo(
    () => (orders ?? []).filter((o) => o.status === 'ESCROW_LOCKED' || o.status === 'PAID' || o.status === 'DISPUTED').length,
    [orders]
  );

  // Buy tab = makers SELLING USDT; Sell tab = makers BUYING USDT
  const targetMakerSide = tradeIntent === 'BUY' ? 'SELL' : 'BUY';

  const filteredOffers = useMemo(() => {
    const amtNum = filterAmount.trim() ? Number(filterAmount) : null;
    const list = (offers ?? []).filter((offer) => {
      if (offer.side !== targetMakerSide) return false;
      const offerCur = String(offer.fiat_currency || 'USD').toUpperCase();
      if (filterCurrency !== 'ALL' && offerCur !== filterCurrency) return false;
      const methods = parseOfferMethods(offer.payment_method);
      if (filterPayment !== 'ALL' && !methods.includes(filterPayment)) return false;
      if (amtNum !== null && Number.isFinite(amtNum) && amtNum > 0) {
        const effectiveMax = Math.min(offer.max_limit, offer.available_amount);
        if (filterCurrency === 'ALL') {
          if (amtNum < offer.min_limit || amtNum > effectiveMax) return false;
        } else {
          const minFiat = offer.min_limit * offer.rate_usd;
          const maxFiat = effectiveMax * offer.rate_usd;
          if (amtNum < minFiat || amtNum > maxFiat) return false;
        }
      }
      return true;
    });

    const sorted = [...list];
    if (sortBy === 'PRICE_ASC') {
      sorted.sort((a, b) => a.rate_usd - b.rate_usd || Date.parse(b.created_at) - Date.parse(a.created_at));
    } else if (sortBy === 'PRICE_DESC') {
      sorted.sort((a, b) => b.rate_usd - a.rate_usd || Date.parse(b.created_at) - Date.parse(a.created_at));
    } else {
      sorted.sort((a, b) => b.available_amount - a.available_amount);
    }
    return sorted;
  }, [offers, targetMakerSide, filterCurrency, filterPayment, filterAmount, sortBy]);

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setPostingOffer(true);
    try {
      await apiFetch('/api/p2p/offers', {
        method: 'POST',
        body: JSON.stringify({
          side: offerSide,
          total_amount: Number(offerTotal),
          min_limit: Number(offerMin),
          max_limit: Number(offerMax),
          rate_usd: Number(offerRate),
          fiat_currency: offerCurrency,
          payment_method: offerMethods.length > 0 ? offerMethods.join(', ') : 'bKash',
          payment_window_min: offerWindowMin,
          terms: offerTerms,
        }),
      });
      setShowPostOffer(false);
      // Switch view to the tab where the newly created offer appears
      setTradeIntent(offerSide === 'SELL' ? 'BUY' : 'SELL');
      setFilterCurrency(offerCurrency);
      setActiveSection('MARKET');
      setNotice({ type: 'ok', text: `Published P2P ${offerSide} (${offerCurrency}) offer.` });
      await loadP2P();
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setPostingOffer(false);
    }
  };

  const openTradeModal = (offer: P2POffer) => {
    setNotice(null);
    setSelectedOffer(offer);
    const methods = parseOfferMethods(offer.payment_method);
    setSelectedTradeMethod(methods[0] || 'bKash');
    const effectiveMax = Math.min(offer.max_limit, offer.available_amount);
    let defaultAmt = Math.min(offer.min_limit, offer.available_amount);
    if (filterAmount.trim() && Number(filterAmount) > 0) {
      const convertedUsdt =
        filterCurrency === 'ALL'
          ? Number(filterAmount)
          : Number(filterAmount) / Math.max(offer.rate_usd, 0.0001);
      if (convertedUsdt >= offer.min_limit) {
        defaultAmt = Math.min(convertedUsdt, effectiveMax);
      }
    }
    setTradeAmount(String(Number(defaultAmt.toFixed(2))));
  };

  const handleConfirmTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOffer) return;
    setNotice(null);
    const amt = Number(tradeAmount);
    setPlacingOrder(true);
    try {
      const res = await apiFetch<{ order: P2POrder }>('/api/p2p/orders', {
        method: 'POST',
        body: JSON.stringify({
          offer_id: selectedOffer.id,
          amount_vusd: amt,
          payment_method: selectedTradeMethod,
        }),
      });
      setSelectedOffer(null);
      setTradeAmount('');
      setActiveSection('ORDERS');
      if (res?.order) {
        setActiveOrderRoom(res.order);
      }
      setNotice({
        type: 'ok',
        text: `Escrow order ${res?.order?.id || ''} opened for $${formatUsd(amt)} USDT. Seller notified automatically.`,
      });
      await Promise.all([loadP2P(), onRefresh()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleCloseOffer = async (offerId: string) => {
    setNotice(null);
    setClosingOfferId(offerId);
    try {
      await apiFetch(`/api/p2p/offers/${offerId}`, { method: 'DELETE' });
      setNotice({ type: 'ok', text: 'Your P2P offer has been closed and removed from active listings.' });
      await loadP2P();
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to close offer.' });
    } finally {
      setClosingOfferId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Dark Geometric P2P Hero Banner (compact height, single-line headline) */}
      <div className="relative overflow-hidden rounded-xl bg-[#0D1017] text-white px-5 py-4 sm:py-5 border border-slate-800/80">
        {/* Subtle diagonal slice & diamond dot pattern */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="absolute inset-0 bg-[#181D27]/75"
            style={{ clipPath: 'polygon(64% 0, 100% 0, 100% 100%, 48% 100%)' }}
          />
          <svg className="absolute inset-0 h-full w-full opacity-[0.14]" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="p2p-diamond-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                <path d="M8 5.2L10.8 8 8 10.8 5.2 8Z" fill="#94A3B8" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#p2p-diamond-grid)" />
          </svg>
          {/* Subtle embossed geometric coin rings */}
          <svg
            className="absolute left-[18%] -bottom-8 w-40 h-40 text-white opacity-[0.045]"
            viewBox="0 0 120 120"
            fill="none"
          >
            <circle cx="60" cy="60" r="52" stroke="currentColor" strokeWidth="8" />
            <circle cx="60" cy="60" r="36" stroke="currentColor" strokeWidth="2.5" />
            <path d="M40 60h40M60 40v40" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
          </svg>
          <svg
            className="absolute right-[4%] -bottom-10 w-44 h-44 text-white opacity-[0.045]"
            viewBox="0 0 120 120"
            fill="none"
          >
            <circle cx="60" cy="60" r="52" stroke="currentColor" strokeWidth="8" />
            <circle cx="60" cy="60" r="36" stroke="currentColor" strokeWidth="2.5" />
            <path d="M44 76L76 44" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
            <circle cx="48" cy="48" r="5.5" fill="currentColor" />
            <circle cx="72" cy="72" r="5.5" fill="currentColor" />
          </svg>
        </div>

        {/* Centered Single-Line Headline, Compact Subtitle & Controls */}
        <div className="relative z-10 max-w-5xl mx-auto text-center space-y-1.5">
          <h1 className="text-base sm:text-xl lg:text-[22px] font-semibold tracking-tight text-white leading-tight lg:whitespace-nowrap">
            Buy and Sell TetherUS (USDT) with Your Preferred Payment Methods
          </h1>
          <p className="text-xs sm:text-[13px] text-slate-300/90 max-w-3xl mx-auto leading-snug">
            Buy and sell TetherUS safely and easily on Nepefy P2P. Find the best offer below and buy and sell USDT
            with your preferred payment methods today.
          </p>

          <div className="pt-1.5 flex flex-wrap items-center justify-center gap-3">
            <span className="text-xs text-slate-300 font-mono-tabular">
              Main Balance: <strong className="text-white font-semibold">${formatUsd(user.main_balance)}</strong>
              <span className="mx-2 text-slate-600" aria-hidden="true">|</span>
              UID: <span className="text-slate-200">{user.uid || user.id}</span>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSection('HELP_USER_GUIDE')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 rounded-lg transition-colors whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>User Guide</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowPostOffer((v) => !v);
                  setNotice(null);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[#FCD535] hover:bg-[#F0B90B] text-slate-900 rounded-lg transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showPostOffer ? 'Hide Post Offer' : 'Post P2P Offer'}</span>
              </button>
            </div>
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

      {/* Post Offer Form */}
      {showPostOffer && (
        <form
          onSubmit={handleCreateOffer}
          className="border border-slate-200 rounded-xl bg-white p-6 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Post New P2P Offer</h2>
              <p className="text-xs text-slate-500">
                Publish a Buy or Sell USDT offer to the live marketplace · Escrow fee ${formatUsd(p2pFeeUsd)} per filled order
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPostOffer(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Offer Side</label>
              <SelectDropdown
                value={offerSide}
                onChange={(val) => setOfferSide(val)}
                options={[
                  { value: 'SELL' as const, label: 'SELL USDT (Advertiser sells)' },
                  { value: 'BUY' as const, label: 'BUY USDT (Advertiser buys)' },
                ]}
                buttonClassName="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Fiat Currency</label>
              <SelectDropdown
                value={offerCurrency}
                onChange={(val) => {
                  setOfferCurrency(val);
                  const meta = getCurrencyMeta(val);
                  setOfferRate(String(meta.referenceRatePerUsdt));
                }}
                options={CURRENCY_POST_OPTIONS}
                searchable
                searchPlaceholder="Search currency or country..."
                buttonClassName="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-900"
                menuClassName="max-h-64 overflow-y-auto"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Rate ({offerCurrency} per USDT)
              </label>
              <input
                type="number"
                step="0.001"
                value={offerRate}
                onChange={(e) => setOfferRate(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Total Available (USDT)</label>
              <input
                type="number"
                min="10"
                step="1"
                value={offerTotal}
                onChange={(e) => setOfferTotal(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Min Limit (USDT)</label>
              <input
                type="number"
                min="1"
                value={offerMin}
                onChange={(e) => setOfferMin(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Max Limit (USDT)</label>
              <input
                type="number"
                min="1"
                value={offerMax}
                onChange={(e) => setOfferMax(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Window</label>
              <SelectDropdown
                value={offerWindowMin}
                onChange={(val) => setOfferWindowMin(val)}
                options={WINDOW_OPTIONS}
                buttonClassName="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-900"
              />
            </div>

            <div className="relative" ref={offerMethodsRef}>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Methods</label>
              <button
                type="button"
                onClick={() => setOfferMethodsOpen((prev) => !prev)}
                aria-expanded={offerMethodsOpen}
                className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-900 flex items-center justify-between gap-2 text-left transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0 truncate">
                  <span
                    className="w-[3px] h-3 rounded-full shrink-0"
                    style={{ backgroundColor: PAYMENT_ACCENT_COLOR[offerMethods[0]] || '#64748B' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {offerMethods.length === 1
                      ? offerMethods[0]
                      : `${offerMethods.join(', ')} (${offerMethods.length})`}
                  </span>
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
                    offerMethodsOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {offerMethodsOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-full bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                  {AVAILABLE_PAYMENT_METHODS.map((method) => {
                    const selected = offerMethods.includes(method);
                    const dotColor = PAYMENT_ACCENT_COLOR[method] || '#64748B';
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => {
                          setOfferMethods((prev) => {
                            if (prev.includes(method)) {
                              return prev.length > 1 ? prev.filter((m) => m !== method) : prev;
                            }
                            return [...prev, method];
                          });
                        }}
                        className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-slate-50 transition-colors whitespace-nowrap ${
                          selected ? 'bg-blue-50/70 text-blue-600 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-[3px] h-3 rounded-full shrink-0"
                            style={{ backgroundColor: dotColor }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{method}</span>
                        </span>
                        {selected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Settlement Terms</label>
              <input
                type="text"
                value={offerTerms}
                onChange={(e) => setOfferTerms(e.target.value)}
                className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-500">
                Selected channels: <strong className="text-slate-700">{offerMethods.join(', ')}</strong>
              </span>
              <button
                type="submit"
                disabled={postingOffer}
                className="px-6 h-9 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
              >
                {postingOffer ? 'Publishing...' : 'Publish Offer'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Sub-Navigation Bar (P2P Market | Right Utility Controls) */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveSection('MARKET')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeSection === 'MARKET'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            P2P Market
          </button>
        </div>

        {/* Right Utility Nav: P2P Help Center v · Orders · User Center · More v */}
        <div className="flex flex-wrap items-center gap-5 pb-2.5 text-[13px] font-medium text-slate-700">
          {/* P2P Help Center Dropdown */}
          <div className="relative" ref={helpMenuRef}>
            <button
              type="button"
              onClick={() => {
                setHelpMenuOpen((v) => !v);
                setMoreMenuOpen(false);
              }}
              aria-expanded={helpMenuOpen}
              className={`inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                activeSection === 'HELP_USER_GUIDE' ||
                activeSection === 'HELP_ESCROW_RULES' ||
                activeSection === 'HELP_APPEALS_SUPPORT'
                  ? 'text-slate-900 font-semibold'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              <HelpCircle className="w-4 h-4 text-slate-500 shrink-0" />
              <span>P2P Help Center</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${helpMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {helpMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('HELP_USER_GUIDE');
                    setHelpMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                    activeSection === 'HELP_USER_GUIDE'
                      ? 'bg-blue-50/70 text-blue-600 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <BookOpen
                    className={`w-3.5 h-3.5 ${
                      activeSection === 'HELP_USER_GUIDE' ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span>Beginner&apos;s P2P User Guide</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('HELP_ESCROW_RULES');
                    setHelpMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                    activeSection === 'HELP_ESCROW_RULES'
                      ? 'bg-blue-50/70 text-blue-600 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck
                    className={`w-3.5 h-3.5 ${
                      activeSection === 'HELP_ESCROW_RULES' ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span>Escrow Protection Rules</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('HELP_APPEALS_SUPPORT');
                    setHelpMenuOpen(false);
                  }}
                  className={`w-full px-3.5 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                    activeSection === 'HELP_APPEALS_SUPPORT'
                      ? 'bg-blue-50/70 text-blue-600 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare
                    className={`w-3.5 h-3.5 ${
                      activeSection === 'HELP_APPEALS_SUPPORT' ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  />
                  <span>Order Appeals &amp; Support</span>
                </button>
              </div>
            )}
          </div>

          {/* Orders Shortcut */}
          <button
            type="button"
            onClick={() => setActiveSection('ORDERS')}
            className={`inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              activeSection === 'ORDERS' ? 'text-slate-900 font-semibold' : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <FileText className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Orders</span>
            {activeOrdersCount > 0 && (
              <span className="font-mono-tabular text-[11px] font-semibold text-blue-600">
                ({activeOrdersCount})
              </span>
            )}
          </button>

          {/* User Center */}
          <button
            type="button"
            onClick={() => setActiveSection('USER_CENTER')}
            className={`inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              activeSection === 'USER_CENTER' ? 'text-slate-900 font-semibold' : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-4 h-4 text-slate-500 shrink-0" />
            <span>User Center</span>
          </button>

          {/* More Dropdown */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen((v) => !v);
                setHelpMenuOpen(false);
              }}
              aria-expanded={moreMenuOpen}
              className="inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900 transition-colors whitespace-nowrap"
            >
              <CircleEllipsis className="w-4 h-4 text-slate-500 shrink-0" />
              <span>More</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform ${moreMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {moreMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-40">
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('MARKET');
                    setShowPostOffer(true);
                    setMoreMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-400" />
                  <span>Post New Ad</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('USER_CENTER');
                    setMoreMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2"
                >
                  <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>My P2P Ads</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection('MARKET');
                    setMoreMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900 flex items-center gap-2"
                >
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <span>Browse Marketplace</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {activeSection === 'MARKET' ? (
        <div className="space-y-4">
          {/* Buy / Sell Segmented Toggle & Asset Indicator */}
          <div className="flex flex-wrap items-center gap-5">
            <div className="inline-flex items-center p-1 border border-slate-200 rounded-lg bg-white">
              <button
                type="button"
                onClick={() => setTradeIntent('BUY')}
                className={`px-6 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  tradeIntent === 'BUY'
                    ? 'bg-[#0ECB81] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setTradeIntent('SELL')}
                className={`px-6 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  tradeIntent === 'SELL'
                    ? 'bg-[#F6465D] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sell
              </button>
            </div>

            <span className="text-xs text-slate-400 font-normal">
              {tradeIntent === 'BUY'
                ? 'Showing advertisers selling USDT'
                : 'Showing advertisers buying USDT'}
            </span>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
              <div className="relative flex items-center w-full sm:w-auto">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={filterAmount}
                  onChange={(e) => setFilterAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="h-9 w-full sm:w-44 pl-8 pr-12 text-xs font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400"
                />
                <span className="absolute right-3 text-[11px] font-semibold text-slate-500">
                  {filterCurrency === 'ALL' ? 'USDT' : filterCurrency}
                </span>
              </div>

              <SelectDropdown
                value={filterCurrency}
                onChange={(val) => setFilterCurrency(val)}
                options={CURRENCY_FILTER_OPTIONS}
                searchable
                searchPlaceholder="Search currency or country..."
                buttonClassName="h-9 w-full sm:w-auto sm:min-w-[175px] px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-800"
                menuClassName="max-h-72 overflow-y-auto w-72"
              />

              <SelectDropdown
                value={filterPayment}
                onChange={(val) => setFilterPayment(val)}
                options={PAYMENT_FILTER_OPTIONS}
                buttonClassName="h-9 flex-1 sm:flex-none sm:min-w-[155px] px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-800"
              />

              <SelectDropdown
                value={sortBy}
                onChange={(val) => setSortBy(val)}
                options={[...SORT_OPTIONS]}
                buttonClassName="h-9 flex-1 sm:flex-none sm:min-w-[190px] px-3 text-xs bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-800"
              />

              {(filterAmount || filterCurrency !== 'ALL' || filterPayment !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterAmount('');
                    setFilterCurrency('ALL');
                    setFilterPayment('ALL');
                  }}
                  className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap"
                >
                  Reset
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => loadP2P(true)}
              disabled={refreshing}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200/80 text-slate-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* 5-Column P2P Offer Table (Light Theme matching Nepefy) */}
          <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3.5 px-5">Advertiser</th>
                  <th className="py-3.5 px-4">
                    Price{' '}
                    <span className="text-[11px] font-normal text-slate-400">
                      {sortBy === 'PRICE_ASC'
                        ? '· lowest to highest'
                        : sortBy === 'PRICE_DESC'
                        ? '· highest to lowest'
                        : ''}
                    </span>
                  </th>
                  <th className="py-3.5 px-4">Available / Order Limit</th>
                  <th className="py-3.5 px-4">Payment</th>
                  <th className="py-3.5 px-5 text-right">Trade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-10 px-5 text-center text-slate-500">
                      Loading live P2P marketplace offers...
                    </td>
                  </tr>
                ) : filteredOffers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 px-5 text-center space-y-2">
                      <div className="text-sm font-medium text-slate-900">
                        No matching {tradeIntent === 'BUY' ? 'Sell' : 'Buy'} offers found
                      </div>
                      <p className="text-xs text-slate-500">
                        Adjust your amount or payment filter, switch Buy/Sell, or post a new P2P offer.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredOffers.map((offer) => {
                    const isMine = offer.creator_id === user.id;
                    const totalOrders = Number(offer.creator_orders_count || 0);
                    const completedOrders = Number(offer.creator_completed_count || 0);
                    const disputedOrders = Number(offer.creator_disputed_count || 0);
                    const completionPct =
                      totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(2) : '100.00';
                    const ratingPct =
                      totalOrders > 0
                        ? Math.max(0, ((totalOrders - disputedOrders) / totalOrders) * 100).toFixed(2)
                        : '100.00';
                    const paymentWindowMin = Number(offer.payment_window_min || 15);
                    const effectiveMax = Math.min(offer.max_limit, offer.available_amount);
                    const initial = (offer.creator_name || 'U').trim().charAt(0).toUpperCase();
                    const cur = String(offer.fiat_currency || 'USD').toUpperCase();
                    const methods = parseOfferMethods(offer.payment_method);

                    return (
                      <tr key={offer.id} className="hover:bg-slate-50/70 transition-colors">
                        {/* Advertiser: Avatar + Name + Badge / orders | completion / rating | min */}
                        <td className="py-5 px-5 align-middle">
                          <div className="flex items-start gap-3">
                            <div className="relative w-8 h-8 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                              {initial}
                              <span
                                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#0ECB81] ring-2 ring-white"
                                aria-label="Online"
                              />
                            </div>
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-slate-900 truncate">
                                  {offer.creator_name}
                                </span>
                                {offer.creator_kyc_status === 'VERIFIED' && (
                                  <BadgeCheck
                                    className="w-4 h-4 text-[#F0B90B] shrink-0"
                                    aria-label="Verified Advertiser"
                                  />
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[13px] text-slate-600 font-mono-tabular whitespace-nowrap">
                                <span>{totalOrders.toLocaleString('en-US')} orders</span>
                                <span className="text-slate-300" aria-hidden="true">|</span>
                                <span>{completionPct}% completion</span>
                              </div>

                              <div className="flex items-center gap-2 text-[13px] text-slate-600 font-mono-tabular whitespace-nowrap">
                                <span className="inline-flex items-center gap-1">
                                  <ThumbsUp className="w-3.5 h-3.5 text-slate-500" />
                                  <span>{ratingPct}%</span>
                                </span>
                                <span className="text-slate-300" aria-hidden="true">|</span>
                                <span className="inline-flex items-center gap-1">
                                  <Timer className="w-3.5 h-3.5 text-slate-500" />
                                  <span>{paymentWindowMin} min</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Price */}
                        <td className="py-5 px-4 align-middle whitespace-nowrap">
                          <div className="flex items-baseline gap-1 font-mono-tabular">
                            <span className="text-sm font-semibold text-slate-700">
                              {cur === 'BDT' ? 'Tk.' : getCurrencyMeta(cur).symbol.trim() || cur}
                            </span>
                            <span className="text-xl font-bold text-slate-900">
                              {formatFiatRate(offer.rate_usd, cur)}
                            </span>
                            {cur !== 'BDT' && getCurrencyMeta(cur).symbol.trim() !== '' && (
                              <span className="text-xs font-medium text-slate-500 ml-0.5">{cur}</span>
                            )}
                          </div>
                        </td>

                        {/* Available / Order Limit */}
                        <td className="py-5 px-4 align-middle whitespace-nowrap">
                          <div className="space-y-1.5">
                            <div className="text-sm font-semibold font-mono-tabular text-slate-900">
                              {formatUsd(offer.available_amount)} USDT
                            </div>
                            <div className="text-[13px] font-mono-tabular text-slate-600">
                              {formatLimitNumber(offer.min_limit * offer.rate_usd, cur)} {cur} -{' '}
                              {formatLimitNumber(effectiveMax * offer.rate_usd, cur)} {cur}
                            </div>
                          </div>
                        </td>

                        {/* Payment */}
                        <td className="py-5 px-4 align-middle">
                          <div className="space-y-1.5">
                            {methods.map((method) => {
                              const barColor = PAYMENT_ACCENT_COLOR[method] || '#64748B';
                              return (
                                <div
                                  key={method}
                                  className="flex items-center gap-2 text-[13px] font-medium text-slate-800 whitespace-nowrap"
                                >
                                  <span
                                    className="w-[3px] h-3.5 rounded-full shrink-0"
                                    style={{ backgroundColor: barColor }}
                                    aria-hidden="true"
                                  />
                                  <span>{method}</span>
                                </div>
                              );
                            })}
                          </div>
                        </td>

                        {/* Trade Action */}
                        <td className="py-5 px-5 align-middle text-right whitespace-nowrap">
                          {isMine ? (
                            <button
                              type="button"
                              disabled={closingOfferId === offer.id}
                              onClick={() => handleCloseOffer(offer.id)}
                              className="px-4 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-60 transition-colors whitespace-nowrap"
                            >
                              {closingOfferId === offer.id ? 'Closing...' : 'Close Offer'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openTradeModal(offer)}
                              className={`px-6 py-2.5 text-sm font-semibold text-white rounded-lg transition-colors whitespace-nowrap ${
                                tradeIntent === 'BUY'
                                  ? 'bg-[#0ECB81] hover:bg-[#0BB574]'
                                  : 'bg-[#F6465D] hover:bg-[#E0384E]'
                              }`}
                            >
                              {tradeIntent === 'BUY' ? 'Buy USDT' : 'Sell USDT'}
                            </button>
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
      ) : activeSection === 'ORDERS' ? (
        /* MY P2P ESCROW ORDERS TAB */
        <section className="space-y-3">
          <div className="border border-slate-200 rounded-xl bg-white overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Order ID</th>
                  <th className="py-3 px-4">Role · Counterparty</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Status &amp; Last Chat</th>
                  <th className="py-3 px-4 text-right">Order Room &amp; Chat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {(orders ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                      No active or historical P2P escrow orders yet.
                    </td>
                  </tr>
                ) : (
                  (orders ?? []).map((ord) => {
                    const amBuyer = ord.buyer_id === user.id;
                    const needsRelease = !amBuyer && ord.status === 'PAID';
                    const needsPayment = amBuyer && ord.status === 'ESCROW_LOCKED';
                    return (
                      <tr
                        key={ord.id}
                        onClick={() => setActiveOrderRoom(ord)}
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono-tabular text-slate-700 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{ord.id}</div>
                          <div className="text-slate-400">{formatDateTime(ord.created_at)}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">
                            {amBuyer ? 'Buying USDT' : 'Selling USDT'}
                          </div>
                          <div className="text-slate-500">
                            {amBuyer ? ord.seller_name : ord.buyer_name}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <GatewayLogo gateway={ord.payment_method} size="sm" />
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{formatUsd(ord.amount_vusd)} USDT</div>
                          <div className="text-slate-500">
                            {formatFiatAmount(ord.fiat_total, ord.fiat_currency || 'USD')}{' '}
                            {String(ord.fiat_currency || 'USD').toUpperCase()}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-[260px]">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span
                              className={
                                ord.status === 'COMPLETED' || ord.status === 'RESOLVED_BUYER'
                                  ? 'text-emerald-600'
                                  : ord.status === 'DISPUTED'
                                  ? 'text-red-600'
                                  : ord.status === 'CANCELLED' || ord.status === 'RESOLVED_SELLER'
                                  ? 'text-slate-500'
                                  : 'text-amber-600'
                              }
                            >
                              {ord.status}
                            </span>
                            {needsRelease && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                · <BellRing className="w-3 h-3" /> Release USDT
                              </span>
                            )}
                            {needsPayment && (
                              <span className="text-[11px] font-medium text-blue-600">· Pay Now</span>
                            )}
                          </div>
                          {ord.last_message && (
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {ord.last_message}
                            </div>
                          )}
                          {ord.admin_resolution_note && (
                            <div className="text-[11px] text-slate-600 mt-0.5">{ord.admin_resolution_note}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveOrderRoom(ord);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                              needsRelease
                                ? 'bg-[#0ECB81] hover:bg-[#0BB574] text-white'
                                : needsPayment
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : 'border border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                            }`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>
                              {needsRelease
                                ? 'Verify & Release'
                                : needsPayment
                                ? 'Pay & Chat'
                                : 'Open Chat'}
                              {ord.message_count ? ` (${ord.message_count})` : ''}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : activeSection === 'USER_CENTER' ? (
        /* P2P USER CENTER TAB */
        <section className="space-y-5">
          {(() => {
            const myOffers = (offers ?? []).filter((o) => o.creator_id === user.id);
            const completedCount = (orders ?? []).filter(
              (o) => o.status === 'COMPLETED' || o.status === 'RESOLVED_BUYER' || o.status === 'RESOLVED_SELLER'
            ).length;
            const totalUserOrders = (orders ?? []).length;
            const userCompletionPct =
              totalUserOrders > 0 ? ((completedCount / totalUserOrders) * 100).toFixed(2) : '100.00';

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">30d / All P2P Orders</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
                      {totalUserOrders}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">Completion Rate</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-emerald-600">
                      {userCompletionPct}%
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">My Active P2P Ads</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
                      {myOffers.length}
                    </div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <div className="text-xs font-medium text-slate-500">Saved Payment Methods</div>
                    <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
                      {savedPaymentMethods.length}
                    </div>
                  </div>
                </div>

                {/* My Active Ads */}
                <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">My Published P2P Ads</h3>
                      <p className="text-xs text-slate-500">Manage your live Buy and Sell USDT advertisements</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPostOffer(true);
                        setActiveSection('MARKET');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Post New Ad</span>
                    </button>
                  </div>

                  {myOffers.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      You have no active P2P advertisements. Click &ldquo;Post New Ad&rdquo; to publish one.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                            <th className="py-3 px-5">Side</th>
                            <th className="py-3 px-4">Price</th>
                            <th className="py-3 px-4">Available</th>
                            <th className="py-3 px-4">Payment Methods</th>
                            <th className="py-3 px-4">Window</th>
                            <th className="py-3 px-5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                          {myOffers.map((myAd) => {
                            const cur = String(myAd.fiat_currency || 'USD').toUpperCase();
                            return (
                              <tr key={myAd.id} className="hover:bg-slate-50/60">
                                <td className="py-3.5 px-5 font-semibold">
                                  <span className={myAd.side === 'SELL' ? 'text-emerald-600' : 'text-rose-600'}>
                                    {myAd.side} USDT
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 font-mono-tabular font-semibold text-slate-900">
                                  {formatFiatRate(myAd.rate_usd, cur)} {cur}
                                </td>
                                <td className="py-3.5 px-4 font-mono-tabular text-slate-800">
                                  {formatUsd(myAd.available_amount)} USDT
                                </td>
                                <td className="py-3.5 px-4 text-slate-700">{myAd.payment_method}</td>
                                <td className="py-3.5 px-4 font-mono-tabular text-slate-600">
                                  {Number(myAd.payment_window_min || 15)} min
                                </td>
                                <td className="py-3.5 px-5 text-right">
                                  <button
                                    type="button"
                                    disabled={closingOfferId === myAd.id}
                                    onClick={() => handleCloseOffer(myAd.id)}
                                    className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                  >
                                    {closingOfferId === myAd.id ? 'Closing...' : 'Close Ad'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Saved Payment Methods */}
                <div className="border border-slate-200 rounded-xl bg-white p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">P2P Payment Accounts</h3>
                      <p className="text-xs text-slate-500">
                        Receiving accounts automatically attached to your P2P sell orders
                      </p>
                    </div>
                    <span className="text-xs font-mono-tabular text-slate-500">
                      {user.kyc_status === 'VERIFIED' ? 'KYC Verified Merchant' : 'Standard Account'}
                    </span>
                  </div>

                  {savedPaymentMethods.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3">
                      No saved payment methods found. Add bKash, Nagad, Rocket, or Bank Wire under Profile &amp;
                      Security → Payment Methods.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {savedPaymentMethods.map((pm) => (
                        <div key={pm.id} className="border border-slate-200 rounded-lg p-3.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <GatewayLogo gateway={pm.method} size="sm" />
                            {pm.is_default === 1 && (
                              <span className="text-[11px] font-semibold text-blue-600">Default</span>
                            )}
                          </div>
                          <div className="text-xs font-semibold text-slate-900">{pm.account_label}</div>
                          <div className="text-xs font-mono-tabular text-slate-600">{pm.account_number}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </section>
      ) : activeSection === 'HELP_USER_GUIDE' ? (
        <P2PUserGuidePage onBackToMarket={() => setActiveSection('MARKET')} p2pFeeUsd={p2pFeeUsd} />
      ) : activeSection === 'HELP_ESCROW_RULES' ? (
        <P2PEscrowRulesPage onBackToMarket={() => setActiveSection('MARKET')} p2pFeeUsd={p2pFeeUsd} />
      ) : (
        <P2PAppealsSupportPage
          orders={orders}
          currentUserId={user.id}
          onBackToMarket={() => setActiveSection('MARKET')}
          onOpenOrderRoom={(ord) => setActiveOrderRoom(ord)}
          onGoToOrders={() => setActiveSection('ORDERS')}
          onOpenSupportChat={onOpenSupportChat}
        />
      )}

      {/* Split P2P Trade Order Modal */}
      {selectedOffer && (
        <div
          onClick={() => !placingOrder && setSelectedOffer(null)}
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-semibold text-slate-900">
                  {selectedOffer.side === 'SELL' ? 'Buy USDT' : 'Sell USDT'} from {selectedOffer.creator_name}
                </h3>
              </div>
              <button
                type="button"
                disabled={placingOrder}
                onClick={() => setSelectedOffer(null)}
                className="p-1 text-slate-400 hover:text-slate-800 rounded-md"
                aria-label="Close order modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmTrade} className="grid grid-cols-1 md:grid-cols-12">
              {(() => {
                const cur = String(selectedOffer.fiat_currency || 'USD').toUpperCase();
                const effectiveMax = Math.min(selectedOffer.max_limit, selectedOffer.available_amount);
                return (
                  <>
                    {/* Left: Offer Details & Terms */}
                    <div className="md:col-span-6 p-6 bg-slate-50/70 border-b md:border-b-0 md:border-r border-slate-200 space-y-4 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Price</span>
                        <span className="text-base font-bold font-mono-tabular text-slate-900">
                          {formatFiatRate(selectedOffer.rate_usd, cur)} {cur}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Available</span>
                        <span className="font-semibold font-mono-tabular text-slate-900">
                          {formatUsd(selectedOffer.available_amount)} USDT
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Order Limit (USDT)</span>
                        <span className="font-mono-tabular text-slate-900">
                          {formatUsd(selectedOffer.min_limit, 2)} – {formatUsd(effectiveMax, 2)} USDT
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Fiat Equivalent</span>
                        <span className="font-mono-tabular text-slate-900">
                          {formatFiatAmount(selectedOffer.min_limit * selectedOffer.rate_usd, cur)} –{' '}
                          {formatFiatAmount(effectiveMax * selectedOffer.rate_usd, cur)}
                          {!getCurrencyMeta(cur).symbol ? ` ${cur}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Payment Window</span>
                        <span className="font-mono-tabular text-slate-900">
                          {Number(selectedOffer.payment_window_min || 15)} min
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Payment Method</span>
                        <GatewayLogo gateway={selectedTradeMethod} size="sm" />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Escrow Fee</span>
                        <span className="font-mono-tabular text-slate-900">${formatUsd(p2pFeeUsd)} USDT</span>
                      </div>

                      <div className="pt-3 border-t border-slate-200 space-y-1">
                        <div className="font-semibold text-slate-800">Advertiser Terms</div>
                        <p className="text-slate-600 leading-relaxed">
                          {selectedOffer.terms || `Fast settlement within ${Number(selectedOffer.payment_window_min || 15)} minutes.`}
                        </p>
                      </div>
                    </div>

                    {/* Right: Order Amount Input */}
                    <div className="md:col-span-6 p-6 flex flex-col justify-between space-y-5">
                      <div className="space-y-4">
                        {parseOfferMethods(selectedOffer.payment_method).length > 1 && (
                          <div>
                            <label className="block text-xs font-medium text-slate-700 mb-1.5">
                              Select Payment Method
                            </label>
                            <div className="flex flex-wrap gap-1.5">
                              {parseOfferMethods(selectedOffer.payment_method).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setSelectedTradeMethod(m)}
                                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                    selectedTradeMethod === m
                                      ? 'bg-blue-50 border-blue-600 text-blue-700 font-semibold'
                                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-slate-700">
                              {selectedOffer.side === 'SELL' ? 'Amount to Buy (USDT)' : 'Amount to Sell (USDT)'}
                            </label>
                            <button
                              type="button"
                              onClick={() => setTradeAmount(String(effectiveMax))}
                              className="text-xs font-semibold text-blue-600 hover:underline"
                            >
                              All
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              type="number"
                              required
                              min={selectedOffer.min_limit}
                              max={effectiveMax}
                              step="0.01"
                              autoFocus
                              value={tradeAmount}
                              onChange={(e) => setTradeAmount(e.target.value)}
                              placeholder={String(selectedOffer.min_limit)}
                              className="w-full h-11 pl-3 pr-14 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                              USDT
                            </span>
                          </div>
                        </div>

                        <div className="border border-slate-200 rounded-lg bg-slate-50 px-3.5 py-3 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">
                              {selectedOffer.side === 'SELL' ? `You Pay (${cur})` : `You Receive (${cur})`}
                            </span>
                            <span className="font-bold font-mono-tabular text-slate-900">
                              {formatFiatAmount(Number(tradeAmount || 0) * selectedOffer.rate_usd, cur)} {cur}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">
                              {selectedOffer.side === 'SELL' ? 'You Receive' : 'Escrow Locked'}
                            </span>
                            <span className="font-semibold font-mono-tabular text-slate-900">
                              {formatUsd(Number(tradeAmount || 0))} USDT
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          disabled={placingOrder}
                          onClick={() => setSelectedOffer(null)}
                          className="px-4 py-2.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg whitespace-nowrap"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={placingOrder || !tradeAmount || Number(tradeAmount) <= 0}
                          className={`flex-1 py-2.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap ${
                            selectedOffer.side === 'SELL'
                              ? 'bg-[#0ECB81] hover:bg-[#0BB574]'
                              : 'bg-[#F6465D] hover:bg-[#E0384E]'
                          }`}
                        >
                          {placingOrder
                            ? 'Opening Escrow...'
                            : selectedOffer.side === 'SELL'
                            ? 'Buy USDT'
                            : 'Sell USDT'}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      )}

      {/* Live Binance-Style Escrow Order Room & User-to-User Chat */}
      {activeOrderRoom && (
        <P2POrderRoomModal
          order={activeOrderRoom}
          user={user}
          liveSignal={liveSignal}
          onClose={() => setActiveOrderRoom(null)}
          onOrderUpdated={async (updated) => {
            setActiveOrderRoom(updated);
            setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
            await Promise.all([loadP2P(), onRefresh()]);
          }}
        />
      )}

    </div>
  );
};
