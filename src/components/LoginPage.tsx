import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldCheck, User } from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import type { PlatformSettings, UserProfile } from '../types';
import { NepefyLogo, NepefyMark } from './NepefyLogo';
import { LegalDocsModal, type LegalDocTab } from './LegalDocsModal';

interface LoginPageProps {
  onAuthenticated: (user: UserProfile) => void;
  onBackHome: () => void;
  onGoSignup: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onAuthenticated,
  onBackHome,
  onGoSignup,
}) => {
  const [mode, setMode] = useState<'LOGIN' | 'FORGOT' | 'RESET' | 'CLAIM_ADMIN'>('LOGIN');
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [adminName, setAdminName] = useState('Master Administrator');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);

  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [codePreview, setCodePreview] = useState<string | null>(null);

  const [publicSettings, setPublicSettings] = useState<PlatformSettings | null>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalDocTab>('TERMS');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ settings: PlatformSettings }>('/api/public/settings')
      .then((res) => setPublicSettings(res.settings))
      .catch(() => {});
    apiFetch<{ needsAdminSetup: boolean; defaultEmail: string }>('/api/auth/admin-bootstrap-status')
      .then((res) => {
        if (res.needsAdminSetup) {
          setNeedsAdminSetup(true);
          setAdminEmail(res.defaultEmail || 'admin@nepefy.app');
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);
    setLoading(true);
    try {
      if (mode === 'CLAIM_ADMIN') {
        const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/claim-admin', {
          method: 'POST',
          body: JSON.stringify({
            full_name: adminName.trim(),
            email: adminEmail.trim().toLowerCase(),
            password: adminPassword,
          }),
        });
        setStoredToken(res.token);
        setNeedsAdminSetup(false);
        onAuthenticated(res.user);
        return;
      }

      if (mode === 'FORGOT') {
        const res = await apiFetch<{ message: string; verificationCodePreview?: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: resetEmail.trim() }),
        });
        setCodePreview(res.verificationCodePreview || null);
        setResetCode('');
        setInfoNotice(res.message);
        setMode('RESET');
        return;
      }

      if (mode === 'RESET') {
        const res = await apiFetch<{ message: string }>('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({
            email: resetEmail.trim(),
            code: resetCode.trim(),
            new_password: newPassword,
          }),
        });
        setEmail(resetEmail.trim());
        setPassword('');
        setResetCode('');
        setNewPassword('');
        setCodePreview(null);
        setMode('LOGIN');
        setInfoNotice(res.message);
        return;
      }

      const res = await apiFetch<{ token?: string; user?: UserProfile; requires2fa?: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(needs2fa ? { totp_code: totpCode.trim() } : {}),
        }),
      });
      if (res.requires2fa) {
        setNeeds2fa(true);
        return;
      }
      if (res.token && res.user) {
        setStoredToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex flex-col justify-between">
      <header className="border-b border-slate-200 bg-white px-6 lg:px-10 h-16 flex items-center justify-between gap-6">
        <button
          type="button"
          onClick={onBackHome}
          className="text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 rounded cursor-pointer"
          aria-label="Back to Nepefy Home"
        >
          <NepefyLogo size="sm" showTagline={false} />
        </button>

        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="bg-white border border-slate-200 rounded-2xl p-7 sm:p-8 shadow-xs">
            <div className="text-center mb-6">
              <div className="flex justify-center mb-4">
                <NepefyMark size={38} />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {mode === 'CLAIM_ADMIN'
                  ? 'Claim Master Admin'
                  : mode === 'LOGIN'
                  ? 'Sign in to Nepefy'
                  : mode === 'FORGOT'
                  ? 'Reset your password'
                  : 'Enter recovery code'}
              </h1>
              <p className="text-xs text-slate-500 mt-1.5">
                {mode === 'CLAIM_ADMIN'
                  ? 'Set the initial Master Administrator credentials for this deployment.'
                  : mode === 'LOGIN'
                  ? 'Enter your email and password to continue.'
                  : mode === 'FORGOT'
                  ? 'We will send a 6-digit recovery code to your email.'
                  : 'Verify the 6-digit code and choose a new password.'}
              </p>
            </div>

            {needsAdminSetup && mode === 'LOGIN' && (
              <div className="mb-5 border border-blue-200 bg-blue-50/70 text-blue-950 text-xs px-3.5 py-3 rounded-lg flex items-center justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0">
                  <ShieldCheck className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
                  <div>
                    <div className="font-semibold">Fresh Deployment Setup</div>
                    <p className="text-blue-800 mt-0.5">No Master Admin claimed yet.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setInfoNotice(null);
                    setMode('CLAIM_ADMIN');
                  }}
                  className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Setup Admin
                </button>
              </div>
            )}

            {publicSettings?.maintenanceMode && (
              <div className="mb-5 border border-amber-200 bg-amber-50 text-amber-900 text-xs px-3.5 py-2.5 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <div className="font-semibold">Maintenance Notice</div>
                  <p className="mt-0.5">{publicSettings.maintenanceMessage}</p>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-5 border border-red-200 bg-red-50 text-red-700 text-xs px-3.5 py-2.5 rounded-lg">
                {error}
              </div>
            )}

            {infoNotice && (
              <div className="mb-5 border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs px-3.5 py-2.5 rounded-lg space-y-1.5">
                <div className="flex items-start gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                  <span>{infoNotice}</span>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'CLAIM_ADMIN' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Administrator Name</label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={80}
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                        placeholder="Master Administrator"
                        className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Admin Email Address</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="admin@yourdomain.com"
                        className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Strong Admin Password
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showAdminPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        maxLength={72}
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="8+ chars (Aa1!)"
                        className="w-full h-10 pl-9 pr-10 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAdminPassword((v) => !v)}
                        aria-label={showAdminPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Include uppercase, lowercase, number, and special symbol. Locks permanently after setup.
                    </p>
                  </div>
                </>
              ) : mode === 'LOGIN' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Email Address</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@domain.com"
                        className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-slate-700">Password</label>
                      <button
                        type="button"
                        onClick={() => {
                          setResetEmail(email.trim());
                          setCodePreview(null);
                          setError(null);
                          setInfoNotice(null);
                          setMode('FORGOT');
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        minLength={6}
                        maxLength={72}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full h-10 pl-9 pr-10 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {needs2fa && (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-lg p-3.5 space-y-2">
                      <label className="block text-xs font-semibold text-blue-900">
                        6-Digit Authenticator Code
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        required
                        autoFocus
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        className="w-full h-10 px-3 text-sm font-mono-tabular tracking-[0.22em] text-center bg-white border border-blue-200 rounded-lg focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Registered Email</label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="name@domain.com"
                        className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                      />
                    </div>
                  </div>

                  {mode === 'RESET' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          6-Digit Recovery Code
                        </label>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="\d{6}"
                          maxLength={6}
                          required
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="000000"
                          className="w-full h-10 px-3 text-sm font-mono-tabular tracking-[0.22em] text-center bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          New Password (Min 6 characters)
                        </label>
                        <div className="relative">
                          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type={showNewPassword ? 'text' : 'password'}
                            minLength={6}
                            maxLength={72}
                            required
                            autoComplete="new-password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Enter new password"
                            className="w-full h-10 pl-9 pr-10 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword((v) => !v)}
                            aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <span>
                  {loading
                    ? 'Please wait...'
                    : mode === 'CLAIM_ADMIN'
                    ? 'Create Master Admin'
                    : mode === 'LOGIN'
                    ? 'Sign In'
                    : mode === 'FORGOT'
                    ? 'Send Recovery Code'
                    : 'Reset Password'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {mode !== 'LOGIN' ? (
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('LOGIN');
                    setError(null);
                    setInfoNotice(null);
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
                </button>
              </div>
            ) : (
              <div className="mt-6 pt-5 border-t border-slate-100 text-center text-xs text-slate-600">
                Don&apos;t have an account?{' '}
                <button
                  type="button"
                  onClick={onGoSignup}
                  className="font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  Create account
                </button>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
            <button
              type="button"
              onClick={() => {
                setLegalTab('TERMS');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline cursor-pointer"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('PRIVACY');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline cursor-pointer"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('RISK');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline cursor-pointer"
            >
              Risk Disclosure
            </button>
            <button
              type="button"
              onClick={() => {
                setLegalTab('AML');
                setLegalOpen(true);
              }}
              className="hover:text-blue-600 hover:underline cursor-pointer"
            >
              AML &amp; KYC
            </button>
          </div>
        </div>
      </main>

      <LegalDocsModal open={legalOpen} initialTab={legalTab} onClose={() => setLegalOpen(false)} />
    </div>
  );
};
