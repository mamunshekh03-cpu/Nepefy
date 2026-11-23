import WebSocketClient, { type WebSocketServer, type WebSocket } from 'ws';
import { appendLedger, db, TOP_30_PAIRS } from './db.ts';

export interface MarketPairRow {
  symbol: string;
  base_asset: string;
  name: string;
  current_price: number;
  spread_bps: number;
  target_price: number | null;
  volatility_pct: number;
  auto_drift: number;
  change_24h_pct: number;
  high_24h: number;
  low_24h: number;
  turnover_24h: number;
  updated_at: string;
}

export interface MarketTickPoint {
  time: number;
  price: number;
  bid: number;
  ask: number;
}

export interface LiveCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

const PAIR_RANK_INDEX = new Map<string, number>(TOP_30_PAIRS.map(([sym], idx) => [sym, idx]));

const priceHistory = new Map<string, MarketTickPoint[]>();
const klineCache = new Map<string, { ts: number; data: LiveCandle[] }>();
const bookCache = new Map<string, { ts: number; data: any }>();
const lastDbPersistBySymbol = new Map<string, number>();

function setBoundedCache<T>(cache: Map<string, { ts: number; data: T }>, key: string, value: { ts: number; data: T }, maxEntries = 200): void {
  if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

let wssInstance: WebSocketServer | null = null;
let binanceWs: WebSocketClient | null = null;
let binanceWsConnected = false;
let targetTimer: ReturnType<typeof setInterval> | null = null;
let restSyncTimer: ReturnType<typeof setInterval> | null = null;
let lastBroadcastTs = 0;
let isTickRunning = false;

export const SPOT_TAKER_FEE_RATE = 0.0003; // 0.03% Taker fee
export const SPOT_MAKER_FEE_RATE = 0.0002; // 0.02% Maker fee

let liveMakerFeeRate = SPOT_MAKER_FEE_RATE;
let liveTakerFeeRate = SPOT_TAKER_FEE_RATE;

export function setSpotFeeRates(makerPct?: number, takerPct?: number): void {
  if (typeof makerPct === 'number' && Number.isFinite(makerPct) && makerPct >= 0 && makerPct <= 5) {
    liveMakerFeeRate = makerPct / 100;
  }
  if (typeof takerPct === 'number' && Number.isFinite(takerPct) && takerPct >= 0 && takerPct <= 5) {
    liveTakerFeeRate = takerPct / 100;
  }
}

export function getSpotFeeRates(): { makerRate: number; takerRate: number } {
  return { makerRate: liveMakerFeeRate, takerRate: liveTakerFeeRate };
}

export function getPriceDecimals(price: number): number {
  const p = Number(price || 0);
  if (p <= 0) return 2;
  if (p < 0.0001) return 8;
  if (p < 0.01) return 6;
  if (p < 0.1) return 5;
  if (p < 2) return 4;
  if (p < 50) return 3;
  return 2;
}

export function toBinanceSymbol(symbol: string): string | null {
  const base = symbol.split('/')[0]?.toUpperCase();
  return base ? `${base}USDT` : null;
}

export function computeBidAsk(price: number, spreadBps: number): { bid: number; ask: number } {
  const halfSpread = spreadBps / 20000;
  const decimals = getPriceDecimals(price);
  return {
    bid: Number((price * (1 - halfSpread)).toFixed(decimals)),
    ask: Number((price * (1 + halfSpread)).toFixed(decimals)),
  };
}

function throttledBroadcast(): void {
  const now = Date.now();
  if (now - lastBroadcastTs >= 700) {
    lastBroadcastTs = now;
    broadcastMarkets().catch(() => {});
  }
}

async function syncBinance24hrSnapshot(): Promise<void> {
  try {
    const pairs = (await db.prepare('SELECT * FROM market_pairs').all()) as MarketPairRow[];
    const binanceToPair = new Map<string, MarketPairRow>();
    const binanceSymbols: string[] = [];

    for (const p of pairs) {
      const bSym = toBinanceSymbol(p.symbol);
      if (bSym) {
        binanceToPair.set(bSym, p);
        binanceSymbols.push(bSym);
      }
    }
    if (binanceSymbols.length === 0) return;

    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(
      JSON.stringify(binanceSymbols)
    )}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return;

    const tickers = (await resp.json()) as any[];
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const updateStmt = db.prepare(
      'UPDATE market_pairs SET current_price = ?, change_24h_pct = ?, high_24h = ?, low_24h = ?, turnover_24h = ?, updated_at = ? WHERE symbol = ?'
    );

    const processedRows: { symbol: string; baseAsset: string; price: number; spreadBps: number }[] = [];
    await db.transaction(async () => {
      for (const t of tickers) {
        const pair = binanceToPair.get(String(t.symbol).toUpperCase());
        if (!pair) continue;

        if (pair.target_price !== null && pair.target_price > 0) continue;

        const lastPrice = Number(t.lastPrice);
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) continue;

        const decimals = getPriceDecimals(lastPrice);
        const roundedPrice = Number(lastPrice.toFixed(decimals));
        const changePct = Number(Number(t.priceChangePercent || 0).toFixed(2));
        const high24 = Number(Number(t.highPrice || roundedPrice).toFixed(decimals));
        const low24 = Number(Number(t.lowPrice || roundedPrice).toFixed(decimals));
        const turnover24 = Number(Number(t.quoteVolume || 0).toFixed(2));

        await updateStmt.run(roundedPrice, changePct, high24, low24, turnover24, nowIso, pair.symbol);
        lastDbPersistBySymbol.set(pair.symbol, nowMs);

        const { bid, ask } = computeBidAsk(roundedPrice, pair.spread_bps);
        const arr = priceHistory.get(pair.symbol) || [];
        arr.push({ time: nowMs, price: roundedPrice, bid, ask });
        if (arr.length > 90) arr.shift();
        priceHistory.set(pair.symbol, arr);

        processedRows.push({
          symbol: pair.symbol,
          baseAsset: pair.base_asset,
          price: roundedPrice,
          spreadBps: pair.spread_bps,
        });
      }
    })();

    for (const row of processedRows) {
      await processPendingLimitOrders(row.symbol, row.baseAsset, row.price, row.spreadBps);
      await processPositionLiquidations(row.symbol, row.price);
    }

    await broadcastMarkets();
  } catch {
    // Retain latest cached quotes if upstream temporarily unreachable
  }
}

