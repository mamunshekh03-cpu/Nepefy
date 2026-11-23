import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Mail,
  RefreshCw,
  User,
} from 'lucide-react';
import { apiFetch, setStoredToken } from '../lib/api';
import type { PlatformSettings, UserProfile } from '../types';
import { NepefyLogo, NepefyMark } from './NepefyLogo';
import { LegalDocsModal, type LegalDocTab } from './LegalDocsModal';

interface SignupPageProps {
  onAuthenticated: (user: UserProfile) => void;
  onBackHome: () => void;
  onGoLogin: () => void;
}

export const SignupPage: React.FC<SignupPageProps> = ({
  onAuthenticated,
  onBackHome,
  onGoLogin,
}) => {
  const initialRef =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref')?.trim() || '' : '';

  const [step, setStep] = useState<1 | 2>(1);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [referralCode, setReferralCode] = useState(initialRef);

  const [signupOtp, setSignupOtp] = useState('');
  const [signupOtpPreview, setSignupOtpPreview] = useState<string | null>(null);
  const [otpSentEmail, setOtpSentEmail] = useState<string | null>(null);
  const [otpBlocked, setOtpBlocked] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);

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
  }, []);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const t = setTimeout(() => setOtpCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [otpCooldown]);

  const requestSignupOtp = async (targetEmail: string): Promise<boolean> => {
    setSendingOtp(true);
    setError(null);
    setInfoNotice(null);
    try {
      const res = await apiFetch<{ message: string; verificationCodePreview?: string }>('/api/auth/send-signup-otp', {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail }),
      });
      setOtpCooldown(60);
      setOtpSentEmail(targetEmail);
      setOtpBlocked(false);
      setSignupOtpPreview(res.verificationCodePreview || null);
      setSignupOtp('');
      setInfoNotice(res.message);
      return true;
    } catch (err: any) {
      setError(err.message || 'Could not send verification code');
      return false;
    } finally {
      setSendingOtp(false);
    }
  };

  const handleStepOneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      setError('Full name must be between 2 and 80 characters.');
      return;
    }
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6 || password.length > 72) {
      setError('Password must be between 6 and 72 characters.');
      return;
    }

    if (otpSentEmail === cleanEmail && !otpBlocked) {
      setStep(2);
      return;
    }

    const sent = await requestSignupOtp(cleanEmail);
    if (sent) {
      setStep(2);
    }
  };

  const handleResendOtp = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || sendingOtp || (!otpBlocked && otpCooldown > 0)) return;
    await requestSignupOtp(cleanEmail);
  };

  const handleStepTwoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const otpClean = signupOtp.trim();
    if (!/^\d{6}$/.test(otpClean)) {
      setError('Please enter the 6-digit verification code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch<{ token?: string; user?: UserProfile }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          password,
          otp_code: otpClean,
          referral_code: referralCode.trim() || undefined,
        }),
      });
      if (res.token && res.user) {
        setStoredToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      const msg = err.message || 'Account creation failed';
      if (msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('inactive')) {
        setOtpBlocked(true);
        setSignupOtp('');
      }
      setError(msg);
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

              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
                  Step {step} of 2
                </span>
                <span className="text-slate-300 text-xs">•</span>
                <span className="text-[11px] font-medium text-slate-500">
                  {step === 1 ? 'Account details' : 'Verify email'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 max-w-[140px] mx-auto mb-4">
                <div className="h-1 rounded-full bg-blue-600 transition-colors" />
                <div className={`h-1 rounded-full transition-colors ${step === 2 ? 'bg-blue-600' : 'bg-slate-200'}`} />
              </div>

              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {step === 1 ? 'Create your account' : 'Verify your email'}
              </h1>
              <p className="text-xs text-slate-500 mt-1.5">
                {step === 1
                  ? 'Enter your details to continue.'
                  : `Enter the 6-digit code sent to ${email.trim().toLowerCase()}`}
              </p>
            </div>

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

            {step === 2 && infoNotice && !otpBlocked && (
              <div className="mb-5 border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs px-3.5 py-2.5 rounded-lg space-y-1.5">
                <div className="flex items-start gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                  <span>{infoNotice}</span>
                </div>
              </div>
            )}

            {step === 1 ? (
              <form onSubmit={handleStepOneSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Full Name</label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={80}
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full h-10 pl-9 pr-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>

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
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password <span className="text-slate-400 font-normal">(Min 6 characters)</span>
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      minLength={6}
                      maxLength={72}
                      required
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create a password"
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

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Referral Code <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <div className="relative">
                    <Gift className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      placeholder="Optional referral code"
                      className="w-full h-10 pl-9 pr-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={sendingOtp}
                  className="w-full h-10.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <span>{sendingOtp ? 'Sending Verification Code...' : 'Continue'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleStepTwoSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    6-Digit Verification Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={signupOtp}
                    onChange={(e) => setSignupOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full h-11 px-3 text-base font-mono-tabular tracking-[0.28em] text-center bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                  />
                  <div className="mt-2.5 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setStep(1);
                      }}
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Edit details</span>
                    </button>

                    <button
                      type="button"
                      disabled={sendingOtp || (!otpBlocked && otpCooldown > 0)}
                      onClick={handleResendOtp}
                      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 disabled:text-slate-400 font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${sendingOtp ? 'animate-spin' : ''}`} />
                      <span>
                        {sendingOtp
                          ? 'Sending...'
                          : !otpBlocked && otpCooldown > 0
                            ? `Resend in ${otpCooldown}s`
                            : 'Resend code'}
                      </span>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || signupOtp.trim().length !== 6}
                  className="w-full h-10.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <span>{loading ? 'Creating Account...' : 'Verify & Create Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            <div className="mt-6 pt-5 border-t border-slate-100 text-center text-xs text-slate-600">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onGoLogin}
                className="font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                Sign in
              </button>
            </div>
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
