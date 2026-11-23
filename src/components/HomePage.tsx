import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Download,
  Globe,
  Layers,
  Lock,
  Menu,
  Monitor,
  Play,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { formatUsd, getPriceDecimals } from '../lib/api';
import { COUNTRIES } from '../lib/countries';
import { SUPPORTED_FIAT_CODES } from '../lib/currencies';
import type { MarketPair, PlatformSettings } from '../types';
import { CryptoIcon } from './CryptoIcon';
import { HeroAnimatedExchangeVisual } from './HeroAnimatedExchangeVisual';
import { LegalDocsModal, type LegalDocTab } from './LegalDocsModal';
import { NepefyLogo, NepefyMark } from './NepefyLogo';
import TERMINAL_MOCKUP_IMG from '../assets/images/crypto_laptop_mockup_1795282787363.jpg';

interface HomePageProps {
  markets: MarketPair[];
  publicSettings: PlatformSettings | null;
  onOpenAuth: (mode: 'LOGIN' | 'SIGNUP') => void;
}

type MarketFilter = 'ALL' | 'GAINERS' | 'VOLUME';

const formatCompactTurnover = (value: number | undefined): string => {
  const num = Number(value || 0);
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${formatUsd(num)}`;
};

export const HomePage: React.FC<HomePageProps> = ({
  markets,
  publicSettings,
  onOpenAuth,
}) => {
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllPairs, setShowAllPairs] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);
  const [scrolled, setScrolled] = useState(false);

  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalDocTab>('TERMS');

  const [mockupImgFailed, setMockupImgFailed] = useState(false);

  const [contactForm, setContactForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    message: '',
  });
  const [contactSent, setContactSent] = useState(false);

  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [installFeedback, setInstallFeedback] = useState<string | null>(null);

  const apkAvailable = Boolean(publicSettings?.androidApkAvailable);
  const apkVersion = publicSettings?.androidApkVersion || '2.4.0';

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('download') === 'apk') {
      setDownloadModalOpen(true);
    }
    const targetUrl = apkAvailable
      ? `${window.location.origin}/downloads/nepefy.apk`
      : `${window.location.origin}/?download=apk`;
    QRCode.toDataURL(targetUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#040d26', light: '#ffffff' },
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [apkAvailable]);

  const featuredQuotes = useMemo(() => {
    const wanted = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'];
    const found = wanted
      .map((sym) => markets.find((m) => m.symbol === sym))
      .filter((m): m is MarketPair => Boolean(m));
    return found.length > 0 ? found : markets.slice(0, 4);
  }, [markets]);

  const filteredMarkets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = markets.filter((pair) => {
      if (!q) return true;
      return (
        pair.symbol.toLowerCase().includes(q) ||
        pair.base_asset.toLowerCase().includes(q) ||
        pair.name.toLowerCase().includes(q)
      );
    });

    if (marketFilter === 'GAINERS') {
      list = [...list].sort((a, b) => Number(b.change_24h_pct || 0) - Number(a.change_24h_pct || 0));
    } else if (marketFilter === 'VOLUME') {
      list = [...list].sort((a, b) => Number(b.turnover_24h || 0) - Number(a.turnover_24h || 0));
    }

    return showAllPairs ? list : list.slice(0, 6);
  }, [markets, marketFilter, searchQuery, showAllPairs]);

  const openLegal = (tab: LegalDocTab) => {
    setLegalTab(tab);
    setLegalOpen(true);
  };

  const handleInstantAppInstall = async () => {
    setInstallFeedback(null);
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        setInstallFeedback('Nepefy mobile app installed onto your device.');
        return;
      }
    }
    setDownloadModalOpen(true);
  };

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.email.trim() || !contactForm.message.trim()) return;
    setContactSent(true);
    setContactForm({ firstName: '', lastName: '', email: '', message: '' });
  };

  const navItems = [
    { href: '#top', label: 'Home' },
    { href: '#exchange', label: 'Exchange' },
    { href: '#features', label: 'Features' },
    { href: '#mobile-app', label: 'Mobile App' },
    { href: '#faq', label: 'FAQ' },
    { href: '#contact', label: 'Contact Us' },
  ];

  const faqItems = [
    {
      q: '1. How does Nepefy dual-wallet custody work?',
      a: 'Your Main Balance holds active trading liquidity for Spot orders, P2P escrow, and withdrawals, while staking yields, presale payouts, and referral commissions accrue cleanly in your Claimable Wallet until you sweep them to Main.',
    },
    {
      q: '2. Can I buy and sell USDT with local currencies?',
      a: `Yes. Our P2P Market supports ${SUPPORTED_FIAT_CODES.length} fiat currencies across ${COUNTRIES.length} countries with automated escrow protection, 15-minute payment timers, live trade chat, receipt uploads, and Master Admin dispute resolution.`,
    },
    {
      q: '3. How are Staking Vault yields paid out?',
      a: 'Fixed-term staking vaults (6M at 18% APR, 12M at 20% APR, 24M at 22% APR, and 36M at 25% APR) distribute automated 30-day profit payouts directly to your Claimable Wallet.',
    },
    {
      q: '4. What is Principal-Safe Coin Presale & Jackpot?',
      a: 'Monthly Coin Presale lots let you participate in early-stage token allocations—if your lot is not drawn, your full principal is returned to your wallet. Quarterly Jackpots settle transparently to Claimable Wallet.',
    },
    {
      q: '5. How does Nepefy secure my account and funds?',
      a: 'Every account supports email OTP signup verification, strong password hashing, TOTP 6-digit Authenticator 2FA for withdrawals and transfers, active login session revocation, and 4-step KYC verification.',
    },
  ];

  return (
    <div id="top" className="min-h-screen bg-[#040d26] text-white flex flex-col relative overflow-x-hidden">
      {/* Sticky Top Header (Sign In / Sign Up Grouped Right) */}
      <header
        className={`sticky top-0 z-40 transition-all duration-200 ${
          scrolled
            ? 'bg-[#040d26]/95 backdrop-blur-md border-b border-[#1e326d] shadow-lg shadow-black/20'
            : 'bg-[#040d26]/85 backdrop-blur-sm border-b border-[#132259]'
        }`}
      >
        <div className="max-w-[1240px] mx-auto h-16 lg:h-20 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <a
            href="#top"
            className="inline-flex items-center whitespace-nowrap shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#bd24df]"
            aria-label="Nepefy Home"
          >
            <NepefyLogo size="sm" showTagline={false} darkMode />
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden lg:flex items-center gap-7 text-sm font-medium text-[#b4c7ed]"
          >
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="hover:text-white border-b border-transparent hover:border-[#bd24df] py-1 transition-colors whitespace-nowrap shrink-0"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenAuth('LOGIN')}
              className="px-3.5 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-[#2d6ade] to-[#bd24df] hover:from-[#bd24df] hover:to-[#2d6ade] rounded-lg transition-all duration-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => onOpenAuth('SIGNUP')}
              className="px-3.5 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-lg shadow-md shadow-[#bd24df]/20 transition-all duration-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign Up
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen}
              className="lg:hidden p-2 rounded-lg border border-[#1e326d] bg-[#091945] text-[#ecf2ff] hover:border-[#bd24df] cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-[#1e326d] bg-[#091945] px-4 py-4 space-y-2">
            <div className="space-y-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2.5 text-sm font-medium text-[#ecf2ff] hover:bg-[#132259] rounded-lg"
                >
                  {item.label}
                </a>
              ))}
            </div>
            <div className="pt-3 border-t border-[#1e326d] grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAuth('LOGIN');
                }}
                className="px-4 py-2.5 text-xs font-semibold text-white border border-[#2d6ade] hover:bg-[#132259] rounded-lg text-center cursor-pointer"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAuth('SIGNUP');
                }}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] rounded-lg text-center cursor-pointer"
              >
                Sign Up
              </button>
            </div>
          </div>
        )}
      </header>

      {publicSettings?.maintenanceMode && (
        <div className="border-b border-amber-500/30 bg-amber-950/60 px-4 sm:px-6 py-2.5">
          <div className="max-w-[1240px] mx-auto flex items-center gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong className="font-semibold">Exchange Maintenance Notice:</strong>{' '}
              {publicSettings.maintenanceMessage}
            </span>
          </div>
        </div>
      )}

      <main className="flex-1">
        {/* SECTION 1: Hero Banner with Cosmic Ambient Glow */}
        <section className="relative overflow-hidden pt-10 pb-14 lg:pt-16 lg:pb-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full bg-[#bd24df]/20 blur-[130px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-10 right-0 w-[460px] h-[460px] rounded-full bg-[#2d6ade]/20 blur-[140px]"
          />

          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center">
              <div className="lg:col-span-6 text-center lg:text-left">
                <h1 className="text-3xl sm:text-5xl lg:text-[54px] font-bold tracking-tight text-white leading-[1.15] text-balance">
                  Buy, Sell &amp; Earn Cryptocurrency with Ease
                </h1>

                <p className="mt-5 text-sm sm:text-base lg:text-lg text-[#b4c7ed] leading-relaxed max-w-xl mx-auto lg:mx-0">
                  A fast, secure platform to trade {markets.length || 30}+ live USDT markets, settle P2P
                  across {SUPPORTED_FIAT_CODES.length} fiat currencies, and earn up to 25% APR in
                  automated staking vaults.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-4">
                  <button
                    type="button"
                    onClick={() => onOpenAuth('SIGNUP')}
                    className="px-7 py-3.5 text-sm sm:text-base font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl shadow-lg shadow-[#bd24df]/25 transition-all duration-300 inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  <a
                    href="#how-it-works"
                    className="px-5 py-3.5 text-sm sm:text-base font-semibold text-white hover:text-[#ecf2ff] inline-flex items-center gap-2.5 whitespace-nowrap transition-colors"
                  >
                    <span className="w-9 h-9 rounded-full bg-[#132259] border border-[#2d6ade]/50 flex items-center justify-center">
                      <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />
                    </span>
                    <span>How It Works</span>
                  </a>
                </div>
              </div>

              <div className="lg:col-span-6">
                <HeroAnimatedExchangeVisual
                  markets={markets}
                  onTradeClick={() => onOpenAuth('LOGIN')}
                />
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: Core Ecosystem Strip (Matches Partner Marquee Band) */}
        <section className="border-y border-[#132259] bg-[#091945]/45 py-6">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-center text-center">
              {[
                { label: `${markets.length || 30}+ Spot Pairs`, icon: TrendingUp },
                { label: `${SUPPORTED_FIAT_CODES.length} Fiat P2P`, icon: Globe },
                { label: '18%–25% Staking', icon: Layers },
                { label: 'Principal-Safe Presale', icon: Sparkles },
                { label: 'TOTP 2FA Vault', icon: ShieldCheck },
                { label: 'Android APK & Web', icon: Smartphone },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold text-[#8a9bca] hover:text-white transition-colors py-1"
                  >
                    <Icon className="w-4 h-4 text-[#bd24df] shrink-0" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 3: How It Works (3 Dark Elevated Cards with Gradient Icon Badges) */}
        <section id="how-it-works" className="relative py-16 lg:py-24">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-24 left-1/4 w-[380px] h-[380px] rounded-full bg-[#bd24df]/15 blur-[130px]"
          />
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-white">
                How It Works
              </h2>
              <p className="mt-3 text-sm sm:text-base text-[#b4c7ed] leading-relaxed">
                Getting started with Nepefy is simple. Create an account, add funds or trade P2P, and
                start earning across spot, staking, and presale pools.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-16 gap-x-6 mt-20">
              {[
                {
                  title: 'Create Account',
                  desc: 'Sign up with email OTP verification, set up a strong password, and protect your account with 6-digit 2FA security in minutes.',
                  icon: UserPlus,
                },
                {
                  title: 'Add Funds & P2P',
                  desc: `Deposit USDT directly or buy and sell with ${SUPPORTED_FIAT_CODES.length} local fiat currencies under 15-minute P2P escrow protection.`,
                  icon: Wallet,
                },
                {
                  title: 'Trade, Stake & Earn',
                  desc: 'Execute instant spot market & limit orders, lock 18%–25% APR staking vaults, or enter monthly Coin Presale and Jackpot draws.',
                  icon: TrendingUp,
                },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    className="bg-[#091945] border border-[#1e326d] hover:border-[#bd24df] hover:-translate-y-1 transition-all duration-300 p-8 pt-12 relative rounded-2xl text-center"
                  >
                    <div className="w-16 h-16 rounded-full flex items-center justify-center absolute -top-8 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#bd24df] to-[#2d6ade] shadow-lg shadow-[#bd24df]/30">
                      <Icon className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mt-2">{step.title}</h3>
                    <p className="text-sm text-[#b4c7ed] mt-3 leading-relaxed">{step.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 4: Market Trend Live Stream (Real WebSocket Live Pairs) */}
        <section id="exchange" className="scroll-mt-20 py-10 lg:py-16">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-[#091945] border border-[#1e326d] p-5 sm:p-8 relative overflow-hidden">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white">
                    Market Trend Live Stream
                  </h2>
                  <p className="mt-1 text-xs sm:text-sm text-[#8a9bca]">
                    Real-time WebSocket prices across {markets.length || 30} active USDT trading pairs.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1 p-1 bg-[#040d26] border border-[#1e326d] rounded-lg">
                    {(
                      [
                        { key: 'ALL', label: 'All Pairs' },
                        { key: 'GAINERS', label: 'Top Gainers' },
                        { key: 'VOLUME', label: '24h Volume' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setMarketFilter(tab.key)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                          marketFilter === tab.key
                            ? 'bg-gradient-to-r from-[#bd24df] to-[#2d6ade] text-white'
                            : 'text-[#8a9bca] hover:text-white'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="relative flex-1 sm:flex-initial">
                    <Search className="w-4 h-4 text-[#8a9bca] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search coin..."
                      aria-label="Search market pairs"
                      className="h-9 w-full sm:w-48 pl-9 pr-3 text-xs bg-[#040d26] text-white placeholder-[#8a9bca] border border-[#1e326d] rounded-lg focus:outline-none focus:border-[#bd24df]"
                    />
                  </div>
                </div>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#040d26] text-[#ecf2ff] text-xs font-semibold uppercase tracking-wider">
                      <th className="py-3.5 px-4 rounded-l-lg">#</th>
                      <th className="py-3.5 px-4">Name</th>
                      <th className="py-3.5 px-4 text-right">Price</th>
                      <th className="py-3.5 px-4 text-right">Change 24H</th>
                      <th className="py-3.5 px-4 text-right">24H Turnover</th>
                      <th className="py-3.5 px-4 text-right rounded-r-lg">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1e326d]/70 text-sm">
                    {filteredMarkets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 text-center text-sm text-[#8a9bca]">
                          {markets.length === 0
                            ? 'Connecting to live market stream...'
                            : `No pairs match "${searchQuery}".`}
                        </td>
                      </tr>
                    ) : (
                      filteredMarkets.map((pair, idx) => {
                        const dec = getPriceDecimals(pair.current_price);
                        const chg = Number(pair.change_24h_pct || 0);
                        const isUp = chg >= 0;
                        return (
                          <tr key={pair.symbol} className="hover:bg-[#132259]/50 transition-colors">
                            <td className="py-4 px-4 font-mono-tabular text-xs text-[#8a9bca]">
                              {idx + 1}
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex items-center gap-3">
                                <CryptoIcon symbol={pair.symbol} size="md" />
                                <div>
                                  <div className="font-semibold text-white whitespace-nowrap">
                                    {pair.name}{' '}
                                    <span className="text-xs text-[#8a9bca]">({pair.base_asset})</span>
                                  </div>
                                  <div className="text-xs text-[#8a9bca]">{pair.symbol}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-4 px-4 text-right font-mono-tabular font-semibold text-white whitespace-nowrap">
                              ${formatUsd(pair.current_price, dec)}
                            </td>
                            <td className="py-4 px-4 text-right whitespace-nowrap">
                              <span
                                className={`inline-flex items-center justify-end gap-1 font-mono-tabular text-xs font-semibold ${
                                  isUp ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {isUp ? (
                                  <TrendingUp className="w-3.5 h-3.5" />
                                ) : (
                                  <TrendingDown className="w-3.5 h-3.5" />
                                )}
                                <span>
                                  {isUp ? '+' : ''}
                                  {chg.toFixed(2)}%
                                </span>
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right font-mono-tabular text-xs text-[#b4c7ed] whitespace-nowrap">
                              {formatCompactTurnover(pair.turnover_24h)}
                            </td>
                            <td className="py-4 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onOpenAuth('LOGIN')}
                                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                                  isUp
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500 hover:text-white'
                                    : 'bg-[#2d6ade]/20 text-[#ecf2ff] border border-[#2d6ade]/50 hover:bg-[#2d6ade]'
                                }`}
                              >
                                Trade
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards (<md) */}
              <div className="md:hidden divide-y divide-[#1e326d]">
                {filteredMarkets.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#8a9bca]">
                    {markets.length === 0
                      ? 'Connecting to live market stream...'
                      : `No pairs match "${searchQuery}".`}
                  </div>
                ) : (
                  filteredMarkets.map((pair) => {
                    const dec = getPriceDecimals(pair.current_price);
                    const chg = Number(pair.change_24h_pct || 0);
                    const isUp = chg >= 0;
                    return (
                      <div key={pair.symbol} className="py-4 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <CryptoIcon symbol={pair.symbol} size="md" />
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-sm truncate">
                              {pair.symbol}
                            </div>
                            <div className="text-xs text-[#8a9bca] truncate">
                              {pair.name} · {formatCompactTurnover(pair.turnover_24h)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right font-mono-tabular">
                            <div className="text-sm font-semibold text-white">
                              ${formatUsd(pair.current_price, dec)}
                            </div>
                            <div className={`text-xs font-semibold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isUp ? '+' : ''}
                              {chg.toFixed(2)}%
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenAuth('LOGIN')}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] rounded-lg cursor-pointer"
                          >
                            Trade
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {markets.length > 6 && !searchQuery.trim() && (
                <div className="mt-5 pt-4 border-t border-[#1e326d] flex items-center justify-between text-xs text-[#8a9bca]">
                  <span>
                    Showing {filteredMarkets.length} of {markets.length} active pairs
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAllPairs((v) => !v)}
                    className="font-semibold text-[#bd24df] hover:text-white transition-colors cursor-pointer"
                  >
                    {showAllPairs ? 'Show Top 6 Pairs' : `View All ${markets.length} Pairs`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 5: FEATURES — The Most Trusted Platform */}
        <section id="features" className="scroll-mt-20 py-16 lg:py-24 relative">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-5">
                <p className="text-xs font-bold uppercase tracking-widest text-[#bd24df]">
                  Features
                </p>
                <h2 className="mt-3 text-2xl sm:text-4xl font-bold text-white leading-tight">
                  The Most Trusted Platform for Digital Currency
                </h2>
                <p className="mt-4 text-sm sm:text-base text-[#b4c7ed] leading-relaxed">
                  Discover tools engineered to help you trade spot markets, manage P2P escrow across{' '}
                  {COUNTRIES.length} countries, and earn predictable staking returns on one auditable
                  ledger.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenAuth('SIGNUP')}
                  className="mt-7 px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl transition-all duration-300 inline-flex items-center gap-2 cursor-pointer"
                >
                  <span>Explore Platform</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-5">
                {[
                  {
                    title: 'Secure Storage & 2FA',
                    desc: 'Protected with TOTP 6-digit 2FA, active session revocation, and 4-step KYC identity verification.',
                    icon: Lock,
                  },
                  {
                    title: 'Dual-Wallet Custody',
                    desc: 'Trading liquidity stays isolated in Main Balance while staking yields accrue cleanly in Claimable Wallet.',
                    icon: Wallet,
                  },
                  {
                    title: 'Real-Time Price Data',
                    desc: 'Live WebSocket orderbook streaming across 30+ USDT pairs with Market, Limit, and TP/SL orders.',
                    icon: TrendingUp,
                  },
                  {
                    title: 'P2P & Fixed Staking',
                    desc: `Escrow-backed P2P trading in ${SUPPORTED_FIAT_CODES.length} fiat currencies plus 18%–25% APR fixed vaults.`,
                    icon: Layers,
                  },
                ].map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <div
                      key={feat.title}
                      className="bg-[#091945] border border-[#1e326d] hover:border-[#2d6ade] rounded-2xl p-6 transition-all duration-300"
                    >
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-r from-[#bd24df]/25 to-[#2d6ade]/25 border border-[#bd24df]/40 flex items-center justify-center mb-4">
                        <Icon className="w-5 h-5 text-[#ecf2ff]" />
                      </div>
                      <h3 className="text-lg font-semibold text-white">{feat.title}</h3>
                      <p className="mt-2 text-sm text-[#b4c7ed] leading-relaxed">{feat.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 6: A Simple, Secure Way Showcase */}
        <section className="py-12 lg:py-20">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-6">
                <div className="rounded-2xl overflow-hidden border border-[#1e326d] bg-[#040d26] shadow-2xl shadow-[#bd24df]/10">
                  {!mockupImgFailed ? (
                    <img
                      src={TERMINAL_MOCKUP_IMG}
                      alt="Nepefy trading workstation preview"
                      onError={() => setMockupImgFailed(true)}
                      className="w-full h-auto object-cover block"
                    />
                  ) : (
                    <div className="aspect-video bg-[#091945] flex items-center justify-center">
                      <Monitor className="w-12 h-12 text-[#2d6ade]" />
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-6">
                <h2 className="text-2xl sm:text-4xl font-bold text-white leading-tight">
                  A Simple, Secure Way to Buy and Sell Cryptocurrency
                </h2>
                <p className="mt-4 text-sm sm:text-base text-[#b4c7ed] leading-relaxed">
                  Buy, sell, stake, and manage digital assets with confidence on a unified ledger
                  engineered for both everyday traders and active liquidity participants.
                </p>
                <div className="mt-6 space-y-3 text-sm text-[#ecf2ff]">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#bd24df] shrink-0" />
                    <span>Instant sweep from Claimable Yield Wallet to Main Balance</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#bd24df] shrink-0" />
                    <span>Principal-safe monthly Coin Presale lots &amp; Quarterly Jackpots</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#bd24df] shrink-0" />
                    <span>Direct Support Chat &amp; 15.00 USDT global referral commissions</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenAuth('SIGNUP')}
                  className="mt-7 px-7 py-3.5 text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl transition-all duration-300 inline-flex items-center gap-2 cursor-pointer"
                >
                  <span>Connect &amp; Open Wallet</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 7: Trade Anytime, Anywhere + Android APK & QR */}
        <section id="mobile-app" className="scroll-mt-20 py-14 lg:py-20">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-gradient-to-br from-[#091945] via-[#0c1b44] to-[#132259] border border-[#1e326d] p-6 sm:p-10 lg:p-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-5">
                <p className="text-xs font-bold uppercase tracking-widest text-[#bd24df]">
                  Android APK v{apkVersion} · Cross-Platform
                </p>
                <h2 className="text-2xl sm:text-4xl font-bold text-white leading-tight">
                  Trade Anytime, Anywhere
                </h2>
                <p className="text-sm sm:text-base text-[#b4c7ed] leading-relaxed max-w-xl">
                  Access your Nepefy portfolio, real-time spot charts, P2P escrow chats, and staking
                  vaults 24/7 across desktop browsers, Android APK, and installable mobile web apps.
                </p>

                {installFeedback && (
                  <div className="border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 text-xs px-3.5 py-2.5 rounded-lg inline-flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{installFeedback}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  {apkAvailable ? (
                    <a
                      href="/downloads/nepefy.apk"
                      download="Nepefy-Exchange.apk"
                      className="px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl transition-all inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Android APK (v{apkVersion})</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDownloadModalOpen(true)}
                      className="px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl transition-all inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Android APK</span>
                    </button>
                  )}

                  {!isInstalled && (
                    <button
                      type="button"
                      onClick={handleInstantAppInstall}
                      className="px-5 py-3 text-sm font-semibold text-white bg-[#040d26]/80 hover:bg-[#040d26] border border-[#2d6ade]/60 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <Smartphone className="w-4 h-4 text-[#bd24df]" />
                      <span>{isInstallable ? 'Install App Now' : 'Mobile Install Guide'}</span>
                    </button>
                  )}
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-5 text-xs text-[#8a9bca]">
                  <span className="inline-flex items-center gap-1.5">
                    <Monitor className="w-4 h-4 text-[#ecf2ff]" /> Web Terminal
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-[#ecf2ff]" /> Android APK
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#ecf2ff]" /> Synced 2FA &amp; Push Alerts
                  </span>
                </div>
              </div>

              <div className="lg:col-span-5 flex flex-col items-center justify-center">
                <div className="rounded-2xl border border-[#2d6ade]/40 bg-[#040d26]/90 p-6 text-center max-w-xs w-full space-y-3">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Scan QR code to download Nepefy mobile app"
                      className="w-36 h-36 mx-auto rounded-xl bg-white p-1.5"
                    />
                  ) : (
                    <div className="w-36 h-36 mx-auto rounded-xl bg-[#091945] border border-[#1e326d] flex items-center justify-center">
                      <QrCode className="w-10 h-10 text-[#8a9bca]" />
                    </div>
                  )}
                  <div className="text-sm font-semibold text-white">Scan to Open on Phone</div>
                  <div className="text-xs text-[#8a9bca] leading-relaxed">
                    Point your Android camera to download or install Nepefy Mobile directly.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 8: Frequently Asked Questions (Accordions) */}
        <section id="faq" className="scroll-mt-20 py-14 lg:py-20">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-2xl sm:text-4xl font-bold text-white">
                Frequently Asked Questions
              </h2>
              <p className="mt-3 text-sm sm:text-base text-[#b4c7ed]">
                Clear answers about Spot trading, P2P escrow, fixed-APR staking, Coin Presales, and
                account protection.
              </p>
            </div>

            <div className="max-w-3xl mx-auto space-y-3.5">
              {faqItems.map((item, idx) => {
                const isOpen = openFaqIdx === idx;
                return (
                  <div
                    key={item.q}
                    className={`rounded-2xl border transition-colors ${
                      isOpen
                        ? 'bg-[#091945] border-[#bd24df]/60'
                        : 'bg-[#091945]/75 border-[#1e326d] hover:border-[#2d6ade]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="w-full px-6 py-4.5 flex items-center justify-between gap-4 text-left cursor-pointer"
                    >
                      <span className="text-sm sm:text-base font-semibold text-white">{item.q}</span>
                      <ChevronDown
                        className={`w-5 h-5 text-[#b4c7ed] shrink-0 transition-transform duration-200 ${
                          isOpen ? 'rotate-180 text-[#bd24df]' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-6 pb-5 text-sm text-[#b4c7ed] leading-relaxed border-t border-[#1e326d]/70 pt-3.5">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* SECTION 9: Get in Touch */}
        <section id="contact" className="scroll-mt-20 py-12 lg:py-20">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="rounded-2xl bg-[#091945] border border-[#1e326d] p-6 sm:p-10 lg:p-12 max-w-4xl mx-auto">
              <div className="text-center max-w-xl mx-auto mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Get in Touch</h2>
                <p className="mt-2 text-sm text-[#b4c7ed]">
                  Questions about onboarding, institutional liquidity, or KYC? Send us a message or
                  sign in for live 24/7 Support Chat.
                </p>
              </div>

              {contactSent ? (
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center space-y-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <div className="text-base font-semibold text-white">Inquiry Received</div>
                  <p className="text-sm text-[#b4c7ed]">
                    For instant real-time help with deposits, P2P orders, or KYC, sign in to open a
                    live ticket in Support Chat.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setContactSent(false)}
                      className="px-4 py-2 text-xs font-semibold text-[#b4c7ed] border border-[#1e326d] hover:text-white rounded-lg cursor-pointer"
                    >
                      Send Another
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAuth('LOGIN')}
                      className="px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] rounded-lg cursor-pointer"
                    >
                      Sign In to Support
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <input
                      type="text"
                      value={contactForm.firstName}
                      onChange={(e) => setContactForm((p) => ({ ...p, firstName: e.target.value }))}
                      placeholder="First Name"
                      required
                      className="w-full h-11 px-4 text-sm bg-[#040d26] text-white placeholder-[#8a9bca] border border-[#1e326d] rounded-xl focus:outline-none focus:border-[#bd24df]"
                    />
                    <input
                      type="text"
                      value={contactForm.lastName}
                      onChange={(e) => setContactForm((p) => ({ ...p, lastName: e.target.value }))}
                      placeholder="Last Name"
                      required
                      className="w-full h-11 px-4 text-sm bg-[#040d26] text-white placeholder-[#8a9bca] border border-[#1e326d] rounded-xl focus:outline-none focus:border-[#bd24df]"
                    />
                  </div>
                  <input
                    type="email"
                    value={contactForm.email}
                    onChange={(e) => setContactForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="Email Address"
                    required
                    className="w-full h-11 px-4 text-sm bg-[#040d26] text-white placeholder-[#8a9bca] border border-[#1e326d] rounded-xl focus:outline-none focus:border-[#bd24df]"
                  />
                  <textarea
                    rows={4}
                    value={contactForm.message}
                    onChange={(e) => setContactForm((p) => ({ ...p, message: e.target.value }))}
                    placeholder="Message"
                    required
                    className="w-full p-4 text-sm bg-[#040d26] text-white placeholder-[#8a9bca] border border-[#1e326d] rounded-xl focus:outline-none focus:border-[#bd24df] resize-none"
                  />
                  <div className="text-center pt-1">
                    <button
                      type="submit"
                      className="px-8 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#bd24df] to-[#2d6ade] hover:from-[#2d6ade] hover:to-[#bd24df] rounded-xl inline-flex items-center gap-2 transition-all cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Submit</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Dark Cosmic Footer */}
      <footer className="border-t border-[#132259] bg-[#040d26]">
        <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-12 grid grid-cols-1 md:grid-cols-12 gap-8">
          <div className="md:col-span-5 space-y-3">
            <NepefyLogo size="sm" darkMode />
            <p className="text-xs sm:text-sm text-[#8a9bca] leading-relaxed max-w-sm">
              Multi-asset digital currency exchange featuring real-time USDT spot orderbooks,{' '}
              {SUPPORTED_FIAT_CODES.length}-currency P2P escrow, and automated staking vaults.
            </p>
          </div>

          <div className="md:col-span-3 space-y-3">
            <h3 className="text-sm font-semibold text-white">Useful Links</h3>
            <ul className="space-y-2 text-xs sm:text-sm text-[#8a9bca]">
              <li>
                <a href="#top" className="hover:text-white transition-colors">
                  Home
                </a>
              </li>
              <li>
                <a href="#exchange" className="hover:text-white transition-colors">
                  Exchange Markets
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-white transition-colors">
                  FAQ
                </a>
              </li>
              <li>
                <a href="#contact" className="hover:text-white transition-colors">
                  Contact Us
                </a>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">Legal &amp; Access</h3>
            <div className="flex flex-col items-start gap-2 text-xs sm:text-sm text-[#8a9bca]">
              <button
                type="button"
                onClick={() => openLegal('TERMS')}
                className="hover:text-white cursor-pointer"
              >
                Terms of Service
              </button>
              <button
                type="button"
                onClick={() => openLegal('PRIVACY')}
                className="hover:text-white cursor-pointer"
              >
                Privacy Policy
              </button>
              <button
                type="button"
                onClick={() => openLegal('RISK')}
                className="hover:text-white cursor-pointer"
              >
                Risk Disclosure
              </button>
              <button
                type="button"
                onClick={() => openLegal('AML')}
                className="hover:text-white cursor-pointer"
              >
                AML &amp; KYC Policy
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-[#132259]">
          <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[#8a9bca]">
            <span>© {new Date().getFullYear()} Nepefy Exchange · All Rights Reserved</span>
            <a
              href="#top"
              className="inline-flex items-center gap-1.5 text-[#b4c7ed] hover:text-white transition-colors"
            >
              <span>Back to Top</span>
              <ArrowUp className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </footer>

      {/* Mobile App & Android APK Download Modal */}
      {downloadModalOpen && (
        <div
          onClick={() => setDownloadModalOpen(false)}
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#091945] border border-[#1e326d] text-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#1e326d] pb-3.5">
              <div className="flex items-center gap-2.5">
                <NepefyMark size={28} darkMode />
                <div>
                  <h3 className="text-base font-bold text-white">Nepefy Mobile App</h3>
                  <p className="text-xs text-[#8a9bca]">
                    Android APK (v{apkVersion}) &amp; Mobile Install
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDownloadModalOpen(false)}
                aria-label="Close download modal"
                className="p-1 text-[#8a9bca] hover:text-white rounded-md cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {apkAvailable ? (
              <div className="border border-[#2d6ade]/50 bg-[#132259]/60 rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-white">
                  Direct Android Package Ready (v{apkVersion})
                </div>
                <p className="text-xs text-[#b4c7ed] leading-relaxed">
                  Download the signed Android APK installer directly to your phone and open it to
                  install Nepefy Exchange.
                </p>
                <a
                  href="/downloads/nepefy.apk"
                  download="Nepefy-Exchange.apk"
                  className="w-full h-10 bg-gradient-to-r from-[#bd24df] to-[#2d6ade] text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Nepefy-Exchange.apk</span>
                </a>
              </div>
            ) : (
              <div className="border border-[#1e326d] bg-[#040d26]/70 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-semibold text-white">
                  Instant Mobile App Install (Recommended)
                </div>
                <p className="text-xs text-[#b4c7ed] leading-relaxed">
                  {isIOS
                    ? 'On iPhone / iPad Safari: tap Share → "Add to Home Screen" to install Nepefy in full-screen app mode.'
                    : 'On Android Chrome: tap the browser menu (⋮) → "Install app" (or "Add to Home screen") to run Nepefy as a native full-screen mobile app with zero APK sideload warnings.'}
                </p>
                {isInstallable && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) {
                        setInstallFeedback('Nepefy mobile app installed onto your device.');
                        setDownloadModalOpen(false);
                      }
                    }}
                    className="w-full h-10 bg-gradient-to-r from-[#bd24df] to-[#2d6ade] text-white text-xs font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Install Nepefy App on This Device</span>
                  </button>
                )}
              </div>
            )}

            {qrDataUrl && (
              <div className="flex items-center gap-4 border border-[#1e326d] bg-[#040d26]/60 rounded-xl p-3.5">
                <img
                  src={qrDataUrl}
                  alt="Mobile download QR code"
                  className="w-20 h-20 rounded-lg bg-white p-1 shrink-0"
                />
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-white">Scan from Android Phone</div>
                  <p className="text-[#8a9bca] leading-relaxed">
                    Scan this QR code with your phone camera to open the Nepefy mobile download page directly.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <LegalDocsModal open={legalOpen} initialTab={legalTab} onClose={() => setLegalOpen(false)} />
    </div>
  );
};
