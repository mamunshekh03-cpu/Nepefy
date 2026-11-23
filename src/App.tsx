import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Users,
  TrendingUp,
  Layers,
  Sparkles,
  Trophy,
  Gift,
  LogOut,
  Menu,
  X,
  ChevronUp,
  BellRing,
  User as UserIcon,
  CreditCard,
  Lock,
  ShieldCheck,
  Headphones,
  AlertTriangle,
  Send,
  Scale,
  FileText,
  Settings,
  Home,
  Wallet as WalletIcon,
  Compass,
} from 'lucide-react';
import { apiFetch, formatUsd, getStoredToken, setStoredToken } from './lib/api';
import { formatFiatAmount } from './lib/currencies';
import type { CoinHolding, LedgerEntry, MarketPair, P2POrder, PlatformSettings, SupportLiveSignal, UserNotification, UserProfile } from './types';
import { HomePage } from './components/HomePage';
import type { P2PLiveSignal } from './components/P2POrderRoomModal';
import type { ProfileTab } from './components/ProfileView';
import { LegalDocsModal, type LegalDocTab } from './components/LegalDocsModal';
import { NepefyLogo, NepefyMark } from './components/NepefyLogo';
import { LiveCoinTicker } from './components/LiveCoinTicker';
import { NotificationBell } from './components/NotificationBell';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { playNotificationSound } from './lib/sound';

import type { AdminNavBadgeMap, AdminTab } from './components/admin/adminTypes';

const LoginPage = lazy(() => import('./components/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./components/SignupPage').then((m) => ({ default: m.SignupPage })));
const OverviewView = lazy(() => import('./components/OverviewView').then((m) => ({ default: m.OverviewView })));
const WalletFundingView = lazy(() => import('./components/WalletFundingView').then((m) => ({ default: m.WalletFundingView })));
const P2PSendView = lazy(() => import('./components/P2PSendView').then((m) => ({ default: m.P2PSendView })));
const SpotTradingView = lazy(() => import('./components/SpotTradingView').then((m) => ({ default: m.SpotTradingView })));
const StakingView = lazy(() => import('./components/StakingView').then((m) => ({ default: m.StakingView })));
const PresaleView = lazy(() => import('./components/PresaleView').then((m) => ({ default: m.PresaleView })));
const JackpotView = lazy(() => import('./components/JackpotView').then((m) => ({ default: m.JackpotView })));
const ReferralRewardsView = lazy(() => import('./components/ReferralRewardsView').then((m) => ({ default: m.ReferralRewardsView })));
const ProfileView = lazy(() => import('./components/ProfileView').then((m) => ({ default: m.ProfileView })));
const AdminConsoleView = lazy(() => import('./components/AdminConsoleView').then((m) => ({ default: m.AdminConsoleView })));
const SupportChatCenter = lazy(() => import('./components/SupportChatCenter').then((m) => ({ default: m.SupportChatCenter })));

type NavKey = 'overview' | 'funding' | 'p2p' | 'spot' | 'staking' | 'presale' | 'rewards' | 'referrals' | 'support' | 'profile' | 'admin';

const NAV_ITEMS: { key: NavKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'funding', label: 'Wallet', icon: ArrowLeftRight },
  { key: 'p2p', label: 'P2P Market', icon: Users },
  { key: 'spot', label: 'Spot Trading', icon: TrendingUp },
  { key: 'staking', label: 'Staking Vaults', icon: Layers },
  { key: 'presale', label: 'Coin Presale', icon: Sparkles },
  { key: 'rewards', label: 'Jackpot', icon: Trophy },
  { key: 'referrals', label: 'Referral Rewards', icon: Gift },
  { key: 'support', label: 'Support Chat', icon: Headphones },
];

const ADMIN_NAV_GROUPS: {
  category: string;
  items: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[];
}[] = [
  {
    category: 'Overview',
    items: [{ id: 'DASHBOARD', label: 'Executive Dashboard', icon: LayoutDashboard }],
  },
  {
    category: 'Accounts & Treasury',
    items: [
      { id: 'USERS', label: 'Users & KYC', icon: Users },
      { id: 'DEPOSITS', label: 'Deposits', icon: ArrowDownLeft },
      { id: 'WITHDRAWALS', label: 'Withdrawals', icon: ArrowUpRight },
      { id: 'SEND', label: 'Send & Transfers', icon: Send },
    ],
  },
  {
    category: 'Markets & Products',
    items: [
      { id: 'P2P', label: 'P2P Escrow', icon: Scale },
      { id: 'SPOT', label: 'Spot Markets', icon: TrendingUp },
      { id: 'STAKING', label: 'Staking Vault', icon: Layers },
      { id: 'PRESALE', label: 'Coin Presale', icon: Sparkles },
    ],
  },
  {
    category: 'Growth & Audit',
    items: [
      { id: 'REWARDS', label: 'Jackpot & Referrals', icon: Trophy },
      { id: 'SUPPORT', label: 'Support Chat', icon: Headphones },
      { id: 'TRANSACTIONS', label: 'Financial Ledger', icon: FileText },
      { id: 'AUDIT_LOGS', label: 'Admin Audit Logs', icon: ShieldCheck },
      { id: 'SETTINGS', label: 'System Settings', icon: Settings },
    ],
  },
];