async function seedRealInitialKlines(): Promise<void> {
  const topPairs = ((await db.prepare('SELECT * FROM market_pairs').all()) as MarketPairRow[]).slice(0, 8);
  await Promise.all(
    topPairs.map(async (pair) => {
      const bSym = toBinanceSymbol(pair.symbol);
      if (!bSym) return;
      try {
        const resp = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${bSym}&interval=1m&limit=45`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!resp.ok) return;
        const rows = (await resp.json()) as any[];
        const pts: MarketTickPoint[] = rows.map((r) => {
          const close = Number(r[4]);
          const decimals = getPriceDecimals(close);
          const rounded = Number(close.toFixed(decimals));
          const { bid, ask } = computeBidAsk(rounded, pair.spread_bps);
          return { time: Number(r[0]), price: rounded, bid, ask };
        });
        if (pts.length > 0) {
          priceHistory.set(pair.symbol, pts);
        }
      } catch {
        // Fallback already seeded below
      }
    })
  );
}

async function connectBinanceStream(): Promise<void> {
  if (binanceWs) {
    try {
      binanceWs.removeAllListeners();
      binanceWs.close();
    } catch {
      // ignore
    }
    binanceWs = null;
    binanceWsConnected = false;
  }

  const pairs = (await db.prepare('SELECT symbol FROM market_pairs').all()) as { symbol: string }[];
  const streams = pairs
    .map((p) => toBinanceSymbol(p.symbol))
    .filter((s): s is string => Boolean(s))
    .map((s) => `${s.toLowerCase()}@miniTicker`)
    .join('/');

  if (!streams) return;
  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  try {
    binanceWs = new WebSocketClient(wsUrl, { handshakeTimeout: 5000 });

    binanceWs.on('open', () => {
      binanceWsConnected = true;
    });

    binanceWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const d = msg?.data;
        if (!d || !d.s || !d.c) return;

        const bSym = String(d.s).toUpperCase();
        const base = bSym.endsWith('USDT') ? bSym.slice(0, -4) : bSym;
        const symbol = `${base}/USDT`;

        const nowMs = Date.now();
        const lastSavedAt = lastDbPersistBySymbol.get(symbol) || 0;
        if (nowMs - lastSavedAt < 1200) return;

        const closePrice = Number(d.c);
        if (!Number.isFinite(closePrice) || closePrice <= 0) return;

        lastDbPersistBySymbol.set(symbol, nowMs);

        const pair = (await db.prepare('SELECT * FROM market_pairs WHERE symbol = ?').get(symbol)) as
          | MarketPairRow
          | undefined;
        if (!pair) return;

        if (pair.target_price !== null && pair.target_price > 0) return;

        const openPrice = Number(d.o || closePrice);
        const highPrice = Number(d.h || closePrice);
        const lowPrice = Number(d.l || closePrice);
        const quoteVol = Number(d.q || 0);

        const decimals = getPriceDecimals(closePrice);
        const roundedPrice = Number(closePrice.toFixed(decimals));
        const changePct =
          openPrice > 0 ? Number((((closePrice - openPrice) / openPrice) * 100).toFixed(2)) : pair.change_24h_pct;
        const roundedHigh = Number(highPrice.toFixed(decimals));
        const roundedLow = Number(lowPrice.toFixed(decimals));
        const roundedTurnover = Number(quoteVol.toFixed(2));
        const priceChanged = roundedPrice !== pair.current_price;
        if (!priceChanged && nowMs - lastSavedAt < 3000) return;

        const nowIso = new Date(nowMs).toISOString();
        await db
          .prepare(
            'UPDATE market_pairs SET current_price = ?, change_24h_pct = ?, high_24h = ?, low_24h = ?, turnover_24h = ?, updated_at = ? WHERE symbol = ?'
          )
          .run(roundedPrice, changePct, roundedHigh, roundedLow, roundedTurnover, nowIso, symbol);

        const { bid, ask } = computeBidAsk(roundedPrice, pair.spread_bps);
        const arr = priceHistory.get(symbol) || [];
        const last = arr[arr.length - 1];
        if (!last || nowMs - last.time >= 1000) {
          arr.push({ time: nowMs, price: roundedPrice, bid, ask });
          if (arr.length > 90) arr.shift();
          priceHistory.set(symbol, arr);
        } else {
          last.price = roundedPrice;
          last.bid = bid;
          last.ask = ask;
        }

        await processPendingLimitOrders(symbol, pair.base_asset, roundedPrice, pair.spread_bps);
        await processPositionLiquidations(symbol, roundedPrice);
        throttledBroadcast();
      } catch {
        // Ignore malformed upstream ticker frame
      }
    });

    binanceWs.on('close', () => {
      binanceWsConnected = false;
      setTimeout(() => {
        connectBinanceStream().catch(() => {});
      }, 3000);
    });

    binanceWs.on('error', () => {
      binanceWsConnected = false;
      try {
        binanceWs?.close();
      } catch {
        // ignore
      }
    });
  } catch {
    binanceWsConnected = false;
    setTimeout(() => {
      connectBinanceStream().catch(() => {});
    }, 5000);
  }
}

export async function initMarketEngine(wss: WebSocketServer): Promise<void> {
  wssInstance = wss;

  await db
    .prepare('UPDATE market_pairs SET target_price = NULL, auto_drift = 1 WHERE target_price IS NOT NULL OR auto_drift = 0')
    .run();

  const pairs = (await db.prepare('SELECT * FROM market_pairs').all()) as MarketPairRow[];
  const now = Date.now();
  for (const pair of pairs) {
    if (!priceHistory.has(pair.symbol)) {
      const { bid, ask } = computeBidAsk(pair.current_price, pair.spread_bps);
      priceHistory.set(pair.symbol, [{ time: now, price: pair.current_price, bid, ask }]);
    }
  }

  syncBinance24hrSnapshot().catch(() => {});
  seedRealInitialKlines().catch(() => {});
  connectBinanceStream().catch(() => {});

  if (targetTimer) clearInterval(targetTimer);
  targetTimer = setInterval(() => {
    runAdminTargetAndFallbackTick().catch(() => {});
  }, 1500);

  if (restSyncTimer) clearInterval(restSyncTimer);
  restSyncTimer = setInterval(() => {
    if (!binanceWsConnected) {
      syncBinance24hrSnapshot().catch(() => {});
    }
  }, 6000);
}

export async function getMarketSnapshot() {
  const pairs = (await db.prepare('SELECT * FROM market_pairs').all()) as MarketPairRow[];
  pairs.sort((a, b) => {
    const ra = PAIR_RANK_INDEX.get(a.symbol) ?? 999;
    const rb = PAIR_RANK_INDEX.get(b.symbol) ?? 999;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });

  return pairs.map((pair) => {
    const { bid, ask } = computeBidAsk(pair.current_price, pair.spread_bps);
    return {
      ...pair,
      bid,
      ask,
      history: priceHistory.get(pair.symbol) || [],
    };
  });
}

export async function fetchLiveKlines(
  symbol: string,
  interval: string = '30m',
  limit: number = 40
): Promise<LiveCandle[]> {
  const bSym = toBinanceSymbol(symbol);
  const allowedIntervals = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
  const safeInterval = allowedIntervals.has(interval) ? interval : '30m';
  const safeLimit = Math.min(100, Math.max(10, Number(limit) || 40));
  const cacheKey = `${symbol}:${safeInterval}:${safeLimit}`;

  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 3000) {
    return cached.data;
  }

  if (bSym) {
    try {
      const resp = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${bSym}&interval=${safeInterval}&limit=${safeLimit}`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (resp.ok) {
        const rows = (await resp.json()) as any[];
        const data: LiveCandle[] = rows.map((r) => ({
          time: Number(r[0]),
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          vol: Number(r[5]),
        }));
        if (data.length > 0) {
          setBoundedCache(klineCache, cacheKey, { ts: Date.now(), data });
          return data;
        }
      }
    } catch {
      // Fallback below
    }
  }

  const pts = priceHistory.get(symbol) || [];
  return pts.slice(-safeLimit).map((pt) => ({
    time: pt.time,
    open: pt.price,
    high: pt.ask,
    low: pt.bid,
    close: pt.price,
    vol: 1,
  }));
}

export async function fetchLiveOrderBookAndTrades(symbol: string): Promise<{
  asks: { price: number; qty: number; total: number }[];
  bids: { price: number; qty: number; total: number }[];
  recentTrades: { id: string; price: number; qty: number; isBuy: boolean; time: number }[];
}> {
  const cacheKey = symbol;
  const cached = bookCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 1500) {
    return cached.data;
  }

  const bSym = toBinanceSymbol(symbol);
  if (bSym) {
    try {
      const [depthRes, tradesRes] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/depth?symbol=${bSym}&limit=20`, {
          signal: AbortSignal.timeout(4000),
        }),
        fetch(`https://api.binance.com/api/v3/trades?symbol=${bSym}&limit=20`, {
          signal: AbortSignal.timeout(4000),
        }),
      ]);

      if (depthRes.ok && tradesRes.ok) {
        const depth = (await depthRes.json()) as { asks: [string, string][]; bids: [string, string][] };
        const rawTrades = (await tradesRes.json()) as any[];

        let askCum = 0;
        const asks = (depth.asks || []).slice(0, 15).map(([pStr, qStr]) => {
          const price = Number(pStr);
          const qty = Number(qStr);
          askCum += qty;
          return { price, qty, total: askCum };
        });

        let bidCum = 0;
        const bids = (depth.bids || []).slice(0, 15).map(([pStr, qStr]) => {
          const price = Number(pStr);
          const qty = Number(qStr);
          bidCum += qty;
          return { price, qty, total: bidCum };
        });

        const recentTrades = rawTrades
          .slice()
          .reverse()
          .map((t) => ({
            id: String(t.id),
            price: Number(t.price),
            qty: Number(t.qty),
            isBuy: !t.isBuyerMaker,
            time: Number(t.time),
          }));

        const data = { asks, bids, recentTrades };
        setBoundedCache(bookCache, cacheKey, { ts: Date.now(), data });
        return data;
      }
    } catch {
      // Fallback below
    }
  }

  return { asks: [], bids: [], recentTrades: [] };
}

