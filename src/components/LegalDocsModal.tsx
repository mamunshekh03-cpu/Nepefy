import React, { useState } from 'react';
import { FileText, Lock, ShieldAlert, ShieldCheck, X } from 'lucide-react';

export type LegalDocTab = 'TERMS' | 'PRIVACY' | 'RISK' | 'AML';

interface LegalDocsModalProps {
  open: boolean;
  initialTab?: LegalDocTab;
  onClose: () => void;
}

export const LegalDocsModal: React.FC<LegalDocsModalProps> = ({
  open,
  initialTab = 'TERMS',
  onClose,
}) => {
  const [tab, setTab] = useState<LegalDocTab>(initialTab);

  React.useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  if (!open) return null;

  const tabs: { key: LegalDocTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'TERMS', label: 'Terms of Service', icon: FileText },
    { key: 'PRIVACY', label: 'Privacy Policy', icon: Lock },
    { key: 'RISK', label: 'Risk Disclosure', icon: ShieldAlert },
    { key: 'AML', label: 'AML & KYC Policy', icon: ShieldCheck },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-slate-50/70 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Nepefy Legal &amp; Compliance Center</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Effective Date: November 2026 · Digital Asset Trading, P2P Escrow &amp; Custody Framework
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-900 rounded-lg hover:bg-slate-200/60 transition-colors"
            aria-label="Close legal center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3 border-b border-slate-200 flex items-center gap-1 overflow-x-auto shrink-0 bg-white">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-600 leading-relaxed">
          {tab === 'TERMS' && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Platform Scope &amp; Eligibility</h3>
                <p className="mt-1.5">
                  By registering or operating an account on Nepefy, you confirm that you are at least 18 years old and
                  legally permitted to access digital asset spot markets, peer-to-peer (P2P) escrow settlement, staking
                  vaults, and token presale allocations under your jurisdiction&apos;s laws.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">2. Dual-Wallet Ledger &amp; Transfers</h3>
                <p className="mt-1.5">
                  Nepefy maintains separate operational <strong>Main Balance</strong>, <strong>Claimable Wallet</strong>
                  , and <strong>Escrow / Withdrawal Hold</strong> balances. Deposits submitted via Binance Pay or Bybit
                  UID require verified transaction references and pass settlement review before crediting. Withdrawal
                  fees, minimum/maximum thresholds, and P2P service fees follow the live platform schedule.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">3. Spot Trading, P2P Escrow &amp; Staking Terms</h3>
                <p className="mt-1.5">
                  Spot limit orders and leveraged position trades (including Take-Profit, Stop-Loss, and liquidation
                  thresholds) execute strictly against real-time mark feeds. P2P disputes are arbitrated using
                  in-order chat logs and uploaded payment receipts. Early emergency exits from locked Staking Vaults
                  incur the active emergency penalty rate configured on the platform.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">4. Account Security &amp; Acceptable Use</h3>
                <p className="mt-1.5">
                  Users are responsible for safeguarding account passwords and TOTP 2FA authenticators. Automated
                  scraping, wash trading, multi-account referral abuse, or fraudulent payment claims result in immediate
                  suspension and asset freeze pending investigation.
                </p>
              </div>
            </>
          )}

          {tab === 'PRIVACY' && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Information We Collect</h3>
                <p className="mt-1.5">
                  Nepefy collects account profile attributes (full name, email address, phone number, country), security
                  telemetry (session IP address, browser user-agent, 2FA verification state), financial ledger records,
                  and government-issued identity documents submitted for KYC verification.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">2. How Data Is Used &amp; Protected</h3>
                <p className="mt-1.5">
                  Your information is used solely to authenticate sessions, process deposits/withdrawals and P2P escrow
                  orders, detect unauthorized access, send transactional alerts, and satisfy regulatory compliance.
                  Passwords are stored using cryptographic bcrypt hashes, and active session tokens can be revoked
                  at any time from Security settings.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">3. Retention &amp; Third-Party Disclosure</h3>
                <p className="mt-1.5">
                  Nepefy never sells personal user data. Identity and transaction records are retained as required for
                  fraud prevention, dispute arbitration, and anti-money laundering recordkeeping.
                </p>
              </div>
            </>
          )}

          {tab === 'RISK' && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Market Volatility &amp; Capital Risk</h3>
                <p className="mt-1.5">
                  Cryptocurrency and digital token markets experience rapid, unpredictable price swings. Spot trading and
                  leveraged position orders carry substantial risk of financial loss, including full collateral
                  liquidation when adverse market movement reaches liquidation thresholds.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">2. Staking &amp; Presale Offerings</h3>
                <p className="mt-1.5">
                  Token presale allocations and staking vault yields depend on active offering parameters. Early
                  withdrawal from fixed-term staking vaults forfeits remaining unaccrued rewards and deducts the
                  applicable emergency exit fee from locked principal.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">3. No Financial Advice</h3>
                <p className="mt-1.5">
                  Live market charts, order books, and estimated portfolio equity metrics are informational tools only
                  and do not constitute investment, tax, or legal advice. Never commit funds you cannot afford to risk.
                </p>
              </div>
            </>
          )}

          {tab === 'AML' && (
            <>
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Know Your Customer (KYC) Verification</h3>
                <p className="mt-1.5">
                  To protect platform integrity and prevent illicit transfers, Nepefy verifies user identities via
                  submitted National ID (NID), Passport, or Driving License documentation alongside matching legal name
                  and optional selfie verification reviewed by compliance administrators.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">2. Anti-Money Laundering (AML) Monitoring</h3>
                <p className="mt-1.5">
                  All deposits, withdrawals, P2P settlements, internal transfers, and administrative adjustments are
                  permanently logged in immutable ledgers and admin audit trails. Suspicious payment references or
                  mismatched third-party transfers may be held for manual compliance clearance.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">3. Sanctions &amp; Prohibited Activity</h3>
                <p className="mt-1.5">
                  Users may not fund accounts from sanctioned entities, darknet marketplaces, or stolen payment
                  instruments. Confirmed violations lead to immediate termination and reporting where legally mandated.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
