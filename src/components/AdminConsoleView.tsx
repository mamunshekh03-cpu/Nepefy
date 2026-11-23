import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { SupportChatCenter } from './SupportChatCenter';
import type {
  MarketPair,
  P2PMessage,
  P2POrder,
  SpotTrade,
  SupportLiveSignal,
  UserProfile,
} from '../types';
import type {
  AdminMetrics,
  AdminNavBadgeMap,
  AdminOverviewData,
  AdminTab,
  JackpotStats,
  SpotStats,
  UserFilter,
} from './admin/adminTypes';
import { AdminDashboardTab } from './admin/AdminDashboardTab';
import { AdminUsersTab } from './admin/AdminUsersTab';
import { AdminDepositsTab, AdminSendTab, AdminWithdrawalsTab } from './admin/AdminTreasuryTabs';
import { AdminP2PTab, AdminSpotTab } from './admin/AdminTradingTabs';
import { AdminPresaleTab, AdminStakingTab } from './admin/AdminVaultPresaleTabs';
import { AdminRewardsTab, AdminTransactionsTab } from './admin/AdminRewardsLedgerTabs';
import { AdminAuditLogsTab } from './admin/AdminAuditLogsTab';
import { AdminSettingsTab } from './admin/AdminSettingsTab';
import { AdminModals } from './admin/AdminModals';

interface AdminConsoleViewProps {
  user: UserProfile;
  liveMarkets: MarketPair[];
  onRefreshUser: () => Promise<void>;
  supportSignal?: SupportLiveSignal | null;
  onSupportUnreadChange?: (count: number) => void;
  activeTab?: AdminTab;
  onTabChange?: (tab: AdminTab) => void;
  onBadgesChange?: (badges: AdminNavBadgeMap) => void;
}

const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  DASHBOARD: 'Executive Dashboard',
  USERS: 'Users & KYC',
  DEPOSITS: 'Deposits',
  WITHDRAWALS: 'Withdrawals',
  SEND: 'Send & Transfers',
  P2P: 'P2P Escrow',
  SPOT: 'Spot Markets',
  STAKING: 'Staking Vault',
  PRESALE: 'Coin Presale',
  REWARDS: 'Jackpot & Referrals',
  SUPPORT: 'Support Chat',
  TRANSACTIONS: 'Financial Ledger',
  AUDIT_LOGS: 'Admin Audit Logs',
  SETTINGS: 'System Settings',
};