export async function processPendingLimitOrders(
  symbol: string,
  baseAsset: string,
  currentPrice: number,
  spreadBps: number
): Promise<void> {
  const openLimits = (await db
    .prepare("SELECT * FROM spot_trades WHERE symbol = ? AND order_mode = 'LIMIT' AND status = 'OPEN'")
    .all(symbol)) as any[];
  if (openLimits.length === 0) return;

  const { bid, ask } = computeBidAsk(currentPrice, spreadBps);
  const now = new Date().toISOString();
  const filledEvents: MarketTradeEvent[] = [];

  await db.transaction(async () => {
    for (const ord of openLimits) {
      const fresh = await db.prepare("SELECT status FROM spot_trades WHERE id = ? AND status = 'OPEN'").get(ord.id);
      if (!fresh) continue;

      const limitPrice = Number(ord.limit_price || ord.entry_price);
      if (ord.side === 'BUY' && ask <= limitPrice) {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(ord.user_id)) as any;
        const nextLocked = Math.max(0, Number((user.locked_balance - ord.amount_usd).toFixed(2)));
        await db.prepare('UPDATE users SET locked_balance = ? WHERE id = ?').run(nextLocked, user.id);

        const { makerRate } = getSpotFeeRates();
        const feeUsd = Number((ord.amount_usd * makerRate).toFixed(2));
        const netUsd = Math.max(0, Number((ord.amount_usd - feeUsd).toFixed(2)));
        const filledQty = Number((netUsd / limitPrice).toFixed(8));

        const existingHolding = (await db
          .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
          .get(user.id, baseAsset)) as any;
        const prevQty = existingHolding && Number(existingHolding.quantity) > 0 ? Number(existingHolding.quantity) : 0;
        const prevCost = prevQty > 0 ? prevQty * Number(existingHolding.avg_entry_price || 0) : 0;
        const newQty = Number((prevQty + filledQty).toFixed(8));
        const newAvg = newQty > 0 ? Number(((prevCost + Number(ord.amount_usd)) / newQty).toFixed(8)) : limitPrice;

        if (existingHolding) {
          await db
            .prepare('UPDATE user_coin_holdings SET quantity = ?, avg_entry_price = ? WHERE user_id = ? AND asset = ?')
            .run(newQty, newAvg, user.id, baseAsset);
        } else {
          await db
            .prepare('INSERT INTO user_coin_holdings (user_id, asset, quantity, avg_entry_price) VALUES (?, ?, ?, ?)')
            .run(user.id, baseAsset, filledQty, newAvg);
        }

        await db
          .prepare(
            "UPDATE spot_trades SET quantity = ?, exit_price = ?, fee_usd = ?, fee_role = 'MAKER', status = 'SETTLED', settled_at = ? WHERE id = ?"
          )
          .run(filledQty, limitPrice, feeUsd, now, ord.id);

        await appendLedger(
          user.id,
          'MAIN',
          'SPOT_BUY',
          0,
          Number(user.main_balance || 0),
          ord.id,
          `Limit Buy Filled ${filledQty} ${baseAsset} @ $${limitPrice} (Maker fee: $${feeUsd.toFixed(2)})`
        );
        filledEvents.push({
          userId: user.id,
          tradeId: ord.id,
          symbol,
          side: 'BUY',
          triggerType: 'LIMIT_FILL',
          exitPrice: limitPrice,
          pnl: 0,
          qty: filledQty,
          baseAsset,
        });
      } else if (ord.side === 'SELL' && bid >= limitPrice) {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(ord.user_id)) as any;
        const { makerRate } = getSpotFeeRates();
        const grossProceeds = Number((ord.quantity * limitPrice).toFixed(2));
        const feeUsd = Number((grossProceeds * makerRate).toFixed(2));
        const netProceeds = Math.max(0, Number((grossProceeds - feeUsd).toFixed(2)));
        const costBasis = Number(ord.entry_price || 0) > 0 ? ord.quantity * Number(ord.entry_price) : netProceeds;
        const realizedPnl = Number((netProceeds - costBasis).toFixed(2));
        const nextMain = Number((user.main_balance + netProceeds).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, user.id);

        await db
          .prepare(
            "UPDATE spot_trades SET exit_price = ?, fee_usd = ?, pnl_usd = ?, fee_role = 'MAKER', status = 'SETTLED', settled_at = ? WHERE id = ?"
          )
          .run(limitPrice, feeUsd, realizedPnl, now, ord.id);

        await appendLedger(
          user.id,
          'MAIN',
          'SPOT_SELL',
          netProceeds,
          nextMain,
          ord.id,
          `Limit Sell Filled ${ord.quantity} ${baseAsset} @ $${limitPrice} (Maker fee: $${feeUsd.toFixed(2)})`
        );
        filledEvents.push({
          userId: user.id,
          tradeId: ord.id,
          symbol,
          side: 'SELL',
          triggerType: 'LIMIT_FILL',
          exitPrice: limitPrice,
          pnl: realizedPnl,
          qty: Number(ord.quantity),
          baseAsset,
        });
      }
    }
  })();

  if (tradeEventCallback) {
    for (const ev of filledEvents) {
      tradeEventCallback(ev);
    }
  }
}

