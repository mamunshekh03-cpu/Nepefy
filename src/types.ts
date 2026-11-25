export type UserRole = 'USER' | 'ADMIN';
export type UserAccountStatus = 'ACTIVE' | 'INACTIVE';
export type UserKycStatus = 'VERIFIED' | 'UNVERIFIED';

export interface UserVerificationSummary {
  verified: boolean;
  completedCount: number;
  totalCount: number;
  progressPct: number;
  steps: {
    personalInfo: {
      completed: boolean;
      missingFields: string[];
    };
    strongPassword: {
      completed: boolean;
    };
    twoFactor: {
      completed: boolean;
    };
    paymentMethod: {
      completed: boolean;
      count: number;
    };
  };
}

export interface UserProfile {
  id: string;
  uid?: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  phone?: string;
  country?: string;
  date_of_birth?: string;
  address?: string;
  occupation?: string;
  bio?: string;
  has_password?: boolean;
  strong_password_set?: boolean;
  two_fa_enabled?: boolean;
  role: UserRole;
  status?: UserAccountStatus;
  kyc_status?: UserKycStatus;
  kyc_doc_status?: string;
  kyc_submission?: KycSubmission | null;
  verification?: UserVerificationSummary;
  main_balance: number;
  claimable_balance: number;
  locked_balance: number;
  profit_balance?: number;
  referral_code: string;
  referred_by: string | null;
  first_deposit_rewarded: number;
  created_at: string;
}

export interface PlatformSettings {
  binancePayId: string;
  bybitUid: string;
  minDepositUsd: number;
  maxDepositUsd: number;
  minWithdrawUsd: number;
  maxWithdrawUsd: number;
  withdrawFeeUsd: number;
  p2pFeeUsd: number;
  sendFeeUsd: number;
  presaleNetworkFeeUsd: number;
  spotMakerFeePct?: number;
  spotTakerFeePct?: number;
  stakingEmergencyPenaltyRate: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  androidApkUrl?: string;
  androidApkVersion?: string;
  androidApkAvailable?: boolean;
}