export const AdminConsoleView: React.FC<AdminConsoleViewProps> = ({
  user,
  liveMarkets,
  onRefreshUser,
  supportSignal = null,
  onSupportUnreadChange,
  activeTab,
  onTabChange,
  onBadgesChange,
}) => {
  const [internalTab, setInternalTab] = useState<AdminTab>('DASHBOARD');
  const tab = activeTab ?? internalTab;
  const setTab = (next: AdminTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };
  const [data, setData] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [chatTargetUserId, setChatTargetUserId] = useState<string | null>(null);
  const [liveSupportUnread, setLiveSupportUnread] = useState<number | null>(null);

  // User Management state
  const [userFilter, setUserFilter] = useState<UserFilter>('ALL');
  const [userSearch, setUserSearch] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<UserProfile | null>(null);
  const [adjustWallet, setAdjustWallet] = useState<'MAIN' | 'CLAIMABLE'>('MAIN');
  const [adjustDir, setAdjustDir] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [adjustAmount, setAdjustAmount] = useState('100');
  const [adjustNote, setAdjustNote] = useState('');

  // Deposits & Withdrawals filters
  const [depositStatusFilter, setDepositStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [depositGatewayFilter, setDepositGatewayFilter] = useState<'ALL' | 'Binance' | 'Bybit'>('ALL');
  const [depositSearch, setDepositSearch] = useState('');

  const [withdrawStatusFilter, setWithdrawStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [withdrawGatewayFilter, setWithdrawGatewayFilter] = useState<'ALL' | 'Binance' | 'Bybit'>('ALL');
  const [withdrawSearch, setWithdrawSearch] = useState('');

  // Send / Direct Transfer form
  const [sendMode, setSendMode] = useState<'TREASURY_SEND' | 'USER_TO_USER'>('TREASURY_SEND');
  const [sendFromId, setSendFromId] = useState('');
  const [sendToId, setSendToId] = useState('');
  const [sendWalletType, setSendWalletType] = useState<'MAIN' | 'CLAIMABLE'>('MAIN');
  const [sendAmount, setSendAmount] = useState('100');
  const [sendNote, setSendNote] = useState('');
  const [sendSearch, setSendSearch] = useState('');

  // P2P Market sub-tabs & filters
  const [p2pSubTab, setP2pSubTab] = useState<'ORDERS' | 'OFFERS'>('ORDERS');
  const [p2pOrderFilter, setP2pOrderFilter] = useState<'ALL' | 'DISPUTED' | 'ESCROW_LOCKED' | 'PAID' | 'COMPLETED'>('ALL');
  const [inspectP2pOrder, setInspectP2pOrder] = useState<P2POrder | null>(null);
  const [inspectP2pMessages, setInspectP2pMessages] = useState<P2PMessage[]>([]);
  const [loadingInspectChat, setLoadingInspectChat] = useState(false);

  const openAdminOrderChat = async (ord: P2POrder) => {
    setInspectP2pOrder(ord);
    setLoadingInspectChat(true);
    try {
      const res = await apiFetch<{ messages?: P2PMessage[] }>(`/api/p2p/orders/${ord.id}/messages`);
      setInspectP2pMessages(Array.isArray(res?.messages) ? res.messages : []);
    } catch {
      setInspectP2pMessages([]);
    } finally {
      setLoadingInspectChat(false);
    }
  };

  // Spot Trading & Global Live Markets state
  const [spotSubTab, setSpotSubTab] = useState<'MARKETS' | 'TRADES'>('MARKETS');
  const [marketSearch, setMarketSearch] = useState('');
  const [newCoinSymbol, setNewCoinSymbol] = useState('');
  const [newCoinName, setNewCoinName] = useState('');
  const [addingCoin, setAddingCoin] = useState(false);
  const [tradeViewFilter, setTradeViewFilter] = useState<'ALL' | 'TAKER' | 'MAKER' | 'LIQUIDATED' | 'OPEN'>('ALL');
  const [tradeSearch, setTradeSearch] = useState('');

  // Staking Vault filters
  const [stakingFilter, setStakingFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED' | 'EMERGENCY_WITHDRAWN'>('ALL');

  // Coin Presale form & filters
  const [newTokenSym, setNewTokenSym] = useState('');
  const [newTokenName, setNewTokenName] = useState('');
  const [newLotPrice, setNewLotPrice] = useState('75');
  const [newTokensPerLot, setNewTokensPerLot] = useState('150');
  const [newWinPayout, setNewWinPayout] = useState('180');
  const [newTotalLots, setNewTotalLots] = useState('400');
  const [ticketFilter, setTicketFilter] = useState<'ALL' | 'PENDING' | 'WIN' | 'LOSS'>('ALL');

  // Rewards, Referral & Jackpot state
  const [rewardsSubTab, setRewardsSubTab] = useState<'JACKPOT' | 'REFERRALS'>('JACKPOT');
  const [referralFilter, setReferralFilter] = useState<'ALL' | 'PENDING_DEPOSIT' | 'CREDITED_CLAIMABLE'>('ALL');
  const [poolInput, setPoolInput] = useState('2500');
  const [quarterInput, setQuarterInput] = useState('Q4 2026');
  const [jackpotTitleInput, setJackpotTitleInput] = useState('Q4 2026 Quarterly Jackpot');
  const [jackpotTicketPriceInput, setJackpotTicketPriceInput] = useState('1');
  const [jackpotDrawAtInput, setJackpotDrawAtInput] = useState('');
  const [jackpotTicketFilter, setJackpotTicketFilter] = useState<'ALL' | 'ACTIVE' | 'WON' | 'LOST'>('ALL');
  const [jackpotSearch, setJackpotSearch] = useState('');

  // All Transactions ledger explorer state
  const [txSearch, setTxSearch] = useState('');
  const [txWalletFilter, setTxWalletFilter] = useState<'ALL' | 'MAIN' | 'CLAIMABLE'>('ALL');
  const [txTypeFilter, setTxTypeFilter] = useState('ALL');

  const loadOverview = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await apiFetch<AdminOverviewData>('/api/admin/overview');
      setData(res);
      if (res.users && res.users.length > 0) {
        const nonAdminUsers = res.users.filter((u) => u.role !== 'ADMIN');
        const pool = nonAdminUsers.length > 0 ? nonAdminUsers : res.users;
        setSendFromId((prev) => (prev && res.users.some((u) => u.id === prev) ? prev : pool[0]?.id || ''));
        setSendToId((prev) => (prev && res.users.some((u) => u.id === prev) ? prev : pool[1]?.id || pool[0]?.id || ''));
      }
      if (typeof res.supportUnreadCount === 'number') {
        setLiveSupportUnread(res.supportUnreadCount);
      }
      const openDraw = res.luckyDraws.find((d) => d.status === 'OPEN');
      if (openDraw) {
        setPoolInput(String(openDraw.prize_pool));
        setQuarterInput(openDraw.quarter_label);
        setJackpotTitleInput(openDraw.title || `${openDraw.quarter_label} Quarterly Jackpot`);
        setJackpotTicketPriceInput(String(openDraw.ticket_price ?? 1));
        if (openDraw.draw_at) {
          const dt = new Date(openDraw.draw_at);
          if (!Number.isNaN(dt.getTime())) {
            const localIso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
            setJackpotDrawAtInput(localIso);
          }
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadOverview().catch(() => {});
  }, []);

  const runAction = async (fn: () => Promise<string>) => {
    setNotice(null);
    try {
      const msg = await fn();
      setNotice({ type: 'ok', text: msg });
      await Promise.all([loadOverview(true), onRefreshUser()]);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Admin operation failed' });
    }
  };

  const displayMarkets = liveMarkets.length > 0 ? liveMarkets : data?.markets || [];

  const metrics: AdminMetrics | null = useMemo(() => {
    if (!data) return null;
    const users = data.users;
    const totalMain = users.reduce((s, u) => s + Number(u.main_balance || 0), 0);
    const totalClaimable = users.reduce((s, u) => s + Number(u.claimable_balance || 0), 0);
    const totalLocked = users.reduce((s, u) => s + Number(u.locked_balance || 0), 0);

    const activeUsers = users.filter((u) => (u.status || 'ACTIVE') === 'ACTIVE').length;
    const inactiveUsers = users.filter((u) => u.status === 'INACTIVE').length;
    const verifiedUsers = users.filter((u) => (u.kyc_status || 'UNVERIFIED') === 'VERIFIED').length;
    const unverifiedUsers = users.filter((u) => (u.kyc_status || 'UNVERIFIED') === 'UNVERIFIED').length;

    const pendingDeposits = data.deposits.filter((d) => d.status === 'PENDING');
    const approvedDepositsTotal = data.deposits.filter((d) => d.status === 'APPROVED').reduce((s, d) => s + d.amount, 0);

    const pendingWithdrawals = data.withdrawals.filter((w) => w.status === 'PENDING');
    const approvedWithdrawalsTotal = data.withdrawals
      .filter((w) => w.status === 'APPROVED')
      .reduce((s, w) => s + w.amount, 0);

    const disputedP2p = data.p2pOrders.filter((o) => o.status === 'DISPUTED').length;
    const openTrades = data.trades.filter((t) => t.status === 'OPEN');
    const openTradesVolume = openTrades.reduce((s, t) => s + t.amount_usd, 0);

    const activeStaking = data.staking.filter((s) => s.status === 'ACTIVE');
    const totalStakedPrincipal = activeStaking.reduce((s, p) => s + p.principal_amount, 0);
    const totalStakingProfitPaid = data.staking.reduce((s, p) => s + p.total_profit_paid, 0);

    const pendingPresaleTickets = data.presaleTickets.filter((t) => t.result === 'PENDING').length;
    const pendingReferrals = data.referrals.filter((r) => r.status === 'PENDING_DEPOSIT').length;

    const totalPendingQueue =
      pendingDeposits.length + pendingWithdrawals.length + disputedP2p + pendingPresaleTickets + pendingReferrals;

    return {
      totalMain,
      totalClaimable,
      totalLocked,
      totalLiquidity: totalMain + totalClaimable + totalLocked,
      activeUsers,
      inactiveUsers,
      verifiedUsers,
      unverifiedUsers,
      pendingDepositsCount: pendingDeposits.length,
      pendingDepositsAmt: pendingDeposits.reduce((s, d) => s + d.amount, 0),
      approvedDepositsTotal,
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingWithdrawalsAmt: pendingWithdrawals.reduce((s, w) => s + w.amount, 0),
      approvedWithdrawalsTotal,
      disputedP2p,
      openTradesCount: openTrades.length,
      openTradesVolume,
      activeStakingCount: activeStaking.length,
      totalStakedPrincipal,
      totalStakingProfitPaid,
      pendingPresaleTickets,
      pendingReferrals,
      totalPendingQueue,
    };
  }, [data]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    const q = userSearch.trim().toLowerCase();
    return data.users.filter((u) => {
      const uStatus = u.status || 'ACTIVE';
      const uKyc = u.kyc_status || 'UNVERIFIED';
      if (userFilter === 'ACTIVE' && uStatus !== 'ACTIVE') return false;
      if (userFilter === 'INACTIVE' && uStatus !== 'INACTIVE') return false;
      if (userFilter === 'VERIFIED' && uKyc !== 'VERIFIED') return false;
      if (userFilter === 'UNVERIFIED' && uKyc !== 'UNVERIFIED') return false;
      if (!q) return true;
      return (
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        u.referral_code.toLowerCase().includes(q)
      );
    });
  }, [data, userFilter, userSearch]);

  const filteredDeposits = useMemo(() => {
    if (!data) return [];
    const q = depositSearch.trim().toLowerCase();
    return data.deposits.filter((d) => {
      if (depositStatusFilter !== 'ALL' && d.status !== depositStatusFilter) return false;
      if (depositGatewayFilter !== 'ALL' && d.gateway !== depositGatewayFilter) return false;
      if (!q) return true;
      return (
        (d.user_name || '').toLowerCase().includes(q) ||
        (d.user_email || '').toLowerCase().includes(q) ||
        d.trx_id.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q)
      );
    });
  }, [data, depositStatusFilter, depositGatewayFilter, depositSearch]);

  const filteredWithdrawals = useMemo(() => {
    if (!data) return [];
    const q = withdrawSearch.trim().toLowerCase();
    return data.withdrawals.filter((w) => {
      if (withdrawStatusFilter !== 'ALL' && w.status !== withdrawStatusFilter) return false;
      if (withdrawGatewayFilter !== 'ALL' && w.gateway !== withdrawGatewayFilter) return false;
      if (!q) return true;
      return (
        (w.user_name || '').toLowerCase().includes(q) ||
        (w.user_email || '').toLowerCase().includes(q) ||
        w.destination_address.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q)
      );
    });
  }, [data, withdrawStatusFilter, withdrawGatewayFilter, withdrawSearch]);

  const sendTransactions = useMemo(() => {
    if (!data) return [];
    const q = sendSearch.trim().toLowerCase();
    return data.transactions.filter((tx) => {
      if (!['SEND_OUT', 'SEND_IN', 'ADMIN_ADJUST'].includes(tx.tx_type)) return false;
      if (!q) return true;
      return (
        (tx.user_name || '').toLowerCase().includes(q) ||
        (tx.user_email || '').toLowerCase().includes(q) ||
        tx.reference_id.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q)
      );
    });
  }, [data, sendSearch]);

  const filteredMarkets = useMemo(() => {
    const q = marketSearch.trim().toLowerCase();
    if (!q) return displayMarkets;
    return displayMarkets.filter(
      (m) =>
        m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.base_asset.toLowerCase().includes(q)
    );
  }, [displayMarkets, marketSearch]);

  const marketPriceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of displayMarkets) {
      map.set(m.symbol, m.current_price);
    }
    return map;
  }, [displayMarkets]);

  const computeLiveTradePnl = (t: SpotTrade): number => {
    if (t.status !== 'OPEN') return Number(t.pnl_usd || 0);
    if (t.order_mode !== 'POSITION') return 0;
    const livePrice = marketPriceMap.get(t.symbol) ?? t.entry_price;
    if (!t.entry_price) return 0;
    const movePct = (livePrice - t.entry_price) / t.entry_price;
    const directional = t.side === 'LONG' ? movePct : -movePct;
    const rawPnl = t.amount_usd * directional * 5;
    return Number(Math.max(-t.amount_usd, rawPnl).toFixed(2));
  };

  const spotStats: SpotStats = useMemo(() => {
    const trades = data?.trades || [];
    let totalVolumeUsd = 0;
    let openTradesCount = 0;
    let openPositionCount = 0;
    let openLimitCount = 0;
    let openExposureUsd = 0;
    let liveUnrealizedPnl = 0;
    let settledCount = 0;
    let settledPnl = 0;
    let takerFeeUsd = 0;
    let makerFeeUsd = 0;
    let liquidationUsd = 0;
    let liquidationCount = 0;

    for (const t of trades) {
      if (t.status !== 'CANCELLED') {
        totalVolumeUsd += Number(t.amount_usd || 0);
        const fee = Number(t.fee_usd || 0);
        if ((t.fee_role || 'TAKER') === 'MAKER') {
          if (t.status === 'SETTLED') makerFeeUsd += fee;
        } else {
          takerFeeUsd += fee;
        }
      }
      if (t.is_liquidated === 1) {
        liquidationCount += 1;
        liquidationUsd += Number(t.amount_usd || 0);
      }
      if (t.status === 'OPEN') {
        openTradesCount += 1;
        openExposureUsd += Number(t.amount_usd || 0);
        if (t.order_mode === 'POSITION') {
          openPositionCount += 1;
          liveUnrealizedPnl += computeLiveTradePnl(t);
        } else if (t.order_mode === 'LIMIT') {
          openLimitCount += 1;
        }
      } else if (t.status === 'SETTLED') {
        settledCount += 1;
        settledPnl += Number(t.pnl_usd || 0);
      }
    }

    return {
      totalTradesCount: trades.length,
      totalVolumeUsd,
      openTradesCount,
      openPositionCount,
      openLimitCount,
      openExposureUsd,
      liveUnrealizedPnl,
      settledCount,
      settledPnl,
      takerFeeUsd,
      makerFeeUsd,
      totalFeeUsd: takerFeeUsd + makerFeeUsd,
      liquidationUsd,
      liquidationCount,
    };
  }, [data?.trades, marketPriceMap]);

  const filteredTrades = useMemo(() => {
    if (!data) return [];
    const q = tradeSearch.trim().toLowerCase();
    return data.trades.filter((t) => {
      if (tradeViewFilter === 'TAKER' && ((t.fee_role || 'TAKER') !== 'TAKER' || t.status === 'CANCELLED')) return false;
      if (tradeViewFilter === 'MAKER' && (t.fee_role !== 'MAKER' || t.status === 'CANCELLED')) return false;
      if (tradeViewFilter === 'LIQUIDATED' && t.is_liquidated !== 1) return false;
      if (tradeViewFilter === 'OPEN' && t.status !== 'OPEN') return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        (t.user_name || '').toLowerCase().includes(q) ||
        (t.user_email || '').toLowerCase().includes(q) ||
        t.order_mode.toLowerCase().includes(q) ||
        t.side.toLowerCase().includes(q) ||
        (t.fee_role || '').toLowerCase().includes(q)
      );
    });
  }, [data, tradeViewFilter, tradeSearch]);

  const filteredStaking = useMemo(() => {
    if (!data) return [];
    if (stakingFilter === 'ALL') return data.staking;
    return data.staking.filter((s) => s.status === stakingFilter);
  }, [data, stakingFilter]);

  const filteredPresaleTickets = useMemo(() => {
    if (!data) return [];
    if (ticketFilter === 'ALL') return data.presaleTickets;
    return data.presaleTickets.filter((t) => t.result === ticketFilter);
  }, [data, ticketFilter]);

  const filteredP2pOrders = useMemo(() => {
    if (!data) return [];
    if (p2pOrderFilter === 'ALL') return data.p2pOrders;
    return data.p2pOrders.filter((o) => o.status === p2pOrderFilter);
  }, [data, p2pOrderFilter]);

  const filteredReferrals = useMemo(() => {
    if (!data) return [];
    if (referralFilter === 'ALL') return data.referrals;
    return data.referrals.filter((r) => r.status === referralFilter);
  }, [data, referralFilter]);

  const jackpotStats: JackpotStats = useMemo(() => {
    const draws = data?.luckyDraws || [];
    const tickets = data?.jackpotTickets || [];
    const openDraw = draws.find((d) => d.status === 'OPEN') || null;
    const completedDraws = draws.filter((d) => d.status === 'COMPLETED');
    const activeTickets = openDraw ? tickets.filter((t) => t.draw_id === openDraw.id) : [];
    const activeTicketsSold = activeTickets.reduce((s, t) => s + Number(t.ticket_count || 0), 0);
    const uniqueParticipantsCount =
      openDraw?.unique_participants ?? new Set(activeTickets.map((t) => t.user_id)).size;
    const activeTicketRevenueUsd = Number(
      activeTickets.reduce((s, t) => s + Number(t.cost_usd || 0), 0).toFixed(2)
    );
    const ticketContributionUsd = Number((activeTicketRevenueUsd * 0.8).toFixed(2));
    const currentPool = Number(openDraw?.prize_pool ?? 0);
    const basePoolUsd = Number(Math.max(0, currentPool - ticketContributionUsd).toFixed(2));
    const totalTicketsRevenue = tickets.reduce((s, t) => s + Number(t.cost_usd || 0), 0);
    const totalPrizesPaid = completedDraws.reduce((s, d) => s + Number(d.prize_pool || 0), 0);
    const daysRemaining = openDraw ? Math.max(0, Math.ceil((Date.parse(openDraw.draw_at) - Date.now()) / 86400000)) : 0;
    return {
      openDraw,
      completedCount: completedDraws.length,
      activeTicketsSold,
      uniqueParticipantsCount,
      activeTicketRevenueUsd,
      basePoolUsd,
      ticketContributionUsd,
      totalTicketsRevenue,
      platformFeeUsd: Number((totalTicketsRevenue * 0.2).toFixed(2)),
      totalPrizesPaid,
      daysRemaining,
    };
  }, [data]);

  const filteredJackpotTickets = useMemo(() => {
    if (!data) return [];
    const q = jackpotSearch.trim().toLowerCase().replace(/^#/, '');
    return (data.jackpotTickets || []).filter((t) => {
      if (jackpotTicketFilter !== 'ALL' && t.status !== jackpotTicketFilter) return false;
      if (!q) return true;
      return (
        t.id.toLowerCase().includes(q) ||
        (t.quarter_label || '').toLowerCase().includes(q) ||
        (t.user_name || '').toLowerCase().includes(q) ||
        (t.user_email || '').toLowerCase().includes(q) ||
        (t.winning_ticket_number || '').toLowerCase().includes(q) ||
        (t.ticket_numbers || []).some((num) => num.toLowerCase().includes(q))
      );
    });
  }, [data, jackpotTicketFilter, jackpotSearch]);

  const txTypes = useMemo(() => {
    if (!data) return ['ALL'];
    const set = new Set<string>(data.transactions.map((t) => t.tx_type));
    return ['ALL', ...Array.from(set).sort()];
  }, [data]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    const q = txSearch.trim().toLowerCase();
    return data.transactions.filter((tx) => {
      if (txWalletFilter !== 'ALL' && tx.wallet_type !== txWalletFilter) return false;
      if (txTypeFilter !== 'ALL' && tx.tx_type !== txTypeFilter) return false;
      if (!q) return true;
      return (
        (tx.user_name || '').toLowerCase().includes(q) ||
        (tx.user_email || '').toLowerCase().includes(q) ||
        tx.reference_id.toLowerCase().includes(q) ||
        tx.id.toLowerCase().includes(q) ||
        tx.description.toLowerCase().includes(q) ||
        tx.tx_type.toLowerCase().includes(q)
      );
    });
  }, [data, txSearch, txWalletFilter, txTypeFilter]);

  const exportTransactionsCsv = () => {
    const header = [
      'Ledger ID',
      'Timestamp',
      'User',
      'Email',
      'Wallet',
      'Type',
      'Amount USDT',
      'Balance After',
      'Reference ID',
      'Description',
    ];
    const rows = filteredTransactions.map((t) => [
      t.id,
      t.created_at,
      `"${(t.user_name || '').replace(/"/g, '""')}"`,
      t.user_email || '',
      t.wallet_type,
      t.tx_type,
      t.amount.toFixed(2),
      t.balance_after === null || t.balance_after === undefined ? '' : t.balance_after.toFixed(2),
      t.reference_id,
      `"${t.description.replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nepefy-admin-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const supportUnread = liveSupportUnread ?? data?.supportUnreadCount ?? 0;

  useEffect(() => {
    if (!onBadgesChange) return;
    onBadgesChange({
      USERS: { count: data?.users.length },
      DEPOSITS: {
        count: metrics?.pendingDepositsCount || undefined,
        urgent: (metrics?.pendingDepositsCount || 0) > 0,
      },
      WITHDRAWALS: {
        count: metrics?.pendingWithdrawalsCount || undefined,
        urgent: (metrics?.pendingWithdrawalsCount || 0) > 0,
      },
      P2P: {
        count: metrics?.disputedP2p || undefined,
        urgent: (metrics?.disputedP2p || 0) > 0,
      },
      SPOT: { count: metrics?.openTradesCount || undefined },
      STAKING: { count: metrics?.activeStakingCount || undefined },
      PRESALE: {
        count: metrics?.pendingPresaleTickets || undefined,
        urgent: (metrics?.pendingPresaleTickets || 0) > 0,
      },
      REWARDS: {
        count: jackpotStats.activeTicketsSold + (metrics?.pendingReferrals || 0) || undefined,
      },
      SUPPORT: {
        count: supportUnread || undefined,
        urgent: supportUnread > 0,
      },
    });
  }, [
    onBadgesChange,
    data?.users.length,
    metrics?.pendingDepositsCount,
    metrics?.pendingWithdrawalsCount,
    metrics?.disputedP2p,
    metrics?.openTradesCount,
    metrics?.activeStakingCount,
    metrics?.pendingPresaleTickets,
    metrics?.pendingReferrals,
    jackpotStats.activeTicketsSold,
    supportUnread,
  ]);

  const jumpToUsers = (filter: UserFilter) => {
    setUserFilter(filter);
    setTab('USERS');
  };

  if (loading && !data) {
    return (
      <div className="space-y-5">
        <div className="h-9 w-72 bg-slate-100 rounded-lg animate-pulse" />
        <div className="h-28 border border-slate-200 rounded-xl bg-slate-50/60 animate-pulse" />
        <div className="h-80 border border-slate-200 rounded-xl bg-slate-50/40 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Executive Top Bar */}
      <div className="pb-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span>Administration</span>
            <span>/</span>
            <span className="text-slate-900">{ADMIN_TAB_LABELS[tab]}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 mt-0.5">Master Admin Console</h1>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => loadOverview()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Ledger</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('SEND')}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <span>Send Funds</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active Full-Width Module Viewport */}
      <div className="min-w-0 space-y-5">
          {notice && (
            <div
              className={`border text-xs px-4 py-3 rounded-xl flex items-center justify-between gap-4 ${
                notice.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              <span>{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} className="font-medium hover:underline shrink-0">
                Dismiss
              </button>
            </div>
          )}

          {tab === 'DASHBOARD' && data && metrics && (
            <AdminDashboardTab
              data={data}
              metrics={metrics}
              spotStats={spotStats}
              displayMarkets={displayMarkets}
              supportUnread={supportUnread}
              setTab={setTab}
              jumpToUsers={jumpToUsers}
            />
          )}

          {tab === 'USERS' && data && metrics && (
            <AdminUsersTab
              currentUserId={user.id}
              data={data}
              metrics={metrics}
              filteredUsers={filteredUsers}
              userFilter={userFilter}
              setUserFilter={setUserFilter}
              userSearch={userSearch}
              setUserSearch={setUserSearch}
              runAction={runAction}
              onOpenWalletAdjust={(u) => {
                setAdjustTarget(u);
                setAdjustWallet('MAIN');
                setAdjustDir('CREDIT');
                setAdjustAmount('100');
                setAdjustNote('');
              }}
              onOpenChat={(userId) => setChatTargetUserId(userId)}
              onPreviewImage={(src) => setPreviewImg(src)}
              setTab={setTab}
            />
          )}

          {tab === 'DEPOSITS' && data && metrics && (
            <AdminDepositsTab
              data={data}
              metrics={metrics}
              filteredDeposits={filteredDeposits}
              depositStatusFilter={depositStatusFilter}
              setDepositStatusFilter={setDepositStatusFilter}
              depositGatewayFilter={depositGatewayFilter}
              setDepositGatewayFilter={setDepositGatewayFilter}
              depositSearch={depositSearch}
              setDepositSearch={setDepositSearch}
              setPreviewImg={setPreviewImg}
              runAction={runAction}
            />
          )}

          {tab === 'WITHDRAWALS' && data && metrics && (
            <AdminWithdrawalsTab
              data={data}
              metrics={metrics}
              filteredWithdrawals={filteredWithdrawals}
              withdrawStatusFilter={withdrawStatusFilter}
              setWithdrawStatusFilter={setWithdrawStatusFilter}
              withdrawGatewayFilter={withdrawGatewayFilter}
              setWithdrawGatewayFilter={setWithdrawGatewayFilter}
              withdrawSearch={withdrawSearch}
              setWithdrawSearch={setWithdrawSearch}
              runAction={runAction}
            />
          )}

          {tab === 'SEND' && data && (
            <AdminSendTab
              data={data}
              sendMode={sendMode}
              setSendMode={setSendMode}
              sendFromId={sendFromId}
              setSendFromId={setSendFromId}
              sendToId={sendToId}
              setSendToId={setSendToId}
              sendWalletType={sendWalletType}
              setSendWalletType={setSendWalletType}
              sendAmount={sendAmount}
              setSendAmount={setSendAmount}
              sendNote={sendNote}
              setSendNote={setSendNote}
              sendSearch={sendSearch}
              setSendSearch={setSendSearch}
              sendTransactions={sendTransactions}
              runAction={runAction}
            />
          )}

          {tab === 'P2P' && data && (
            <AdminP2PTab
              data={data}
              p2pSubTab={p2pSubTab}
              setP2pSubTab={setP2pSubTab}
              p2pOrderFilter={p2pOrderFilter}
              setP2pOrderFilter={setP2pOrderFilter}
              filteredP2pOrders={filteredP2pOrders}
              openAdminOrderChat={openAdminOrderChat}
              runAction={runAction}
            />
          )}

          {tab === 'SPOT' && data && (
            <AdminSpotTab
              data={data}
              spotStats={spotStats}
              displayMarkets={displayMarkets}
              filteredMarkets={filteredMarkets}
              filteredTrades={filteredTrades}
              spotSubTab={spotSubTab}
              setSpotSubTab={setSpotSubTab}
              marketSearch={marketSearch}
              setMarketSearch={setMarketSearch}
              newCoinSymbol={newCoinSymbol}
              setNewCoinSymbol={setNewCoinSymbol}
              newCoinName={newCoinName}
              setNewCoinName={setNewCoinName}
              addingCoin={addingCoin}
              setAddingCoin={setAddingCoin}
              tradeViewFilter={tradeViewFilter}
              setTradeViewFilter={setTradeViewFilter}
              tradeSearch={tradeSearch}
              setTradeSearch={setTradeSearch}
              marketPriceMap={marketPriceMap}
              computeLiveTradePnl={computeLiveTradePnl}
              runAction={runAction}
            />
          )}

          {tab === 'STAKING' && data && metrics && (
            <AdminStakingTab
              metrics={metrics}
              stakingFilter={stakingFilter}
              setStakingFilter={setStakingFilter}
              filteredStaking={filteredStaking}
              runAction={runAction}
            />
          )}

          {tab === 'PRESALE' && data && (
            <AdminPresaleTab
              data={data}
              newTokenSym={newTokenSym}
              setNewTokenSym={setNewTokenSym}
              newTokenName={newTokenName}
              setNewTokenName={setNewTokenName}
              newLotPrice={newLotPrice}
              setNewLotPrice={setNewLotPrice}
              newTokensPerLot={newTokensPerLot}
              setNewTokensPerLot={setNewTokensPerLot}
              newWinPayout={newWinPayout}
              setNewWinPayout={setNewWinPayout}
              newTotalLots={newTotalLots}
              setNewTotalLots={setNewTotalLots}
              ticketFilter={ticketFilter}
              setTicketFilter={setTicketFilter}
              filteredPresaleTickets={filteredPresaleTickets}
              runAction={runAction}
            />
          )}

          {tab === 'REWARDS' && data && (
            <AdminRewardsTab
              data={data}
              rewardsSubTab={rewardsSubTab}
              setRewardsSubTab={setRewardsSubTab}
              jackpotStats={jackpotStats}
              poolInput={poolInput}
              setPoolInput={setPoolInput}
              quarterInput={quarterInput}
              setQuarterInput={setQuarterInput}
              jackpotTitleInput={jackpotTitleInput}
              setJackpotTitleInput={setJackpotTitleInput}
              jackpotTicketPriceInput={jackpotTicketPriceInput}
              setJackpotTicketPriceInput={setJackpotTicketPriceInput}
              jackpotDrawAtInput={jackpotDrawAtInput}
              setJackpotDrawAtInput={setJackpotDrawAtInput}
              jackpotTicketFilter={jackpotTicketFilter}
              setJackpotTicketFilter={setJackpotTicketFilter}
              jackpotSearch={jackpotSearch}
              setJackpotSearch={setJackpotSearch}
              filteredJackpotTickets={filteredJackpotTickets}
              referralFilter={referralFilter}
              setReferralFilter={setReferralFilter}
              filteredReferrals={filteredReferrals}
              runAction={runAction}
            />
          )}

          {tab === 'TRANSACTIONS' && data && (
            <AdminTransactionsTab
              txWalletFilter={txWalletFilter}
              setTxWalletFilter={setTxWalletFilter}
              txTypeFilter={txTypeFilter}
              setTxTypeFilter={setTxTypeFilter}
              txTypes={txTypes}
              txSearch={txSearch}
              setTxSearch={setTxSearch}
              filteredTransactions={filteredTransactions}
              exportTransactionsCsv={exportTransactionsCsv}
            />
          )}

          {tab === 'AUDIT_LOGS' && data && (
            <AdminAuditLogsTab logs={data.auditLogs || []} />
          )}

          {tab === 'SETTINGS' && data && (
            <AdminSettingsTab initialSettings={data.platformSettings} runAction={runAction} />
          )}

          {tab === 'SUPPORT' && (
            <SupportChatCenter
              mode="ADMIN"
              currentUser={user}
              liveSignal={supportSignal}
              allUsers={data?.users || []}
              initialUserId={chatTargetUserId}
              onClearInitialUser={() => setChatTargetUserId(null)}
              onUnreadChange={(cnt) => {
                setLiveSupportUnread(cnt);
                onSupportUnreadChange?.(cnt);
              }}
            />
          )}
      </div>

      <AdminModals
        adjustTarget={adjustTarget}
        setAdjustTarget={setAdjustTarget}
        adjustWallet={adjustWallet}
        setAdjustWallet={setAdjustWallet}
        adjustDir={adjustDir}
        setAdjustDir={setAdjustDir}
        adjustAmount={adjustAmount}
        setAdjustAmount={setAdjustAmount}
        adjustNote={adjustNote}
        setAdjustNote={setAdjustNote}
        previewImg={previewImg}
        setPreviewImg={setPreviewImg}
        inspectP2pOrder={inspectP2pOrder}
        setInspectP2pOrder={setInspectP2pOrder}
        inspectP2pMessages={inspectP2pMessages}
        loadingInspectChat={loadingInspectChat}
        runAction={runAction}
      />
    </div>
  );
};