export interface MarketTradeEvent {
  userId: string;
  tradeId: string;
  symbol: string;
  side: string;
  triggerType: 'TP' | 'SL' | 'LIQUIDATION' | 'LIMIT_FILL';
  exitPrice: number;
  pnl: number;
  qty?: number;
  baseAsset?: string;
}

let tradeEventCallback: ((event: MarketTradeEvent) => void) | null = null;

export function setMarketTradeEventCallback(cb: (event: MarketTradeEvent) => void): void {
  tradeEventCallback = cb;
}

export async function processPositionLiquidations(symbol: string, currentPrice: number): Promise<void> {
  if (!currentPrice || currentPrice <= 0) return;
  const openPositions = (await db
    .prepare("SELECT * FROM spot_trades WHERE symbol = ? AND order_mode = 'POSITION' AND status = 'OPEN'")
    .all(symbol)) as any[];
  if (openPositions.length === 0) return;

  const now = new Date().toISOString();
  const emittedEvents: MarketTradeEvent[] = [];

  await db.transaction(async () => {
    for (const trade of openPositions) {
      const fresh = await db.prepare("SELECT status FROM spot_trades WHERE id = ? AND status = 'OPEN'").get(trade.id);
      if (!fresh || !trade.entry_price || trade.entry_price <= 0) continue;

      const tpPrice = trade.tp_price !== null && trade.tp_price !== undefined ? Number(trade.tp_price) : null;
      const slPrice = trade.sl_price !== null && trade.sl_price !== undefined ? Number(trade.sl_price) : null;

      let tpHit = false;
      let slHit = false;
      if (trade.side === 'LONG') {
        if (tpPrice && tpPrice > 0 && currentPrice >= tpPrice) tpHit = true;
        else if (slPrice && slPrice > 0 && currentPrice <= slPrice) slHit = true;
      } else {
        if (tpPrice && tpPrice > 0 && currentPrice <= tpPrice) tpHit = true;
        else if (slPrice && slPrice > 0 && currentPrice >= slPrice) slHit = true;
      }

      if (tpHit || slHit) {
        const triggerType: 'TP' | 'SL' = tpHit ? 'TP' : 'SL';
        const { takerRate } = getSpotFeeRates();
        const pnl = calculatePositionPnl(trade, currentPrice);
        const closeFeeUsd = Number((trade.amount_usd * takerRate).toFixed(2));
        const totalFeeUsd = Number((Number(trade.fee_usd || 0) + closeFeeUsd).toFixed(2));
        const payout = Math.max(0, Number((trade.amount_usd + pnl - closeFeeUsd).toFixed(2)));
        const realizedPnl = Number((payout - trade.amount_usd).toFixed(2));
        const user = (await db.prepare('SELECT main_balance FROM users WHERE id = ?').get(trade.user_id)) as
          | { main_balance: number }
          | undefined;
        const nextMain = Number(((user?.main_balance || 0) + payout).toFixed(2));

        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, trade.user_id);
        await db
          .prepare(
            "UPDATE spot_trades SET exit_price = ?, fee_usd = ?, pnl_usd = ?, status = 'SETTLED', settled_at = ? WHERE id = ?"
          )
          .run(currentPrice, totalFeeUsd, realizedPnl, now, trade.id);

        await appendLedger(
          trade.user_id,
          'MAIN',
          'SPOT_PNL',
          payout,
          nextMain,
          trade.id,
          `${triggerType === 'TP' ? 'Take-Profit' : 'Stop-Loss'} triggered ${trade.side} ${trade.symbol} @ $${currentPrice} (P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)})`
        );

        emittedEvents.push({
          userId: trade.user_id,
          tradeId: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          triggerType,
          exitPrice: currentPrice,
          pnl: realizedPnl,
        });
        continue;
      }

      if (trade.admin_override === 'FORCE_WIN') continue;

      const movePct = (currentPrice - trade.entry_price) / trade.entry_price;
      const directional = trade.side === 'LONG' ? movePct : -movePct;
      const rawPnl = trade.amount_usd * directional * 5;

      if (rawPnl <= -(trade.amount_usd * 0.9)) {
        const user = (await db.prepare('SELECT main_balance FROM users WHERE id = ?').get(trade.user_id)) as
          | { main_balance: number }
          | undefined;
        const lossAmt = Number((-trade.amount_usd).toFixed(2));

        await db
          .prepare(
            "UPDATE spot_trades SET exit_price = ?, pnl_usd = ?, is_liquidated = 1, status = 'SETTLED', settled_at = ? WHERE id = ?"
          )
          .run(currentPrice, lossAmt, now, trade.id);

        await appendLedger(
          trade.user_id,
          'MAIN',
          'SPOT_LIQUIDATION',
          0,
          Number((user?.main_balance || 0).toFixed(2)),
          trade.id,
          `Auto-liquidated ${trade.side} ${trade.symbol} @ $${currentPrice} (Collateral forfeited: $${Number(trade.amount_usd).toFixed(2)})`
        );

        emittedEvents.push({
          userId: trade.user_id,
          tradeId: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          triggerType: 'LIQUIDATION',
          exitPrice: currentPrice,
          pnl: lossAmt,
        });
      }
    }
  })();

  if (tradeEventCallback && emittedEvents.length > 0) {
    for (const ev of emittedEvents) {
      try {
        tradeEventCallback(ev);
      } catch {
        // ignore callback errors
      }
    }
  }
}

