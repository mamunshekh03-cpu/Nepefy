import React, { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  Send,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import { getCountryShortCode } from '../lib/countries';
import {
  SUPPORTED_FIAT_CURRENCIES,
  formatFiatAmount,
  getCurrencyCountries,
  getCurrencyMeta,
} from '../lib/currencies';
import type { DepositRequest, LedgerEntry, PlatformSettings, UserProfile, WithdrawRequest } from '../types';
import { CryptoIcon, GatewayLogo } from './CryptoIcon';
import { SelectDropdown } from './SelectDropdown';
import { SecurityConfirmModal, type SensitiveActionAuthPayload } from './SecurityConfirmModal';
import { TransactionHistoryTable } from './TransactionHistoryTable';

interface WalletFundingViewProps {
  user: UserProfile;
  ledger: LedgerEntry[];
  onRefresh: () => Promise<void>;
}

const DEPOSIT_PRESETS = [100, 500, 1000, 5000];
const WITHDRAW_PRESETS = [50, 100, 500];
const SEND_PRESETS = [10, 50, 100, 500];

const GATEWAY_INFO: Record<
  'Binance' | 'Bybit',
  {
    depositChannelLabel: string;
    officeLabel: string;
    officeId: string;
    trxLabel: string;
    trxPlaceholder: string;
    destinationLabel: string;
    withdrawPlaceholder: string;
    eta: string;
  }
> = {
  Binance: {
    depositChannelLabel: 'Binance Pay · Zero Fee',
    officeLabel: 'Official Binance Pay ID',
    officeId: '904182775',
    trxLabel: 'Binance TrxID',
    trxPlaceholder: 'BN9948201190X',
    destinationLabel: 'Binance Pay ID / UID or TRC20',
    withdrawPlaceholder: 'e.g. BINANCE-UID-449102 or TRC20 address',
    eta: '5–15 min review',
  },
  Bybit: {
    depositChannelLabel: 'Bybit Internal · Zero Fee',
    officeLabel: 'Official Bybit UID',
    officeId: '55109283',
    trxLabel: 'Bybit TrxID',
    trxPlaceholder: 'BYB883920145',
    destinationLabel: 'Bybit UID or TRC20',
    withdrawPlaceholder: 'e.g. BYBIT-UID-882104 or TRC20 address',
    eta: '5–15 min review',
  },
};

type UnifiedQueueItem = {
  kind: 'DEPOSIT' | 'WITHDRAW';
  id: string;
  created_at: string;
  gateway: 'Binance' | 'Bybit';
  ref: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  amount: number;
  fee_usd: number;
  screenshot_data?: string;
};

export const WalletFundingView: React.FC<WalletFundingViewProps> = ({
  user,
  ledger,
  onRefresh,
}) => {
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'DEPOSIT' | 'WITHDRAW' | 'SEND'>('DEPOSIT');
  const [hideBalance, setHideBalance] = useState(false);

  // Deposit state
  const [depAmount, setDepAmount] = useState('500');
  const [depGateway, setDepGateway] = useState<'Binance' | 'Bybit'>('Binance');
  const [depTrxId, setDepTrxId] = useState('');
  const [depScreenshot, setDepScreenshot] = useState('');
  const [depBusy, setDepBusy] = useState(false);

  // Withdraw state
  const [wdrAmount, setWdrAmount] = useState('100');
  const [wdrGateway, setWdrGateway] = useState<'Binance' | 'Bybit'>('Binance');
  const [wdrDest, setWdrDest] = useState('');
  const [wdrNote, setWdrNote] = useState('');
  const [wdrBusy, setWdrBusy] = useState(false);

  // Send state
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('50');
  const [sendNote, setSendNote] = useState('');
  const [sendBusy, setSendBusy] = useState(false);

  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [copiedOfficeId, setCopiedOfficeId] = useState(false);
  const [pendingAction, setPendingAction] = useState<'DEPOSIT' | 'WITHDRAW' | 'SEND' | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const defaultDisplayCurrency = getCountryShortCode(user.country) || 'USD';
  const [displayCurrency, setDisplayCurrency] = useState<string>(defaultDisplayCurrency);

  const displayCurrencyOptions = React.useMemo(
    () =>
      SUPPORTED_FIAT_CURRENCIES.map((c) => ({
        value: c.code,
        label: `${c.code} · ${c.name}`,
        searchText: `${c.code} ${c.name} ${c.region} ${getCurrencyCountries(c.code).join(' ')}`,
      })),
    []
  );
  const displayMeta = getCurrencyMeta(displayCurrency);

  const handleCopyOfficeId = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedOfficeId(true);
      setTimeout(() => setCopiedOfficeId(false), 1800);
    } catch {
      // ignore clipboard restrictions
    }
  };

  const loadFundingData = async () => {
    const [dRes, wRes, sRes] = await Promise.all([
      apiFetch<{ deposits: DepositRequest[] }>('/api/deposits'),
      apiFetch<{ withdrawals: WithdrawRequest[] }>('/api/withdrawals'),
      apiFetch<{ settings: PlatformSettings }>('/api/public/settings').catch(() => ({ settings: null as any })),
    ]);
    setDeposits(dRes.deposits);
    setWithdrawals(wRes.withdrawals);
    if (sRes?.settings) setPlatformSettings(sRes.settings);
  };

  useEffect(() => {
    loadFundingData().catch(() => {});
  }, []);

  const switchMode = (tab: 'DEPOSIT' | 'WITHDRAW' | 'SEND') => {
    setActiveTab(tab);
    setNotice(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      setNotice({ type: 'err', text: 'Screenshot must be a PNG, JPG, GIF, or WebP image.' });
      return;
    }
    if (file.size > 2_000_000) {
      setNotice({ type: 'err', text: 'Payment screenshot must be smaller than 2 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNotice(null);
        setDepScreenshot(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const minDepositUsd = platformSettings?.minDepositUsd ?? 10;
  const maxDepositUsd = platformSettings?.maxDepositUsd ?? 100000;
  const minWithdrawUsd = platformSettings?.minWithdrawUsd ?? 10;
  const maxWithdrawUsd = platformSettings?.maxWithdrawUsd ?? 50000;
  const withdrawFeeUsd = platformSettings?.withdrawFeeUsd ?? 1.0;
  const sendFeeUsd = platformSettings?.sendFeeUsd ?? 0.2;

  const submitDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const val = Number(depAmount);
    if (!val || val < minDepositUsd) {
      setNotice({ type: 'err', text: `Minimum deposit is $${formatUsd(minDepositUsd)} USDT` });
      return;
    }
    if (val > maxDepositUsd) {
      setNotice({ type: 'err', text: `Maximum deposit per request is $${formatUsd(maxDepositUsd)} USDT` });
      return;
    }
    if (!depTrxId || depTrxId.trim().length < 5) {
      setNotice({ type: 'err', text: 'Valid Transaction ID (TrxID) is required' });
      return;
    }
    if (!depScreenshot) {
      setNotice({ type: 'err', text: 'Payment screenshot proof is required' });
      return;
    }
    setPendingAction('DEPOSIT');
  };

  const executeDeposit = async (auth: SensitiveActionAuthPayload) => {
    setDepBusy(true);
    try {
      await apiFetch('/api/deposits', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(depAmount),
          gateway: depGateway,
          trx_id: depTrxId,
          screenshot_data: depScreenshot,
          ...auth,
        }),
      });
      setPendingAction(null);
      setDepTrxId('');
      setDepScreenshot('');
      setNotice({
        type: 'ok',
        text: 'Deposit submitted for verification. Main Balance credits automatically once confirmed.',
      });
      await Promise.all([loadFundingData(), onRefresh()]);
    } finally {
      setDepBusy(false);
    }
  };

  const submitWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const amountVal = Number(wdrAmount);
    if (!amountVal || amountVal < minWithdrawUsd) {
      setNotice({ type: 'err', text: `Minimum withdrawal is $${formatUsd(minWithdrawUsd)} USDT` });
      return;
    }
    if (amountVal > maxWithdrawUsd) {
      setNotice({ type: 'err', text: `Maximum withdrawal per request is $${formatUsd(maxWithdrawUsd)} USDT` });
      return;
    }
    if (amountVal + withdrawFeeUsd > user.main_balance) {
      setNotice({
        type: 'err',
        text: `Insufficient Main Balance to cover withdrawal amount plus $${formatUsd(withdrawFeeUsd)} network fee`,
      });
      return;
    }
    if (!wdrDest || wdrDest.trim().length < 4) {
      setNotice({ type: 'err', text: 'Destination Binance/Bybit UID or address is required' });
      return;
    }
    setPendingAction('WITHDRAW');
  };

  const executeWithdraw = async (auth: SensitiveActionAuthPayload) => {
    setWdrBusy(true);
    try {
      await apiFetch('/api/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(wdrAmount),
          gateway: wdrGateway,
          destination_address: wdrDest,
          proof_note: wdrNote,
          ...auth,
        }),
      });
      setPendingAction(null);
      setWdrDest('');
      setWdrNote('');
      setNotice({
        type: 'ok',
        text: 'Withdrawal submitted. Funds have been placed on hold pending settlement.',
      });
      await Promise.all([loadFundingData(), onRefresh()]);
    } finally {
      setWdrBusy(false);
    }
  };

  const submitSend = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const amountVal = Number(sendAmount);
    if (!sendRecipient.trim()) {
      setNotice({ type: 'err', text: 'Valid recipient Email or User ID is required' });
      return;
    }
    if (!amountVal || amountVal <= 0) {
      setNotice({ type: 'err', text: 'Send amount must be greater than $0.00' });
      return;
    }
    if (amountVal + sendFeeUsd > user.main_balance) {
      setNotice({
        type: 'err',
        text: `Insufficient Main Balance to cover send amount plus $${formatUsd(sendFeeUsd)} fee`,
      });
      return;
    }
    setPendingAction('SEND');
  };

  const executeSend = async (auth: SensitiveActionAuthPayload) => {
    setSendBusy(true);
    try {
      const res = await apiFetch<{ referenceId: string; recipient: UserProfile; amount: number }>(
        '/api/transfers/send',
        {
          method: 'POST',
          body: JSON.stringify({
            recipient: sendRecipient,
            amount: Number(sendAmount),
            note: sendNote,
            ...auth,
          }),
        }
      );
      setPendingAction(null);
      setSendNote('');
      setNotice({
        type: 'ok',
        text: `Sent $${formatUsd(res.amount)} (+ $${formatUsd(sendFeeUsd)} fee) to ${res.recipient.full_name} (${res.recipient.id}). Ref: ${res.referenceId}`,
      });
      await onRefresh();
    } finally {
      setSendBusy(false);
    }
  };

  const activeDepBase = GATEWAY_INFO[depGateway];
  const activeDepInfo = {
    ...activeDepBase,
    officeId:
      depGateway === 'Binance'
        ? platformSettings?.binancePayId || activeDepBase.officeId
        : platformSettings?.bybitUid || activeDepBase.officeId,
  };
  const parsedDepAmount = Math.max(0, Number(depAmount) || 0);
  const parsedWdrAmount = Math.max(0, Number(wdrAmount) || 0);
  const parsedSendAmount = Math.max(0, Number(sendAmount) || 0);
  const totalWithdrawDebit = parsedWdrAmount > 0 ? parsedWdrAmount + withdrawFeeUsd : 0;
  const totalSendDebit = parsedSendAmount > 0 ? parsedSendAmount + sendFeeUsd : 0;
  const projectedBalanceAfterWithdraw = Math.max(0, user.main_balance - totalWithdrawDebit);
  const projectedBalanceAfterSend = Math.max(0, user.main_balance - totalSendDebit);
  const maxWithdrawable = Math.max(0, Math.min(maxWithdrawUsd, Number((user.main_balance - withdrawFeeUsd).toFixed(2))));
  const maxSendable = Math.max(0, Number((user.main_balance - sendFeeUsd).toFixed(2)));
  const pendingDepositCount = deposits.filter((d) => d.status === 'PENDING').length;
  const pendingWithdrawCount = withdrawals.filter((w) => w.status === 'PENDING').length;

  const unifiedQueue: UnifiedQueueItem[] = [
    ...deposits.map((d) => ({
      kind: 'DEPOSIT' as const,
      id: `dep-${d.id}`,
      created_at: d.created_at,
      gateway: d.gateway,
      ref: d.trx_id,
      status: d.status,
      amount: d.amount,
      fee_usd: 0,
      screenshot_data: d.screenshot_data,
    })),
    ...withdrawals.map((w) => ({
      kind: 'WITHDRAW' as const,
      id: `wdr-${w.id}`,
      created_at: w.created_at,
      gateway: w.gateway,
      ref: w.destination_address,
      status: w.status,
      amount: w.amount,
      fee_usd: w.fee_usd ?? 0,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const authorizeAction =
    pendingAction === 'DEPOSIT'
      ? executeDeposit
      : pendingAction === 'WITHDRAW'
      ? executeWithdraw
      : executeSend;

  return (
    <div className="space-y-5">
      {/* Page Header matching Overview */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Wallet</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Deposit, withdraw, or send USDT across your Main Balance with real-time settlement tracking.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 whitespace-nowrap">Local Reference</span>
          <SelectDropdown
            value={displayCurrency}
            onChange={(val) => setDisplayCurrency(val)}
            options={displayCurrencyOptions}
            searchable
            searchPlaceholder="Search currency or country..."
            align="right"
            buttonClassName="h-9 min-w-[175px] max-w-[230px] px-3 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:border-slate-300 text-slate-800"
            menuClassName="max-h-64 overflow-y-auto w-72"
          />
        </div>
      </div>

      {/* Mobile Wallet Hero Card (< 1024px) */}
      <section className="lg:hidden rounded-3xl bg-[#11161F] text-white p-5 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CryptoIcon symbol="USDT" className="w-6 h-6" />
            <span className="text-xs font-medium text-slate-300">Main Wallet (USDT)</span>
            <button
              type="button"
              onClick={() => setHideBalance((v) => !v)}
              aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
              className="min-w-[32px] min-h-[32px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            >
              {hideBalance ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <span className="text-[11px] font-mono-tabular text-slate-400">
            {pendingDepositCount + pendingWithdrawCount} Pending
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-[32px] font-bold tracking-tight font-mono-tabular leading-none">
            {hideBalance ? '••••••' : `$${formatUsd(user.main_balance)}`}
          </div>
          {!hideBalance && displayCurrency !== 'USD' && (
            <div className="text-xs font-mono-tabular text-slate-400">
              ≈ {formatFiatAmount(user.main_balance * displayMeta.referenceRatePerUsdt, displayCurrency)} {displayCurrency}
            </div>
          )}
        </div>

        {/* Circular Action Tabs */}
        <div className="grid grid-cols-3 gap-3 pt-1">
          {(
            [
              { key: 'DEPOSIT', label: 'Deposit', icon: ArrowDownLeft },
              { key: 'WITHDRAW', label: 'Withdraw', icon: ArrowUpRight },
              { key: 'SEND', label: 'Send', icon: Send },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isSelected = activeTab === item.key;
            return (
              <button
                key={`mob-w-${item.key}`}
                type="button"
                onClick={() => switchMode(item.key)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-600/25'
                      : 'bg-[#1E2532] text-slate-200 border-white/10'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </span>
                <span className={`text-xs font-medium ${isSelected ? 'text-white font-semibold' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-white/5 px-3 py-2">
            <div className="text-[10px] text-slate-400">Staking Profit</div>
            <div className="text-xs font-bold font-mono-tabular text-[#0ECB81] mt-0.5">
              {hideBalance ? '••••' : `$${formatUsd(user.profit_balance || 0)}`}
            </div>
          </div>
          <div className="rounded-xl bg-white/5 px-3 py-2">
            <div className="text-[10px] text-slate-400">Held in Review</div>
            <div className="text-xs font-bold font-mono-tabular text-white mt-0.5">
              {hideBalance ? '••••' : `$${formatUsd(user.locked_balance)}`}
            </div>
          </div>
        </div>
      </section>

      {/* Connected Balance Strip matching Overview (Desktop >= 1024px) */}
      <div className="hidden lg:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 rounded-xl bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="px-5 py-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <CryptoIcon symbol="USDT" className="w-6 h-6" />
              <span>Available Main Balance (USDT)</span>
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
              ${formatUsd(user.main_balance)}
            </div>
            {displayCurrency !== 'USD' && (
              <div className="mt-0.5 text-xs font-mono-tabular text-slate-500">
                ≈ {formatFiatAmount(user.main_balance * displayMeta.referenceRatePerUsdt, displayCurrency)} {displayCurrency}
              </div>
            )}
          </div>
          <div className="mt-2.5 text-xs text-slate-500">
            Active for Spot, P2P, Transfers &amp; Withdrawals
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col justify-between bg-emerald-50/35">
          <div>
            <div className="text-xs font-medium text-slate-600">Staking Profit Balance</div>
            <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-emerald-700">
              ${formatUsd(user.profit_balance || 0)}
            </div>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">
            Daily profit · Non-withdrawable until 30d unlock
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col justify-between bg-slate-50/60">
          <div>
            <div className="text-xs font-medium text-slate-500">Held in Review</div>
            <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
              ${formatUsd(user.locked_balance)}
            </div>
          </div>
          <div className="mt-2.5 text-xs text-slate-500">
            Locked in pending withdrawals or P2P orders
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500">Pending Requests</div>
            <div className="mt-1.5 text-2xl font-bold font-mono-tabular text-slate-900">
              {pendingDepositCount + pendingWithdrawCount}
            </div>
          </div>
          <div className="mt-2.5 text-xs text-slate-500 font-mono-tabular">
            {pendingDepositCount} Deposit · {pendingWithdrawCount} Withdraw
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
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Two-Column Funding Terminal + Summary & Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Deposit / Withdraw / Send Terminal */}
        <section className="lg:col-span-6 xl:col-span-5 border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/40 gap-3">
            <div
              className="inline-flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg"
              role="tablist"
              aria-label="Funding Operation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'DEPOSIT'}
                onClick={() => switchMode('DEPOSIT')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'DEPOSIT'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <ArrowDownLeft
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'DEPOSIT' ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                />
                <span>Deposit</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'WITHDRAW'}
                onClick={() => switchMode('WITHDRAW')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'WITHDRAW'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <ArrowUpRight
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'WITHDRAW' ? 'text-red-600' : 'text-slate-400'
                  }`}
                />
                <span>Withdraw</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'SEND'}
                onClick={() => switchMode('SEND')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeTab === 'SEND'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <Send
                  className={`w-3.5 h-3.5 ${
                    activeTab === 'SEND' ? 'text-blue-600' : 'text-slate-400'
                  }`}
                />
                <span>Send</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-600 shrink-0">
              <CryptoIcon symbol="USDT" size="sm" />
              <span>USDT</span>
            </div>
          </div>

          {activeTab === 'DEPOSIT' ? (
            <form onSubmit={submitDeposit} className="divide-y divide-slate-200">
              {/* 1. Channel */}
              <div className="p-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">1. Transfer Channel</span>
                  <span className="text-xs text-slate-500">Zero fee</span>
                </div>
                <SelectDropdown
                  value={depGateway}
                  onChange={(gw) => {
                    setDepGateway(gw);
                    setCopiedOfficeId(false);
                  }}
                  options={(['Binance', 'Bybit'] as const).map((gw) => ({
                    value: gw,
                    label: gw,
                    icon: <GatewayLogo gateway={gw} size="sm" showText={false} />,
                  }))}
                  buttonClassName="w-full h-10 px-3 text-sm font-semibold bg-white border border-slate-200 rounded-lg hover:border-slate-300 focus:outline-none focus:border-blue-600 text-slate-900"
                  menuClassName="w-full"
                />
              </div>

              {/* 2. Treasury ID */}
              <div className="p-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">
                    2. {activeDepInfo.officeLabel}
                  </span>
                  <span className="text-xs text-slate-500">{activeDepInfo.eta}</span>
                </div>
                <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
                  <span className="font-mono-tabular text-sm font-bold text-slate-900 tracking-wide truncate">
                    {activeDepInfo.officeId}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyOfficeId(activeDepInfo.officeId)}
                    className="h-7 px-2.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 transition-colors whitespace-nowrap shrink-0"
                  >
                    {copiedOfficeId ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy ID</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* 3. Amount & Proof */}
              <div className="p-5 space-y-4">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <label className="text-sm font-semibold text-slate-900">
                      3. Amount &amp; Proof
                    </label>
                    <div className="flex items-center gap-1.5">
                      {DEPOSIT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setDepAmount(String(preset))}
                          className={`px-2 py-1 text-xs font-mono-tabular font-semibold rounded-md border transition-colors ${
                            Number(depAmount) === preset
                              ? 'border-blue-600 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          ${preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-sm font-bold font-mono-tabular text-slate-400 pointer-events-none">
                      $
                    </span>
                    <input
                      type="number"
                      min={minDepositUsd}
                      max={maxDepositUsd}
                      step="0.01"
                      required
                      value={depAmount}
                      onChange={(e) => setDepAmount(e.target.value)}
                      className="w-full h-11 pl-7 pr-14 text-base font-bold font-mono-tabular text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                    <span className="absolute right-3 text-xs font-semibold text-slate-500 pointer-events-none">
                      USDT
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mt-1.5 font-mono-tabular">
                    <span>Min: ${formatUsd(minDepositUsd)} USDT</span>
                    {displayCurrency !== 'USD' && parsedDepAmount > 0 && (
                      <span className="text-slate-700 font-medium">
                        ≈ {formatFiatAmount(parsedDepAmount * displayMeta.referenceRatePerUsdt, displayCurrency)} {displayCurrency}
                      </span>
                    )}
                    <span>Max: ${formatUsd(maxDepositUsd)} USDT</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      {activeDepInfo.trxLabel}
                    </label>
                    <input
                      type="text"
                      required
                      value={depTrxId}
                      onChange={(e) => setDepTrxId(e.target.value)}
                      placeholder={activeDepInfo.trxPlaceholder}
                      className="w-full h-10 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Receipt Proof
                    </label>
                    <label className="h-10 px-3 flex items-center justify-between border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <span className="text-xs text-slate-600 truncate">
                        {depScreenshot ? 'Attached' : 'Upload PNG/JPG'}
                      </span>
                      <Upload className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-1.5" />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {depScreenshot && (
                  <div className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={depScreenshot}
                        alt="Uploaded deposit receipt"
                        className="h-8 w-12 object-cover rounded border border-slate-200 bg-white shrink-0"
                      />
                      <button
                        type="button"
                        onClick={() => setPreviewImage(depScreenshot)}
                        className="text-xs font-medium text-blue-600 hover:underline truncate"
                      >
                        Preview Receipt
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDepScreenshot('')}
                      className="text-xs font-medium text-slate-500 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Action Footer */}
              <div className="p-5 bg-slate-50/50 space-y-2">
                <button
                  type="submit"
                  disabled={depBusy}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {depBusy
                    ? 'Submitting Request...'
                    : `Submit $${formatUsd(parsedDepAmount)} USDT Deposit`}
                </button>
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Authorized via{' '}
                    {user.two_fa_enabled ? 'Authenticator 2FA' : 'Account Password'}
                  </span>
                </div>
              </div>
            </form>
          ) : activeTab === 'WITHDRAW' ? (
            <form onSubmit={submitWithdraw} className="divide-y divide-slate-200">
              {/* 1. Payout Channel */}
              <div className="p-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">1. Payout Channel</span>
                  <span className="text-xs text-slate-500 font-mono-tabular">Flat ${formatUsd(withdrawFeeUsd)} fee</span>
                </div>
                <SelectDropdown
                  value={wdrGateway}
                  onChange={(gw) => setWdrGateway(gw)}
                  options={(['Binance', 'Bybit'] as const).map((gw) => ({
                    value: gw,
                    label: gw,
                    icon: <GatewayLogo gateway={gw} size="sm" showText={false} />,
                  }))}
                  buttonClassName="w-full h-10 px-3 text-sm font-semibold bg-white border border-slate-200 rounded-lg hover:border-slate-300 focus:outline-none focus:border-blue-600 text-slate-900"
                  menuClassName="w-full"
                />
              </div>

              {/* 2. Amount */}
              <div className="p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-semibold text-slate-900">
                    2. Withdrawal Amount
                  </label>
                  <div className="flex items-center gap-1.5">
                    {WITHDRAW_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setWdrAmount(String(preset))}
                        className={`px-2 py-1 text-xs font-mono-tabular font-semibold rounded-md border transition-colors ${
                          Number(wdrAmount) === preset
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        ${preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setWdrAmount(String(maxWithdrawable))}
                      className="px-2 py-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                    >
                      Max
                    </button>
                  </div>
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-3 text-sm font-bold font-mono-tabular text-slate-400 pointer-events-none">
                    $
                  </span>
                  <input
                    type="number"
                    min={minWithdrawUsd}
                    max={maxWithdrawUsd}
                    step="0.01"
                    required
                    value={wdrAmount}
                    onChange={(e) => setWdrAmount(e.target.value)}
                    className="w-full h-11 pl-7 pr-14 text-base font-bold font-mono-tabular text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <span className="absolute right-3 text-xs font-semibold text-slate-500 pointer-events-none">
                    USDT
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-mono-tabular">Min: ${formatUsd(minWithdrawUsd)} USDT</span>
                  {displayCurrency !== 'USD' && parsedWdrAmount > 0 && (
                    <span className="font-mono-tabular text-slate-700 font-medium">
                      ≈ {formatFiatAmount(parsedWdrAmount * displayMeta.referenceRatePerUsdt, displayCurrency)} {displayCurrency}
                    </span>
                  )}
                  <span className="font-mono-tabular">Max: ${formatUsd(maxWithdrawable)}</span>
                </div>
              </div>

              {/* 3. Destination & Note */}
              <div className="p-5 space-y-3.5">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                    3. {GATEWAY_INFO[wdrGateway].destinationLabel}
                  </label>
                  <input
                    type="text"
                    required
                    value={wdrDest}
                    onChange={(e) => setWdrDest(e.target.value)}
                    placeholder={GATEWAY_INFO[wdrGateway].withdrawPlaceholder}
                    className="w-full h-10 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Settlement Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={wdrNote}
                    onChange={(e) => setWdrNote(e.target.value)}
                    placeholder="Optional network or verification note"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              {/* Action Footer */}
              <div className="p-5 bg-slate-50/50 space-y-2">
                <button
                  type="submit"
                  disabled={wdrBusy}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {wdrBusy
                    ? 'Holding Funds...'
                    : `Submit $${formatUsd(parsedWdrAmount)} USDT Withdrawal`}
                </button>
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Authorized via{' '}
                    {user.two_fa_enabled ? 'Authenticator 2FA' : 'Account Password'}
                  </span>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={submitSend} className="divide-y divide-slate-200">
              {/* 1. Recipient */}
              <div className="p-5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900">1. Recipient Email or ID</span>
                  <span className="text-xs text-slate-500">Instant internal</span>
                </div>
                <input
                  type="text"
                  required
                  value={sendRecipient}
                  onChange={(e) => setSendRecipient(e.target.value)}
                  placeholder="Enter recipient email or User ID"
                  className="w-full h-10 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              {/* 2. Amount */}
              <div className="p-5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-semibold text-slate-900">
                    2. Send Amount
                  </label>
                  <div className="flex items-center gap-1.5">
                    {SEND_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setSendAmount(String(preset))}
                        className={`px-2 py-1 text-xs font-mono-tabular font-semibold rounded-md border transition-colors ${
                          Number(sendAmount) === preset
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        ${preset}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSendAmount(String(maxSendable))}
                      className="px-2 py-1 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                    >
                      Max
                    </button>
                  </div>
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-3 text-sm font-bold font-mono-tabular text-slate-400 pointer-events-none">
                    $
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    required
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value)}
                    className="w-full h-11 pl-7 pr-14 text-base font-bold font-mono-tabular text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <span className="absolute right-3 text-xs font-semibold text-slate-500 pointer-events-none">
                    USDT
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-mono-tabular">Flat fee: ${formatUsd(sendFeeUsd)} USDT</span>
                  {displayCurrency !== 'USD' && parsedSendAmount > 0 && (
                    <span className="font-mono-tabular text-slate-700 font-medium">
                      ≈ {formatFiatAmount(parsedSendAmount * displayMeta.referenceRatePerUsdt, displayCurrency)} {displayCurrency}
                    </span>
                  )}
                  <span className="font-mono-tabular">Max: ${formatUsd(maxSendable)}</span>
                </div>
              </div>

              {/* 3. Note */}
              <div className="p-5 space-y-2">
                <label className="block text-sm font-semibold text-slate-900">
                  3. Reference Note (Optional)
                </label>
                <input
                  type="text"
                  value={sendNote}
                  onChange={(e) => setSendNote(e.target.value)}
                  placeholder="Invoice or desk settlement"
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              {/* Action Footer */}
              <div className="p-5 bg-slate-50/50 space-y-2">
                <button
                  type="submit"
                  disabled={sendBusy}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  {sendBusy ? 'Sending USDT...' : `Send $${formatUsd(parsedSendAmount)} USDT`}
                </button>
                <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Authorized via{' '}
                    {user.two_fa_enabled ? 'Authenticator 2FA' : 'Account Password'}
                  </span>
                </div>
              </div>
            </form>
          )}
        </section>

        {/* Right Column: Live Settlement Summary + Unified Deposit & Withdrawal Queue */}
        <aside className="lg:col-span-6 xl:col-span-7 space-y-6">
          <div className="border border-slate-200 rounded-xl bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h2 className="text-base font-semibold text-slate-900">Settlement Summary</h2>
              <span className="text-xs font-medium text-slate-500">
                {activeTab === 'DEPOSIT'
                  ? `${depGateway} Rail`
                  : activeTab === 'WITHDRAW'
                  ? `${wdrGateway} Rail`
                  : 'Internal Instant Transfer'}
              </span>
            </div>

            {activeTab === 'DEPOSIT' ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Deposit Amount</span>
                  <span className="font-mono-tabular font-medium text-slate-900">
                    ${formatUsd(parsedDepAmount)} USDT
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Treasury Fee</span>
                  <span className="font-mono-tabular font-semibold text-emerald-600">
                    $0.00 USDT
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Net Credit to Main Balance</span>
                  <span className="text-base font-bold font-mono-tabular text-emerald-600">
                    +${formatUsd(parsedDepAmount)} USDT
                  </span>
                </div>
              </div>
            ) : activeTab === 'WITHDRAW' ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Net Payout Sent</span>
                  <span className="font-mono-tabular font-medium text-slate-900">
                    ${formatUsd(parsedWdrAmount)} USDT
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Network Fee · Projected Balance</span>
                  <span className="font-mono-tabular font-medium text-slate-700">
                    ${formatUsd(withdrawFeeUsd)} · ${formatUsd(projectedBalanceAfterWithdraw)}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Total Deducted</span>
                  <span className="text-base font-bold font-mono-tabular text-red-600">
                    -${formatUsd(totalWithdrawDebit)} USDT
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Recipient Receives</span>
                  <span className="font-mono-tabular font-medium text-slate-900">
                    ${formatUsd(parsedSendAmount)} USDT
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Send Fee · Projected Balance</span>
                  <span className="font-mono-tabular font-medium text-slate-700">
                    ${formatUsd(sendFeeUsd)} · ${formatUsd(projectedBalanceAfterSend)}
                  </span>
                </div>
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                  <span className="font-semibold text-slate-900">Total Deducted</span>
                  <span className="text-base font-bold font-mono-tabular text-red-600">
                    -${formatUsd(totalSendDebit)} USDT
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Unified Deposit & Withdrawal Queue */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Deposit &amp; Withdrawal Queue
              </h2>
              <span className="text-xs text-slate-500 font-mono-tabular">
                {unifiedQueue.length} request{unifiedQueue.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Mobile Queue Cards (< md) */}
            <div className="md:hidden border border-slate-200 rounded-2xl bg-white divide-y divide-slate-100 overflow-hidden">
              {unifiedQueue.length === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-slate-500">
                  No deposit or withdrawal requests submitted yet.
                </div>
              ) : (
                unifiedQueue.map((item) => {
                  const isDeposit = item.kind === 'DEPOSIT';
                  const statusColor =
                    item.status === 'APPROVED'
                      ? 'text-emerald-600'
                      : item.status === 'REJECTED'
                      ? 'text-red-600'
                      : 'text-amber-600';
                  const statusLabel =
                    item.status === 'APPROVED'
                      ? 'Success'
                      : item.status === 'REJECTED'
                      ? 'Rejected'
                      : 'Pending';
                  const amtColor =
                    item.status === 'REJECTED'
                      ? 'text-red-600'
                      : isDeposit
                      ? 'text-emerald-600'
                      : 'text-red-600';

                  return (
                    <div key={`m-q-${item.id}`} className="px-4 py-3.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <GatewayLogo gateway={item.gateway} size="md" showText={false} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900">
                            {isDeposit ? 'Deposit' : 'Withdraw'} · {item.gateway}
                          </div>
                          <div className="text-[11px] font-mono-tabular text-slate-500 truncate mt-0.5">
                            {item.ref}
                          </div>
                          <div className="text-[10.5px] font-mono-tabular text-slate-400 mt-0.5">
                            {formatDateTime(item.created_at)} ·{' '}
                            <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right font-mono-tabular shrink-0">
                        <div className={`text-xs font-bold ${amtColor}`}>
                          {isDeposit
                            ? item.status === 'REJECTED'
                              ? `$${formatUsd(item.amount)}`
                              : `+$${formatUsd(item.amount)}`
                            : `-$${formatUsd(item.amount)}`}
                        </div>
                        {isDeposit && item.screenshot_data ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImage(item.screenshot_data!)}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium mt-1"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Proof</span>
                          </button>
                        ) : !isDeposit ? (
                          <div className="text-[10px] text-slate-400 mt-0.5">Fee ${formatUsd(item.fee_usd)}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden md:block border border-slate-200 rounded-xl bg-white overflow-x-auto max-h-[340px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Channel · Ref</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-right">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {unifiedQueue.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 px-4 text-center text-xs text-slate-500">
                        No deposit or withdrawal requests submitted yet.
                      </td>
                    </tr>
                  ) : (
                    unifiedQueue.map((item) => {
                      const statusColor =
                        item.status === 'APPROVED'
                          ? 'text-emerald-600'
                          : item.status === 'REJECTED'
                          ? 'text-red-600'
                          : 'text-amber-600';
                      const statusLabel =
                        item.status === 'APPROVED'
                          ? 'Success'
                          : item.status === 'REJECTED'
                          ? 'Rejected'
                          : 'Pending';

                      const isDeposit = item.kind === 'DEPOSIT';
                      const typeColor = isDeposit ? 'text-emerald-600' : 'text-red-600';
                      const amtColor =
                        item.status === 'REJECTED'
                          ? 'text-red-600'
                          : isDeposit
                          ? 'text-emerald-600'
                          : 'text-red-600';

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className={`py-3 px-4 font-semibold whitespace-nowrap ${typeColor}`}>
                            {isDeposit ? 'Deposit' : 'Withdraw'}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <GatewayLogo gateway={item.gateway} size="sm" />
                            </div>
                            <div className="font-mono-tabular text-xs text-slate-500 truncate max-w-[160px] mt-0.5">
                              {item.ref}
                            </div>
                            <div className="font-mono-tabular text-xs text-slate-400">
                              {formatDateTime(item.created_at)}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-mono-tabular whitespace-nowrap ${amtColor}`}
                          >
                            <div className="font-semibold">
                              {isDeposit
                                ? item.status === 'REJECTED'
                                  ? `$${formatUsd(item.amount)}`
                                  : `+$${formatUsd(item.amount)}`
                                : `-$${formatUsd(item.amount)}`}
                            </div>
                            {!isDeposit && (
                              <div className="text-xs text-slate-500">
                                Fee ${formatUsd(item.fee_usd)}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {isDeposit && item.screenshot_data ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImage(item.screenshot_data!)}
                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View</span>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </aside>
      </div>

      {/* Full-Width Transaction History at Bottom */}
      <TransactionHistoryTable ledger={ledger} />

      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Deposit Screenshot Proof</h3>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 text-slate-500 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewImage}
              alt="Deposit proof"
              className="w-full max-h-96 object-contain rounded-lg border border-slate-200"
            />
          </div>
        </div>
      )}

      <SecurityConfirmModal
        open={pendingAction !== null}
        title={
          pendingAction === 'DEPOSIT'
            ? 'Authorize Deposit Request'
            : pendingAction === 'WITHDRAW'
            ? 'Authorize Withdrawal Request'
            : 'Authorize Send USDT Transfer'
        }
        description={
          pendingAction === 'DEPOSIT'
            ? `Verify with your ${
                user.two_fa_enabled ? '6-digit Authenticator code' : 'Account Password'
              } to submit $${formatUsd(Number(depAmount) || 0)} USDT via ${depGateway}.`
            : pendingAction === 'WITHDRAW'
            ? `Verify with your ${
                user.two_fa_enabled ? '6-digit Authenticator code' : 'Account Password'
              } to withdraw $${formatUsd(Number(wdrAmount) || 0)} USDT (+ $${formatUsd(withdrawFeeUsd)} fee) via ${wdrGateway}.`
            : `Verify with your ${
                user.two_fa_enabled ? '6-digit Authenticator code' : 'Account Password'
              } to send $${formatUsd(Number(sendAmount) || 0)} USDT (+ $${formatUsd(sendFeeUsd)} fee) to ${sendRecipient}.`
        }
        authenticatorEnabled={Boolean(user.two_fa_enabled)}
        onClose={() => setPendingAction(null)}
        onAuthorize={authorizeAction}
      />
    </div>
  );
};
