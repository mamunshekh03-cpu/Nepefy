import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Smartphone, X } from 'lucide-react';

export interface SensitiveActionAuthPayload {
  totp_code?: string;
  password?: string;
}

interface SecurityConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  authenticatorEnabled?: boolean;
  require2fa?: boolean;
  onGoTo2faSetup?: () => void;
  onClose: () => void;
  onAuthorize: (auth: SensitiveActionAuthPayload) => Promise<void>;
}

export const SecurityConfirmModal: React.FC<SecurityConfirmModalProps> = ({
  open,
  title,
  description,
  authenticatorEnabled = false,
  require2fa = false,
  onGoTo2faSetup,
  onClose,
  onAuthorize,
}) => {
  const [totpCode, setTotpCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTotpCode('');
      setPassword('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const missingRequired2fa = require2fa && !authenticatorEnabled;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired2fa) return;

    if (authenticatorEnabled) {
      if (!/^\d{6}$/.test(totpCode)) {
        setError('Authenticator code must be exactly 6 numeric digits.');
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await onAuthorize({ totp_code: totpCode });
      } catch (err: any) {
        setError(err?.message || 'Authenticator verification failed');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!password) {
      setError('Enter your Account Password to confirm.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onAuthorize({ password });
    } catch (err: any) {
      setError(err?.message || 'Password verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-900 rounded-md"
            aria-label="Close security verification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-3.5 py-2.5 rounded-lg">
            {error}
          </div>
        )}

        {missingRequired2fa ? (
          <div className="space-y-4">
            <div className="border border-amber-200 bg-amber-50/80 text-amber-900 text-xs px-3.5 py-3 rounded-lg leading-relaxed">
              2FA Authenticator is not enabled on your account yet. To set, update, or remove a payment method, please enable 6-digit 2FA Verification first.
            </div>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              {onGoTo2faSetup && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onGoTo2faSetup();
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  Setup 2FA Authenticator
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {!authenticatorEnabled && (
              <div className="border border-blue-200 bg-blue-50/70 text-blue-900 text-xs px-3.5 py-2.5 rounded-lg">
                Authenticator is not enabled yet. Confirm with your Account Password, or activate Authenticator in{' '}
                <span className="font-semibold">Profile &amp; Security → Authenticator</span>.
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {authenticatorEnabled ? (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                    <span>6-Digit 2FA Authenticator Code</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    autoFocus
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full h-11 px-3 text-lg font-mono-tabular tracking-[0.35em] text-center bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              ) : (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Account Password</span>
                  </label>
                  <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter account password"
                    className="w-full h-11 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={busy || (authenticatorEnabled ? totpCode.length !== 6 : password.length === 0)}
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                {busy
                  ? 'Verifying...'
                  : authenticatorEnabled
                  ? 'Verify 2FA & Confirm'
                  : 'Verify Password & Confirm'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