export interface KycSubmission {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_uid?: string;
  doc_type: 'NID' | 'PASSPORT' | 'DRIVING_LICENSE';
  legal_name: string;
  doc_number: string;
  doc_front_data: string;
  selfie_data?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserNotification {
  id: string;
  user_id: string;
  category: 'FUNDING' | 'TRADING' | 'STAKING' | 'KYC' | 'REWARDS' | 'SECURITY' | 'P2P' | 'SYSTEM';
  title: string;
  message: string;
  link_tab?: string | null;
  is_read: number;
  created_at: string;
}

export interface LoginSession {
  id: string;
  device_info: string;
  ip_address: string;
  is_revoked: boolean;
  is_current: boolean;
  created_at: string;
  last_active_at: string;
}

export type UserPaymentMethodType =
  | 'Binance Pay'
  | 'Bybit Pay'
  | 'Nagad'
  | 'bKash'
  | 'Rocket'
  | 'Bank Wire';

export interface UserPaymentMethod {
  id: string;
  user_id: string;
  method: UserPaymentMethodType;
  account_label: string;
  account_number: string;
  extra_details: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface CoinHolding {
  user_id: string;
  asset: string;
  quantity: number;
  avg_entry_price: number;
}

export type LedgerStatus = 'PENDING' | 'SUCCESS' | 'REJECTED' | 'FAILED';

export interface LedgerEntry {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  wallet_type: 'MAIN' | 'CLAIMABLE';
  tx_type: string;
  status?: LedgerStatus;
  amount: number;
  balance_after: number | null;
  reference_id: string;
  description: string;
  fee_usd?: number | null;
  fee_role?: string | null;
  created_at: string;
}

export interface DepositRequest {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  amount: number;
  gateway: 'Binance' | 'Bybit';
  trx_id: string;
  screenshot_data: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface WithdrawRequest {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  amount: number;
  fee_usd?: number;
  gateway: 'Binance' | 'Bybit';
  destination_address: string;
  proof_note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface P2POffer {
  id: string;
  creator_id: string;
  creator_name: string;
  creator_email: string;
  creator_uid?: string;
  creator_kyc_status?: UserKycStatus;
  creator_orders_count?: number;
  creator_completed_count?: number;
  creator_disputed_count?: number;
  payment_window_min?: number;
  side: 'BUY' | 'SELL';
  total_amount: number;
  available_amount: number;
  min_limit: number;
  max_limit: number;
  rate_usd: number;
  fiat_currency?: string;
  payment_method: string;
  terms: string;
  status: string;
  created_at: string;
}

export interface P2POrder {
  id: string;
  offer_id: string;
  buyer_id: string;
  seller_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_uid?: string;
  seller_name: string;
  seller_email: string;
  seller_uid?: string;
  amount_vusd: number;
  fee_usd?: number;
  fiat_total: number;
  fiat_currency?: string;
  payment_method: string;
  payment_reference: string | null;
  seller_payment_snapshot?: string | null;
  offer_terms?: string | null;
  status: 'ESCROW_LOCKED' | 'PAID' | 'COMPLETED' | 'DISPUTED' | 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'CANCELLED';
  dispute_reason: string | null;
  dispute_opened_by?: string | null;
  admin_resolution_note: string | null;
  expires_at?: string | null;
  paid_at?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export interface P2PMessage {
  id: string;
  order_id: string;
  sender_id: string | null;
  sender_name?: string | null;
  sender_role: 'BUYER' | 'SELLER' | 'SYSTEM' | 'ADMIN';
  msg_type: 'TEXT' | 'SYSTEM' | 'RELEASE_REQUEST' | 'RECEIPT';
  body: string;
  attachment_data?: string | null;
  created_at: string;
}

export interface MarketTickPoint {
  time: number;
  price: number;
  bid: number;
  ask: number;
}

export interface MarketPair {
  symbol: string;
  base_asset: string;
  name: string;
  current_price: number;
  bid: number;
  ask: number;
  spread_bps: number;
  target_price: number | null;
  volatility_pct: number;
  auto_drift: number;
  change_24h_pct: number;
  high_24h?: number;
  low_24h?: number;
  turnover_24h?: number;
  updated_at: string;
  history: MarketTickPoint[];
}

export interface SpotTrade {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  symbol: string;
  order_mode: 'SPOT' | 'LIMIT' | 'POSITION';
  side: 'BUY' | 'SELL' | 'LONG' | 'SHORT';
  amount_usd: number;
  quantity: number;
  entry_price: number;
  exit_price: number | null;
  limit_price?: number | null;
  spread_bps: number;
  fee_usd?: number;
  fee_role?: 'TAKER' | 'MAKER';
  is_liquidated?: number;
  pnl_usd: number;
  admin_override: 'NONE' | 'FORCE_WIN' | 'FORCE_LOSS';
  tp_price?: number | null;
  sl_price?: number | null;
  status: 'OPEN' | 'SETTLED' | 'CANCELLED';
  created_at: string;
  settled_at: string | null;
}

export interface AdminProjectSummary {
  spot: {
    totalOrders: number;
    totalVolumeUsd: number;
    takerFeeUsd: number;
    takerOrdersCount: number;
    makerFeeUsd: number;
    makerOrdersCount: number;
    totalFeeUsd: number;
    liquidationUsd: number;
    liquidationCount: number;
    settledPositionTraderPnl: number;
    settledPositionCount: number;
    settledSpotCount: number;
    openExposureUsd: number;
    openCount: number;
    platformNetPnl: number;
  };
  presale: {
    totalTickets: number;
    totalLots: number;
    totalPrincipalUsd: number;
    networkFeesUsd: number;
    pendingPrincipalUsd: number;
    pendingCount: number;
    winCount: number;
    winPayoutsUsd: number;
    winBonusCostUsd: number;
    lossCount: number;
    lossRefundsUsd: number;
    platformNetPnl: number;
  };
  staking: {
    totalPositions: number;
    activeCount: number;
    activePrincipalUsd: number;
    completedCount: number;
    completedPrincipalUsd: number;
    emergencyCount?: number;
    emergencyPrincipalUsd?: number;
    emergencyPenaltiesUsd?: number;
    roiPaidUsd: number;
    accruedProfitLiabilityUsd?: number;
    monthlyDrawPaidUsd: number;
    totalCostUsd: number;
    platformNetPnl: number;
  };
  rewards: {
    referralsCreditedCount: number;
    referralsCreditedUsd: number;
    referralsPendingCount: number;
    referralsPendingUsd: number;
    milestoneClaimsCount?: number;
    milestoneBonusPaidUsd?: number;
    luckyDrawsCompletedCount: number;
    luckyDrawPrizesPaidUsd: number;
    luckyDrawOpenPoolUsd: number;
    platformNetPnl: number;
  };
  settlements: {
    depositsApprovedCount: number;
    depositsApprovedUsd: number;
    depositsPendingCount: number;
    depositsPendingUsd: number;
    withdrawalsApprovedCount: number;
    withdrawalsApprovedUsd: number;
    withdrawalsPendingCount: number;
    withdrawalsPendingUsd: number;
    netCashflowUsd: number;
    p2pSettledCount: number;
    p2pSettledUsd: number;
    p2pEscrowCount: number;
    p2pEscrowUsd: number;
    p2pDisputedCount: number;
    withdrawFeesUsd?: number;
    p2pFeesUsd?: number;
    sendFeesUsd?: number;
    userMainLiabilityUsd: number;
    userClaimableLiabilityUsd: number;
    userLockedLiabilityUsd: number;
    userProfitLiabilityUsd?: number;
    userTotalLiabilityUsd: number;
  };
  totals: {
    grossRevenueUsd: number;
    grossExpensesUsd: number;
    netProjectPnlUsd: number;
  };
}

export interface StakingPosition {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  package_code: '6M' | '12M' | '24M' | '36M';
  duration_months: number;
  annual_roi_pct: number;
  principal_amount: number;
  total_profit_paid: number;
  months_paid: number;
  quarters_paid: number;
  total_quarters: number;
  monthly_draw_entries: number;
  next_payout_at: string;
  status: 'ACTIVE' | 'COMPLETED' | 'EMERGENCY_WITHDRAWN';
  penalty_amount?: number;
  emergency_payout_at?: string | null;
  created_at: string;
  monthly_profit?: number;
  daily_profit?: number;
  accrued_days?: number;
  accrued_profit?: number;
  locked_daily_profit?: number;
  claimable_months?: number;
  claimable_profit?: number;
  can_claim?: boolean;
  days_until_next_payout?: number;
  cycle_day?: number;
  next_daily_accrual_at?: string | null;
  emergency_penalty_rate?: number;
  emergency_penalty_amount?: number;
  emergency_net_principal?: number;
}

export interface StakingDailyLog {
  id: string;
  user_id: string;
  position_id: string;
  package_code: string;
  day_number: number;
  daily_amount: number;
  total_accrued: number;
  credited_at: string;
}

export interface StakingProfitSummary {
  totalProfitBalance: number;
  unlockedWithdrawableProfit: number;
  lockedDailyProfit: number;
  dailyRateTotal: number;
  monthlyRateTotal: number;
}

export interface PresaleRound {
  id: string;
  token_symbol: string;
  token_name: string;
  face_value?: number;
  lot_size?: number;
  issue_price?: number;
  lot_price: number;
  network_fee: number;
  tokens_per_lot: number;
  projected_win_payout: number;
  total_lots: number;
  total_issue_size?: number;
  sold_lots: number;
  draw_date: string;
  listing_date?: string;
  min_lots?: number;
  max_lots?: number;
  winning_number?: string | null;
  status: string;
  created_at: string;
}

export interface PresaleTicket {
  id: string;
  round_id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  token_symbol: string;
  token_name?: string;
  lot_price?: number;
  tokens_per_lot: number;
  projected_win_payout: number;
  lots_count: number;
  ticket_numbers?: string[];
  winning_number?: string | null;
  draw_date?: string;
  principal_paid: number;
  fee_paid: number;
  result: 'PENDING' | 'WIN' | 'LOSS';
  payout_amount: number;
  settled_at: string | null;
  created_at: string;
}

export interface LuckyDraw {
  id: string;
  quarter_label: string;
  title?: string;
  prize_pool: number;
  ticket_price?: number;
  tickets_sold?: number;
  ticket_revenue_usd?: number;
  unique_participants?: number;
  winner_user_id: string | null;
  winner_email: string | null;
  winner_name?: string | null;
  winning_ticket_number?: string | null;
  draw_hash?: string | null;
  status: 'OPEN' | 'COMPLETED';
  draw_at: string;
  created_at: string;
}

export interface JackpotTicket {
  id: string;
  draw_id: string;
  quarter_label?: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  ticket_count: number;
  ticket_numbers?: string[];
  cost_usd: number;
  status: 'ACTIVE' | 'WON' | 'LOST';
  prize_won: number;
  winning_ticket_number?: string | null;
  created_at: string;
}

export interface JackpotLeaderboardEntry {
  rank: number;
  user_name: string;
  uid: string;
  is_me: boolean;
  ticket_count: number;
  cost_usd: number;
  has_bonus_entry: boolean;
  total_entries: number;
  entry_share_pct: number;
}

export interface JackpotOverviewData {
  activeDraw: LuckyDraw | null;
  history: LuckyDraw[];
  myTickets: JackpotTicket[];
  myActiveTicketCount: number;
  totalActiveTickets: number;
  totalActiveEntries: number;
  uniqueParticipantsCount?: number;
  qualifiedBonusCount?: number;
  basePoolUsd?: number;
  ticketContributionUsd?: number;
  treasuryFeeUsd?: number;
  isEligibleBonusEntry: boolean;
  myWinChancePct: number;
  recentParticipants: {
    id: string;
    user_name: string;
    uid?: string;
    is_me?: boolean;
    ticket_count: number;
    ticket_numbers?: string[];
    cost_usd: number;
    created_at: string;
  }[];
  leaderboard?: JackpotLeaderboardEntry[];
  totalPrizesWonAllTime: number;
}

export interface ReferralItem {
  id: string;
  referrer_id: string;
  referrer_name?: string;
  referrer_email?: string;
  referred_user_id: string;
  referred_name: string;
  referred_email: string;
  referred_balance?: number;
  referred_kyc_status?: UserKycStatus;
  balance_qualified?: boolean;
  bonus_amount: number;
  status: 'PENDING_DEPOSIT' | 'CREDITED_CLAIMABLE';
  created_at: string;
  credited_at: string | null;
}

export interface ReferralMilestone {
  tierCode: 'TIER_10' | 'TIER_25' | 'TIER_50' | 'TIER_100';
  title: string;
  targetCount: number;
  bonusUsd: number;
  currentCount: number;
  unlocked: boolean;
  claimed: boolean;
  claimedAt: string | null;
}

export interface ReferralOverviewStats {
  perReferralUsdt: number;
  balanceThresholdUsdt: number;
  requiredVerifiedSignups: number;
  verifiedSignupsCount: number;
  incomeActive: boolean;
  totalInvitedCount: number;
  balanceQualifiedCount: number;
  creditedCount: number;
  queuedCount: number;
  queuedUsd: number;
  totalReferralEarnedUsd: number;
  totalMilestoneEarnedUsd: number;
}

export type SupportThreadCategory =
  | 'GENERAL'
  | 'DEPOSIT_WITHDRAW'
  | 'P2P_DISPUTE'
  | 'ACCOUNT_KYC'
  | 'TRADING';

export type SupportThreadStatus = 'OPEN' | 'RESOLVED';

export interface SupportThread {
  id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  user_uid?: string;
  user_avatar_url?: string | null;
  user_kyc_status?: UserKycStatus;
  user_main_balance?: number;
  subject: string;
  category: SupportThreadCategory;
  status: SupportThreadStatus;
  user_unread: number;
  admin_unread: number;
  last_message: string | null;
  last_message_at: string | null;
  message_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  thread_id: string;
  sender_id: string | null;
  sender_name?: string | null;
  sender_role: 'USER' | 'ADMIN' | 'SYSTEM';
  body: string;
  attachment_data?: string | null;
  created_at: string;
}

export interface SupportLiveSignal {
  seq: number;
  type: 'SUPPORT_THREAD_CREATED' | 'SUPPORT_THREAD_UPDATED' | 'SUPPORT_CHAT_MESSAGE';
  threadId?: string;
  thread?: SupportThread;
  message?: SupportMessage;
}

export interface AdminAuditLog {
  id: string;
  admin_id: string;
  admin_email: string;
  action_type: string;
  target_type: string;
  target_id: string;
  summary: string;
  ip_address: string;
  created_at: string;
}
