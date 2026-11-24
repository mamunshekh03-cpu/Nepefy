import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, HardDrive, KeyRound, Mail, RefreshCw, Save, Server, Settings, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { PlatformSettings } from '../../types';
import type { RunActionFn } from './adminTypes';

interface HealthStatus {
  status: string;
  database: string;
  storage: string;
  emailConfigured: boolean;
  jwtConfigured: boolean;
  adminConfigured: boolean;
  marketsCount: number;
  wsClients: number;
  environment: string;
  uptime: number;
}

interface AdminSettingsTabProps {
  initialSettings?: PlatformSettings;
  runAction: RunActionFn;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  binancePayId: '904182775',
  bybitUid: '55109283',
  minDepositUsd: 10,
  maxDepositUsd: 100000,
  minWithdrawUsd: 10,
  maxWithdrawUsd: 50000,
  withdrawFeeUsd: 1.0,
  p2pFeeUsd: 0.1,
  sendFeeUsd: 0.2,
  presaleNetworkFeeUsd: 0.5,
  spotMakerFeePct: 0.02,
  spotTakerFeePct: 0.03,
  stakingEmergencyPenaltyRate: 0.005,
  maintenanceMode: false,
  maintenanceMessage: 'Scheduled exchange maintenance is in progress. Please check back shortly.',
};

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({ initialSettings, runAction }) => {
  const s = initialSettings || DEFAULT_SETTINGS;
  const [binancePayId, setBinancePayId] = useState(s.binancePayId);
  const [bybitUid, setBybitUid] = useState(s.bybitUid);
  const [minDepositUsd, setMinDepositUsd] = useState(String(s.minDepositUsd));
  const [maxDepositUsd, setMaxDepositUsd] = useState(String(s.maxDepositUsd));
  const [minWithdrawUsd, setMinWithdrawUsd] = useState(String(s.minWithdrawUsd));
  const [maxWithdrawUsd, setMaxWithdrawUsd] = useState(String(s.maxWithdrawUsd));
  const [withdrawFeeUsd, setWithdrawFeeUsd] = useState(String(s.withdrawFeeUsd));
  const [p2pFeeUsd, setP2pFeeUsd] = useState(String(s.p2pFeeUsd));
  const [sendFeeUsd, setSendFeeUsd] = useState(String(s.sendFeeUsd));
  const [presaleNetworkFeeUsd, setPresaleNetworkFeeUsd] = useState(String(s.presaleNetworkFeeUsd));
  const [spotMakerFeePct, setSpotMakerFeePct] = useState(String(s.spotMakerFeePct ?? 0.02));
  const [spotTakerFeePct, setSpotTakerFeePct] = useState(String(s.spotTakerFeePct ?? 0.03));
  const [penaltyPct, setPenaltyPct] = useState(String((s.stakingEmergencyPenaltyRate * 100).toFixed(2)));
  const [maintenanceMode, setMaintenanceMode] = useState(Boolean(s.maintenanceMode));
  const [maintenanceMessage, setMaintenanceMessage] = useState(s.maintenanceMessage);
  const [androidApkUrl, setAndroidApkUrl] = useState(s.androidApkUrl || '');
  const [androidApkVersion, setAndroidApkVersion] = useState(s.androidApkVersion || '2.4.0');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [localNotice, setLocalNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadHealth = async () => {
    setCheckingHealth(true);
    try {
      const res = await apiFetch<HealthStatus>('/api/health');
      setHealth(res);
    } catch {
      // keep existing state if transient error
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    loadHealth().catch(() => {});
  }, []);

  useEffect(() => {
    if (!initialSettings) return;
    setBinancePayId(initialSettings.binancePayId);
    setBybitUid(initialSettings.bybitUid);
    setMinDepositUsd(String(initialSettings.minDepositUsd));
    setMaxDepositUsd(String(initialSettings.maxDepositUsd));
    setMinWithdrawUsd(String(initialSettings.minWithdrawUsd));
    setMaxWithdrawUsd(String(initialSettings.maxWithdrawUsd));
    setWithdrawFeeUsd(String(initialSettings.withdrawFeeUsd));
    setP2pFeeUsd(String(initialSettings.p2pFeeUsd));
    setSendFeeUsd(String(initialSettings.sendFeeUsd));
    setPresaleNetworkFeeUsd(String(initialSettings.presaleNetworkFeeUsd));
    setSpotMakerFeePct(String(initialSettings.spotMakerFeePct ?? 0.02));
    setSpotTakerFeePct(String(initialSettings.spotTakerFeePct ?? 0.03));
    setPenaltyPct(String((initialSettings.stakingEmergencyPenaltyRate * 100).toFixed(2)));
    setMaintenanceMode(Boolean(initialSettings.maintenanceMode));
    setMaintenanceMessage(initialSettings.maintenanceMessage);
    setAndroidApkUrl(initialSettings.androidApkUrl || '');
    setAndroidApkVersion(initialSettings.androidApkVersion || '2.4.0');
  }, [initialSettings]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalNotice(null);
    const rate = Math.max(0, Math.min(25, Number(penaltyPct) || 0)) / 100;
    runAction(async () => {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          binancePayId: binancePayId.trim(),
          bybitUid: bybitUid.trim(),
          minDepositUsd: Number(minDepositUsd),
          maxDepositUsd: Number(maxDepositUsd),
          minWithdrawUsd: Number(minWithdrawUsd),
          maxWithdrawUsd: Number(maxWithdrawUsd),
          withdrawFeeUsd: Number(withdrawFeeUsd),
          p2pFeeUsd: Number(p2pFeeUsd),
          sendFeeUsd: Number(sendFeeUsd),
          presaleNetworkFeeUsd: Number(presaleNetworkFeeUsd),
          spotMakerFeePct: Number(spotMakerFeePct),
          spotTakerFeePct: Number(spotTakerFeePct),
          stakingEmergencyPenaltyRate: Number(rate.toFixed(4)),
          maintenanceMode,
          maintenanceMessage: maintenanceMessage.trim(),
          androidApkUrl: androidApkUrl.trim(),
          androidApkVersion: androidApkVersion.trim() || '2.4.0',
        }),
      });
      setLocalNotice({ type: 'ok', text: 'Settings saved successfully! All fees, limits, and gateway IDs are now live.' });
      return 'Platform gateway, fee, limit, mobile APK, and maintenance settings updated live.';
    }).catch((err: any) => {
      setLocalNotice({ type: 'err', text: err?.message || 'Failed to save settings. Please try again.' });
    });
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* Header Banner */}
      <div className="border border-slate-200 rounded-xl bg-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <Settings className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">System Settings &amp; Treasury Gateways</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Changes apply immediately across Wallet Deposit/Withdraw/Send, P2P Escrow, Staking Emergency Exit, and Presale Rounds.
            </p>
          </div>
        </div>

        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save Platform Settings</span>
        </button>
      </div>

      {/* Local save notice */}
      {localNotice && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${
          localNotice.type === 'ok'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {localNotice.type === 'ok'
            ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            : <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />}
          <span className="flex-1">{localNotice.text}</span>
          <button type="button" onClick={() => setLocalNotice(null)} className="text-xs underline opacity-70 hover:opacity-100 shrink-0">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Treasury Payment Gateway IDs */}
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-900">Treasury Receiving Channels</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Displayed to all users on the Wallet Deposit screen
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Official Binance Pay ID
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={binancePayId}
                onChange={(e) => setBinancePayId(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Official Bybit UID
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={bybitUid}
                onChange={(e) => setBybitUid(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </section>

        {/* Maintenance Mode Control */}
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Exchange Maintenance Mode</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Pauses non-admin financial writes and trading while showing a live notice
              </p>
            </div>
            <span
              className={`text-xs font-semibold ${
                maintenanceMode ? 'text-amber-600' : 'text-emerald-600'
              }`}
            >
              {maintenanceMode ? 'Maintenance ON' : 'Operational'}
            </span>
          </div>
          <div className="p-5 space-y-4">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/60 cursor-pointer">
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={(e) => setMaintenanceMode(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600"
              />
              <div className="text-xs">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  {maintenanceMode ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  <span>Enable Platform-Wide Maintenance Lock</span>
                </div>
                <p className="text-slate-500 mt-0.5">
                  Admin sessions stay unrestricted so you can settle queues and re-open the platform safely.
                </p>
              </div>
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Public Maintenance Banner Message
              </label>
              <input
                type="text"
                maxLength={280}
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                className="w-full h-10 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </section>

        {/* Deposit & Withdrawal Limits */}
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-900">Deposit &amp; Withdrawal Limits (USDT)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Enforced server-side on all user funding requests
            </p>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Min Deposit (USDT)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={minDepositUsd}
                onChange={(e) => setMinDepositUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Max Deposit (USDT)</label>
              <input
                type="number"
                min="10"
                step="0.01"
                required
                value={maxDepositUsd}
                onChange={(e) => setMaxDepositUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Min Withdrawal (USDT)</label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={minWithdrawUsd}
                onChange={(e) => setMinWithdrawUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Max Withdrawal (USDT)</label>
              <input
                type="number"
                min="10"
                step="0.01"
                required
                value={maxWithdrawUsd}
                onChange={(e) => setMaxWithdrawUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </section>

        {/* Fee Schedule & Staking Penalty */}
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-900">Platform Fee &amp; Staking Exit Policy</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Flat service fees in USDT and early staking principal exit penalty percentage
            </p>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Withdrawal Fee (USDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={withdrawFeeUsd}
                onChange={(e) => setWithdrawFeeUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Send Transfer Fee (USDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={sendFeeUsd}
                onChange={(e) => setSendFeeUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">P2P Escrow Fee (USDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={p2pFeeUsd}
                onChange={(e) => setP2pFeeUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Presale Network Fee (USDT)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={presaleNetworkFeeUsd}
                onChange={(e) => setPresaleNetworkFeeUsd(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Spot Maker Fee (%)</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                required
                value={spotMakerFeePct}
                onChange={(e) => setSpotMakerFeePct(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Spot Taker Fee (%)</label>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                required
                value={spotTakerFeePct}
                onChange={(e) => setSpotTakerFeePct(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Staking Emergency Exit Penalty (%)
              </label>
              <input
                type="number"
                min="0"
                max="25"
                step="0.01"
                required
                value={penaltyPct}
                onChange={(e) => setPenaltyPct(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Default is 0.50%. Applied to locked principal when a user triggers immediate Emergency Payout.
              </p>
            </div>
          </div>
        </section>

        {/* Mobile App & Android APK Distribution */}
        <section className="lg:col-span-2 border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50">
            <h3 className="text-sm font-semibold text-slate-900">Mobile App &amp; Android APK Distribution</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Optional direct .apk release link served via /downloads/nepefy.apk on the Home Page mobile download section
            </p>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Android APK Download URL (https://...)
              </label>
              <input
                type="url"
                value={androidApkUrl}
                onChange={(e) => setAndroidApkUrl(e.target.value)}
                placeholder="https://your-cdn-or-supabase-storage/nepefy-v2.4.0.apk"
                className="w-full h-10 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                App Release Version
              </label>
              <input
                type="text"
                maxLength={24}
                value={androidApkVersion}
                onChange={(e) => setAndroidApkVersion(e.target.value)}
                placeholder="2.4.0"
                className="w-full h-10 px-3 text-xs font-mono-tabular border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </section>

        {/* Live Backend & Deployment Readiness */}
        <section className="lg:col-span-2 border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Server className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Live Backend &amp; Deployment Readiness</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real-time server diagnostics from /api/health for production environment verification
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadHealth()}
              disabled={checkingHealth}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
              <span>Check Health</span>
            </button>
          </div>
          {health ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-xs">
              <div className="p-4 space-y-1">
                <div className="text-slate-500 flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5" />
                  <span>Database Engine</span>
                </div>
                <div className="font-semibold text-slate-900 font-mono-tabular uppercase">
                  {health.database === 'postgres' ? 'PostgreSQL (Persistent)' : 'SQLite (Local File)'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {health.database === 'postgres' ? 'Ready for horizontal deploy' : 'Set DATABASE_URL for cloud DB'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="text-slate-500 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Asset Storage</span>
                </div>
                <div className="font-semibold text-slate-900 font-mono-tabular uppercase">
                  {health.storage === 'supabase' ? 'Supabase Bucket' : 'Database Inline'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {health.storage === 'supabase' ? 'External CDN active' : 'Set SUPABASE_* for bucket storage'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="text-slate-500 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  <span>Email OTP Delivery</span>
                </div>
                <div className={`font-semibold flex items-center gap-1 ${health.emailConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{health.emailConfigured ? 'Configured' : 'Unconfigured'}</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {health.emailConfigured ? 'Resend / SMTP active' : 'Set RESEND_API_KEY or SMTP_*'}
                </div>
              </div>

              <div className="p-4 space-y-1">
                <div className="text-slate-500 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>JWT &amp; Live Engine</span>
                </div>
                <div className={`font-semibold ${health.jwtConfigured ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {health.jwtConfigured ? 'Env Secret Active' : 'Ephemeral Session Key'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono-tabular">
                  {health.marketsCount} pairs · {health.wsClients} WS · {health.environment}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-5 text-xs text-slate-500">Loading server readiness diagnostics...</div>
          )}
        </section>
      </div>
    </form>
  );
};
