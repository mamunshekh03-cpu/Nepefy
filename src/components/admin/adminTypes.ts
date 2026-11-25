import type {
  AdminAuditLog,
  AdminProjectSummary,
  DepositRequest,
  JackpotTicket,
  KycSubmission,
  LedgerEntry,
  LuckyDraw,
  MarketPair,
  P2POffer,
  P2POrder,
  PlatformSettings,
  PresaleRound,
  PresaleTicket,
  ReferralItem,
  SpotTrade,
  StakingPosition,
  UserProfile,
  WithdrawRequest,
} from '../../types';

export interface AdminDashboardData {
  metrics: AdminMetrics;
  registeredAccounts: number;
  activeP2pOffersCount: number;
  projectSummary: AdminProjectSummary;
  platformSettings?: PlatformSettings;
  supportUnreadCount?: number;
  recentTransactions: LedgerEntry[];
}

export interface AdminOverviewData {
  users: UserProfile[];
  deposits: DepositRequest[];
  withdrawals: WithdrawRequest[];
  p2pOffers: P2POffer[];
  p2pOrders: P2POrder[];
  markets: MarketPair[];
  trades: SpotTrade[];
  staking: StakingPosition[];
  presaleRounds: PresaleRound[];
  presaleTickets: PresaleTicket[];
  luckyDraws: LuckyDraw[];
  jackpotTickets: JackpotTicket[];
  referrals: ReferralItem[];
  transactions: LedgerEntry[];
  kycSubmissions?: KycSubmission[];
  auditLogs?: AdminAuditLog[];
  platformSettings?: PlatformSettings;
  projectSummary?: AdminProjectSummary;
  supportUnreadCount?: number;
}

export type AdminTab =
  | 'DASHBOARD'
  | 'USERS'
  | 'DEPOSITS'
  | 'WITHDRAWALS'
  | 'SEND'
  | 'P2P'
  | 'SPOT'
  | 'STAKING'
  | 'PRESALE'
  | 'REWARDS'
  | 'SUPPORT'
  | 'TRANSACTIONS'
  | 'AUDIT_LOGS'
  | 'SETTINGS';

export type UserFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'VERIFIED' | 'UNVERIFIED';

export interface AdminMetrics {
  totalMain: number;
  totalClaimable: number;
  totalLocked: number;
  totalLiquidity: number;
  activeUsers: number;
  inactiveUsers: number;
  verifiedUsers: number;
  unverifiedUsers: number;
  pendingDepositsCount: number;
  pendingDepositsAmt: number;
  approvedDepositsTotal: number;
  pendingWithdrawalsCount: number;
  pendingWithdrawalsAmt: number;
  approvedWithdrawalsTotal: number;
  disputedP2p: number;
  openTradesCount: number;
  openTradesVolume: number;
  activeStakingCount: number;
  totalStakedPrincipal: number;
  totalStakingProfitPaid: number;
  pendingPresaleTickets: number;
  pendingReferrals: number;
  totalPendingQueue: number;
}

export interface SpotStats {
  totalTradesCount: number;
  totalVolumeUsd: number;
  openTradesCount: number;
  openPositionCount: number;
  openLimitCount: number;
  openExposureUsd: number;
  liveUnrealizedPnl: number;
  settledCount: number;
  settledPnl: number;
  takerFeeUsd: number;
  makerFeeUsd: number;
  totalFeeUsd: number;
  liquidationUsd: number;
  liquidationCount: number;
}

export interface JackpotStats {
  openDraw: LuckyDraw | null;
  completedCount: number;
  activeTicketsSold: number;
  uniqueParticipantsCount: number;
  activeTicketRevenueUsd: number;
  basePoolUsd: number;
  ticketContributionUsd: number;
  totalTicketsRevenue: number;
  platformFeeUsd: number;
  totalPrizesPaid: number;
  daysRemaining: number;
}

export type RunActionFn = (fn: () => Promise<string>) => Promise<void>;

export type AdminNavBadgeMap = Partial<Record<AdminTab, { count?: number; urgent?: boolean }>>;