export async function runAdminTargetAndFallbackTick(): Promise<void> {
  if (isTickRunning) return;
  isTickRunning = true;
  try {
    const pairs = (await db.prepare('SELECT * FROM market_pairs').all()) as MarketPairRow[];
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const updateStmt = db.prepare(
      'UPDATE market_pairs SET current_price = ?, target_price = ?, change_24h_pct = ?, updated_at = ? WHERE symbol = ?'
    );

    let changed = false;
    for (const pair of pairs) {
      const hasTarget = pair.target_price !== null && pair.target_price > 0;
      const offlineFallback = !binanceWsConnected && pair.auto_drift === 1;
      if (!hasTarget && !offlineFallback) continue;

      let nextPrice = pair.current_price;
      let nextTarget = pair.target_price;

      if (hasTarget && nextTarget !== null) {
        const diff = nextTarget - pair.current_price;
        if (Math.abs(diff / pair.current_price) < 0.0015) {
          nextPrice = nextTarget;
          nextTarget = null;
        } else {
          nextPrice = pair.current_price + diff * 0.28;
        }
      } else if (offlineFallback) {
        const shock = (Math.random() - 0.5) * 2 * (pair.volatility_pct / 100) * 0.25;
        nextPrice = Math.max(0.0000001, pair.current_price * (1 + shock));
      }

      const decimals = getPriceDecimals(pair.current_price);
      nextPrice = Number(nextPrice.toFixed(decimals));
      const deltaPct = ((nextPrice - pair.current_price) / pair.current_price) * 100;
      const nextChange = Number((pair.change_24h_pct + deltaPct).toFixed(2));

      await updateStmt.run(nextPrice, nextTarget, nextChange, nowIso, pair.symbol);

      const { bid, ask } = computeBidAsk(nextPrice, pair.spread_bps);
      const arr = priceHistory.get(pair.symbol) || [];
      arr.push({ time: nowMs, price: nextPrice, bid, ask });
      if (arr.length > 90) arr.shift();
      priceHistory.set(pair.symbol, arr);

      await processPendingLimitOrders(pair.symbol, pair.base_asset, nextPrice, pair.spread_bps);
      await processPositionLiquidations(pair.symbol, nextPrice);
      changed = true;
    }

    if (changed) {
      await broadcastMarkets();
    }
  } finally {
    isTickRunning = false;
  }
}

