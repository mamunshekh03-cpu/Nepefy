import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { WebSocketServer, WebSocket } from 'ws';
import { db, getDatabaseMode, initDatabase, generateId, generateShortTicketId, generateUnique8DigitUid, appendLedger } from './server/db.ts';
import { requireAuth, requireAdmin, signToken, verifyToken, type AuthenticatedRequest } from './server/auth.ts';
import { buildOtpAuthUrl, generateBase32Secret, verifyTotpCode } from './server/totp.ts';
import { isSupabaseStorageConfigured, uploadImageAsset } from './server/storage.ts';
import { isEmailProviderConfigured, sendOtpEmail } from './server/email.ts';
import {
  initMarketEngine,
  getMarketSnapshot,
  computeBidAsk,
  addGlobalLiveMarketPair,
  calculatePositionPnl,
  fetchLiveKlines,
  fetchLiveOrderBookAndTrades,
  getPriceDecimals,
  setMarketTradeEventCallback,
  getSpotFeeRates,
  setSpotFeeRates,
  type MarketPairRow,
} from './server/marketEngine.ts';
import { COUNTRIES } from './src/lib/countries.ts';

const PORT = Number(process.env.PORT || 3000);

export interface PlatformSettingsConfig {
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
  spotMakerFeePct: number;
  spotTakerFeePct: number;
  stakingEmergencyPenaltyRate: number;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  androidApkUrl: string;
  androidApkVersion: string;
  androidApkAvailable: boolean;
}

const LOCAL_APK_PATH = path.resolve(process.cwd(), 'public', 'downloads', 'nepefy.apk');

function resolveValidApkUrl(raw?: string | null): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    // ignore invalid URL
  }
  return '';
}

async function getPlatformSettings(): Promise<PlatformSettingsConfig> {
  const rows = (await db.prepare('SELECT key, value FROM platform_settings').all()) as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const num = (key: string, fallback: number) => {
    const parsed = Number(map.get(key));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const apkUrl = resolveValidApkUrl(map.get('android_apk_url')) || resolveValidApkUrl(process.env.ANDROID_APK_URL);
  const localApkExists = fs.existsSync(LOCAL_APK_PATH);
  return {
    binancePayId: map.get('binance_pay_id') || '904182775',
    bybitUid: map.get('bybit_uid') || '55109283',
    minDepositUsd: Math.max(1, num('min_deposit_usd', 10)),
    maxDepositUsd: Math.max(10, num('max_deposit_usd', 100000)),
    minWithdrawUsd: Math.max(1, num('min_withdraw_usd', 10)),
    maxWithdrawUsd: Math.max(10, num('max_withdraw_usd', 50000)),
    withdrawFeeUsd: num('withdraw_fee_usd', 1.0),
    p2pFeeUsd: num('p2p_fee_usd', 0.1),
    sendFeeUsd: num('send_fee_usd', 0.2),
    presaleNetworkFeeUsd: num('presale_network_fee_usd', 0.5),
    spotMakerFeePct: Math.min(5, num('spot_maker_fee_pct', 0.02)),
    spotTakerFeePct: Math.min(5, num('spot_taker_fee_pct', 0.03)),
    stakingEmergencyPenaltyRate: Math.min(0.25, num('staking_emergency_penalty_rate', 0.005)),
    maintenanceMode: map.get('maintenance_mode') === '1',
    maintenanceMessage:
      map.get('maintenance_message') || 'Scheduled exchange maintenance is in progress. Please check back shortly.',
    androidApkUrl: apkUrl,
    androidApkVersion: map.get('android_apk_version') || '2.4.0',
    androidApkAvailable: localApkExists || Boolean(apkUrl),
  };
}

let pushUserWsFn: ((userId: string, payload: unknown) => void) | null = null;
let pushAdminsWsFn: ((payload: unknown) => void) | null = null;

async function createUserNotification(params: {
  userId: string;
  category: 'FUNDING' | 'TRADING' | 'STAKING' | 'KYC' | 'REWARDS' | 'SECURITY' | 'P2P' | 'SYSTEM';
  title: string;
  message: string;
  linkTab?: string;
}) {
  try {
    const id = generateId('NTF');
    const createdAt = new Date().toISOString();
    await db
      .prepare(`
        INSERT INTO notifications (id, user_id, category, title, message, link_tab, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `)
      .run(id, params.userId, params.category, params.title, params.message, params.linkTab || null, createdAt);
    const notification = await db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
    if (notification && pushUserWsFn) {
      pushUserWsFn(params.userId, { type: 'NOTIFICATION_NEW', notification });
    }
    return notification;
  } catch {
    return null;
  }
}

function extractClientIp(req: express.Request): string {
  const rawIp = String(req.ip || req.socket?.remoteAddress || '127.0.0.1');
  return rawIp.split(',')[0].trim().replace(/^::ffff:/, '').slice(0, 48) || '127.0.0.1';
}

async function recordLoginSession(req: express.Request, userId: string, jti: string): Promise<void> {
  try {
    const ua = String(req.headers['user-agent'] || 'Web Browser').slice(0, 140);
    const ip = extractClientIp(req);
    const now = new Date().toISOString();
    await db
      .prepare(`
        INSERT INTO login_sessions (id, user_id, jti, device_info, ip_address, is_revoked, created_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `)
      .run(generateId('SES'), userId, jti, ua, ip, now, now);
  } catch {
    // non-fatal session telemetry
  }
}

async function recordAdminAuditLog(params: {
  req: AuthenticatedRequest;
  actionType: string;
  targetType: string;
  targetId?: string;
  summary: string;
}): Promise<void> {
  try {
    const adminId = params.req.auth?.userId || 'ADMIN';
    const adminEmail = params.req.auth?.email || 'admin@nepefy.app';
    const ip = extractClientIp(params.req);
    await db
      .prepare(`
        INSERT INTO admin_audit_logs (id, admin_id, admin_email, action_type, target_type, target_id, summary, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        generateId('AUD'),
        adminId,
        adminEmail,
        params.actionType,
        params.targetType,
        String(params.targetId || ''),
        params.summary.slice(0, 300),
        ip,
        new Date().toISOString()
      );
  } catch {
    // non-fatal audit logging
  }
}

function createRateLimiter(options: { windowMs: number; max: number; keyPrefix: string }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets.entries()) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }, Math.max(30_000, options.windowMs));
  cleanupInterval.unref();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = extractClientIp(req);
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    if (bucket.count > options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec}s before trying again.`,
        retryAfterSec,
      });
      return;
    }
    next();
  };
}

const REFERRAL_PER_USER_USD = 15.0;
const REFERRAL_BALANCE_THRESHOLD_USD = 500.0;
const REFERRAL_REQUIRED_VERIFIED_SIGNUPS = 10;
const REFERRAL_MILESTONE_TIERS = [
  { tierCode: 'TIER_10', title: 'Bronze Partner', targetCount: 10, bonusUsd: 100.0 },
  { tierCode: 'TIER_25', title: 'Silver Affiliate', targetCount: 25, bonusUsd: 200.0 },
  { tierCode: 'TIER_50', title: 'Gold Affiliate', targetCount: 50, bonusUsd: 300.0 },
  { tierCode: 'TIER_100', title: 'Diamond Ambassador', targetCount: 100, bonusUsd: 500.0 },
] as const;

const STAKING_EMERGENCY_PENALTY_RATE = 0.005; // Default fallback; live value read from platform_settings
const STAKING_PACKAGES: Record<string, { durationMonths: number; annualRoiPct: number; totalQuarters: number }> = {
  '6M': { durationMonths: 6, annualRoiPct: 18, totalQuarters: 2 },
  '12M': { durationMonths: 12, annualRoiPct: 20, totalQuarters: 4 },
  '24M': { durationMonths: 24, annualRoiPct: 22, totalQuarters: 8 },
  '36M': { durationMonths: 36, annualRoiPct: 25, totalQuarters: 12 },
};

function isStrongPasswordValue(password: string): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < 8 || password.length > 72) return false;
  return (
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

async function computeUserVerification(row: any) {
  const missingFields: string[] = [];
  if (!row.full_name || String(row.full_name).trim().length < 2) missingFields.push('Full Name');
  if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.email).trim())) missingFields.push('Email');
  if (!row.phone || String(row.phone).trim().length < 5) missingFields.push('Phone Number');
  if (!row.country || String(row.country).trim().length < 2) missingFields.push('Country / Region');
  if (!row.date_of_birth || String(row.date_of_birth).trim().length < 4) missingFields.push('Date of Birth');
  if (!row.address || String(row.address).trim().length < 4) missingFields.push('Residential Address');
  if (!row.occupation || String(row.occupation).trim().length < 2) missingFields.push('Occupation');

  const paymentCountRow = (await db
    .prepare('SELECT COUNT(*) as cnt FROM user_payment_methods WHERE user_id = ?')
    .get(row.id)) as { cnt: number } | undefined;
  const paymentCount = Number(paymentCountRow?.cnt || 0);

  const personalInfoDone = missingFields.length === 0;
  const strongPasswordDone = Number(row.strong_password_set) === 1;
  const twoFactorDone = Number(row.two_fa_enabled) === 1;
  const paymentMethodDone = paymentCount > 0;

  const completedCount =
    (personalInfoDone ? 1 : 0) +
    (strongPasswordDone ? 1 : 0) +
    (twoFactorDone ? 1 : 0) +
    (paymentMethodDone ? 1 : 0);
  const totalCount = 4;
  const verified = completedCount === totalCount;

  return {
    verified,
    completedCount,
    totalCount,
    progressPct: Math.round((completedCount / totalCount) * 100),
    steps: {
      personalInfo: {
        completed: personalInfoDone,
        missingFields,
      },
      strongPassword: {
        completed: strongPasswordDone,
      },
      twoFactor: {
        completed: twoFactorDone,
      },
      paymentMethod: {
        completed: paymentMethodDone,
        count: paymentCount,
      },
    },
  };
}

async function syncReferralRewardsForReferrer(referrerId: string | null | undefined): Promise<void> {
  if (!referrerId) return;
  const rows = (await db
    .prepare(`
      SELECT
        r.id,
        r.referrer_id,
        r.referred_user_id,
        r.bonus_amount,
        r.status,
        u.full_name as referred_name,
        u.kyc_status as referred_kyc_status,
        (COALESCE(u.main_balance, 0) + COALESCE(u.locked_balance, 0)) as referred_balance
      FROM referrals r
      JOIN users u ON r.referred_user_id = u.id
      WHERE r.referrer_id = ?
    `)
    .all(referrerId)) as any[];

  if (rows.length === 0) return;

  const verifiedCount = rows.filter((r) => r.referred_kyc_status === 'VERIFIED').length;
  const incomeActive = verifiedCount >= REFERRAL_REQUIRED_VERIFIED_SIGNUPS;
  if (!incomeActive) return;

  const readyToCredit = rows.filter(
    (r) => r.status === 'PENDING_DEPOSIT' && Number(r.referred_balance || 0) >= REFERRAL_BALANCE_THRESHOLD_USD
  );
  if (readyToCredit.length === 0) return;

  await db.transaction(async () => {
    const now = new Date().toISOString();
    for (const ref of readyToCredit) {
      const freshRef = (await db.prepare('SELECT id, status, bonus_amount FROM referrals WHERE id = ?').get(ref.id)) as any;
      if (!freshRef || freshRef.status !== 'PENDING_DEPOSIT') continue;

      const referrer = (await db.prepare('SELECT id, claimable_balance FROM users WHERE id = ?').get(referrerId)) as any;
      if (!referrer) break;

      const bonus = Number(freshRef.bonus_amount || REFERRAL_PER_USER_USD);
      const nextClaimable = Number((Number(referrer.claimable_balance || 0) + bonus).toFixed(2));
      await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, referrer.id);
      await db
        .prepare("UPDATE referrals SET status = 'CREDITED_CLAIMABLE', credited_at = ? WHERE id = ?")
        .run(now, freshRef.id);

      await appendLedger(
        referrer.id,
        'CLAIMABLE',
        'REFERRAL_BONUS',
        bonus,
        nextClaimable,
        freshRef.id,
        `Referral Bonus ($${bonus.toFixed(2)}) — ${ref.referred_name} reached $${REFERRAL_BALANCE_THRESHOLD_USD.toFixed(2)} balance`
      );
      await createUserNotification({
        userId: referrer.id,
        category: 'REWARDS',
        title: 'Referral Bonus Credited',
        message: `+$${bonus.toFixed(2)} USDT unlocked in Claimable Wallet for ${ref.referred_name}.`,
        linkTab: 'referrals',
      });
    }
  })();
}

async function buildUserReferralOverview(userId: string) {
  await syncReferralRewardsForReferrer(userId);
  const user = (await db.prepare('SELECT id, referral_code, claimable_balance FROM users WHERE id = ?').get(userId)) as any;
  const rawReferrals = (await db
    .prepare(`
      SELECT
        r.*,
        u.full_name as referred_name,
        u.email as referred_email,
        u.kyc_status as referred_kyc_status,
        (COALESCE(u.main_balance, 0) + COALESCE(u.locked_balance, 0)) as referred_balance
      FROM referrals r
      JOIN users u ON r.referred_user_id = u.id
      WHERE r.referrer_id = ?
      ORDER BY r.created_at DESC
    `)
    .all(userId)) as any[];

  const referrals = rawReferrals.map((r) => {
    const bal = Number((Number(r.referred_balance || 0)).toFixed(2));
    const balanceQualified = bal >= REFERRAL_BALANCE_THRESHOLD_USD || r.status === 'CREDITED_CLAIMABLE';
    return {
      ...r,
      referred_balance: bal,
      balance_qualified: balanceQualified,
    };
  });

  const verifiedSignupsCount = referrals.filter((r) => r.referred_kyc_status === 'VERIFIED').length;
  const incomeActive = verifiedSignupsCount >= REFERRAL_REQUIRED_VERIFIED_SIGNUPS;
  const balanceQualifiedCount = referrals.filter((r) => r.balance_qualified).length;
  const creditedList = referrals.filter((r) => r.status === 'CREDITED_CLAIMABLE');
  const queuedList = referrals.filter((r) => r.status !== 'CREDITED_CLAIMABLE' && r.balance_qualified);

  const claims = (await db
    .prepare('SELECT * FROM referral_milestone_claims WHERE user_id = ?')
    .all(userId)) as any[];

  const milestones = REFERRAL_MILESTONE_TIERS.map((tier) => {
    const claim = claims.find((c) => c.tier_code === tier.tierCode);
    return {
      tierCode: tier.tierCode,
      title: tier.title,
      targetCount: tier.targetCount,
      bonusUsd: tier.bonusUsd,
      currentCount: balanceQualifiedCount,
      unlocked: incomeActive && balanceQualifiedCount >= tier.targetCount,
      claimed: Boolean(claim),
      claimedAt: claim?.claimed_at || null,
    };
  });

  const totalReferralEarnedUsd = Number(
    creditedList.reduce((sum, r) => sum + Number(r.bonus_amount || 0), 0).toFixed(2)
  );
  const totalMilestoneEarnedUsd = Number(
    claims.reduce((sum, c) => sum + Number(c.bonus_amount || 0), 0).toFixed(2)
  );
  const queuedUsd = Number(
    queuedList.reduce((sum, r) => sum + Number(r.bonus_amount || REFERRAL_PER_USER_USD), 0).toFixed(2)
  );

  return {
    referralCode: user.referral_code,
    referrals,
    referralStats: {
      perReferralUsdt: REFERRAL_PER_USER_USD,
      balanceThresholdUsdt: REFERRAL_BALANCE_THRESHOLD_USD,
      requiredVerifiedSignups: REFERRAL_REQUIRED_VERIFIED_SIGNUPS,
      verifiedSignupsCount,
      incomeActive,
      totalInvitedCount: referrals.length,
      balanceQualifiedCount,
      creditedCount: creditedList.length,
      queuedCount: queuedList.length,
      queuedUsd,
      totalReferralEarnedUsd,
      totalMilestoneEarnedUsd,
    },
    milestones,
  };
}

async function getLatestKycSubmission(userId: string) {
  return (await db
    .prepare(
      'SELECT id, doc_type, legal_name, doc_number, status, admin_note, created_at, reviewed_at FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(userId)) as any;
}

async function syncUserVerification(userId: string) {
  const row = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
  if (!row) return null;
  const verification = await computeUserVerification(row);
  const latestKyc = await getLatestKycSubmission(userId);
  const docApproved = latestKyc?.status === 'APPROVED';
  const nextKyc = verification.verified || docApproved ? 'VERIFIED' : 'UNVERIFIED';
  if (row.kyc_status !== nextKyc) {
    await db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run(nextKyc, userId);
    row.kyc_status = nextKyc;
  }
  if (row.referred_by) {
    await syncReferralRewardsForReferrer(row.referred_by);
  }
  return row;
}

async function sanitizeUser(row: any) {
  if (!row) return null;
  const { password_hash, two_fa_secret, ...safe } = row;
  const [verification, latestKyc] = await Promise.all([
    computeUserVerification(row),
    getLatestKycSubmission(row.id),
  ]);
  const docApproved = latestKyc?.status === 'APPROVED';
  return {
    ...safe,
    has_password: Boolean(password_hash),
    strong_password_set: Boolean(row.strong_password_set),
    two_fa_enabled: Boolean(row.two_fa_enabled),
    kyc_status: verification.verified || docApproved || row.kyc_status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
    kyc_doc_status: latestKyc?.status || 'NONE',
    kyc_submission: latestKyc || null,
    verification,
  };
}

function verifySensitiveActionAuth(
  user: any,
  body: any
): { ok: true; method: 'AUTHENTICATOR' | 'PASSWORD' } | { ok: false; status: number; error: string } {
  if (Number(user.two_fa_enabled) === 1) {
    const codeStr = body?.totp_code !== undefined && body?.totp_code !== null ? String(body.totp_code).trim() : '';
    if (!codeStr) {
      return {
        ok: false,
        status: 400,
        error: '6-digit Authenticator verification code is required.',
      };
    }
    if (!verifyTotpCode(user.two_fa_secret, codeStr)) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid 6-digit Authenticator code. Check your authenticator app and try again.',
      };
    }
    return { ok: true, method: 'AUTHENTICATOR' };
  }

  const pwdRaw = body?.password;
  const pwdStr = pwdRaw !== undefined && pwdRaw !== null ? String(pwdRaw) : '';
  if (!pwdStr) {
    return {
      ok: false,
      status: 400,
      error: 'Account Password is required (or enable Authenticator in Profile & Security).',
    };
  }
  if (!user.password_hash || !bcrypt.compareSync(pwdStr, user.password_hash)) {
    return {
      ok: false,
      status: 401,
      error: 'Incorrect Account Password.',
    };
  }
  return { ok: true, method: 'PASSWORD' };
}

const ALLOWED_PAYMENT_METHODS = ['Binance Pay', 'Bybit Pay', 'Nagad', 'bKash', 'Rocket', 'Bank Wire'] as const;

function verifyStrict2faAuth(
  user: any,
  body: any
): { ok: true } | { ok: false; status: number; error: string } {
  if (Number(user.two_fa_enabled) !== 1 || !user.two_fa_secret) {
    return {
      ok: false,
      status: 403,
      error: '2FA Verification is required. Enable Authenticator (2FA) in Profile & Security first.',
    };
  }
  const codeStr = body?.totp_code !== undefined && body?.totp_code !== null ? String(body.totp_code).trim() : '';
  if (!/^\d{6}$/.test(codeStr)) {
    return {
      ok: false,
      status: 400,
      error: '6-digit 2FA Authenticator verification code is required.',
    };
  }
  if (!verifyTotpCode(user.two_fa_secret, codeStr)) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid 6-digit 2FA Authenticator code. Check your authenticator app and try again.',
    };
  }
  return { ok: true };
}

