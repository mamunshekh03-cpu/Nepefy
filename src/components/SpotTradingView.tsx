import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Search,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd, getPriceDecimals, getQtyDecimals } from '../lib/api';
import type { CoinHolding, MarketPair, SpotTrade, UserProfile } from '../types';
import { CryptoIcon } from './CryptoIcon';
import { SelectDropdown, useClickOutside } from './SelectDropdown';

interface SpotTradingViewProps {
  user: UserProfile;
  markets: MarketPair[];
  onRefresh: () => Promise<void>;
  spotMakerFeePct?: number;
  spotTakerFeePct?: number;
  initialSymbol?: string;
}

type TradeMode = 'SPOT' | 'POSITION';
type OrderSide = 'BUY' | 'SELL';
type OrderType = 'LIMIT' | 'MARKET' | 'TPSL';
type ChartViewTab = 'CHART' | 'OVERVIEW' | 'DEPTH';
type CenterBookTab = 'ORDER_BOOK' | 'RECENT_TRADES';
type BookFilter = 'BOTH' | 'BIDS' | 'ASKS';
type BottomDockTab = 'OPEN_ORDERS' | 'ORDER_HISTORY' | 'FUNDS';
type MobileSpotPanel = 'CHART' | 'TRADE' | 'ORDERS';

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
  time: number;
}

const UtcLiveClock = React.memo(() => {
  const [utcNow, setUtcNow] = useState(() => new Date().toISOString().slice(11, 19));
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        setUtcNow(new Date().toISOString().slice(11, 19));
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);
  return <>{utcNow} UTC · Live Feed</>;
});

interface SpotSnapshotResponse {
  trades?: SpotTrade[];
  holdings?: CoinHolding[];
  main_balance?: number;
}