export default function App() {
  const initialPath = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : '/';
  const hasReferralParam =
    typeof window !== 'undefined' && Boolean(new URLSearchParams(window.location.search).get('ref')?.trim());
  const initialGuestView: 'HOME' | 'LOGIN' | 'SIGNUP' =
    hasReferralParam || initialPath === '/signup'
      ? 'SIGNUP'
      : initialPath === '/login'
      ? 'LOGIN'
      : 'HOME';
  const [guestView, setGuestView] = useState<'HOME' | 'LOGIN' | 'SIGNUP'>(initialGuestView);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [holdings, setHoldings] = useState<CoinHolding[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [markets, setMarkets] = useState<MarketPair[]>([]);
  const [booting, setBooting] = useState(true);
  const [activeTab, setActiveTab] = useState<NavKey>('overview');
  const [adminTab, setAdminTab] = useState<AdminTab>('DASHBOARD');
  const [adminBadges, setAdminBadges] = useState<AdminNavBadgeMap>({});
  const [profileSubTab, setProfileSubTab] = useState<ProfileTab>('PERSONAL');
  const [spotSelectedSymbol, setSpotSelectedSymbol] = useState<string>('BTC/USDT');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileDiscoverOpen, setMobileDiscoverOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [p2pSignal, setP2pSignal] = useState<P2PLiveSignal | null>(null);
  const [supportSignal, setSupportSignal] = useState<SupportLiveSignal | null>(null);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);
  const [supportAlert, setSupportAlert] = useState<{
    title: string;
    detail: string;
  } | null>(null);
  const [focusP2pOrderId, setFocusP2pOrderId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [publicSettings, setPublicSettings] = useState<PlatformSettings | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalDocTab>('TERMS');
  const [p2pAlert, setP2pAlert] = useState<{
    orderId: string;
    title: string;
    detail: string;
    ctaLabel: string;
    urgent: boolean;
  } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const desktopUserMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const currentUserRoleRef = useRef<string | null>(null);
  const activeTabRef = useRef<NavKey>('overview');
  const adminTabRef = useRef<AdminTab>('DASHBOARD');
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastAuxFeedsLoadedUserRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserIdRef.current = user?.id || null;
    currentUserRoleRef.current = user?.role || null;
  }, [user?.id, user?.role]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    adminTabRef.current = adminTab;
  }, [adminTab]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktop = desktopUserMenuRef.current?.contains(target);
      const inMobile = mobileUserMenuRef.current?.contains(target);
      if (!inDesktop && !inMobile) {
        setUserMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!getStoredToken()) {
      setUser(null);
      setBooting(false);
      lastAuxFeedsLoadedUserRef.current = null;
      return;
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    const task = (async () => {
      try {
        const res = await apiFetch<{ user: UserProfile; holdings: CoinHolding[]; ledger: LedgerEntry[] }>('/api/auth/me');
        setUser(res.user);
        if (res.user.role === 'ADMIN') {
          setActiveTab((prev) => (prev === 'profile' ? 'profile' : 'admin'));
        }
        setHoldings(res.holdings);
        setLedger(res.ledger);
        if (lastAuxFeedsLoadedUserRef.current !== res.user.id) {
          lastAuxFeedsLoadedUserRef.current = res.user.id;
          const supportEndpoint = res.user.role === 'ADMIN' ? '/api/admin/support/threads' : '/api/support/threads';
          apiFetch<{ unreadCount?: number }>(supportEndpoint)
            .then((sRes) => {
              setSupportUnreadCount(Number(sRes?.unreadCount || 0));
            })
            .catch(() => {});
          apiFetch<{ notifications?: UserNotification[]; unreadCount?: number }>('/api/notifications')
            .then((nRes) => {
              setNotifications(Array.isArray(nRes?.notifications) ? nRes.notifications : []);
              setNotifUnreadCount(Number(nRes?.unreadCount || 0));
            })
            .catch(() => {});
        }
      } catch {
        setStoredToken(null);
        setUser(null);
        lastAuxFeedsLoadedUserRef.current = null;
      } finally {
        setBooting(false);
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    refreshProfile();
    apiFetch<{ pairs: MarketPair[] }>('/api/markets')
      .then((res) => setMarkets(res.pairs))
      .catch(() => {});
    apiFetch<{ settings: PlatformSettings }>('/api/public/settings')
      .then((res) => setPublicSettings(res.settings))
      .catch(() => {});
  }, [refreshProfile]);

  // Live WebSocket subscription for spot prices & real-time P2P Escrow/Chat events
  useEffect(() => {
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let seq = 0;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const token = getStoredToken();
      const wsUrl = token
        ? `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
        : `${proto}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'MARKET_SNAPSHOT' && Array.isArray(msg.pairs)) {
            setMarkets(msg.pairs);
            return;
          }

          if (
            msg.type === 'P2P_ORDER_CREATED' ||
            msg.type === 'P2P_RELEASE_REQUEST' ||
            msg.type === 'P2P_ORDER_UPDATED' ||
            msg.type === 'P2P_CHAT_MESSAGE'
          ) {
            seq += 1;
            setP2pSignal({
              seq,
              type: msg.type,
              orderId: msg.orderId || msg.order?.id,
              order: msg.order,
              message: msg.message,
            });

            const uid = currentUserIdRef.current;
            const ord = msg.order as P2POrder | undefined;

            if (msg.type === 'P2P_RELEASE_REQUEST' && ord && uid && ord.seller_id === uid) {
              const cur = String(ord.fiat_currency || 'USD').toUpperCase();
              setP2pAlert({
                orderId: ord.id,
                title: `Release USDT Request — Order ${ord.id}`,
                detail: `${ord.buyer_name} marked ${formatFiatAmount(ord.fiat_total, cur)} ${cur} (${ord.payment_method}) as PAID (Ref: ${ord.payment_reference || 'Paid'}). Verify receipt & release ${formatUsd(ord.amount_vusd)} USDT.`,
                ctaLabel: 'Open Order & Release USDT',
                urgent: true,
              });
            } else if (msg.type === 'P2P_ORDER_CREATED' && ord && uid && ord.seller_id === uid) {
              const cur = String(ord.fiat_currency || 'USD').toUpperCase();
              setP2pAlert({
                orderId: ord.id,
                title: `New P2P Buy Order — ${ord.id}`,
                detail: `${ord.buyer_name} wants to buy ${formatUsd(ord.amount_vusd)} USDT (${formatFiatAmount(ord.fiat_total, cur)} ${cur}). Escrow locked — open chat to coordinate payment.`,
                ctaLabel: 'Open Order Chat',
                urgent: false,
              });
              refreshProfile().catch(() => {});
            } else if (msg.type === 'P2P_ORDER_UPDATED' && ord && uid) {
              refreshProfile().catch(() => {});
              if (ord.status === 'COMPLETED' && ord.buyer_id === uid) {
                setP2pAlert({
                  orderId: ord.id,
                  title: `USDT Released — Order ${ord.id}`,
                  detail: `${ord.seller_name} released ${formatUsd(ord.amount_vusd)} USDT into your Main Balance.`,
                  ctaLabel: 'View Order',
                  urgent: false,
                });
              }
            } else if (
              msg.type === 'P2P_CHAT_MESSAGE' &&
              msg.message &&
              uid &&
              msg.message.sender_id &&
              msg.message.sender_id !== uid
            ) {
                setP2pAlert({
                  orderId: msg.orderId,
                  title: `New P2P Message from ${msg.message.sender_name || 'Counterparty'}`,
                  detail: msg.message.body || 'Sent a payment receipt image.',
                  ctaLabel: 'Reply in Order Chat',
                  urgent: false,
                });
            }
          }

          if (
            msg.type === 'SUPPORT_THREAD_CREATED' ||
            msg.type === 'SUPPORT_THREAD_UPDATED' ||
            msg.type === 'SUPPORT_CHAT_MESSAGE'
          ) {
            seq += 1;
            setSupportSignal({
              seq,
              type: msg.type,
              threadId: msg.threadId || msg.thread?.id,
              thread: msg.thread,
              message: msg.message,
            });

            const role = currentUserRoleRef.current;
            const uid = currentUserIdRef.current;
            const endpoint = role === 'ADMIN' ? '/api/admin/support/threads' : '/api/support/threads';
            if (uid) {
              apiFetch<{ unreadCount?: number }>(endpoint)
                .then((sRes) => setSupportUnreadCount(Number(sRes?.unreadCount || 0)))
                .catch(() => {});
            }

            const isViewingSupport =
              activeTabRef.current === 'support' ||
              (role === 'ADMIN' && activeTabRef.current === 'admin' && adminTabRef.current === 'SUPPORT');

            if (
              msg.type === 'SUPPORT_CHAT_MESSAGE' &&
              msg.message &&
              uid &&
              msg.message.sender_id !== uid &&
              msg.message.sender_role !== 'SYSTEM' &&
              !isViewingSupport
            ) {
              setSupportAlert({
                title:
                  msg.message.sender_role === 'ADMIN'
                    ? 'New Reply from Nepefy Support Admin'
                    : `Support Message from ${msg.message.sender_name || msg.thread?.user_name || 'User'}`,
                detail: msg.message.body || 'Sent an attachment.',
              });
              playNotificationSound('info');
            }
          }
          if (msg.type === 'NOTIFICATION_NEW' && msg.notification) {
            const incoming = msg.notification as UserNotification;
            setNotifications((prev) => {
              const exists = prev.some((n) => n.id === incoming.id);
              if (!exists && incoming.is_read === 0) {
                setNotifUnreadCount((c) => c + 1);
              }
              return [incoming, ...prev.filter((n) => n.id !== incoming.id)].slice(0, 40);
            });
            playNotificationSound(
              incoming.category === 'SECURITY' ? 'alert' : incoming.category === 'FUNDING' || incoming.category === 'STAKING' || incoming.category === 'REWARDS' ? 'success' : 'info'
            );
            if (['FUNDING', 'STAKING', 'REWARDS', 'TRADING', 'KYC'].includes(incoming.category)) {
              refreshProfile().catch(() => {});
            }
            return;
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [refreshProfile]);

  // Authenticate existing WebSocket immediately when user logs in
  useEffect(() => {
    const token = getStoredToken();
    if (user && token && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'AUTH', token }));
    }
  }, [user?.id]);

  const navigateGuestView = useCallback((view: 'HOME' | 'LOGIN' | 'SIGNUP') => {
    setGuestView(view);
    if (typeof window !== 'undefined') {
      const targetPath = view === 'LOGIN' ? '/login' : view === 'SIGNUP' ? '/signup' : '/';
      const search = view === 'SIGNUP' ? window.location.search : '';
      window.history.replaceState(null, '', `${targetPath}${search}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const handleAuthenticated = async (loggedInUser: UserProfile) => {
    setUser(loggedInUser);
    setActiveTab(loggedInUser.role === 'ADMIN' ? 'admin' : 'overview');
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    await refreshProfile();
  };

  const handleLogout = () => {
    const token = getStoredToken();
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    }
    setUserMenuOpen(false);
    setStoredToken(null);
    setUser(null);
    lastAuxFeedsLoadedUserRef.current = null;
    setNotifications([]);
    setNotifUnreadCount(0);
    setActiveTab('overview');
    setAdminTab('DASHBOARD');
    setAdminBadges({});
    navigateGuestView('HOME');
  };

  const refreshNotifications = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const nRes = await apiFetch<{ notifications?: UserNotification[]; unreadCount?: number }>('/api/notifications');
      setNotifications(Array.isArray(nRes?.notifications) ? nRes.notifications : []);
      setNotifUnreadCount(Number(nRes?.unreadCount || 0));
    } catch {
      // ignore transient poll error
    }
  }, []);

  const handleMarkNotificationsRead = async (id?: string) => {
    const res = await apiFetch<{ unreadCount: number }>('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify(id ? { id } : {}),
    });
    setNotifications((prev) =>
      prev.map((n) => (id ? (n.id === id ? { ...n, is_read: 1 } : n) : { ...n, is_read: 1 }))
    );
    setNotifUnreadCount(Number(res.unreadCount || 0));
  };

  if (booting) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6">
        <NepefyLogo size="lg" loading />
        <p className="text-xs font-medium text-slate-500">Loading Nepefy workspace...</p>
      </div>
    );
  }

  if (!user) {
    if (guestView === 'HOME') {
      return (
        <HomePage
          markets={markets}
          publicSettings={publicSettings}
          onOpenAuth={(mode) => navigateGuestView(mode)}
        />
      );
    }
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-slate-50/70 flex flex-col items-center justify-center gap-3.5 px-6">
            <NepefyMark size={44} loading />
            <span className="text-xs font-medium text-slate-500">
              {guestView === 'SIGNUP' ? 'Loading sign up...' : 'Loading sign in...'}
            </span>
          </div>
        }
      >
        {guestView === 'SIGNUP' ? (
          <SignupPage
            onBackHome={() => navigateGuestView('HOME')}
            onGoLogin={() => navigateGuestView('LOGIN')}
            onAuthenticated={handleAuthenticated}
          />
        ) : (
          <LoginPage
            onBackHome={() => navigateGuestView('HOME')}
            onGoSignup={() => navigateGuestView('SIGNUP')}
            onAuthenticated={handleAuthenticated}
          />
        )}
      </Suspense>
    );
  }

  const isAdmin = user.role === 'ADMIN';

  const userInitials =
    user.full_name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || 'U';

  const renderSidebarProfileMenu = (
    menuRef: React.RefObject<HTMLDivElement | null>,
    closeDrawerOnSelect = false
  ) => (
    <div className="p-3 border-t border-slate-200 bg-white">
      <div className="relative" ref={menuRef}>
        {userMenuOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50"
          >
            <div className="p-3.5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-slate-700">{userInitials}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{user.full_name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{user.email}</div>
                </div>
              </div>
            </div>

            <div className="p-1.5 space-y-0.5">
              <div className="px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Profile &amp; Security
              </div>
              {(
                [
                  { key: 'PERSONAL', label: 'Personal Info', icon: UserIcon },
                  { key: 'PAYMENT', label: 'Payment Methods', icon: CreditCard },
                  { key: 'SECURITY', label: 'Password', icon: Lock },
                  { key: '2FA', label: '2FA Authenticator', icon: ShieldCheck },
                ] as const
              ).map((item) => {
                const ItemIcon = item.icon;
                const isActive = activeTab === 'profile' && profileSubTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileSubTab(item.key);
                      setActiveTab('profile');
                      setUserMenuOpen(false);
                      if (closeDrawerOnSelect) setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-xs font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <ItemIcon
                        className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`}
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.key === '2FA' && (
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                          user.two_fa_enabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {user.two_fa_enabled ? 'ON' : 'OFF'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="p-1.5 border-t border-slate-200">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  if (closeDrawerOnSelect) setMobileNavOpen(false);
                  handleLogout();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setUserMenuOpen((prev) => !prev)}
          aria-expanded={userMenuOpen}
          aria-haspopup="menu"
          className="w-full text-left px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors flex items-center justify-between gap-2.5"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg border border-slate-200 bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-bold text-slate-700">{userInitials}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate leading-tight">
                {user.full_name}
              </div>
              <div className="text-[11px] text-slate-500 truncate leading-tight mt-0.5 font-mono-tabular">
                UID: {user.uid || user.id}
              </div>
            </div>
          </div>
          <ChevronUp
            className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
              userMenuOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>
    </div>
  );

  const renderSidebarNavigation = (closeDrawerOnSelect: boolean) => {
    if (isAdmin) {
      return (
        <nav className="p-3.5 space-y-5 flex-1 overflow-y-auto">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.category} className="space-y-1">
              <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.category}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === 'admin' && adminTab === item.id;
                  const rawBadge = adminBadges[item.id];
                  const supportFallbackCount =
                    item.id === 'SUPPORT' ? rawBadge?.count ?? (supportUnreadCount > 0 ? supportUnreadCount : undefined) : rawBadge?.count;
                  const badgeCount = supportFallbackCount;
                  const isUrgent =
                    item.id === 'SUPPORT'
                      ? Boolean(badgeCount && badgeCount > 0)
                      : Boolean(rawBadge?.urgent);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setAdminTab(item.id);
                        setActiveTab('admin');
                        if (closeDrawerOnSelect) setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {badgeCount !== undefined && badgeCount > 0 && (
                        <span
                          className={
                            isUrgent
                              ? 'px-1.5 py-0.5 text-[11px] font-bold font-mono-tabular bg-blue-600 text-white rounded-md shrink-0'
                              : 'text-[11px] font-semibold font-mono-tabular text-slate-400 shrink-0'
                          }
                        >
                          {badgeCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      );
    }

    return (
      <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActiveTab(item.key);
                if (closeDrawerOnSelect) setMobileNavOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.key === 'support' && supportUnreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-bold font-mono-tabular bg-blue-600 text-white rounded-md shrink-0">
                  {supportUnreadCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 shrink-0 border-r border-slate-200 bg-white flex-col sticky top-0 h-screen">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between shrink-0">
          <NepefyLogo size="md" />
          {isAdmin && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
              Admin
            </span>
          )}
        </div>

        {renderSidebarNavigation(false)}

        {renderSidebarProfileMenu(desktopUserMenuRef, false)}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/30" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative w-64 max-w-full bg-white border-r border-slate-200 flex flex-col justify-between z-10 h-full">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <NepefyLogo size="sm" />
                  {isAdmin && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      Admin
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-900"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {renderSidebarNavigation(true)}
            </div>

            {renderSidebarProfileMenu(mobileUserMenuRef, true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 lg:h-16 border-b border-slate-200 bg-white px-3.5 sm:px-4 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 lg:hidden shrink-0">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg shrink-0"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setActiveTab(isAdmin ? 'admin' : 'overview')}
              className="flex items-center gap-2 shrink-0"
            >
              <NepefyLogo size="sm" />
            </button>
          </div>

          <div className="hidden lg:flex flex-1 min-w-0 items-center">
            <LiveCoinTicker
              markets={markets}
              onSelectCoin={(symbol) => {
                if (symbol) setSpotSelectedSymbol(symbol);
                if (isAdmin) {
                  setAdminTab('SPOT');
                  setActiveTab('admin');
                } else {
                  setActiveTab('spot');
                }
              }}
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton />

            <NotificationBell
              notifications={notifications}
              unreadCount={notifUnreadCount}
              onMarkRead={handleMarkNotificationsRead}
              onOpen={() => {
                refreshNotifications().catch(() => {});
              }}
              onNavigateTab={(t) => {
                if (isAdmin) {
                  const adminRouteMap: Record<string, AdminTab> = {
                    support: 'SUPPORT',
                    funding: 'DEPOSITS',
                    p2p: 'P2P',
                    staking: 'STAKING',
                    spot: 'SPOT',
                    rewards: 'REWARDS',
                    presale: 'PRESALE',
                  };
                  if (t === 'profile') {
                    setActiveTab('profile');
                  } else {
                    setAdminTab(adminRouteMap[t] || 'DASHBOARD');
                    setActiveTab('admin');
                  }
                } else {
                  setActiveTab(t as NavKey);
                }
              }}
            />

            <button
              type="button"
              onClick={() => {
                setProfileSubTab('PERSONAL');
                setActiveTab('profile');
              }}
              className="lg:hidden min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full shrink-0"
              aria-label="Open profile"
            >
              <span className="w-8 h-8 rounded-full border border-slate-200 bg-slate-100 overflow-hidden flex items-center justify-center">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[11px] font-bold text-slate-700">{userInitials}</span>
                )}
              </span>
            </button>
          </div>
        </header>

        {publicSettings?.maintenanceMode && user.role !== 'ADMIN' && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 lg:px-8 py-2.5 flex items-center gap-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <div>
              <span className="font-semibold">Scheduled Maintenance Mode: </span>
              <span>{publicSettings.maintenanceMessage}</span>
            </div>
          </div>
        )}

        {p2pAlert && (
          <div
            className={`border-b px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
              p2pAlert.urgent
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <BellRing
                className={`w-4 h-4 shrink-0 mt-0.5 ${p2pAlert.urgent ? 'text-emerald-700' : 'text-amber-700'}`}
              />
              <div className="min-w-0">
                <span className="font-semibold">{p2pAlert.title}: </span>
                <span className="opacity-90">{p2pAlert.detail}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (isAdmin) {
                    setAdminTab('P2P');
                    setActiveTab('admin');
                  } else {
                    setFocusP2pOrderId(p2pAlert.orderId);
                    setActiveTab('p2p');
                  }
                  setP2pAlert(null);
                }}
                className={`px-3 py-1.5 font-semibold rounded-lg text-white whitespace-nowrap ${
                  p2pAlert.urgent ? 'bg-[#0ECB81] hover:bg-[#0BB574]' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {p2pAlert.ctaLabel}
              </button>
              <button
                type="button"
                onClick={() => setP2pAlert(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {supportAlert && (
          <div className="border-b px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 text-xs bg-blue-50 border-blue-200 text-blue-950">
            <div className="flex items-start gap-2.5 min-w-0">
              <Headphones className="w-4 h-4 shrink-0 mt-0.5 text-blue-700" />
              <div className="min-w-0">
                <span className="font-semibold">{supportAlert.title}: </span>
                <span className="opacity-90">{supportAlert.detail}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (isAdmin) {
                    setAdminTab('SUPPORT');
                    setActiveTab('admin');
                  } else {
                    setActiveTab('support');
                  }
                  setSupportAlert(null);
                }}
                className="px-3 py-1.5 font-semibold rounded-lg text-white bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
              >
                Open Support Chat
              </button>
              <button
                type="button"
                onClick={() => setSupportAlert(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded"
                aria-label="Dismiss support notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main
          className={`flex-1 w-full mx-auto ${
            !isAdmin ? 'pb-24 lg:pb-6' : 'pb-6'
          } ${
            !isAdmin && activeTab === 'spot'
              ? 'px-3.5 sm:px-4 lg:px-6 pt-3.5 lg:py-5 max-w-[1440px]'
              : isAdmin || activeTab === 'admin'
              ? 'px-4 sm:px-6 lg:px-8 pt-4 lg:py-6 max-w-[1440px]'
              : 'px-3.5 sm:px-6 lg:px-10 pt-3.5 lg:py-6 max-w-7xl'
          }`}
        >
          <Suspense
            fallback={
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-xs font-medium text-slate-500">
                <NepefyMark size={40} loading />
                <span>Loading module...</span>
              </div>
            }
          >
            {!isAdmin && activeTab === 'overview' && (
              <OverviewView
                user={user}
                holdings={holdings}
                ledger={ledger}
                markets={markets}
                onRefresh={refreshProfile}
                onNavigate={(t, symbol) => {
                  if (t === 'profile') setProfileSubTab('PERSONAL');
                  if (symbol) setSpotSelectedSymbol(symbol);
                  setActiveTab(t as NavKey);
                }}
              />
            )}
            {!isAdmin && activeTab === 'funding' && (
              <WalletFundingView user={user} ledger={ledger} onRefresh={refreshProfile} />
            )}
            {!isAdmin && activeTab === 'p2p' && (
              <P2PSendView
                user={user}
                onRefresh={refreshProfile}
                liveSignal={p2pSignal}
                focusOrderId={focusP2pOrderId}
                onClearFocusOrder={() => setFocusP2pOrderId(null)}
                onOpenSupportChat={() => setActiveTab('support')}
              />
            )}
            {!isAdmin && activeTab === 'spot' && (
              <SpotTradingView
                user={user}
                markets={markets}
                initialSymbol={spotSelectedSymbol}
                onRefresh={refreshProfile}
                spotMakerFeePct={publicSettings?.spotMakerFeePct}
                spotTakerFeePct={publicSettings?.spotTakerFeePct}
              />
            )}
            {!isAdmin && activeTab === 'staking' && <StakingView user={user} onRefresh={refreshProfile} />}
            {!isAdmin && activeTab === 'presale' && <PresaleView user={user} onRefresh={refreshProfile} />}
            {!isAdmin && activeTab === 'rewards' && <JackpotView user={user} onRefreshUser={refreshProfile} />}
            {!isAdmin && activeTab === 'referrals' && <ReferralRewardsView user={user} onRefreshUser={refreshProfile} />}
            {!isAdmin && activeTab === 'support' && (
              <SupportChatCenter
                mode="USER"
                currentUser={user}
                liveSignal={supportSignal}
                onUnreadChange={setSupportUnreadCount}
              />
            )}
            {activeTab === 'profile' && (
              <ProfileView
                user={user}
                onRefreshUser={refreshProfile}
                activeSubTab={profileSubTab}
                onSubTabChange={setProfileSubTab}
              />
            )}
            {isAdmin && activeTab !== 'profile' && (
              <AdminConsoleView
                user={user}
                liveMarkets={markets}
                onRefreshUser={refreshProfile}
                supportSignal={supportSignal}
                onSupportUnreadChange={setSupportUnreadCount}
                activeTab={adminTab}
                onTabChange={setAdminTab}
                onBadgesChange={setAdminBadges}
              />
            )}
          </Suspense>
        </main>

        <footer className="hidden lg:flex border-t border-slate-200 px-6 lg:px-10 py-4 bg-white flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="inline-flex items-center gap-2.5">
            <NepefyMark size={24} />
            <span>Nepefy Exchange · Built for the Future</span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setLegalTab('TERMS');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('PRIVACY');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('RISK');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline"
            >
              Risk Disclosure
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('AML');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline"
            >
              AML &amp; KYC Policy
            </button>
          </div>
        </footer>
      </div>

      {!isAdmin && (
        <nav
          aria-label="Mobile bottom navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-5 items-center px-1 pb-[env(safe-area-inset-bottom)]"
        >
          {(
            [
              { key: 'overview', label: 'Home', icon: Home },
              { key: 'p2p', label: 'P2P', icon: Users },
              { key: 'spot', label: 'Trade', icon: ArrowLeftRight },
              { key: 'funding', label: 'Wallet', icon: WalletIcon },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key && !mobileDiscoverOpen;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setMobileDiscoverOpen(false);
                  setActiveTab(item.key);
                }}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
                  isActive ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-700'
                }`}
              >
                {isActive && (
                  <span className="absolute top-0 w-7 h-0.5 rounded-full bg-blue-600" aria-hidden="true" />
                )}
                <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="text-[10px] tracking-tight leading-none">{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setMobileDiscoverOpen((prev) => !prev)}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 transition-colors relative ${
              mobileDiscoverOpen || ['staking', 'presale', 'rewards', 'referrals', 'support', 'profile'].includes(activeTab)
                ? 'text-slate-900 font-semibold'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {(mobileDiscoverOpen || ['staking', 'presale', 'rewards', 'referrals', 'support', 'profile'].includes(activeTab)) && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-blue-600" aria-hidden="true" />
            )}
            <div className="relative">
              <Compass
                className={`w-5 h-5 ${
                  mobileDiscoverOpen || ['staking', 'presale', 'rewards', 'referrals', 'support', 'profile'].includes(activeTab)
                    ? 'text-blue-600'
                    : 'text-slate-400'
                }`}
              />
              {supportUnreadCount > 0 && (
                <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-blue-600" />
              )}
            </div>
            <span className="text-[10px] tracking-tight leading-none">Discover</span>
          </button>
        </nav>
      )}

      {!isAdmin && mobileDiscoverOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-end"
          onClick={() => setMobileDiscoverOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-white rounded-t-3xl border-t border-slate-200 px-5 pt-3 pb-7 space-y-5 max-h-[82vh] overflow-y-auto"
          >
            <div className="w-10 h-1.5 bg-slate-200 rounded-full mx-auto" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-full border border-slate-200 bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt={user.full_name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs font-bold text-slate-700">{userInitials}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{user.full_name}</div>
                  <div className="text-[11px] font-mono-tabular text-slate-500">UID: {user.uid || user.id}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileDiscoverOpen(false);
                  handleLogout();
                }}
                className="min-h-[40px] px-3 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-xl shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { key: 'staking', label: 'Staking', icon: Layers, tone: 'text-emerald-600 bg-emerald-50' },
                  { key: 'presale', label: 'Presale', icon: Sparkles, tone: 'text-violet-600 bg-violet-50' },
                  { key: 'rewards', label: 'Jackpot', icon: Trophy, tone: 'text-amber-600 bg-amber-50' },
                  { key: 'referrals', label: 'Referrals', icon: Gift, tone: 'text-blue-600 bg-blue-50' },
                  { key: 'support', label: 'Support', icon: Headphones, tone: 'text-sky-600 bg-sky-50' },
                  { key: 'profile', label: 'Profile', icon: ShieldCheck, tone: 'text-slate-700 bg-slate-100' },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      if (item.key === 'profile') setProfileSubTab('PERSONAL');
                      setActiveTab(item.key);
                      setMobileDiscoverOpen(false);
                    }}
                    className={`min-h-[76px] p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-colors relative ${
                      isActive ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center ${item.tone}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-xs font-semibold text-slate-800">{item.label}</span>
                    {item.key === 'support' && supportUnreadCount > 0 && (
                      <span className="absolute top-2 right-2 px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 text-white rounded-full leading-none">
                        {supportUnreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Nepefy Exchange</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMobileDiscoverOpen(false);
                    setLegalTab('TERMS');
                    setLegalOpen(true);
                  }}
                  className="hover:text-slate-900"
                >
                  Terms
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileDiscoverOpen(false);
                    setLegalTab('PRIVACY');
                    setLegalOpen(true);
                  }}
                  className="hover:text-slate-900"
                >
                  Privacy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileDiscoverOpen(false);
                    setLegalTab('RISK');
                    setLegalOpen(true);
                  }}
                  className="hover:text-slate-900"
                >
                  Risk
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <LegalDocsModal open={legalOpen} initialTab={legalTab} onClose={() => setLegalOpen(false)} />
      <OfflineIndicator />
    </div>
  );
}