export async function recordManualPriceUpdate(symbol: string, newPrice: number, spreadBps: number): Promise<void> {
  const nowMs = Date.now();
  const { bid, ask } = computeBidAsk(newPrice, spreadBps);
  const arr = priceHistory.get(symbol) || [];
  arr.push({ time: nowMs, price: newPrice, bid, ask });
  if (arr.length > 90) arr.shift();
  priceHistory.set(symbol, arr);

  const pair = (await db.prepare('SELECT base_asset FROM market_pairs WHERE symbol = ?').get(symbol)) as
    | { base_asset: string }
    | undefined;
  if (pair) {
    await processPendingLimitOrders(symbol, pair.base_asset, newPrice, spreadBps);
    await processPositionLiquidations(symbol, newPrice);
  }

  await broadcastMarkets();
}

export async function addGlobalLiveMarketPair(
  rawBase: string,
  rawName?: string,
  spreadBps: number = 15
): Promise<MarketPairRow> {
  const base = String(rawBase || '')
    .trim()
    .toUpperCase()
    .replace(/\/USDT$/i, '')
    .replace(/[^A-Z0-9]/g, '');

  if (!base || base.length < 2 || base.length > 12) {
    throw new Error('Enter a valid coin symbol (e.g. WIF, BONK, FET, TIA).');
  }

  const symbol = `${base}/USDT`;
  const existing = await db.prepare('SELECT symbol FROM market_pairs WHERE symbol = ?').get(symbol);
  if (existing) {
    throw new Error(`${symbol} is already listed on the exchange.`);
  }

  const bSym = `${base}USDT`;
  const resp = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(bSym)}`, {
    signal: AbortSignal.timeout(6000),
  });

  if (!resp.ok) {
    throw new Error(`${symbol} was not found on the global Binance live feed.`);
  }

  const ticker = (await resp.json()) as any;
  const lastPrice = Number(ticker?.lastPrice);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    throw new Error(`Invalid live price returned for ${symbol}.`);
  }

  const decimals = getPriceDecimals(lastPrice);
  const roundedPrice = Number(lastPrice.toFixed(decimals));
  const changePct = Number(Number(ticker.priceChangePercent || 0).toFixed(2));
  const high24 = Number(Number(ticker.highPrice || roundedPrice).toFixed(decimals));
  const low24 = Number(Number(ticker.lowPrice || roundedPrice).toFixed(decimals));
  const turnover24 = Number(Number(ticker.quoteVolume || 0).toFixed(2));
  const safeSpread = Math.min(100, Math.max(5, Number(spreadBps) || 15));
  const coinName = rawName && rawName.trim() ? rawName.trim() : base;
  const nowIso = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO market_pairs (symbol, base_asset, name, current_price, spread_bps, target_price, volatility_pct, auto_drift, change_24h_pct, high_24h, low_24h, turnover_24h, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, 0.45, 1, ?, ?, ?, ?, ?)
    `)
    .run(symbol, base, coinName, roundedPrice, safeSpread, changePct, high24, low24, turnover24, nowIso);

  try {
    const kResp = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(bSym)}&interval=1m&limit=45`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (kResp.ok) {
      const rows = (await kResp.json()) as any[];
      const pts: MarketTickPoint[] = rows.map((r) => {
        const close = Number(Number(r[4]).toFixed(decimals));
        const { bid, ask } = computeBidAsk(close, safeSpread);
        return { time: Number(r[0]), price: close, bid, ask };
      });
      if (pts.length > 0) {
        priceHistory.set(symbol, pts);
      }
    }
  } catch {
    const { bid, ask } = computeBidAsk(roundedPrice, safeSpread);
    priceHistory.set(symbol, [{ time: Date.now(), price: roundedPrice, bid, ask }]);
  }

  if (!priceHistory.has(symbol)) {
    const { bid, ask } = computeBidAsk(roundedPrice, safeSpread);
    priceHistory.set(symbol, [{ time: Date.now(), price: roundedPrice, bid, ask }]);
  }

  await connectBinanceStream();
  await broadcastMarkets();

  return (await db.prepare('SELECT * FROM market_pairs WHERE symbol = ?').get(symbol)) as MarketPairRow;
}

export async function broadcastMarkets(): Promise<void> {
  if (!wssInstance) return;
  const pairs = await getMarketSnapshot();
  const payload = JSON.stringify({
    type: 'MARKET_SNAPSHOT',
    pairs,
    timestamp: Date.now(),
  });
  wssInstance.clients.forEach((client: WebSocket) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

export function calculatePositionPnl(
  trade: {
    side: string;
    amount_usd: number;
    entry_price: number;
    admin_override: string;
  },
  marketPrice: number
): number {
  if (trade.admin_override === 'FORCE_WIN') {
    return Number((trade.amount_usd * 0.35).toFixed(2));
  }
  if (trade.admin_override === 'FORCE_LOSS') {
    return Number((-trade.amount_usd * 0.45).toFixed(2));
  }
  const priceMovePct = (marketPrice - trade.entry_price) / trade.entry_price;
  const directional = trade.side === 'LONG' ? priceMovePct : -priceMovePct;
  const rawPnl = trade.amount_usd * directional * 5;
  return Number(Math.max(-trade.amount_usd, rawPnl).toFixed(2));
}
