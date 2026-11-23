import React from 'react';
import { MessageSquare, Plus, Search } from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd, getPriceDecimals } from '../../lib/api';
import { CryptoIcon } from '../CryptoIcon';
import type { MarketPair, P2POrder, SpotTrade } from '../../types';
import type { AdminOverviewData, RunActionFn, SpotStats } from './adminTypes';

interface AdminP2PTabProps {
  data: AdminOverviewData;
  p2pSubTab: 'ORDERS' | 'OFFERS';
  setP2pSubTab: (v: 'ORDERS' | 'OFFERS') => void;
  p2pOrderFilter: 'ALL' | 'DISPUTED' | 'ESCROW_LOCKED' | 'PAID' | 'COMPLETED';
  setP2pOrderFilter: (v: 'ALL' | 'DISPUTED' | 'ESCROW_LOCKED' | 'PAID' | 'COMPLETED') => void;
  filteredP2pOrders: P2POrder[];
  openAdminOrderChat: (ord: P2POrder) => void;
  runAction: RunActionFn;
}

export const AdminP2PTab: React.FC<AdminP2PTabProps> = ({
  data,
  p2pSubTab,
  setP2pSubTab,
  p2pOrderFilter,
  setP2pOrderFilter,
  filteredP2pOrders,
  openAdminOrderChat,
  runAction,
}) => {
  const disputedCount = data.p2pOrders.filter((o) => o.status === 'DISPUTED').length;
  const activeEscrowUsd = data.p2pOrders
    .filter((o) => o.status === 'ESCROW_LOCKED' || o.status === 'PAID' || o.status === 'DISPUTED')
    .reduce((s, o) => s + Number(o.amount_vusd || 0), 0);
  const activeOffersCount = data.p2pOffers.filter((o) => o.status === 'ACTIVE').length;

  return (
    <div className="space-y-5">
      {/* Hairline P2P Metrics Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Total P2P Orders</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">{data.p2pOrders.length}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Disputed Escrow</div>
          <div className={`mt-1 text-xl font-bold font-mono-tabular ${disputedCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {disputedCount}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Active Escrow Volume</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">${formatUsd(activeEscrowUsd)}</div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500">Active Merchant Offers</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-blue-600">
            {activeOffersCount} / {data.p2pOffers.length}
          </div>
        </div>
      </div>

      {/* Unified P2P Table Card */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setP2pSubTab('ORDERS')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                p2pSubTab === 'ORDERS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Escrow Orders &amp; Disputes ({data.p2pOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setP2pSubTab('OFFERS')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                p2pSubTab === 'OFFERS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Marketplace Offers ({data.p2pOffers.length})
            </button>
          </div>

          {p2pSubTab === 'ORDERS' && (
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['ALL', 'DISPUTED', 'ESCROW_LOCKED', 'PAID', 'COMPLETED'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setP2pOrderFilter(f)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    p2pOrderFilter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f === 'ALL' ? 'All' : f.replace('_', ' ')}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {p2pSubTab === 'ORDERS' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Order ID</th>
                  <th className="py-3 px-4">Buyer</th>
                  <th className="py-3 px-4">Seller (Escrow)</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Status / Dispute Reason</th>
                  <th className="py-3 px-4 text-right">Arbitration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredP2pOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                      No P2P orders match this filter.
                    </td>
                  </tr>
                ) : (
                  filteredP2pOrders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-4 font-mono-tabular">
                        <div className="font-medium text-slate-900">{ord.id}</div>
                        <div className="text-slate-500">{ord.payment_method}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{ord.buyer_name}</div>
                        <div className="text-slate-500 font-mono-tabular">{ord.buyer_email}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{ord.seller_name}</div>
                        <div className="text-slate-500 font-mono-tabular">{ord.seller_email}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular">
                        <div className="font-semibold text-slate-900">${formatUsd(ord.amount_vusd)}</div>
                        <div className="text-slate-500">Fee ${formatUsd(ord.fee_usd ?? 0)}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            ord.status === 'DISPUTED'
                              ? 'text-red-600'
                              : ord.status === 'COMPLETED' || ord.status === 'RESOLVED_BUYER'
                              ? 'text-emerald-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {ord.status}
                        </span>
                        {ord.dispute_reason && <div className="text-slate-600 mt-0.5">{ord.dispute_reason}</div>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openAdminOrderChat(ord)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg font-medium whitespace-nowrap"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Chat</span>
                          </button>
                          {ord.status === 'DISPUTED' ? (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  runAction(async () => {
                                    await apiFetch(`/api/admin/p2p/orders/${ord.id}/resolve`, {
                                      method: 'POST',
                                      body: JSON.stringify({ winner: 'BUYER', note: 'Payment verified by Admin' }),
                                    });
                                    return `Resolved ${ord.id} in favor of Buyer (${ord.buyer_name}).`;
                                  })
                                }
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium whitespace-nowrap"
                              >
                                Award Buyer
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  runAction(async () => {
                                    await apiFetch(`/api/admin/p2p/orders/${ord.id}/resolve`, {
                                      method: 'POST',
                                      body: JSON.stringify({ winner: 'SELLER', note: 'Escrow refunded to Seller' }),
                                    });
                                    return `Resolved ${ord.id} in favor of Seller (${ord.seller_name}).`;
                                  })
                                }
                                className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg font-medium whitespace-nowrap"
                              >
                                Refund Seller
                              </button>
                            </>
                          ) : (
                            <span className="text-slate-400">{ord.admin_resolution_note || '—'}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Offer ID</th>
                  <th className="py-3 px-4">Merchant</th>
                  <th className="py-3 px-4">Side · Method</th>
                  <th className="py-3 px-4 text-right">Available / Total</th>
                  <th className="py-3 px-4 text-right">Limits · Rate</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Moderation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {data.p2pOffers.map((off) => (
                  <tr key={off.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono-tabular font-medium text-slate-900">{off.id}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{off.creator_name}</div>
                      <div className="text-slate-500 font-mono-tabular">{off.creator_email}</div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={off.side === 'BUY' ? 'text-emerald-600 font-semibold' : 'text-blue-600 font-semibold'}>
                        {off.side}
                      </span>{' '}
                      · {off.payment_method}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular">
                      ${formatUsd(off.available_amount)} / ${formatUsd(off.total_amount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                      ${formatUsd(off.min_limit, 0)}–${formatUsd(off.max_limit, 0)} @ ${off.rate_usd.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-medium">
                      <span className={off.status === 'ACTIVE' ? 'text-emerald-600' : 'text-slate-400'}>{off.status}</span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          runAction(async () => {
                            const next = off.status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
                            await apiFetch(`/api/admin/p2p/offers/${off.id}/status`, {
                              method: 'POST',
                              body: JSON.stringify({ status: next }),
                            });
                            return `P2P offer ${off.id} set to ${next}.`;
                          })
                        }
                        className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg font-medium whitespace-nowrap"
                      >
                        {off.status === 'ACTIVE' ? 'Close Offer' : 'Reopen Offer'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

interface AdminSpotTabProps {
  data: AdminOverviewData;
  spotStats: SpotStats;
  displayMarkets: MarketPair[];
  filteredMarkets: MarketPair[];
  filteredTrades: SpotTrade[];
  spotSubTab: 'MARKETS' | 'TRADES';
  setSpotSubTab: (v: 'MARKETS' | 'TRADES') => void;
  marketSearch: string;
  setMarketSearch: (v: string) => void;
  newCoinSymbol: string;
  setNewCoinSymbol: (v: string) => void;
  newCoinName: string;
  setNewCoinName: (v: string) => void;
  addingCoin: boolean;
  setAddingCoin: (b: boolean) => void;
  tradeViewFilter: 'ALL' | 'TAKER' | 'MAKER' | 'LIQUIDATED' | 'OPEN';
  setTradeViewFilter: (v: 'ALL' | 'TAKER' | 'MAKER' | 'LIQUIDATED' | 'OPEN') => void;
  tradeSearch: string;
  setTradeSearch: (v: string) => void;
  marketPriceMap: Map<string, number>;
  computeLiveTradePnl: (t: SpotTrade) => number;
  runAction: RunActionFn;
}

export const AdminSpotTab: React.FC<AdminSpotTabProps> = ({
  data,
  spotStats,
  displayMarkets,
  filteredMarkets,
  filteredTrades,
  spotSubTab,
  setSpotSubTab,
  marketSearch,
  setMarketSearch,
  newCoinSymbol,
  setNewCoinSymbol,
  newCoinName,
  setNewCoinName,
  addingCoin,
  setAddingCoin,
  tradeViewFilter,
  setTradeViewFilter,
  tradeSearch,
  setTradeSearch,
  marketPriceMap,
  computeLiveTradePnl,
  runAction,
}) => {
  return (
    <div className="space-y-5">
      {/* Hairline Spot Trading Summary Strip */}
      <div className="border border-slate-200 rounded-xl bg-white grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-4">
          <div className="text-xs text-slate-500">Trading Volume &amp; Exposure</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-slate-900">
            ${formatUsd(data.projectSummary?.spot.totalVolumeUsd ?? spotStats.totalVolumeUsd)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
            Open ${formatUsd(spotStats.openExposureUsd)} ({spotStats.openPositionCount} pos · {spotStats.openLimitCount} limit)
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Taker &amp; Maker Fee Revenue</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600">
            +${formatUsd(data.projectSummary?.spot.totalFeeUsd ?? spotStats.totalFeeUsd)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
            Taker ${formatUsd(data.projectSummary?.spot.takerFeeUsd ?? spotStats.takerFeeUsd)} · Maker $
            {formatUsd(data.projectSummary?.spot.makerFeeUsd ?? spotStats.makerFeeUsd)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Liquidation Revenue</div>
          <div className="mt-1 text-xl font-bold font-mono-tabular text-emerald-600">
            +${formatUsd(data.projectSummary?.spot.liquidationUsd ?? spotStats.liquidationUsd)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
            {data.projectSummary?.spot.liquidationCount ?? spotStats.liquidationCount} liquidated ·{' '}
            <span className={spotStats.liveUnrealizedPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}>
              Open {spotStats.liveUnrealizedPnl >= 0 ? '+' : '-'}${formatUsd(Math.abs(spotStats.liveUnrealizedPnl))}
            </span>
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500">Spot Module Platform Net P&amp;L</div>
          <div
            className={`mt-1 text-xl font-bold font-mono-tabular ${
              (data.projectSummary?.spot.platformNetPnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {(data.projectSummary?.spot.platformNetPnl ?? 0) >= 0 ? '+' : '-'}$
            {formatUsd(Math.abs(data.projectSummary?.spot.platformNetPnl ?? 0))}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono-tabular">
            Fees + Liquidations − Non-Liq Trader Profit
          </div>
        </div>
      </div>

      {/* Add Live Coin Form (when viewing Global Live Markets) */}
      {spotSubTab === 'MARKETS' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newCoinSymbol.trim() || addingCoin) return;
            setAddingCoin(true);
            await runAction(async () => {
              const res = await apiFetch<{ pair: MarketPair }>('/api/admin/markets', {
                method: 'POST',
                body: JSON.stringify({
                  symbol: newCoinSymbol.trim(),
                  name: newCoinName.trim() || undefined,
                }),
              });
              setNewCoinSymbol('');
              setNewCoinName('');
              return `Listed ${res.pair.symbol} with global live Binance feed.`;
            });
            setAddingCoin(false);
          }}
          className="border border-slate-200 rounded-xl bg-white p-4 flex flex-wrap items-end justify-between gap-3"
        >
          <div>
            <div className="text-xs font-semibold text-slate-900">List New Global Live Coin</div>
            <div className="text-xs text-slate-500">
              Connects directly to the global Binance live price stream (prices cannot be manually altered).
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              required
              value={newCoinSymbol}
              onChange={(e) => setNewCoinSymbol(e.target.value.toUpperCase())}
              placeholder="Symbol (e.g. WIF, TIA)"
              className="w-36 h-9 px-3 text-xs font-mono-tabular uppercase bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <input
              type="text"
              value={newCoinName}
              onChange={(e) => setNewCoinName(e.target.value)}
              placeholder="Coin name (optional)"
              className="w-44 h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={addingCoin}
              className="h-9 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {addingCoin ? 'Syncing Live Feed...' : 'Add Live Coin'}
            </button>
          </div>
        </form>
      )}

      {/* Unified Markets & Trades Table Card */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSpotSubTab('MARKETS')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                spotSubTab === 'MARKETS' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Global Live Markets ({displayMarkets.length})
            </button>
            <button
              type="button"
              onClick={() => setSpotSubTab('TRADES')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                spotSubTab === 'TRADES' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Taker / Maker &amp; Liquidations ({data.trades.length})
            </button>
          </div>

          {spotSubTab === 'MARKETS' ? (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={marketSearch}
                onChange={(e) => setMarketSearch(e.target.value)}
                placeholder="Search pair (e.g. BTC, SOL)..."
                className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'TAKER', label: 'Taker' },
                    { id: 'MAKER', label: 'Maker' },
                    { id: 'LIQUIDATED', label: 'Liquidated' },
                    { id: 'OPEN', label: 'Open' },
                  ] as const
                ).map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setTradeViewFilter(st.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      tradeViewFilter === st.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-60">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tradeSearch}
                  onChange={(e) => setTradeSearch(e.target.value)}
                  placeholder="Search user, pair, or trade ID..."
                  className="w-full h-9 pl-9 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          {spotSubTab === 'MARKETS' ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Pair</th>
                  <th className="py-3 px-4 text-right">Global Live Price</th>
                  <th className="py-3 px-4 text-right">24h Change</th>
                  <th className="py-3 px-4 text-right">Bid / Ask</th>
                  <th className="py-3 px-4 text-right">24h High / Low</th>
                  <th className="py-3 px-4 text-right">24h Turnover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredMarkets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-slate-500">
                      No market pairs match your search.
                    </td>
                  </tr>
                ) : (
                  filteredMarkets.map((m) => {
                    const dec = getPriceDecimals(m.current_price);
                    const chg = Number(m.change_24h_pct || 0);
                    return (
                      <tr key={m.symbol} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <CryptoIcon symbol={m.base_asset} size="sm" />
                            <div>
                              <div className="font-semibold text-slate-900">{m.symbol}</div>
                              <div className="text-slate-500">{m.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-bold text-slate-900">
                          ${formatUsd(m.current_price, dec)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold">
                          <span className={chg >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                            {chg >= 0 ? '+' : ''}
                            {chg.toFixed(2)}%
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                          ${formatUsd(m.bid, dec)} / ${formatUsd(m.ask, dec)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                          ${formatUsd(Number(m.high_24h ?? m.current_price), dec)} / $
                          {formatUsd(Number(m.low_24h ?? m.current_price), dec)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-900">
                          ${formatUsd(Number(m.turnover_24h ?? 0), 0)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 px-4">Trade / User</th>
                  <th className="py-3 px-4">Pair · Mode · Side</th>
                  <th className="py-3 px-4 text-right">Entry / Live or Exit</th>
                  <th className="py-3 px-4 text-right">Stake</th>
                  <th className="py-3 px-4 text-right">Role &amp; Fee</th>
                  <th className="py-3 px-4">Status / Liquidation / P&amp;L</th>
                  <th className="py-3 px-4 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredTrades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 px-4 text-center text-slate-500">
                      No trades match your filter or search query.
                    </td>
                  </tr>
                ) : (
                  filteredTrades.map((t) => {
                    const dec = getPriceDecimals(t.entry_price || 1);
                    const livePrice = marketPriceMap.get(t.symbol) ?? t.entry_price;
                    const livePnl = computeLiveTradePnl(t);
                    const priceChangePct = t.entry_price > 0 ? ((livePrice - t.entry_price) / t.entry_price) * 100 : 0;
                    const feeRole = t.fee_role || 'TAKER';

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4">
                          <div className="font-mono-tabular font-medium text-slate-900">{t.id}</div>
                          <div className="text-slate-500">
                            {t.user_name} ({t.user_email})
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-900">{t.symbol}</span> · {t.order_mode} ·{' '}
                          <span className={t.side === 'LONG' || t.side === 'BUY' ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                            {t.side}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">
                          <div className="text-slate-900 font-medium">Entry ${formatUsd(t.entry_price, dec)}</div>
                          {t.status === 'OPEN' ? (
                            <div className="text-slate-500">
                              {t.order_mode === 'LIMIT' && t.limit_price ? (
                                <>Target ${formatUsd(t.limit_price, dec)} · Live ${formatUsd(livePrice, dec)}</>
                              ) : (
                                <>
                                  Live ${formatUsd(livePrice, dec)}{' '}
                                  <span className={priceChangePct >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                    ({priceChangePct >= 0 ? '+' : ''}
                                    {priceChangePct.toFixed(2)}%)
                                  </span>
                                </>
                              )}
                            </div>
                          ) : t.exit_price ? (
                            <div className="text-slate-500">Exit ${formatUsd(t.exit_price, dec)}</div>
                          ) : (
                            <div className="text-slate-400">Instant Fill</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">
                          <div className="font-semibold text-slate-900">${formatUsd(t.amount_usd)}</div>
                          <div className="text-slate-500">
                            {t.quantity.toFixed(4)} {t.symbol.split('/')[0]}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular">
                          <div className={feeRole === 'MAKER' ? 'font-semibold text-blue-600' : 'font-semibold text-slate-900'}>
                            {feeRole}
                          </div>
                          <div className="text-slate-500">${formatUsd(t.fee_usd || 0)}</div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular">
                          {t.status === 'OPEN' ? (
                            t.order_mode === 'POSITION' ? (
                              <div>
                                <div className="text-blue-600 font-semibold">OPEN POSITION</div>
                                <div className={livePnl >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                                  Live {livePnl >= 0 ? '+' : '-'}${formatUsd(Math.abs(livePnl))}
                                </div>
                              </div>
                            ) : (
                              <div className="text-amber-600 font-semibold">OPEN · Limit Resting</div>
                            )
                          ) : t.is_liquidated === 1 ? (
                            <span className="text-red-600 font-semibold">
                              LIQUIDATED (-${formatUsd(Math.abs(t.pnl_usd))})
                            </span>
                          ) : t.status === 'CANCELLED' ? (
                            <span className="text-slate-400 font-medium">CANCELLED</span>
                          ) : (
                            <span className={t.pnl_usd >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                              SETTLED ({t.pnl_usd >= 0 ? '+' : '-'}${formatUsd(Math.abs(t.pnl_usd))})
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-400 font-mono-tabular">
                          {formatDateTime(t.settled_at || t.created_at)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