async function startServer() {
  await initDatabase();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.use(express.json({ limit: '10mb' }));

  const ah =
    (fn: (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => Promise<any> | any) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      Promise.resolve(fn(req as AuthenticatedRequest, res, next)).catch(next);
    };

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on('error', (err) => {
    console.warn('[ws] server error:', err?.message || err);
  });

  const userSockets = new Map<string, Set<WebSocket>>();
  const adminSockets = new Set<WebSocket>();
  const socketMeta = new WeakMap<WebSocket, { userId: string; role: string }>();

  const registerSocketIdentity = async (ws: WebSocket, tokenStr?: string | null) => {
    if (!tokenStr) return;
    try {
      const decoded = verifyToken(tokenStr);
      const user = (await db.prepare('SELECT id, role, status FROM users WHERE id = ?').get(decoded.userId)) as
        | { id: string; role: string; status?: string }
        | undefined;
      if (!user || user.status === 'INACTIVE') return;

      if (decoded.jti) {
        const session = (await db
          .prepare('SELECT is_revoked FROM login_sessions WHERE jti = ?')
          .get(decoded.jti)) as { is_revoked: number } | undefined;
        if (session && Number(session.is_revoked) === 1) return;
      }

      const prev = socketMeta.get(ws);
      if (prev) {
        userSockets.get(prev.userId)?.delete(ws);
        if (prev.role === 'ADMIN') adminSockets.delete(ws);
      }

      socketMeta.set(ws, { userId: user.id, role: user.role });
      if (!userSockets.has(user.id)) userSockets.set(user.id, new Set());
      userSockets.get(user.id)!.add(ws);
      if (user.role === 'ADMIN') {
        adminSockets.add(ws);
      }
    } catch {
      // ignore invalid WS auth token
    }
  };

  const pushToUser = (userId: string, payload: unknown) => {
    const sockets = userSockets.get(userId);
    if (!sockets || sockets.size === 0) return;
    const raw = JSON.stringify(payload);
    for (const sock of sockets) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(raw);
      }
    }
  };

  const pushToAdmins = (payload: unknown) => {
    if (adminSockets.size === 0) return;
    const raw = JSON.stringify(payload);
    for (const sock of adminSockets) {
      if (sock.readyState === WebSocket.OPEN) {
        sock.send(raw);
      }
    }
  };

  pushUserWsFn = pushToUser;
  pushAdminsWsFn = pushToAdmins;

  setMarketTradeEventCallback((ev) => {
    if (ev.triggerType === 'LIMIT_FILL') {
      const action = ev.side === 'SELL' ? 'Limit Sell Filled' : 'Limit Buy Filled';
      const pnlSuffix =
        ev.side === 'SELL' ? ` · P&L: ${ev.pnl >= 0 ? '+' : '-'}$${Math.abs(ev.pnl).toFixed(2)}` : '';
      createUserNotification({
        userId: ev.userId,
        category: 'TRADING',
        title: `${action} · ${ev.symbol}`,
        message: `${ev.qty ?? ''} ${ev.baseAsset || ''} filled at $${ev.exitPrice}${pnlSuffix}.`.trim(),
        linkTab: 'spot',
      }).catch(() => {});
      return;
    }
    const label = ev.triggerType === 'TP' ? 'Take-Profit Triggered' : ev.triggerType === 'SL' ? 'Stop-Loss Triggered' : 'Position Liquidated';
    const pnlText = ev.triggerType === 'LIQUIDATION' ? `Collateral liquidated @ $${ev.exitPrice}` : `Settled @ $${ev.exitPrice} (${ev.pnl >= 0 ? '+' : ''}$${ev.pnl.toFixed(2)})`;
    createUserNotification({
      userId: ev.userId,
      category: 'TRADING',
      title: `${label} · ${ev.symbol}`,
      message: `${ev.side} position ${ev.tradeId}: ${pnlText}.`,
      linkTab: 'spot',
    }).catch(() => {});
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as any).__authToken = url.searchParams.get('token');
          wss.emit('connection', ws, req);
        });
        return;
      }
      if (process.env.NODE_ENV === 'production' || url.pathname !== '/vite-hmr') {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  const bootSettings = await getPlatformSettings();
  setSpotFeeRates(bootSettings.spotMakerFeePct, bootSettings.spotTakerFeePct);
  await initMarketEngine(wss);

  wss.on('connection', async (ws) => {
    await registerSocketIdentity(ws, (ws as any).__authToken);

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === 'AUTH' && typeof msg.token === 'string') {
          await registerSocketIdentity(ws, msg.token);
        }
      } catch {
        // ignore malformed incoming frame
      }
    });

    ws.on('close', () => {
      const meta = socketMeta.get(ws);
      if (meta) {
        userSockets.get(meta.userId)?.delete(ws);
        if (userSockets.get(meta.userId)?.size === 0) {
          userSockets.delete(meta.userId);
        }
        if (meta.role === 'ADMIN') {
          adminSockets.delete(ws);
        }
      }
    });

    try {
      const pairs = await getMarketSnapshot();
      ws.send(
        JSON.stringify({
          type: 'MARKET_SNAPSHOT',
          pairs,
          timestamp: Date.now(),
        })
      );
    } catch {
      // ignore initial snapshot error on closed socket
    }
  });

  app.get('/api/health', ah(async (_req, res) => {
    try {
      await db.prepare('SELECT 1 as ok').get();
      const [adminRow, pairCountRow] = await Promise.all([
        db.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get(),
        db.prepare('SELECT COUNT(*) as cnt FROM market_pairs').get() as Promise<{ cnt?: number } | undefined>,
      ]);
      res.json({
        status: 'ok',
        database: getDatabaseMode(),
        storage: isSupabaseStorageConfigured() ? 'supabase' : 'inline',
        emailConfigured: isEmailProviderConfigured(),
        jwtConfigured: Boolean(process.env.JWT_SECRET?.trim() && process.env.JWT_SECRET.trim().length >= 16),
        adminConfigured: Boolean(adminRow),
        marketsCount: Number(pairCountRow?.cnt || 0),
        wsClients: wss.clients.size,
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
      });
    }
  }));

  app.get('/api/public/settings', ah(async (_req, res) => {
    res.json({ settings: await getPlatformSettings() });
  }));

  app.get('/downloads/nepefy.apk', ah(async (_req, res) => {
    if (fs.existsSync(LOCAL_APK_PATH)) {
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="Nepefy-Exchange.apk"');
      res.sendFile(LOCAL_APK_PATH);
      return;
    }
    const settings = await getPlatformSettings();
    if (settings.androidApkUrl) {
      res.redirect(302, settings.androidApkUrl);
      return;
    }
    res.status(404).json({
      error: 'Android APK binary is not published yet. Install the mobile Web App (PWA) or set an APK download URL in Admin Settings.',
    });
  }));

  // Maintenance mode gate for non-admin operational routes
  app.use('/api', ah(async (req, res, next) => {
    const settings = await getPlatformSettings();
    if (!settings.maintenanceMode) {
      next();
      return;
    }
    const p = req.path || '';
    if (
      p === '/health' ||
      p === '/public/settings' ||
      p === '/auth/login' ||
      p === '/auth/me' ||
      p === '/auth/forgot-password' ||
      p === '/auth/reset-password' ||
      p.startsWith('/admin') ||
      req.method === 'GET'
    ) {
      next();
      return;
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = verifyToken(authHeader.slice(7));
        const userRow = (await db.prepare('SELECT role FROM users WHERE id = ?').get(decoded.userId)) as
          | { role: string }
          | undefined;
        if (userRow?.role === 'ADMIN') {
          next();
          return;
        }
      } catch {
        // continue to maintenance rejection
      }
    }
    res.status(503).json({
      error: settings.maintenanceMessage,
      maintenance: true,
    });
  }));

  // Rate limiters for auth & sensitive financial/trading mutations
  const authRateLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 25, keyPrefix: 'auth' });
  const financialRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'fin' });

  app.use(
    [
      '/api/auth/login',
      '/api/auth/signup',
      '/api/auth/send-signup-otp',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/claim-admin',
    ],
    authRateLimiter
  );
  app.use(['/api/deposits', '/api/withdrawals', '/api/transfers/send', '/api/trades', '/api/staking', '/api/p2p', '/api/kyc'], (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
      financialRateLimiter(req, res, next);
      return;
    }
    next();
  });

  // Automatic Admin Audit Trail middleware for all /api/admin/* mutations
  app.use('/api/admin', (req: AuthenticatedRequest, res, next) => {
    if (!['POST', 'PUT', 'DELETE'].includes(req.method)) {
      next();
      return;
    }
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400 && req.auth?.role === 'ADMIN' && !res.locals.auditLogged) {
        const cleanPath = (req.path || '').replace(/^\/+|\/+$/g, '');
        const parts = cleanPath.split('/').filter(Boolean);
        const targetType = (parts[0] || 'SYSTEM').toUpperCase();
        const targetId = parts.length >= 2 && parts[1] !== 'rounds' && parts[1] !== 'offers' && parts[1] !== 'orders' && parts[1] !== 'tickets'
          ? parts[1]
          : parts[2] || String(req.body?.user_id || req.body?.symbol || '');
        const actionType = `${req.method}_${parts.join('_').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 40)}`;
        const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body).filter((k) => !k.toLowerCase().includes('password') && !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('data')).slice(0, 5) : [];
        const detailSnippet = bodyKeys.map((k) => `${k}=${String(req.body[k]).slice(0, 32)}`).join(', ');
        recordAdminAuditLog({
          req,
          actionType,
          targetType,
          targetId,
          summary: `${req.method} /api/admin/${cleanPath}${detailSnippet ? ` (${detailSnippet})` : ''}`,
        }).catch(() => {});
      }
    });
    next();
  });

  // ---------------------------------------------------------------------------
  // 1. AUTH & DUAL-WALLET ROUTES
  // ---------------------------------------------------------------------------

  const MAX_OTP_ATTEMPTS = 3;
  const otpFailAttempts = new Map<string, number>();
  const RASTER_IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i;

  const generateUniqueUserId = async (): Promise<string> => {
    for (let i = 0; i < 20; i++) {
      const candidate = `CL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const exists = await db.prepare('SELECT id FROM users WHERE id = ?').get(candidate);
      if (!exists) return candidate;
    }
    return `CL-${Date.now().toString(36).toUpperCase()}`;
  };

  const generateUniqueReferralCode = async (fullName: string): Promise<string> => {
    const prefix = String(fullName).replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'NEPE';
    for (let i = 0; i < 25; i++) {
      const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
      const candidate = `${prefix}${suffix}`;
      const exists = await db.prepare('SELECT id FROM users WHERE UPPER(referral_code) = UPPER(?)').get(candidate);
      if (!exists) return candidate;
    }
    return `REF${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  };

  app.post('/api/auth/send-signup-otp', ah(async (req, res) => {
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(emailRaw);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    otpFailAttempts.delete(`signup:${emailRaw}`);
    await db.prepare('UPDATE signup_otp_codes SET used = 1 WHERE LOWER(email) = ? AND used = 0').run(emailRaw);
    await db
      .prepare(`
        INSERT INTO signup_otp_codes (id, email, code, expires_at, used, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `)
      .run(generateId('OTP'), emailRaw, code, expiresAt, now.toISOString());

    const emailRes = await sendOtpEmail({ to: emailRaw, code, purpose: 'SIGNUP_OTP' });
    const providerConfigured = isEmailProviderConfigured();
    const allowOtpPreview = process.env.ALLOW_OTP_PREVIEW === 'true';
    if (!emailRes.delivered && !allowOtpPreview) {
      await db.prepare('UPDATE signup_otp_codes SET used = 1 WHERE LOWER(email) = ? AND used = 0').run(emailRaw);
      res.status(503).json({
        error: providerConfigured
          ? `Could not send verification email (${emailRes.error || 'provider rejected delivery'}). Please check your email settings.`
          : 'Email verification service is not configured on the server (set RESEND_API_KEY or SMTP settings).',
      });
      return;
    }
    res.json({
      message: emailRes.delivered
        ? `A 6-digit verification OTP has been sent to ${emailRaw} (valid for 10 minutes).`
        : 'A 6-digit email verification OTP has been issued (valid for 10 minutes).',
      emailDelivered: emailRes.delivered,
      provider: emailRes.provider,
      ...(allowOtpPreview ? { verificationCodePreview: code } : {}),
    });
  }));

  app.post('/api/auth/signup', ah(async (req, res) => {
    const { email, full_name, password, referral_code, otp_code } = req.body || {};
    if (!email || !full_name || !password) {
      res.status(400).json({ error: 'Email, full name, and Account Password are required' });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanFullName = String(full_name).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (cleanFullName.length < 2 || cleanFullName.length > 80) {
      res.status(400).json({ error: 'Full name must be between 2 and 80 characters.' });
      return;
    }
    const otpStr = String(otp_code || '').trim();
    if (!/^\d{6}$/.test(otpStr)) {
      res.status(400).json({ error: 'Please enter the 6-digit Email Verification OTP code.' });
      return;
    }
    const pwdStr = String(password);
    if (pwdStr.length < 6 || pwdStr.length > 72) {
      res.status(400).json({ error: 'Account Password must be between 6 and 72 characters' });
      return;
    }

    const existing = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const activeOtp = (await db
      .prepare('SELECT id FROM signup_otp_codes WHERE LOWER(email) = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
      .get(normalizedEmail)) as { id: string } | undefined;

    if (!activeOtp) {
      otpFailAttempts.delete(`signup:${normalizedEmail}`);
      res.status(400).json({ error: 'OTP is inactive or blocked. Please request a new verification OTP.' });
      return;
    }

    const otpRecord = (await db
      .prepare('SELECT * FROM signup_otp_codes WHERE LOWER(email) = ? AND code = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
      .get(normalizedEmail, otpStr)) as any;

    if (!otpRecord) {
      const attemptKey = `signup:${normalizedEmail}`;
      const fails = (otpFailAttempts.get(attemptKey) || 0) + 1;
      otpFailAttempts.set(attemptKey, fails);
      if (fails >= MAX_OTP_ATTEMPTS) {
        await db.prepare('UPDATE signup_otp_codes SET used = 1 WHERE LOWER(email) = ? AND used = 0').run(normalizedEmail);
        otpFailAttempts.delete(attemptKey);
        res.status(429).json({
          error: 'OTP blocked after 3 invalid attempts. Please request a new verification OTP.',
        });
        return;
      }
      const remaining = MAX_OTP_ATTEMPTS - fails;
      res.status(400).json({
        error: `Invalid Email Verification OTP code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before OTP is blocked.`,
      });
      return;
    }
    otpFailAttempts.delete(`signup:${normalizedEmail}`);
    if (Date.now() > Date.parse(otpRecord.expires_at)) {
      res.status(400).json({ error: 'Verification OTP expired. Please request a new OTP.' });
      return;
    }

    let referrerId: string | null = null;
    if (referral_code && String(referral_code).trim()) {
      const refUser = (await db
        .prepare('SELECT id FROM users WHERE UPPER(referral_code) = UPPER(?)')
        .get(String(referral_code).trim())) as { id: string } | undefined;
      if (!refUser) {
        res.status(400).json({ error: 'Invalid referral code' });
        return;
      }
      referrerId = refUser.id;
    }

    const userId = await generateUniqueUserId();
    const userUid = await generateUnique8DigitUid();
    const uniqueRefCode = await generateUniqueReferralCode(cleanFullName);
    const passwordHash = bcrypt.hashSync(pwdStr, 10);
    const isStrongPwd = isStrongPasswordValue(pwdStr) ? 1 : 0;
    const now = new Date().toISOString();

    await db.transaction(async () => {
      await db.prepare('UPDATE signup_otp_codes SET used = 1 WHERE id = ?').run(otpRecord.id);
      await db
        .prepare(`
          INSERT INTO users (id, uid, email, full_name, password_hash, strong_password_set, role, status, kyc_status, main_balance, claimable_balance, locked_balance, referral_code, referred_by, first_deposit_rewarded, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'USER', 'ACTIVE', 'UNVERIFIED', 0, 0, 0, ?, ?, 0, ?)
        `)
        .run(userId, userUid, normalizedEmail, cleanFullName, passwordHash, isStrongPwd, uniqueRefCode, referrerId, now);

      if (referrerId) {
        await db
          .prepare(`
            INSERT INTO referrals (id, referrer_id, referred_user_id, bonus_amount, status, created_at)
            VALUES (?, ?, ?, 15.00, 'PENDING_DEPOSIT', ?)
          `)
          .run(generateId('REF'), referrerId, userId, now);
      }
    })();

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    const jti = crypto.randomUUID();
    const token = signToken({ userId: user.id, role: user.role, email: user.email, jti });
    await recordLoginSession(req, user.id, jti);
    res.status(201).json({ token, user: await sanitizeUser(user) });
  }));

  app.get('/api/auth/admin-bootstrap-status', ah(async (_req, res) => {
    const existingAdmin = await db.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get();
    const envConfigured = Boolean(process.env.INITIAL_ADMIN_PASSWORD?.trim() && process.env.INITIAL_ADMIN_PASSWORD.trim().length >= 6);
    res.json({
      needsAdminSetup: !existingAdmin && !envConfigured,
      defaultEmail: process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@nepefy.app',
    });
  }));

  app.post('/api/auth/claim-admin', ah(async (req, res) => {
    if (process.env.INITIAL_ADMIN_PASSWORD?.trim() && process.env.INITIAL_ADMIN_PASSWORD.trim().length >= 6) {
      res.status(403).json({ error: 'Administrator bootstrap is managed via server environment configuration.' });
      return;
    }

    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    const fullNameRaw = String(req.body?.full_name || 'Master Administrator').trim();
    const passwordRaw = String(req.body?.password || '');

    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      res.status(400).json({ error: 'Please enter a valid administrator email address.' });
      return;
    }
    if (fullNameRaw.length < 2 || fullNameRaw.length > 80) {
      res.status(400).json({ error: 'Administrator name must be between 2 and 80 characters.' });
      return;
    }
    if (!isStrongPasswordValue(passwordRaw)) {
      res.status(400).json({
        error: 'Admin password must be 8–72 characters with uppercase, lowercase, number, and special symbol.',
      });
      return;
    }

    const existingEmail = await db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(emailRaw);
    if (existingEmail) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = bcrypt.hashSync(passwordRaw, 10);
    const now = new Date().toISOString();

    const claimed = await db.transaction(async () => {
      const existingAdmin = await db.prepare("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1").get();
      if (existingAdmin) {
        return null;
      }
      await db
        .prepare(`
          INSERT INTO users (id, uid, email, full_name, password_hash, strong_password_set, role, status, kyc_status, main_balance, claimable_balance, locked_balance, referral_code, referred_by, first_deposit_rewarded, created_at)
          VALUES (?, ?, ?, ?, ?, 1, 'ADMIN', 'ACTIVE', 'VERIFIED', 0, 0, 0, ?, NULL, 1, ?)
        `)
        .run('CL-ADMIN', '10000001', emailRaw, fullNameRaw, passwordHash, 'NEPEFYADM', now);
      return await db.prepare('SELECT * FROM users WHERE id = ?').get('CL-ADMIN');
    })();

    if (!claimed) {
      res.status(403).json({ error: 'Master Administrator has already been claimed. Please sign in.' });
      return;
    }

    const jti = crypto.randomUUID();
    const token = signToken({ userId: claimed.id, role: claimed.role, email: claimed.email, jti });
    await recordLoginSession(req, claimed.id, jti);
    res.status(201).json({ token, user: await sanitizeUser(claimed) });
  }));

  app.post('/api/auth/login', ah(async (req, res) => {
    const { email, password, totp_code } = req.body || {};
    const credential = String(password || '');
    if (!email || !credential) {
      res.status(400).json({ error: 'Email and Account Password are required' });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = (await db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail)) as any;
    const passwordOk = user && user.password_hash ? bcrypt.compareSync(credential, user.password_hash) : false;
    if (!user || !passwordOk) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (user.status === 'INACTIVE') {
      res.status(403).json({ error: 'Account is inactive / suspended. Contact Master Admin.' });
      return;
    }
    if (Number(user.two_fa_enabled) === 1) {
      const codeStr = String(totp_code || '').trim();
      if (!codeStr) {
        res.json({ requires2fa: true, message: 'Enter your 6-digit 2FA verification code.' });
        return;
      }
      if (!verifyTotpCode(user.two_fa_secret, codeStr)) {
        res.status(401).json({ error: 'Invalid 2FA verification code' });
        return;
      }
    }
    const jti = crypto.randomUUID();
    const token = signToken({ userId: user.id, role: user.role, email: user.email, jti });
    await recordLoginSession(req, user.id, jti);
    res.json({ token, user: await sanitizeUser(user) });
  }));

  app.post('/api/auth/logout', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    if (req.auth?.jti) {
      await db
        .prepare('UPDATE login_sessions SET is_revoked = 1 WHERE jti = ? AND user_id = ?')
        .run(req.auth.jti, req.auth.userId);
    }
    res.json({ ok: true });
  }));

  app.post('/api/auth/forgot-password', ah(async (req, res) => {
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    if (!emailRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      res.status(400).json({ error: 'Please enter a valid registered email address.' });
      return;
    }
    const user = (await db.prepare('SELECT id, email, status FROM users WHERE LOWER(email) = ?').get(emailRaw)) as any;
    if (!user) {
      res.status(404).json({ error: 'No account found with that email address.' });
      return;
    }
    if (user.status === 'INACTIVE') {
      res.status(403).json({ error: 'Account is suspended. Contact Master Admin.' });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    otpFailAttempts.delete(`reset:${emailRaw}`);
    await db.prepare('UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);
    await db
      .prepare(`
        INSERT INTO password_reset_codes (id, user_id, email, code, expires_at, used, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `)
      .run(generateId('RST'), user.id, user.email, code, expiresAt, now.toISOString());

    const emailRes = await sendOtpEmail({ to: user.email, code, purpose: 'PASSWORD_RESET' });
    const providerConfigured = isEmailProviderConfigured();
    const allowOtpPreview = process.env.ALLOW_OTP_PREVIEW === 'true';
    if (!emailRes.delivered && !allowOtpPreview) {
      await db.prepare('UPDATE password_reset_codes SET used = 1 WHERE user_id = ? AND used = 0').run(user.id);
      res.status(503).json({
        error: providerConfigured
          ? `Could not send recovery email (${emailRes.error || 'provider rejected delivery'}). Please check your email settings.`
          : 'Password recovery email service is not configured on the server (set RESEND_API_KEY or SMTP settings).',
      });
      return;
    }
    res.json({
      ok: true,
      message: emailRes.delivered
        ? `A 6-digit verification code has been sent to ${user.email} (expires in 15 minutes).`
        : 'A 6-digit verification code has been generated and expires in 15 minutes.',
      emailDelivered: emailRes.delivered,
      provider: emailRes.provider,
      ...(allowOtpPreview ? { verificationCodePreview: code } : {}),
    });
  }));

  app.post('/api/auth/reset-password', ah(async (req, res) => {
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const newPwd = String(req.body?.new_password || '');

    if (!emailRaw || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Valid email and 6-digit verification code are required.' });
      return;
    }
    if (newPwd.length < 6 || newPwd.length > 72) {
      res.status(400).json({ error: 'New password must be between 6 and 72 characters.' });
      return;
    }

    const activeResetOtp = (await db
      .prepare('SELECT id FROM password_reset_codes WHERE LOWER(email) = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
      .get(emailRaw)) as { id: string } | undefined;

    if (!activeResetOtp) {
      otpFailAttempts.delete(`reset:${emailRaw}`);
      res.status(400).json({ error: 'Recovery code is inactive or blocked. Please request a new verification code.' });
      return;
    }

    const row = (await db
      .prepare('SELECT * FROM password_reset_codes WHERE LOWER(email) = ? AND code = ? AND used = 0 ORDER BY created_at DESC LIMIT 1')
      .get(emailRaw, code)) as any;

    if (!row) {
      const attemptKey = `reset:${emailRaw}`;
      const fails = (otpFailAttempts.get(attemptKey) || 0) + 1;
      otpFailAttempts.set(attemptKey, fails);
      if (fails >= MAX_OTP_ATTEMPTS) {
        await db.prepare('UPDATE password_reset_codes SET used = 1 WHERE LOWER(email) = ? AND used = 0').run(emailRaw);
        otpFailAttempts.delete(attemptKey);
        res.status(429).json({
          error: 'Recovery OTP blocked after 3 invalid attempts. Please request a new verification code.',
        });
        return;
      }
      const remaining = MAX_OTP_ATTEMPTS - fails;
      res.status(400).json({
        error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before OTP is blocked.`,
      });
      return;
    }
    otpFailAttempts.delete(`reset:${emailRaw}`);
    if (Date.parse(row.expires_at) < Date.now()) {
      res.status(400).json({ error: 'Verification code has expired. Request a new code.' });
      return;
    }

    const hash = bcrypt.hashSync(newPwd, 10);
    const isStrong = isStrongPasswordValue(newPwd) ? 1 : 0;

    await db.transaction(async () => {
      await db.prepare('UPDATE users SET password_hash = ?, strong_password_set = ? WHERE id = ?').run(hash, isStrong, row.user_id);
      await db.prepare('UPDATE password_reset_codes SET used = 1 WHERE id = ?').run(row.id);
      await db.prepare('UPDATE login_sessions SET is_revoked = 1 WHERE user_id = ?').run(row.user_id);
    })();

    await syncUserVerification(row.user_id);
    await createUserNotification({
      userId: row.user_id,
      category: 'SECURITY',
      title: 'Password Reset Completed',
      message: 'Your account password was changed via recovery code and older sessions were signed out.',
      linkTab: 'profile',
    });

    res.json({ ok: true, message: 'Password updated successfully. You can now sign in with your new password.' });
  }));

  async function buildUserLedger(userId: string) {
    const [rawLedger, deposits, withdrawals, p2pOrders, spotTrades, pendingReferrals] = await Promise.all([
      db
        .prepare('SELECT * FROM wallets_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 80')
        .all(userId) as Promise<any[]>,
      db
        .prepare('SELECT id, amount, gateway, trx_id, status, admin_note, created_at FROM deposit_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(userId) as Promise<any[]>,
      db
        .prepare('SELECT id, status FROM withdraw_requests WHERE user_id = ?')
        .all(userId) as Promise<{ id: string; status: string }[]>,
      db
        .prepare('SELECT id, status FROM p2p_orders WHERE buyer_id = ? OR seller_id = ?')
        .all(userId, userId) as Promise<{ id: string; status: string }[]>,
      db
        .prepare('SELECT id, status, fee_usd, fee_role FROM spot_trades WHERE user_id = ?')
        .all(userId) as Promise<{ id: string; status: string; fee_usd: number; fee_role: string | null }[]>,
      db
        .prepare(`
          SELECT r.id, r.bonus_amount, r.created_at, u.full_name as referred_name
          FROM referrals r
          JOIN users u ON r.referred_user_id = u.id
          WHERE r.referrer_id = ? AND r.status = 'PENDING_DEPOSIT'
          ORDER BY r.created_at DESC
        `)
        .all(userId) as Promise<any[]>,
    ]);

    const withdrawStatusMap = new Map(withdrawals.map((w) => [w.id, w.status]));
    const p2pStatusMap = new Map(p2pOrders.map((o) => [o.id, o.status]));
    const spotTradeMap = new Map(spotTrades.map((t) => [t.id, t]));

    const mapped = rawLedger.map((entry) => {
      let status: 'PENDING' | 'SUCCESS' | 'REJECTED' | 'FAILED' = 'SUCCESS';
      let fee_usd: number | null = null;
      let fee_role: string | null = null;

      if (entry.tx_type === 'WITHDRAW_HOLD') {
        const wStatus = withdrawStatusMap.get(entry.reference_id);
        if (wStatus === 'APPROVED') status = 'SUCCESS';
        else if (wStatus === 'REJECTED') status = 'REJECTED';
        else status = 'PENDING';
      } else if (entry.tx_type === 'P2P_ESCROW_LOCK') {
        const oStatus = p2pStatusMap.get(entry.reference_id);
        if (oStatus === 'COMPLETED' || oStatus === 'RESOLVED_BUYER') status = 'SUCCESS';
        else if (oStatus === 'CANCELLED' || oStatus === 'RESOLVED_SELLER') status = 'REJECTED';
        else status = 'PENDING';
      } else if (entry.tx_type === 'SPOT_BUY') {
        const matchedTrade = spotTradeMap.get(entry.reference_id);
        const sStatus = matchedTrade?.status;
        if (sStatus === 'OPEN') status = 'PENDING';
        else if (sStatus === 'CANCELLED') status = 'REJECTED';
        else status = 'SUCCESS';
        const desc = String(entry.description || '');
        if (matchedTrade && Number(matchedTrade.fee_usd || 0) > 0 && !/^(Open Limit|Cancel)/i.test(desc)) {
          fee_usd = Number(matchedTrade.fee_usd);
          fee_role = matchedTrade.fee_role || null;
        }
      } else if (entry.tx_type === 'SPOT_SELL' || entry.tx_type === 'SPOT_PNL' || entry.tx_type === 'SPOT_LIQUIDATION') {
        if (entry.tx_type === 'SPOT_LIQUIDATION') status = 'FAILED';
        const matchedTrade = spotTradeMap.get(entry.reference_id);
        const desc = String(entry.description || '');
        if (matchedTrade && Number(matchedTrade.fee_usd || 0) > 0 && !/^(Open Limit|Cancel)/i.test(desc)) {
          fee_usd = Number(matchedTrade.fee_usd);
          fee_role = matchedTrade.fee_role || null;
        }
      }

      return { ...entry, status, fee_usd, fee_role };
    });

    const existingDepositRefs = new Set(
      mapped.filter((l) => l.tx_type === 'DEPOSIT').map((l) => l.reference_id)
    );

    for (const dep of deposits) {
      if (!existingDepositRefs.has(dep.id)) {
        const depStatus: 'PENDING' | 'SUCCESS' | 'REJECTED' =
          dep.status === 'PENDING' ? 'PENDING' : dep.status === 'REJECTED' ? 'REJECTED' : 'SUCCESS';
        mapped.push({
          id: `DEP_REQ_${dep.id}`,
          user_id: userId,
          wallet_type: 'MAIN',
          tx_type: 'DEPOSIT',
          status: depStatus,
          amount: Number(dep.amount),
          balance_after: null,
          reference_id: dep.id,
          description:
            depStatus === 'PENDING'
              ? `Pending ${dep.gateway} deposit (TrxID: ${dep.trx_id})`
              : depStatus === 'REJECTED'
              ? `Rejected ${dep.gateway} deposit (TrxID: ${dep.trx_id})${dep.admin_note ? ` · ${dep.admin_note}` : ''}`
              : `Approved ${dep.gateway} deposit (TrxID: ${dep.trx_id})`,
          created_at: dep.created_at,
        });
      }
    }

    for (const ref of pendingReferrals) {
      mapped.push({
        id: `REF_REQ_${ref.id}`,
        user_id: userId,
        wallet_type: 'CLAIMABLE',
        tx_type: 'REFERRAL_BONUS',
        status: 'PENDING',
        amount: Number(ref.bonus_amount),
        balance_after: null,
        reference_id: ref.id,
        description: `Pending referral bonus from ${ref.referred_name} (requires $500.00 balance & 10 verified signups)`,
        created_at: ref.created_at,
      });
    }

    mapped.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return mapped.slice(0, 80);
  }

  const lastAuthMeSyncAt = new Map<string, number>();

  app.get('/api/auth/me', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const nowMs = Date.now();
    const lastSync = lastAuthMeSyncAt.get(userId) || 0;
    let userRow: any;
    if (nowMs - lastSync > 30_000) {
      lastAuthMeSyncAt.set(userId, nowMs);
      await Promise.all([
        syncReferralRewardsForReferrer(userId),
        syncStakingDailyProfits(userId),
      ]);
      userRow = await syncUserVerification(userId);
    } else {
      userRow = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
    const [holdings, ledger, safeUser] = await Promise.all([
      db.prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND quantity > 0').all(userId),
      buildUserLedger(userId),
      sanitizeUser(userRow),
    ]);
    res.json({ user: safeUser, holdings, ledger });
  }));

  app.put('/api/profile', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { full_name, email, phone, country, date_of_birth, address, occupation, bio, avatar_url } = req.body || {};

    const current = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!current) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const nextName = full_name !== undefined ? String(full_name).trim() : current.full_name;
    if (!nextName || nextName.length < 2 || nextName.length > 80) {
      res.status(400).json({ error: 'Full name must be between 2 and 80 characters' });
      return;
    }

    const nextEmail = email !== undefined ? String(email).trim().toLowerCase() : current.email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      res.status(400).json({ error: 'Please enter a valid email address' });
      return;
    }
    if (nextEmail !== current.email) {
      const dup = await db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(nextEmail, userId);
      if (dup) {
        res.status(409).json({ error: 'This email address is already registered to another account' });
        return;
      }
    }

    let nextAvatar = current.avatar_url;
    let pendingAvatarUpload: string | null = null;
    if (avatar_url !== undefined) {
      if (avatar_url === null || avatar_url === '') {
        nextAvatar = null;
      } else {
        const avStr = String(avatar_url);
        if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(avStr) && !/^https?:\/\//i.test(avStr)) {
          res.status(400).json({ error: 'Profile picture must be a valid PNG, JPG, GIF, or WebP image' });
          return;
        }
        if (avStr.length > 2_000_000) {
          res.status(400).json({ error: 'Profile picture exceeds 2MB size limit' });
          return;
        }
        pendingAvatarUpload = avStr;
      }
    }

    const nextPhone = phone !== undefined ? String(phone).trim().slice(0, 32) : current.phone || '';
    const nextCountry = country !== undefined ? String(country).trim().slice(0, 64) : current.country || '';
    const nextDob = date_of_birth !== undefined ? String(date_of_birth).trim().slice(0, 20) : current.date_of_birth || '';
    const nextAddress = address !== undefined ? String(address).trim().slice(0, 160) : current.address || '';
    const nextOccupation = occupation !== undefined ? String(occupation).trim().slice(0, 80) : current.occupation || '';
    const nextBio = bio !== undefined ? String(bio).trim().slice(0, 240) : current.bio || '';

    const isUpdatingPersonalDetails =
      phone !== undefined ||
      country !== undefined ||
      date_of_birth !== undefined ||
      address !== undefined ||
      occupation !== undefined ||
      bio !== undefined ||
      full_name !== undefined ||
      email !== undefined;

    if (isUpdatingPersonalDetails) {
      if (!nextPhone || nextPhone.length < 5) {
        res.status(400).json({ error: 'Phone Number is required.' });
        return;
      }
      if (!nextCountry || nextCountry.length < 2) {
        res.status(400).json({ error: 'Country / Region is required.' });
        return;
      }
      if (!nextDob || nextDob.length < 4) {
        res.status(400).json({ error: 'Date of Birth is required.' });
        return;
      }
      if (!nextAddress || nextAddress.length < 4) {
        res.status(400).json({ error: 'Residential Address is required.' });
        return;
      }
      if (!nextOccupation || nextOccupation.length < 2) {
        res.status(400).json({ error: 'Occupation is required.' });
        return;
      }
    }

    const authCheck = verifySensitiveActionAuth(current, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    if (pendingAvatarUpload !== null) {
      nextAvatar = await uploadImageAsset(pendingAvatarUpload, 'avatars', userId);
    }

    await db
      .prepare(`
        UPDATE users
        SET full_name = ?, email = ?, phone = ?, country = ?, date_of_birth = ?, address = ?, occupation = ?, bio = ?, avatar_url = ?
        WHERE id = ?
      `)
      .run(nextName, nextEmail, nextPhone, nextCountry, nextDob, nextAddress, nextOccupation, nextBio, nextAvatar, userId);

    const updated = await syncUserVerification(userId);
    const token = nextEmail !== current.email
      ? signToken({ userId: updated.id, role: updated.role, email: updated.email, jti: req.auth?.jti })
      : undefined;

    res.json({ user: await sanitizeUser(updated), ...(token ? { token } : {}) });
  }));

  app.put('/api/profile/password', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { new_password } = req.body || {};

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const nextPwd = String(new_password || '');
    if (!isStrongPasswordValue(nextPwd)) {
      res.status(400).json({
        error: 'Strong password required: minimum 8 characters with uppercase, lowercase, number, and special character.',
      });
      return;
    }

    const authCheck = verifySensitiveActionAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const hash = bcrypt.hashSync(nextPwd, 10);
    await db.prepare('UPDATE users SET password_hash = ?, strong_password_set = 1 WHERE id = ?').run(hash, userId);

    const updated = await syncUserVerification(userId);
    res.json({ ok: true, user: await sanitizeUser(updated) });
  }));

  app.post('/api/profile/2fa/setup', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    if (Number(user.two_fa_enabled) === 1) {
      res.status(400).json({ error: '2FA is already enabled on this account' });
      return;
    }

    const secret = generateBase32Secret(20);
    await db.prepare('UPDATE users SET two_fa_secret = ? WHERE id = ?').run(secret, userId);
    const otpauthUrl = buildOtpAuthUrl(user.email, secret, 'Nepefy');
    res.json({ secret, otpauthUrl });
  }));

  app.post('/api/profile/2fa/verify-enable', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { code } = req.body || {};
    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user || !user.two_fa_secret) {
      res.status(400).json({ error: 'Start 2FA setup first before verifying' });
      return;
    }
    if (!verifyTotpCode(user.two_fa_secret, String(code || ''))) {
      res.status(400).json({ error: 'Invalid 6-digit verification code. Check authenticator clock and try again.' });
      return;
    }

    await db.prepare('UPDATE users SET two_fa_enabled = 1 WHERE id = ?').run(userId);
    const updated = await syncUserVerification(userId);
    res.json({ ok: true, user: await sanitizeUser(updated) });
  }));

  app.post('/api/profile/2fa/disable', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { code } = req.body || {};
    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user || Number(user.two_fa_enabled) !== 1) {
      res.status(400).json({ error: '2FA is not currently enabled' });
      return;
    }
    if (!verifyTotpCode(user.two_fa_secret, String(code || ''))) {
      res.status(400).json({ error: 'Invalid 6-digit 2FA verification code' });
      return;
    }
    const authCheck = verifySensitiveActionAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    await db.prepare('UPDATE users SET two_fa_enabled = 0, two_fa_secret = NULL WHERE id = ?').run(userId);
    const updated = await syncUserVerification(userId);
    res.json({ ok: true, user: await sanitizeUser(updated) });
  }));

  app.get('/api/profile/payment-methods', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const paymentMethods = await db
      .prepare('SELECT * FROM user_payment_methods WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC')
      .all(userId);
    res.json({ paymentMethods });
  }));

  app.post('/api/profile/payment-methods', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { method, account_label, account_number, extra_details, is_default } = req.body || {};

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const methodStr = String(method || '').trim();
    if (!ALLOWED_PAYMENT_METHODS.includes(methodStr as any)) {
      res.status(400).json({ error: 'Select a valid payment method (Binance Pay, Bybit Pay, Nagad, bKash, Rocket, or Bank Wire).' });
      return;
    }

    const labelStr = String(account_label || '').trim().slice(0, 80);
    if (labelStr.length < 2) {
      res.status(400).json({ error: 'Account holder name / label must be at least 2 characters.' });
      return;
    }

    const numberStr = String(account_number || '').trim().slice(0, 100);
    if (numberStr.length < 3) {
      res.status(400).json({ error: 'Enter a valid account number, wallet number, or Pay ID.' });
      return;
    }

    const detailsStr = String(extra_details || '').trim().slice(0, 160);
    if (methodStr === 'Bank Wire' && detailsStr.length < 3) {
      res.status(400).json({ error: 'Enter bank name / branch / routing details for Bank Wire.' });
      return;
    }

    const countRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM user_payment_methods WHERE user_id = ?')
      .get(userId)) as { cnt: number };
    const existingCount = Number(countRow?.cnt || 0);
    if (existingCount >= 20) {
      res.status(400).json({ error: 'Maximum of 20 saved payment methods reached. Remove an old method first.' });
      return;
    }

    const authCheck = verifyStrict2faAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const makeDefault = existingCount === 0 || Boolean(is_default);
    const now = new Date().toISOString();
    const pmId = generateId('PM');

    await db.transaction(async () => {
      if (makeDefault) {
        await db.prepare('UPDATE user_payment_methods SET is_default = 0 WHERE user_id = ?').run(userId);
      }
      await db
        .prepare(`
          INSERT INTO user_payment_methods (id, user_id, method, account_label, account_number, extra_details, is_default, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(pmId, userId, methodStr, labelStr, numberStr, detailsStr, makeDefault ? 1 : 0, now, now);
    })();

    const updatedUser = await syncUserVerification(userId);
    const paymentMethod = await db.prepare('SELECT * FROM user_payment_methods WHERE id = ?').get(pmId);
    const paymentMethods = await db
      .prepare('SELECT * FROM user_payment_methods WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC')
      .all(userId);
    res.status(201).json({ paymentMethod, paymentMethods, user: await sanitizeUser(updatedUser) });
  }));

  app.put('/api/profile/payment-methods/:id', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const pmId = req.params.id;
    const { method, account_label, account_number, extra_details, is_default } = req.body || {};

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const existing = (await db
      .prepare('SELECT * FROM user_payment_methods WHERE id = ? AND user_id = ?')
      .get(pmId, userId)) as any;
    if (!existing) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    const nextMethod = method !== undefined ? String(method).trim() : existing.method;
    if (!ALLOWED_PAYMENT_METHODS.includes(nextMethod as any)) {
      res.status(400).json({ error: 'Select a valid payment method.' });
      return;
    }

    const nextLabel = account_label !== undefined ? String(account_label).trim().slice(0, 80) : existing.account_label;
    if (nextLabel.length < 2) {
      res.status(400).json({ error: 'Account holder name / label must be at least 2 characters.' });
      return;
    }

    const nextNumber = account_number !== undefined ? String(account_number).trim().slice(0, 100) : existing.account_number;
    if (nextNumber.length < 3) {
      res.status(400).json({ error: 'Enter a valid account number, wallet number, or Pay ID.' });
      return;
    }

    const nextDetails = extra_details !== undefined ? String(extra_details).trim().slice(0, 160) : existing.extra_details;
    if (nextMethod === 'Bank Wire' && nextDetails.length < 3) {
      res.status(400).json({ error: 'Enter bank name / branch / routing details for Bank Wire.' });
      return;
    }

    const authCheck = verifyStrict2faAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const makeDefault = is_default !== undefined ? Boolean(is_default) : Boolean(existing.is_default);
    const now = new Date().toISOString();

    await db.transaction(async () => {
      if (makeDefault) {
        await db.prepare('UPDATE user_payment_methods SET is_default = 0 WHERE user_id = ?').run(userId);
      }
      await db
        .prepare(`
          UPDATE user_payment_methods
          SET method = ?, account_label = ?, account_number = ?, extra_details = ?, is_default = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `)
        .run(nextMethod, nextLabel, nextNumber, nextDetails, makeDefault ? 1 : 0, now, pmId, userId);
    })();

    const paymentMethod = await db.prepare('SELECT * FROM user_payment_methods WHERE id = ?').get(pmId);
    const paymentMethods = await db
      .prepare('SELECT * FROM user_payment_methods WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC')
      .all(userId);
    res.json({ paymentMethod, paymentMethods });
  }));

  app.delete('/api/profile/payment-methods/:id', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const pmId = req.params.id;

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const existing = (await db
      .prepare('SELECT * FROM user_payment_methods WHERE id = ? AND user_id = ?')
      .get(pmId, userId)) as any;
    if (!existing) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    const authCheck = verifyStrict2faAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    await db.transaction(async () => {
      await db.prepare('DELETE FROM user_payment_methods WHERE id = ? AND user_id = ?').run(pmId, userId);
      if (Number(existing.is_default) === 1) {
        const nextRow = (await db
          .prepare('SELECT id FROM user_payment_methods WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
          .get(userId)) as { id: string } | undefined;
        if (nextRow) {
          await db.prepare('UPDATE user_payment_methods SET is_default = 1 WHERE id = ?').run(nextRow.id);
        }
      }
    })();

    const updatedUser = await syncUserVerification(userId);
    const paymentMethods = await db
      .prepare('SELECT * FROM user_payment_methods WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC')
      .all(userId);
    res.json({ ok: true, paymentMethods, user: await sanitizeUser(updatedUser) });
  }));

  app.post('/api/wallet/claim', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;

    try {
      const result = await db.transaction(async () => {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const claimable = Number(user.claimable_balance || 0);
        if (claimable <= 0) {
          throw new Error('No claimable funds available');
        }
        const nextMain = Number((user.main_balance + claimable).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ?, claimable_balance = 0 WHERE id = ?').run(nextMain, userId);

        const refId = generateId('CLM');
        await appendLedger(
          userId,
          'CLAIMABLE',
          'CLAIM',
          -claimable,
          0,
          refId,
          `Claimed $${claimable.toFixed(2)} to Main Balance`
        );
        await appendLedger(
          userId,
          'MAIN',
          'CLAIM',
          claimable,
          nextMain,
          refId,
          `Received $${claimable.toFixed(2)} from Claimable Wallet`
        );

        return { claimedAmount: claimable, mainBalance: nextMain };
      })();

      const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      res.json({ ...result, user: await sanitizeUser(updatedUser) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Claim failed' });
    }
  }));

  app.get('/api/notifications', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const notifications = await db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(userId);
    const unreadRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(userId)) as { cnt: number };
    res.json({ notifications, unreadCount: Number(unreadRow?.cnt || 0) });
  }));

  app.post('/api/notifications/read', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const notifId = req.body?.id ? String(req.body.id) : null;
    if (notifId) {
      await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(notifId, userId);
    } else {
      await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(userId);
    }
    const unreadRow = (await db
      .prepare('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(userId)) as { cnt: number };
    res.json({ ok: true, unreadCount: Number(unreadRow?.cnt || 0) });
  }));

  app.get('/api/security/sessions', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const currentJti = req.auth?.jti || '';
    const rows = (await db
      .prepare('SELECT id, user_id, jti, device_info, ip_address, is_revoked, created_at, last_active_at FROM login_sessions WHERE user_id = ? ORDER BY last_active_at DESC LIMIT 20')
      .all(userId)) as any[];
    const sessions = rows.map((r) => ({
      id: r.id,
      device_info: r.device_info,
      ip_address: r.ip_address,
      is_revoked: Boolean(r.is_revoked),
      is_current: Boolean(currentJti && r.jti === currentJti),
      created_at: r.created_at,
      last_active_at: r.last_active_at,
    }));
    res.json({ sessions });
  }));

  app.post('/api/security/sessions/revoke-others', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const currentJti = req.auth?.jti || '';
    await db.prepare('UPDATE login_sessions SET is_revoked = 1 WHERE user_id = ? AND jti != ?').run(userId, currentJti);
    res.json({ ok: true });
  }));

  app.delete('/api/security/sessions/:id', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const currentJti = req.auth?.jti || '';
    const row = (await db
      .prepare('SELECT id, jti FROM login_sessions WHERE id = ? AND user_id = ?')
      .get(req.params.id, userId)) as any;
    if (!row) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (currentJti && row.jti === currentJti) {
      res.status(400).json({ error: 'Use Logout to sign out of your current active session.' });
      return;
    }
    await db.prepare('UPDATE login_sessions SET is_revoked = 1 WHERE id = ?').run(row.id);
    res.json({ ok: true });
  }));

  app.get('/api/kyc/status', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const submissions = (await db
      .prepare('SELECT id, user_id, doc_type, legal_name, doc_number, doc_front_data, selfie_data, status, admin_note, reviewed_at, created_at, updated_at FROM kyc_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(userId)) as any[];
    res.json({ latest: submissions[0] || null, submissions });
  }));

  app.post('/api/kyc/submit', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { doc_type, legal_name, doc_number, doc_front_data, selfie_data } = req.body || {};
    const allowedDocs = new Set(['NID', 'PASSPORT', 'DRIVING_LICENSE']);
    const cleanDocType = String(doc_type || '').toUpperCase();
    const cleanLegalName = String(legal_name || '').trim().slice(0, 100);
    const cleanDocNumber = String(doc_number || '').trim().slice(0, 60);

    if (!allowedDocs.has(cleanDocType)) {
      res.status(400).json({ error: 'Document type must be NID, PASSPORT, or DRIVING_LICENSE.' });
      return;
    }
    if (cleanLegalName.length < 2) {
      res.status(400).json({ error: 'Legal full name matching your ID is required.' });
      return;
    }
    if (cleanDocNumber.length < 4) {
      res.status(400).json({ error: 'Valid document ID number is required.' });
      return;
    }
    if (!doc_front_data || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(String(doc_front_data))) {
      res.status(400).json({ error: 'Front photo of your government ID (PNG/JPG/WebP) is required.' });
      return;
    }
    if (String(doc_front_data).length > 2_500_000) {
      res.status(400).json({ error: 'Document image exceeds 2.5MB limit.' });
      return;
    }
    let validSelfie: string | null = null;
    if (selfie_data) {
      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(String(selfie_data))) {
        res.status(400).json({ error: 'Selfie must be a valid PNG, JPG, or WebP image.' });
        return;
      }
      if (String(selfie_data).length > 2_500_000) {
        res.status(400).json({ error: 'Selfie image exceeds 2.5MB limit.' });
        return;
      }
      validSelfie = String(selfie_data);
    }

    const existingPending = await db
      .prepare("SELECT id FROM kyc_submissions WHERE user_id = ? AND status = 'PENDING'")
      .get(userId);
    if (existingPending) {
      res.status(409).json({ error: 'A KYC document submission is already pending admin review.' });
      return;
    }

    const storedDocFront = await uploadImageAsset(String(doc_front_data), 'kyc', userId);
    const storedSelfie = validSelfie ? await uploadImageAsset(validSelfie, 'kyc', userId) : null;

    const kycId = generateId('KYC');
    const now = new Date().toISOString();
    await db
      .prepare(`
        INSERT INTO kyc_submissions (id, user_id, doc_type, legal_name, doc_number, doc_front_data, selfie_data, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `)
      .run(kycId, userId, cleanDocType, cleanLegalName, cleanDocNumber, storedDocFront, storedSelfie, now, now);

    const created = await db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(kycId);
    res.status(201).json({ submission: created });
  }));

  // ---------------------------------------------------------------------------
  // 2. MANUAL DEPOSIT & WITHDRAWAL
  // ---------------------------------------------------------------------------

  app.get('/api/deposits', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const rows = await db
      .prepare('SELECT * FROM deposit_requests WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.auth!.userId);
    res.json({ deposits: rows });
  }));

  app.post('/api/deposits', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { amount, gateway, trx_id, screenshot_data } = req.body || {};
    const numAmount = Number(amount);
    const settings = await getPlatformSettings();
    if (!Number.isFinite(numAmount) || numAmount < settings.minDepositUsd || numAmount > settings.maxDepositUsd) {
      res.status(400).json({
        error: `Deposit amount must be between $${settings.minDepositUsd.toFixed(2)} and $${settings.maxDepositUsd.toLocaleString()}`,
      });
      return;
    }
    if (!['Binance', 'Bybit'].includes(gateway)) {
      res.status(400).json({ error: 'Gateway must be Binance or Bybit' });
      return;
    }
    const cleanTrx = String(trx_id || '').trim().slice(0, 120);
    if (cleanTrx.length < 5) {
      res.status(400).json({ error: 'Valid Transaction ID (TrxID) is required' });
      return;
    }
    if (!screenshot_data) {
      res.status(400).json({ error: 'Payment screenshot proof is required' });
      return;
    }
    const ssStr = String(screenshot_data);
    if (!RASTER_IMAGE_DATA_URL_RE.test(ssStr) && !/^https?:\/\//i.test(ssStr)) {
      res.status(400).json({ error: 'Payment screenshot must be a valid PNG, JPG, GIF, or WebP image.' });
      return;
    }
    if (ssStr.length > 2_500_000) {
      res.status(400).json({ error: 'Payment screenshot exceeds 2.5MB size limit.' });
      return;
    }

    const dup = await db.prepare('SELECT id FROM deposit_requests WHERE trx_id = ?').get(cleanTrx);
    if (dup) {
      res.status(409).json({ error: 'This TrxID has already been submitted' });
      return;
    }

    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId)) as any;
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const authCheck = verifySensitiveActionAuth(user, req.body);
    if (!authCheck.ok) {
      res.status(authCheck.status).json({ error: authCheck.error });
      return;
    }

    const storedScreenshot = await uploadImageAsset(ssStr, 'deposits', req.auth!.userId);
    const id = generateId('DEP');
    const now = new Date().toISOString();
    try {
      await db.prepare(`
        INSERT INTO deposit_requests (id, user_id, amount, gateway, trx_id, screenshot_data, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)
      `).run(id, req.auth!.userId, Number(numAmount.toFixed(2)), gateway, cleanTrx, storedScreenshot, now);
    } catch (insertErr: any) {
      const errMsg = String(insertErr?.message || '').toLowerCase();
      if (errMsg.includes('unique') || errMsg.includes('duplicate') || insertErr?.code === '23505') {
        res.status(409).json({ error: 'This TrxID has already been submitted' });
        return;
      }
      throw insertErr;
    }

    const created = await db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(id);
    res.status(201).json({ deposit: created });
  }));

  app.get('/api/withdrawals', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const rows = await db
      .prepare('SELECT * FROM withdraw_requests WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.auth!.userId);
    res.json({ withdrawals: rows });
  }));

  app.post('/api/withdrawals', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { amount, gateway, destination_address, proof_note } = req.body || {};
    const numAmount = Number(amount);
    const settings = await getPlatformSettings();
    const withdrawFee = settings.withdrawFeeUsd;
    if (!Number.isFinite(numAmount) || numAmount < settings.minWithdrawUsd || numAmount > settings.maxWithdrawUsd) {
      res.status(400).json({
        error: `Withdrawal amount must be between $${settings.minWithdrawUsd.toFixed(2)} and $${settings.maxWithdrawUsd.toLocaleString()}`,
      });
      return;
    }
    if (!['Binance', 'Bybit'].includes(gateway)) {
      res.status(400).json({ error: 'Gateway must be Binance or Bybit' });
      return;
    }
    if (!destination_address || String(destination_address).trim().length < 4) {
      res.status(400).json({ error: 'Destination Binance/Bybit UID or address is required' });
      return;
    }

    const userId = req.auth!.userId;
    try {
      const row = await db.transaction(async () => {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const totalHold = Number((numAmount + withdrawFee).toFixed(2));
        if (user.main_balance < totalHold) {
          throw new Error(
            `Insufficient Main Balance. Required: $${totalHold.toFixed(2)} ($${numAmount.toFixed(2)} + $${withdrawFee.toFixed(2)} fee)`
          );
        }
        const authCheck = verifySensitiveActionAuth(user, req.body);
        if (!authCheck.ok) {
          const authErr: any = new Error(authCheck.error);
          authErr.status = authCheck.status;
          throw authErr;
        }
        const nextMain = Number((user.main_balance - totalHold).toFixed(2));
        const nextLocked = Number((user.locked_balance + totalHold).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
          nextMain,
          nextLocked,
          userId
        );

        const id = generateId('WDR');
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO withdraw_requests (id, user_id, amount, fee_usd, gateway, destination_address, proof_note, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
        `).run(
          id,
          userId,
          Number(numAmount.toFixed(2)),
          withdrawFee,
          gateway,
          String(destination_address).trim(),
          proof_note ? String(proof_note).trim() : '',
          now
        );

        await appendLedger(
          userId,
          'MAIN',
          'WITHDRAW_HOLD',
          -totalHold,
          nextMain,
          id,
          `Withdrawal hold ($${numAmount.toFixed(2)} + $${withdrawFee.toFixed(2)} fee via ${gateway}: ${String(destination_address).trim()})`
        );

        return await db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(id);
      })();

      res.status(201).json({ withdrawal: row });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Withdrawal request failed' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 3. P2P MARKETPLACE & INSTANT SEND MONEY
  // ---------------------------------------------------------------------------

  app.post('/api/transfers/send', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { recipient, amount, note } = req.body || {};
    const numAmount = Number(amount);
    if (!recipient || !Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: 'Valid recipient Email/ID and finite positive amount are required' });
      return;
    }

    const senderId = req.auth!.userId;
    const query = String(recipient).trim();
    const sendFee = (await getPlatformSettings()).sendFeeUsd;

    try {
      const result = await db.transaction(async () => {
        const sender = (await db.prepare('SELECT * FROM users WHERE id = ?').get(senderId)) as any;
        const target = (await db
          .prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR UPPER(id) = UPPER(?) OR uid = ?')
          .get(query, query, query)) as any;

        if (!target) {
          throw new Error('Recipient user not found by Email or User ID');
        }
        if (target.id === sender.id) {
          throw new Error('Cannot transfer funds to your own account');
        }
        const totalDebit = Number((numAmount + sendFee).toFixed(2));
        if (sender.main_balance < totalDebit) {
          throw new Error(
            `Insufficient Main Balance. Required: $${totalDebit.toFixed(2)} ($${numAmount.toFixed(2)} + $${sendFee.toFixed(2)} send fee)`
          );
        }

        const authCheck = verifySensitiveActionAuth(sender, req.body);
        if (!authCheck.ok) {
          const authErr: any = new Error(authCheck.error);
          authErr.status = authCheck.status;
          throw authErr;
        }

        const afterTransferSenderMain = Number((sender.main_balance - numAmount).toFixed(2));
        const nextSenderMain = Number((sender.main_balance - totalDebit).toFixed(2));
        const nextTargetMain = Number((target.main_balance + numAmount).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextSenderMain, sender.id);
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextTargetMain, target.id);

        const refId = generateId('SND');
        const descNote = note ? ` — ${String(note).trim()}` : '';
        await appendLedger(
          sender.id,
          'MAIN',
          'SEND_OUT',
          -numAmount,
          afterTransferSenderMain,
          refId,
          `Sent to ${target.full_name} (${target.id})${descNote}`
        );
        if (sendFee > 0) {
          await appendLedger(
            sender.id,
            'MAIN',
            'SEND_FEE',
            -sendFee,
            nextSenderMain,
            refId,
            `Send transfer fee ($${sendFee.toFixed(2)} USDT) for ${refId}`
          );
        }
        await appendLedger(
          target.id,
          'MAIN',
          'SEND_IN',
          numAmount,
          nextTargetMain,
          refId,
          `Received from ${sender.full_name} (${sender.id})${descNote}`
        );

        await createUserNotification({
          userId: target.id,
          category: 'FUNDING',
          title: 'USDT Transfer Received',
          message: `${sender.full_name} sent you +$${numAmount.toFixed(2)} USDT (Ref: ${refId}).`,
          linkTab: 'funding',
        });

        return {
          referenceId: refId,
          amount: numAmount,
          fee: sendFee,
          totalDebited: totalDebit,
          recipient: await sanitizeUser(target),
        };
      })();

      res.json(result);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Transfer failed' });
    }
  }));

  app.get('/api/p2p/offers', requireAuth, ah(async (_req, res) => {
    const offers = await db
      .prepare(`
        SELECT
          o.*,
          u.full_name as creator_name,
          u.email as creator_email,
          u.uid as creator_uid,
          u.kyc_status as creator_kyc_status,
          (
            SELECT COUNT(*) FROM p2p_orders po
            WHERE po.buyer_id = o.creator_id OR po.seller_id = o.creator_id
          ) as creator_orders_count,
          (
            SELECT COUNT(*) FROM p2p_orders po
            WHERE (po.buyer_id = o.creator_id OR po.seller_id = o.creator_id)
              AND po.status IN ('COMPLETED', 'RESOLVED_BUYER', 'RESOLVED_SELLER')
          ) as creator_completed_count,
          (
            SELECT COUNT(*) FROM p2p_orders po
            WHERE (po.buyer_id = o.creator_id OR po.seller_id = o.creator_id)
              AND po.status = 'DISPUTED'
          ) as creator_disputed_count
        FROM p2p_offers o
        JOIN users u ON o.creator_id = u.id
        WHERE o.status = 'ACTIVE' AND o.available_amount > 0
        ORDER BY o.rate_usd ASC, o.created_at DESC
      `)
      .all();
    res.json({ offers });
  }));

  const ALLOWED_P2P_CURRENCIES = new Set(COUNTRIES.map((c) => c.shortCode.toUpperCase()));

  app.post('/api/p2p/offers', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { side, total_amount, min_limit, max_limit, rate_usd, fiat_currency, payment_method, payment_window_min, terms } = req.body || {};
    const total = Number(total_amount);
    const minL = Number(min_limit || 10);
    const maxL = Number(max_limit || total);
    const rate = Number(rate_usd || 1.0);
    const currency = String(fiat_currency || 'USD').trim().toUpperCase();
    const rawWindow = Number(payment_window_min || 15);
    const windowMin = [15, 30, 45, 60].includes(rawWindow) ? rawWindow : 15;

    if (!['BUY', 'SELL'].includes(side)) {
      res.status(400).json({ error: 'Side must be BUY or SELL' });
      return;
    }
    if (!ALLOWED_P2P_CURRENCIES.has(currency)) {
      res.status(400).json({ error: 'Unsupported fiat currency selected.' });
      return;
    }
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      res.status(400).json({ error: 'Price rate must be a finite number greater than 0' });
      return;
    }
    if (!total || !Number.isFinite(total) || total < 10) {
      res.status(400).json({ error: 'Offer total amount must be at least $10.00' });
      return;
    }
    if (!Number.isFinite(minL) || !Number.isFinite(maxL) || minL <= 0 || maxL < minL || maxL > total) {
      res.status(400).json({ error: 'Invalid min/max order limits (max limit cannot exceed offer total)' });
      return;
    }

    const rawMethods = String(payment_method || 'Binance Pay')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => ALLOWED_PAYMENT_METHODS.includes(m as any));
    if (rawMethods.length === 0) {
      res.status(400).json({ error: 'Select at least one valid supported payment method.' });
      return;
    }
    const cleanPaymentMethods = Array.from(new Set(rawMethods)).join(', ');

    const userId = req.auth!.userId;
    const user = (await db.prepare('SELECT main_balance FROM users WHERE id = ?').get(userId)) as { main_balance: number };
    if (side === 'SELL' && user.main_balance < total) {
      res.status(400).json({ error: 'Your Main Balance must cover the SELL offer total amount' });
      return;
    }

    const id = generateId('P2P');
    await db.prepare(`
      INSERT INTO p2p_offers (id, creator_id, side, total_amount, available_amount, min_limit, max_limit, rate_usd, fiat_currency, payment_method, payment_window_min, terms, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
    `).run(
      id,
      userId,
      side,
      Number(total.toFixed(2)),
      Number(total.toFixed(2)),
      Number(minL.toFixed(2)),
      Number(maxL.toFixed(2)),
      Number(rate.toFixed(4)),
      currency,
      cleanPaymentMethods,
      windowMin,
      String(terms || `Fast settlement within ${windowMin} minutes.`).slice(0, 300),
      new Date().toISOString()
    );

    const created = await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(id);
    res.status(201).json({ offer: created });
  }));

  app.delete('/api/p2p/offers/:id', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const offer = (await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(req.params.id)) as any;
    if (!offer || offer.creator_id !== req.auth!.userId) {
      res.status(404).json({ error: 'Offer not found' });
      return;
    }
    await db.prepare("UPDATE p2p_offers SET status = 'CLOSED' WHERE id = ?").run(offer.id);
    res.json({ ok: true });
  }));

  const getEnrichedP2POrder = async (orderId: string) => {
    return (await db
      .prepare(`
        SELECT
          ord.*,
          b.full_name as buyer_name,
          b.email as buyer_email,
          b.uid as buyer_uid,
          s.full_name as seller_name,
          s.email as seller_email,
          s.uid as seller_uid,
          off.terms as offer_terms,
          (SELECT m.body FROM p2p_messages m WHERE m.order_id = ord.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT m.created_at FROM p2p_messages m WHERE m.order_id = ord.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
          (SELECT COUNT(*) FROM p2p_messages m WHERE m.order_id = ord.id) as message_count
        FROM p2p_orders ord
        JOIN users b ON ord.buyer_id = b.id
        JOIN users s ON ord.seller_id = s.id
        LEFT JOIN p2p_offers off ON ord.offer_id = off.id
        WHERE ord.id = ?
      `)
      .get(orderId)) as any;
  };

  const insertP2PMessage = async (params: {
    orderId: string;
    senderId: string | null;
    senderRole: 'BUYER' | 'SELLER' | 'SYSTEM' | 'ADMIN';
    msgType: 'TEXT' | 'SYSTEM' | 'RELEASE_REQUEST' | 'RECEIPT';
    body: string;
    attachmentData?: string | null;
  }) => {
    const msgId = generateId('MSG');
    const createdAt = new Date().toISOString();
    await db.prepare(`
      INSERT INTO p2p_messages (id, order_id, sender_id, sender_role, msg_type, body, attachment_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      params.orderId,
      params.senderId,
      params.senderRole,
      params.msgType,
      params.body,
      params.attachmentData || null,
      createdAt
    );
    return (await db
      .prepare(`
        SELECT m.*, u.full_name as sender_name
        FROM p2p_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `)
      .get(msgId)) as any;
  };

  const broadcastOrderMessage = (order: any, message: any) => {
    const frame = { type: 'P2P_CHAT_MESSAGE', orderId: order.id, message };
    pushToUser(order.buyer_id, frame);
    pushToUser(order.seller_id, frame);
    if (order.status === 'DISPUTED') {
      pushToAdmins(frame);
    }
  };

  const broadcastOrderState = (order: any, eventType: 'P2P_ORDER_CREATED' | 'P2P_RELEASE_REQUEST' | 'P2P_ORDER_UPDATED') => {
    const frame = { type: eventType, order };
    pushToUser(order.buyer_id, frame);
    pushToUser(order.seller_id, frame);
    if (order.status === 'DISPUTED') {
      pushToAdmins(frame);
    }
  };

  app.get('/api/p2p/orders', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const orders = await db
      .prepare(`
        SELECT
          ord.*,
          b.full_name as buyer_name,
          b.email as buyer_email,
          b.uid as buyer_uid,
          s.full_name as seller_name,
          s.email as seller_email,
          s.uid as seller_uid,
          off.terms as offer_terms,
          (SELECT m.body FROM p2p_messages m WHERE m.order_id = ord.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT m.created_at FROM p2p_messages m WHERE m.order_id = ord.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
          (SELECT COUNT(*) FROM p2p_messages m WHERE m.order_id = ord.id) as message_count
        FROM p2p_orders ord
        JOIN users b ON ord.buyer_id = b.id
        JOIN users s ON ord.seller_id = s.id
        LEFT JOIN p2p_offers off ON ord.offer_id = off.id
        WHERE ord.buyer_id = ? OR ord.seller_id = ?
        ORDER BY ord.created_at DESC
      `)
      .all(userId, userId);
    res.json({ orders });
  }));

  app.post('/api/p2p/orders', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { offer_id, amount_vusd, payment_method: requestedMethod } = req.body || {};
    const amt = Number(amount_vusd);
    const takerId = req.auth!.userId;

    try {
      const created = await db.transaction(async () => {
        const offer = (await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(offer_id)) as any;
        if (!offer || offer.status !== 'ACTIVE') {
          throw new Error('P2P offer is no longer active');
        }
        if (offer.creator_id === takerId) {
          throw new Error('Cannot accept your own P2P offer');
        }
        if (!Number.isFinite(amt) || amt < offer.min_limit || amt > offer.max_limit || amt > offer.available_amount) {
          throw new Error(`Amount must be between $${offer.min_limit} and $${Math.min(offer.max_limit, offer.available_amount)}`);
        }

        // If offer.side === 'SELL', creator is seller and taker is buyer.
        // If offer.side === 'BUY', creator is buyer and taker is seller.
        const sellerId = offer.side === 'SELL' ? offer.creator_id : takerId;
        const buyerId = offer.side === 'SELL' ? takerId : offer.creator_id;

        const seller = (await db.prepare('SELECT * FROM users WHERE id = ?').get(sellerId)) as any;
        const buyer = (await db.prepare('SELECT * FROM users WHERE id = ?').get(buyerId)) as any;
        const p2pFee = (await getPlatformSettings()).p2pFeeUsd;
        const escrowTotal = Number((amt + p2pFee).toFixed(2));
        if (seller.main_balance < escrowTotal) {
          throw new Error(
            `Seller has insufficient Main Balance to fund P2P escrow ($${escrowTotal.toFixed(2)} including $${p2pFee.toFixed(2)} fee)`
          );
        }

        const nextSellerMain = Number((seller.main_balance - escrowTotal).toFixed(2));
        const nextSellerLocked = Number((seller.locked_balance + escrowTotal).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
          nextSellerMain,
          nextSellerLocked,
          sellerId
        );

        const nextAvail = Number((offer.available_amount - amt).toFixed(2));
        await db.prepare('UPDATE p2p_offers SET available_amount = ?, status = ? WHERE id = ?').run(
          nextAvail,
          nextAvail <= 0 ? 'CLOSED' : 'ACTIVE',
          offer.id
        );

        const allowedMethods = String(offer.payment_method || 'Binance Pay')
          .split(',')
          .map((m: string) => m.trim())
          .filter(Boolean);
        const chosenMethod =
          requestedMethod && allowedMethods.includes(String(requestedMethod).trim())
            ? String(requestedMethod).trim()
            : allowedMethods[0] || 'Binance Pay';

        const sellerPm = (await db
          .prepare(`
            SELECT method, account_label, account_number, extra_details
            FROM user_payment_methods
            WHERE user_id = ? AND method = ?
            ORDER BY is_default DESC, updated_at DESC
            LIMIT 1
          `)
          .get(sellerId, chosenMethod)) as any;

        const orderId = generateId('ORD');
        const now = new Date().toISOString();
        const windowMin = Number(offer.payment_window_min || 15);
        const expiresAt = new Date(Date.now() + windowMin * 60 * 1000).toISOString();
        const fiatTotal = Number((amt * offer.rate_usd).toFixed(2));
        const fiatCurrency = String(offer.fiat_currency || 'USD').toUpperCase();
        const paymentSnapshot = sellerPm ? JSON.stringify(sellerPm) : null;

        await db.prepare(`
          INSERT INTO p2p_orders (id, offer_id, buyer_id, seller_id, amount_vusd, fee_usd, fiat_total, fiat_currency, payment_method, seller_payment_snapshot, status, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ESCROW_LOCKED', ?, ?, ?)
        `).run(
          orderId,
          offer.id,
          buyerId,
          sellerId,
          amt,
          p2pFee,
          fiatTotal,
          fiatCurrency,
          chosenMethod,
          paymentSnapshot,
          expiresAt,
          now,
          now
        );

        await appendLedger(
          sellerId,
          'MAIN',
          'P2P_ESCROW_LOCK',
          -escrowTotal,
          nextSellerMain,
          orderId,
          `P2P Escrow locked ($${amt.toFixed(2)} + $${p2pFee.toFixed(2)} P2P fee) for ${orderId}`
        );

        const lockMsg = await insertP2PMessage({
          orderId,
          senderId: null,
          senderRole: 'SYSTEM',
          msgType: 'SYSTEM',
          body: `Escrow Protected: ${amt.toFixed(2)} USDT (+ $${p2pFee.toFixed(2)} escrow fee) is safely locked from ${seller.full_name}. ${buyer.full_name} has ${windowMin} minutes to send ${fiatTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${fiatCurrency} via ${chosenMethod}.`,
        });

        const notifyMsg = await insertP2PMessage({
          orderId,
          senderId: null,
          senderRole: 'SYSTEM',
          msgType: 'RELEASE_REQUEST',
          body: `New Buy Order #${orderId} for ${seller.full_name}: ${buyer.full_name} ordered ${amt.toFixed(2)} USDT (${fiatTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${fiatCurrency}). Do NOT release USDT until Buyer sends fiat and you confirm receipt in your ${chosenMethod} account.`,
        });

        return {
          order: await getEnrichedP2POrder(orderId),
          messages: [lockMsg, notifyMsg],
        };
      })();

      broadcastOrderState(created.order, 'P2P_ORDER_CREATED');
      for (const m of created.messages) {
        broadcastOrderMessage(created.order, m);
      }

      if (created.order) {
        const isBuyerRequester = req.auth!.userId === created.order.buyer_id;
        const counterpartyId = isBuyerRequester ? created.order.seller_id : created.order.buyer_id;
        createUserNotification({
          userId: counterpartyId,
          category: 'P2P',
          title: `New P2P Escrow Order · ${Number(created.order.amount_vusd).toFixed(2)} USDT`,
          message: `${isBuyerRequester ? created.order.buyer_name : created.order.seller_name} opened order #${created.order.id} for ${Number(created.order.fiat_total).toFixed(2)} ${created.order.fiat_currency || 'USD'} via ${created.order.payment_method}.`,
          linkTab: 'p2p',
        }).catch(() => {});
      }

      res.status(201).json({ order: created.order, messages: created.messages });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create P2P order' });
    }
  }));

  app.post('/api/p2p/orders/:id/mark-paid', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { payment_reference, screenshot_data } = req.body || {};
    const cleanRef = String(payment_reference || '').trim().slice(0, 120);
    if (cleanRef.length < 3) {
      res.status(400).json({ error: 'Enter your payment Transaction ID / Reference (at least 3 characters) before notifying the seller.' });
      return;
    }

    let validReceipt: string | null = null;
    if (screenshot_data !== undefined && screenshot_data !== null && screenshot_data !== '') {
      const imgStr = String(screenshot_data);
      if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(imgStr) && !/^https?:\/\//i.test(imgStr)) {
        res.status(400).json({ error: 'Payment receipt must be a valid PNG, JPG, GIF, or WebP image.' });
        return;
      }
      if (imgStr.length > 2_000_000) {
        res.status(400).json({ error: 'Payment receipt exceeds 2MB size limit.' });
        return;
      }
      validReceipt = await uploadImageAsset(imgStr, 'p2p', req.auth!.userId);
    }

    try {
      const result = await db.transaction(async () => {
        const order = (await db.prepare('SELECT * FROM p2p_orders WHERE id = ?').get(req.params.id)) as any;
        if (!order || order.buyer_id !== req.auth!.userId) {
          const authErr: any = new Error('Only the buyer can mark this order as paid');
          authErr.status = 403;
          throw authErr;
        }
        if (order.status !== 'ESCROW_LOCKED') {
          throw new Error('Order is not awaiting payment');
        }

        const buyer = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(order.buyer_id)) as { full_name: string };
        const seller = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(order.seller_id)) as { full_name: string };
        const now = new Date().toISOString();

        await db.prepare('UPDATE p2p_orders SET status = ?, payment_reference = ?, paid_at = ?, updated_at = ? WHERE id = ?').run(
          'PAID',
          cleanRef,
          now,
          now,
          order.id
        );

        const releaseReqMsg = await insertP2PMessage({
          orderId: order.id,
          senderId: null,
          senderRole: 'SYSTEM',
          msgType: 'RELEASE_REQUEST',
          body: `PAYMENT SENT — RELEASE USDT REQUEST: ${buyer.full_name} marked ${Number(order.fiat_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${order.fiat_currency || 'USD'} (${order.payment_method}) as PAID (Ref: ${cleanRef}). ${seller.full_name}: Please verify the funds in your account and release ${Number(order.amount_vusd).toFixed(2)} USDT now.`,
        });

        const msgs = [releaseReqMsg];
        if (validReceipt) {
          const receiptMsg = await insertP2PMessage({
            orderId: order.id,
            senderId: order.buyer_id,
            senderRole: 'BUYER',
            msgType: 'RECEIPT',
            body: `Uploaded payment receipt (Ref: ${cleanRef})`,
            attachmentData: validReceipt,
          });
          msgs.push(receiptMsg);
        }

        return { order: await getEnrichedP2POrder(order.id), messages: msgs };
      })();

      broadcastOrderState(result.order, 'P2P_RELEASE_REQUEST');
      for (const m of result.messages) {
        broadcastOrderMessage(result.order, m);
      }
      if (result.order) {
        createUserNotification({
          userId: result.order.seller_id,
          category: 'P2P',
          title: `P2P Payment Sent · #${result.order.id}`,
          message: `${result.order.buyer_name} marked ${Number(result.order.fiat_total).toFixed(2)} ${result.order.fiat_currency || 'USD'} as PAID. Verify receipt and release ${Number(result.order.amount_vusd).toFixed(2)} USDT.`,
          linkTab: 'p2p',
        }).catch(() => {});
      }
      res.json({ order: result.order, messages: result.messages });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Unable to mark order as paid' });
    }
  }));

  app.post('/api/p2p/orders/:id/release', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    try {
      const result = await db.transaction(async () => {
        const order = (await db.prepare('SELECT * FROM p2p_orders WHERE id = ?').get(req.params.id)) as any;
        if (!order || order.seller_id !== userId) {
          throw new Error('Only the seller can release escrow');
        }
        if (order.status === 'ESCROW_LOCKED') {
          throw new Error('Buyer has not clicked "Transferred, Notify Seller" yet. Wait for payment confirmation before releasing.');
        }
        if (order.status !== 'PAID') {
          throw new Error('Order cannot be released in its current state');
        }

        const seller = (await db.prepare('SELECT * FROM users WHERE id = ?').get(order.seller_id)) as any;
        const authCheck = verifySensitiveActionAuth(seller, req.body);
        if (!authCheck.ok) {
          const authErr: any = new Error(authCheck.error);
          authErr.status = authCheck.status;
          throw authErr;
        }

        const buyer = (await db.prepare('SELECT * FROM users WHERE id = ?').get(order.buyer_id)) as any;
        const p2pFee = Number(order.fee_usd || 0);
        const totalLockedForOrder = Number((order.amount_vusd + p2pFee).toFixed(2));

        const nextSellerLocked = Math.max(0, Number((seller.locked_balance - totalLockedForOrder).toFixed(2)));
        const nextBuyerMain = Number((buyer.main_balance + order.amount_vusd).toFixed(2));

        await db.prepare('UPDATE users SET locked_balance = ? WHERE id = ?').run(nextSellerLocked, seller.id);
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextBuyerMain, buyer.id);

        await db.prepare('UPDATE p2p_orders SET status = ?, updated_at = ? WHERE id = ?').run(
          'COMPLETED',
          new Date().toISOString(),
          order.id
        );

        await appendLedger(
          buyer.id,
          'MAIN',
          'P2P_RELEASE',
          order.amount_vusd,
          nextBuyerMain,
          order.id,
          `P2P Escrow released from ${seller.full_name} (Platform fee: $${p2pFee.toFixed(2)})`
        );

        const releaseMsg = await insertP2PMessage({
          orderId: order.id,
          senderId: null,
          senderRole: 'SYSTEM',
          msgType: 'SYSTEM',
          body: `Escrow Completed: ${seller.full_name} confirmed fiat receipt and released ${Number(order.amount_vusd).toFixed(2)} USDT to ${buyer.full_name}'s Main Balance.`,
        });

        return { order: await getEnrichedP2POrder(order.id), message: releaseMsg };
      })();

      broadcastOrderState(result.order, 'P2P_ORDER_UPDATED');
      broadcastOrderMessage(result.order, result.message);
      if (result.order) {
        createUserNotification({
          userId: result.order.buyer_id,
          category: 'P2P',
          title: `P2P Escrow Released · +$${Number(result.order.amount_vusd).toFixed(2)} USDT`,
          message: `${result.order.seller_name} released ${Number(result.order.amount_vusd).toFixed(2)} USDT into your Main Balance (Order #${result.order.id}).`,
          linkTab: 'p2p',
        }).catch(() => {});
      }
      res.json({ order: result.order, message: result.message });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Release failed' });
    }
  }));

  app.post('/api/p2p/orders/:id/cancel', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    try {
      const result = await db.transaction(async () => {
        const order = (await db.prepare('SELECT * FROM p2p_orders WHERE id = ?').get(req.params.id)) as any;
        if (!order || (order.buyer_id !== userId && order.seller_id !== userId)) {
          const authErr: any = new Error('Not authorized for this order');
          authErr.status = 403;
          throw authErr;
        }
        if (order.status !== 'ESCROW_LOCKED') {
          throw new Error('Orders already marked as PAID or settled cannot be cancelled. Use Dispute for arbitration.');
        }

        const offer = (await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(order.offer_id)) as any;
        if (order.seller_id === userId) {
          const expMs = order.expires_at ? Date.parse(order.expires_at) : 0;
          if (!expMs || Date.now() < expMs) {
            const winMin = Number(offer?.payment_window_min || 15);
            throw new Error(`Seller can only cancel an unpaid order after the ${winMin}-minute payment timer expires.`);
          }
        }

        const seller = (await db.prepare('SELECT * FROM users WHERE id = ?').get(order.seller_id)) as any;
        const actor = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId)) as { full_name: string };
        const p2pFee = Number(order.fee_usd || 0);
        const totalLockedForOrder = Number((order.amount_vusd + p2pFee).toFixed(2));
        const nextSellerLocked = Math.max(0, Number((seller.locked_balance - totalLockedForOrder).toFixed(2)));
        const nextSellerMain = Number((seller.main_balance + totalLockedForOrder).toFixed(2));

        await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
          nextSellerMain,
          nextSellerLocked,
          seller.id
        );

        if (offer) {
          const restoredAvail = Number((offer.available_amount + order.amount_vusd).toFixed(2));
          const shouldReactivate = offer.status === 'ACTIVE' || Number(offer.available_amount) <= 0;
          await db.prepare('UPDATE p2p_offers SET available_amount = ?, status = ? WHERE id = ?').run(
            restoredAvail,
            shouldReactivate ? 'ACTIVE' : offer.status,
            offer.id
          );
        }

        await db.prepare("UPDATE p2p_orders SET status = 'CANCELLED', fee_usd = 0, updated_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          order.id
        );

        await appendLedger(
          seller.id,
          'MAIN',
          'P2P_REFUND',
          totalLockedForOrder,
          nextSellerMain,
          order.id,
          `Cancelled unpaid P2P order ${order.id} — escrowed funds refunded`
        );

        const cancelMsg = await insertP2PMessage({
          orderId: order.id,
          senderId: null,
          senderRole: 'SYSTEM',
          msgType: 'SYSTEM',
          body: `Order Cancelled by ${actor.full_name}. Escrowed ${Number(order.amount_vusd).toFixed(2)} USDT (+ $${p2pFee.toFixed(2)} fee) was safely refunded to Seller's Main Balance.`,
        });

        return { order: await getEnrichedP2POrder(order.id), message: cancelMsg };
      })();

      broadcastOrderState(result.order, 'P2P_ORDER_UPDATED');
      broadcastOrderMessage(result.order, result.message);
      res.json({ order: result.order, message: result.message });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message || 'Cancel failed' });
    }
  }));

  app.post('/api/p2p/orders/:id/dispute', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { reason } = req.body || {};
    const userId = req.auth!.userId;
    const order = (await db.prepare('SELECT * FROM p2p_orders WHERE id = ?').get(req.params.id)) as any;
    if (!order || (order.buyer_id !== userId && order.seller_id !== userId)) {
      res.status(403).json({ error: 'Not authorized for this order' });
      return;
    }
    if (!['ESCROW_LOCKED', 'PAID'].includes(order.status)) {
      res.status(400).json({ error: 'Cannot open dispute for this order status' });
      return;
    }

    const cleanReason = String(reason || 'Payment verification dispute').trim().slice(0, 240);
    const actor = (await db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId)) as { full_name: string };
    const actorRole = order.buyer_id === userId ? 'Buyer' : 'Seller';

    const result = await db.transaction(async () => {
      await db.prepare(`
        UPDATE p2p_orders SET status = 'DISPUTED', dispute_reason = ?, dispute_opened_by = ?, updated_at = ? WHERE id = ?
      `).run(cleanReason, userId, new Date().toISOString(), order.id);

      const disputeMsg = await insertP2PMessage({
        orderId: order.id,
        senderId: null,
        senderRole: 'SYSTEM',
        msgType: 'SYSTEM',
        body: `DISPUTE OPENED by ${actorRole} (${actor.full_name}): "${cleanReason}". Escrowed USDT is frozen and escalated to Master Admin for review.`,
      });

      return { order: await getEnrichedP2POrder(order.id), message: disputeMsg };
    })();

    broadcastOrderState(result.order, 'P2P_ORDER_UPDATED');
    broadcastOrderMessage(result.order, result.message);
    res.json({ order: result.order, message: result.message });
  }));

  app.get('/api/p2p/orders/:id/messages', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const order = await getEnrichedP2POrder(req.params.id);
    if (!order || (!isAdmin && order.buyer_id !== userId && order.seller_id !== userId)) {
      res.status(403).json({ error: 'Not authorized to access this order chat' });
      return;
    }

    const messages = await db
      .prepare(`
        SELECT m.*, u.full_name as sender_name
        FROM p2p_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.order_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(order.id);

    res.json({ order, messages });
  }));

  app.post('/api/p2p/orders/:id/messages', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const order = await getEnrichedP2POrder(req.params.id);
    if (!order || (!isAdmin && order.buyer_id !== userId && order.seller_id !== userId)) {
      res.status(403).json({ error: 'Not authorized to message in this order' });
      return;
    }

    const { body, attachment_data } = req.body || {};
    const cleanBody = String(body || '').trim().slice(0, 1000);
    let validAttachment: string | null = null;

    if (attachment_data !== undefined && attachment_data !== null && attachment_data !== '') {
      const imgStr = String(attachment_data);
      if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(imgStr) && !/^https?:\/\//i.test(imgStr)) {
        res.status(400).json({ error: 'Attachment must be a valid PNG, JPG, GIF, or WebP image.' });
        return;
      }
      if (imgStr.length > 2_000_000) {
        res.status(400).json({ error: 'Attachment exceeds 2MB size limit.' });
        return;
      }
      validAttachment = await uploadImageAsset(imgStr, 'p2p', userId);
    }

    if (!cleanBody && !validAttachment) {
      res.status(400).json({ error: 'Enter a message or attach a receipt image.' });
      return;
    }

    const senderRole: 'BUYER' | 'SELLER' | 'ADMIN' =
      order.buyer_id === userId ? 'BUYER' : order.seller_id === userId ? 'SELLER' : 'ADMIN';

    const message = await insertP2PMessage({
      orderId: order.id,
      senderId: userId,
      senderRole,
      msgType: validAttachment ? 'RECEIPT' : 'TEXT',
      body: cleanBody || 'Uploaded payment receipt screenshot',
      attachmentData: validAttachment,
    });

    await db.prepare('UPDATE p2p_orders SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), order.id);
    broadcastOrderMessage(order, message);

    res.status(201).json({ message });
  }));

  // ---------------------------------------------------------------------------
  // 4. SPOT TRADING & POSITIONS
  // ---------------------------------------------------------------------------

  app.get('/api/markets', ah(async (_req, res) => {
    res.json({ pairs: await getMarketSnapshot() });
  }));

  app.get('/api/markets/klines', ah(async (req, res) => {
    const symbol = String(req.query.symbol || 'BTC/USDT');
    const interval = String(req.query.interval || '30m');
    const limit = Number(req.query.limit || 40);
    const candles = await fetchLiveKlines(symbol, interval, limit);
    res.json({ symbol, interval, candles });
  }));

  app.get('/api/markets/book', ah(async (req, res) => {
    const symbol = String(req.query.symbol || 'BTC/USDT');
    const data = await fetchLiveOrderBookAndTrades(symbol);
    res.json({ symbol, ...data });
  }));

  async function getUserSpotSnapshot(userId: string) {
    const [trades, holdings, userBalances] = await Promise.all([
      db.prepare('SELECT * FROM spot_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId),
      db.prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND quantity > 0').all(userId),
      db.prepare('SELECT main_balance, locked_balance FROM users WHERE id = ?').get(userId) as Promise<
        { main_balance: number; locked_balance: number } | undefined
      >,
    ]);
    return {
      trades,
      holdings,
      main_balance: userBalances?.main_balance,
      locked_balance: userBalances?.locked_balance,
    };
  }

  app.get('/api/trades', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const [trades, holdings] = await Promise.all([
      db.prepare('SELECT * FROM spot_trades WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId),
      db.prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND quantity > 0').all(userId),
    ]);
    res.json({ trades, holdings });
  }));

  app.post('/api/trades/spot', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { symbol, side, amount_usd, quantity, order_type = 'MARKET', limit_price } = req.body || {};
    if (!symbol || !['BUY', 'SELL'].includes(side)) {
      res.status(400).json({ error: 'Valid symbol and side (BUY/SELL) required' });
      return;
    }

    const userId = req.auth!.userId;
    try {
      const result = await db.transaction(async () => {
        const pair = (await db.prepare('SELECT * FROM market_pairs WHERE symbol = ?').get(symbol)) as MarketPairRow | undefined;
        if (!pair) throw new Error('Trading pair not found');

        const { bid, ask } = computeBidAsk(pair.current_price, pair.spread_bps);
        const isLimit = order_type === 'LIMIT';
        const targetLimitPrice = isLimit ? Number(limit_price) : 0;
        if (isLimit && (!Number.isFinite(targetLimitPrice) || targetLimitPrice <= 0)) {
          throw new Error('Valid limit price is required for Limit orders');
        }

        const execPrice = side === 'BUY' ? ask : bid;
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const now = new Date().toISOString();
        const tradeId = generateId('TRD');

        // LIMIT ORDER FLOW
        if (isLimit) {
          if (side === 'BUY') {
            const qty = quantity ? Number(quantity) : Number((Number(amount_usd) / targetLimitPrice).toFixed(8));
            const usd = amount_usd ? Number(amount_usd) : Number((qty * targetLimitPrice).toFixed(2));
            if (!Number.isFinite(usd) || usd < 5 || !Number.isFinite(qty) || qty <= 0) {
              throw new Error('Minimum limit order total is $5.00');
            }
            if (user.main_balance < usd) throw new Error('Insufficient Main Balance');

            // Immediate fill if market Ask is already <= limit_price (Taker)
            if (ask <= targetLimitPrice) {
              const { takerRate } = getSpotFeeRates();
              const feeUsd = Number((usd * takerRate).toFixed(2));
              const netUsd = Math.max(0, Number((usd - feeUsd).toFixed(2)));
              const fillQty = Number((netUsd / ask).toFixed(8));
              const nextMain = Number((user.main_balance - usd).toFixed(2));
              await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

              const existingHolding = (await db
                .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
                .get(userId, pair.base_asset)) as any;
              const prevQty = existingHolding && Number(existingHolding.quantity) > 0 ? Number(existingHolding.quantity) : 0;
              const prevCost = prevQty > 0 ? prevQty * Number(existingHolding.avg_entry_price || 0) : 0;
              const newQty = Number((prevQty + fillQty).toFixed(8));
              const rawAvg = newQty > 0 ? (prevCost + usd) / newQty : ask;
              const newAvg = Number(rawAvg.toFixed(8));
              if (existingHolding) {
                await db.prepare('UPDATE user_coin_holdings SET quantity = ?, avg_entry_price = ? WHERE user_id = ? AND asset = ?').run(
                  newQty,
                  newAvg,
                  userId,
                  pair.base_asset
                );
              } else {
                await db.prepare('INSERT INTO user_coin_holdings (user_id, asset, quantity, avg_entry_price) VALUES (?, ?, ?, ?)').run(
                  userId,
                  pair.base_asset,
                  fillQty,
                  newAvg
                );
              }

              await db.prepare(`
                INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, exit_price, limit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at, settled_at)
                VALUES (?, ?, ?, 'LIMIT', 'BUY', ?, ?, ?, ?, ?, ?, ?, 'TAKER', 0, 0, 'NONE', 'SETTLED', ?, ?)
              `).run(tradeId, userId, symbol, usd, fillQty, ask, ask, targetLimitPrice, pair.spread_bps, feeUsd, now, now);

              await appendLedger(
                userId,
                'MAIN',
                'SPOT_BUY',
                -usd,
                nextMain,
                tradeId,
                `Limit Buy Filled ${fillQty} ${pair.base_asset} @ $${ask} (Taker fee: $${feeUsd.toFixed(2)})`
              );
              return { tradeId, side, qty: fillQty, execPrice: ask, usd, feeUsd, status: 'SETTLED' };
            }

            // Lock funds in open Limit Buy order (Maker fee applied on fill)
            const nextMain = Number((user.main_balance - usd).toFixed(2));
            const nextLocked = Number((user.locked_balance + usd).toFixed(2));
            await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(nextMain, nextLocked, userId);

            await db.prepare(`
              INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, limit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at)
              VALUES (?, ?, ?, 'LIMIT', 'BUY', ?, ?, ?, ?, ?, 0, 'MAKER', 0, 0, 'NONE', 'OPEN', ?)
            `).run(tradeId, userId, symbol, usd, qty, targetLimitPrice, targetLimitPrice, pair.spread_bps, now);

            await appendLedger(userId, 'MAIN', 'SPOT_BUY', -usd, nextMain, tradeId, `Open Limit Buy ${qty} ${pair.base_asset} @ $${targetLimitPrice}`);
            return { tradeId, side, qty, execPrice: targetLimitPrice, usd, status: 'OPEN' };
          } else {
            const qtyToSell = Number(quantity);
            if (!Number.isFinite(qtyToSell) || qtyToSell <= 0) throw new Error('Quantity to sell must be positive');

            const existingHolding = (await db
              .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
              .get(userId, pair.base_asset)) as any;
            if (!existingHolding || existingHolding.quantity < qtyToSell) {
              throw new Error(`Insufficient ${pair.base_asset} balance`);
            }

            const proceedsUsd = Number((qtyToSell * targetLimitPrice).toFixed(2));
            if (!Number.isFinite(proceedsUsd) || proceedsUsd < 5) throw new Error('Minimum limit order total is $5.00');

            // Immediate fill if market Bid is already >= limit_price (Taker)
            if (bid >= targetLimitPrice) {
              const { takerRate } = getSpotFeeRates();
              const grossProceeds = Number((qtyToSell * bid).toFixed(2));
              const feeUsd = Number((grossProceeds * takerRate).toFixed(2));
              const netProceeds = Math.max(0, Number((grossProceeds - feeUsd).toFixed(2)));
              const remainingRaw = existingHolding.quantity - qtyToSell;
              const remainingQty = remainingRaw < 1e-8 ? 0 : Number(remainingRaw.toFixed(8));
              const realizedPnl = Number((netProceeds - qtyToSell * existingHolding.avg_entry_price).toFixed(2));

              await db.prepare('UPDATE user_coin_holdings SET quantity = ? WHERE user_id = ? AND asset = ?').run(
                remainingQty,
                userId,
                pair.base_asset
              );
              const nextMain = Number((user.main_balance + netProceeds).toFixed(2));
              await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

              await db.prepare(`
                INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, exit_price, limit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at, settled_at)
                VALUES (?, ?, ?, 'LIMIT', 'SELL', ?, ?, ?, ?, ?, ?, ?, 'TAKER', 0, ?, 'NONE', 'SETTLED', ?, ?)
              `).run(tradeId, userId, symbol, grossProceeds, qtyToSell, existingHolding.avg_entry_price, bid, targetLimitPrice, pair.spread_bps, feeUsd, realizedPnl, now, now);

              await appendLedger(
                userId,
                'MAIN',
                'SPOT_SELL',
                netProceeds,
                nextMain,
                tradeId,
                `Limit Sell Filled ${qtyToSell} ${pair.base_asset} @ $${bid} (Taker fee: $${feeUsd.toFixed(2)})`
              );
              return { tradeId, side, qty: qtyToSell, execPrice: bid, usd: netProceeds, feeUsd, realizedPnl, status: 'SETTLED' };
            }

            // Escrow coins in open Limit Sell order (Maker fee applied on fill)
            const remainingRaw = existingHolding.quantity - qtyToSell;
            const remainingQty = remainingRaw < 1e-8 ? 0 : Number(remainingRaw.toFixed(8));
            await db.prepare('UPDATE user_coin_holdings SET quantity = ? WHERE user_id = ? AND asset = ?').run(
              remainingQty,
              userId,
              pair.base_asset
            );

            await db.prepare(`
              INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, limit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at)
              VALUES (?, ?, ?, 'LIMIT', 'SELL', ?, ?, ?, ?, ?, 0, 'MAKER', 0, 0, 'NONE', 'OPEN', ?)
            `).run(tradeId, userId, symbol, proceedsUsd, qtyToSell, existingHolding.avg_entry_price, targetLimitPrice, pair.spread_bps, now);

            return { tradeId, side, qty: qtyToSell, execPrice: targetLimitPrice, usd: proceedsUsd, status: 'OPEN' };
          }
        }

        // MARKET ORDER FLOW (Taker)
        if (side === 'BUY') {
          const usd = amount_usd ? Number(amount_usd) : Number((Number(quantity) * execPrice).toFixed(2));
          if (!Number.isFinite(usd) || usd < 5) throw new Error('Minimum spot buy is $5.00');
          if (user.main_balance < usd) throw new Error('Insufficient Main Balance');

          const { takerRate } = getSpotFeeRates();
          const feeUsd = Number((usd * takerRate).toFixed(2));
          const netUsd = Math.max(0, Number((usd - feeUsd).toFixed(2)));
          const qtyBought = Number((netUsd / execPrice).toFixed(8));
          const nextMain = Number((user.main_balance - usd).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

          const existingHolding = (await db
            .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
            .get(userId, pair.base_asset)) as any;
          const prevQty = existingHolding && Number(existingHolding.quantity) > 0 ? Number(existingHolding.quantity) : 0;
          const prevCost = prevQty > 0 ? prevQty * Number(existingHolding.avg_entry_price || 0) : 0;
          const newQty = Number((prevQty + qtyBought).toFixed(8));
          const rawAvg = newQty > 0 ? (prevCost + usd) / newQty : execPrice;
          const newAvg = Number(rawAvg.toFixed(8));

          if (existingHolding) {
            await db.prepare('UPDATE user_coin_holdings SET quantity = ?, avg_entry_price = ? WHERE user_id = ? AND asset = ?').run(
              newQty,
              newAvg,
              userId,
              pair.base_asset
            );
          } else {
            await db.prepare('INSERT INTO user_coin_holdings (user_id, asset, quantity, avg_entry_price) VALUES (?, ?, ?, ?)').run(
              userId,
              pair.base_asset,
              qtyBought,
              newAvg
            );
          }

          await db.prepare(`
            INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, exit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at, settled_at)
            VALUES (?, ?, ?, 'SPOT', 'BUY', ?, ?, ?, ?, ?, ?, 'TAKER', 0, 0, 'NONE', 'SETTLED', ?, ?)
          `).run(tradeId, userId, symbol, usd, qtyBought, execPrice, execPrice, pair.spread_bps, feeUsd, now, now);

          await appendLedger(
            userId,
            'MAIN',
            'SPOT_BUY',
            -usd,
            nextMain,
            tradeId,
            `Spot Buy ${qtyBought} ${pair.base_asset} @ $${execPrice} (Taker fee: $${feeUsd.toFixed(2)})`
          );

          return { tradeId, side, qty: qtyBought, execPrice, usd, feeUsd, status: 'SETTLED' };
        } else {
          const qtyToSell = Number(quantity);
          if (!Number.isFinite(qtyToSell) || qtyToSell <= 0) throw new Error('Quantity to sell must be positive');

          const existingHolding = (await db
            .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
            .get(userId, pair.base_asset)) as any;
          if (!existingHolding || existingHolding.quantity < qtyToSell) {
            throw new Error(`Insufficient ${pair.base_asset} balance`);
          }

          const { takerRate } = getSpotFeeRates();
          const grossProceeds = Number((qtyToSell * execPrice).toFixed(2));
          if (grossProceeds < 0.01) throw new Error('Order proceeds must be at least $0.01');
          const feeUsd = Number((grossProceeds * takerRate).toFixed(2));
          const netProceeds = Math.max(0, Number((grossProceeds - feeUsd).toFixed(2)));
          const costBasis = qtyToSell * existingHolding.avg_entry_price;
          const realizedPnl = Number((netProceeds - costBasis).toFixed(2));
          const remainingRaw = existingHolding.quantity - qtyToSell;
          const remainingQty = remainingRaw < 1e-8 ? 0 : Number(remainingRaw.toFixed(8));

          await db.prepare('UPDATE user_coin_holdings SET quantity = ? WHERE user_id = ? AND asset = ?').run(
            remainingQty,
            userId,
            pair.base_asset
          );

          const nextMain = Number((user.main_balance + netProceeds).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

          await db.prepare(`
            INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, exit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at, settled_at)
            VALUES (?, ?, ?, 'SPOT', 'SELL', ?, ?, ?, ?, ?, ?, 'TAKER', 0, ?, 'NONE', 'SETTLED', ?, ?)
          `).run(tradeId, userId, symbol, grossProceeds, qtyToSell, existingHolding.avg_entry_price, execPrice, pair.spread_bps, feeUsd, realizedPnl, now, now);

          await appendLedger(
            userId,
            'MAIN',
            'SPOT_SELL',
            netProceeds,
            nextMain,
            tradeId,
            `Spot Sell ${qtyToSell} ${pair.base_asset} @ $${execPrice} (Taker fee: $${feeUsd.toFixed(2)})`
          );

          return { tradeId, side, qty: qtyToSell, execPrice, usd: netProceeds, feeUsd, realizedPnl, status: 'SETTLED' };
        }
      })();

      const snap = await getUserSpotSnapshot(userId);
      res.status(201).json({ ...result, ...snap });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Spot trade failed' });
    }
  }));

  app.post('/api/trades/limit/:id/cancel', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    try {
      const cancelled = await db.transaction(async () => {
        const trade = (await db.prepare('SELECT * FROM spot_trades WHERE id = ?').get(req.params.id)) as any;
        if (!trade || trade.user_id !== userId) throw new Error('Order not found');
        if (trade.order_mode !== 'LIMIT' || trade.status !== 'OPEN') {
          throw new Error('Only open Limit orders can be cancelled');
        }

        const pair = (await db.prepare('SELECT base_asset FROM market_pairs WHERE symbol = ?').get(trade.symbol)) as {
          base_asset: string;
        };

        if (trade.side === 'BUY') {
          const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
          const nextMain = Number((user.main_balance + trade.amount_usd).toFixed(2));
          const nextLocked = Math.max(0, Number((user.locked_balance - trade.amount_usd).toFixed(2)));
          await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
            nextMain,
            nextLocked,
            userId
          );
          await appendLedger(userId, 'MAIN', 'SPOT_CANCEL', trade.amount_usd, nextMain, trade.id, `Cancelled Limit Buy ${trade.symbol}`);
        } else {
          const existingHolding = (await db
            .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
            .get(userId, pair.base_asset)) as any;
          if (existingHolding) {
            await db.prepare('UPDATE user_coin_holdings SET quantity = quantity + ? WHERE user_id = ? AND asset = ?').run(
              trade.quantity,
              userId,
              pair.base_asset
            );
          } else {
            await db.prepare('INSERT INTO user_coin_holdings (user_id, asset, quantity, avg_entry_price) VALUES (?, ?, ?, ?)').run(
              userId,
              pair.base_asset,
              trade.quantity,
              trade.entry_price
            );
          }
        }

        await db.prepare("UPDATE spot_trades SET status = 'CANCELLED', settled_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          trade.id
        );

        return await db.prepare('SELECT * FROM spot_trades WHERE id = ?').get(trade.id);
      })();

      const snap = await getUserSpotSnapshot(userId);
      res.json({ trade: cancelled, ...snap });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Cancel failed' });
    }
  }));

  app.post('/api/trades/spot/close-holding', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const rawAsset = String(req.body?.asset || '').trim().toUpperCase();
    const rawSymbol = String(req.body?.symbol || '').trim().toUpperCase();
    const asset = rawAsset || (rawSymbol.includes('/') ? rawSymbol.split('/')[0] : rawSymbol);
    if (!asset) {
      res.status(400).json({ error: 'Valid asset symbol is required' });
      return;
    }

    const userId = req.auth!.userId;
    try {
      const result = await db.transaction(async () => {
        const holding = (await db
          .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
          .get(userId, asset)) as any;
        if (!holding || Number(holding.quantity) <= 0) {
          throw new Error(`No active ${asset} holding to close`);
        }

        const pair = (await db
          .prepare('SELECT * FROM market_pairs WHERE base_asset = ? OR symbol = ?')
          .get(asset, `${asset}/USDT`)) as MarketPairRow | undefined;
        if (!pair) throw new Error(`Market pair for ${asset} not found`);

        const { bid } = computeBidAsk(pair.current_price, pair.spread_bps);
        const execPrice = bid > 0 ? bid : pair.current_price;
        const qtyToSell = Number(holding.quantity);
        const grossProceeds = Number((qtyToSell * execPrice).toFixed(2));
        if (grossProceeds < 0.01) throw new Error('Current holding value is below $0.01');

        const { takerRate } = getSpotFeeRates();
        const feeUsd = Number((grossProceeds * takerRate).toFixed(2));
        const netProceeds = Math.max(0, Number((grossProceeds - feeUsd).toFixed(2)));
        const costBasis = qtyToSell * Number(holding.avg_entry_price || execPrice);
        const realizedPnl = Number((netProceeds - costBasis).toFixed(2));

        await db
          .prepare('UPDATE user_coin_holdings SET quantity = 0 WHERE user_id = ? AND asset = ?')
          .run(userId, asset);

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const nextMain = Number((Number(user.main_balance || 0) + netProceeds).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

        const tradeId = generateId('TRD');
        const now = new Date().toISOString();
        await db.prepare(`
          INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, exit_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, admin_override, status, created_at, settled_at)
          VALUES (?, ?, ?, 'SPOT', 'SELL', ?, ?, ?, ?, ?, ?, 'TAKER', 0, ?, 'NONE', 'SETTLED', ?, ?)
        `).run(
          tradeId,
          userId,
          pair.symbol,
          grossProceeds,
          qtyToSell,
          holding.avg_entry_price,
          execPrice,
          pair.spread_bps,
          feeUsd,
          realizedPnl,
          now,
          now
        );

        await appendLedger(
          userId,
          'MAIN',
          'SPOT_SELL',
          netProceeds,
          nextMain,
          tradeId,
          `Closed Spot ${qtyToSell} ${asset} @ $${execPrice} (P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)})`
        );

        return {
          tradeId,
          asset,
          symbol: pair.symbol,
          qty: qtyToSell,
          entryPrice: Number(holding.avg_entry_price),
          execPrice,
          grossProceeds,
          feeUsd,
          netProceeds,
          realizedPnl,
        };
      })();

      const snap = await getUserSpotSnapshot(userId);
      res.json({ ...result, ...snap });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to close Spot holding' });
    }
  }));

  app.post('/api/trades/position', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { symbol, side, amount_usd, tp_price, sl_price } = req.body || {};
    const usd = Number(amount_usd);
    if (!symbol || !['LONG', 'SHORT'].includes(side) || !Number.isFinite(usd) || usd < 10) {
      res.status(400).json({ error: 'Symbol, LONG/SHORT side, and minimum $10.00 stake are required' });
      return;
    }

    const parsedTp = tp_price !== undefined && tp_price !== null && tp_price !== '' ? Number(tp_price) : null;
    const parsedSl = sl_price !== undefined && sl_price !== null && sl_price !== '' ? Number(sl_price) : null;
    if (parsedTp !== null && (!Number.isFinite(parsedTp) || parsedTp <= 0)) {
      res.status(400).json({ error: 'Take-Profit price must be a positive number' });
      return;
    }
    if (parsedSl !== null && (!Number.isFinite(parsedSl) || parsedSl <= 0)) {
      res.status(400).json({ error: 'Stop-Loss price must be a positive number' });
      return;
    }

    const userId = req.auth!.userId;
    try {
      const trade = await db.transaction(async () => {
        const pair = (await db.prepare('SELECT * FROM market_pairs WHERE symbol = ?').get(symbol)) as MarketPairRow | undefined;
        if (!pair) throw new Error('Market pair not found');

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        if (user.main_balance < usd) throw new Error('Insufficient Main Balance');

        const { bid, ask } = computeBidAsk(pair.current_price, pair.spread_bps);
        const entryPrice = side === 'LONG' ? ask : bid;

        if (parsedTp !== null) {
          if (side === 'LONG' && parsedTp <= entryPrice) {
            throw new Error(`For LONG positions, Take-Profit ($${parsedTp}) must be above entry price ($${entryPrice}).`);
          }
          if (side === 'SHORT' && parsedTp >= entryPrice) {
            throw new Error(`For SHORT positions, Take-Profit ($${parsedTp}) must be below entry price ($${entryPrice}).`);
          }
        }
        if (parsedSl !== null) {
          if (side === 'LONG' && parsedSl >= entryPrice) {
            throw new Error(`For LONG positions, Stop-Loss ($${parsedSl}) must be below entry price ($${entryPrice}).`);
          }
          if (side === 'SHORT' && parsedSl <= entryPrice) {
            throw new Error(`For SHORT positions, Stop-Loss ($${parsedSl}) must be above entry price ($${entryPrice}).`);
          }
        }

        const { takerRate } = getSpotFeeRates();
        const qty = Number((usd / entryPrice).toFixed(8));
        const openFeeUsd = Number((usd * takerRate).toFixed(2));

        const nextMain = Number((user.main_balance - usd).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

        const tradeId = generateId('TRD');
        const now = new Date().toISOString();

        await db.prepare(`
          INSERT INTO spot_trades (id, user_id, symbol, order_mode, side, amount_usd, quantity, entry_price, spread_bps, fee_usd, fee_role, is_liquidated, pnl_usd, tp_price, sl_price, admin_override, status, created_at)
          VALUES (?, ?, ?, 'POSITION', ?, ?, ?, ?, ?, ?, 'TAKER', 0, 0, ?, ?, 'NONE', 'OPEN', ?)
        `).run(tradeId, userId, symbol, side, usd, qty, entryPrice, pair.spread_bps, openFeeUsd, parsedTp, parsedSl, now);

        const tpSlNote =
          parsedTp || parsedSl
            ? ` [TP: ${parsedTp ? `$${parsedTp}` : '—'} · SL: ${parsedSl ? `$${parsedSl}` : '—'}]`
            : '';

        await appendLedger(
          userId,
          'MAIN',
          'SPOT_BUY',
          -usd,
          nextMain,
          tradeId,
          `Opened ${side} position on ${symbol} @ $${entryPrice} (Taker fee: $${openFeeUsd.toFixed(2)})${tpSlNote}`
        );
        return await db.prepare('SELECT * FROM spot_trades WHERE id = ?').get(tradeId);
      })();

      const snap = await getUserSpotSnapshot(userId);
      res.status(201).json({ trade, ...snap });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to open position' });
    }
  }));

  app.post('/api/trades/position/:id/close', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    try {
      const settled = await db.transaction(async () => {
        const trade = (await db.prepare('SELECT * FROM spot_trades WHERE id = ?').get(req.params.id)) as any;
        if (!trade || trade.user_id !== userId) throw new Error('Position not found');
        if (trade.status !== 'OPEN') throw new Error('Position is already settled');

        const pair = (await db.prepare('SELECT * FROM market_pairs WHERE symbol = ?').get(trade.symbol)) as MarketPairRow;
        const { takerRate } = getSpotFeeRates();
        const pnl = calculatePositionPnl(trade, pair.current_price);
        const isLiq = pnl <= -(trade.amount_usd * 0.99) ? 1 : 0;
        const closeFeeUsd = isLiq ? 0 : Number((trade.amount_usd * takerRate).toFixed(2));
        const totalFeeUsd = Number((Number(trade.fee_usd || 0) + closeFeeUsd).toFixed(2));
        const payout = isLiq ? 0 : Math.max(0, Number((trade.amount_usd + pnl - closeFeeUsd).toFixed(2)));
        const realizedPnl = isLiq
          ? Number((-trade.amount_usd).toFixed(2))
          : Number((payout - trade.amount_usd).toFixed(2));

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const nextMain = Number((user.main_balance + payout).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

        const now = new Date().toISOString();
        await db.prepare(`
          UPDATE spot_trades SET exit_price = ?, fee_usd = ?, is_liquidated = ?, pnl_usd = ?, status = 'SETTLED', settled_at = ? WHERE id = ?
        `).run(pair.current_price, totalFeeUsd, isLiq, realizedPnl, now, trade.id);

        await appendLedger(
          userId,
          'MAIN',
          isLiq ? 'SPOT_LIQUIDATION' : 'SPOT_PNL',
          payout,
          nextMain,
          trade.id,
          isLiq
            ? `Liquidated ${trade.side} ${trade.symbol} @ $${pair.current_price} (Collateral forfeited: $${Number(trade.amount_usd).toFixed(2)})`
            : `Closed ${trade.side} ${trade.symbol} (P&L: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)} · Close fee: $${closeFeeUsd.toFixed(2)})`
        );

        return await db.prepare('SELECT * FROM spot_trades WHERE id = ?').get(trade.id);
      })();

      const snap = await getUserSpotSnapshot(userId);
      res.json({ trade: settled, ...snap });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to close position' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 5. CRYPTO INVESTMENTS (STAKING)
  // ---------------------------------------------------------------------------

  const ONE_DAY_MS = 86400000;
  const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

  function computePositionProfitSnapshot(pos: any, nowMs: number = Date.now()) {
    const monthsPaid = Number(pos.months_paid || 0);
    const durationMonths = Number(pos.duration_months || 0);
    const totalTermDays = Math.max(0, durationMonths * 30);
    const remainingMonths = Math.max(0, durationMonths - monthsPaid);
    const principal = Number(pos.principal_amount || 0);
    const monthlyProfitExact = (principal * (Number(pos.annual_roi_pct) / 100)) / 12;
    const monthlyProfit = Number(monthlyProfitExact.toFixed(2));
    const dailyProfitExact = monthlyProfitExact / 30;
    const dailyProfit = Number(dailyProfitExact.toFixed(4));
    const accruedDays = Math.min(totalTermDays, Math.max(Number(pos.accrued_days || 0), monthsPaid * 30));
    const totalLifetimeEarned = Number(((accruedDays / 30) * monthlyProfitExact).toFixed(2));
    const totalProfitPaid = Number(pos.total_profit_paid || 0);
    const accruedProfit =
      pos.status === 'ACTIVE'
        ? Math.max(0, Number((totalLifetimeEarned - totalProfitPaid).toFixed(2)))
        : 0;

    const nextPayoutMs = Date.parse(pos.next_payout_at);
    const claimableMonths =
      pos.status === 'ACTIVE' && remainingMonths > 0 && Number.isFinite(nextPayoutMs) && nowMs >= nextPayoutMs
        ? Math.min(remainingMonths, 1 + Math.floor((nowMs - nextPayoutMs) / THIRTY_DAYS_MS))
        : 0;
    const rawClaimableProfit = Number((monthlyProfitExact * claimableMonths).toFixed(2));
    const claimableProfit = claimableMonths > 0 ? rawClaimableProfit : 0;
    const lockedDailyProfit =
      pos.status === 'ACTIVE'
        ? Math.max(0, Number((accruedProfit - claimableProfit).toFixed(2)))
        : 0;
    const daysUntilNextPayout =
      pos.status === 'ACTIVE' && Number.isFinite(nextPayoutMs) && nowMs < nextPayoutMs
        ? Math.max(1, Math.ceil((nextPayoutMs - nowMs) / ONE_DAY_MS))
        : 0;
    const cycleDay =
      pos.status !== 'ACTIVE'
        ? 0
        : claimableMonths > 0
        ? 30
        : Math.min(29, Math.max(0, accruedDays - monthsPaid * 30));

    return {
      monthsPaid,
      durationMonths,
      totalTermDays,
      remainingMonths,
      principal,
      monthlyProfitExact,
      monthlyProfit,
      dailyProfitExact,
      dailyProfit,
      accruedDays,
      accruedProfit,
      claimableMonths,
      claimableProfit,
      lockedDailyProfit,
      daysUntilNextPayout,
      cycleDay,
    };
  }

  function enrichStakingPosition(pos: any, penaltyRate: number = STAKING_EMERGENCY_PENALTY_RATE) {
    const snap = computePositionProfitSnapshot(pos);
    const effectivePenaltyRate =
      typeof penaltyRate === 'number' && Number.isFinite(penaltyRate) && penaltyRate >= 0
        ? penaltyRate
        : STAKING_EMERGENCY_PENALTY_RATE;
    const emergencyPenaltyAmount = Number((snap.principal * effectivePenaltyRate).toFixed(2));
    const emergencyNetPrincipal = Number((snap.principal - emergencyPenaltyAmount).toFixed(2));

    return {
      ...pos,
      months_paid: snap.monthsPaid,
      monthly_profit: snap.monthlyProfit,
      daily_profit: snap.dailyProfit,
      accrued_days: snap.accruedDays,
      accrued_profit: snap.accruedProfit,
      locked_daily_profit: snap.lockedDailyProfit,
      claimable_months: snap.claimableMonths,
      claimable_profit: snap.claimableProfit,
      can_claim: snap.claimableMonths > 0,
      days_until_next_payout: snap.daysUntilNextPayout,
      cycle_day: snap.cycleDay,
      emergency_penalty_rate: effectivePenaltyRate,
      emergency_penalty_amount: emergencyPenaltyAmount,
      emergency_net_principal: emergencyNetPrincipal,
    };
  }

  async function recomputeUserProfitBalance(userId: string) {
    const agg = (await db
      .prepare("SELECT COALESCE(SUM(accrued_profit), 0) as total_profit FROM staking_positions WHERE user_id = ? AND status = 'ACTIVE'")
      .get(userId)) as { total_profit?: number } | undefined;
    const nextProfitBalance = Number(Number(agg?.total_profit || 0).toFixed(2));
    await db.prepare('UPDATE users SET profit_balance = ? WHERE id = ?').run(nextProfitBalance, userId);
    return nextProfitBalance;
  }

  async function syncStakingDailyProfits(targetUserId?: string) {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const notificationsToSend: { userId: string; pkg: string; amount: number; unlocked?: boolean; cycleDay?: number; roiPct?: number }[] = [];

    await db.transaction(async () => {
      const activePositions = targetUserId
        ? ((await db
            .prepare("SELECT * FROM staking_positions WHERE user_id = ? AND status = 'ACTIVE'")
            .all(targetUserId)) as any[])
        : ((await db
            .prepare("SELECT * FROM staking_positions WHERE status = 'ACTIVE'")
            .all()) as any[]);

      const touchedUserIds = new Set<string>();
      if (targetUserId) touchedUserIds.add(targetUserId);

      for (const pos of activePositions) {
        const durationMonths = Number(pos.duration_months || 0);
        const totalTermDays = Math.max(0, durationMonths * 30);
        const monthsPaid = Number(pos.months_paid || 0);
        const currentAccruedDays = Math.min(totalTermDays, Math.max(Number(pos.accrued_days || 0), monthsPaid * 30));
        const createdMs = Date.parse(pos.created_at) || nowMs;
        const baseNextDailyMs = pos.next_daily_accrual_at
          ? Date.parse(pos.next_daily_accrual_at)
          : createdMs + (currentAccruedDays + 1) * ONE_DAY_MS;
        const monthlyProfitExact = (Number(pos.principal_amount || 0) * (Number(pos.annual_roi_pct) / 100)) / 12;

        let newAccruedDays = currentAccruedDays;
        let nextDailyIso = Number.isFinite(baseNextDailyMs)
          ? new Date(baseNextDailyMs).toISOString()
          : new Date(nowMs + ONE_DAY_MS).toISOString();
        let daysToAdd = 0;

        if (Number.isFinite(baseNextDailyMs) && nowMs >= baseNextDailyMs && currentAccruedDays < totalTermDays) {
          daysToAdd = Math.min(
            totalTermDays - currentAccruedDays,
            1 + Math.floor((nowMs - baseNextDailyMs) / ONE_DAY_MS)
          );
          if (daysToAdd > 0) {
            newAccruedDays = currentAccruedDays + daysToAdd;
            nextDailyIso = new Date(baseNextDailyMs + daysToAdd * ONE_DAY_MS).toISOString();
            let batchCredited = 0;

            for (let step = 1; step <= daysToAdd; step++) {
              const dayNum = currentAccruedDays + step;
              const prevEarned = Number((((dayNum - 1) / 30) * monthlyProfitExact).toFixed(2));
              const nextEarned = Number(((dayNum / 30) * monthlyProfitExact).toFixed(2));
              const delta = Number((nextEarned - prevEarned).toFixed(2));
              const accruedForPosition = Math.max(0, Number((nextEarned - Number(pos.total_profit_paid || 0)).toFixed(2)));
              const creditedAt = new Date(baseNextDailyMs + (step - 1) * ONE_DAY_MS).toISOString();

              if (delta > 0) {
                batchCredited = Number((batchCredited + delta).toFixed(2));
                const existingLog = await db
                  .prepare('SELECT id FROM staking_daily_logs WHERE position_id = ? AND day_number = ?')
                  .get(pos.id, dayNum);
                if (!existingLog) {
                  await db.prepare(`
                    INSERT INTO staking_daily_logs (id, user_id, position_id, package_code, day_number, daily_amount, total_accrued, credited_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    generateId('SDL'),
                    pos.user_id,
                    pos.id,
                    pos.package_code,
                    dayNum,
                    delta,
                    accruedForPosition,
                    creditedAt
                  );
                }
              }
            }

            if (batchCredited > 0) {
              const cycleDayNow = newAccruedDays % 30 === 0 ? 30 : newAccruedDays % 30;
              notificationsToSend.push({
                userId: pos.user_id,
                pkg: pos.package_code,
                amount: batchCredited,
                unlocked: false,
                cycleDay: cycleDayNow,
                roiPct: Number(pos.annual_roi_pct),
              });
            }

            if (Math.floor(newAccruedDays / 30) > Math.floor(currentAccruedDays / 30)) {
              notificationsToSend.push({
                userId: pos.user_id,
                pkg: pos.package_code,
                amount: Number(monthlyProfitExact.toFixed(2)),
                unlocked: true,
              });
            }
          }
        }

        const totalLifetimeEarned = Number(((newAccruedDays / 30) * monthlyProfitExact).toFixed(2));
        const newAccruedProfit = Math.max(0, Number((totalLifetimeEarned - Number(pos.total_profit_paid || 0)).toFixed(2)));

        if (
          daysToAdd > 0 ||
          !pos.next_daily_accrual_at ||
          newAccruedDays !== Number(pos.accrued_days || 0) ||
          Math.abs(newAccruedProfit - Number(pos.accrued_profit || 0)) >= 0.01
        ) {
          await db.prepare(`
            UPDATE staking_positions
            SET accrued_days = ?, accrued_profit = ?, next_daily_accrual_at = ?
            WHERE id = ?
          `).run(newAccruedDays, newAccruedProfit, nextDailyIso, pos.id);
          touchedUserIds.add(pos.user_id);
        } else {
          touchedUserIds.add(pos.user_id);
        }
      }

      for (const uid of touchedUserIds) {
        await recomputeUserProfitBalance(uid);
      }
    })();

    for (const item of notificationsToSend) {
      if (item.unlocked) {
        await createUserNotification({
          userId: item.userId,
          category: 'STAKING',
          title: `Monthly Staking Profit Unlocked (${item.pkg})`,
          message: `+$${item.amount.toFixed(2)} USDT from your daily Profit Balance completed its 30-day cycle and is now unlocked to withdraw.`,
          linkTab: 'staking',
        }).catch(() => {});
      } else {
        await createUserNotification({
          userId: item.userId,
          category: 'STAKING',
          title: `Daily Staking Profit Added (${item.pkg})`,
          message: `+$${item.amount.toFixed(2)} USDT added to Profit Balance (${item.roiPct}% APR · Cycle Day ${item.cycleDay}/30). Unlocks for withdrawal on Day 30.`,
          linkTab: 'staking',
        }).catch(() => {});
      }
    }
    void nowIso;
  }

  app.get('/api/staking/positions', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    await syncStakingDailyProfits(userId);
    const settings = await getPlatformSettings();
    const rows = (await db
      .prepare('SELECT * FROM staking_positions WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId)) as any[];
    const enriched = rows.map((r) => enrichStakingPosition(r, settings.stakingEmergencyPenaltyRate));
    const dailyLogs = (await db
      .prepare('SELECT * FROM staking_daily_logs WHERE user_id = ? ORDER BY credited_at DESC, day_number DESC LIMIT 60')
      .all(userId)) as any[];

    const activeEnriched = enriched.filter((p) => p.status === 'ACTIVE');
    const totalProfitBalance = Number(
      activeEnriched.reduce((sum, p) => sum + Number(p.accrued_profit || 0), 0).toFixed(2)
    );
    const unlockedWithdrawableProfit = Number(
      activeEnriched.reduce((sum, p) => sum + Number(p.claimable_profit || 0), 0).toFixed(2)
    );
    const lockedDailyProfit = Number(
      Math.max(0, totalProfitBalance - unlockedWithdrawableProfit).toFixed(2)
    );
    const dailyRateTotal = Number(
      activeEnriched.reduce((sum, p) => sum + Number(p.daily_profit || 0), 0).toFixed(4)
    );
    const monthlyRateTotal = Number(
      activeEnriched.reduce((sum, p) => sum + Number(p.monthly_profit || 0), 0).toFixed(2)
    );

    res.json({
      positions: enriched,
      dailyLogs,
      profitSummary: {
        totalProfitBalance,
        unlockedWithdrawableProfit,
        lockedDailyProfit,
        dailyRateTotal,
        monthlyRateTotal,
      },
      packages: STAKING_PACKAGES,
    });
  }));

  app.post('/api/staking/subscribe', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { package_code, amount } = req.body || {};
    const pkg = STAKING_PACKAGES[package_code];
    const amt = Number(amount);
    if (!pkg) {
      res.status(400).json({ error: 'Invalid staking package. Choose 6M, 12M, 24M, or 36M.' });
      return;
    }
    if (!Number.isFinite(amt) || amt < 50) {
      res.status(400).json({ error: 'Minimum staking subscription is $50.00' });
      return;
    }

    const userId = req.auth!.userId;
    const settings = await getPlatformSettings();
    try {
      const position = await db.transaction(async () => {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        if (user.main_balance < amt) throw new Error('Insufficient Main Balance');

        const nextMain = Number((user.main_balance - amt).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);

        const id = generateId('STK');
        const now = new Date();
        const nextDaily = new Date(now.getTime() + ONE_DAY_MS).toISOString();
        const nextPayout = new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();

        await db.prepare(`
          INSERT INTO staking_positions (id, user_id, package_code, duration_months, annual_roi_pct, principal_amount, total_profit_paid, months_paid, quarters_paid, total_quarters, monthly_draw_entries, next_payout_at, status, penalty_amount, accrued_days, accrued_profit, next_daily_accrual_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, 1, ?, 'ACTIVE', 0, 0, 0, ?, ?)
        `).run(id, userId, package_code, pkg.durationMonths, pkg.annualRoiPct, amt, pkg.totalQuarters, nextPayout, nextDaily, now.toISOString());

        await appendLedger(
          userId,
          'MAIN',
          'STAKING_LOCK',
          -amt,
          nextMain,
          id,
          `Subscribed to ${package_code} Staking Plan (${pkg.annualRoiPct}% APR · Daily profit → Monthly unlock)`
        );

        const created = await db.prepare('SELECT * FROM staking_positions WHERE id = ?').get(id);
        return enrichStakingPosition(created, settings.stakingEmergencyPenaltyRate);
      })();

      const dailyEst = ((amt * (pkg.annualRoiPct / 100)) / 360);
      const monthlyEst = ((amt * (pkg.annualRoiPct / 100)) / 12);
      createUserNotification({
        userId,
        category: 'STAKING',
        title: `Staking Vault Activated (${package_code})`,
        message: `$${amt.toFixed(2)} USDT staked at ${pkg.annualRoiPct}% APR (+$${dailyEst < 0.1 ? dailyEst.toFixed(3) : dailyEst.toFixed(2)}/day to Profit Balance · +$${monthlyEst.toFixed(2)} unlocks every 30 days).`,
        linkTab: 'staking',
      }).catch(() => {});

      res.status(201).json({ position });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Staking subscription failed' });
    }
  }));

  app.post('/api/staking/positions/:id/claim-profit', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const rawDest = String(req.body?.destination || 'MAIN').toUpperCase();
    const targetWallet: 'MAIN' | 'CLAIMABLE' = rawDest === 'CLAIMABLE' ? 'CLAIMABLE' : 'MAIN';
    const settings = await getPlatformSettings();

    await syncStakingDailyProfits(userId);

    try {
      const result = await db.transaction(async () => {
        const pos = (await db.prepare('SELECT * FROM staking_positions WHERE id = ?').get(req.params.id)) as any;
        if (!pos || pos.user_id !== userId) {
          throw new Error('Staking position not found');
        }
        if (pos.status !== 'ACTIVE') {
          throw new Error('This staking position is no longer active');
        }

        const monthsPaid = Number(pos.months_paid || 0);
        const durationMonths = Number(pos.duration_months);
        const remainingMonths = Math.max(0, durationMonths - monthsPaid);
        if (remainingMonths <= 0) {
          throw new Error('All monthly profits for this vault have already been claimed');
        }

        const nextPayoutMs = Date.parse(pos.next_payout_at);
        const nowMs = Date.now();
        if (!Number.isFinite(nextPayoutMs) || nowMs < nextPayoutMs) {
          const daysLeft = Number.isFinite(nextPayoutMs) ? Math.max(1, Math.ceil((nextPayoutMs - nowMs) / ONE_DAY_MS)) : 30;
          const lockedAccrued = Number(pos.accrued_profit || 0);
          throw new Error(
            `Daily Profit Balance ($${lockedAccrued.toFixed(2)}) is locked until the 30-day monthly cycle finishes (${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining).`
          );
        }

        const monthsDue = Math.min(remainingMonths, 1 + Math.floor((nowMs - nextPayoutMs) / THIRTY_DAYS_MS));
        const monthlyProfitExact = (Number(pos.principal_amount) * (Number(pos.annual_roi_pct) / 100)) / 12;
        const profitPayout = Number((monthlyProfitExact * monthsDue).toFixed(2));
        const nextMonthsPaid = monthsPaid + monthsDue;
        const nextQuartersPaid = Math.min(Number(pos.total_quarters || 0), Math.floor(nextMonthsPaid / 3));
        const isCompleted = nextMonthsPaid >= durationMonths;

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        const principalReturned = isCompleted ? Number(pos.principal_amount) : 0;
        const totalCredited = Number((profitPayout + principalReturned).toFixed(2));

        let nextMainBalance = Number(user.main_balance || 0);
        let nextClaimableBalance = Number(user.claimable_balance || 0);

        if (targetWallet === 'MAIN') {
          nextMainBalance = Number((nextMainBalance + totalCredited).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMainBalance, userId);
        } else {
          if (principalReturned > 0) {
            nextMainBalance = Number((nextMainBalance + principalReturned).toFixed(2));
            await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMainBalance, userId);
          }
          nextClaimableBalance = Number((nextClaimableBalance + profitPayout).toFixed(2));
          await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimableBalance, userId);
        }

        const nextTotalProfitPaid = Number((Number(pos.total_profit_paid || 0) + profitPayout).toFixed(2));
        const nextAccruedDays = Math.min(durationMonths * 30, Math.max(Number(pos.accrued_days || 0), nextMonthsPaid * 30));
        const totalEarnedAfter = Number(((nextAccruedDays / 30) * monthlyProfitExact).toFixed(2));
        const remainingAccruedProfit = isCompleted
          ? 0
          : Math.max(0, Number((totalEarnedAfter - nextTotalProfitPaid).toFixed(2)));

        if (isCompleted) {
          await db.prepare(`
            UPDATE staking_positions
            SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = 0, status = 'COMPLETED'
            WHERE id = ?
          `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, pos.id);

          if (targetWallet === 'MAIN') {
            await appendLedger(
              userId,
              'MAIN',
              'STAKING_PAYOUT',
              totalCredited,
              nextMainBalance,
              pos.id,
              `Final Monthly Profit ($${profitPayout.toFixed(2)}) + Principal Release ($${principalReturned.toFixed(2)}) (${pos.package_code})`
            );
          } else {
            if (principalReturned > 0) {
              await appendLedger(
                userId,
                'MAIN',
                'STAKING_PAYOUT',
                principalReturned,
                nextMainBalance,
                pos.id,
                `Principal Release ($${principalReturned.toFixed(2)}) on Vault Maturity (${pos.package_code})`
              );
            }
            await appendLedger(
              userId,
              'CLAIMABLE',
              'STAKING_PAYOUT',
              profitPayout,
              nextClaimableBalance,
              pos.id,
              `Final Monthly Profit (${monthsDue} mo · $${profitPayout.toFixed(2)}) (${pos.package_code})`
            );
          }
        } else {
          const nextPayoutIso = new Date(nextPayoutMs + monthsDue * THIRTY_DAYS_MS).toISOString();
          await db.prepare(`
            UPDATE staking_positions
            SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = ?, next_payout_at = ?
            WHERE id = ?
          `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, remainingAccruedProfit, nextPayoutIso, pos.id);

          await appendLedger(
            userId,
            targetWallet,
            'STAKING_PAYOUT',
            profitPayout,
            targetWallet === 'MAIN' ? nextMainBalance : nextClaimableBalance,
            pos.id,
            `Monthly Staking Profit Withdrawal (${monthsDue} mo · ${pos.package_code} @ ${pos.annual_roi_pct}% APR)`
          );
        }

        await recomputeUserProfitBalance(userId);
        const updatedPos = await db.prepare('SELECT * FROM staking_positions WHERE id = ?').get(pos.id);
        const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        return {
          position: enrichStakingPosition(updatedPos, settings.stakingEmergencyPenaltyRate),
          creditedAmount: profitPayout,
          principalReturned,
          totalCredited,
          monthsClaimed: monthsDue,
          destination: targetWallet,
          user: await sanitizeUser(updatedUser),
        };
      })();

      createUserNotification({
        userId,
        category: 'STAKING',
        title: `Monthly Profit Withdrawn (${result.position.package_code})`,
        message: `+$${result.totalCredited.toFixed(2)} USDT (${result.monthsClaimed} mo profit${result.principalReturned > 0 ? ` + $${result.principalReturned.toFixed(2)} principal` : ''}) credited to your ${result.destination === 'CLAIMABLE' ? 'Claimable Wallet' : 'Main Balance'}.`,
        linkTab: 'staking',
      }).catch(() => {});

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Unable to claim monthly staking profit' });
    }
  }));

  app.post('/api/staking/claim-unlocked', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const rawDest = String(req.body?.destination || 'MAIN').toUpperCase();
    const targetWallet: 'MAIN' | 'CLAIMABLE' = rawDest === 'CLAIMABLE' ? 'CLAIMABLE' : 'MAIN';

    await syncStakingDailyProfits(userId);

    try {
      const result = await db.transaction(async () => {
        const activePositions = (await db
          .prepare("SELECT * FROM staking_positions WHERE user_id = ? AND status = 'ACTIVE'")
          .all(userId)) as any[];
        const nowMs = Date.now();

        let totalProfitCredited = 0;
        let totalPrincipalReturned = 0;
        let vaultsProcessed = 0;

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        let runningMain = Number(user.main_balance || 0);
        let runningClaimable = Number(user.claimable_balance || 0);

        for (const pos of activePositions) {
          const monthsPaid = Number(pos.months_paid || 0);
          const durationMonths = Number(pos.duration_months || 0);
          const remainingMonths = Math.max(0, durationMonths - monthsPaid);
          const nextPayoutMs = Date.parse(pos.next_payout_at);
          if (remainingMonths <= 0 || !Number.isFinite(nextPayoutMs) || nowMs < nextPayoutMs) continue;

          const monthsDue = Math.min(remainingMonths, 1 + Math.floor((nowMs - nextPayoutMs) / THIRTY_DAYS_MS));
          const monthlyProfitExact = (Number(pos.principal_amount) * (Number(pos.annual_roi_pct) / 100)) / 12;
          const profitPayout = Number((monthlyProfitExact * monthsDue).toFixed(2));
          const nextMonthsPaid = monthsPaid + monthsDue;
          const nextQuartersPaid = Math.min(Number(pos.total_quarters || 0), Math.floor(nextMonthsPaid / 3));
          const isCompleted = nextMonthsPaid >= durationMonths;
          const principalReturned = isCompleted ? Number(pos.principal_amount) : 0;

          if (targetWallet === 'MAIN') {
            const totalForVault = Number((profitPayout + principalReturned).toFixed(2));
            runningMain = Number((runningMain + totalForVault).toFixed(2));
            await appendLedger(
              userId,
              'MAIN',
              'STAKING_PAYOUT',
              totalForVault,
              runningMain,
              pos.id,
              isCompleted
                ? `Final Monthly Profit ($${profitPayout.toFixed(2)}) + Principal Release ($${principalReturned.toFixed(2)}) (${pos.package_code})`
                : `Monthly Staking Profit Withdrawal (${monthsDue} mo · ${pos.package_code} @ ${pos.annual_roi_pct}% APR)`
            );
          } else {
            if (principalReturned > 0) {
              runningMain = Number((runningMain + principalReturned).toFixed(2));
              await appendLedger(
                userId,
                'MAIN',
                'STAKING_PAYOUT',
                principalReturned,
                runningMain,
                pos.id,
                `Principal Release ($${principalReturned.toFixed(2)}) on Vault Maturity (${pos.package_code})`
              );
            }
            runningClaimable = Number((runningClaimable + profitPayout).toFixed(2));
            await appendLedger(
              userId,
              'CLAIMABLE',
              'STAKING_PAYOUT',
              profitPayout,
              runningClaimable,
              pos.id,
              `Monthly Staking Profit Withdrawal (${monthsDue} mo · ${pos.package_code} @ ${pos.annual_roi_pct}% APR)`
            );
          }

          totalProfitCredited = Number((totalProfitCredited + profitPayout).toFixed(2));
          totalPrincipalReturned = Number((totalPrincipalReturned + principalReturned).toFixed(2));
          vaultsProcessed++;

          const nextTotalProfitPaid = Number((Number(pos.total_profit_paid || 0) + profitPayout).toFixed(2));
          const nextAccruedDays = Math.min(durationMonths * 30, Math.max(Number(pos.accrued_days || 0), nextMonthsPaid * 30));
          const totalEarnedAfter = Number(((nextAccruedDays / 30) * monthlyProfitExact).toFixed(2));
          const remainingAccruedProfit = isCompleted
            ? 0
            : Math.max(0, Number((totalEarnedAfter - nextTotalProfitPaid).toFixed(2)));

          if (isCompleted) {
            await db.prepare(`
              UPDATE staking_positions
              SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = 0, status = 'COMPLETED'
              WHERE id = ?
            `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, pos.id);
          } else {
            const nextPayoutIso = new Date(nextPayoutMs + monthsDue * THIRTY_DAYS_MS).toISOString();
            await db.prepare(`
              UPDATE staking_positions
              SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = ?, next_payout_at = ?
              WHERE id = ?
            `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, remainingAccruedProfit, nextPayoutIso, pos.id);
          }
        }

        if (vaultsProcessed === 0) {
          throw new Error('No unlocked monthly profit ready yet. Daily profits unlock after each 30-day cycle.');
        }

        await db.prepare('UPDATE users SET main_balance = ?, claimable_balance = ? WHERE id = ?').run(runningMain, runningClaimable, userId);

        const nextProfitBalance = await recomputeUserProfitBalance(userId);
        const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        return {
          vaultsProcessed,
          creditedAmount: totalProfitCredited,
          principalReturned: totalPrincipalReturned,
          totalCredited: Number((totalProfitCredited + totalPrincipalReturned).toFixed(2)),
          destination: targetWallet,
          profitBalanceRemaining: nextProfitBalance,
          user: await sanitizeUser(updatedUser),
        };
      })();

      createUserNotification({
        userId,
        category: 'STAKING',
        title: `Unlocked Staking Profits Withdrawn`,
        message: `+$${result.totalCredited.toFixed(2)} USDT from ${result.vaultsProcessed} vault(s) credited to your ${result.destination === 'CLAIMABLE' ? 'Claimable Wallet' : 'Main Balance'}.`,
        linkTab: 'staking',
      }).catch(() => {});

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Unable to withdraw unlocked monthly profit' });
    }
  }));

  app.post('/api/staking/positions/:id/emergency-payout', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const settings = await getPlatformSettings();
    await syncStakingDailyProfits(userId);
    try {
      const result = await db.transaction(async () => {
        const pos = (await db.prepare('SELECT * FROM staking_positions WHERE id = ?').get(req.params.id)) as any;
        if (!pos || pos.user_id !== userId) {
          throw new Error('Staking position not found');
        }
        if (pos.status !== 'ACTIVE') {
          throw new Error('Only active staking vaults are eligible for emergency payout');
        }

        const principal = Number(pos.principal_amount || 0);
        const penaltyRate =
          typeof settings.stakingEmergencyPenaltyRate === 'number' &&
          Number.isFinite(settings.stakingEmergencyPenaltyRate) &&
          settings.stakingEmergencyPenaltyRate >= 0
            ? settings.stakingEmergencyPenaltyRate
            : STAKING_EMERGENCY_PENALTY_RATE;
        const penaltyAmount = Number((principal * penaltyRate).toFixed(2));
        const netPrincipalReturned = Number((principal - penaltyAmount).toFixed(2));

        // Settle any already-unlocked full monthly profit cycles cleanly
        const monthsPaid = Number(pos.months_paid || 0);
        const durationMonths = Number(pos.duration_months || 0);
        const remainingMonths = Math.max(0, durationMonths - monthsPaid);
        const nextPayoutMs = Date.parse(pos.next_payout_at);
        const nowMs = Date.now();
        const unlockedMonths =
          remainingMonths > 0 && Number.isFinite(nextPayoutMs) && nowMs >= nextPayoutMs
            ? Math.min(remainingMonths, 1 + Math.floor((nowMs - nextPayoutMs) / THIRTY_DAYS_MS))
            : 0;
        const monthlyProfit = (principal * (Number(pos.annual_roi_pct) / 100)) / 12;
        const unlockedProfit = Number((monthlyProfit * unlockedMonths).toFixed(2));

        const totalPayout = Number((netPrincipalReturned + unlockedProfit).toFixed(2));
        const nowIso = new Date().toISOString();

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        let runningMain = Number((Number(user.main_balance || 0) + netPrincipalReturned).toFixed(2));

        const nextMonthsPaid = monthsPaid + unlockedMonths;
        const nextQuartersPaid = Math.min(Number(pos.total_quarters || 0), Math.floor(nextMonthsPaid / 3));

        await db.prepare(`
          UPDATE staking_positions
          SET status = 'EMERGENCY_WITHDRAWN',
              penalty_amount = ?,
              emergency_payout_at = ?,
              total_profit_paid = total_profit_paid + ?,
              months_paid = ?,
              quarters_paid = ?,
              accrued_profit = 0
          WHERE id = ?
        `).run(penaltyAmount, nowIso, unlockedProfit, nextMonthsPaid, nextQuartersPaid, pos.id);

        await appendLedger(
          userId,
          'MAIN',
          'STAKING_EMERGENCY_PAYOUT',
          netPrincipalReturned,
          runningMain,
          pos.id,
          `Emergency Staking Payout (${pos.package_code} · Principal $${principal.toFixed(2)} - ${(penaltyRate * 100).toFixed(2)}% penalty $${penaltyAmount.toFixed(2)})`
        );

        if (unlockedProfit > 0) {
          runningMain = Number((runningMain + unlockedProfit).toFixed(2));
          await appendLedger(
            userId,
            'MAIN',
            'STAKING_PAYOUT',
            unlockedProfit,
            runningMain,
            pos.id,
            `Unlocked Monthly Profit (${unlockedMonths} mo) settled on Emergency Exit (${pos.package_code})`
          );
        }

        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(runningMain, userId);
        await recomputeUserProfitBalance(userId);

        const updatedPos = await db.prepare('SELECT * FROM staking_positions WHERE id = ?').get(pos.id);
        const updatedUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        return {
          position: enrichStakingPosition(updatedPos, penaltyRate),
          penaltyRate,
          penaltyAmount,
          netPrincipalReturned,
          unlockedMonths,
          unlockedProfitPaid: unlockedProfit,
          totalPayout,
          user: await sanitizeUser(updatedUser),
        };
      })();

      createUserNotification({
        userId,
        category: 'STAKING',
        title: `Emergency Vault Exit (${result.position.package_code})`,
        message: `+$${result.totalPayout.toFixed(2)} USDT credited to Main Balance ($${result.netPrincipalReturned.toFixed(2)} net principal after $${result.penaltyAmount.toFixed(2)} fee${result.unlockedProfitPaid > 0 ? ` + $${result.unlockedProfitPaid.toFixed(2)} unlocked profit` : ''}).`,
        linkTab: 'staking',
      }).catch(() => {});

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Unable to process emergency payout' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 6. COIN PRESALE (IPO LOT SYSTEM)
  // ---------------------------------------------------------------------------

  app.get('/api/presale/rounds', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const rounds = await db.prepare('SELECT * FROM presale_rounds ORDER BY created_at DESC').all();
    const rawTickets = (await db
      .prepare(`
        SELECT t.*, r.token_symbol, r.token_name, r.lot_price, r.tokens_per_lot, r.projected_win_payout, r.winning_number
        FROM presale_tickets t
        JOIN presale_rounds r ON t.round_id = r.id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC
      `)
      .all(req.auth!.userId)) as any[];
    const tickets = rawTickets.map((t) => ({
      ...t,
      ticket_numbers: parseTicketNumbers(t.ticket_numbers),
    }));
    res.json({ rounds, tickets });
  }));

  app.post('/api/presale/buy', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const { round_id, lots_count } = req.body || {};
    const lots = Math.floor(Number(lots_count));
    if (!round_id || !Number.isFinite(lots) || lots < 1 || lots > 100000) {
      res.status(400).json({ error: 'Select between 1 and 100,000 presale lots' });
      return;
    }

    const userId = req.auth!.userId;
    try {
      const createdTickets = await db.transaction(async () => {
        const round = (await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(round_id)) as any;
        if (!round || round.status !== 'OPEN') {
          throw new Error('Presale round is not open');
        }
        if (round.sold_lots + lots > round.total_lots) {
          throw new Error(`Only ${round.total_lots - round.sold_lots} lots remaining`);
        }

        const lotSize = Math.max(1, Number(round.tokens_per_lot || round.lot_size || 1));
        const oneLotPrincipal = Number((lotSize * round.lot_price).toFixed(2));
        const principalPaid = Number((oneLotPrincipal * lots).toFixed(2));
        const settings = await getPlatformSettings();
        const rawFee =
          round.network_fee !== null && round.network_fee !== undefined
            ? Number(round.network_fee)
            : settings.presaleNetworkFeeUsd;
        const feePerLot = Number((Number.isFinite(rawFee) ? rawFee : 0.10).toFixed(2));
        const feePaid = Number((lots * feePerLot).toFixed(2));
        const totalCost = Number((principalPaid + feePaid).toFixed(2));

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        if (user.main_balance < totalCost) {
          throw new Error(`Insufficient Main Balance (requires $${totalCost.toFixed(2)} including $${feePaid.toFixed(2)} network fee)`);
        }

        const nextMain = Number((user.main_balance - totalCost).toFixed(2));
        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);
        await db.prepare('UPDATE presale_rounds SET sold_lots = sold_lots + ? WHERE id = ?').run(lots, round.id);

        const now = new Date().toISOString();

        // Generate unique 6-digit lottery numbers (1 per lot) for this round
        const existingRoundTickets = (await db
          .prepare('SELECT ticket_numbers FROM presale_tickets WHERE round_id = ?')
          .all(round.id)) as { ticket_numbers?: string | null }[];
        const usedNumbers = new Set<string>();
        for (const row of existingRoundTickets) {
          for (const num of parseTicketNumbers(row.ticket_numbers)) {
            usedNumbers.add(num);
          }
        }

        const insertTicketStmt = db.prepare(`
          INSERT INTO presale_tickets (id, round_id, user_id, lots_count, ticket_numbers, principal_paid, fee_paid, result, payout_amount, created_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, 'PENDING', 0, ?)
        `);

        const createdList: any[] = [];
        const lotNumbers: string[] = [];
        for (let i = 0; i < lots; i++) {
          let candidate = '';
          for (let attempt = 0; attempt < 80; attempt++) {
            const rand = String(crypto.randomInt(100000, 1000000));
            if (!usedNumbers.has(rand)) {
              candidate = rand;
              break;
            }
          }
          if (!candidate) {
            candidate = String(crypto.randomInt(100000, 1000000));
          }
          usedNumbers.add(candidate);
          lotNumbers.push(candidate);

          const ticketId = generateId('TKT');
          const singleNums = [candidate];
          await insertTicketStmt.run(
            ticketId,
            round.id,
            userId,
            JSON.stringify(singleNums),
            oneLotPrincipal,
            feePerLot,
            now
          );
          createdList.push({
            id: ticketId,
            round_id: round.id,
            user_id: userId,
            lots_count: 1,
            ticket_numbers: singleNums,
            principal_paid: oneLotPrincipal,
            fee_paid: feePerLot,
            result: 'PENDING',
            payout_amount: 0,
            created_at: now,
          });
        }

        await appendLedger(
          userId,
          'MAIN',
          'PRESALE_BUY',
          -totalCost,
          nextMain,
          createdList[0].id,
          `Purchased ${lots} lot(s) of ${round.token_symbol} (${createdList.length} tickets, $${principalPaid.toFixed(2)} + $${feePaid.toFixed(2)} fee) [${lotNumbers.join(', ')}]`
        );

        return createdList;
      })();

      res.status(201).json({ ticket: createdTickets[0], tickets: createdTickets });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Presale purchase failed' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 7. REWARDS & REFERRAL PROGRAM
  // ---------------------------------------------------------------------------

  app.get('/api/rewards/overview', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const overview = await buildUserReferralOverview(userId);
    const draws = await db.prepare('SELECT * FROM lucky_draws ORDER BY created_at DESC').all();

    const activityRow = (await db
      .prepare("SELECT COUNT(*) as cnt FROM wallets_ledger WHERE user_id = ? AND tx_type IN ('SPOT_BUY', 'STAKING_LOCK', 'PRESALE_BUY', 'DEPOSIT')")
      .get(userId)) as { cnt: number };
    const activityCount = Number(activityRow?.cnt || 0);

    res.json({
      ...overview,
      draws,
      isEligibleForLuckyDraw: activityCount > 0,
      activityCount,
    });
  }));

  app.post('/api/rewards/milestones/claim', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { tier_code } = req.body || {};
    const tier = REFERRAL_MILESTONE_TIERS.find((t) => t.tierCode === String(tier_code || '').toUpperCase());
    if (!tier) {
      res.status(400).json({ error: 'Invalid referral milestone tier.' });
      return;
    }

    try {
      const claimResult = await db.transaction(async () => {
        const overview = await buildUserReferralOverview(userId);
        if (!overview.referralStats.incomeActive) {
          throw new Error(
            `Referral income activates after ${REFERRAL_REQUIRED_VERIFIED_SIGNUPS} verified user signups (${overview.referralStats.verifiedSignupsCount}/${REFERRAL_REQUIRED_VERIFIED_SIGNUPS}).`
          );
        }
        if (overview.referralStats.balanceQualifiedCount < tier.targetCount) {
          throw new Error(
            `Requires ${tier.targetCount} qualified referrals ($500.00+ balance) to claim ${tier.title} bonus.`
          );
        }

        const existing = await db
          .prepare('SELECT id FROM referral_milestone_claims WHERE user_id = ? AND tier_code = ?')
          .get(userId, tier.tierCode);
        if (existing) {
          throw new Error(`${tier.title} milestone bonus has already been claimed.`);
        }

        const userRow = (await db.prepare('SELECT id, claimable_balance FROM users WHERE id = ?').get(userId)) as any;
        if (!userRow) throw new Error('User account not found.');

        const now = new Date().toISOString();
        const claimId = generateId('MLST');
        const nextClaimable = Number((Number(userRow.claimable_balance || 0) + tier.bonusUsd).toFixed(2));

        await db.prepare(`
          INSERT INTO referral_milestone_claims (id, user_id, tier_code, target_count, bonus_amount, claimed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(claimId, userId, tier.tierCode, tier.targetCount, tier.bonusUsd, now);

        await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, userId);

        await appendLedger(
          userId,
          'CLAIMABLE',
          'REFERRAL_MILESTONE',
          tier.bonusUsd,
          nextClaimable,
          claimId,
          `${tier.title} Milestone Bonus (${tier.targetCount} qualified referrals)`
        );

        return {
          claimId,
          bonusUsd: tier.bonusUsd,
          claimableBalance: nextClaimable,
        };
      })();

      const refreshedOverview = await buildUserReferralOverview(userId);
      res.json({
        ...claimResult,
        ...refreshedOverview,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Unable to claim milestone bonus.' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 7B. QUARTERLY JACKPOT (3-MONTH DRAW)
  // ---------------------------------------------------------------------------

  function getNextQuarterLabel(currentLabel: string): string {
    const m = /^Q([1-4])\s+(\d{4})$/i.exec(String(currentLabel || '').trim());
    if (!m) {
      const now = new Date();
      const nextDate = new Date(now.getFullYear(), now.getMonth() + 3, 1);
      const q = Math.floor(nextDate.getMonth() / 3) + 1;
      return `Q${q} ${nextDate.getFullYear()}`;
    }
    const q = Number(m[1]);
    const y = Number(m[2]);
    return q === 4 ? `Q1 ${y + 1}` : `Q${q + 1} ${y}`;
  }

  function addThreeMonthsIso(baseDate?: Date): string {
    const d = baseDate ? new Date(baseDate.getTime()) : new Date();
    d.setMonth(d.getMonth() + 3);
    return d.toISOString();
  }

  function maskParticipantName(fullName?: string | null, uid?: string | null): string {
    const clean = String(fullName || '').trim();
    if (!clean) return uid ? `Trader •••${String(uid).slice(-4)}` : 'Anonymous Trader';
    const first = clean.split(/\s+/)[0] || clean;
    if (first.length <= 2) return `${first[0] || 'U'}***`;
    return `${first.slice(0, 2)}${'*'.repeat(Math.min(4, Math.max(2, first.length - 2)))}${first.slice(-1)}`;
  }

  function parseTicketNumbers(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v).trim()).filter(Boolean);
        }
      } catch {
        return raw
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);
      }
    }
    return [];
  }

  async function generateUniqueJackpotNumbers(drawId: string, count: number): Promise<string[]> {
    const existingRows = (await db
      .prepare('SELECT ticket_numbers FROM jackpot_tickets WHERE draw_id = ?')
      .all(drawId)) as { ticket_numbers: string | null }[];
    const usedSet = new Set<string>();
    for (const row of existingRows) {
      for (const num of parseTicketNumbers(row.ticket_numbers)) {
        usedSet.add(num);
      }
    }
    const generated: string[] = [];
    for (let i = 0; i < count; i++) {
      let candidate = '';
      for (let attempt = 0; attempt < 60; attempt++) {
        const rand = String(crypto.randomInt(100000, 1000000));
        if (!usedSet.has(rand)) {
          candidate = rand;
          break;
        }
      }
      if (!candidate) {
        candidate = String(crypto.randomInt(1000000, 10000000));
      }
      usedSet.add(candidate);
      generated.push(candidate);
    }
    return generated;
  }

  function computeDrawProofHash(params: {
    drawId: string;
    winnerId?: string | null;
    winningTicketId?: string | null;
    winningTicketNumber?: string | null;
    prizePool: number;
    drawAt: string;
    poolSize?: number;
  }): string {
    const payload = `${params.drawId}|${params.winnerId || 'NONE'}|${params.winningTicketId || 'BONUS_ENTRY'}|${params.winningTicketNumber || 'AUTO'}|${Number(params.prizePool || 0).toFixed(2)}|${params.drawAt}|${params.poolSize ?? 0}`;
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async function executeQuarterlyJackpotDraw(requestedWinningTicketNumber?: string | null): Promise<{
    drawId: string;
    quarterLabel: string;
    winnerEmail: string;
    winnerName: string;
    prizePool: number;
    winningTicketId: string | null;
    winningTicketNumber: string | null;
    drawHash: string;
    nextDrawId: string;
    nextQuarterLabel: string;
    nextDrawAt: string;
  }> {
    const cleanTargetNumber = requestedWinningTicketNumber
      ? String(requestedWinningTicketNumber).trim().replace(/^#/, '')
      : '';

    const result = await db.transaction(async () => {
      const openDraw = (await db.prepare("SELECT * FROM lucky_draws WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1").get()) as any;
      if (!openDraw) throw new Error('No open quarterly jackpot round available');

      const activeTickets = (await db
        .prepare("SELECT * FROM jackpot_tickets WHERE draw_id = ? AND status = 'ACTIVE'")
        .all(openDraw.id)) as any[];

      const activeUsers = (await db
        .prepare("SELECT * FROM users WHERE role = 'USER' AND COALESCE(status, 'ACTIVE') = 'ACTIVE'")
        .all()) as any[];

      if (activeUsers.length === 0 && activeTickets.length === 0) {
        throw new Error('No eligible active users or ticket holders');
      }

      const userMap = new Map<string, any>();
      for (const u of activeUsers) userMap.set(u.id, u);

      let winner: any = null;
      let winningTicketId: string | null = null;
      let winningTicketNumber: string | null = null;
      let totalPoolEntries = 0;

      if (cleanTargetNumber) {
        if (!/^[A-Za-z0-9-]{4,24}$/.test(cleanTargetNumber)) {
          throw new Error('Invalid winning ticket number format');
        }
        const matchedRow = activeTickets.find((t) => parseTicketNumbers(t.ticket_numbers).includes(cleanTargetNumber));
        if (!matchedRow) {
          throw new Error(`Ticket number #${cleanTargetNumber} was not found among active tickets in ${openDraw.quarter_label}`);
        }
        winner = userMap.get(matchedRow.user_id) || (await db.prepare('SELECT * FROM users WHERE id = ?').get(matchedRow.user_id));
        if (!winner) {
          throw new Error('Ticket owner account not found');
        }
        winningTicketId = matchedRow.id;
        winningTicketNumber = cleanTargetNumber;
        totalPoolEntries = activeTickets.reduce((acc, t) => acc + Math.max(1, Number(t.ticket_count || 1)), 0);
      } else {
        // Build weighted entry pool strictly from purchased tickets (1 ticket = 1 draw entry)
        const entryPool: { userId: string; ticketId: string | null; ticketNumber: string | null }[] = [];
        for (const t of activeTickets) {
          if (!userMap.has(t.user_id)) continue;
          const nums = parseTicketNumbers(t.ticket_numbers);
          const count = Math.max(1, Number(t.ticket_count || 1));
          for (let i = 0; i < count; i++) {
            entryPool.push({ userId: t.user_id, ticketId: t.id, ticketNumber: nums[i] || nums[0] || null });
          }
        }

        if (entryPool.length === 0) {
          for (const u of activeUsers) {
            entryPool.push({ userId: u.id, ticketId: null, ticketNumber: null });
          }
        }

        totalPoolEntries = entryPool.length;
        const picked = entryPool[crypto.randomInt(0, entryPool.length)];
        winner = userMap.get(picked.userId) || activeUsers[0];
        winningTicketId = picked.ticketId;
        winningTicketNumber = picked.ticketNumber;
      }

      const now = new Date().toISOString();
      const prizePool = Number(openDraw.prize_pool || 0);
      const nextClaimable = Number((Number(winner.claimable_balance || 0) + prizePool).toFixed(2));

      const drawHash = computeDrawProofHash({
        drawId: openDraw.id,
        winnerId: winner.id,
        winningTicketId,
        winningTicketNumber,
        prizePool,
        drawAt: now,
        poolSize: totalPoolEntries,
      });

      await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, winner.id);
      await db.prepare(`
        UPDATE lucky_draws
        SET winner_user_id = ?, winner_email = ?, winner_name = ?, winning_ticket_number = ?, status = 'COMPLETED', draw_at = ?, draw_hash = ?
        WHERE id = ?
      `).run(winner.id, winner.email, winner.full_name, winningTicketNumber, now, drawHash, openDraw.id);

      if (winningTicketId) {
        await db
          .prepare("UPDATE jackpot_tickets SET status = 'WON', prize_won = ?, winning_ticket_number = ? WHERE id = ?")
          .run(prizePool, winningTicketNumber, winningTicketId);
        await db
          .prepare("UPDATE jackpot_tickets SET status = 'LOST', prize_won = 0, winning_ticket_number = NULL WHERE draw_id = ? AND id != ?")
          .run(openDraw.id, winningTicketId);
      } else {
        await db
          .prepare("UPDATE jackpot_tickets SET status = 'LOST', prize_won = 0, winning_ticket_number = NULL WHERE draw_id = ?")
          .run(openDraw.id);
      }

      await appendLedger(
        winner.id,
        'CLAIMABLE',
        'LUCKY_DRAW',
        prizePool,
        nextClaimable,
        openDraw.id,
        `Quarterly Jackpot (${openDraw.quarter_label})${winningTicketNumber ? ` · Winning Ticket #${winningTicketNumber}` : ''} Grand Prize Credited`
      );

      // Automatically open next 3-month cycle
      const nextQuarterLabel = getNextQuarterLabel(openDraw.quarter_label);
      const nextDrawAt = addThreeMonthsIso();
      const nextId = generateId('DRW');
      const nextTicketPrice = Number(openDraw.ticket_price || 1.0);
      const nextBasePool = 2500.0;

      await db.prepare(`
        INSERT INTO lucky_draws (id, quarter_label, title, prize_pool, ticket_price, status, draw_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
      `).run(
        nextId,
        nextQuarterLabel,
        `${nextQuarterLabel} Quarterly Jackpot`,
        nextBasePool,
        nextTicketPrice,
        nextDrawAt,
        now
      );

      return {
        drawId: openDraw.id,
        quarterLabel: openDraw.quarter_label,
        winnerUserId: winner.id,
        winnerEmail: winner.email,
        winnerName: winner.full_name,
        prizePool,
        winningTicketId,
        winningTicketNumber,
        drawHash,
        nextDrawId: nextId,
        nextQuarterLabel,
        nextDrawAt,
      };
    })();

    await createUserNotification({
      userId: result.winnerUserId,
      category: 'REWARDS',
      title: `Jackpot Winner · ${result.quarterLabel}${result.winningTicketNumber ? ` (#${result.winningTicketNumber})` : ''}`,
      message: `Congratulations!${result.winningTicketNumber ? ` Ticket #${result.winningTicketNumber} won and ` : ' '}$${result.prizePool.toFixed(2)} USDT has been credited to your Claimable Wallet.`,
      linkTab: 'jackpot',
    });

    return {
      drawId: result.drawId,
      quarterLabel: result.quarterLabel,
      winnerEmail: result.winnerEmail,
      winnerName: result.winnerName,
      prizePool: result.prizePool,
      winningTicketId: result.winningTicketId,
      winningTicketNumber: result.winningTicketNumber,
      drawHash: result.drawHash,
      nextDrawId: result.nextDrawId,
      nextQuarterLabel: result.nextQuarterLabel,
      nextDrawAt: result.nextDrawAt,
    };
  }

  async function processOverdueJackpotDraws(): Promise<void> {
    try {
      const openDraw = (await db.prepare("SELECT id, draw_at FROM lucky_draws WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1").get()) as
        | { id: string; draw_at: string }
        | undefined;
      if (openDraw && Date.parse(openDraw.draw_at) <= Date.now()) {
        await executeQuarterlyJackpotDraw();
      }
    } catch {
      // ignore if no eligible users yet
    }
  }

  app.get('/api/jackpot/overview', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    await processOverdueJackpotDraws();
    const userId = req.auth!.userId;

    const drawsWithStats = (await db
      .prepare(`
        SELECT d.*,
          COALESCE((SELECT SUM(t.ticket_count) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as tickets_sold,
          COALESCE((SELECT SUM(t.cost_usd) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as ticket_revenue_usd,
          COALESCE((SELECT COUNT(DISTINCT t.user_id) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as unique_participants
        FROM lucky_draws d
        ORDER BY d.created_at DESC
      `)
      .all()) as any[];

    const normalizedDraws = drawsWithStats.map((d) => ({
      ...d,
      draw_hash:
        d.draw_hash ||
        (d.status === 'COMPLETED'
          ? computeDrawProofHash({
              drawId: d.id,
              winnerId: d.winner_user_id,
              winningTicketNumber: d.winning_ticket_number,
              prizePool: Number(d.prize_pool || 0),
              drawAt: d.draw_at,
              poolSize: Number(d.tickets_sold || 0),
            })
          : null),
    }));

    const activeDraw = normalizedDraws.find((d) => d.status === 'OPEN') || null;
    const history = normalizedDraws.filter((d) => d.status === 'COMPLETED').map((d) => ({
      ...d,
      winner_name: d.winner_user_id === userId ? d.winner_name : maskParticipantName(d.winner_name),
      winner_email:
        d.winner_user_id === userId
          ? d.winner_email
          : d.winner_email
          ? `${String(d.winner_email).slice(0, 2)}***@${String(d.winner_email).split('@')[1] || 'nepefy'}`
          : null,
    }));

    const rawMyTickets = (await db
      .prepare(`
        SELECT t.*, d.quarter_label
        FROM jackpot_tickets t
        JOIN lucky_draws d ON t.draw_id = d.id
        WHERE t.user_id = ?
        ORDER BY t.created_at DESC
      `)
      .all(userId)) as any[];

    const myTickets = rawMyTickets.map((t) => ({
      ...t,
      ticket_numbers: parseTicketNumbers(t.ticket_numbers),
    }));

    const myActiveTicketCount = activeDraw
      ? myTickets
          .filter((t) => t.draw_id === activeDraw.id && t.status === 'ACTIVE')
          .reduce((acc, t) => acc + Number(t.ticket_count || 0), 0)
      : 0;

    const totalActiveTickets = Number(activeDraw?.tickets_sold || 0);
    const totalActiveEntries = totalActiveTickets;
    const myWinChancePct = totalActiveTickets > 0 ? Number(((myActiveTicketCount / totalActiveTickets) * 100).toFixed(2)) : 0;

    const rawRecentParticipants = activeDraw
      ? ((await db
          .prepare(`
            SELECT t.id, t.user_id, u.full_name as user_name, u.uid as uid, t.ticket_count, t.ticket_numbers, t.cost_usd, t.created_at
            FROM jackpot_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE t.draw_id = ?
            ORDER BY t.created_at DESC
            LIMIT 25
          `)
          .all(activeDraw.id)) as any[])
      : [];

    const recentParticipants = rawRecentParticipants.map((p) => ({
      id: p.id,
      user_name: p.user_id === userId ? `${p.user_name} (You)` : maskParticipantName(p.user_name, p.uid),
      uid: p.uid || null,
      is_me: p.user_id === userId,
      ticket_count: Number(p.ticket_count || 0),
      ticket_numbers: parseTicketNumbers(p.ticket_numbers),
      cost_usd: Number(p.cost_usd || 0),
      created_at: p.created_at,
    }));

    const rawLeaderboard = activeDraw
      ? ((await db
          .prepare(`
            SELECT t.user_id, u.full_name as user_name, u.uid as uid,
                   SUM(t.ticket_count) as ticket_count,
                   SUM(t.cost_usd) as cost_usd
            FROM jackpot_tickets t
            JOIN users u ON t.user_id = u.id
            WHERE t.draw_id = ? AND t.status = 'ACTIVE'
            GROUP BY t.user_id, u.full_name, u.uid
            ORDER BY ticket_count DESC, cost_usd DESC
            LIMIT 15
          `)
          .all(activeDraw.id)) as any[])
      : [];

    const leaderboard = rawLeaderboard.map((row, idx) => {
      const tCount = Number(row.ticket_count || 0);
      const entrySharePct = totalActiveTickets > 0 ? Number(((tCount / totalActiveTickets) * 100).toFixed(2)) : 0;
      const isMe = row.user_id === userId;
      return {
        rank: idx + 1,
        user_name: isMe ? `${row.user_name} (You)` : maskParticipantName(row.user_name, row.uid),
        uid: row.uid || null,
        is_me: isMe,
        ticket_count: tCount,
        cost_usd: Number(Number(row.cost_usd || 0).toFixed(2)),
        has_bonus_entry: false,
        total_entries: tCount,
        entry_share_pct: entrySharePct,
      };
    });

    const activeTicketRevenue = Number(activeDraw?.ticket_revenue_usd || 0);
    const ticketContributionUsd = Number((activeTicketRevenue * 0.8).toFixed(2));
    const treasuryFeeUsd = Number((activeTicketRevenue * 0.2).toFixed(2));
    const basePoolUsd = Number(Math.max(0, Number(activeDraw?.prize_pool || 0) - ticketContributionUsd).toFixed(2));
    const totalPrizesWonAllTime = history.reduce((acc, d) => acc + Number(d.prize_pool || 0), 0);

    res.json({
      activeDraw,
      history,
      myTickets,
      myActiveTicketCount,
      totalActiveTickets,
      totalActiveEntries,
      uniqueParticipantsCount: Number(activeDraw?.unique_participants || 0),
      qualifiedBonusCount: 0,
      basePoolUsd,
      ticketContributionUsd,
      treasuryFeeUsd,
      isEligibleBonusEntry: false,
      myWinChancePct,
      recentParticipants,
      leaderboard,
      totalPrizesWonAllTime: Number(totalPrizesWonAllTime.toFixed(2)),
    });
  }));

  app.post('/api/jackpot/buy', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const count = Math.floor(Number(req.body?.ticket_count || 0));
    if (!Number.isFinite(count) || count < 1 || count > 100) {
      res.status(400).json({ error: 'Ticket count must be between 1 and 100 per purchase' });
      return;
    }

    try {
      const result = await db.transaction(async () => {
        const activeDraw = (await db
          .prepare("SELECT * FROM lucky_draws WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1")
          .get()) as any;
        if (!activeDraw) throw new Error('No active quarterly jackpot round is open right now');

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) as any;
        if (!user) throw new Error('Account not found');
        if ((user.status || 'ACTIVE') !== 'ACTIVE') throw new Error('Account is suspended');

        const ticketPrice = Number(activeDraw.ticket_price || 1.0);
        const totalCost = Number((count * ticketPrice).toFixed(2));
        if (user.main_balance < totalCost) {
          throw new Error(`Insufficient Main Balance. Required: $${totalCost.toFixed(2)} USDT`);
        }

        const generatedNumbers = await generateUniqueJackpotNumbers(activeDraw.id, count);
        const nextMain = Number((user.main_balance - totalCost).toFixed(2));
        const poolAddition = Number((totalCost * 0.8).toFixed(2));
        const nextPool = Number((Number(activeDraw.prize_pool || 0) + poolAddition).toFixed(2));
        const now = new Date().toISOString();
        const ticketId = generateId('JKT');

        await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, userId);
        await db.prepare('UPDATE lucky_draws SET prize_pool = ? WHERE id = ?').run(nextPool, activeDraw.id);
        await db.prepare(`
          INSERT INTO jackpot_tickets (id, draw_id, user_id, ticket_count, ticket_numbers, cost_usd, status, prize_won, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?)
        `).run(ticketId, activeDraw.id, userId, count, JSON.stringify(generatedNumbers), totalCost, now);

        await appendLedger(
          userId,
          'MAIN',
          'JACKPOT_BUY',
          -totalCost,
          nextMain,
          ticketId,
          `Purchased ${count} Jackpot ticket(s) (${generatedNumbers.map((n) => `#${n}`).join(', ')}) for ${activeDraw.quarter_label}`
        );

        const createdTicket = (await db.prepare('SELECT * FROM jackpot_tickets WHERE id = ?').get(ticketId)) as any;
        return {
          ticket: {
            ...createdTicket,
            ticket_numbers: generatedNumbers,
          },
          generated_numbers: generatedNumbers,
          draw: await db.prepare('SELECT * FROM lucky_draws WHERE id = ?').get(activeDraw.id),
          main_balance: nextMain,
        };
      })();

      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Jackpot ticket purchase failed' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 8. MASTER ADMIN CONSOLE ROUTES
  // ---------------------------------------------------------------------------

  app.get('/api/admin/overview', requireAdmin, ah(async (_req, res) => {
    await syncStakingDailyProfits();
    const users = await db
      .prepare('SELECT id, uid, email, full_name, role, status, kyc_status, main_balance, claimable_balance, locked_balance, profit_balance, referral_code, referred_by, first_deposit_rewarded, created_at FROM users ORDER BY created_at DESC')
      .all();

    const deposits = await db
      .prepare(`
        SELECT d.*, u.full_name as user_name, u.email as user_email
        FROM deposit_requests d
        JOIN users u ON d.user_id = u.id
        ORDER BY CASE WHEN d.status = 'PENDING' THEN 0 ELSE 1 END, d.created_at DESC
      `)
      .all();

    const withdrawals = await db
      .prepare(`
        SELECT w.*, u.full_name as user_name, u.email as user_email
        FROM withdraw_requests w
        JOIN users u ON w.user_id = u.id
        ORDER BY CASE WHEN w.status = 'PENDING' THEN 0 ELSE 1 END, w.created_at DESC
      `)
      .all();

    const p2pOffers = await db
      .prepare(`
        SELECT o.*, u.full_name as creator_name, u.email as creator_email
        FROM p2p_offers o
        JOIN users u ON o.creator_id = u.id
        ORDER BY CASE WHEN o.status = 'ACTIVE' THEN 0 ELSE 1 END, o.created_at DESC
      `)
      .all();

    const p2pOrders = await db
      .prepare(`
        SELECT ord.*, b.full_name as buyer_name, b.email as buyer_email, s.full_name as seller_name, s.email as seller_email
        FROM p2p_orders ord
        JOIN users b ON ord.buyer_id = b.id
        JOIN users s ON ord.seller_id = s.id
        ORDER BY CASE WHEN ord.status = 'DISPUTED' THEN 0 ELSE 1 END, ord.created_at DESC
      `)
      .all();

    const trades = await db
      .prepare(`
        SELECT t.*, u.full_name as user_name, u.email as user_email
        FROM spot_trades t
        JOIN users u ON t.user_id = u.id
        ORDER BY CASE WHEN t.status = 'OPEN' THEN 0 ELSE 1 END, t.created_at DESC
        LIMIT 250
      `)
      .all();

    const rawStaking = (await db
      .prepare(`
        SELECT s.*, u.full_name as user_name, u.email as user_email
        FROM staking_positions s
        JOIN users u ON s.user_id = u.id
        ORDER BY s.created_at DESC
      `)
      .all()) as any[];
    const platformSettings = await getPlatformSettings();
    const staking = rawStaking.map((s) => ({
      ...enrichStakingPosition(s, platformSettings.stakingEmergencyPenaltyRate),
      user_name: s.user_name,
      user_email: s.user_email,
    }));

    const presaleRounds = await db.prepare('SELECT * FROM presale_rounds ORDER BY created_at DESC').all();
    const rawPresaleTickets = (await db
      .prepare(`
        SELECT t.*, r.token_symbol, r.tokens_per_lot, r.projected_win_payout, r.winning_number, u.full_name as user_name, u.email as user_email
        FROM presale_tickets t
        JOIN presale_rounds r ON t.round_id = r.id
        JOIN users u ON t.user_id = u.id
        ORDER BY CASE WHEN t.result = 'PENDING' THEN 0 ELSE 1 END, t.created_at DESC
      `)
      .all()) as any[];
    const presaleTickets = rawPresaleTickets.map((t) => ({
      ...t,
      ticket_numbers: parseTicketNumbers(t.ticket_numbers),
    }));

    const rawLuckyDraws = (await db
      .prepare(`
        SELECT d.*,
          COALESCE((SELECT SUM(t.ticket_count) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as tickets_sold,
          COALESCE((SELECT SUM(t.cost_usd) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as ticket_revenue_usd,
          COALESCE((SELECT COUNT(DISTINCT t.user_id) FROM jackpot_tickets t WHERE t.draw_id = d.id), 0) as unique_participants
        FROM lucky_draws d
        ORDER BY d.created_at DESC
      `)
      .all()) as any[];

    const luckyDraws = rawLuckyDraws.map((d) => ({
      ...d,
      draw_hash:
        d.draw_hash ||
        (d.status === 'COMPLETED'
          ? computeDrawProofHash({
              drawId: d.id,
              winnerId: d.winner_user_id,
              winningTicketNumber: d.winning_ticket_number,
              prizePool: Number(d.prize_pool || 0),
              drawAt: d.draw_at,
              poolSize: Number(d.tickets_sold || 0),
            })
          : null),
    }));

    const rawJackpotTickets = (await db
      .prepare(`
        SELECT t.*, d.quarter_label, u.full_name as user_name, u.email as user_email
        FROM jackpot_tickets t
        JOIN lucky_draws d ON t.draw_id = d.id
        JOIN users u ON t.user_id = u.id
        ORDER BY CASE WHEN t.status = 'ACTIVE' THEN 0 ELSE 1 END, t.created_at DESC
      `)
      .all()) as any[];

    const jackpotTickets = rawJackpotTickets.map((t) => ({
      ...t,
      ticket_numbers: parseTicketNumbers(t.ticket_numbers),
    }));

    const referrals = await db
      .prepare(`
        SELECT r.*,
               ref.full_name as referrer_name,
               ref.email as referrer_email,
               u.full_name as referred_name,
               u.email as referred_email
        FROM referrals r
        JOIN users ref ON r.referrer_id = ref.id
        JOIN users u ON r.referred_user_id = u.id
        ORDER BY CASE WHEN r.status = 'PENDING_DEPOSIT' THEN 0 ELSE 1 END, r.created_at DESC
      `)
      .all();

    const transactions = await db
      .prepare(`
        SELECT l.*, u.full_name as user_name, u.email as user_email
        FROM wallets_ledger l
        JOIN users u ON l.user_id = u.id
        ORDER BY l.created_at DESC
        LIMIT 300
      `)
      .all();

    const spotAgg = (await db
      .prepare(`
        SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(CASE WHEN status != 'CANCELLED' THEN amount_usd ELSE 0 END), 0) as total_volume_usd,
          COALESCE(SUM(CASE WHEN fee_role = 'TAKER' AND status != 'CANCELLED' THEN fee_usd ELSE 0 END), 0) as taker_fee_usd,
          COALESCE(SUM(CASE WHEN fee_role = 'TAKER' AND status != 'CANCELLED' THEN 1 ELSE 0 END), 0) as taker_orders_count,
          COALESCE(SUM(CASE WHEN fee_role = 'MAKER' AND status = 'SETTLED' THEN fee_usd ELSE 0 END), 0) as maker_fee_usd,
          COALESCE(SUM(CASE WHEN fee_role = 'MAKER' AND status = 'SETTLED' THEN 1 ELSE 0 END), 0) as maker_orders_count,
          COALESCE(SUM(CASE WHEN is_liquidated = 1 THEN amount_usd ELSE 0 END), 0) as liquidation_usd,
          COALESCE(SUM(CASE WHEN is_liquidated = 1 THEN 1 ELSE 0 END), 0) as liquidation_count,
          COALESCE(SUM(CASE WHEN status = 'SETTLED' AND order_mode = 'POSITION' AND is_liquidated = 0 THEN pnl_usd ELSE 0 END), 0) as settled_position_trader_pnl,
          COALESCE(SUM(CASE WHEN status = 'SETTLED' AND order_mode = 'POSITION' AND is_liquidated = 0 THEN 1 ELSE 0 END), 0) as settled_position_count,
          COALESCE(SUM(CASE WHEN status = 'SETTLED' AND order_mode IN ('SPOT', 'LIMIT') THEN 1 ELSE 0 END), 0) as settled_spot_count,
          COALESCE(SUM(CASE WHEN status = 'OPEN' THEN amount_usd ELSE 0 END), 0) as open_exposure_usd,
          COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) as open_count
        FROM spot_trades
      `)
      .get()) as any;

    const presaleAgg = (await db
      .prepare(`
        SELECT
          COUNT(*) as total_tickets,
          COALESCE(SUM(lots_count), 0) as total_lots,
          COALESCE(SUM(principal_paid), 0) as total_principal_usd,
          COALESCE(SUM(fee_paid), 0) as network_fees_usd,
          COALESCE(SUM(CASE WHEN result = 'PENDING' THEN principal_paid ELSE 0 END), 0) as pending_principal_usd,
          COALESCE(SUM(CASE WHEN result = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count,
          COALESCE(SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END), 0) as win_count,
          COALESCE(SUM(CASE WHEN result = 'WIN' THEN payout_amount ELSE 0 END), 0) as win_payouts_usd,
          COALESCE(SUM(CASE WHEN result = 'WIN' THEN payout_amount - principal_paid ELSE 0 END), 0) as win_bonus_cost_usd,
          COALESCE(SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END), 0) as loss_count,
          COALESCE(SUM(CASE WHEN result = 'LOSS' THEN payout_amount ELSE 0 END), 0) as loss_refunds_usd
        FROM presale_tickets
      `)
      .get()) as any;

    const stakingAgg = (await db
      .prepare(`
        SELECT
          COUNT(*) as total_positions,
          COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as active_count,
          COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN principal_amount ELSE 0 END), 0) as active_principal_usd,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed_count,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN principal_amount ELSE 0 END), 0) as completed_principal_usd,
          COALESCE(SUM(CASE WHEN status = 'EMERGENCY_WITHDRAWN' THEN 1 ELSE 0 END), 0) as emergency_count,
          COALESCE(SUM(CASE WHEN status = 'EMERGENCY_WITHDRAWN' THEN principal_amount ELSE 0 END), 0) as emergency_principal_usd,
          COALESCE(SUM(CASE WHEN status = 'EMERGENCY_WITHDRAWN' THEN penalty_amount ELSE 0 END), 0) as emergency_penalties_usd,
          COALESCE(SUM(total_profit_paid), 0) as total_roi_paid_usd
        FROM staking_positions
      `)
      .get()) as any;

    const monthlyStakingDrawAgg = (await db
      .prepare("SELECT COALESCE(SUM(amount), 0) as draw_bonus_paid FROM wallets_ledger WHERE tx_type = 'STAKING_PAYOUT' AND description LIKE 'Monthly Staking Draw%'")
      .get()) as { draw_bonus_paid: number };

    const referralAgg = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'CREDITED_CLAIMABLE' THEN 1 ELSE 0 END), 0) as credited_count,
          COALESCE(SUM(CASE WHEN status = 'CREDITED_CLAIMABLE' THEN bonus_amount ELSE 0 END), 0) as credited_usd,
          COALESCE(SUM(CASE WHEN status = 'PENDING_DEPOSIT' THEN 1 ELSE 0 END), 0) as pending_count,
          COALESCE(SUM(CASE WHEN status = 'PENDING_DEPOSIT' THEN bonus_amount ELSE 0 END), 0) as pending_usd
        FROM referrals
      `)
      .get()) as any;

    const milestoneAgg = (await db
      .prepare(`
        SELECT
          COUNT(*) as claimed_count,
          COALESCE(SUM(bonus_amount), 0) as claimed_usd
        FROM referral_milestone_claims
      `)
      .get()) as any;

    const luckyDrawAgg = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed_count,
          COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN prize_pool ELSE 0 END), 0) as completed_prizes_usd,
          COALESCE(SUM(CASE WHEN status = 'OPEN' THEN prize_pool ELSE 0 END), 0) as open_pool_usd
        FROM lucky_draws
      `)
      .get()) as any;

    const depositAgg = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END), 0) as approved_count,
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount ELSE 0 END), 0) as approved_usd,
          COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count,
          COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) as pending_usd,
          COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) as rejected_count
        FROM deposit_requests
      `)
      .get()) as any;

    const withdrawAgg = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END), 0) as approved_count,
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN amount ELSE 0 END), 0) as approved_usd,
          COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN fee_usd ELSE 0 END), 0) as approved_fees_usd,
          COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pending_count,
          COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END), 0) as pending_usd,
          COALESCE(SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END), 0) as rejected_count
        FROM withdraw_requests
      `)
      .get()) as any;

    const p2pAgg = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('COMPLETED', 'RESOLVED_BUYER', 'RESOLVED_SELLER') THEN 1 ELSE 0 END), 0) as settled_count,
          COALESCE(SUM(CASE WHEN status IN ('COMPLETED', 'RESOLVED_BUYER', 'RESOLVED_SELLER') THEN amount_vusd ELSE 0 END), 0) as settled_vusd,
          COALESCE(SUM(CASE WHEN status IN ('COMPLETED', 'RESOLVED_BUYER') THEN fee_usd ELSE 0 END), 0) as p2p_fees_usd,
          COALESCE(SUM(CASE WHEN status IN ('ESCROW_LOCKED', 'PAID') THEN 1 ELSE 0 END), 0) as escrow_count,
          COALESCE(SUM(CASE WHEN status IN ('ESCROW_LOCKED', 'PAID') THEN amount_vusd ELSE 0 END), 0) as escrow_vusd,
          COALESCE(SUM(CASE WHEN status = 'DISPUTED' THEN 1 ELSE 0 END), 0) as disputed_count
        FROM p2p_orders
      `)
      .get()) as any;

    const sendFeeAgg = (await db
      .prepare("SELECT COALESCE(SUM(ABS(amount)), 0) as send_fees_usd FROM wallets_ledger WHERE tx_type = 'SEND_FEE'")
      .get()) as { send_fees_usd: number };

    const userLiabilities = (await db
      .prepare(`
        SELECT
          COALESCE(SUM(main_balance), 0) as main_usd,
          COALESCE(SUM(claimable_balance), 0) as claimable_usd,
          COALESCE(SUM(locked_balance), 0) as locked_usd,
          COALESCE(SUM(profit_balance), 0) as profit_usd
        FROM users
        WHERE role = 'USER'
      `)
      .get()) as any;

    const spotPlatformNetPnl = Number(
      (
        spotAgg.taker_fee_usd +
        spotAgg.maker_fee_usd +
        spotAgg.liquidation_usd -
        spotAgg.settled_position_trader_pnl
      ).toFixed(2)
    );
    const presalePlatformNetPnl = Number((presaleAgg.network_fees_usd - presaleAgg.win_bonus_cost_usd).toFixed(2));
    const emergencyPenaltiesUsd = Number(stakingAgg.emergency_penalties_usd || 0);
    const totalStakingCostUsd = Number((stakingAgg.total_roi_paid_usd + monthlyStakingDrawAgg.draw_bonus_paid).toFixed(2));
    const stakingPlatformNetPnl = Number((emergencyPenaltiesUsd - totalStakingCostUsd).toFixed(2));
    const milestoneBonusPaidUsd = Number(milestoneAgg.claimed_usd || 0);
    const totalRewardsCostUsd = Number(
      (referralAgg.credited_usd + milestoneBonusPaidUsd + luckyDrawAgg.completed_prizes_usd).toFixed(2)
    );
    const rewardsPlatformNetPnl = Number((-totalRewardsCostUsd).toFixed(2));

    const withdrawFeesUsd = Number(withdrawAgg.approved_fees_usd || 0);
    const p2pFeesUsd = Number(p2pAgg.p2p_fees_usd || 0);
    const sendFeesUsd = Number(sendFeeAgg.send_fees_usd || 0);

    const grossRevenueUsd = Number(
      (
        spotAgg.taker_fee_usd +
        spotAgg.maker_fee_usd +
        spotAgg.liquidation_usd +
        presaleAgg.network_fees_usd +
        withdrawFeesUsd +
        p2pFeesUsd +
        sendFeesUsd +
        emergencyPenaltiesUsd +
        Math.max(0, -spotAgg.settled_position_trader_pnl)
      ).toFixed(2)
    );
    const grossExpensesUsd = Number(
      (
        Math.max(0, spotAgg.settled_position_trader_pnl) +
        presaleAgg.win_bonus_cost_usd +
        totalStakingCostUsd +
        totalRewardsCostUsd
      ).toFixed(2)
    );
    const netProjectPnlUsd = Number((grossRevenueUsd - grossExpensesUsd).toFixed(2));

    const projectSummary = {
      spot: {
        totalOrders: Number(spotAgg.total_orders || 0),
        totalVolumeUsd: Number(spotAgg.total_volume_usd || 0),
        takerFeeUsd: Number(spotAgg.taker_fee_usd || 0),
        takerOrdersCount: Number(spotAgg.taker_orders_count || 0),
        makerFeeUsd: Number(spotAgg.maker_fee_usd || 0),
        makerOrdersCount: Number(spotAgg.maker_orders_count || 0),
        totalFeeUsd: Number((Number(spotAgg.taker_fee_usd || 0) + Number(spotAgg.maker_fee_usd || 0)).toFixed(2)),
        liquidationUsd: Number(spotAgg.liquidation_usd || 0),
        liquidationCount: Number(spotAgg.liquidation_count || 0),
        settledPositionTraderPnl: Number(spotAgg.settled_position_trader_pnl || 0),
        settledPositionCount: Number(spotAgg.settled_position_count || 0),
        settledSpotCount: Number(spotAgg.settled_spot_count || 0),
        openExposureUsd: Number(spotAgg.open_exposure_usd || 0),
        openCount: Number(spotAgg.open_count || 0),
        platformNetPnl: spotPlatformNetPnl,
      },
      presale: {
        totalTickets: Number(presaleAgg.total_tickets || 0),
        totalLots: Number(presaleAgg.total_lots || 0),
        totalPrincipalUsd: Number(presaleAgg.total_principal_usd || 0),
        networkFeesUsd: Number(presaleAgg.network_fees_usd || 0),
        pendingPrincipalUsd: Number(presaleAgg.pending_principal_usd || 0),
        pendingCount: Number(presaleAgg.pending_count || 0),
        winCount: Number(presaleAgg.win_count || 0),
        winPayoutsUsd: Number(presaleAgg.win_payouts_usd || 0),
        winBonusCostUsd: Number(presaleAgg.win_bonus_cost_usd || 0),
        lossCount: Number(presaleAgg.loss_count || 0),
        lossRefundsUsd: Number(presaleAgg.loss_refunds_usd || 0),
        platformNetPnl: presalePlatformNetPnl,
      },
      staking: {
        totalPositions: Number(stakingAgg.total_positions || 0),
        activeCount: Number(stakingAgg.active_count || 0),
        activePrincipalUsd: Number(stakingAgg.active_principal_usd || 0),
        completedCount: Number(stakingAgg.completed_count || 0),
        completedPrincipalUsd: Number(stakingAgg.completed_principal_usd || 0),
        emergencyCount: Number(stakingAgg.emergency_count || 0),
        emergencyPrincipalUsd: Number(stakingAgg.emergency_principal_usd || 0),
        emergencyPenaltiesUsd,
        roiPaidUsd: Number(stakingAgg.total_roi_paid_usd || 0),
        accruedProfitLiabilityUsd: Number(userLiabilities.profit_usd || 0),
        monthlyDrawPaidUsd: Number(monthlyStakingDrawAgg.draw_bonus_paid || 0),
        totalCostUsd: totalStakingCostUsd,
        platformNetPnl: stakingPlatformNetPnl,
      },
      rewards: {
        referralsCreditedCount: Number(referralAgg.credited_count || 0),
        referralsCreditedUsd: Number(referralAgg.credited_usd || 0),
        referralsPendingCount: Number(referralAgg.pending_count || 0),
        referralsPendingUsd: Number(referralAgg.pending_usd || 0),
        milestoneClaimsCount: Number(milestoneAgg.claimed_count || 0),
        milestoneBonusPaidUsd,
        luckyDrawsCompletedCount: Number(luckyDrawAgg.completed_count || 0),
        luckyDrawPrizesPaidUsd: Number(luckyDrawAgg.completed_prizes_usd || 0),
        luckyDrawOpenPoolUsd: Number(luckyDrawAgg.open_pool_usd || 0),
        platformNetPnl: rewardsPlatformNetPnl,
      },
      settlements: {
        depositsApprovedCount: Number(depositAgg.approved_count || 0),
        depositsApprovedUsd: Number(depositAgg.approved_usd || 0),
        depositsPendingCount: Number(depositAgg.pending_count || 0),
        depositsPendingUsd: Number(depositAgg.pending_usd || 0),
        withdrawalsApprovedCount: Number(withdrawAgg.approved_count || 0),
        withdrawalsApprovedUsd: Number(withdrawAgg.approved_usd || 0),
        withdrawalsPendingCount: Number(withdrawAgg.pending_count || 0),
        withdrawalsPendingUsd: Number(withdrawAgg.pending_usd || 0),
        netCashflowUsd: Number((Number(depositAgg.approved_usd || 0) - Number(withdrawAgg.approved_usd || 0)).toFixed(2)),
        p2pSettledCount: Number(p2pAgg.settled_count || 0),
        p2pSettledUsd: Number(p2pAgg.settled_vusd || 0),
        p2pEscrowCount: Number(p2pAgg.escrow_count || 0),
        p2pEscrowUsd: Number(p2pAgg.escrow_vusd || 0),
        p2pDisputedCount: Number(p2pAgg.disputed_count || 0),
        withdrawFeesUsd: Number(withdrawFeesUsd.toFixed(2)),
        p2pFeesUsd: Number(p2pFeesUsd.toFixed(2)),
        sendFeesUsd: Number(sendFeesUsd.toFixed(2)),
        userMainLiabilityUsd: Number(userLiabilities.main_usd || 0),
        userClaimableLiabilityUsd: Number(userLiabilities.claimable_usd || 0),
        userLockedLiabilityUsd: Number(userLiabilities.locked_usd || 0),
        userProfitLiabilityUsd: Number(userLiabilities.profit_usd || 0),
        userTotalLiabilityUsd: Number(
          (
            Number(userLiabilities.main_usd || 0) +
            Number(userLiabilities.claimable_usd || 0) +
            Number(userLiabilities.locked_usd || 0) +
            Number(userLiabilities.profit_usd || 0)
          ).toFixed(2)
        ),
      },
      totals: {
        grossRevenueUsd,
        grossExpensesUsd,
        netProjectPnlUsd,
      },
    };

    const supportUnreadRow = (await db
      .prepare('SELECT COALESCE(SUM(admin_unread), 0) as cnt FROM support_threads')
      .get()) as { cnt?: number } | undefined;

    const kycSubmissions = await db
      .prepare(`
        SELECT k.*, u.full_name as user_name, u.email as user_email, u.uid as user_uid
        FROM kyc_submissions k
        JOIN users u ON k.user_id = u.id
        ORDER BY CASE WHEN k.status = 'PENDING' THEN 0 ELSE 1 END, k.created_at DESC
      `)
      .all();

    const auditLogs = await db
      .prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 200')
      .all();

    res.json({
      users,
      deposits,
      withdrawals,
      p2pOffers,
      p2pOrders,
      markets: await getMarketSnapshot(),
      trades,
      staking,
      presaleRounds,
      presaleTickets,
      luckyDraws,
      jackpotTickets,
      referrals,
      transactions,
      kycSubmissions,
      auditLogs,
      platformSettings,
      projectSummary,
      supportUnreadCount: Number(supportUnreadRow?.cnt || 0),
    });
  }));

  app.get('/api/admin/audit-logs', requireAdmin, ah(async (_req, res) => {
    const logs = await db.prepare('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 300').all();
    res.json({ logs });
  }));

  app.get('/api/admin/settings', requireAdmin, ah(async (_req, res) => {
    res.json({ settings: await getPlatformSettings() });
  }));

  app.put('/api/admin/settings', requireAdmin, ah(async (req, res) => {
    const body = req.body || {};
    const updates: [string, string][] = [];

    if (body.binancePayId !== undefined) {
      const val = String(body.binancePayId).trim().slice(0, 80);
      if (val.length > 0 && val.length < 3) {
        res.status(400).json({ error: 'Binance Pay ID must be at least 3 characters.' });
        return;
      }
      updates.push(['binance_pay_id', val]);
    }
    if (body.bybitUid !== undefined) {
      const val = String(body.bybitUid).trim().slice(0, 80);
      if (val.length > 0 && val.length < 3) {
        res.status(400).json({ error: 'Bybit UID must be at least 3 characters.' });
        return;
      }
      updates.push(['bybit_uid', val]);
    }
    const numFields: [string, string, number, number][] = [
      ['minDepositUsd', 'min_deposit_usd', 1, 100000],
      ['maxDepositUsd', 'max_deposit_usd', 10, 10000000],
      ['minWithdrawUsd', 'min_withdraw_usd', 1, 100000],
      ['maxWithdrawUsd', 'max_withdraw_usd', 10, 10000000],
      ['withdrawFeeUsd', 'withdraw_fee_usd', 0, 500],
      ['p2pFeeUsd', 'p2p_fee_usd', 0, 100],
      ['sendFeeUsd', 'send_fee_usd', 0, 100],
      ['presaleNetworkFeeUsd', 'presale_network_fee_usd', 0, 100],
      ['spotMakerFeePct', 'spot_maker_fee_pct', 0, 5],
      ['spotTakerFeePct', 'spot_taker_fee_pct', 0, 5],
      ['stakingEmergencyPenaltyRate', 'staking_emergency_penalty_rate', 0, 0.25],
    ];
    for (const [prop, dbKey, minVal, maxVal] of numFields) {
      if (body[prop] !== undefined) {
        const parsed = Number(body[prop]);
        if (!Number.isFinite(parsed) || parsed < minVal || parsed > maxVal) {
          res.status(400).json({ error: `${prop} must be between ${minVal} and ${maxVal}.` });
          return;
        }
        updates.push([dbKey, String(parsed)]);
      }
    }
    if (body.maintenanceMode !== undefined) {
      updates.push(['maintenance_mode', body.maintenanceMode ? '1' : '0']);
    }
    if (body.maintenanceMessage !== undefined) {
      updates.push(['maintenance_message', String(body.maintenanceMessage).trim().slice(0, 280) || 'Scheduled maintenance in progress.']);
    }
    if (body.androidApkUrl !== undefined) {
      const rawUrl = String(body.androidApkUrl || '').trim();
      if (rawUrl) {
        const valid = resolveValidApkUrl(rawUrl);
        if (!valid) {
          res.status(400).json({ error: 'Android APK URL must be a valid http:// or https:// link.' });
          return;
        }
        updates.push(['android_apk_url', valid.slice(0, 500)]);
      } else {
        updates.push(['android_apk_url', '']);
      }
    }
    if (body.androidApkVersion !== undefined) {
      const ver = String(body.androidApkVersion || '').trim().slice(0, 24) || '2.4.0';
      updates.push(['android_apk_version', ver]);
    }

    const currentSettings = await getPlatformSettings();
    const nextMinDep = body.minDepositUsd !== undefined ? Number(body.minDepositUsd) : currentSettings.minDepositUsd;
    const nextMaxDep = body.maxDepositUsd !== undefined ? Number(body.maxDepositUsd) : currentSettings.maxDepositUsd;
    const nextMinWdr = body.minWithdrawUsd !== undefined ? Number(body.minWithdrawUsd) : currentSettings.minWithdrawUsd;
    const nextMaxWdr = body.maxWithdrawUsd !== undefined ? Number(body.maxWithdrawUsd) : currentSettings.maxWithdrawUsd;
    if (nextMinDep > nextMaxDep) {
      res.status(400).json({ error: 'Minimum deposit cannot exceed maximum deposit limit.' });
      return;
    }
    if (nextMinWdr > nextMaxWdr) {
      res.status(400).json({ error: 'Minimum withdrawal cannot exceed maximum withdrawal limit.' });
      return;
    }

    const now = new Date().toISOString();
    const upsert = db.prepare(`
      INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    await db.transaction(async () => {
      for (const [k, v] of updates) {
        await upsert.run(k, v, now);
      }
    })();

    const updatedSettings = await getPlatformSettings();
    setSpotFeeRates(updatedSettings.spotMakerFeePct, updatedSettings.spotTakerFeePct);

    // Sync updated presale network fee to all OPEN/UPCOMING rounds
    if (body.presaleNetworkFeeUsd !== undefined) {
      const newFee = Number(body.presaleNetworkFeeUsd);
      if (Number.isFinite(newFee) && newFee >= 0) {
        await db.prepare(
          "UPDATE presale_rounds SET network_fee = ? WHERE status IN ('OPEN', 'UPCOMING')"
        ).run(newFee);
      }
    }

    res.json({ settings: updatedSettings });
  }));

  app.post('/api/admin/kyc/:id/review', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { decision, admin_note } = req.body || {};
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be APPROVE or REJECT' });
      return;
    }

    try {
      const result = await db.transaction(async () => {
        const sub = (await db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(req.params.id)) as any;
        if (!sub) throw new Error('KYC submission not found');
        if (sub.status !== 'PENDING') throw new Error('KYC submission already reviewed');

        const now = new Date().toISOString();
        const nextStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const cleanNote = admin_note ? String(admin_note).trim().slice(0, 240) : '';

        await db.prepare(`
          UPDATE kyc_submissions
          SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
          WHERE id = ?
        `).run(nextStatus, cleanNote, req.auth!.userId, now, now, sub.id);

        if (decision === 'APPROVE') {
          await db.prepare("UPDATE users SET kyc_status = 'VERIFIED' WHERE id = ?").run(sub.user_id);
        }

        const user = (await db.prepare('SELECT referred_by FROM users WHERE id = ?').get(sub.user_id)) as any;
        if (user?.referred_by) {
          await syncReferralRewardsForReferrer(user.referred_by);
        }

        await createUserNotification({
          userId: sub.user_id,
          category: 'KYC',
          title: decision === 'APPROVE' ? 'Identity KYC Approved' : 'Identity KYC Requires Attention',
          message:
            decision === 'APPROVE'
              ? `Your ${sub.doc_type} verification was approved. Account status is now Verified.`
              : `Your ${sub.doc_type} submission was rejected${cleanNote ? `: ${cleanNote}` : '. Please resubmit clear document photos.'}`,
          linkTab: 'profile',
        });

        return await db.prepare('SELECT * FROM kyc_submissions WHERE id = ?').get(sub.id);
      })();

      res.json({ submission: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'KYC review failed' });
    }
  }));

  app.post('/api/admin/users/:id/status', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { status, kyc_status, role } = req.body || {};
    const targetId = req.params.id;
    const target = (await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (status && !['ACTIVE', 'INACTIVE'].includes(status)) {
      res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
      return;
    }
    if (kyc_status && !['VERIFIED', 'UNVERIFIED'].includes(kyc_status)) {
      res.status(400).json({ error: 'KYC status must be VERIFIED or UNVERIFIED' });
      return;
    }
    if (role && !['USER', 'ADMIN'].includes(role)) {
      res.status(400).json({ error: 'Role must be USER or ADMIN' });
      return;
    }
    if (targetId === req.auth!.userId && (status === 'INACTIVE' || role === 'USER')) {
      res.status(400).json({ error: 'Cannot deactivate or demote your own active admin session' });
      return;
    }

    const nextStatus = status || target.status || 'ACTIVE';
    const nextKyc = kyc_status || target.kyc_status || 'UNVERIFIED';
    const nextRole = role || target.role || 'USER';

    await db.prepare('UPDATE users SET status = ?, kyc_status = ?, role = ? WHERE id = ?').run(
      nextStatus,
      nextKyc,
      nextRole,
      targetId
    );
    if (kyc_status === 'UNVERIFIED') {
      await db.prepare("UPDATE kyc_submissions SET status = 'REJECTED', admin_note = 'Reset to unverified by Admin' WHERE user_id = ? AND status = 'APPROVED'").run(targetId);
    }
    if (target.referred_by) {
      await syncReferralRewardsForReferrer(target.referred_by);
    }
    const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
    res.json({ user: await sanitizeUser(updated) });
  }));

  app.post('/api/admin/users/:id/adjust-balance', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { wallet_type, direction, amount, note } = req.body || {};
    const targetId = req.params.id;
    const numAmount = Number(amount);

    if (!['MAIN', 'CLAIMABLE'].includes(wallet_type)) {
      res.status(400).json({ error: 'Wallet type must be MAIN or CLAIMABLE' });
      return;
    }
    if (!['CREDIT', 'DEBIT'].includes(direction)) {
      res.status(400).json({ error: 'Direction must be CREDIT or DEBIT' });
      return;
    }
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: 'Amount must be a finite number greater than $0.00' });
      return;
    }

    try {
      const result = await db.transaction(async () => {
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)) as any;
        if (!user) throw new Error('User not found');

        const delta = direction === 'CREDIT' ? numAmount : -numAmount;
        const currentBal = wallet_type === 'MAIN' ? Number(user.main_balance) : Number(user.claimable_balance);
        const nextBal = Number((currentBal + delta).toFixed(2));
        if (nextBal < 0) {
          throw new Error(`Insufficient ${wallet_type} balance for debit`);
        }

        const col = wallet_type === 'MAIN' ? 'main_balance' : 'claimable_balance';
        await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(nextBal, targetId);

        const refId = generateId('ADM');
        const reason = note ? String(note).trim() : `Admin ${direction.toLowerCase()} adjustment`;
        await appendLedger(
          targetId,
          wallet_type,
          'ADMIN_ADJUST',
          Number(delta.toFixed(2)),
          nextBal,
          refId,
          `${direction === 'CREDIT' ? 'Admin Credit' : 'Admin Debit'} (${wallet_type}): ${reason}`
        );

        return await sanitizeUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId));
      })();

      if (result?.referred_by) {
        await syncReferralRewardsForReferrer(result.referred_by);
      }

      const walletLabel = wallet_type === 'MAIN' ? 'Main Balance' : 'Claimable Balance';
      const noteSuffix = note && String(note).trim() ? ` (${String(note).trim()})` : '';
      await createUserNotification({
        userId: targetId,
        category: 'FUNDING',
        title: direction === 'CREDIT' ? 'Admin Deposit Credited' : 'Account Balance Debited',
        message:
          direction === 'CREDIT'
            ? `+$${numAmount.toFixed(2)} USDT was credited to your ${walletLabel} by Admin${noteSuffix}.`
            : `-$${numAmount.toFixed(2)} USDT was debited from your ${walletLabel} by Admin${noteSuffix}.`,
        linkTab: 'funding',
      });

      res.json({ user: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Balance adjustment failed' });
    }
  }));

  app.delete('/api/admin/users/:id', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      res.status(400).json({ error: 'User ID is required' });
      return;
    }
    if (targetId === req.auth!.userId) {
      res.status(400).json({ error: 'Cannot delete your own active admin account' });
      return;
    }

    const target = (await db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)) as any;
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.role === 'ADMIN') {
      res.status(400).json({ error: 'Admin accounts cannot be deleted directly. Demote role to USER first.' });
      return;
    }

    const activeOrder = (await db
      .prepare(
        `SELECT id FROM p2p_orders WHERE (buyer_id = ? OR seller_id = ?) AND status IN ('ESCROW_LOCKED', 'PAYMENT_SENT', 'DISPUTED') LIMIT 1`
      )
      .get(targetId, targetId)) as { id: string } | undefined;

    if (activeOrder) {
      res.status(400).json({
        error: `Cannot delete user while P2P order ${activeOrder.id} is still active or disputed. Resolve or cancel it first.`,
      });
      return;
    }

    const targetEmailLower = String(target.email || '').trim().toLowerCase();

    try {
      await db.transaction(async () => {
        await db
          .prepare(
            `DELETE FROM p2p_messages WHERE sender_id = ? OR order_id IN (
              SELECT id FROM p2p_orders WHERE buyer_id = ? OR seller_id = ? OR offer_id IN (SELECT id FROM p2p_offers WHERE creator_id = ?)
            )`
          )
          .run(targetId, targetId, targetId, targetId);

        await db
          .prepare(
            `DELETE FROM p2p_orders WHERE buyer_id = ? OR seller_id = ? OR offer_id IN (SELECT id FROM p2p_offers WHERE creator_id = ?)`
          )
          .run(targetId, targetId, targetId);

        await db.prepare('DELETE FROM p2p_offers WHERE creator_id = ?').run(targetId);

        await db
          .prepare(
            'DELETE FROM support_messages WHERE sender_id = ? OR thread_id IN (SELECT id FROM support_threads WHERE user_id = ?)'
          )
          .run(targetId, targetId);
        await db.prepare('DELETE FROM support_threads WHERE user_id = ?').run(targetId);

        await db.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_user_id = ?').run(targetId, targetId);
        await db.prepare('UPDATE users SET referred_by = NULL WHERE referred_by = ?').run(targetId);
        await db.prepare('UPDATE lucky_draws SET winner_user_id = NULL WHERE winner_user_id = ?').run(targetId);

        await db.prepare('DELETE FROM referral_milestone_claims WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM user_payment_methods WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM kyc_submissions WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM notifications WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM login_sessions WHERE user_id = ?').run(targetId);
        await db
          .prepare('DELETE FROM password_reset_codes WHERE user_id = ? OR LOWER(email) = ?')
          .run(targetId, targetEmailLower);
        await db.prepare('DELETE FROM signup_otp_codes WHERE LOWER(email) = ?').run(targetEmailLower);
        await db.prepare('DELETE FROM jackpot_tickets WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM presale_tickets WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM staking_daily_logs WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM staking_positions WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM spot_trades WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM user_coin_holdings WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM deposit_requests WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM withdraw_requests WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM wallets_ledger WHERE user_id = ?').run(targetId);

        await db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
      })();

      otpFailAttempts.delete(`signup:${targetEmailLower}`);
      otpFailAttempts.delete(`reset:${targetEmailLower}`);

      await recordAdminAuditLog({
        req,
        actionType: 'USER_DELETE',
        targetType: 'USER',
        targetId,
        summary: `Deleted user account ${target.full_name} (${target.email})`,
      });

      res.json({ deletedId: targetId, email: target.email });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to delete user account' });
    }
  }));

  app.post('/api/admin/send', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { mode, from_user_id, to_user_id, wallet_type, amount, note } = req.body || {};
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      res.status(400).json({ error: 'Transfer amount must be a finite number greater than $0.00' });
      return;
    }
    if (!to_user_id) {
      res.status(400).json({ error: 'Recipient user is required' });
      return;
    }

    try {
      const result = await db.transaction(async () => {
        const recipient = (await db.prepare('SELECT * FROM users WHERE id = ?').get(to_user_id)) as any;
        if (!recipient) throw new Error('Recipient user not found');

        const refId = generateId('SND');
        const descNote = note ? ` — ${String(note).trim()}` : '';

        if (mode === 'USER_TO_USER') {
          if (!from_user_id || from_user_id === to_user_id) {
            throw new Error('Select distinct sender and recipient accounts');
          }
          const sender = (await db.prepare('SELECT * FROM users WHERE id = ?').get(from_user_id)) as any;
          if (!sender) throw new Error('Sender user not found');
          if (sender.main_balance < numAmount) {
            throw new Error(`Sender ${sender.full_name} has insufficient Main Balance`);
          }

          const nextSenderMain = Number((sender.main_balance - numAmount).toFixed(2));
          const nextRecipMain = Number((recipient.main_balance + numAmount).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextSenderMain, sender.id);
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextRecipMain, recipient.id);

          await appendLedger(
            sender.id,
            'MAIN',
            'SEND_OUT',
            -numAmount,
            nextSenderMain,
            refId,
            `Admin-routed transfer to ${recipient.full_name} (${recipient.id})${descNote}`
          );
          await appendLedger(
            recipient.id,
            'MAIN',
            'SEND_IN',
            numAmount,
            nextRecipMain,
            refId,
            `Admin-routed transfer from ${sender.full_name} (${sender.id})${descNote}`
          );

          return {
            referenceId: refId,
            amount: numAmount,
            mode: 'USER_TO_USER' as const,
            senderId: sender.id,
            senderName: sender.full_name,
            recipientId: recipient.id,
            walletLabel: 'Main Balance',
          };
        } else {
          const targetWallet: 'MAIN' | 'CLAIMABLE' = wallet_type === 'CLAIMABLE' ? 'CLAIMABLE' : 'MAIN';
          const adminUser = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.auth!.userId)) as any;
          if (adminUser && adminUser.id !== recipient.id) {
            const nextAdminMain = Math.max(0, Number((adminUser.main_balance - numAmount).toFixed(2)));
            await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextAdminMain, adminUser.id);
            await appendLedger(
              adminUser.id,
              'MAIN',
              'SEND_OUT',
              -numAmount,
              nextAdminMain,
              refId,
              `Treasury send to ${recipient.full_name} (${recipient.id})${descNote}`
            );
          }

          const currentBal =
            targetWallet === 'MAIN' ? Number(recipient.main_balance) : Number(recipient.claimable_balance);
          const nextBal = Number((currentBal + numAmount).toFixed(2));
          const col = targetWallet === 'MAIN' ? 'main_balance' : 'claimable_balance';
          await db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(nextBal, recipient.id);

          await appendLedger(
            recipient.id,
            targetWallet,
            'SEND_IN',
            numAmount,
            nextBal,
            refId,
            `Treasury transfer from Master Admin${descNote}`
          );

          return {
            referenceId: refId,
            amount: numAmount,
            mode: 'TREASURY_SEND' as const,
            recipientId: recipient.id,
            walletLabel: targetWallet === 'MAIN' ? 'Main Balance' : 'Claimable Balance',
          };
        }
      })();

      const recipientUser = (await db.prepare('SELECT referred_by FROM users WHERE id = ?').get(to_user_id)) as
        | { referred_by?: string | null }
        | undefined;
      if (recipientUser?.referred_by) {
        await syncReferralRewardsForReferrer(recipientUser.referred_by);
      }

      const noteSuffix = note && String(note).trim() ? ` (${String(note).trim()})` : '';
      if (result.mode === 'USER_TO_USER') {
        await createUserNotification({
          userId: result.recipientId,
          category: 'FUNDING',
          title: 'USDT Transfer Received',
          message: `+$${numAmount.toFixed(2)} USDT received from ${result.senderName} in your ${result.walletLabel} (${result.referenceId})${noteSuffix}.`,
          linkTab: 'funding',
        });
        await createUserNotification({
          userId: result.senderId,
          category: 'FUNDING',
          title: 'Transfer Processed',
          message: `-$${numAmount.toFixed(2)} USDT transferred from your ${result.walletLabel} (${result.referenceId})${noteSuffix}.`,
          linkTab: 'funding',
        });
      } else {
        await createUserNotification({
          userId: result.recipientId,
          category: 'FUNDING',
          title: 'Admin Deposit Credited',
          message: `+$${numAmount.toFixed(2)} USDT was deposited to your ${result.walletLabel} by Admin (${result.referenceId})${noteSuffix}.`,
          linkTab: 'funding',
        });
      }

      res.json({ referenceId: result.referenceId, amount: result.amount });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Admin transfer failed' });
    }
  }));

  app.post('/api/admin/p2p/offers/:id/status', requireAdmin, ah(async (req, res) => {
    const { status } = req.body || {};
    if (!['ACTIVE', 'CLOSED'].includes(status)) {
      res.status(400).json({ error: 'Offer status must be ACTIVE or CLOSED' });
      return;
    }
    const offer = (await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(req.params.id)) as any;
    if (!offer) {
      res.status(404).json({ error: 'P2P offer not found' });
      return;
    }
    await db.prepare('UPDATE p2p_offers SET status = ? WHERE id = ?').run(status, offer.id);
    res.json({ offer: await db.prepare('SELECT * FROM p2p_offers WHERE id = ?').get(offer.id) });
  }));

  app.post('/api/admin/presale/rounds/:id/status', requireAdmin, ah(async (req, res) => {
    const { status } = req.body || {};
    if (!['UPCOMING', 'OPEN', 'CLOSED'].includes(status)) {
      res.status(400).json({ error: 'Round status must be UPCOMING, OPEN, or CLOSED' });
      return;
    }
    const round = (await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(req.params.id)) as any;
    if (!round) {
      res.status(404).json({ error: 'Presale round not found' });
      return;
    }
    await db.prepare('UPDATE presale_rounds SET status = ? WHERE id = ?').run(status, round.id);
    res.json({ round: await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(round.id) });
  }));

  app.delete('/api/admin/presale/rounds/:id', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    try {
      const result = await db.transaction(async () => {
        const round = (await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(req.params.id)) as any;
        if (!round) throw new Error('Presale round not found');

        const pendingTickets = (await db
          .prepare("SELECT * FROM presale_tickets WHERE round_id = ? AND result = 'PENDING'")
          .all(round.id)) as any[];

        let refundedCount = 0;
        for (const ticket of pendingTickets) {
          const refundTotal = Number((Number(ticket.principal_paid || 0) + Number(ticket.fee_paid || 0)).toFixed(2));
          if (refundTotal > 0) {
            const user = (await db.prepare('SELECT main_balance FROM users WHERE id = ?').get(ticket.user_id)) as any;
            if (user) {
              const nextMain = Number((Number(user.main_balance || 0) + refundTotal).toFixed(2));
              await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextMain, ticket.user_id);
              await appendLedger(
                ticket.user_id,
                'MAIN',
                'PRESALE_REFUND',
                refundTotal,
                nextMain,
                ticket.id,
                `Refunded cancelled IPO ${round.token_symbol} (${round.id})`
              );
              refundedCount += 1;
            }
          }
        }

        await db.prepare('DELETE FROM presale_tickets WHERE round_id = ?').run(round.id);
        await db.prepare('DELETE FROM presale_rounds WHERE id = ?').run(round.id);

        return { id: round.id, tokenSymbol: round.token_symbol, refundedCount };
      })();

      await recordAdminAuditLog({
        req,
        actionType: 'PRESALE_ROUND_DELETE',
        targetType: 'PRESALE_ROUND',
        targetId: result.id,
        summary: `Deleted presale round ${result.tokenSymbol} (${result.id}), refunded ${result.refundedCount} pending ticket(s)`,
      });

      res.json({ deleted: true, ...result });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to delete presale round' });
    }
  }));

  app.post('/api/admin/referrals/:id/credit', requireAdmin, ah(async (req, res) => {
    try {
      const updated = await db.transaction(async () => {
        const ref = (await db.prepare('SELECT * FROM referrals WHERE id = ?').get(req.params.id)) as any;
        if (!ref) throw new Error('Referral record not found');
        if (ref.status === 'CREDITED_CLAIMABLE') throw new Error('Referral bonus already credited');

        const referrer = (await db.prepare('SELECT * FROM users WHERE id = ?').get(ref.referrer_id)) as any;
        const referred = (await db.prepare('SELECT * FROM users WHERE id = ?').get(ref.referred_user_id)) as any;
        if (!referrer) throw new Error('Referrer account not found');

        const now = new Date().toISOString();
        const nextClaimable = Number((referrer.claimable_balance + ref.bonus_amount).toFixed(2));
        await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, referrer.id);
        await db.prepare("UPDATE referrals SET status = 'CREDITED_CLAIMABLE', credited_at = ? WHERE id = ?").run(now, ref.id);

        await appendLedger(
          referrer.id,
          'CLAIMABLE',
          'REFERRAL_BONUS',
          ref.bonus_amount,
          nextClaimable,
          ref.id,
          `Admin approved referral bonus ($${Number(ref.bonus_amount).toFixed(2)}) for ${referred?.full_name || ref.referred_user_id}`
        );

        await createUserNotification({
          userId: referrer.id,
          category: 'REWARDS',
          title: 'Referral Bonus Credited',
          message: `+$${Number(ref.bonus_amount).toFixed(2)} USDT credited for referring ${referred?.full_name || ref.referred_user_id}.`,
          linkTab: 'referrals',
        });

        return await db.prepare('SELECT * FROM referrals WHERE id = ?').get(ref.id);
      })();
      res.json({ referral: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Referral credit failed' });
    }
  }));

  app.post('/api/admin/lucky-draw/update-pool', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { prize_pool, quarter_label, title, ticket_price, draw_at } = req.body || {};
    const pool = Number(prize_pool);
    if (!Number.isFinite(pool) || pool <= 0) {
      res.status(400).json({ error: 'Prize pool must be a finite number greater than $0.00' });
      return;
    }

    const parsedTicketPrice = ticket_price !== undefined ? Number(ticket_price) : undefined;
    if (parsedTicketPrice !== undefined && (!Number.isFinite(parsedTicketPrice) || parsedTicketPrice < 1)) {
      res.status(400).json({ error: 'Ticket price must be at least $1.00' });
      return;
    }

    const parsedDrawAt = draw_at ? new Date(draw_at) : null;
    if (parsedDrawAt && Number.isNaN(parsedDrawAt.getTime())) {
      res.status(400).json({ error: 'Invalid scheduled draw date' });
      return;
    }

    const openDraw = (await db.prepare("SELECT * FROM lucky_draws WHERE status = 'OPEN' ORDER BY created_at DESC LIMIT 1").get()) as any;
    if (openDraw) {
      await db.prepare(`
        UPDATE lucky_draws
        SET prize_pool = ?,
            quarter_label = COALESCE(?, quarter_label),
            title = COALESCE(?, title),
            ticket_price = COALESCE(?, ticket_price),
            draw_at = COALESCE(?, draw_at)
        WHERE id = ?
      `).run(
        Number(pool.toFixed(2)),
        quarter_label ? String(quarter_label).trim() : null,
        title ? String(title).trim() : null,
        parsedTicketPrice ? Number(parsedTicketPrice.toFixed(2)) : null,
        parsedDrawAt ? parsedDrawAt.toISOString() : null,
        openDraw.id
      );
      const updatedDraw = await db.prepare('SELECT * FROM lucky_draws WHERE id = ?').get(openDraw.id);
      await recordAdminAuditLog({
        req,
        actionType: 'JACKPOT_CONFIG_UPDATE',
        targetType: 'JACKPOT',
        targetId: openDraw.id,
        summary: `Updated Jackpot (${quarter_label || openDraw.quarter_label}) Pool $${pool.toFixed(2)} · Ticket $${(parsedTicketPrice ?? Number(openDraw.ticket_price || 1)).toFixed(2)}`,
      });
      res.json({ draw: updatedDraw });
    } else {
      const now = new Date().toISOString();
      const nextQuarterDate = parsedDrawAt ? parsedDrawAt.toISOString() : addThreeMonthsIso();
      const qLabel = String(quarter_label || 'Q1 2027').trim();
      const id = generateId('DRW');
      await db.prepare(`
        INSERT INTO lucky_draws (id, quarter_label, title, prize_pool, ticket_price, status, draw_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
      `).run(
        id,
        qLabel,
        String(title || `${qLabel} Quarterly Jackpot`).trim(),
        Number(pool.toFixed(2)),
        parsedTicketPrice ? Number(parsedTicketPrice.toFixed(2)) : 1.0,
        nextQuarterDate,
        now
      );
      const createdDraw = await db.prepare('SELECT * FROM lucky_draws WHERE id = ?').get(id);
      await recordAdminAuditLog({
        req,
        actionType: 'JACKPOT_ROUND_CREATE',
        targetType: 'JACKPOT',
        targetId: id,
        summary: `Created Jackpot (${qLabel}) Pool $${pool.toFixed(2)}`,
      });
      res.status(201).json({ draw: createdDraw });
    }
  }));

  app.post('/api/admin/deposits/:id/review', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { decision, admin_note } = req.body || {};
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be APPROVE or REJECT' });
      return;
    }

    try {
      const updated = await db.transaction(async () => {
        const dep = (await db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(req.params.id)) as any;
        if (!dep) throw new Error('Deposit request not found');
        if (dep.status !== 'PENDING') throw new Error('Deposit already reviewed');

        const now = new Date().toISOString();
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        await db.prepare(`
          UPDATE deposit_requests SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?
        `).run(status, admin_note ? String(admin_note) : '', req.auth!.userId, now, dep.id);

        if (decision === 'APPROVE') {
          const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(dep.user_id)) as any;
          const nextMain = Number((user.main_balance + dep.amount).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ?, first_deposit_rewarded = 1 WHERE id = ?').run(
            nextMain,
            user.id
          );

          await appendLedger(
            user.id,
            'MAIN',
            'DEPOSIT',
            dep.amount,
            nextMain,
            dep.id,
            `Approved ${dep.gateway} deposit (TrxID: ${dep.trx_id})`
          );

          // Evaluate referral bonus when referred user balance reaches $500.00 & referrer has 10+ verified signups
          if (user.referred_by) {
            await syncReferralRewardsForReferrer(user.referred_by);
          }
        }

        return await db.prepare('SELECT * FROM deposit_requests WHERE id = ?').get(dep.id);
      })();

      const depRow = updated as any;
      if (depRow) {
        await createUserNotification({
          userId: depRow.user_id,
          category: 'FUNDING',
          title: decision === 'APPROVE' ? 'Deposit Approved' : 'Deposit Rejected',
          message:
            decision === 'APPROVE'
              ? `+$${Number(depRow.amount).toFixed(2)} USDT via ${depRow.gateway} (${depRow.trx_id}) was credited to your Main Balance.`
              : `Your ${depRow.gateway} deposit of $${Number(depRow.amount).toFixed(2)} (${depRow.trx_id}) was rejected${admin_note ? `: ${admin_note}` : '.'}`,
          linkTab: 'funding',
        });
      }

      res.json({ deposit: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Review failed' });
    }
  }));

  app.post('/api/admin/withdrawals/:id/review', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { decision, admin_note } = req.body || {};
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      res.status(400).json({ error: 'Decision must be APPROVE or REJECT' });
      return;
    }

    try {
      const updated = await db.transaction(async () => {
        const wdr = (await db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(req.params.id)) as any;
        if (!wdr) throw new Error('Withdrawal request not found');
        if (wdr.status !== 'PENDING') throw new Error('Withdrawal already reviewed');

        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(wdr.user_id)) as any;
        const wdrFee = Number(wdr.fee_usd || 0);
        const totalHeld = Number((wdr.amount + wdrFee).toFixed(2));
        const nextLocked = Math.max(0, Number((user.locked_balance - totalHeld).toFixed(2)));
        const now = new Date().toISOString();
        const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

        if (decision === 'APPROVE') {
          await db.prepare('UPDATE users SET locked_balance = ? WHERE id = ?').run(nextLocked, user.id);
          await appendLedger(
            user.id,
            'MAIN',
            'WITHDRAW_RELEASE',
            0,
            user.main_balance,
            wdr.id,
            `Withdrawal processed via ${wdr.gateway} (${wdr.destination_address}) · Fee: $${wdrFee.toFixed(2)}`
          );
        } else {
          const nextMain = Number((user.main_balance + totalHeld).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
            nextMain,
            nextLocked,
            user.id
          );
          await appendLedger(
            user.id,
            'MAIN',
            'WITHDRAW_REFUND',
            totalHeld,
            nextMain,
            wdr.id,
            `Withdrawal rejected & refunded $${totalHeld.toFixed(2)} (${admin_note || 'Admin rejected'})`
          );
        }

        await db.prepare(`
          UPDATE withdraw_requests SET status = ?, admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?
        `).run(status, admin_note ? String(admin_note) : '', req.auth!.userId, now, wdr.id);

        return await db.prepare('SELECT * FROM withdraw_requests WHERE id = ?').get(wdr.id);
      })();

      const wdrRow = updated as any;
      if (wdrRow) {
        const totalHeld = Number((Number(wdrRow.amount) + Number(wdrRow.fee_usd || 0)).toFixed(2));
        await createUserNotification({
          userId: wdrRow.user_id,
          category: 'FUNDING',
          title: decision === 'APPROVE' ? 'Withdrawal Processed' : 'Withdrawal Rejected & Refunded',
          message:
            decision === 'APPROVE'
              ? `Your withdrawal of $${Number(wdrRow.amount).toFixed(2)} USDT via ${wdrRow.gateway} has been sent to ${wdrRow.destination_address}.`
              : `$${totalHeld.toFixed(2)} USDT was refunded to your Main Balance${admin_note ? `: ${admin_note}` : '.'}`,
          linkTab: 'funding',
        });
      }

      res.json({ withdrawal: updated });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Withdrawal review failed' });
    }
  }));

  app.post('/api/admin/p2p/orders/:id/resolve', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const { winner, note } = req.body || {};
    if (!['BUYER', 'SELLER'].includes(winner)) {
      res.status(400).json({ error: 'Winner must be BUYER or SELLER' });
      return;
    }

    try {
      const resolved = await db.transaction(async () => {
        const order = (await db.prepare('SELECT * FROM p2p_orders WHERE id = ?').get(req.params.id)) as any;
        if (!order || order.status !== 'DISPUTED') {
          throw new Error('Order is not in DISPUTED status');
        }

        const seller = (await db.prepare('SELECT * FROM users WHERE id = ?').get(order.seller_id)) as any;
        const buyer = (await db.prepare('SELECT * FROM users WHERE id = ?').get(order.buyer_id)) as any;
        const p2pFee = Number(order.fee_usd || 0);
        const totalLockedForOrder = Number((order.amount_vusd + p2pFee).toFixed(2));
        const nextSellerLocked = Math.max(0, Number((seller.locked_balance - totalLockedForOrder).toFixed(2)));
        const now = new Date().toISOString();

        if (winner === 'BUYER') {
          const nextBuyerMain = Number((buyer.main_balance + order.amount_vusd).toFixed(2));
          await db.prepare('UPDATE users SET locked_balance = ? WHERE id = ?').run(nextSellerLocked, seller.id);
          await db.prepare('UPDATE users SET main_balance = ? WHERE id = ?').run(nextBuyerMain, buyer.id);
          await db.prepare(`
            UPDATE p2p_orders SET status = 'RESOLVED_BUYER', admin_resolution_note = ?, updated_at = ? WHERE id = ?
          `).run(String(note || 'Admin awarded escrow to Buyer'), now, order.id);

          await appendLedger(
            buyer.id,
            'MAIN',
            'P2P_RELEASE',
            order.amount_vusd,
            nextBuyerMain,
            order.id,
            `Dispute resolved in Buyer favor (${order.id}) · Fee: $${p2pFee.toFixed(2)}`
          );

          const resMsg = await insertP2PMessage({
            orderId: order.id,
            senderId: null,
            senderRole: 'ADMIN',
            msgType: 'SYSTEM',
            body: `Admin Arbitration Complete: Awarded ${Number(order.amount_vusd).toFixed(2)} USDT from Escrow to Buyer (${buyer.full_name}). Note: ${String(note || 'Payment verified by Admin')}`,
          });
          return { order: await getEnrichedP2POrder(order.id), message: resMsg };
        } else {
          const nextSellerMain = Number((seller.main_balance + totalLockedForOrder).toFixed(2));
          await db.prepare('UPDATE users SET main_balance = ?, locked_balance = ? WHERE id = ?').run(
            nextSellerMain,
            nextSellerLocked,
            seller.id
          );
          await db.prepare(`
            UPDATE p2p_orders SET status = 'RESOLVED_SELLER', fee_usd = 0, admin_resolution_note = ?, updated_at = ? WHERE id = ?
          `).run(String(note || 'Admin refunded escrow to Seller'), now, order.id);

          await appendLedger(
            seller.id,
            'MAIN',
            'P2P_REFUND',
            totalLockedForOrder,
            nextSellerMain,
            order.id,
            `Dispute resolved in Seller favor (${order.id})`
          );

          const resMsg = await insertP2PMessage({
            orderId: order.id,
            senderId: null,
            senderRole: 'ADMIN',
            msgType: 'SYSTEM',
            body: `Admin Arbitration Complete: Refunded ${Number(order.amount_vusd).toFixed(2)} USDT (+ $${p2pFee.toFixed(2)} fee) from Escrow back to Seller (${seller.full_name}). Note: ${String(note || 'Escrow refunded to Seller')}`,
          });
          return { order: await getEnrichedP2POrder(order.id), message: resMsg };
        }
      })();

      broadcastOrderState(resolved.order, 'P2P_ORDER_UPDATED');
      broadcastOrderMessage(resolved.order, resolved.message);
      res.json({ order: resolved.order });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Dispute resolution failed' });
    }
  }));

  app.post('/api/admin/markets', requireAdmin, ah(async (req, res) => {
    try {
      const { symbol, name } = req.body || {};
      const pair = await addGlobalLiveMarketPair(symbol, name);
      res.status(201).json({ pair, markets: await getMarketSnapshot() });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to add global live market pair' });
    }
  }));

  async function executeAdminMonthlyStakingPayout() {
    const notificationsToSend: { userId: string; pkg: string; amount: number; completed: boolean; totalCredit: number }[] = [];

    const summary = await db.transaction(async () => {
      const activePositions = (await db
        .prepare("SELECT * FROM staking_positions WHERE status = 'ACTIVE'")
        .all()) as any[];

      let totalPaid = 0;
      let positionsProcessed = 0;
      const now = new Date();
      const nextMonth = new Date(now.getTime() + THIRTY_DAYS_MS).toISOString();
      const touchedUserIds = new Set<string>();

      for (const pos of activePositions) {
        const monthlyProfitExact = (pos.principal_amount * (pos.annual_roi_pct / 100)) / 12;
        const monthlyProfit = Number(monthlyProfitExact.toFixed(2));
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(pos.user_id)) as any;
        const nextClaimable = Number((user.claimable_balance + monthlyProfit).toFixed(2));

        await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, user.id);

        const nextMonthsPaid = Number(pos.months_paid || 0) + 1;
        const nextQuartersPaid = Math.min(Number(pos.total_quarters || 0), Math.floor(nextMonthsPaid / 3));
        const isCompleted = nextMonthsPaid >= Number(pos.duration_months);
        const nextTotalProfitPaid = Number((Number(pos.total_profit_paid || 0) + monthlyProfit).toFixed(2));
        const nextAccruedDays = Math.min(Number(pos.duration_months) * 30, Math.max(Number(pos.accrued_days || 0), nextMonthsPaid * 30));
        const totalEarned = Number(((nextAccruedDays / 30) * monthlyProfitExact).toFixed(2));
        const remainingAccrued = isCompleted ? 0 : Math.max(0, Number((totalEarned - nextTotalProfitPaid).toFixed(2)));

        if (isCompleted) {
          const withPrincipal = Number((nextClaimable + pos.principal_amount).toFixed(2));
          await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(withPrincipal, user.id);
          await db.prepare(`
            UPDATE staking_positions
            SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = 0, status = 'COMPLETED'
            WHERE id = ?
          `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, pos.id);
          await appendLedger(
            user.id,
            'CLAIMABLE',
            'STAKING_PAYOUT',
            monthlyProfit + pos.principal_amount,
            withPrincipal,
            pos.id,
            `Final Monthly Staking Payout + Principal Release (${pos.package_code})`
          );
          notificationsToSend.push({
            userId: user.id,
            pkg: pos.package_code,
            amount: monthlyProfit,
            completed: true,
            totalCredit: Number((monthlyProfit + pos.principal_amount).toFixed(2)),
          });
        } else {
          await db.prepare(`
            UPDATE staking_positions
            SET total_profit_paid = ?, months_paid = ?, quarters_paid = ?, accrued_days = ?, accrued_profit = ?, next_payout_at = ?
            WHERE id = ?
          `).run(nextTotalProfitPaid, nextMonthsPaid, nextQuartersPaid, nextAccruedDays, remainingAccrued, nextMonth, pos.id);
          await appendLedger(
            user.id,
            'CLAIMABLE',
            'STAKING_PAYOUT',
            monthlyProfit,
            nextClaimable,
            pos.id,
            `Monthly Profit Payout (${pos.package_code} @ ${pos.annual_roi_pct}% APR)`
          );
          notificationsToSend.push({
            userId: user.id,
            pkg: pos.package_code,
            amount: monthlyProfit,
            completed: false,
            totalCredit: monthlyProfit,
          });
        }

        touchedUserIds.add(user.id);
        totalPaid = Number((totalPaid + monthlyProfit).toFixed(2));
        positionsProcessed++;
      }

      for (const uid of touchedUserIds) {
        await recomputeUserProfitBalance(uid);
      }

      return { positionsProcessed, totalPaid };
    })();

    for (const item of notificationsToSend) {
      await createUserNotification({
        userId: item.userId,
        category: 'STAKING',
        title: item.completed
          ? `Staking Vault Matured (${item.pkg})`
          : `Monthly Staking Payout Credited (${item.pkg})`,
        message: item.completed
          ? `+$${item.totalCredit.toFixed(2)} USDT (final monthly profit + principal) credited to your Claimable Wallet.`
          : `+$${item.amount.toFixed(2)} USDT monthly staking profit credited to your Claimable Wallet.`,
        linkTab: 'staking',
      }).catch(() => {});
    }

    return summary;
  }

  app.post('/api/admin/staking/run-daily-accrual', requireAdmin, ah(async (_req, res) => {
    const notificationsToSend: {
      userId: string;
      pkg: string;
      dailyDelta: number;
      cycleDay: number;
      roiPct: number;
      unlockedMonthly: number | null;
    }[] = [];

    const result = await db.transaction(async () => {
      const activePositions = (await db
        .prepare("SELECT * FROM staking_positions WHERE status = 'ACTIVE'")
        .all()) as any[];

      let totalDailyCredited = 0;
      let positionsAccrued = 0;
      const nowIso = new Date().toISOString();
      const touchedUserIds = new Set<string>();

      for (const pos of activePositions) {
        const durationMonths = Number(pos.duration_months || 0);
        const totalTermDays = durationMonths * 30;
        const currentDays = Math.min(totalTermDays, Math.max(Number(pos.accrued_days || 0), Number(pos.months_paid || 0) * 30));
        if (currentDays >= totalTermDays) continue;

        const nextDay = currentDays + 1;
        const monthlyProfitExact = (Number(pos.principal_amount || 0) * (Number(pos.annual_roi_pct) / 100)) / 12;
        const prevEarned = Number(((currentDays / 30) * monthlyProfitExact).toFixed(2));
        const nextEarned = Number(((nextDay / 30) * monthlyProfitExact).toFixed(2));
        const dailyDelta = Number((nextEarned - prevEarned).toFixed(2));
        const newAccruedProfit = Math.max(0, Number((nextEarned - Number(pos.total_profit_paid || 0)).toFixed(2)));

        const currentNextPayoutMs = Date.parse(pos.next_payout_at);
        const shiftedNextPayoutIso = Number.isFinite(currentNextPayoutMs)
          ? new Date(currentNextPayoutMs - ONE_DAY_MS).toISOString()
          : pos.next_payout_at;

        const shiftedNextDailyIso = new Date(Date.now() + ONE_DAY_MS).toISOString();
        await db.prepare(`
          UPDATE staking_positions
          SET accrued_days = ?, accrued_profit = ?, next_payout_at = ?, next_daily_accrual_at = ?
          WHERE id = ?
        `).run(nextDay, newAccruedProfit, shiftedNextPayoutIso, shiftedNextDailyIso, pos.id);

        if (dailyDelta > 0) {
          const existingLog = await db
            .prepare('SELECT id FROM staking_daily_logs WHERE position_id = ? AND day_number = ?')
            .get(pos.id, nextDay);
          if (!existingLog) {
            await db.prepare(`
              INSERT INTO staking_daily_logs (id, user_id, position_id, package_code, day_number, daily_amount, total_accrued, credited_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(generateId('SDL'), pos.user_id, pos.id, pos.package_code, nextDay, dailyDelta, newAccruedProfit, nowIso);
          }

          const cycleDay = nextDay % 30 === 0 ? 30 : nextDay % 30;
          notificationsToSend.push({
            userId: pos.user_id,
            pkg: pos.package_code,
            dailyDelta,
            cycleDay,
            roiPct: Number(pos.annual_roi_pct),
            unlockedMonthly: nextDay % 30 === 0 ? Number(monthlyProfitExact.toFixed(2)) : null,
          });
        }

        touchedUserIds.add(pos.user_id);
        totalDailyCredited = Number((totalDailyCredited + dailyDelta).toFixed(2));
        positionsAccrued++;
      }

      for (const uid of touchedUserIds) {
        await recomputeUserProfitBalance(uid);
      }

      return { positionsAccrued, totalDailyCredited };
    })();

    for (const item of notificationsToSend) {
      await createUserNotification({
        userId: item.userId,
        category: 'STAKING',
        title: `Daily Staking Profit Added (${item.pkg})`,
        message: `+$${item.dailyDelta.toFixed(2)} USDT added to Profit Balance (${item.roiPct}% APR · Cycle Day ${item.cycleDay}/30). Unlocks for withdrawal on Day 30.`,
        linkTab: 'staking',
      }).catch(() => {});

      if (item.unlockedMonthly !== null) {
        await createUserNotification({
          userId: item.userId,
          category: 'STAKING',
          title: `Monthly Staking Profit Unlocked (${item.pkg})`,
          message: `+$${item.unlockedMonthly.toFixed(2)} USDT completed its 30-day cycle and is now unlocked to withdraw from Profit Balance.`,
          linkTab: 'staking',
        }).catch(() => {});
      }
    }

    res.json(result);
  }));

  app.post('/api/admin/staking/run-monthly-payout', requireAdmin, ah(async (_req, res) => {
    res.json(await executeAdminMonthlyStakingPayout());
  }));

  app.post('/api/admin/staking/run-quarterly-payout', requireAdmin, ah(async (_req, res) => {
    res.json(await executeAdminMonthlyStakingPayout());
  }));

  app.post('/api/admin/staking/run-monthly-draw', requireAdmin, ah(async (_req, res) => {
    try {
      const result = await db.transaction(async () => {
        const active = (await db
          .prepare("SELECT s.*, u.email, u.full_name FROM staking_positions s JOIN users u ON s.user_id = u.id WHERE s.status = 'ACTIVE'")
          .all()) as any[];
        if (active.length === 0) throw new Error('No active staking positions for monthly draw');

        const winner = active[crypto.randomInt(0, active.length)];
        const bonus = 150.0;
        const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(winner.user_id)) as any;
        const nextClaimable = Number((user.claimable_balance + bonus).toFixed(2));
        await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, user.id);
        await db.prepare('UPDATE staking_positions SET monthly_draw_entries = monthly_draw_entries + 1 WHERE status = ?').run('ACTIVE');

        await appendLedger(
          user.id,
          'CLAIMABLE',
          'STAKING_PAYOUT',
          bonus,
          nextClaimable,
          winner.id,
          `Monthly Staking Draw Winner Bonus ($${bonus.toFixed(2)})`
        );

        return { winnerId: user.id, winnerEmail: winner.email, winnerName: winner.full_name, bonus };
      })();

      createUserNotification({
        userId: result.winnerId,
        category: 'REWARDS',
        title: `Monthly Staking Draw Winner`,
        message: `Congratulations! +$${result.bonus.toFixed(2)} USDT Staking Draw Bonus credited to your Claimable Wallet.`,
        linkTab: 'staking',
      }).catch(() => {});

      res.json({ winnerEmail: result.winnerEmail, winnerName: result.winnerName, bonus: result.bonus });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Monthly staking draw failed' });
    }
  }));

  app.post('/api/admin/presale/rounds', requireAdmin, ah(async (req, res) => {
    const {
      token_symbol,
      token_name,
      face_value,
      lot_size,
      issue_price,
      lot_price,
      tokens_per_lot,
      projected_win_payout,
      total_lots,
      total_issue_size,
      listing_date,
      min_lots,
      max_lots,
      status,
    } = req.body || {};

    const cleanSym = String(token_symbol || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    const cleanName = String(token_name || '').trim().slice(0, 80);
    const numLotPrice = Number(lot_price);
    const numTokensPerLot = Number(tokens_per_lot);
    const numWinPayout = Number(projected_win_payout);
    const numTotalLots = Math.floor(Number(total_lots));
    const initialStatus = status === 'UPCOMING' ? 'UPCOMING' : 'OPEN';

    if (!cleanSym || cleanSym.length < 2 || !cleanName) {
      res.status(400).json({ error: 'Valid token symbol and name are required' });
      return;
    }
    if (
      !Number.isFinite(numLotPrice) || numLotPrice <= 0 ||
      !Number.isFinite(numTokensPerLot) || numTokensPerLot <= 0 ||
      !Number.isFinite(numWinPayout) || numWinPayout <= 0 ||
      !Number.isFinite(numTotalLots) || numTotalLots < 1
    ) {
      res.status(400).json({ error: 'All presale round numeric fields must be finite positive numbers' });
      return;
    }

    const numFaceValue = Number(face_value) > 0 ? Number(face_value) : 10.0;
    const numLotSize = Math.floor(Number(lot_size)) > 0 ? Math.floor(Number(lot_size)) : Math.floor(numTokensPerLot) || 50;
    const rawIssuePrice = Number(issue_price) > 0 ? Number(issue_price) : Number((numLotPrice / numLotSize).toFixed(6));
    const numIssuePrice = Math.abs(numLotSize * rawIssuePrice - numLotPrice) > 0.02
      ? Number((numLotPrice / numLotSize).toFixed(6))
      : rawIssuePrice;
    const numTotalIssueSize = Number(total_issue_size) > 0
      ? Number(total_issue_size)
      : Number((numTotalLots * numLotSize * numLotPrice).toFixed(2));
    const numMinLots = Math.floor(Number(min_lots)) >= 1 ? Math.floor(Number(min_lots)) : 1;
    const numMaxLots = Math.floor(Number(max_lots)) >= numMinLots ? Math.floor(Number(max_lots)) : Math.min(500, numTotalLots);
    const cleanListingDate = String(listing_date || '').trim() || new Date(Date.now() + 30 * 86400000).toISOString();
    const drawDate = cleanListingDate;

    const presaleFee = (await getPlatformSettings()).presaleNetworkFeeUsd;
    const baseId = `IPO-${cleanSym}`;
    const existingRound = await db.prepare('SELECT id FROM presale_rounds WHERE id = ?').get(baseId);
    const id = existingRound ? `${baseId}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` : baseId;

    await db.prepare(`
      INSERT INTO presale_rounds (
        id, token_symbol, token_name, face_value, lot_size, issue_price,
        lot_price, network_fee, tokens_per_lot, projected_win_payout,
        total_lots, total_issue_size, sold_lots, draw_date, listing_date,
        min_lots, max_lots, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      cleanSym,
      cleanName,
      Number(numFaceValue.toFixed(4)),
      numLotSize,
      Number(numIssuePrice.toFixed(4)),
      Number(numLotPrice.toFixed(4)),
      presaleFee,
      Number(numTokensPerLot.toFixed(4)),
      Number(numWinPayout.toFixed(2)),
      numTotalLots,
      Number(numTotalIssueSize.toFixed(2)),
      drawDate,
      cleanListingDate,
      numMinLots,
      numMaxLots,
      initialStatus,
      new Date().toISOString()
    );

    res.status(201).json({ round: await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(id) });
  }));

  async function settlePresaleTicketInTx(ticket: any, round: any, result: 'WIN' | 'LOSS', winningNumber?: string | null) {
    const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.user_id)) as any;
    if (!user) throw new Error('Ticket owner not found');
    const now = new Date().toISOString();

    if (result === 'WIN') {
      const payoutUsd = Number((ticket.lots_count * round.projected_win_payout).toFixed(2));
      const tokensWon = Number((ticket.lots_count * round.tokens_per_lot).toFixed(4));
      const nextClaimable = Number((user.claimable_balance + payoutUsd).toFixed(2));

      await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, user.id);

      const existingHolding = (await db
        .prepare('SELECT * FROM user_coin_holdings WHERE user_id = ? AND asset = ?')
        .get(user.id, round.token_symbol)) as any;
      if (existingHolding) {
        await db.prepare('UPDATE user_coin_holdings SET quantity = quantity + ? WHERE user_id = ? AND asset = ?').run(
          tokensWon,
          user.id,
          round.token_symbol
        );
      } else {
        await db.prepare('INSERT INTO user_coin_holdings (user_id, asset, quantity, avg_entry_price) VALUES (?, ?, ?, ?)').run(
          user.id,
          round.token_symbol,
          tokensWon,
          Number((round.lot_price / round.tokens_per_lot).toFixed(4))
        );
      }

      await db.prepare("UPDATE presale_tickets SET result = 'WIN', payout_amount = ?, settled_at = ? WHERE id = ?").run(
        payoutUsd,
        now,
        ticket.id
      );

      await appendLedger(
        user.id,
        'CLAIMABLE',
        'PRESALE_WIN',
        payoutUsd,
        nextClaimable,
        ticket.id,
        `Presale WIN${winningNumber ? ` (#${winningNumber})` : ''}: ${tokensWon} ${round.token_symbol} + $${payoutUsd.toFixed(2)} payout`
      );

      await createUserNotification({
        userId: user.id,
        category: 'REWARDS',
        title: `Presale WIN · ${round.token_symbol}`,
        message: `${winningNumber ? `Winning #${winningNumber}! ` : ''}Won ${tokensWon} ${round.token_symbol} + $${payoutUsd.toFixed(2)} USDT in your Claimable Wallet!`,
        linkTab: 'presale',
      });
    } else {
      const refundUsd = Number(Number(ticket.principal_paid).toFixed(2));
      const nextClaimable = Number((user.claimable_balance + refundUsd).toFixed(2));
      await db.prepare('UPDATE users SET claimable_balance = ? WHERE id = ?').run(nextClaimable, user.id);

      await db.prepare("UPDATE presale_tickets SET result = 'LOSS', payout_amount = ?, settled_at = ? WHERE id = ?").run(
        refundUsd,
        now,
        ticket.id
      );

      await appendLedger(
        user.id,
        'CLAIMABLE',
        'PRESALE_REFUND',
        refundUsd,
        nextClaimable,
        ticket.id,
        `Presale Draw Refund${winningNumber ? ` (Winning #${winningNumber})` : ''}: $${refundUsd.toFixed(2)} principal returned (excl. $${Number(ticket.fee_paid).toFixed(2)} fee)`
      );

      await createUserNotification({
        userId: user.id,
        category: 'REWARDS',
        title: `Presale Draw Settled · ${round.token_symbol}`,
        message: `$${refundUsd.toFixed(2)} USDT principal was refunded to your Claimable Wallet.`,
        linkTab: 'presale',
      });
    }
  }

  app.post('/api/admin/presale/tickets/:id/settle', requireAdmin, ah(async (req, res) => {
    const { result } = req.body || {};
    if (!['WIN', 'LOSS'].includes(result)) {
      res.status(400).json({ error: 'Result must be WIN or LOSS' });
      return;
    }

    try {
      const settled = await db.transaction(async () => {
        const ticket = (await db.prepare('SELECT * FROM presale_tickets WHERE id = ?').get(req.params.id)) as any;
        if (!ticket) throw new Error('Presale ticket not found');
        if (ticket.result !== 'PENDING') throw new Error('Ticket already settled');

        const round = (await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(ticket.round_id)) as any;
        await settlePresaleTicketInTx(ticket, round, result);
        return await db.prepare('SELECT * FROM presale_tickets WHERE id = ?').get(ticket.id);
      })();

      res.json({ ticket: settled });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Presale settlement failed' });
    }
  }));

  app.post('/api/admin/presale/rounds/:id/draw-number', requireAdmin, ah(async (req, res) => {
    const winningNumber = String(req.body?.winning_number || '').trim().replace(/^#/, '');
    if (!/^\d{6}$/.test(winningNumber)) {
      res.status(400).json({ error: 'Winning number must be a valid 6-digit number (e.g. 482910).' });
      return;
    }

    try {
      const summary = await db.transaction(async () => {
        const round = (await db.prepare('SELECT * FROM presale_rounds WHERE id = ?').get(req.params.id)) as any;
        if (!round) throw new Error('Presale round not found');

        const pendingTickets = (await db
          .prepare("SELECT * FROM presale_tickets WHERE round_id = ? AND result = 'PENDING'")
          .all(round.id)) as any[];

        if (pendingTickets.length === 0) {
          throw new Error('No pending tickets in this round to settle.');
        }

        const hasMatch = pendingTickets.some((t) => parseTicketNumbers(t.ticket_numbers).includes(winningNumber));
        if (!hasMatch) {
          throw new Error(`No pending ticket in ${round.token_symbol} holds number #${winningNumber}.`);
        }

        let winCount = 0;
        let lossCount = 0;
        for (const ticket of pendingTickets) {
          const nums = parseTicketNumbers(ticket.ticket_numbers);
          const isWinner = nums.includes(winningNumber);
          await settlePresaleTicketInTx(ticket, round, isWinner ? 'WIN' : 'LOSS', winningNumber);
          if (isWinner) winCount += 1;
          else lossCount += 1;
        }

        await db
          .prepare("UPDATE presale_rounds SET winning_number = ?, status = 'CLOSED' WHERE id = ?")
          .run(winningNumber, round.id);

        return { roundId: round.id, tokenSymbol: round.token_symbol, winningNumber, winCount, lossCount };
      })();

      res.json(summary);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to declare winning number.' });
    }
  }));

  app.post('/api/admin/lucky-draw/execute', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    try {
      const requestedNumber =
        typeof req.body?.winning_ticket_number === 'string' ? req.body.winning_ticket_number : undefined;
      const result = await executeQuarterlyJackpotDraw(requestedNumber);
      await recordAdminAuditLog({
        req,
        actionType: 'JACKPOT_DRAW_EXECUTE',
        targetType: 'JACKPOT',
        targetId: result.drawId,
        summary: `Executed ${result.quarterLabel} Jackpot${
          result.winningTicketNumber ? ` (Winning Ticket #${result.winningTicketNumber})` : ''
        } — Winner ${result.winnerName} ($${result.prizePool.toFixed(2)}), opened ${result.nextQuarterLabel}`,
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Quarterly Jackpot draw failed' });
    }
  }));

  // ---------------------------------------------------------------------------
  // 9. USER-TO-ADMIN SUPPORT CHAT CENTER (REAL-TIME WEBSOCKETS + DB)
  // ---------------------------------------------------------------------------

  const SUPPORT_CATEGORIES = new Set(['GENERAL', 'DEPOSIT_WITHDRAW', 'P2P_DISPUTE', 'ACCOUNT_KYC', 'TRADING']);

  const getEnrichedSupportThread = async (threadId: string) => {
    return (await db
      .prepare(`
        SELECT
          t.*,
          u.full_name as user_name,
          u.email as user_email,
          u.uid as user_uid,
          u.avatar_url as user_avatar_url,
          u.kyc_status as user_kyc_status,
          u.main_balance as user_main_balance,
          (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) as message_count
        FROM support_threads t
        JOIN users u ON t.user_id = u.id
        WHERE t.id = ?
      `)
      .get(threadId)) as any;
  };

  const insertSupportMessage = async (params: {
    threadId: string;
    senderId: string | null;
    senderRole: 'USER' | 'ADMIN' | 'SYSTEM';
    body: string;
    attachmentData?: string | null;
  }) => {
    const msgId = generateId('SUPM');
    const createdAt = new Date().toISOString();
    await db.prepare(`
      INSERT INTO support_messages (id, thread_id, sender_id, sender_role, body, attachment_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      msgId,
      params.threadId,
      params.senderId,
      params.senderRole,
      params.body,
      params.attachmentData || null,
      createdAt
    );
    return (await db
      .prepare(`
        SELECT m.*, u.full_name as sender_name
        FROM support_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `)
      .get(msgId)) as any;
  };

  const broadcastSupportEvent = (
    thread: any,
    type: 'SUPPORT_THREAD_CREATED' | 'SUPPORT_THREAD_UPDATED' | 'SUPPORT_CHAT_MESSAGE',
    message?: any
  ) => {
    const frame = message
      ? { type, threadId: thread.id, thread, message }
      : { type, threadId: thread.id, thread };
    pushToUser(thread.user_id, frame);
    pushToAdmins(frame);
  };

  app.get('/api/support/threads', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const threads = (await db
      .prepare(`
        SELECT
          t.*,
          u.full_name as user_name,
          u.email as user_email,
          u.uid as user_uid,
          u.avatar_url as user_avatar_url,
          u.kyc_status as user_kyc_status,
          u.main_balance as user_main_balance,
          (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) as message_count
        FROM support_threads t
        JOIN users u ON t.user_id = u.id
        WHERE t.user_id = ?
        ORDER BY t.updated_at DESC
      `)
      .all(userId)) as any[];

    const unreadCount = threads.reduce((sum, t) => sum + Number(t.user_unread || 0), 0);
    res.json({ threads, unreadCount });
  }));

  app.post('/api/support/threads', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const { subject, category, initial_message, attachment_data } = req.body || {};
    const cleanSubject = String(subject || '').trim().slice(0, 120) || 'Support Inquiry';
    const cleanCategory = SUPPORT_CATEGORIES.has(String(category || '').toUpperCase())
      ? String(category).toUpperCase()
      : 'GENERAL';
    const cleanInitial = String(initial_message || '').trim().slice(0, 2000);
    let cleanAttach: string | null = null;
    if (attachment_data !== undefined && attachment_data !== null && attachment_data !== '') {
      const attStr = String(attachment_data);
      if (!RASTER_IMAGE_DATA_URL_RE.test(attStr)) {
        res.status(400).json({ error: 'Attachment must be a valid PNG, JPG, GIF, or WebP image.' });
        return;
      }
      if (attStr.length > 2_200_000) {
        res.status(400).json({ error: 'Attachment exceeds 2MB size limit.' });
        return;
      }
      cleanAttach = await uploadImageAsset(attStr, 'support', userId);
    }

    const threadId = await generateShortTicketId();
    const now = new Date().toISOString();
    const lastPreview = cleanInitial || (cleanAttach ? '[Screenshot attached]' : 'Conversation started');

    const created = await db.transaction(async () => {
      await db.prepare(`
        INSERT INTO support_threads (
          id, user_id, subject, category, status, user_unread, admin_unread,
          last_message, last_message_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'OPEN', 0, ?, ?, ?, ?, ?)
      `).run(
        threadId,
        userId,
        cleanSubject,
        cleanCategory,
        cleanInitial || cleanAttach ? 1 : 0,
        lastPreview,
        now,
        now,
        now
      );

      await insertSupportMessage({
        threadId,
        senderId: null,
        senderRole: 'SYSTEM',
        body: `Support ticket ${threadId} opened (${cleanCategory.replace(/_/g, ' ')}). A support administrator will respond shortly.`,
      });

      let firstMsg: any = null;
      if (cleanInitial || cleanAttach) {
        firstMsg = await insertSupportMessage({
          threadId,
          senderId: userId,
          senderRole: 'USER',
          body: cleanInitial || 'Attached payment/account screenshot.',
          attachmentData: cleanAttach,
        });
      }

      const enriched = await getEnrichedSupportThread(threadId);
      return { enriched, firstMsg };
    })();

    broadcastSupportEvent(created.enriched, 'SUPPORT_THREAD_CREATED', created.firstMsg || undefined);
    res.json({ thread: created.enriched, message: created.firstMsg });
  }));

  app.get('/api/admin/support/threads', requireAdmin, ah(async (_req, res) => {
    const threads = (await db
      .prepare(`
        SELECT
          t.*,
          u.full_name as user_name,
          u.email as user_email,
          u.uid as user_uid,
          u.avatar_url as user_avatar_url,
          u.kyc_status as user_kyc_status,
          u.main_balance as user_main_balance,
          (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) as message_count
        FROM support_threads t
        JOIN users u ON t.user_id = u.id
        ORDER BY CASE WHEN t.admin_unread > 0 THEN 0 ELSE 1 END, t.updated_at DESC
      `)
      .all()) as any[];

    const unreadCount = threads.reduce((sum, t) => sum + Number(t.admin_unread || 0), 0);
    res.json({ threads, unreadCount });
  }));

  app.post('/api/admin/support/threads', requireAdmin, ah(async (req: AuthenticatedRequest, res) => {
    const adminId = req.auth!.userId;
    const { user_id, subject, category, initial_message } = req.body || {};
    if (!user_id) {
      res.status(400).json({ error: 'Target user_id is required.' });
      return;
    }
    const targetUser = (await db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(String(user_id))) as
      | { id: string; full_name: string }
      | undefined;
    if (!targetUser) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const cleanSubject = String(subject || '').trim().slice(0, 120) || 'Message from Nepefy Support';
    const cleanCategory = SUPPORT_CATEGORIES.has(String(category || '').toUpperCase())
      ? String(category).toUpperCase()
      : 'GENERAL';
    const cleanInitial = String(initial_message || '').trim().slice(0, 2000);

    const threadId = await generateShortTicketId();
    const now = new Date().toISOString();

    const created = await db.transaction(async () => {
      await db.prepare(`
        INSERT INTO support_threads (
          id, user_id, subject, category, status, user_unread, admin_unread,
          last_message, last_message_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'OPEN', ?, 0, ?, ?, ?, ?)
      `).run(
        threadId,
        targetUser.id,
        cleanSubject,
        cleanCategory,
        cleanInitial ? 1 : 0,
        cleanInitial || 'Support administrator opened this conversation.',
        now,
        now,
        now
      );

      await insertSupportMessage({
        threadId,
        senderId: null,
        senderRole: 'SYSTEM',
        body: `Direct support conversation ${threadId} initiated by Nepefy Admin.`,
      });

      let firstMsg: any = null;
      if (cleanInitial) {
        firstMsg = await insertSupportMessage({
          threadId,
          senderId: adminId,
          senderRole: 'ADMIN',
          body: cleanInitial,
        });
      }

      const enriched = await getEnrichedSupportThread(threadId);
      return { enriched, firstMsg };
    })();

    broadcastSupportEvent(created.enriched, 'SUPPORT_THREAD_CREATED', created.firstMsg || undefined);
    res.json({ thread: created.enriched, message: created.firstMsg });
  }));

  app.get('/api/support/threads/:id/messages', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const thread = await getEnrichedSupportThread(req.params.id);

    if (!thread) {
      res.status(404).json({ error: 'Support conversation not found.' });
      return;
    }
    if (thread.user_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'Access denied to this support conversation.' });
      return;
    }

    let clearedUnread = false;
    if (isAdmin && thread.user_id !== userId) {
      if (Number(thread.admin_unread || 0) > 0) {
        await db.prepare('UPDATE support_threads SET admin_unread = 0 WHERE id = ?').run(thread.id);
        clearedUnread = true;
      }
    } else if (Number(thread.user_unread || 0) > 0) {
      await db.prepare('UPDATE support_threads SET user_unread = 0 WHERE id = ?').run(thread.id);
      clearedUnread = true;
    }

    const updatedThread = clearedUnread ? await getEnrichedSupportThread(thread.id) : thread;
    const messages = await db
      .prepare(`
        SELECT m.*, u.full_name as sender_name
        FROM support_messages m
        LEFT JOIN users u ON m.sender_id = u.id
        WHERE m.thread_id = ?
        ORDER BY m.created_at ASC
      `)
      .all(thread.id);

    if (clearedUnread) {
      broadcastSupportEvent(updatedThread, 'SUPPORT_THREAD_UPDATED');
    }

    res.json({ thread: updatedThread, messages });
  }));

  app.post('/api/support/threads/:id/messages', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const thread = await getEnrichedSupportThread(req.params.id);

    if (!thread) {
      res.status(404).json({ error: 'Support conversation not found.' });
      return;
    }
    if (thread.user_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'Access denied to this support conversation.' });
      return;
    }

    const { body, attachment_data } = req.body || {};
    const cleanBody = String(body || '').trim().slice(0, 2000);
    let cleanAttach: string | null = null;
    if (attachment_data !== undefined && attachment_data !== null && attachment_data !== '') {
      const attStr = String(attachment_data);
      if (!RASTER_IMAGE_DATA_URL_RE.test(attStr)) {
        res.status(400).json({ error: 'Attachment must be a valid PNG, JPG, GIF, or WebP image.' });
        return;
      }
      if (attStr.length > 2_200_000) {
        res.status(400).json({ error: 'Attachment exceeds 2MB size limit.' });
        return;
      }
      cleanAttach = await uploadImageAsset(attStr, 'support', userId);
    }

    if (!cleanBody && !cleanAttach) {
      res.status(400).json({ error: 'Message text or image attachment is required.' });
      return;
    }

    const actingAsAdmin = isAdmin && thread.user_id !== userId;
    const senderRole: 'USER' | 'ADMIN' = actingAsAdmin ? 'ADMIN' : 'USER';
    const now = new Date().toISOString();
    const displayBody = cleanBody || 'Attached screenshot';

    const result = await db.transaction(async () => {
      const msg = await insertSupportMessage({
        threadId: thread.id,
        senderId: userId,
        senderRole,
        body: displayBody,
        attachmentData: cleanAttach,
      });

      if (actingAsAdmin) {
        await db.prepare(`
          UPDATE support_threads
          SET user_unread = user_unread + 1,
              admin_unread = 0,
              last_message = ?,
              last_message_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(displayBody, now, now, thread.id);
      } else {
        await db.prepare(`
          UPDATE support_threads
          SET status = 'OPEN',
              admin_unread = admin_unread + 1,
              user_unread = 0,
              last_message = ?,
              last_message_at = ?,
              updated_at = ?
          WHERE id = ?
        `).run(displayBody, now, now, thread.id);
      }

      const updatedThread = await getEnrichedSupportThread(thread.id);
      return { msg, updatedThread };
    })();

    broadcastSupportEvent(result.updatedThread, 'SUPPORT_CHAT_MESSAGE', result.msg);
    res.json({ thread: result.updatedThread, message: result.msg });
  }));

  app.post('/api/support/threads/:id/read', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const thread = await getEnrichedSupportThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Support conversation not found.' });
      return;
    }
    if (thread.user_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    if (isAdmin && thread.user_id !== userId) {
      await db.prepare('UPDATE support_threads SET admin_unread = 0 WHERE id = ?').run(thread.id);
    } else {
      await db.prepare('UPDATE support_threads SET user_unread = 0 WHERE id = ?').run(thread.id);
    }

    const updated = await getEnrichedSupportThread(thread.id);
    broadcastSupportEvent(updated, 'SUPPORT_THREAD_UPDATED');
    res.json({ thread: updated });
  }));

  app.post('/api/support/threads/:id/status', requireAuth, ah(async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.userId;
    const isAdmin = req.auth!.role === 'ADMIN';
    const { status } = req.body || {};
    const nextStatus = String(status || '').toUpperCase() === 'RESOLVED' ? 'RESOLVED' : 'OPEN';

    const thread = await getEnrichedSupportThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Support conversation not found.' });
      return;
    }
    if (thread.user_id !== userId && !isAdmin) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }

    if (thread.status === nextStatus) {
      res.json({ thread });
      return;
    }

    const now = new Date().toISOString();
    const actorLabel = isAdmin && thread.user_id !== userId ? 'Support Admin' : 'User';
    const sysBody =
      nextStatus === 'RESOLVED'
        ? `Conversation marked as RESOLVED by ${actorLabel}.`
        : `Conversation reopened by ${actorLabel}.`;

    const result = await db.transaction(async () => {
      await db.prepare(`
        UPDATE support_threads
        SET status = ?, last_message = ?, last_message_at = ?, updated_at = ?
        WHERE id = ?
      `).run(nextStatus, sysBody, now, now, thread.id);

      const sysMsg = await insertSupportMessage({
        threadId: thread.id,
        senderId: null,
        senderRole: 'SYSTEM',
        body: sysBody,
      });

      const updated = await getEnrichedSupportThread(thread.id);
      return { updated, sysMsg };
    })();

    broadcastSupportEvent(result.updated, 'SUPPORT_CHAT_MESSAGE', result.sysMsg);
    broadcastSupportEvent(result.updated, 'SUPPORT_THREAD_UPDATED');
    res.json({ thread: result.updated, message: result.sysMsg });
  }));

  // Sync daily staking accruals into users.profit_balance globally every 60s
  // (daily profits accumulate visibly in profit_balance, locked until each 30-day cycle unlocks)
  syncStakingDailyProfits().catch(() => {});
  processOverdueJackpotDraws().catch(() => {});
  setInterval(() => {
    processOverdueJackpotDraws().catch(() => {});
  }, 60_000);
  setInterval(() => {
    syncStakingDailyProfits().catch(() => {});
  }, 60_000);

  // Unmatched /api/* routes return JSON 404 instead of SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Global error handler — never expose internal stack traces in production
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
    if (status >= 500) {
      console.error('[server error]', err?.message || err);
    }
    res.status(status).json({
      error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : err?.message || 'Request failed',
    });
  });

  // ---------------------------------------------------------------------------
  // VITE DEV / PROD STATIC SERVING
  // ---------------------------------------------------------------------------

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patched = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled in proxy preview */'
          )
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;'
          );
        res.setHeader('Cache-Control', 'no-store');
        res.type('application/javascript').send(patched);
      } catch {
        next();
      }
    });
    app.get('/@vite-plugin-pwa/pwa-entry-point-loaded', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/javascript').send('export default function registerDevSW() {}\n');
    });
    app.get(['/dev-sw.js', '/sw.js'], (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/javascript').send(
        `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .catch(() => {})
  );
});
`
      );
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const indexHtmlPath = path.join(distPath, 'index.html');
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      if (!fs.existsSync(indexHtmlPath)) {
        res.status(503).json({ error: 'Production frontend build is missing. Run npm run build before starting.' });
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtmlPath);
    });
  }

  server.on('error', (err: any) => {
    console.error('[http server error]', err?.message || err);
    if (err?.code === 'EADDRINUSE') {
      process.exit(1);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    const dbMode = getDatabaseMode();
    const storageMode = isSupabaseStorageConfigured() ? 'supabase' : 'inline';
    const emailReady = isEmailProviderConfigured() ? 'configured' : 'unconfigured';
    const jwtReady = Boolean(process.env.JWT_SECRET?.trim() && process.env.JWT_SECRET.trim().length >= 16)
      ? 'env'
      : 'ephemeral-memory';
    console.log(
      `Nepefy full-stack server running at http://localhost:${PORT} [env=${process.env.NODE_ENV || 'development'} db=${dbMode} storage=${storageMode} email=${emailReady} jwt=${jwtReady}]`
    );
  });

  const gracefulShutdown = () => {
    db.close().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.once('SIGTERM', gracefulShutdown);
  process.once('SIGINT', gracefulShutdown);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