export const SpotTradingView: React.FC<SpotTradingViewProps> = ({
  user,
  markets,
  onRefresh,
  spotMakerFeePct = 0.02,
  spotTakerFeePct = 0.03,
  initialSymbol,
}) => {
  const makerPct = Number.isFinite(Number(spotMakerFeePct)) ? Number(spotMakerFeePct) : 0.02;
  const takerPct = Number.isFinite(Number(spotTakerFeePct)) ? Number(spotTakerFeePct) : 0.03;
  const makerRate = makerPct / 100;
  const takerRate = takerPct / 100;
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol || 'BTC/USDT');
  const [mobilePanel, setMobilePanel] = useState<MobileSpotPanel>('CHART');
  const [mobilePairSheetOpen, setMobilePairSheetOpen] = useState(false);
  const [pairMenuOpen, setPairMenuOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const pairMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(pairMenuRef, pairMenuOpen, () => setPairMenuOpen(false));

  useEffect(() => {
    if (initialSymbol && markets.some((m) => m.symbol === initialSymbol)) {
      setSelectedSymbol(initialSymbol);
    }
  }, [initialSymbol, markets.length]);

  // Chart state
  const [chartViewTab, setChartViewTab] = useState<ChartViewTab>('CHART');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'>('30m');
  const [chartStyle, setChartStyle] = useState<'CANDLES' | 'HOLLOW' | 'GRAPH'>('CANDLES');
  const [showMa, setShowMa] = useState(true);
  const [showEma, setShowEma] = useState(false);
  const [showBoll, setShowBoll] = useState(false);
  const [showRsi, setShowRsi] = useState(false);
  const [activeTool, setActiveTool] = useState<'CROSSHAIR' | 'TREND' | 'HLINE' | 'MEASURE'>('CROSSHAIR');
  const [zoomBars, setZoomBars] = useState(48);
  const [panOffset, setPanOffset] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverYPrice, setHoverYPrice] = useState<number | null>(null);
  const [trendLines, setTrendLines] = useState<{ x1Idx: number; p1: number; x2Idx: number; p2: number }[]>([]);
  const [hLines, setHLines] = useState<number[]>([]);
  const [draftPoint, setDraftPoint] = useState<{ idx: number; price: number } | null>(null);
  const [measureRange, setMeasureRange] = useState<{ a: { idx: number; price: number }; b: { idx: number; price: number } } | null>(null);
  const [depthHoverX, setDepthHoverX] = useState<number | null>(null);
  const chartSvgRef = useRef<SVGSVGElement>(null);
  const chartCanvasWrapRef = useRef<HTMLDivElement>(null);
  const depthSvgRef = useRef<SVGSVGElement>(null);
  const [chartSize, setChartSize] = useState<{ w: number; h: number }>({ w: 680, h: 420 });

  // Middle Order Book / Recent Trades state
  const [centerBookTab, setCenterBookTab] = useState<CenterBookTab>('ORDER_BOOK');
  const [bookFilter, setBookFilter] = useState<BookFilter>('BOTH');
  const [priceStepMultiplier, setPriceStepMultiplier] = useState<1 | 5 | 10>(1);

  // Right Trade Sidebar state
  const [tradeMode, setTradeMode] = useState<TradeMode>('SPOT');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [priceInput, setPriceInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [orderValueInput, setOrderValueInput] = useState('250');
  const [sliderPct, setSliderPct] = useState(0);
  const [enableTpSl, setEnableTpSl] = useState(false);
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [postOnly, setPostOnly] = useState(false);

  // Bottom dock & API state
  const [bottomTab, setBottomTab] = useState<BottomDockTab>('OPEN_ORDERS');
  const [trades, setTrades] = useState<SpotTrade[]>([]);
  const [holdings, setHoldings] = useState<CoinHolding[]>([]);
  const [liveKlines, setLiveKlines] = useState<Candle[]>([]);
  const [liveBookData, setLiveBookData] = useState<{
    asks: { price: number; qty: number; total: number }[];
    bids: { price: number; qty: number; total: number }[];
    recentTrades: { id: string; price: number; qty: number; isBuy: boolean; time: number }[];
  }>({ asks: [], bids: [], recentTrades: [] });
  const [liveMainBalance, setLiveMainBalance] = useState<number>(user.main_balance);
  const [busy, setBusy] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setLiveMainBalance(user.main_balance);
  }, [user.main_balance]);

  const effectiveMainBalance = liveMainBalance;

  const pair = markets.find((m) => m.symbol === selectedSymbol) || markets[0];
  const priceDecimals = pair ? getPriceDecimals(pair.current_price) : 2;
  const qtyDecimals = pair ? getQtyDecimals(pair.current_price) : 4;
  const bookQtyDecimals = Math.min(qtyDecimals, 6);

  const applySpotSnapshot = (snap: SpotSnapshotResponse) => {
    if (Array.isArray(snap.trades)) setTrades(snap.trades);
    if (Array.isArray(snap.holdings)) setHoldings(snap.holdings);
    if (typeof snap.main_balance === 'number' && Number.isFinite(snap.main_balance)) {
      setLiveMainBalance(snap.main_balance);
    }
  };

  const loadTrades = async () => {
    const res = await apiFetch<{ trades: SpotTrade[]; holdings: CoinHolding[] }>('/api/trades');
    setTrades(res.trades);
    setHoldings(res.holdings);
    return res.trades;
  };

  useEffect(() => {
    loadTrades().catch(() => {});
  }, []);

  // Measure chart canvas container so SVG fills standard full height cleanly without shrinking
  useEffect(() => {
    const el = chartCanvasWrapRef.current;
    if (!el) return;
    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) {
        setChartSize((prev) =>
          Math.abs(prev.w - Math.round(rect.width)) > 2 || Math.abs(prev.h - Math.round(rect.height)) > 2
            ? { w: Math.round(rect.width), h: Math.round(rect.height) }
            : prev
        );
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [chartViewTab, pair?.symbol, mobilePanel]);

  // Fetch real-live klines whenever pair/timeframe changes (4s cadence, skipped while tab hidden)
  useEffect(() => {
    if (!pair?.symbol) return;
    let cancelled = false;
    const fetchCandles = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await apiFetch<{ candles: Candle[] }>(
          `/api/markets/klines?symbol=${encodeURIComponent(pair.symbol)}&interval=${timeframe}&limit=120`
        );
        if (!cancelled && Array.isArray(res.candles) && res.candles.length > 0) {
          setLiveKlines(res.candles);
        }
      } catch {
        // retain previous candles on transient failure
      }
    };
    fetchCandles();
    const timer = setInterval(fetchCandles, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pair?.symbol, timeframe]);

  // Reset drawings & pan when switching market pair
  useEffect(() => {
    setTrendLines([]);
    setHLines([]);
    setDraftPoint(null);
    setMeasureRange(null);
    setPanOffset(0);
  }, [selectedSymbol]);

  // Fetch real-live order book & recent market trades (3s cadence, skipped while tab hidden)
  useEffect(() => {
    if (!pair?.symbol) return;
    let cancelled = false;
    const fetchBook = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await apiFetch<{
          asks: { price: number; qty: number; total: number }[];
          bids: { price: number; qty: number; total: number }[];
          recentTrades: { id: string; price: number; qty: number; isBuy: boolean; time: number }[];
        }>(`/api/markets/book?symbol=${encodeURIComponent(pair.symbol)}`);
        if (!cancelled) {
          setLiveBookData({
            asks: res.asks || [],
            bids: res.bids || [],
            recentTrades: res.recentTrades || [],
          });
        }
      } catch {
        // fallback cleanly to pair bid/ask
      }
    };
    fetchBook();
    const timer = setInterval(fetchBook, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pair?.symbol]);

  // Initialize price/qty when pair changes
  useEffect(() => {
    if (!pair) return;
    const refPrice = side === 'BUY' ? pair.ask : pair.bid;
    setPriceInput(refPrice.toFixed(priceDecimals));
    if (orderValueInput && Number(orderValueInput) > 0 && refPrice > 0) {
      setQtyInput((Number(orderValueInput) / refPrice).toFixed(qtyDecimals));
    }
  }, [selectedSymbol, markets.length]);

  // Lightweight check for open orders/positions (only refreshes full profile when an open trade settles)
  const openCountRef = useRef(0);
  const openOrdersCount = trades.reduce((cnt, t) => cnt + (t.status === 'OPEN' ? 1 : 0), 0);
  openCountRef.current = openOrdersCount;
  const hasOpenTrades = openOrdersCount > 0;
  useEffect(() => {
    if (!hasOpenTrades) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const prevOpen = openCountRef.current;
      loadTrades()
        .then((nextTrades) => {
          const nextOpen = nextTrades.reduce((cnt, t) => cnt + (t.status === 'OPEN' ? 1 : 0), 0);
          if (nextOpen < prevOpen) {
            void onRefresh().catch(() => {});
          }
        })
        .catch(() => {});
    }, 3500);
    return () => clearInterval(timer);
  }, [hasOpenTrades, onRefresh]);

  const currentHolding = pair ? holdings.find((h) => h.asset === pair.base_asset) : undefined;
  const availableCoin = currentHolding ? currentHolding.quantity : 0;

  // Order book: real live Binance depth (with spread/admin-override fallback)
  const orderBook = useMemo(() => {
    if (!pair) return { asks: [], bids: [], bidRatio: 50, askRatio: 50 };
    const levels = bookFilter === 'BOTH' ? 8 : 15;
    const useLiveDepth = !pair.target_price && liveBookData.asks.length > 0 && liveBookData.bids.length > 0 && priceStepMultiplier === 1;

    if (useLiveDepth) {
      const slicedAsks = liveBookData.asks.slice(0, levels);
      const slicedBids = liveBookData.bids.slice(0, levels);
      const maxAskTotal = slicedAsks[slicedAsks.length - 1]?.total || 1;
      const maxBidTotal = slicedBids[slicedBids.length - 1]?.total || 1;

      const asks = slicedAsks
        .slice()
        .reverse()
        .map((a) => ({
          ...a,
          depthPct: Math.min(100, Math.max(8, (a.total / maxAskTotal) * 100)),
        }));

      const bids = slicedBids.map((b) => ({
        ...b,
        depthPct: Math.min(100, Math.max(8, (b.total / maxBidTotal) * 100)),
      }));

      const totalVol = maxBidTotal + maxAskTotal;
      const bidRatio = Math.round((maxBidTotal / totalVol) * 100);
      return { asks, bids, bidRatio, askRatio: 100 - bidRatio };
    }

    const minStep = pair.current_price < 0.001 ? 0.00000001 : pair.current_price < 1 ? 0.00005 : pair.current_price < 10 ? 0.001 : pair.current_price * 0.00035;
    const baseStep = Math.max(minStep, (pair.ask - pair.bid) * 0.5);
    const step = baseStep * priceStepMultiplier;
    const asks = [];
    const bids = [];

    let askCum = 0;
    const askRowsRaw = [];
    for (let i = 0; i < levels; i++) {
      const p = Number((pair.ask + i * step).toFixed(priceDecimals));
      const seed = Math.abs(Math.sin((p * 13.7 + i) * 1.9));
      const qtyScale = pair.current_price < 0.001 ? 1200000 : pair.current_price < 1 ? 1500 : pair.current_price < 50 ? 150 : 1;
      const qty = Number(((0.02 + seed * 1.65) * qtyScale).toFixed(qtyDecimals));
      askCum = Number((askCum + qty).toFixed(qtyDecimals));
      askRowsRaw.push({ price: p, qty, total: askCum, seed });
    }
    const maxAskTotal = askCum || 1;
    for (let i = askRowsRaw.length - 1; i >= 0; i--) {
      asks.push({
        ...askRowsRaw[i],
        depthPct: Math.min(100, Math.max(8, (askRowsRaw[i].total / maxAskTotal) * 100)),
      });
    }

    let bidCum = 0;
    for (let i = 0; i < levels; i++) {
      const p = Number(Math.max(0.00000001, pair.bid - i * step).toFixed(priceDecimals));
      const seed = Math.abs(Math.cos((p * 11.3 + i) * 2.1));
      const qtyScale = pair.current_price < 0.001 ? 1200000 : pair.current_price < 1 ? 1500 : pair.current_price < 50 ? 150 : 1;
      const qty = Number(((0.02 + seed * 1.65) * qtyScale).toFixed(qtyDecimals));
      bidCum = Number((bidCum + qty).toFixed(qtyDecimals));
      bids.push({
        price: p,
        qty,
        total: bidCum,
        seed,
        depthPct: 0,
      });
    }
    const maxBidTotal = bidCum || 1;
    bids.forEach((b) => {
      b.depthPct = Math.min(100, Math.max(8, (b.total / maxBidTotal) * 100));
    });

    const totalVol = maxBidTotal + maxAskTotal;
    const bidRatio = Math.round((maxBidTotal / totalVol) * 100);
    return { asks, bids, bidRatio, askRatio: 100 - bidRatio };
  }, [pair?.ask, pair?.bid, pair?.current_price, pair?.target_price, liveBookData, bookFilter, priceStepMultiplier, priceDecimals, qtyDecimals]);

  // Recent trades tape: real-live executed trades
  const recentTrades = useMemo(() => {
    if (!pair) return [];
    if (!pair.target_price && liveBookData.recentTrades.length > 0) {
      return liveBookData.recentTrades.slice(0, 18).map((tr) => ({
        id: tr.id,
        price: tr.price,
        qty: tr.qty,
        isBuy: tr.isBuy,
        timeStr: new Date(tr.time).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      }));
    }
    if (!pair.history) return [];
    const pts = [...pair.history].slice(-18).reverse();
    return pts.map((pt, idx) => {
      const prev = pts[idx + 1] || pt;
      const isBuy = pt.price >= prev.price;
      const seed = Math.abs(Math.sin(pt.time * 0.001 + idx));
      const qty = Number(((0.005 + seed * 0.85) * (pair.current_price < 50 ? 120 : 1)).toFixed(qtyDecimals));
      const timeStr = new Date(pt.time).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return { price: pt.price, qty, isBuy, timeStr, id: `${pt.time}-${idx}` };
    });
  }, [pair?.history, pair?.current_price, pair?.target_price, liveBookData.recentTrades, qtyDecimals]);

  // Full candle series (120 bars) + visible window slice for accurate indicators
  const allCandles = useMemo<Candle[]>(() => {
    if (!pair) return [];
    if (liveKlines.length > 0 && !pair.target_price) {
      const cloned = liveKlines.map((c) => ({ ...c }));
      const last = cloned[cloned.length - 1];
      if (last && pair.current_price > 0) {
        last.close = pair.current_price;
        last.high = Math.max(last.high, pair.current_price);
        last.low = Math.min(last.low, pair.current_price);
      }
      return cloned;
    }

    const pts = pair.history || [];
    if (pts.length === 0) return [];
    const groupSize = timeframe === '1m' ? 1 : timeframe === '5m' ? 2 : 3;
    const raw: Candle[] = [];
    for (let i = 0; i < pts.length; i += groupSize) {
      const slice = pts.slice(i, i + groupSize);
      const open = slice[0].price;
      const close = slice[slice.length - 1].price;
      const vals = slice.map((s) => s.price);
      const high = Math.max(...vals);
      const low = Math.max(0.00000001, Math.min(...vals));
      const vol = Math.abs(close - open) * 20 + 25 + ((i * 19) % 55);
      raw.push({ open, high, low, close, vol, time: slice[0].time });
    }
    return raw;
  }, [liveKlines, pair, timeframe]);

  const maxPanOffset = Math.max(0, allCandles.length - zoomBars);
  const clampedPan = Math.min(panOffset, maxPanOffset);
  const visibleEndIdx = Math.max(0, allCandles.length - clampedPan);
  const visibleStartIdx = Math.max(0, visibleEndIdx - zoomBars);
  const candles = useMemo(
    () => allCandles.slice(visibleStartIdx, visibleEndIdx),
    [allCandles, visibleStartIdx, visibleEndIdx]
  );

  const high24h = useMemo(() => {
    if (!pair) return 0;
    if (pair.high_24h && pair.high_24h > 0) return Math.max(pair.high_24h, pair.current_price);
    const histMax = pair.history.length ? Math.max(...pair.history.map((h) => h.price)) : pair.current_price;
    return Math.max(histMax, pair.current_price);
  }, [pair]);

  const low24h = useMemo(() => {
    if (!pair) return 0;
    if (pair.low_24h && pair.low_24h > 0) return Math.min(pair.low_24h, pair.current_price);
    const histMin = pair.history.length ? Math.min(...pair.history.map((h) => h.price)) : pair.current_price;
    return Math.min(histMin, pair.current_price);
  }, [pair]);

  const turnover24h = useMemo(() => {
    if (!pair) return 0;
    if (pair.turnover_24h && pair.turnover_24h > 0) return pair.turnover_24h;
    return pair.current_price * 7482;
  }, [pair]);

  // Active reference quote for calculations
  const activeQuotePrice =
    orderType === 'MARKET' || tradeMode === 'POSITION'
      ? side === 'BUY'
        ? pair?.ask || 0
        : pair?.bid || 0
      : Number(priceInput || 0);

  const handlePriceInputChange = (val: string) => {
    setPriceInput(val);
    const p = Number(val);
    if (p > 0 && qtyInput) {
      setOrderValueInput((Number(qtyInput) * p).toFixed(2));
    }
  };

  const handleQtyChange = (val: string) => {
    setQtyInput(val);
    const q = Number(val);
    if (activeQuotePrice > 0 && val !== '' && q >= 0) {
      setOrderValueInput((q * activeQuotePrice).toFixed(2));
    } else if (val === '') {
      setOrderValueInput('');
    }
  };

  const handleOrderValueChange = (val: string) => {
    setOrderValueInput(val);
    const v = Number(val);
    if (activeQuotePrice > 0 && val !== '' && v >= 0) {
      setQtyInput((v / activeQuotePrice).toFixed(qtyDecimals));
    } else if (val === '') {
      setQtyInput('');
    }
  };

  const applySliderPercentage = (pct: number) => {
    setSliderPct(pct);
    if (!pair) return;
    if (tradeMode === 'POSITION' || side === 'BUY') {
      const usd = Number(((effectiveMainBalance * pct) / 100).toFixed(2));
      setOrderValueInput(String(usd));
      if (activeQuotePrice > 0) {
        setQtyInput((usd / activeQuotePrice).toFixed(qtyDecimals));
      }
    } else {
      const qty = Number(((availableCoin * pct) / 100).toFixed(qtyDecimals));
      setQtyInput(String(qty));
      if (activeQuotePrice > 0) {
        setOrderValueInput((qty * activeQuotePrice).toFixed(2));
      }
    }
  };

  const handleSelectBookPrice = (clickedPrice: number) => {
    setTradeMode('SPOT');
    if (orderType === 'MARKET') setOrderType('LIMIT');
    const formatted = clickedPrice.toFixed(priceDecimals);
    setPriceInput(formatted);
    if (orderValueInput && Number(orderValueInput) > 0) {
      setQtyInput((Number(orderValueInput) / clickedPrice).toFixed(qtyDecimals));
    } else if (qtyInput && Number(qtyInput) > 0) {
      setOrderValueInput((Number(qtyInput) * clickedPrice).toFixed(2));
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pair) return;
    setNotice(null);
    setBusy(true);
    try {
      if (tradeMode === 'POSITION') {
        const posSide = side === 'BUY' ? 'LONG' : 'SHORT';
        const stake = Number(orderValueInput);
        const res = await apiFetch<SpotSnapshotResponse & { trade: SpotTrade }>('/api/trades/position', {
          method: 'POST',
          body: JSON.stringify({
            symbol: pair.symbol,
            side: posSide,
            amount_usd: stake,
            ...(enableTpSl && tpPrice ? { tp_price: Number(tpPrice) } : {}),
            ...(enableTpSl && slPrice ? { sl_price: Number(slPrice) } : {}),
          }),
        });
        applySpotSnapshot(res);
        setTpPrice('');
        setSlPrice('');
        setNotice({ type: 'ok', text: `Opened ${posSide} position on ${pair.symbol} ($${formatUsd(stake)}).` });
        setBottomTab('OPEN_ORDERS');
      } else {
        const isLimit = orderType !== 'MARKET';
        const payload =
          side === 'BUY'
            ? {
                symbol: pair.symbol,
                side: 'BUY',
                order_type: isLimit ? 'LIMIT' : 'MARKET',
                limit_price: isLimit ? Number(priceInput) : undefined,
                amount_usd: Number(orderValueInput),
                quantity: qtyInput ? Number(qtyInput) : undefined,
              }
            : {
                symbol: pair.symbol,
                side: 'SELL',
                order_type: isLimit ? 'LIMIT' : 'MARKET',
                limit_price: isLimit ? Number(priceInput) : undefined,
                quantity: Number(qtyInput),
              };

        const res = await apiFetch<
          SpotSnapshotResponse & { status: string; qty: number; execPrice: number; usd: number }
        >('/api/trades/spot', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        applySpotSnapshot(res);

        if (res.status === 'OPEN') {
          setNotice({
            type: 'ok',
            text: `Limit ${side} placed: ${res.qty} ${pair.base_asset} @ $${formatUsd(res.execPrice, priceDecimals)}.`,
          });
          setBottomTab('OPEN_ORDERS');
        } else {
          setNotice({
            type: 'ok',
            text: `${orderType} ${side} filled: ${res.qty} ${pair.base_asset} @ $${formatUsd(res.execPrice, priceDecimals)} ($${formatUsd(res.usd)}).`,
          });
          if (side === 'BUY') {
            setBottomTab('OPEN_ORDERS');
          }
        }
      }
      void onRefresh().catch(() => {});
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleClosePosition = async (tradeId: string) => {
    setNotice(null);
    setClosingId(tradeId);
    try {
      const res = await apiFetch<SpotSnapshotResponse & { trade: SpotTrade }>(`/api/trades/position/${tradeId}/close`, {
        method: 'POST',
      });
      applySpotSnapshot(res);
      const exitP = res.trade.exit_price || res.trade.entry_price;
      const pDec = getPriceDecimals(exitP);
      setNotice({
        type: 'ok',
        text: `Closed ${res.trade.side} ${res.trade.symbol} @ $${formatUsd(exitP, pDec)} · Realized P&L: ${
          res.trade.pnl_usd >= 0 ? '+' : '-'
        }$${formatUsd(Math.abs(res.trade.pnl_usd))}`,
      });
      void onRefresh().catch(() => {});
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setClosingId(null);
    }
  };

  const handleCloseSpotHolding = async (asset: string) => {
    setNotice(null);
    const key = `HOLDING:${asset}`;
    setClosingId(key);
    try {
      const res = await apiFetch<
        SpotSnapshotResponse & {
          asset: string;
          qty: number;
          execPrice: number;
          netProceeds: number;
          realizedPnl: number;
        }
      >('/api/trades/spot/close-holding', {
        method: 'POST',
        body: JSON.stringify({ asset }),
      });
      applySpotSnapshot(res);
      const pDec = getPriceDecimals(res.execPrice);
      setNotice({
        type: 'ok',
        text: `Closed Spot ${res.asset} @ $${formatUsd(res.execPrice, pDec)} · Net Value: $${formatUsd(
          res.netProceeds
        )} · P&L: ${res.realizedPnl >= 0 ? '+' : '-'}$${formatUsd(Math.abs(res.realizedPnl))}`,
      });
      void onRefresh().catch(() => {});
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setClosingId(null);
    }
  };

  const handleCancelLimit = async (tradeId: string) => {
    setNotice(null);
    setClosingId(tradeId);
    try {
      const res = await apiFetch<SpotSnapshotResponse>(`/api/trades/limit/${tradeId}/cancel`, { method: 'POST' });
      applySpotSnapshot(res);
      setNotice({ type: 'ok', text: `Cancelled limit order ${tradeId}.` });
      void onRefresh().catch(() => {});
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message });
    } finally {
      setClosingId(null);
    }
  };

  const computeLivePnl = (t: SpotTrade): number => {
    if (!t.entry_price) return 0;
    const m = markets.find((x) => x.symbol === t.symbol);
    const livePrice = m ? m.current_price : t.entry_price;
    if (t.admin_override === 'FORCE_WIN') return Number((t.amount_usd * 0.35).toFixed(2));
    if (t.admin_override === 'FORCE_LOSS') return Number((-t.amount_usd * 0.45).toFixed(2));
    const movePct = (livePrice - t.entry_price) / t.entry_price;
    const dir = t.side === 'LONG' ? movePct : -movePct;
    return Number(Math.max(-t.amount_usd, t.amount_usd * dir * 5).toFixed(2));
  };

  // Chart SVG coordinates & full-history technical indicator series (MA, EMA, BOLL, RSI)
  const isCompactChart = chartSize.w > 0 && chartSize.w < 460;
  const axisReserve = isCompactChart ? 82 : 112;
  const svgW = Math.max(isCompactChart ? 300 : 420, chartSize.w);
  const svgH = Math.max(isCompactChart ? 260 : 380, chartSize.h);
  const plotW = svgW - axisReserve;
  const pricePlotH = showRsi ? Math.round(svgH * 0.59) : Math.round(svgH * 0.74);
  const volTop = pricePlotH + 8;
  const volH = showRsi ? Math.round(svgH * 0.11) : Math.round(svgH * 0.16);
  const rsiTop = showRsi ? volTop + volH + 10 : 0;
  const rsiH = showRsi ? Math.max(44, svgH - rsiTop - 24) : 0;
  const xAxisY = svgH - 5;

  const indicators = useMemo(() => {
    const computeSma = (period: number) =>
      allCandles.map((_, idx) => {
        const start = Math.max(0, idx - period + 1);
        const slice = allCandles.slice(start, idx + 1);
        return slice.reduce((acc, c) => acc + c.close, 0) / Math.max(1, slice.length);
      });

    const computeEma = (period: number) => {
      const k = 2 / (period + 1);
      const out: number[] = [];
      allCandles.forEach((c, idx) => {
        if (idx === 0) out.push(c.close);
        else out.push(c.close * k + out[idx - 1] * (1 - k));
      });
      return out;
    };

    const bollMid = computeSma(20);
    const bollUpper: number[] = [];
    const bollLower: number[] = [];
    allCandles.forEach((_, idx) => {
      const start = Math.max(0, idx - 19);
      const slice = allCandles.slice(start, idx + 1);
      const mean = bollMid[idx];
      const variance = slice.reduce((acc, c) => acc + (c.close - mean) ** 2, 0) / Math.max(1, slice.length);
      const sd = Math.sqrt(variance);
      bollUpper.push(mean + 2 * sd);
      bollLower.push(Math.max(0.00000001, mean - 2 * sd));
    });

    // RSI(14)
    const rsi: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;
    allCandles.forEach((c, idx) => {
      if (idx === 0) {
        rsi.push(50);
        return;
      }
      const change = c.close - allCandles[idx - 1].close;
      const gain = Math.max(0, change);
      const loss = Math.max(0, -change);
      if (idx <= 14) {
        avgGain += gain / 14;
        avgLoss += loss / 14;
      } else {
        avgGain = (avgGain * 13 + gain) / 14;
        avgLoss = (avgLoss * 13 + loss) / 14;
      }
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
    });

    return {
      ma7: computeSma(7).slice(visibleStartIdx, visibleEndIdx),
      ma25: computeSma(25).slice(visibleStartIdx, visibleEndIdx),
      ema12: computeEma(12).slice(visibleStartIdx, visibleEndIdx),
      ema26: computeEma(26).slice(visibleStartIdx, visibleEndIdx),
      bollUpper: bollUpper.slice(visibleStartIdx, visibleEndIdx),
      bollMid: bollMid.slice(visibleStartIdx, visibleEndIdx),
      bollLower: bollLower.slice(visibleStartIdx, visibleEndIdx),
      rsi: rsi.slice(visibleStartIdx, visibleEndIdx),
    };
  }, [allCandles, visibleStartIdx, visibleEndIdx]);

  const allLows = [
    ...candles.map((c) => c.low),
    ...(showBoll ? indicators.bollLower : []),
  ];
  const allHighs = [
    ...candles.map((c) => c.high),
    ...(showBoll ? indicators.bollUpper : []),
  ];
  const cMin = allLows.length ? Math.min(...allLows) : 0;
  const cMax = allHighs.length ? Math.max(...allHighs) : 1;
  const cPad = (cMax - cMin) * 0.14 || cMin * 0.002 || 1;
  const yMin = cMin - cPad;
  const yMax = cMax + cPad;
  const maxVol = candles.length ? Math.max(...candles.map((c) => c.vol)) : 1;
  const priceToY = (p: number) => pricePlotH - ((p - yMin) / (yMax - yMin)) * (pricePlotH - 22) - 11;
  const yToPrice = (y: number) => {
    const norm = (pricePlotH - 11 - y) / (pricePlotH - 22);
    return yMin + norm * (yMax - yMin);
  };
  const idxToX = (idx: number) => {
    const slotW = plotW / Math.max(1, candles.length);
    return idx * slotW + slotW / 2;
  };
  const rsiToY = (val: number) => rsiTop + rsiH - (Math.max(0, Math.min(100, val)) / 100) * (rsiH - 10) - 5;

  // Visible Peak High & Trough Low indices for chart annotations
  const peakHighIdx = useMemo(() => {
    if (candles.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].high > candles[best].high) best = i;
    }
    return best;
  }, [candles]);

  const troughLowIdx = useMemo(() => {
    if (candles.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].low < candles[best].low) best = i;
    }
    return best;
  }, [candles]);

  const formatCandleTime = (ts: number) => {
    const d = new Date(ts);
    if (timeframe === '1d') {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!chartSvgRef.current || candles.length === 0) return;
    const rect = chartSvgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const relX = ((e.clientX - rect.left) / rect.width) * svgW;
    const relY = ((e.clientY - rect.top) / rect.height) * svgH;

    const clampedX = Math.max(0, Math.min(plotW - 1, relX));
    const slotW = plotW / Math.max(1, candles.length);
    const idx = Math.max(0, Math.min(candles.length - 1, Math.floor(clampedX / slotW)));
    setHoverIdx(idx);

    if (relY >= 0 && relY <= pricePlotH) {
      setHoverYPrice(yToPrice(relY));
    } else {
      setHoverYPrice(null);
    }
  };

  const handleChartClick = () => {
    if (hoverIdx === null || !candles[hoverIdx]) return;
    const clickedPrice = hoverYPrice ?? candles[hoverIdx].close;
    if (activeTool === 'HLINE') {
      setHLines((prev) => [...prev, Number(clickedPrice.toFixed(priceDecimals))]);
      return;
    }
    if (activeTool === 'TREND') {
      if (!draftPoint) {
        setDraftPoint({ idx: hoverIdx, price: clickedPrice });
      } else {
        setTrendLines((prev) => [
          ...prev,
          { x1Idx: draftPoint.idx, p1: draftPoint.price, x2Idx: hoverIdx, p2: clickedPrice },
        ]);
        setDraftPoint(null);
      }
    } else if (activeTool === 'MEASURE') {
      if (!draftPoint) {
        setDraftPoint({ idx: hoverIdx, price: clickedPrice });
        setMeasureRange(null);
      } else {
        setMeasureRange({ a: draftPoint, b: { idx: hoverIdx, price: clickedPrice } });
        setDraftPoint(null);
      }
    }
  };

  const handleChartWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      const step = e.deltaY > 0 ? 4 : -4;
      setZoomBars((z) => Math.max(14, Math.min(100, z + step)));
    } else if (Math.abs(e.deltaX) > 2) {
      const panStep = e.deltaX > 0 ? -3 : 3;
      setPanOffset((p) => Math.max(0, Math.min(maxPanOffset, p + panStep)));
    }
  };

  const activeIdx = hoverIdx !== null && candles[hoverIdx] ? hoverIdx : candles.length - 1;
  const activeCandle = candles[activeIdx];
  const activeMa7 = indicators.ma7[activeIdx];
  const activeMa25 = indicators.ma25[activeIdx];
  const activeEma12 = indicators.ema12[activeIdx];
  const activeEma26 = indicators.ema26[activeIdx];
  const activeRsi = indicators.rsi[activeIdx];

  const buyPreviewFeeRate = tradeMode === 'SPOT' && orderType !== 'MARKET' ? makerRate : takerRate;
  const maxBuyCoin =
    activeQuotePrice > 0
      ? Math.max(0, effectiveMainBalance - Number((effectiveMainBalance * buyPreviewFeeRate).toFixed(2))) /
        activeQuotePrice
      : 0;
  const openOrders = useMemo(() => trades.filter((t) => t.status === 'OPEN'), [trades]);
  const activeHoldings = useMemo(() => holdings.filter((h) => Number(h.quantity) > 0), [holdings]);
  const pairOpenOrders = useMemo(
    () => (pair ? openOrders.filter((t) => t.symbol === pair.symbol) : []),
    [openOrders, pair]
  );
  const historyOrders = useMemo(
    () =>
      trades.filter((t) => {
        if (t.status === 'OPEN') return false;
        if (t.status === 'SETTLED' && t.side === 'BUY' && (t.order_mode === 'SPOT' || t.order_mode === 'LIMIT')) {
          return false;
        }
        return true;
      }),
    [trades]
  );
  const filteredMarkets = useMemo(() => {
    const q = pairSearch.trim().toLowerCase();
    if (!q) return markets;
    return markets.filter((m) => m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [markets, pairSearch]);

  return (
    <div className="space-y-3">
      {notice && (
        <div
          className={`border text-xs px-4 py-2.5 rounded-lg flex items-center justify-between ${
            notice.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* MOBILE SPOT HEADER & 3-PANEL SWITCHER (< 1024px ONLY) */}
      {pair && (
        <div className="lg:hidden space-y-2.5">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-3 shadow-xs">
            <button
              type="button"
              onClick={() => setMobilePairSheetOpen(true)}
              className="flex items-center gap-2.5 text-left min-w-0 py-0.5"
            >
              <CryptoIcon symbol={pair.base_asset} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-base font-bold text-slate-900">
                  <span className="truncate">{pair.symbol}</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </div>
                <div className="text-[11px] text-slate-500 truncate">{pair.name} · Tap to switch</div>
              </div>
            </button>

            <div className="text-right shrink-0">
              <div
                className={`text-lg font-bold font-mono-tabular ${
                  pair.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                ${formatUsd(pair.current_price, priceDecimals)}
              </div>
              <div
                className={`text-xs font-mono-tabular font-semibold ${
                  pair.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {pair.change_24h_pct >= 0 ? '+' : ''}
                {pair.change_24h_pct.toFixed(2)}% (24h)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            {(
              [
                ['CHART', 'Chart & Book'],
                ['TRADE', side === 'BUY' ? `Trade · Buy` : `Trade · Sell`],
                ['ORDERS', `Orders (${openOrders.length + activeHoldings.length})`],
              ] as [MobileSpotPanel, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobilePanel(key)}
                className={`min-h-[42px] px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  mobilePanel === key
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MAIN TERMINAL SHELL: LEFT 9 COLS (TICKER + CHART + ORDER BOOK) | RIGHT 3 COLS FULL-HEIGHT TRADE SIDEBAR */}
      {pair && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-stretch">
          {/* LEFT 9-COLUMN BLOCK */}
          <div className={`${mobilePanel === 'CHART' ? 'flex' : 'hidden lg:flex'} xl:col-span-9 flex-col gap-3`}>
            {/* TOP PAIR TICKER BAR (Desktop & Tablet) */}
            <div className="hidden lg:flex border border-slate-200 rounded-xl bg-white px-4 py-2.5 flex-wrap items-center justify-between gap-4 relative">
              <div className="flex items-center gap-5">
                {/* Pair Selector Dropdown */}
                <div ref={pairMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setPairMenuOpen((prev) => !prev)}
                    aria-expanded={pairMenuOpen}
                    className="flex items-center gap-2.5 text-left hover:bg-slate-50 px-2 py-1 -ml-2 rounded-lg transition-colors"
                  >
                    <CryptoIcon symbol={pair.base_asset} size="md" />
                    <div>
                      <div className="flex items-center gap-1 text-base font-bold text-slate-900">
                        <span>{pair.symbol}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform ${pairMenuOpen ? 'rotate-180' : ''}`}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500">Spot</div>
                    </div>
                  </button>

                  {pairMenuOpen && (
                    <div className="absolute left-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-40 p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 px-0.5">
                        <span className="font-semibold text-slate-700">Spot Markets</span>
                        <span className="font-mono-tabular">{filteredMarkets.length} / {markets.length} Coins</span>
                      </div>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={pairSearch}
                          onChange={(e) => setPairSearch(e.target.value)}
                          placeholder="Search top 30 coins (e.g. BTC, SOL, PEPE)..."
                          className="w-full h-8 pl-8 pr-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                        />
                      </div>
                      <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {filteredMarkets.map((m) => {
                          const mDec = getPriceDecimals(m.current_price);
                          return (
                            <button
                              key={m.symbol}
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(m.symbol);
                                setPairMenuOpen(false);
                              }}
                              className={`w-full py-2 px-2 flex items-center justify-between text-xs hover:bg-slate-50 rounded ${
                                m.symbol === pair.symbol ? 'bg-blue-50/70' : ''
                              }`}
                            >
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <CryptoIcon symbol={m.base_asset} size="xs" />
                                <span className="text-left truncate">
                                  <span className="font-semibold text-slate-900">{m.base_asset}</span>
                                  <span className="text-slate-400">/USDT</span>
                                </span>
                              </span>
                              <span className="font-mono-tabular text-slate-800">
                                ${formatUsd(m.current_price, mDec)}
                              </span>
                              <span
                                className={`font-mono-tabular font-medium w-14 text-right ${
                                  m.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                                }`}
                              >
                                {m.change_24h_pct >= 0 ? '+' : ''}
                                {m.change_24h_pct.toFixed(2)}%
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-7 w-px bg-slate-200" />

                {/* Live Price */}
                <div>
                  <div
                    className={`text-lg font-bold font-mono-tabular ${
                      pair.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {formatUsd(pair.current_price, priceDecimals)}
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-500">
                    ≈${formatUsd(pair.current_price, priceDecimals)} USD
                  </div>
                </div>
              </div>

              {/* 24H Stats */}
              <div className="flex flex-wrap items-center gap-6 text-xs">
                <div>
                  <div className="text-[11px] text-slate-500">24H Change</div>
                  <div
                    className={`font-mono-tabular font-semibold ${
                      pair.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {pair.change_24h_pct >= 0 ? '+' : ''}
                    {pair.change_24h_pct.toFixed(2)}%
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">24H High</div>
                  <div className="font-mono-tabular font-medium text-slate-900">
                    {formatUsd(high24h, priceDecimals)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">24H Low</div>
                  <div className="font-mono-tabular font-medium text-slate-900">
                    {formatUsd(low24h, priceDecimals)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">24H Turnover(USDT)</div>
                  <div className="font-mono-tabular font-medium text-slate-900">
                    {formatUsd(turnover24h, 0)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-500">Spread</div>
                  <div className="font-mono-tabular font-medium text-blue-600">
                    {(pair.spread_bps / 100).toFixed(2)}% ({pair.spread_bps} bps)
                  </div>
                </div>
              </div>
            </div>

            {/* MIDDLE SPLIT: FULL-WIDTH CHART + COMPACT NARROW ORDER BOOK */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_248px] gap-3 flex-1 items-stretch">
              {/* CHART PANEL */}
              <div className="min-w-0 border border-slate-200 rounded-xl bg-white flex flex-col overflow-hidden">
                {/* Chart Top Sub-nav */}
                <div className="px-4 min-h-[42px] py-1.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-5">
                    {(['CHART', 'OVERVIEW', 'DEPTH'] as ChartViewTab[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setChartViewTab(t)}
                        className={`py-1.5 border-b-2 font-semibold transition-colors whitespace-nowrap ${
                          chartViewTab === t
                            ? 'border-blue-600 text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {t === 'CHART' ? 'Price Chart' : t === 'OVERVIEW' ? 'Market Info' : 'Order Depth'}
                      </button>
                    ))}
                  </div>

                  {/* Chart Render Mode */}
                  <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-lg">
                    {(
                      [
                        ['CANDLES', 'Candles'],
                        ['HOLLOW', 'Hollow'],
                        ['GRAPH', 'Area'],
                      ] as const
                    ).map(([modeKey, label]) => (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => {
                          setChartStyle(modeKey);
                          if (chartViewTab !== 'CHART') setChartViewTab('CHART');
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                          chartStyle === modeKey
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timeframe & Indicator Toggle Bar */}
                <div className="px-4 py-1.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] bg-white">
                  <div className="flex items-center gap-1 flex-wrap">
                    {(['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const).map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => {
                          setTimeframe(tf);
                          setPanOffset(0);
                        }}
                        className={`px-2 py-0.5 rounded font-medium transition-colors ${
                          timeframe === tf
                            ? 'bg-slate-900 text-white font-semibold'
                            : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>

                  {/* Indicator Toggles */}
                  <div className="flex items-center gap-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setShowMa((v) => !v)}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        showMa ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      MA
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEma((v) => !v)}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        showEma ? 'bg-violet-50 text-violet-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      EMA
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBoll((v) => !v)}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        showBoll ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      BOLL
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRsi((v) => !v)}
                      className={`px-2 py-0.5 rounded font-medium transition-colors ${
                        showRsi ? 'bg-amber-50 text-amber-700 font-semibold' : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      RSI
                    </button>
                  </div>
                </div>

                {/* Live OHLCV & Active Indicator Readout Strip */}
                <div className="px-4 py-1.5 border-b border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-slate-50/40">

                  {activeCandle && (
                    <div className="flex flex-wrap items-center gap-2.5 font-mono-tabular text-slate-500">
                      <span className="font-semibold text-slate-700">{formatCandleTime(activeCandle.time)}</span>
                      <span>
                        O <strong className="text-slate-900">{formatUsd(activeCandle.open, priceDecimals)}</strong>
                      </span>
                      <span>
                        H <strong className="text-emerald-600">{formatUsd(activeCandle.high, priceDecimals)}</strong>
                      </span>
                      <span>
                        L <strong className="text-red-600">{formatUsd(activeCandle.low, priceDecimals)}</strong>
                      </span>
                      <span>
                        C <strong className="text-slate-900">{formatUsd(activeCandle.close, priceDecimals)}</strong>
                      </span>
                      {(() => {
                        const cPct =
                          activeCandle.open > 0
                            ? ((activeCandle.close - activeCandle.open) / activeCandle.open) * 100
                            : 0;
                        return (
                          <span className={`font-semibold ${cPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {cPct >= 0 ? '+' : ''}
                            {cPct.toFixed(2)}%
                          </span>
                        );
                      })()}
                      {showMa && chartStyle !== 'GRAPH' && (
                        <>
                          <span className="text-blue-600">
                            MA7 <strong>{formatUsd(activeMa7 || activeCandle.close, priceDecimals)}</strong>
                          </span>
                          <span className="text-amber-600">
                            MA25 <strong>{formatUsd(activeMa25 || activeCandle.close, priceDecimals)}</strong>
                          </span>
                        </>
                      )}
                      {showEma && (
                        <>
                          <span className="text-violet-600">
                            EMA12 <strong>{formatUsd(activeEma12 || activeCandle.close, priceDecimals)}</strong>
                          </span>
                          <span className="text-cyan-600">
                            EMA26 <strong>{formatUsd(activeEma26 || activeCandle.close, priceDecimals)}</strong>
                          </span>
                        </>
                      )}
                      {showRsi && (
                        <span className="text-amber-700">
                          RSI14 <strong>{(activeRsi ?? 50).toFixed(1)}</strong>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Chart Body with Left Drawing Tool Rail */}
                {chartViewTab === 'CHART' && (
                  <div className="flex-1 flex min-h-[395px]">
                    {/* Left Drawing Toolbar */}
                    <div className="hidden sm:flex w-10 border-r border-slate-200 bg-white py-2.5 flex-col items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        title="Crosshair"
                        onClick={() => {
                          setActiveTool('CROSSHAIR');
                          setDraftPoint(null);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          activeTool === 'CROSSHAIR' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Crosshair className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Trendline (click 2 points)"
                        onClick={() => {
                          setActiveTool('TREND');
                          setDraftPoint(null);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          activeTool === 'TREND' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <TrendingUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Horizontal Support / Resistance Line"
                        onClick={() => {
                          setActiveTool('HLINE');
                          setDraftPoint(null);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          activeTool === 'HLINE' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Price Range Measure (click 2 points)"
                        onClick={() => {
                          setActiveTool('MEASURE');
                          setDraftPoint(null);
                        }}
                        className={`p-1.5 rounded-md transition-colors ${
                          activeTool === 'MEASURE' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <Ruler className="w-4 h-4" />
                      </button>
                      <div className="w-5 h-px bg-slate-200 my-1" />
                      <button
                        type="button"
                        title="Zoom In"
                        onClick={() => setZoomBars((z) => Math.max(14, z - 6))}
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Zoom Out"
                        onClick={() => setZoomBars((z) => Math.min(100, z + 6))}
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Reset View & Clear Drawings"
                        onClick={() => {
                          setZoomBars(48);
                          setPanOffset(0);
                          setTrendLines([]);
                          setHLines([]);
                          setDraftPoint(null);
                          setMeasureRange(null);
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Interactive Candlestick + Indicator SVG Canvas */}
                    <div className="flex-1 px-2.5 pt-2 pb-2 flex flex-col gap-1.5 relative min-w-0">
                      <div ref={chartCanvasWrapRef} className="flex-1 min-h-[270px] sm:min-h-[430px] relative">
                        <svg
                          ref={chartSvgRef}
                          viewBox={`0 0 ${svgW} ${svgH}`}
                          className="w-full h-full block overflow-visible select-none cursor-crosshair"
                          onMouseMove={handleChartMouseMove}
                          onClick={handleChartClick}
                          onWheel={handleChartWheel}
                          onMouseLeave={() => {
                            setHoverIdx(null);
                            setHoverYPrice(null);
                          }}
                        >
                        <defs>
                          <linearGradient id="nepefy-area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
                          </linearGradient>
                          <linearGradient id="nepefy-boll-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0284c7" stopOpacity="0.08" />
                            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.03" />
                          </linearGradient>
                        </defs>

                        {/* Horizontal Grid + Right Price Axis */}
                        {[0.12, 0.32, 0.52, 0.72, 0.92].map((ratio) => {
                          const y = ratio * pricePlotH;
                          const val = yMax - ratio * (yMax - yMin);
                          return (
                            <g key={ratio}>
                              <line x1="0" y1={y} x2={plotW} y2={y} stroke="#f1f5f9" strokeDasharray="3 3" />
                              <text
                                x={svgW - 6}
                                y={y + 4.5}
                                textAnchor="end"
                                fontSize={isCompactChart ? '10.5' : '13'}
                                fontWeight="600"
                                fill="#475569"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {formatUsd(val, priceDecimals)}
                              </text>
                            </g>
                          );
                        })}

                        {/* Vertical Grid & X-axis Timestamps */}
                        {[0.12, 0.32, 0.52, 0.72, 0.9].map((ratio) => {
                          const gx = plotW * ratio;
                          const sampleIdx = Math.min(
                            Math.max(0, candles.length - 1),
                            Math.floor(ratio * Math.max(0, candles.length - 1))
                          );
                          const sampleTime = candles[sampleIdx]?.time;
                          return (
                            <g key={`v-${ratio}`}>
                              <line x1={gx} y1="0" x2={gx} y2={showRsi ? rsiTop + rsiH : volTop + volH} stroke="#f8fafc" />
                              {sampleTime && (
                                <text
                                  x={gx}
                                  y={xAxisY}
                                  textAnchor="middle"
                                  fontSize="11.5"
                                  fontWeight="500"
                                  fill="#64748b"
                                  fontFamily="JetBrains Mono, monospace"
                                >
                                  {formatCandleTime(sampleTime)}
                                </text>
                              )}
                            </g>
                          );
                        })}

                        {/* Plot & Volume Divider */}
                        <line x1="0" y1={volTop - 4} x2={plotW} y2={volTop - 4} stroke="#e2e8f0" strokeOpacity="0.7" />
                        <line x1={plotW} y1="0" x2={plotW} y2={showRsi ? rsiTop + rsiH : volTop + volH} stroke="#f1f5f9" />

                        {/* Bollinger Bands Shaded Channel */}
                        {showBoll && candles.length > 2 && (
                          <g pointerEvents="none">
                            <polygon
                              fill="url(#nepefy-boll-grad)"
                              points={[
                                ...indicators.bollUpper.map((v, i) => `${idxToX(i).toFixed(1)},${priceToY(v).toFixed(1)}`),
                                ...indicators.bollLower
                                  .slice()
                                  .reverse()
                                  .map((v, ri) => `${idxToX(candles.length - 1 - ri).toFixed(1)},${priceToY(v).toFixed(1)}`),
                              ].join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#0284c7"
                              strokeWidth="1"
                              strokeOpacity="0.55"
                              points={indicators.bollUpper.map((v, i) => `${idxToX(i).toFixed(1)},${priceToY(v).toFixed(1)}`).join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#0284c7"
                              strokeWidth="1"
                              strokeDasharray="3 3"
                              strokeOpacity="0.45"
                              points={indicators.bollMid.map((v, i) => `${idxToX(i).toFixed(1)},${priceToY(v).toFixed(1)}`).join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#0284c7"
                              strokeWidth="1"
                              strokeOpacity="0.55"
                              points={indicators.bollLower.map((v, i) => `${idxToX(i).toFixed(1)},${priceToY(v).toFixed(1)}`).join(' ')}
                            />
                          </g>
                        )}

                        {/* Area Graph Mode */}
                        {chartStyle === 'GRAPH' && candles.length > 0 && (
                          <g>
                            <polygon
                              fill="url(#nepefy-area-grad)"
                              points={[
                                `${idxToX(0).toFixed(1)},${pricePlotH}`,
                                ...candles.map((c, idx) => `${idxToX(idx).toFixed(1)},${priceToY(c.close).toFixed(1)}`),
                                `${idxToX(candles.length - 1).toFixed(1)},${pricePlotH}`,
                              ].join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="2.2"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              points={candles
                                .map((c, idx) => `${idxToX(idx).toFixed(1)},${priceToY(c.close).toFixed(1)}`)
                                .join(' ')}
                            />
                            {clampedPan === 0 && (
                              <>
                                <circle
                                  cx={idxToX(candles.length - 1)}
                                  cy={priceToY(candles[candles.length - 1].close)}
                                  r="6"
                                  fill="#2563eb"
                                  fillOpacity="0.2"
                                />
                                <circle
                                  cx={idxToX(candles.length - 1)}
                                  cy={priceToY(candles[candles.length - 1].close)}
                                  r="3.2"
                                  fill="#2563eb"
                                  stroke="#ffffff"
                                  strokeWidth="1.5"
                                />
                              </>
                            )}
                          </g>
                        )}

                        {/* Candlesticks (Filled & Hollow Modes) */}
                        {chartStyle !== 'GRAPH' &&
                          candles.map((c, idx) => {
                            const slotW = plotW / Math.max(1, candles.length);
                            const cx = idxToX(idx);
                            const candleW = Math.max(3.5, Math.min(13, slotW * 0.64));
                            const isUp = c.close >= c.open;
                            const color = isUp ? '#0ECB81' : '#F6465D';
                            const yHigh = priceToY(c.high);
                            const yLow = priceToY(c.low);
                            const yOpen = priceToY(c.open);
                            const yClose = priceToY(c.close);
                            const bodyTop = Math.min(yOpen, yClose);
                            const bodyH = Math.max(2, Math.abs(yClose - yOpen));

                            const hollowFill = chartStyle === 'HOLLOW' && isUp ? '#ffffff' : color;

                            return (
                              <g key={`${c.time}-${idx}`}>
                                <line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth="1.25" />
                                <rect
                                  x={cx - candleW / 2}
                                  y={bodyTop}
                                  width={candleW}
                                  height={bodyH}
                                  fill={hollowFill}
                                  stroke={color}
                                  strokeWidth={chartStyle === 'HOLLOW' && isUp ? '1.25' : '0'}
                                  rx="1"
                                />
                              </g>
                            );
                          })}

                        {/* Volume Bars (All Chart Modes) */}
                        {candles.map((c, idx) => {
                          const slotW = plotW / Math.max(1, candles.length);
                          const cx = idxToX(idx);
                          const barW = Math.max(3, Math.min(12, slotW * 0.62));
                          const isUp = c.close >= c.open;
                          const vBarH = Math.max(2, (c.vol / maxVol) * volH);
                          return (
                            <rect
                              key={`vol-${c.time}-${idx}`}
                              x={cx - barW / 2}
                              y={volTop + (volH - vBarH)}
                              width={barW}
                              height={vBarH}
                              fill={isUp ? '#a7f3d0' : '#fecdd3'}
                              rx="1"
                            />
                          );
                        })}

                        {/* RSI(14) Sub-Panel */}
                        {showRsi && (
                          <g>
                            <line x1="0" y1={rsiTop - 5} x2={plotW} y2={rsiTop - 5} stroke="#e2e8f0" strokeOpacity="0.7" />
                            <line x1="0" y1={rsiToY(70)} x2={plotW} y2={rsiToY(70)} stroke="#f1f5f9" strokeDasharray="3 3" />
                            <line x1="0" y1={rsiToY(30)} x2={plotW} y2={rsiToY(30)} stroke="#f1f5f9" strokeDasharray="3 3" />
                            <polyline
                              fill="none"
                              stroke="#d97706"
                              strokeWidth="1.4"
                              strokeLinejoin="round"
                              points={indicators.rsi
                                .map((val, idx) => `${idxToX(idx).toFixed(1)},${rsiToY(val).toFixed(1)}`)
                                .join(' ')}
                            />
                            <text x={svgW - 6} y={rsiToY(70) + 4} textAnchor="end" fontSize="11" fontWeight="500" fill="#64748b" fontFamily="JetBrains Mono, monospace">
                              70
                            </text>
                            <text x={svgW - 6} y={rsiToY(30) + 4} textAnchor="end" fontSize="11" fontWeight="500" fill="#64748b" fontFamily="JetBrains Mono, monospace">
                              30
                            </text>
                          </g>
                        )}

                        {/* MA(7) & MA(25) Smooth Lines */}
                        {showMa && chartStyle !== 'GRAPH' && candles.length > 2 && (
                          <g pointerEvents="none">
                            <polyline
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="1.4"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              points={indicators.ma7
                                .map((val, idx) => `${idxToX(idx).toFixed(1)},${priceToY(val).toFixed(1)}`)
                                .join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#f59e0b"
                              strokeWidth="1.35"
                              strokeLinejoin="round"
                              strokeLinecap="round"
                              points={indicators.ma25
                                .map((val, idx) => `${idxToX(idx).toFixed(1)},${priceToY(val).toFixed(1)}`)
                                .join(' ')}
                            />
                          </g>
                        )}

                        {/* EMA(12) & EMA(26) Smooth Lines */}
                        {showEma && candles.length > 2 && (
                          <g pointerEvents="none">
                            <polyline
                              fill="none"
                              stroke="#7c3aed"
                              strokeWidth="1.35"
                              strokeLinejoin="round"
                              points={indicators.ema12
                                .map((val, idx) => `${idxToX(idx).toFixed(1)},${priceToY(val).toFixed(1)}`)
                                .join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#0891b2"
                              strokeWidth="1.35"
                              strokeLinejoin="round"
                              points={indicators.ema26
                                .map((val, idx) => `${idxToX(idx).toFixed(1)},${priceToY(val).toFixed(1)}`)
                                .join(' ')}
                            />
                          </g>
                        )}

                        {/* Visible Peak High & Trough Low Labels */}
                        {peakHighIdx >= 0 && candles[peakHighIdx] && (
                          <g pointerEvents="none">
                            <text
                              x={Math.max(46, Math.min(plotW - 46, idxToX(peakHighIdx)))}
                              y={Math.max(14, priceToY(candles[peakHighIdx].high) - 6)}
                              textAnchor="middle"
                              fontSize="12.5"
                              fontWeight="700"
                              fill="#059669"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {formatUsd(candles[peakHighIdx].high, priceDecimals)}
                            </text>
                          </g>
                        )}
                        {troughLowIdx >= 0 && candles[troughLowIdx] && (
                          <g pointerEvents="none">
                            <text
                              x={Math.max(46, Math.min(plotW - 46, idxToX(troughLowIdx)))}
                              y={Math.min(pricePlotH - 3, priceToY(candles[troughLowIdx].low) + 15)}
                              textAnchor="middle"
                              fontSize="12.5"
                              fontWeight="700"
                              fill="#e11d48"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {formatUsd(candles[troughLowIdx].low, priceDecimals)}
                            </text>
                          </g>
                        )}

                        {/* Open Orders / Position Entry Price Lines */}
                        {pairOpenOrders.slice(0, 4).map((ord) => {
                          const targetP = ord.limit_price || ord.entry_price;
                          if (!targetP || targetP < yMin || targetP > yMax) return null;
                          const oy = priceToY(targetP);
                          const isBuyOrd = ord.side === 'BUY' || ord.side === 'LONG';
                          const col = isBuyOrd ? '#059669' : '#e11d48';
                          return (
                            <g key={`ord-line-${ord.id}`} pointerEvents="none">
                              <line x1="0" y1={oy} x2={plotW} y2={oy} stroke={col} strokeWidth="1" strokeDasharray="4 2" />
                              <rect x="6" y={oy - 10} width="96" height="20" rx="4" fill={col} />
                              <text
                                x="54"
                                y={oy + 3.5}
                                textAnchor="middle"
                                fontSize="10.5"
                                fontWeight="700"
                                fill="#ffffff"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {ord.order_mode === 'LIMIT' ? `Limit ${ord.side}` : `Entry ${ord.side}`}
                              </text>
                            </g>
                          );
                        })}

                        {/* User Drawn Horizontal Support/Resistance Lines */}
                        {hLines.map((hp, i) => {
                          if (hp < yMin || hp > yMax) return null;
                          const hy = priceToY(hp);
                          return (
                            <g key={`hl-${i}`} pointerEvents="none">
                              <line x1="0" y1={hy} x2={plotW} y2={hy} stroke="#2563eb" strokeWidth="1.25" strokeDasharray="5 3" />
                              <rect x={plotW - 76} y={hy - 10} width="72" height="20" rx="4" fill="#eff6ff" stroke="#93c5fd" />
                              <text
                                x={plotW - 40}
                                y={hy + 3.5}
                                textAnchor="middle"
                                fontSize="10.5"
                                fontWeight="700"
                                fill="#1d4ed8"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {formatUsd(hp, priceDecimals)}
                              </text>
                            </g>
                          );
                        })}

                        {/* User Drawn Trendlines */}
                        {trendLines.map((tl, i) => (
                          <line
                            key={`tl-${i}`}
                            x1={idxToX(tl.x1Idx)}
                            y1={priceToY(tl.p1)}
                            x2={idxToX(tl.x2Idx)}
                            y2={priceToY(tl.p2)}
                            stroke="#2563eb"
                            strokeWidth="1.75"
                          />
                        ))}
                        {activeTool === 'TREND' && draftPoint && hoverIdx !== null && (
                          <line
                            x1={idxToX(draftPoint.idx)}
                            y1={priceToY(draftPoint.price)}
                            x2={idxToX(hoverIdx)}
                            y2={priceToY(hoverYPrice ?? candles[hoverIdx]?.close ?? draftPoint.price)}
                            stroke="#2563eb"
                            strokeDasharray="4 3"
                            strokeWidth="1.5"
                          />
                        )}

                        {/* Measurement Overlay Box */}
                        {(() => {
                          const activeMeasure =
                            activeTool === 'MEASURE' && draftPoint && hoverIdx !== null
                              ? { a: draftPoint, b: { idx: hoverIdx, price: hoverYPrice ?? candles[hoverIdx]?.close ?? draftPoint.price } }
                              : measureRange;
                          if (!activeMeasure) return null;
                          const x1 = idxToX(activeMeasure.a.idx);
                          const x2 = idxToX(activeMeasure.b.idx);
                          const y1 = priceToY(activeMeasure.a.price);
                          const y2 = priceToY(activeMeasure.b.price);
                          const diff = activeMeasure.b.price - activeMeasure.a.price;
                          const pct = activeMeasure.a.price > 0 ? (diff / activeMeasure.a.price) * 100 : 0;
                          const barsDelta = Math.abs(activeMeasure.b.idx - activeMeasure.a.idx);
                          const isPos = diff >= 0;
                          const rx = Math.min(x1, x2);
                          const ry = Math.min(y1, y2);
                          const rw = Math.max(4, Math.abs(x2 - x1));
                          const rh = Math.max(4, Math.abs(y2 - y1));
                          return (
                            <g pointerEvents="none">
                              <rect
                                x={rx}
                                y={ry}
                                width={rw}
                                height={rh}
                                fill={isPos ? '#0ECB81' : '#F6465D'}
                                fillOpacity="0.12"
                                stroke={isPos ? '#0ECB81' : '#F6465D'}
                                strokeDasharray="3 2"
                              />
                              <rect
                                x={Math.max(4, Math.min(plotW - 160, rx + rw / 2 - 78))}
                                y={Math.max(4, ry - 25)}
                                width="156"
                                height="22"
                                rx="4"
                                fill={isPos ? '#059669' : '#e11d48'}
                              />
                              <text
                                x={Math.max(82, Math.min(plotW - 82, rx + rw / 2))}
                                y={Math.max(4, ry - 25) + 14.5}
                                textAnchor="middle"
                                fontSize="11"
                                fontWeight="700"
                                fill="#ffffff"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {isPos ? '+' : ''}
                                {pct.toFixed(2)}% · {barsDelta} bars
                              </text>
                            </g>
                          );
                        })()}

                        {/* Live Price Horizontal Line & Right Axis Badge */}
                        {(() => {
                          const liveColor =
                            chartStyle === 'GRAPH'
                              ? '#2563eb'
                              : pair.change_24h_pct >= 0
                              ? '#059669'
                              : '#e11d48';
                          const liveY = Math.max(15, Math.min(pricePlotH - 15, priceToY(pair.current_price)));
                          return (
                            <g pointerEvents="none">
                              <line
                                x1="0"
                                y1={liveY}
                                x2={plotW}
                                y2={liveY}
                                stroke={liveColor}
                                strokeDasharray="2 2"
                                strokeWidth="1"
                              />
                              <rect x={svgW - (axisReserve - 4)} y={liveY - 14} width={axisReserve - 4} height="28" rx="4" fill={liveColor} />
                              <text
                                x={svgW - (axisReserve - 4) / 2}
                                y={liveY + 5}
                                textAnchor="middle"
                                fontSize={isCompactChart ? '11.5' : '14'}
                                fontWeight="700"
                                fill="#ffffff"
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {formatUsd(pair.current_price, priceDecimals)}
                              </text>
                            </g>
                          );
                        })()}

                        {/* Interactive Mouse Hover Crosshair + Axis Tags */}
                        {hoverIdx !== null && candles[hoverIdx] && (
                          <g pointerEvents="none">
                            <line
                              x1={idxToX(hoverIdx)}
                              y1="0"
                              x2={idxToX(hoverIdx)}
                              y2={showRsi ? rsiTop + rsiH : volTop + volH}
                              stroke="#94a3b8"
                              strokeDasharray="3 3"
                              strokeWidth="1"
                            />
                            {hoverYPrice !== null && (
                              <>
                                <line
                                  x1="0"
                                  y1={priceToY(hoverYPrice)}
                                  x2={plotW}
                                  y2={priceToY(hoverYPrice)}
                                  stroke="#94a3b8"
                                  strokeDasharray="3 3"
                                  strokeWidth="1"
                                />
                                <rect
                                  x={svgW - (axisReserve - 4)}
                                  y={Math.max(0, Math.min(pricePlotH - 26, priceToY(hoverYPrice) - 13))}
                                  width={axisReserve - 4}
                                  height="26"
                                  rx="4"
                                  fill="#0f172a"
                                />
                                <text
                                  x={svgW - (axisReserve - 4) / 2}
                                  y={Math.max(0, Math.min(pricePlotH - 26, priceToY(hoverYPrice) - 13)) + 17.5}
                                  textAnchor="middle"
                                  fontSize={isCompactChart ? '11' : '13.5'}
                                  fontWeight="700"
                                  fill="#ffffff"
                                  fontFamily="JetBrains Mono, monospace"
                                >
                                  {formatUsd(hoverYPrice, priceDecimals)}
                                </text>
                              </>
                            )}
                            <rect
                              x={Math.max(2, Math.min(plotW - 64, idxToX(hoverIdx) - 31))}
                              y={(showRsi ? rsiTop + rsiH : volTop + volH) + 3}
                              width="62"
                              height="20"
                              rx="4"
                              fill="#0f172a"
                            />
                            <text
                              x={Math.max(33, Math.min(plotW - 33, idxToX(hoverIdx)))}
                              y={(showRsi ? rsiTop + rsiH : volTop + volH) + 16.5}
                              textAnchor="middle"
                              fontSize="11"
                              fontWeight="700"
                              fill="#ffffff"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              {formatCandleTime(candles[hoverIdx].time)}
                            </text>
                          </g>
                        )}
                        </svg>
                      </div>

                      {/* Bottom Chart Controls Bar */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <div className="flex items-center gap-2.5">
                          {(
                            [
                              ['1D', 24],
                              ['5D', 36],
                              ['1M', 48],
                              ['3M', 72],
                              ['ALL', 100],
                            ] as const
                          ).map(([label, bars]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => {
                                setZoomBars(bars);
                                setPanOffset(0);
                              }}
                              className={`font-medium transition-colors ${
                                zoomBars === bars ? 'text-blue-600 font-semibold' : 'hover:text-slate-900'
                              }`}
                            >
                              {label}
                            </button>
                          ))}

                          <div className="flex items-center gap-0.5 pl-2 border-l border-slate-200">
                            <button
                              type="button"
                              title="Pan Back"
                              disabled={clampedPan >= maxPanOffset}
                              onClick={() => setPanOffset((p) => Math.min(maxPanOffset, p + 8))}
                              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Pan Forward"
                              disabled={clampedPan <= 0}
                              onClick={() => setPanOffset((p) => Math.max(0, p - 8))}
                              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            {clampedPan > 0 && (
                              <button
                                type="button"
                                onClick={() => setPanOffset(0)}
                                className="px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-blue-50 rounded"
                              >
                                Live
                              </button>
                            )}
                          </div>

                          {activeTool !== 'CROSSHAIR' && (
                            <span className="text-blue-600 font-medium pl-2 border-l border-slate-200">
                              {activeTool === 'HLINE'
                                ? 'Click chart to place S/R level'
                                : activeTool === 'TREND'
                                ? draftPoint
                                  ? 'Click 2nd point for Trendline'
                                  : 'Click 1st point for Trendline'
                                : draftPoint
                                ? 'Click 2nd point to Measure'
                                : 'Click 1st point to Measure'}
                            </span>
                          )}
                        </div>
                        <div className="font-mono-tabular text-slate-600">
                          <UtcLiveClock />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {chartViewTab === 'OVERVIEW' && (
                  <div className="p-6 space-y-4 text-xs">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {pair.name} ({pair.base_asset}) Market Summary
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                      <div>
                        <div className="text-slate-500">Spot Pair</div>
                        <div className="mt-1 font-semibold text-slate-900">{pair.symbol}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Live Mark Price</div>
                        <div className="mt-1 font-mono-tabular font-semibold text-slate-900">
                          ${formatUsd(pair.current_price, priceDecimals)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Spread (bps)</div>
                        <div className="mt-1 font-mono-tabular text-blue-600">{pair.spread_bps} bps</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Best Bid</div>
                        <div className="mt-1 font-mono-tabular text-emerald-600">${formatUsd(pair.bid, priceDecimals)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Best Ask</div>
                        <div className="mt-1 font-mono-tabular text-red-600">${formatUsd(pair.ask, priceDecimals)}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Settlement Currency</div>
                        <div className="mt-1 font-semibold text-slate-900">USDT (Live Feed)</div>
                      </div>
                    </div>
                  </div>
                )}

                {chartViewTab === 'DEPTH' && (
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">Interactive Order Depth</span>
                      <span className="font-mono-tabular text-slate-500">
                        Bids <strong className="text-emerald-600">{orderBook.bidRatio}%</strong> · Asks{' '}
                        <strong className="text-red-600">{orderBook.askRatio}%</strong>
                      </span>
                    </div>

                    {/* Cumulative Bid/Ask Depth Area Graph with Hover Inspection */}
                    {(() => {
                      const depthBids = [...orderBook.bids].sort((a, b) => a.price - b.price);
                      const depthAsks = [...orderBook.asks].sort((a, b) => a.price - b.price);
                      const maxDepth = Math.max(
                        1,
                        ...depthBids.map((b) => b.total),
                        ...depthAsks.map((a) => a.total)
                      );
                      const dw = 640;
                      const dh = 180;
                      const halfW = dw / 2 - 6;

                      const bidPointsData = depthBids.map((b, i) => ({
                        x: depthBids.length <= 1 ? halfW : (i / (depthBids.length - 1)) * halfW,
                        y: dh - 18 - (b.total / maxDepth) * (dh - 34),
                        price: b.price,
                        total: b.total,
                        side: 'BID' as const,
                      }));

                      const askPointsData = depthAsks.map((a, i) => ({
                        x: dw / 2 + 6 + (depthAsks.length <= 1 ? 0 : (i / (depthAsks.length - 1)) * halfW),
                        y: dh - 18 - (a.total / maxDepth) * (dh - 34),
                        price: a.price,
                        total: a.total,
                        side: 'ASK' as const,
                      }));

                      const allDepthPts = [...bidPointsData, ...askPointsData];
                      const hoveredDepth =
                        depthHoverX !== null && allDepthPts.length > 0
                          ? allDepthPts.reduce((best, p) =>
                              Math.abs(p.x - depthHoverX) < Math.abs(best.x - depthHoverX) ? p : best
                            )
                          : null;

                      const bidPts = bidPointsData.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
                      const askPts = askPointsData.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);

                      return (
                        <div className="border border-slate-200 rounded-xl bg-slate-50/40 p-2.5">
                          <svg
                            ref={depthSvgRef}
                            viewBox={`0 0 ${dw} ${dh}`}
                            className="w-full h-44 cursor-crosshair select-none"
                            onMouseMove={(e) => {
                              if (!depthSvgRef.current) return;
                              const rect = depthSvgRef.current.getBoundingClientRect();
                              if (rect.width <= 0) return;
                              setDepthHoverX(((e.clientX - rect.left) / rect.width) * dw);
                            }}
                            onMouseLeave={() => setDepthHoverX(null)}
                          >
                            <line x1={dw / 2} y1="6" x2={dw / 2} y2={dh - 18} stroke="#cbd5e1" strokeDasharray="3 3" />
                            {bidPts.length > 0 && (
                              <>
                                <polygon
                                  fill="#0ECB81"
                                  fillOpacity="0.16"
                                  points={`0,${dh - 18} ${bidPts.join(' ')} ${halfW},${dh - 18}`}
                                />
                                <polyline fill="none" stroke="#0ECB81" strokeWidth="2" points={bidPts.join(' ')} />
                              </>
                            )}
                            {askPts.length > 0 && (
                              <>
                                <polygon
                                  fill="#F6465D"
                                  fillOpacity="0.16"
                                  points={`${dw / 2 + 6},${dh - 18} ${askPts.join(' ')} ${dw},${dh - 18}`}
                                />
                                <polyline fill="none" stroke="#F6465D" strokeWidth="2" points={askPts.join(' ')} />
                              </>
                            )}
                            {hoveredDepth && (
                              <g pointerEvents="none">
                                <line
                                  x1={hoveredDepth.x}
                                  y1="6"
                                  x2={hoveredDepth.x}
                                  y2={dh - 18}
                                  stroke="#64748b"
                                  strokeDasharray="3 3"
                                />
                                <circle
                                  cx={hoveredDepth.x}
                                  cy={hoveredDepth.y}
                                  r="4"
                                  fill={hoveredDepth.side === 'BID' ? '#059669' : '#e11d48'}
                                  stroke="#ffffff"
                                  strokeWidth="1.5"
                                />
                                <rect
                                  x={Math.max(4, Math.min(dw - 154, hoveredDepth.x - 75))}
                                  y="6"
                                  width="150"
                                  height="20"
                                  rx="4"
                                  fill="#0f172a"
                                />
                                <text
                                  x={Math.max(79, Math.min(dw - 79, hoveredDepth.x))}
                                  y="19"
                                  textAnchor="middle"
                                  fontSize="9"
                                  fontWeight="600"
                                  fill="#ffffff"
                                  fontFamily="JetBrains Mono, monospace"
                                >
                                  ${formatUsd(hoveredDepth.price, priceDecimals)} · {hoveredDepth.total.toFixed(qtyDecimals)}
                                </text>
                              </g>
                            )}
                            <text
                              x={dw / 2}
                              y={dh - 4}
                              textAnchor="middle"
                              fontSize="9.5"
                              fill="#475569"
                              fontFamily="JetBrains Mono, monospace"
                            >
                              Mid ${formatUsd(pair.current_price, priceDecimals)}
                            </text>
                          </svg>
                        </div>
                      );
                    })()}

                    <div className="grid grid-cols-2 gap-4 text-xs font-mono-tabular">
                      <div className="space-y-1">
                        <div className="text-emerald-600 font-semibold mb-2">Buy Liquidity (Bids)</div>
                        {orderBook.bids.slice(0, 6).map((b, i) => (
                          <div key={i} className="flex items-center justify-between py-1 px-2 bg-emerald-50/70 rounded">
                            <span className="text-emerald-700">${formatUsd(b.price, priceDecimals)}</span>
                            <span className="text-slate-700">{b.total.toFixed(qtyDecimals)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1">
                        <div className="text-red-600 font-semibold mb-2">Sell Liquidity (Asks)</div>
                        {orderBook.asks.slice(-6).reverse().map((a, i) => (
                          <div key={i} className="flex items-center justify-between py-1 px-2 bg-red-50/70 rounded">
                            <span className="text-red-700">${formatUsd(a.price, priceDecimals)}</span>
                            <span className="text-slate-700">{a.total.toFixed(qtyDecimals)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* MIDDLE COLUMN: COMPACT ORDER BOOK & RECENT TRADES */}
              <div className="min-w-0 border border-slate-200 rounded-xl bg-white flex flex-col overflow-hidden">
                {/* Tabs: Order Book | Recent Trades */}
                <div className="px-2.5 h-10 border-b border-slate-200 flex items-center gap-3.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setCenterBookTab('ORDER_BOOK')}
                    className={`h-10 border-b-2 font-semibold transition-colors whitespace-nowrap ${
                      centerBookTab === 'ORDER_BOOK'
                        ? 'border-blue-600 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Order Book
                  </button>
                  <button
                    type="button"
                    onClick={() => setCenterBookTab('RECENT_TRADES')}
                    className={`h-10 border-b-2 font-semibold transition-colors whitespace-nowrap ${
                      centerBookTab === 'RECENT_TRADES'
                        ? 'border-blue-600 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Recent Trades
                  </button>
                </div>

                {centerBookTab === 'ORDER_BOOK' ? (
                  <div className="flex-1 flex flex-col justify-between">
                    {/* Controls: All/Bids/Asks & Step Precision */}
                    <div className="px-2.5 py-2 border-b border-slate-100 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-0.5">
                        {(['BOTH', 'BIDS', 'ASKS'] as BookFilter[]).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setBookFilter(f)}
                            className={`px-1.5 py-0.5 text-[11px] font-medium rounded ${
                              bookFilter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            {f === 'BOTH' ? 'All' : f === 'BIDS' ? 'Buy' : 'Sell'}
                          </button>
                        ))}
                      </div>

                      <SelectDropdown
                        value={priceStepMultiplier}
                        onChange={(val) => setPriceStepMultiplier(val)}
                        align="right"
                        options={[
                          { value: 1 as const, label: '0.1' },
                          { value: 5 as const, label: '0.5' },
                          { value: 10 as const, label: '1.0' },
                        ]}
                        buttonClassName="h-6 px-2 text-[11px] font-mono-tabular bg-slate-50 border border-slate-200 rounded text-slate-700 hover:bg-slate-100"
                        menuClassName="w-20 font-mono-tabular"
                      />
                    </div>

                    <div className="px-2.5 py-1.5 grid grid-cols-3 text-[10px] font-medium text-slate-400">
                      <span className="truncate">Price(USDT)</span>
                      <span className="text-right truncate">Qty({pair.base_asset})</span>
                      <span className="text-right truncate">Total({pair.base_asset})</span>
                    </div>

                    {/* ASKS */}
                    {bookFilter !== 'BIDS' && (
                      <div className="text-[10.5px] font-mono-tabular">
                        {orderBook.asks.map((row, idx) => (
                          <button
                            key={`ask-${idx}`}
                            type="button"
                            onClick={() => handleSelectBookPrice(row.price)}
                            className="w-full relative px-2.5 py-1 grid grid-cols-3 items-center text-left hover:bg-slate-50"
                          >
                            <span
                              className="absolute right-0 top-0 bottom-0 bg-red-50 pointer-events-none"
                              style={{ width: `${row.depthPct}%` }}
                            />
                            <span className="relative text-red-600 font-medium truncate">
                              {formatUsd(row.price, priceDecimals)}
                            </span>
                            <span className="relative text-right text-slate-700 truncate">{row.qty.toFixed(bookQtyDecimals)}</span>
                            <span className="relative text-right text-slate-500 truncate">{row.total.toFixed(bookQtyDecimals)}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* MIDDLE LIVE PRICE LINE */}
                    <div className="px-2.5 py-1.5 my-0.5 border-y border-slate-100 bg-slate-50/70 flex items-center justify-between gap-1">
                      <span
                        className={`text-xs font-bold font-mono-tabular whitespace-nowrap ${
                          pair.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {formatUsd(pair.current_price, priceDecimals)}
                      </span>
                      <span className="text-[10px] font-mono-tabular text-slate-500 whitespace-nowrap truncate">
                        ≈${formatUsd(pair.current_price, priceDecimals)}
                      </span>
                    </div>

                    {/* BIDS */}
                    {bookFilter !== 'ASKS' && (
                      <div className="text-[10.5px] font-mono-tabular">
                        {orderBook.bids.map((row, idx) => (
                          <button
                            key={`bid-${idx}`}
                            type="button"
                            onClick={() => handleSelectBookPrice(row.price)}
                            className="w-full relative px-2.5 py-1 grid grid-cols-3 items-center text-left hover:bg-slate-50"
                          >
                            <span
                              className="absolute right-0 top-0 bottom-0 bg-emerald-50 pointer-events-none"
                              style={{ width: `${row.depthPct}%` }}
                            />
                            <span className="relative text-emerald-600 font-medium truncate">
                              {formatUsd(row.price, priceDecimals)}
                            </span>
                            <span className="relative text-right text-slate-700 truncate">{row.qty.toFixed(bookQtyDecimals)}</span>
                            <span className="relative text-right text-slate-500 truncate">{row.total.toFixed(bookQtyDecimals)}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* BOTTOM B / S SENTIMENT RATIO BAR (Matching screenshot bottom of Order Book) */}
                    <div className="px-2.5 py-2 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[10.5px] font-mono-tabular mb-1">
                        <span className="text-emerald-600 font-semibold">B {orderBook.bidRatio}%</span>
                        <span className="text-red-600 font-semibold">{orderBook.askRatio}% S</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100">
                        <div className="bg-emerald-500 h-full" style={{ width: `${orderBook.bidRatio}%` }} />
                        <div className="bg-red-500 h-full" style={{ width: `${orderBook.askRatio}%` }} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <div className="px-2.5 py-2 grid grid-cols-3 text-[10px] font-medium text-slate-400 border-b border-slate-100">
                      <span className="truncate">Price(USDT)</span>
                      <span className="text-right truncate">Qty({pair.base_asset})</span>
                      <span className="text-right truncate">Time</span>
                    </div>
                    <div className="divide-y divide-transparent py-1 text-[10.5px] font-mono-tabular overflow-y-auto">
                      {recentTrades.map((tr) => (
                        <div key={tr.id} className="px-2.5 py-1.5 grid grid-cols-3 items-center">
                          <span className={tr.isBuy ? 'text-emerald-600 font-medium' : 'text-red-600 font-medium'}>
                            {formatUsd(tr.price, priceDecimals)}
                          </span>
                          <span className="text-right text-slate-700">{tr.qty.toFixed(bookQtyDecimals)}</span>
                          <span className="text-right text-slate-400">{tr.timeStr}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* MOBILE CHART QUICK HOLDING & BUY/SELL CTA BAR (Matches mobile reference Screen 3) */}
            <div className="lg:hidden space-y-2.5">
              <div className="bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <CryptoIcon symbol={pair.base_asset} size="md" />
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-slate-500">
                      {availableCoin > 0 ? `Your ${pair.base_asset} Balance` : 'Available USDT Balance'}
                    </div>
                    <div className="text-sm font-bold font-mono-tabular text-slate-900 truncate">
                      {availableCoin > 0
                        ? `${availableCoin.toFixed(qtyDecimals)} ${pair.base_asset}`
                        : `$${formatUsd(effectiveMainBalance)} USDT`}
                    </div>
                  </div>
                </div>
                {availableCoin > 0 && currentHolding ? (
                  (() => {
                    const costBasis = Number((availableCoin * Number(currentHolding.avg_entry_price || 0)).toFixed(2));
                    const curVal = Number((availableCoin * pair.current_price).toFixed(2));
                    const pnl = Number((curVal - costBasis).toFixed(2));
                    return (
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold font-mono-tabular text-slate-900">
                          ${formatUsd(curVal)}
                        </div>
                        <div className={`text-[11px] font-mono-tabular font-semibold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {pnl >= 0 ? `+$${formatUsd(pnl)}` : `-$${formatUsd(Math.abs(pnl))}`}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-slate-400">24H Range</div>
                    <div className="text-[11px] font-mono-tabular font-medium text-slate-700">
                      ${formatUsd(low24h, priceDecimals)} – ${formatUsd(high24h, priceDecimals)}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setSide('BUY');
                    setPriceInput(pair.ask.toFixed(priceDecimals));
                    setMobilePanel('TRADE');
                  }}
                  className="min-h-[46px] rounded-xl bg-[#047857] hover:bg-[#065F46] text-white text-sm font-bold transition-colors"
                >
                  Buy {pair.base_asset}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSide('SELL');
                    setPriceInput(pair.bid.toFixed(priceDecimals));
                    setMobilePanel('TRADE');
                  }}
                  className="min-h-[46px] rounded-xl bg-[#F6465D] hover:bg-[#E03B52] text-white text-sm font-bold transition-colors"
                >
                  Sell {pair.base_asset}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT 3-COLUMN BINANCE-STANDARD TRADE ORDER TICKET */}
          <form
            onSubmit={handleSubmitOrder}
            className={`${mobilePanel === 'TRADE' ? 'flex' : 'hidden lg:flex'} xl:col-span-3 border border-slate-200 rounded-xl bg-white p-3.5 flex-col gap-3`}
          >
            {(() => {
              const isBuy = side === 'BUY';
              const numericVal = Math.max(0, Number(orderValueInput || 0));
              const numericQty = Math.max(0, Number(qtyInput || 0));
              const isMakerPreview = tradeMode === 'SPOT' && orderType !== 'MARKET';
              const feeRate = isMakerPreview ? makerRate : takerRate;
              const estFeeUsd = Number((numericVal * feeRate).toFixed(2));
              const estBuyReceiveQty =
                activeQuotePrice > 0 && numericVal > 0
                  ? Math.max(0, numericVal - estFeeUsd) / activeQuotePrice
                  : Math.max(0, numericQty * (1 - feeRate));
              const focusRing = isBuy
                ? 'focus-within:border-[#047857] focus-within:bg-white'
                : 'focus-within:border-[#F6465D] focus-within:bg-white';
              const noSpinInput =
                'bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';
              const accentText = isBuy ? 'text-[#047857]' : 'text-[#F6465D]';
              const accentBg = isBuy ? 'bg-[#047857]' : 'bg-[#F6465D]';

              return (
                <>
                  {/* Mode Header Tabs: Spot | 5x Margin */}
                  <div className="flex items-center justify-between border-b border-slate-200">
                    <div className="flex items-center gap-4 text-xs">
                      <button
                        type="button"
                        onClick={() => setTradeMode('SPOT')}
                        className={`pb-2 border-b-2 font-semibold transition-colors whitespace-nowrap ${
                          tradeMode === 'SPOT'
                            ? 'border-[#F0B90B] text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        Spot
                      </button>
                      <button
                        type="button"
                        onClick={() => setTradeMode('POSITION')}
                        className={`pb-2 border-b-2 font-semibold transition-colors whitespace-nowrap ${
                          tradeMode === 'POSITION'
                            ? 'border-[#F0B90B] text-slate-900'
                            : 'border-transparent text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        5x Margin
                      </button>
                    </div>
                    <span className="pb-2 text-[10px] font-mono-tabular font-semibold text-slate-400">
                      {isMakerPreview ? `Maker ${makerPct.toFixed(2)}%` : `Taker ${takerPct.toFixed(2)}%`}
                    </span>
                  </div>

                  {/* Binance Buy / Sell Sharp Segmented Toggle */}
                  <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F1F5F9] rounded-md">
                    <button
                      type="button"
                      onClick={() => {
                        setSide('BUY');
                        setPriceInput(pair.ask.toFixed(priceDecimals));
                      }}
                      className={`h-8 text-xs font-bold rounded transition-colors whitespace-nowrap ${
                        isBuy
                          ? 'bg-[#047857] text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {tradeMode === 'SPOT' ? `Buy ${pair.base_asset}` : 'Long 5x'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSide('SELL');
                        setPriceInput(pair.bid.toFixed(priceDecimals));
                      }}
                      className={`h-8 text-xs font-bold rounded transition-colors whitespace-nowrap ${
                        !isBuy
                          ? 'bg-[#F6465D] text-white shadow-xs'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {tradeMode === 'SPOT' ? `Sell ${pair.base_asset}` : 'Short 5x'}
                    </button>
                  </div>

                  {/* Order Type Underline Sub-Tabs */}
                  {tradeMode === 'SPOT' && (
                    <div className="flex items-center gap-4 text-xs border-b border-slate-100">
                      {(
                        [
                          ['LIMIT', 'Limit'],
                          ['MARKET', 'Market'],
                          ['TPSL', 'TP/SL'],
                        ] as [OrderType, string][]
                      ).map(([t, label]) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setOrderType(t);
                            if (t === 'TPSL') setEnableTpSl(true);
                          }}
                          className={`pb-1.5 border-b-2 text-xs font-medium transition-colors whitespace-nowrap ${
                            orderType === t
                              ? `border-[#F0B90B] text-slate-900 font-semibold`
                              : 'border-transparent text-slate-500 hover:text-slate-900'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Avbl Row (Binance Style) */}
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-medium">Avbl</span>
                    <button
                      type="button"
                      onClick={() => applySliderPercentage(100)}
                      className="inline-flex items-center gap-1 font-mono-tabular font-semibold text-slate-900 hover:text-blue-600 transition-colors"
                      title="Click to use 100% available balance"
                    >
                      <span>
                        {tradeMode === 'SPOT' && !isBuy
                          ? `${availableCoin.toFixed(qtyDecimals)} ${pair.base_asset}`
                          : `${formatUsd(effectiveMainBalance)} USDT`}
                      </span>
                      <Plus className="w-3 h-3 text-[#F0B90B]" />
                    </button>
                  </div>

                  {/* Uniform Input Fields Stack */}
                  <div className="space-y-2">
                    {/* 1. Price Row */}
                    <div
                      className={`h-9 rounded-md border border-slate-200 bg-[#F8FAFC] px-2.5 flex items-center justify-between gap-2 transition-colors ${
                        orderType === 'MARKET' || tradeMode === 'POSITION' ? 'bg-slate-100/80' : focusRing
                      }`}
                    >
                      <span className="text-[11px] font-medium text-slate-500 shrink-0">Price</span>
                      {orderType === 'MARKET' || tradeMode === 'POSITION' ? (
                        <div className="flex items-center justify-end gap-1.5 flex-1 min-w-0">
                          <span className="text-xs font-mono-tabular font-semibold text-slate-500 truncate">
                            Market Price (≈ {formatUsd(isBuy ? pair.ask : pair.bid, priceDecimals)})
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="number"
                            step="any"
                            value={priceInput}
                            onChange={(e) => handlePriceInputChange(e.target.value)}
                            className={`w-full text-right text-xs font-mono-tabular font-semibold text-slate-900 ${noSpinInput}`}
                          />
                          <button
                            type="button"
                            onClick={() => handlePriceInputChange(pair.current_price.toFixed(priceDecimals))}
                            className="text-[10px] font-semibold text-blue-600 hover:underline shrink-0"
                            title="Fill Last Price"
                          >
                            Last
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handlePriceInputChange((isBuy ? pair.ask : pair.bid).toFixed(priceDecimals))
                            }
                            className="text-[10px] font-semibold text-slate-500 hover:text-slate-900 hover:underline shrink-0"
                            title="Fill Best Bid/Ask"
                          >
                            BBO
                          </button>
                          <span className="text-[11px] font-semibold text-slate-600 shrink-0">USDT</span>
                        </div>
                      )}
                    </div>

                    {/* 2. Amount Row (Spot Mode) */}
                    {tradeMode === 'SPOT' && (
                      <div
                        className={`h-9 rounded-md border border-slate-200 bg-[#F8FAFC] px-2.5 flex items-center justify-between gap-2 transition-colors ${focusRing}`}
                      >
                        <span className="text-[11px] font-medium text-slate-500 shrink-0">Amount</span>
                        <input
                          type="number"
                          step="any"
                          placeholder="0.00"
                          value={qtyInput}
                          onChange={(e) => {
                            setSliderPct(0);
                            handleQtyChange(e.target.value);
                          }}
                          className={`w-full text-right text-xs font-mono-tabular font-semibold text-slate-900 ${noSpinInput}`}
                        />
                        <span className="text-[11px] font-semibold text-slate-600 shrink-0">{pair.base_asset}</span>
                      </div>
                    )}

                    {/* 3. Binance Diamond-Node Percentage Slider */}
                    <div className="pt-1 pb-0.5 px-0.5 space-y-1.5">
                      <div className="relative h-3.5 flex items-center">
                        <div className="w-full h-[2px] bg-slate-200 relative">
                          <div
                            className={`h-full transition-all duration-150 ${accentBg}`}
                            style={{ width: `${Math.min(100, Math.max(0, sliderPct))}%` }}
                          />
                          {[0, 25, 50, 75, 100].map((mark) => {
                            const reached = sliderPct >= mark;
                            return (
                              <span
                                key={mark}
                                className={`w-2 h-2 rotate-45 rounded-[1px] border absolute top-1/2 -translate-y-1/2 -translate-x-1/2 pointer-events-none transition-colors ${
                                  reached
                                    ? isBuy
                                      ? 'bg-[#047857] border-[#047857]'
                                      : 'bg-[#F6465D] border-[#F6465D]'
                                    : 'bg-white border-slate-300'
                                }`}
                                style={{ left: `${mark}%` }}
                              />
                            );
                          })}
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={sliderPct}
                          onChange={(e) => applySliderPercentage(Number(e.target.value))}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          aria-label="Allocation percentage"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono-tabular">
                        {[0, 25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => applySliderPercentage(pct)}
                            className={`font-medium transition-colors ${
                              sliderPct === pct ? `${accentText} font-semibold` : 'text-slate-400 hover:text-slate-700'
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 4. Total / Margin Row (Uniform Single-Row Binance Input) */}
                    <div
                      className={`h-9 rounded-md border border-slate-200 bg-[#F8FAFC] px-2.5 flex items-center justify-between gap-2 transition-colors ${focusRing}`}
                    >
                      <span className="text-[11px] font-medium text-slate-500 shrink-0">
                        {tradeMode === 'SPOT' ? 'Total' : 'Margin'}
                      </span>
                      <input
                        type="number"
                        step="any"
                        placeholder="Min 5.00"
                        value={orderValueInput}
                        onChange={(e) => {
                          setSliderPct(0);
                          handleOrderValueChange(e.target.value);
                        }}
                        className={`w-full text-right text-xs font-mono-tabular font-semibold text-slate-900 ${noSpinInput}`}
                      />
                      <span className="text-[11px] font-semibold text-slate-600 shrink-0">USDT</span>
                    </div>
                  </div>

                  {/* TP/SL & Post-Only Options */}
                  <div className="space-y-2 text-[11px]">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={enableTpSl}
                          onChange={(e) => setEnableTpSl(e.target.checked)}
                          className="rounded border-slate-300 accent-slate-800"
                        />
                        <span>TP/SL</span>
                      </label>
                      {tradeMode === 'SPOT' && (
                        <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={postOnly}
                            onChange={(e) => setPostOnly(e.target.checked)}
                            className="rounded border-slate-300 accent-slate-800"
                          />
                          <span>Post-Only</span>
                        </label>
                      )}
                    </div>
                    {enableTpSl && (
                      <div className="grid grid-cols-2 gap-1.5">
                        <input
                          type="number"
                          step="any"
                          placeholder="TP Price ($)"
                          value={tpPrice}
                          onChange={(e) => setTpPrice(e.target.value)}
                          className={`h-8 px-2 text-xs font-mono-tabular border border-slate-200 bg-[#F8FAFC] rounded-md focus:border-[#047857] ${noSpinInput}`}
                        />
                        <input
                          type="number"
                          step="any"
                          placeholder="SL Price ($)"
                          value={slPrice}
                          onChange={(e) => setSlPrice(e.target.value)}
                          className={`h-8 px-2 text-xs font-mono-tabular border border-slate-200 bg-[#F8FAFC] rounded-md focus:border-[#F6465D] ${noSpinInput}`}
                        />
                      </div>
                    )}
                  </div>

                  {/* Clean Binance Summary Breakdown Anchored Above CTA */}
                  <div className="border-t border-slate-100 pt-2.5 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">{isBuy ? 'Max Buy' : 'Max Sell'}</span>
                      <span className="font-mono-tabular font-semibold text-slate-800">
                        {isBuy
                          ? `${maxBuyCoin.toFixed(qtyDecimals)} ${pair.base_asset}`
                          : `${formatUsd(availableCoin * pair.bid)} USDT`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">
                        {tradeMode === 'POSITION' ? '5x Notional' : isBuy ? 'Est. Receive' : 'Est. Proceeds'}
                      </span>
                      <span className="font-mono-tabular font-semibold text-slate-800">
                        {tradeMode === 'POSITION'
                          ? `${formatUsd(numericVal * 5)} USDT`
                          : isBuy
                          ? `${estBuyReceiveQty.toFixed(qtyDecimals)} ${pair.base_asset}`
                          : `${formatUsd(Math.max(0, numericVal - estFeeUsd))} USDT`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-500">
                        Est. Fee ({isMakerPreview ? `${makerPct.toFixed(2)}%` : `${takerPct.toFixed(2)}%`})
                      </span>
                      <span className="font-mono-tabular text-slate-700">${formatUsd(estFeeUsd)}</span>
                    </div>
                  </div>

                  {/* Binance Primary Execution CTA Button */}
                  <button
                    type="submit"
                    disabled={busy}
                    className={`w-full h-10 text-white text-sm font-bold rounded-md transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5 ${
                      isBuy ? 'bg-[#047857] hover:bg-[#065F46]' : 'bg-[#F6465D] hover:bg-[#E03B52]'
                    }`}
                  >
                    <span>
                      {busy
                        ? 'Submitting...'
                        : tradeMode === 'SPOT'
                        ? `${isBuy ? 'Buy' : 'Sell'} ${pair.base_asset}`
                        : `Open ${isBuy ? 'Long' : 'Short'} ${pair.base_asset}`}
                    </span>
                    {!busy && numericVal > 0 && (
                      <span className="text-xs font-mono-tabular opacity-90">
                        · ${formatUsd(numericVal)}
                      </span>
                    )}
                  </button>

                  {/* Binance-Style Assets Footer */}
                  <div className="mt-auto pt-3 border-t border-slate-100 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">Assets</span>
                      <span className="text-[10px] font-mono-tabular text-slate-400">
                        {pair.base_asset}/USDT
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">USDT Available</span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {formatUsd(effectiveMainBalance)} USDT
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">{pair.base_asset} Available</span>
                      <span className="font-mono-tabular font-semibold text-slate-900">
                        {availableCoin.toFixed(qtyDecimals)} {pair.base_asset}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">In Orders / Escrow</span>
                      <span className="font-mono-tabular text-slate-700">
                        ${formatUsd(user.locked_balance)}
                      </span>
                    </div>
                  </div>
                  {/* Mobile Orders Jump Link */}
                  <button
                    type="button"
                    onClick={() => setMobilePanel('ORDERS')}
                    className="lg:hidden mt-1 w-full py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    View Open Orders &amp; Holdings ({openOrders.length + activeHoldings.length})
                  </button>
                </>
              );
            })()}
          </form>
        </div>
      )}

      {/* BOTTOM FULL-WIDTH ORDERS & FUNDS DOCK */}
      <div className={`${mobilePanel === 'ORDERS' ? 'block' : 'hidden lg:block'} border border-slate-200 rounded-xl bg-white overflow-hidden`}>
        <div className="px-4 border-b border-slate-200 flex items-center justify-between overflow-x-auto">
          <div className="flex items-center gap-6">
            {(
              [
                ['OPEN_ORDERS', `Open Orders (${openOrders.length + activeHoldings.length})`],
                ['ORDER_HISTORY', `Order History (${historyOrders.length})`],
                ['FUNDS', 'Funds'],
              ] as [BottomDockTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setBottomTab(key)}
                className={`py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  bottomTab === key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {bottomTab === 'OPEN_ORDERS' && (
            <>
              <div className="md:hidden divide-y divide-slate-100">
                {openOrders.length === 0 && activeHoldings.length === 0 ? (
                  <div className="py-10 px-4 text-center text-xs text-slate-500">
                    No active positions, spot holdings, or open limit orders.
                  </div>
                ) : (
                  <>
                    {openOrders.map((t) => {
                      const isPos = t.order_mode === 'POSITION';
                      const m = markets.find((x) => x.symbol === t.symbol);
                      const entryP = Number(t.limit_price || t.entry_price || 0);
                      const liveP = m ? m.current_price : entryP;
                      const pDec = getPriceDecimals(entryP || liveP);
                      const qDec = getQtyDecimals(entryP || liveP);
                      const baseAsset = t.symbol.split('/')[0] || '';
                      const pnl = isPos ? computeLivePnl(t) : 0;
                      const pnlPct = t.amount_usd > 0 ? (pnl / t.amount_usd) * 100 : 0;
                      const currentValue = isPos ? Math.max(0, t.amount_usd + pnl) : t.amount_usd;
                      const isBusyRow = closingId === t.id;

                      return (
                        <div key={`m-ord-${t.id}`} className="p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(t.symbol);
                                setMobilePanel('CHART');
                              }}
                              className="flex items-center gap-2 text-left"
                            >
                              <CryptoIcon symbol={baseAsset} size="sm" />
                              <div>
                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                  <span>{t.symbol}</span>
                                  <span className={t.side === 'BUY' || t.side === 'LONG' ? 'text-emerald-600' : 'text-red-600'}>
                                    {t.side === 'BUY' || t.side === 'LONG' ? 'BUY' : 'SELL'}
                                  </span>
                                </div>
                                <div className="text-[11px] font-mono-tabular text-slate-400">
                                  {formatDateTime(t.created_at)}
                                </div>
                              </div>
                            </button>
                            <div className="text-right font-mono-tabular">
                              <div className="text-xs font-bold text-slate-900">${formatUsd(currentValue)}</div>
                              {isPos ? (
                                <div className={`text-[11px] font-semibold ${pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {pnl >= 0 ? `+$${formatUsd(pnl)}` : `-$${formatUsd(Math.abs(pnl))}`} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                                </div>
                              ) : (
                                <div className="text-[11px] text-amber-600 font-medium">Pending Limit</div>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-[11px] bg-slate-50 rounded-xl p-2 font-mono-tabular">
                            <div>
                              <div className="text-slate-400 text-[10px]">Entry</div>
                              <div className="font-semibold text-slate-800">${formatUsd(entryP, pDec)}</div>
                            </div>
                            <div>
                              <div className="text-slate-400 text-[10px]">Live</div>
                              <div className="font-semibold text-slate-800">${formatUsd(liveP, pDec)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-slate-400 text-[10px]">Qty</div>
                              <div className="font-semibold text-slate-800">{t.quantity.toFixed(qDec)}</div>
                            </div>
                          </div>

                          {isPos ? (
                            <button
                              type="button"
                              disabled={isBusyRow}
                              onClick={() => handleClosePosition(t.id)}
                              className={`w-full min-h-[38px] text-white text-xs font-semibold rounded-xl disabled:opacity-60 ${
                                pnl >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                              }`}
                            >
                              {isBusyRow ? 'Closing...' : `Close (${pnl >= 0 ? '+' : '-'}$${formatUsd(Math.abs(pnl))})`}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusyRow}
                              onClick={() => handleCancelLimit(t.id)}
                              className="w-full min-h-[38px] border border-slate-200 text-slate-700 text-xs font-semibold rounded-xl disabled:opacity-60"
                            >
                              {isBusyRow ? 'Cancelling...' : 'Cancel Limit Order'}
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {activeHoldings.map((h) => {
                      const m = markets.find((x) => x.base_asset === h.asset);
                      const sym = m ? m.symbol : `${h.asset}/USDT`;
                      const entryP = Number(h.avg_entry_price || 0);
                      const livePrice = m ? m.current_price : entryP;
                      const pDec = getPriceDecimals(livePrice || entryP);
                      const qDec = getQtyDecimals(livePrice || entryP);
                      const costBasis = Number((Number(h.quantity) * entryP).toFixed(2));
                      const currentValue = Number((Number(h.quantity) * livePrice).toFixed(2));
                      const livePnl = Number((currentValue - costBasis).toFixed(2));
                      const pnlPct = costBasis > 0 ? (livePnl / costBasis) * 100 : 0;
                      const isBusyRow = closingId === `HOLDING:${h.asset}`;

                      return (
                        <div key={`m-hold-${h.asset}`} className="p-3.5 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSymbol(sym);
                                setMobilePanel('CHART');
                              }}
                              className="flex items-center gap-2 text-left"
                            >
                              <CryptoIcon symbol={h.asset} size="sm" />
                              <div>
                                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                                  <span>{sym}</span>
                                  <span className="text-emerald-600">SPOT</span>
                                </div>
                                <div className="text-[11px] font-mono-tabular text-slate-400">
                                  {Number(h.quantity).toFixed(qDec)} {h.asset} · Cost ${formatUsd(costBasis)}
                                </div>
                              </div>
                            </button>
                            <div className="text-right font-mono-tabular">
                              <div className="text-xs font-bold text-slate-900">${formatUsd(currentValue)}</div>
                              <div className={`text-[11px] font-semibold ${livePnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {livePnl >= 0 ? `+$${formatUsd(livePnl)}` : `-$${formatUsd(Math.abs(livePnl))}`} ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-50 rounded-xl p-2 font-mono-tabular">
                            <div>
                              <div className="text-slate-400 text-[10px]">Avg Entry</div>
                              <div className="font-semibold text-slate-800">${formatUsd(entryP, pDec)}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-slate-400 text-[10px]">Live Mark</div>
                              <div className={`font-semibold ${livePrice >= entryP ? 'text-emerald-600' : 'text-red-600'}`}>
                                ${formatUsd(livePrice, pDec)}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isBusyRow}
                            onClick={() => handleCloseSpotHolding(h.asset)}
                            className={`w-full min-h-[38px] text-white text-xs font-semibold rounded-xl disabled:opacity-60 ${
                              livePnl >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                            }`}
                          >
                            {isBusyRow
                              ? 'Closing...'
                              : `Close Spot (${livePnl >= 0 ? '+' : '-'}$${formatUsd(Math.abs(livePnl))})`}
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              <table className="hidden md:table w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-3.5">Date</th>
                  <th className="py-2.5 px-3.5">Pair</th>
                  <th className="py-2.5 px-3.5">Side</th>
                  <th className="py-2.5 px-3.5 text-right">Entry Price</th>
                  <th className="py-2.5 px-3.5 text-right">Live Price</th>
                  <th className="py-2.5 px-3.5 text-right">Amount</th>
                  <th className="py-2.5 px-3.5 text-right">Current Value</th>
                  <th className="py-2.5 px-3.5 text-right">Live P&amp;L</th>
                  <th className="py-2.5 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {openOrders.length === 0 && activeHoldings.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-slate-500">
                      No active positions, spot holdings, or open limit orders.
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* 1. Open Positions & Pending Limit Orders */}
                    {openOrders.map((t) => {
                      const isPos = t.order_mode === 'POSITION';
                      const m = markets.find((x) => x.symbol === t.symbol);
                      const entryP = Number(t.limit_price || t.entry_price || 0);
                      const liveP = m ? m.current_price : entryP;
                      const pDec = getPriceDecimals(entryP || liveP);
                      const qDec = getQtyDecimals(entryP || liveP);
                      const baseAsset = t.symbol.split('/')[0] || '';
                      const pnl = isPos ? computeLivePnl(t) : 0;
                      const pnlPct = t.amount_usd > 0 ? (pnl / t.amount_usd) * 100 : 0;
                      const currentValue = isPos ? Math.max(0, t.amount_usd + pnl) : t.amount_usd;
                      const isFavorable =
                        t.side === 'LONG' || t.side === 'BUY' ? liveP >= entryP : liveP <= entryP;
                      const limitDiffPct = entryP > 0 ? ((liveP - entryP) / entryP) * 100 : 0;
                      const isBusyRow = closingId === t.id;

                      return (
                        <tr key={t.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3.5 font-mono-tabular text-slate-500 whitespace-nowrap">
                            {formatDateTime(t.created_at)}
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedSymbol(t.symbol)}
                              className="hover:text-blue-600 transition-colors"
                            >
                              {t.symbol}
                            </button>
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span
                              className={`font-bold ${
                                t.side === 'BUY' || t.side === 'LONG' ? 'text-emerald-600' : 'text-red-600'
                              }`}
                            >
                              {t.side === 'BUY' || t.side === 'LONG' ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                            <div>${formatUsd(entryP, pDec)}</div>
                            {isPos && (t.tp_price || t.sl_price) && (
                              <div className="text-[10.5px] text-slate-500">
                                {t.tp_price ? <span className="text-emerald-600">TP ${formatUsd(t.tp_price, getPriceDecimals(t.tp_price))}</span> : null}
                                {t.tp_price && t.sl_price ? ' · ' : null}
                                {t.sl_price ? <span className="text-red-600">SL ${formatUsd(t.sl_price, getPriceDecimals(t.sl_price))}</span> : null}
                              </div>
                            )}
                          </td>
                          <td
                            className={`py-2.5 px-3.5 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                              isFavorable ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            ${formatUsd(liveP, pDec)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-800 whitespace-nowrap">
                            <div>
                              {t.quantity.toFixed(qDec)} {baseAsset}
                            </div>
                            <div className="text-[10.5px] text-slate-400">
                              {isPos ? `Margin $${formatUsd(t.amount_usd)}` : 'Order Amt'}
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                            ${formatUsd(currentValue)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular whitespace-nowrap">
                            {isPos ? (
                              <div className={pnl >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                                <div>
                                  {pnl >= 0 ? `+$${formatUsd(pnl)}` : `-$${formatUsd(Math.abs(pnl))}`}
                                </div>
                                <div className="text-[10.5px]">
                                  ({pnlPct >= 0 ? '+' : ''}
                                  {pnlPct.toFixed(2)}%)
                                </div>
                              </div>
                            ) : (
                              <div className="text-slate-500">
                                <div>Pending Fill</div>
                                <div className="text-[10.5px]">
                                  ({limitDiffPct >= 0 ? '+' : ''}
                                  {limitDiffPct.toFixed(2)}%)
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            {isPos ? (
                              <button
                                type="button"
                                disabled={isBusyRow}
                                onClick={() => handleClosePosition(t.id)}
                                className={`px-3 py-1.5 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                                  pnl >= 0
                                    ? 'bg-emerald-600 hover:bg-emerald-700'
                                    : 'bg-rose-600 hover:bg-rose-700'
                                }`}
                                title="Close immediately at live price & realize live P&L"
                              >
                                {isBusyRow
                                  ? 'Closing...'
                                  : `Close (${pnl >= 0 ? '+' : '-'}$${formatUsd(Math.abs(pnl))})`}
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusyRow}
                                onClick={() => handleCancelLimit(t.id)}
                                className="px-3 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium rounded-lg disabled:opacity-60"
                              >
                                {isBusyRow ? 'Cancelling...' : 'Cancel'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                    {/* 2. Active Spot Coin Holdings (track Entry Price, Live Price, Current Value, Live PnL, Close @ Live PnL) */}
                    {activeHoldings.map((h) => {
                      const m = markets.find((x) => x.base_asset === h.asset);
                      const sym = m ? m.symbol : `${h.asset}/USDT`;
                      const entryP = Number(h.avg_entry_price || 0);
                      const livePrice = m ? m.current_price : entryP;
                      const pDec = getPriceDecimals(livePrice || entryP);
                      const qDec = getQtyDecimals(livePrice || entryP);
                      const costBasis = Number((Number(h.quantity) * entryP).toFixed(2));
                      const currentValue = Number((Number(h.quantity) * livePrice).toFixed(2));
                      const livePnl = Number((currentValue - costBasis).toFixed(2));
                      const pnlPct = costBasis > 0 ? (livePnl / costBasis) * 100 : 0;
                      const isBusyRow = closingId === `HOLDING:${h.asset}`;

                      return (
                        <tr key={`holding-${h.asset}`} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3.5 font-mono-tabular text-slate-500 whitespace-nowrap">
                            Active Spot
                          </td>
                          <td className="py-2.5 px-3.5 font-semibold text-slate-900 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setSelectedSymbol(sym)}
                              className="hover:text-blue-600 transition-colors"
                            >
                              {sym}
                            </button>
                          </td>
                          <td className="py-2.5 px-3.5 whitespace-nowrap">
                            <span className="font-bold text-emerald-600">BUY</span>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                            ${formatUsd(entryP, pDec)}
                          </td>
                          <td
                            className={`py-2.5 px-3.5 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                              livePrice >= entryP ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            ${formatUsd(livePrice, pDec)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-800 whitespace-nowrap">
                            <div>
                              {Number(h.quantity).toFixed(qDec)} {h.asset}
                            </div>
                            <div className="text-[10.5px] text-slate-400">Cost ${formatUsd(costBasis)}</div>
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                            ${formatUsd(currentValue)}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular whitespace-nowrap">
                            <div className={livePnl >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                              <div>
                                {livePnl >= 0 ? `+$${formatUsd(livePnl)}` : `-$${formatUsd(Math.abs(livePnl))}`}
                              </div>
                              <div className="text-[10.5px]">
                                ({pnlPct >= 0 ? '+' : ''}
                                {pnlPct.toFixed(2)}%)
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              disabled={isBusyRow}
                              onClick={() => handleCloseSpotHolding(h.asset)}
                              className={`px-3 py-1.5 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                                livePnl >= 0
                                  ? 'bg-emerald-600 hover:bg-emerald-700'
                                  : 'bg-rose-600 hover:bg-rose-700'
                              }`}
                              title="Sell Spot holding at live price & realize live P&L"
                            >
                              {isBusyRow
                                ? 'Closing...'
                                : `Close (${livePnl >= 0 ? '+' : '-'}$${formatUsd(Math.abs(livePnl))})`}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
            </>
          )}

          {bottomTab === 'ORDER_HISTORY' && (
            <>
              <div className="md:hidden divide-y divide-slate-100">
                {historyOrders.length === 0 ? (
                  <div className="py-10 px-4 text-center text-xs text-slate-500">
                    No settled or cancelled orders yet.
                  </div>
                ) : (
                  historyOrders.map((t) => {
                    const entryP = Number(t.entry_price || t.limit_price || 0);
                    const closeP = Number(t.exit_price || entryP);
                    const pDec = getPriceDecimals(closeP || entryP);
                    const qDec = getQtyDecimals(closeP || entryP);
                    const baseAsset = t.symbol.split('/')[0] || '';
                    const isPos = t.order_mode === 'POSITION';
                    const hasPnl = t.status === 'SETTLED' && (isPos || t.side === 'SELL');
                    const realizedPnlDisplay =
                      isPos && t.is_liquidated === 1 ? -Number(t.amount_usd || 0) : Number(t.pnl_usd || 0);
                    const closeValue = isPos
                      ? t.is_liquidated === 1
                        ? 0
                        : Math.max(0, t.amount_usd + realizedPnlDisplay)
                      : t.status === 'SETTLED' && t.side === 'SELL'
                      ? Math.max(0, t.amount_usd - Number(t.fee_usd || 0))
                      : t.amount_usd;

                    return (
                      <div key={`m-hist-${t.id}`} className="p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-slate-900">{t.symbol}</span>
                            <span
                              className={`text-[11px] font-bold ${
                                t.side === 'BUY' || t.side === 'LONG' ? 'text-emerald-600' : 'text-red-600'
                              }`}
                            >
                              {t.side === 'BUY' || t.side === 'LONG' ? 'BUY' : 'SELL'}
                            </span>
                            <span
                              className={`text-[11px] font-semibold ${
                                t.is_liquidated === 1
                                  ? 'text-red-600'
                                  : t.status === 'SETTLED'
                                  ? 'text-emerald-600'
                                  : 'text-slate-400'
                              }`}
                            >
                              {t.is_liquidated === 1 ? 'LIQUIDATED' : t.status}
                            </span>
                          </div>
                          <div className="text-xs font-mono-tabular font-bold text-slate-900">
                            ${formatUsd(closeValue)}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono-tabular text-slate-500">
                          <span>
                            {t.quantity.toFixed(qDec)} {baseAsset} · {t.status === 'CANCELLED' ? `$${formatUsd(entryP, pDec)}` : `$${formatUsd(closeP, pDec)}`}
                          </span>
                          {hasPnl ? (
                            <span className={realizedPnlDisplay >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                              {realizedPnlDisplay >= 0 ? `+$${formatUsd(realizedPnlDisplay)}` : `-$${formatUsd(Math.abs(realizedPnlDisplay))}`}
                            </span>
                          ) : (
                            <span>{formatDateTime(t.settled_at || t.created_at)}</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <table className="hidden md:table w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-3.5">Time</th>
                  <th className="py-2.5 px-3.5">Pair</th>
                  <th className="py-2.5 px-3.5">Side</th>
                  <th className="py-2.5 px-3.5 text-right">Entry Price</th>
                  <th className="py-2.5 px-3.5 text-right">Close Price</th>
                  <th className="py-2.5 px-3.5 text-right">Amount</th>
                  <th className="py-2.5 px-3.5 text-right">Total / Close Value</th>
                  <th className="py-2.5 px-3.5 text-right">Realized P&amp;L</th>
                  <th className="py-2.5 px-3.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {historyOrders.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 px-4 text-center text-slate-500">
                      No settled or cancelled orders yet.
                    </td>
                  </tr>
                ) : (
                  historyOrders.map((t) => {
                    const entryP = Number(t.entry_price || t.limit_price || 0);
                    const closeP = Number(t.exit_price || entryP);
                    const pDec = getPriceDecimals(closeP || entryP);
                    const qDec = getQtyDecimals(closeP || entryP);
                    const baseAsset = t.symbol.split('/')[0] || '';
                    const isPos = t.order_mode === 'POSITION';
                    const hasPnl = t.status === 'SETTLED' && (isPos || t.side === 'SELL');
                    const realizedPnlDisplay =
                      isPos && t.is_liquidated === 1 ? -Number(t.amount_usd || 0) : Number(t.pnl_usd || 0);
                    const closeValue = isPos
                      ? t.is_liquidated === 1
                        ? 0
                        : Math.max(0, t.amount_usd + realizedPnlDisplay)
                      : t.status === 'SETTLED' && t.side === 'SELL'
                      ? Math.max(0, t.amount_usd - Number(t.fee_usd || 0))
                      : t.amount_usd;
                    const costRef = isPos
                      ? t.amount_usd
                      : t.side === 'SELL' && t.quantity > 0 && entryP > 0
                      ? t.quantity * entryP
                      : t.amount_usd;
                    const pnlPct = costRef > 0 ? (realizedPnlDisplay / costRef) * 100 : 0;

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3.5 font-mono-tabular text-slate-500 whitespace-nowrap">
                          {formatDateTime(t.settled_at || t.created_at)}
                        </td>
                        <td className="py-2.5 px-3.5 font-semibold text-slate-900 whitespace-nowrap">{t.symbol}</td>
                        <td className="py-2.5 px-3.5 whitespace-nowrap">
                          <span
                            className={`font-semibold ${
                              t.side === 'BUY' || t.side === 'LONG' ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {t.side === 'BUY' || t.side === 'LONG' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-700 whitespace-nowrap">
                          ${formatUsd(entryP, pDec)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono-tabular font-medium text-slate-900 whitespace-nowrap">
                          {t.status === 'CANCELLED' ? '—' : `$${formatUsd(closeP, pDec)}`}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-800 whitespace-nowrap">
                          {t.quantity.toFixed(qDec)} {baseAsset}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                          <div>${formatUsd(closeValue)}</div>
                          {isPos ? (
                            <div className="text-[10.5px] text-slate-400">Margin ${formatUsd(t.amount_usd)}</div>
                          ) : Number(t.fee_usd || 0) > 0 ? (
                            <div className="text-[10.5px] text-slate-400">Fee ${formatUsd(Number(t.fee_usd || 0))}</div>
                          ) : null}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-mono-tabular whitespace-nowrap">
                          {hasPnl ? (
                            <div
                              className={
                                realizedPnlDisplay >= 0
                                  ? 'text-emerald-600 font-semibold'
                                  : 'text-red-600 font-semibold'
                              }
                            >
                              <div>
                                {realizedPnlDisplay >= 0
                                  ? `+$${formatUsd(realizedPnlDisplay)}`
                                  : `-$${formatUsd(Math.abs(realizedPnlDisplay))}`}
                              </div>
                              <div className="text-[10.5px]">
                                ({pnlPct >= 0 ? '+' : ''}
                                {pnlPct.toFixed(2)}%)
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3.5 text-right font-medium whitespace-nowrap">
                          {t.is_liquidated === 1 ? (
                            <span className="text-red-600 font-semibold">LIQUIDATED</span>
                          ) : (
                            <span className={t.status === 'SETTLED' ? 'text-emerald-600' : 'text-slate-400'}>
                              {t.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </>
          )}

          {bottomTab === 'FUNDS' && (
            <>
              <div className="md:hidden divide-y divide-slate-100">
                <div className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <CryptoIcon symbol="USDT" size="md" />
                    <div>
                      <div className="text-xs font-bold text-slate-900">USDT (Main Balance)</div>
                      <div className="text-[11px] font-mono-tabular text-slate-500">$1.00</div>
                    </div>
                  </div>
                  <div className="text-right font-mono-tabular">
                    <div className="text-xs font-bold text-emerald-600">{formatUsd(effectiveMainBalance)}</div>
                    <div className="text-[11px] text-slate-500">${formatUsd(effectiveMainBalance)}</div>
                  </div>
                </div>
                {holdings.map((h) => {
                  const m = markets.find((x) => x.base_asset === h.asset);
                  const liveP = m ? m.current_price : h.avg_entry_price;
                  const qDec = getQtyDecimals(liveP || h.avg_entry_price);
                  const costBasis = Number((Number(h.quantity) * Number(h.avg_entry_price)).toFixed(2));
                  const currentVal = Number((Number(h.quantity) * liveP).toFixed(2));
                  const livePnl = Number((currentVal - costBasis).toFixed(2));
                  const isBusyRow = closingId === `HOLDING:${h.asset}`;
                  return (
                    <div key={`m-fund-${h.asset}`} className="p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <CryptoIcon symbol={h.asset} size="md" />
                          <div>
                            <div className="text-xs font-bold text-slate-900">{h.asset}</div>
                            <div className="text-[11px] font-mono-tabular text-slate-500">
                              {h.quantity.toFixed(qDec)} {h.asset}
                            </div>
                          </div>
                        </div>
                        <div className="text-right font-mono-tabular">
                          <div className="text-xs font-bold text-slate-900">${formatUsd(currentVal)}</div>
                          <div className={`text-[11px] font-semibold ${livePnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {livePnl >= 0 ? `+$${formatUsd(livePnl)}` : `-$${formatUsd(Math.abs(livePnl))}`}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={isBusyRow}
                        onClick={() => handleCloseSpotHolding(h.asset)}
                        className={`w-full min-h-[38px] text-white text-xs font-semibold rounded-xl disabled:opacity-60 ${
                          livePnl >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
                        }`}
                      >
                        {isBusyRow ? 'Closing...' : `Close ($${formatUsd(currentVal)})`}
                      </button>
                    </div>
                  );
                })}
              </div>

              <table className="hidden md:table w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-3.5">Asset</th>
                  <th className="py-2.5 px-3.5 text-right">Available Balance</th>
                  <th className="py-2.5 px-3.5 text-right">Entry Price</th>
                  <th className="py-2.5 px-3.5 text-right">Live Price</th>
                  <th className="py-2.5 px-3.5 text-right">Current Value</th>
                  <th className="py-2.5 px-3.5 text-right">Live P&amp;L</th>
                  <th className="py-2.5 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                <tr className="hover:bg-slate-50/60">
                  <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                    <div className="flex items-center gap-2">
                      <CryptoIcon symbol="USDT" size="sm" />
                      <span>USDT (Main Balance)</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono-tabular font-semibold text-emerald-600">
                    {formatUsd(effectiveMainBalance)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-500">$1.00</td>
                  <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-500">$1.00</td>
                  <td className="py-2.5 px-3.5 text-right font-mono-tabular font-semibold text-slate-900">
                    ${formatUsd(effectiveMainBalance)}
                  </td>
                  <td className="py-2.5 px-3.5 text-right text-slate-400">—</td>
                  <td className="py-2.5 px-3.5 text-right text-slate-400">—</td>
                </tr>
                {holdings.map((h) => {
                  const m = markets.find((x) => x.base_asset === h.asset);
                  const liveP = m ? m.current_price : h.avg_entry_price;
                  const pDec = getPriceDecimals(liveP || h.avg_entry_price);
                  const qDec = getQtyDecimals(liveP || h.avg_entry_price);
                  const costBasis = Number((Number(h.quantity) * Number(h.avg_entry_price)).toFixed(2));
                  const currentVal = Number((Number(h.quantity) * liveP).toFixed(2));
                  const livePnl = Number((currentVal - costBasis).toFixed(2));
                  const pnlPct = costBasis > 0 ? (livePnl / costBasis) * 100 : 0;
                  const isBusyRow = closingId === `HOLDING:${h.asset}`;

                  return (
                    <tr key={h.asset} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <CryptoIcon symbol={h.asset} size="sm" />
                          <span>{h.asset}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-800">
                        {h.quantity.toFixed(qDec)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-tabular text-slate-600">
                        ${formatUsd(h.avg_entry_price, pDec)}
                      </td>
                      <td
                        className={`py-2.5 px-3.5 text-right font-mono-tabular font-semibold ${
                          liveP >= h.avg_entry_price ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        ${formatUsd(liveP, pDec)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-tabular font-semibold text-slate-900">
                        ${formatUsd(currentVal)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono-tabular">
                        <span className={livePnl >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                          {livePnl >= 0 ? `+$${formatUsd(livePnl)}` : `-$${formatUsd(Math.abs(livePnl))}`} (
                          {pnlPct >= 0 ? '+' : ''}
                          {pnlPct.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          type="button"
                          disabled={isBusyRow}
                          onClick={() => handleCloseSpotHolding(h.asset)}
                          className={`px-3 py-1 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 ${
                            livePnl >= 0
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-rose-600 hover:bg-rose-700'
                          }`}
                        >
                          {isBusyRow ? 'Closing...' : `Close ($${formatUsd(currentVal)})`}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </>
          )}
        </div>
      </div>

      {/* MOBILE PAIR SELECTOR BOTTOM SHEET (< 1024px) */}
      {mobilePairSheetOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end"
          onClick={() => setMobilePairSheetOpen(false)}
        >
          <div
            className="w-full max-h-[82vh] bg-white rounded-t-3xl border-t border-slate-200 p-4 flex flex-col gap-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-slate-300 mx-auto shrink-0" />
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-bold text-slate-900">Select Spot Market</div>
              <span className="text-[11px] font-mono-tabular text-slate-500">
                {filteredMarkets.length} / {markets.length} Coins
              </span>
            </div>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pairSearch}
                onChange={(e) => setPairSearch(e.target.value)}
                placeholder="Search coin (BTC, ETH, SOL...)"
                className="w-full h-10 pl-9 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="divide-y divide-slate-100 overflow-y-auto -mx-1 px-1">
              {filteredMarkets.map((m) => {
                const mDec = getPriceDecimals(m.current_price);
                return (
                  <button
                    key={`m-pair-${m.symbol}`}
                    type="button"
                    onClick={() => {
                      setSelectedSymbol(m.symbol);
                      setMobilePairSheetOpen(false);
                    }}
                    className={`w-full min-h-[52px] py-2.5 px-2.5 flex items-center justify-between text-xs rounded-xl ${
                      m.symbol === pair?.symbol ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5 min-w-0">
                      <CryptoIcon symbol={m.base_asset} size="sm" />
                      <span className="text-left truncate">
                        <span className="font-bold text-slate-900 block">{m.base_asset}/USDT</span>
                        <span className="text-[11px] text-slate-400">{m.name}</span>
                      </span>
                    </span>
                    <span className="text-right font-mono-tabular">
                      <span className="block font-semibold text-slate-900">${formatUsd(m.current_price, mDec)}</span>
                      <span
                        className={`block text-[11px] font-semibold ${
                          m.change_24h_pct >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {m.change_24h_pct >= 0 ? '+' : ''}
                        {m.change_24h_pct.toFixed(2)}%
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
