import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileCheck2,
  Lock,
  LogOut,
  Monitor,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { apiFetch, formatDateTime, setStoredToken } from '../lib/api';
import { getCountryShortCode } from '../lib/countries';
import type { KycSubmission, LoginSession, UserPaymentMethod, UserPaymentMethodType, UserProfile } from '../types';
import { GatewayLogo } from './CryptoIcon';
import { AvatarCropModal } from './AvatarCropModal';
import { CountrySelect } from './CountrySelect';
import { SelectDropdown } from './SelectDropdown';
import { SecurityConfirmModal, type SensitiveActionAuthPayload } from './SecurityConfirmModal';

export type ProfileTab = 'PERSONAL' | 'PAYMENT' | 'SECURITY' | '2FA';

interface ProfileViewProps {
  user: UserProfile;
  onRefreshUser: () => Promise<void>;
  activeSubTab?: ProfileTab;
  onSubTabChange?: (tab: ProfileTab) => void;
}

const PAYMENT_METHOD_OPTIONS: UserPaymentMethodType[] = [
  'Binance Pay',
  'Bybit Pay',
  'Nagad',
  'bKash',
  'Rocket',
  'Bank Wire',
];

function getPaymentMethodFieldMeta(method: UserPaymentMethodType) {
  if (method === 'Binance Pay') {
    return {
      labelTitle: 'Account Holder / Pay Name',
      labelPlaceholder: 'e.g. Account Holder Name',
      numberTitle: 'Binance Pay ID / Email / UID',
      numberPlaceholder: 'e.g. 904182775',
      detailsTitle: 'Account Note (Optional)',
      detailsPlaceholder: 'e.g. Verified personal Binance Pay',
      detailsRequired: false,
    };
  }
  if (method === 'Bybit Pay') {
    return {
      labelTitle: 'Account Holder / Pay Name',
      labelPlaceholder: 'e.g. Account Holder Name',
      numberTitle: 'Bybit UID / Email',
      numberPlaceholder: 'e.g. 88412095',
      detailsTitle: 'Account Note (Optional)',
      detailsPlaceholder: 'e.g. Personal Bybit UID',
      detailsRequired: false,
    };
  }
  if (method === 'Bank Wire') {
    return {
      labelTitle: 'Account Holder Name',
      labelPlaceholder: 'e.g. Account Holder Name',
      numberTitle: 'Bank Account Number / IBAN',
      numberPlaceholder: 'e.g. 1204008921045',
      detailsTitle: 'Bank Name, Branch & Routing Number',
      detailsPlaceholder: 'e.g. Bank Name, Branch, Routing Number',
      detailsRequired: true,
    };
  }
  return {
    labelTitle: 'Account Holder Name',
    labelPlaceholder: 'e.g. Account Holder Name',
    numberTitle: `${method} Mobile Number`,
    numberPlaceholder: 'e.g. 017XXXXXXXX',
    detailsTitle: 'Account Type / Note (Optional)',
    detailsPlaceholder: 'e.g. Personal wallet',
    detailsRequired: false,
  };
}

function getInitials(name: string): string {
  const parts = String(name || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  onRefreshUser,
  activeSubTab,
  onSubTabChange,
}) => {
  const [internalSubTab, setInternalSubTab] = useState<ProfileTab>(activeSubTab || 'PERSONAL');
  const subTab = activeSubTab ?? internalSubTab;
  const setSubTab = (next: ProfileTab) => {
    setInternalSubTab(next);
    onSubTabChange?.(next);
  };
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<'UID' | 'REF' | 'SECRET' | null>(null);

  // Personal info edit state
  const [editingInfo, setEditingInfo] = useState(false);
  const [fullName, setFullName] = useState(user.full_name || '');
  const [email, setEmail] = useState(user.email || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [country, setCountry] = useState(user.country || '');
  const [dob, setDob] = useState(user.date_of_birth || '');
  const [address, setAddress] = useState(user.address || '');
  const [occupation, setOccupation] = useState(user.occupation || '');
  const [bio, setBio] = useState(user.bio || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [personalFieldErrors, setPersonalFieldErrors] = useState<
    Partial<Record<'full_name' | 'email' | 'phone' | 'country' | 'date_of_birth' | 'address' | 'occupation' | 'bio', string>>
  >({});
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const personalDetailsRef = useRef<HTMLFormElement | null>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // Authenticator (2FA) state
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupQrDataUrl, setSetupQrDataUrl] = useState<string | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy2fa, setBusy2fa] = useState(false);

  // Payment Methods state
  const [paymentMethods, setPaymentMethods] = useState<UserPaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [pmMethod, setPmMethod] = useState<UserPaymentMethodType>('Nagad');
  const [pmLabel, setPmLabel] = useState(user.full_name || '');
  const [pmNumber, setPmNumber] = useState('');
  const [pmDetails, setPmDetails] = useState('');
  const [pmDefault, setPmDefault] = useState(false);
  const [editingMethodId, setEditingMethodId] = useState<string | null>(null);
  const [savingMethod, setSavingMethod] = useState(false);

  // Document KYC state
  const [kycSubmissions, setKycSubmissions] = useState<KycSubmission[]>([]);
  const [kycDocType, setKycDocType] = useState<'NID' | 'PASSPORT' | 'DRIVING_LICENSE'>('NID');
  const [kycLegalName, setKycLegalName] = useState(user.full_name || '');
  const [kycDocNumber, setKycDocNumber] = useState('');
  const [kycFrontData, setKycFrontData] = useState('');
  const [kycSelfieData, setKycSelfieData] = useState('');
  const [submittingKyc, setSubmittingKyc] = useState(false);

  // Active Sessions & Login History state
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSessions, setRevokingSessions] = useState(false);

  // Pending Security Confirmation Modal state
  const [confirmAction, setConfirmAction] = useState<
    | { type: 'AVATAR_SET'; dataUrl: string }
    | { type: 'INFO' }
    | { type: 'PASSWORD' }
    | { type: 'DISABLE_2FA' }
    | { type: 'PM_CREATE' }
    | { type: 'PM_UPDATE'; id: string }
    | { type: 'PM_SET_DEFAULT'; item: UserPaymentMethod }
    | { type: 'PM_REMOVE'; item: UserPaymentMethod }
    | null
  >(null);

  const loadPaymentMethods = async () => {
    setLoadingMethods(true);
    try {
      const res = await apiFetch<{ paymentMethods?: UserPaymentMethod[] }>('/api/profile/payment-methods');
      setPaymentMethods(Array.isArray(res?.paymentMethods) ? res.paymentMethods : []);
    } catch {
      // ignore initial fetch error; explicit action handlers report errors
    } finally {
      setLoadingMethods(false);
    }
  };

  const loadKycStatus = async () => {
    try {
      const res = await apiFetch<{ submissions?: KycSubmission[] }>('/api/kyc/status');
      setKycSubmissions(Array.isArray(res?.submissions) ? res.submissions : []);
    } catch {
      // ignore initial fetch error
    }
  };

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const res = await apiFetch<{ sessions?: LoginSession[] }>('/api/security/sessions');
      setSessions(Array.isArray(res?.sessions) ? res.sessions : []);
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  };

  useEffect(() => {
    setFullName(user.full_name || '');
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setCountry(user.country || '');
    setDob(user.date_of_birth || '');
    setAddress(user.address || '');
    setOccupation(user.occupation || '');
    setBio(user.bio || '');
    if (!kycLegalName) setKycLegalName(user.full_name || '');
  }, [user]);

  useEffect(() => {
    loadPaymentMethods();
    loadKycStatus();
    loadSessions();
  }, [user.id]);

  useEffect(() => {
    setNotice(null);
    if (subTab === 'SECURITY') {
      loadSessions();
    }
  }, [activeSubTab, subTab]);

  const handleCopy = async (key: 'UID' | 'REF' | 'SECRET', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    setUploadingAvatar(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setCropImageSrc(dataUrl);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to read profile picture.' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleApplyCroppedAvatar = (croppedDataUrl: string) => {
    setCropImageSrc(null);
    setConfirmAction({ type: 'AVATAR_SET', dataUrl: croppedDataUrl });
  };

  const handleSavePersonalInfo = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const errors: Partial<
      Record<'full_name' | 'email' | 'phone' | 'country' | 'date_of_birth' | 'address' | 'occupation' | 'bio', string>
    > = {};
    if (!fullName.trim() || fullName.trim().length < 2) {
      errors.full_name = 'Full Name is required (min 2 characters).';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = 'Valid Email Address is required.';
    }
    if (!phone.trim() || phone.trim().length < 5) {
      errors.phone = 'Phone Number is required.';
    }
    if (!country.trim() || country.trim().length < 2) {
      errors.country = 'Please select your Country / Region.';
    }
    if (!dob.trim()) {
      errors.date_of_birth = 'Date of Birth is required.';
    }
    if (!address.trim() || address.trim().length < 4) {
      errors.address = 'Residential Address is required.';
    }
    if (!occupation.trim() || occupation.trim().length < 2) {
      errors.occupation = 'Occupation is required.';
    }

    if (Object.keys(errors).length > 0) {
      setPersonalFieldErrors(errors);
      setNotice({
        type: 'err',
        text: 'All Personal Details fields are required. Please complete every highlighted field below.',
      });
      return;
    }

    setPersonalFieldErrors({});
    setConfirmAction({ type: 'INFO' });
  };

  const handleCancelEdit = () => {
    setFullName(user.full_name || '');
    setEmail(user.email || '');
    setPhone(user.phone || '');
    setCountry(user.country || '');
    setDob(user.date_of_birth || '');
    setAddress(user.address || '');
    setOccupation(user.occupation || '');
    setBio(user.bio || '');
    setPersonalFieldErrors({});
    setEditingInfo(false);
  };

  const passwordChecks = {
    length: newPassword.length >= 8 && newPassword.length <= 72,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /[0-9]/.test(newPassword),
    special: /[^A-Za-z0-9]/.test(newPassword),
  };
  const passwordRuleCount = Object.values(passwordChecks).filter(Boolean).length;
  const isStrongNewPassword = passwordRuleCount === 5;

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!isStrongNewPassword) {
      setNotice({
        type: 'err',
        text: 'Strong password required: minimum 8 characters with uppercase, lowercase, number, and special character.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setNotice({ type: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    setConfirmAction({ type: 'PASSWORD' });
  };

  const executeConfirmedAction = async (auth: SensitiveActionAuthPayload) => {
    if (!confirmAction) return;

    if (confirmAction.type === 'AVATAR_SET') {
      setUploadingAvatar(true);
      try {
        const res = await apiFetch<{ user: UserProfile; token?: string }>('/api/profile', {
          method: 'PUT',
          body: JSON.stringify({ avatar_url: confirmAction.dataUrl, ...auth }),
        });
        if (res.token) setStoredToken(res.token);
        await onRefreshUser();
        setConfirmAction(null);
        setNotice({ type: 'ok', text: 'Profile picture updated successfully.' });
      } finally {
        setUploadingAvatar(false);
      }
      return;
    }

    if (confirmAction.type === 'INFO') {
      setSavingProfile(true);
      try {
        const res = await apiFetch<{ user: UserProfile; token?: string }>('/api/profile', {
          method: 'PUT',
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone,
            country,
            date_of_birth: dob,
            address,
            occupation,
            bio,
            ...auth,
          }),
        });
        if (res.token) setStoredToken(res.token);
        await onRefreshUser();
        setConfirmAction(null);
        setEditingInfo(false);
        setNotice({ type: 'ok', text: 'Personal information and account details updated.' });
      } finally {
        setSavingProfile(false);
      }
      return;
    }

    if (confirmAction.type === 'PASSWORD') {
      setSavingPassword(true);
      try {
        await apiFetch('/api/profile/password', {
          method: 'PUT',
          body: JSON.stringify({
            new_password: newPassword,
            ...auth,
          }),
        });
        setNewPassword('');
        setConfirmPassword('');
        await onRefreshUser();
        setConfirmAction(null);
        setNotice({
          type: 'ok',
          text: user.has_password
            ? 'Account password updated successfully.'
            : 'Account password set successfully.',
        });
      } finally {
        setSavingPassword(false);
      }
      return;
    }

    if (confirmAction.type === 'DISABLE_2FA') {
      setBusy2fa(true);
      try {
        await apiFetch('/api/profile/2fa/disable', {
          method: 'POST',
          body: JSON.stringify({ code: disableCode, ...auth }),
        });
        setDisableCode('');
        await onRefreshUser();
        setConfirmAction(null);
        setNotice({ type: 'ok', text: 'Authenticator verification has been disabled for your account.' });
      } finally {
        setBusy2fa(false);
      }
      return;
    }

    if (confirmAction.type === 'PM_CREATE') {
      setSavingMethod(true);
      try {
        const res = await apiFetch<{ paymentMethods: UserPaymentMethod[] }>('/api/profile/payment-methods', {
          method: 'POST',
          body: JSON.stringify({
            method: pmMethod,
            account_label: pmLabel.trim(),
            account_number: pmNumber.trim(),
            extra_details: pmDetails.trim(),
            is_default: pmDefault,
            ...auth,
          }),
        });
        setPaymentMethods(Array.isArray(res?.paymentMethods) ? res.paymentMethods : []);
        resetPaymentMethodForm();
        await onRefreshUser();
        setConfirmAction(null);
        setNotice({ type: 'ok', text: `${pmMethod} payment method saved and verified via 2FA.` });
      } finally {
        setSavingMethod(false);
      }
      return;
    }

    if (confirmAction.type === 'PM_UPDATE') {
      setSavingMethod(true);
      try {
        const res = await apiFetch<{ paymentMethods: UserPaymentMethod[] }>(
          `/api/profile/payment-methods/${confirmAction.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              method: pmMethod,
              account_label: pmLabel.trim(),
              account_number: pmNumber.trim(),
              extra_details: pmDetails.trim(),
              is_default: pmDefault,
              ...auth,
            }),
          }
        );
        setPaymentMethods(Array.isArray(res?.paymentMethods) ? res.paymentMethods : []);
        resetPaymentMethodForm();
        setConfirmAction(null);
        setNotice({ type: 'ok', text: `${pmMethod} payment method updated and verified via 2FA.` });
      } finally {
        setSavingMethod(false);
      }
      return;
    }

    if (confirmAction.type === 'PM_SET_DEFAULT') {
      setSavingMethod(true);
      try {
        const res = await apiFetch<{ paymentMethods: UserPaymentMethod[] }>(
          `/api/profile/payment-methods/${confirmAction.item.id}`,
          {
            method: 'PUT',
            body: JSON.stringify({ is_default: true, ...auth }),
          }
        );
        setPaymentMethods(Array.isArray(res?.paymentMethods) ? res.paymentMethods : []);
        setConfirmAction(null);
        setNotice({ type: 'ok', text: `${confirmAction.item.method} set as default payment method.` });
      } finally {
        setSavingMethod(false);
      }
      return;
    }

    if (confirmAction.type === 'PM_REMOVE') {
      setSavingMethod(true);
      try {
        const res = await apiFetch<{ paymentMethods: UserPaymentMethod[] }>(
          `/api/profile/payment-methods/${confirmAction.item.id}`,
          {
            method: 'DELETE',
            body: JSON.stringify({ ...auth }),
          }
        );
        setPaymentMethods(Array.isArray(res?.paymentMethods) ? res.paymentMethods : []);
        if (editingMethodId === confirmAction.item.id) {
          resetPaymentMethodForm();
        }
        await onRefreshUser();
        setConfirmAction(null);
        setNotice({ type: 'ok', text: `${confirmAction.item.method} payment method removed.` });
      } finally {
        setSavingMethod(false);
      }
    }
  };

  const resetPaymentMethodForm = () => {
    setEditingMethodId(null);
    setPmMethod('Nagad');
    setPmLabel(user.full_name || '');
    setPmNumber('');
    setPmDetails('');
    setPmDefault(false);
  };

  const handleStartEditPaymentMethod = (item: UserPaymentMethod) => {
    setNotice(null);
    setEditingMethodId(item.id);
    setPmMethod(item.method);
    setPmLabel(item.account_label);
    setPmNumber(item.account_number);
    setPmDetails(item.extra_details || '');
    setPmDefault(Boolean(item.is_default));
  };

  const handlePaymentMethodSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const meta = getPaymentMethodFieldMeta(pmMethod);
    if (pmLabel.trim().length < 2) {
      setNotice({ type: 'err', text: 'Account holder name must be at least 2 characters.' });
      return;
    }
    if (pmNumber.trim().length < 3) {
      setNotice({ type: 'err', text: `Enter a valid ${meta.numberTitle}.` });
      return;
    }
    if (meta.detailsRequired && pmDetails.trim().length < 3) {
      setNotice({ type: 'err', text: 'Enter bank name, branch, and routing details for Bank Wire.' });
      return;
    }
    if (editingMethodId) {
      setConfirmAction({ type: 'PM_UPDATE', id: editingMethodId });
    } else {
      setConfirmAction({ type: 'PM_CREATE' });
    }
  };

  const handleStart2faSetup = async () => {
    setNotice(null);
    setBusy2fa(true);
    try {
      const res = await apiFetch<{ secret: string; otpauthUrl: string }>('/api/profile/2fa/setup', {
        method: 'POST',
      });
      const qrUrl = await QRCode.toDataURL(res.otpauthUrl, {
        width: 192,
        margin: 1,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setSetupSecret(res.secret);
      setSetupQrDataUrl(qrUrl);
      setTotpVerifyCode('');
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to initialize 2FA setup.' });
    } finally {
      setBusy2fa(false);
    }
  };

  const handleVerifyEnable2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setBusy2fa(true);
    try {
      await apiFetch('/api/profile/2fa/verify-enable', {
        method: 'POST',
        body: JSON.stringify({ code: totpVerifyCode }),
      });
      setSetupSecret(null);
      setSetupQrDataUrl(null);
      setTotpVerifyCode('');
      await onRefreshUser();
      setNotice({
        type: 'ok',
        text: '2FA Verification enabled. Future logins will require your 6-digit authenticator code.',
      });
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Invalid 2FA verification code.' });
    } finally {
      setBusy2fa(false);
    }
  };

  const handleDisable2fa = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!/^\d{6}$/.test(disableCode.trim())) {
      setNotice({ type: 'err', text: 'Enter the 6-digit 2FA authenticator code first.' });
      return;
    }
    setConfirmAction({ type: 'DISABLE_2FA' });
  };

  const handleKycImagePick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'FRONT' | 'SELFIE'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (target === 'FRONT') setKycFrontData(dataUrl);
      else setKycSelfieData(dataUrl);
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Unable to read image file.' });
    }
  };

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setSubmittingKyc(true);
    try {
      await apiFetch('/api/kyc/submit', {
        method: 'POST',
        body: JSON.stringify({
          doc_type: kycDocType,
          legal_name: kycLegalName.trim(),
          doc_number: kycDocNumber.trim(),
          doc_front_data: kycFrontData,
          selfie_data: kycSelfieData || undefined,
        }),
      });
      setKycFrontData('');
      setKycSelfieData('');
      setKycDocNumber('');
      await Promise.all([loadKycStatus(), onRefreshUser()]);
      setNotice({
        type: 'ok',
        text: 'KYC identity documents submitted. An administrator will review your ID shortly.',
      });
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Failed to submit KYC documents.' });
    } finally {
      setSubmittingKyc(false);
    }
  };

  const handleRevokeOtherSessions = async () => {
    setNotice(null);
    setRevokingSessions(true);
    try {
      await apiFetch('/api/security/sessions/revoke-others', { method: 'POST' });
      await loadSessions();
      setNotice({ type: 'ok', text: 'Signed out all other active login sessions.' });
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Failed to revoke other sessions.' });
    } finally {
      setRevokingSessions(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setNotice(null);
    try {
      await apiFetch(`/api/security/sessions/${sessionId}`, { method: 'DELETE' });
      await loadSessions();
      setNotice({ type: 'ok', text: 'Session revoked.' });
    } catch (err: any) {
      setNotice({ type: 'err', text: err.message || 'Failed to revoke session.' });
    }
  };

  const sectionMeta: Record<ProfileTab, { title: string; subtitle: string }> = {
    PERSONAL: {
      title: 'Personal Info',
      subtitle: 'Manage your identity profile, regional details, and account contact information.',
    },
    PAYMENT: {
      title: 'Payment Methods',
      subtitle: 'Configure verified settlement and withdrawal payout channels for P2P and wallet transfers.',
    },
    SECURITY: {
      title: 'Password',
      subtitle: 'Update your account login password with mandatory security verification.',
    },
    '2FA': {
      title: '2FA Authenticator',
      subtitle: 'Protect withdrawals, profile edits, and P2P settlements using a 6-digit TOTP authenticator.',
    },
  };

  const activeMeta = sectionMeta[subTab];
  const countryShortCode = getCountryShortCode(user.country);

  const missingPersonalFields: string[] = [];
  if (!user.full_name || user.full_name.trim().length < 2) missingPersonalFields.push('Full Name');
  if (!user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim())) missingPersonalFields.push('Email');
  if (!user.phone || user.phone.trim().length < 5) missingPersonalFields.push('Phone Number');
  if (!user.country || user.country.trim().length < 2) missingPersonalFields.push('Country / Region');
  if (!user.date_of_birth || user.date_of_birth.trim().length < 4) missingPersonalFields.push('Date of Birth');
  if (!user.address || user.address.trim().length < 4) missingPersonalFields.push('Residential Address');
  if (!user.occupation || user.occupation.trim().length < 2) missingPersonalFields.push('Occupation');

  const computedSteps = user.verification?.steps ?? {
    personalInfo: {
      completed: missingPersonalFields.length === 0,
      missingFields: missingPersonalFields,
    },
    strongPassword: {
      completed: Boolean(user.strong_password_set),
    },
    twoFactor: {
      completed: Boolean(user.two_fa_enabled),
    },
    paymentMethod: {
      completed: paymentMethods.length > 0,
      count: paymentMethods.length,
    },
  };

  const completedStepsCount =
    (computedSteps.personalInfo.completed ? 1 : 0) +
    (computedSteps.strongPassword.completed ? 1 : 0) +
    (computedSteps.twoFactor.completed ? 1 : 0) +
    (computedSteps.paymentMethod.completed ? 1 : 0);
  const totalStepsCount = 4;
  const verificationPct = Math.round((completedStepsCount / totalStepsCount) * 100);
  const isProfileVerified = completedStepsCount === totalStepsCount && user.kyc_status === 'VERIFIED';

  const verificationStepList = [
    {
      key: 'personalInfo',
      stepNumber: 1,
      title: 'Complete Personal Info',
      completed: computedSteps.personalInfo.completed,
      summary: computedSteps.personalInfo.completed
        ? 'All required personal, address & occupation details saved.'
        : `Missing: ${computedSteps.personalInfo.missingFields.join(', ')}`,
      actionLabel: 'Complete Info',
      onAction: () => {
        setSubTab('PERSONAL');
        setEditingInfo(true);
        setTimeout(() => {
          personalDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
      },
    },
    {
      key: 'strongPassword',
      stepNumber: 2,
      title: 'Set Strong Password',
      completed: computedSteps.strongPassword.completed,
      summary: computedSteps.strongPassword.completed
        ? 'Strong password active (8+ chars, mixed case, number & symbol).'
        : 'Use 8+ chars with uppercase, lowercase, number & special symbol.',
      actionLabel: 'Set Password',
      onAction: () => {
        setNotice(null);
        setSubTab('SECURITY');
      },
    },
    {
      key: 'twoFactor',
      stepNumber: 3,
      title: 'Enable 2FA Authenticator',
      completed: computedSteps.twoFactor.completed,
      summary: computedSteps.twoFactor.completed
        ? '6-digit TOTP Authenticator verification is active.'
        : 'Pair Google Authenticator or Authy to protect your account.',
      actionLabel: 'Enable 2FA',
      onAction: () => {
        setNotice(null);
        setSubTab('2FA');
      },
    },
    {
      key: 'paymentMethod',
      stepNumber: 4,
      title: 'Add Payment Method',
      completed: computedSteps.paymentMethod.completed,
      summary: computedSteps.paymentMethod.completed
        ? `${computedSteps.paymentMethod.count} verified payout channel${computedSteps.paymentMethod.count === 1 ? '' : 's'} saved.`
        : computedSteps.twoFactor.completed
        ? 'Add at least 1 Binance Pay, Bybit, wallet, or bank account.'
        : 'Enable 2FA first, then add at least 1 payout payment method.',
      actionLabel: 'Add Method',
      onAction: () => {
        setNotice(null);
        setSubTab('PAYMENT');
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{activeMeta.title}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{activeMeta.subtitle}</p>
      </div>

      {/* Compact Verification Progress Strip on Sub-Pages */}
      {subTab !== 'PERSONAL' && (
        <div className="border border-slate-200 rounded-xl bg-white px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <ShieldCheck
              className={`w-4 h-4 shrink-0 ${isProfileVerified ? 'text-emerald-600' : 'text-blue-600'}`}
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900">
                {isProfileVerified
                  ? 'Profile Verified (4/4 Steps Completed)'
                  : `Profile Verification: ${completedStepsCount} of ${totalStepsCount} steps completed`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                style={{ width: `${verificationPct}%` }}
                className={`h-full rounded-full transition-all duration-300 ${
                  isProfileVerified ? 'bg-emerald-500' : 'bg-blue-600'
                }`}
              />
            </div>
            <span className="text-xs font-mono-tabular font-bold text-slate-800">{verificationPct}%</span>
            <button
              type="button"
              onClick={() => setSubTab('PERSONAL')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
            >
              View Checklist
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            notice.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Identity Overview Card (Personal Info only) */}
      {subTab === 'PERSONAL' && (
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          {/* Top Row: Avatar (with inline upload trigger) & Core Identity */}
          <div className="px-5 py-4 flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={handleAvatarSelected}
              className="hidden"
            />
            <div className="shrink-0 flex flex-col items-center">
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                title={user.avatar_url ? 'Change Photo' : 'Upload Photo'}
                aria-label={user.avatar_url ? 'Change Photo' : 'Upload Photo'}
                className="group relative w-16 h-16 rounded-xl border border-slate-200 bg-slate-100 flex items-center justify-center cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-60"
              >
                <div className="w-full h-full rounded-xl overflow-hidden flex items-center justify-center">
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.full_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-lg font-bold text-slate-700">{getInitials(user.full_name)}</span>
                  )}
                </div>
                <span className="absolute inset-0 rounded-xl bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-4 h-4 text-white" />
                </span>
                <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-xs flex items-center justify-center text-blue-600 group-hover:bg-blue-50 transition-colors">
                  <Camera className="w-3.5 h-3.5" />
                </span>
              </button>
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 truncate">
                  {user.full_name}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                    user.kyc_status === 'VERIFIED' ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{user.kyc_status === 'VERIFIED' ? 'Verified' : user.kyc_status || 'Unverified'}</span>
                </span>
              </div>

              <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="text-slate-700 font-medium">{user.email}</span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                {user.country ? (
                  <span className="font-medium text-slate-700">
                    {user.country}
                    {countryShortCode ? (
                      <span className="font-mono-tabular text-slate-500 ml-1">({countryShortCode})</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-slate-400">Country not set</span>
                )}
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>
                  Member since{' '}
                  <span className="font-mono-tabular text-slate-700">{formatDateTime(user.created_at)}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Row: 4-Column Account Telemetry Strip */}
          <div className="border-t border-slate-200 bg-slate-50/40 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <div className="px-5 py-3 border-b sm:border-r lg:border-b-0 border-slate-200 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-slate-500">User UID</div>
                <div className="text-sm font-semibold font-mono-tabular text-slate-900 mt-0.5">
                  {user.uid || user.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('UID', user.uid || user.id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
              >
                {copiedKey === 'UID' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div className="px-5 py-3 border-b lg:border-r lg:border-b-0 border-slate-200 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-slate-500">Referral Code</div>
                <div className="text-sm font-semibold font-mono-tabular text-slate-900 mt-0.5">
                  {user.referral_code}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCopy('REF', user.referral_code)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
              >
                {copiedKey === 'REF' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>

            <div className="px-5 py-3 border-b sm:border-b-0 sm:border-r border-slate-200">
              <div className="text-[11px] font-medium text-slate-500">Account Tier &amp; Status</div>
              <div className="text-sm font-semibold font-mono-tabular text-slate-900 mt-0.5">
                {user.role} · <span className="text-emerald-600">{user.status || 'ACTIVE'}</span>
              </div>
            </div>

            <div className="px-5 py-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-medium text-slate-500">2FA Authenticator</div>
                <div
                  className={`text-sm font-semibold mt-0.5 ${
                    user.two_fa_enabled ? 'text-emerald-600' : 'text-slate-700'
                  }`}
                >
                  {user.two_fa_enabled ? 'Enabled' : 'Disabled'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubTab('2FA')}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap"
              >
                {user.two_fa_enabled ? 'Manage' : 'Enable'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Verification Progress & Checklist Card (Personal Info) */}
      {subTab === 'PERSONAL' && (
        <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
          <div className="px-5 py-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    isProfileVerified ? 'text-emerald-600' : 'text-blue-600'
                  }`}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">Profile Verification</h2>
                    <span
                      className={`text-xs font-semibold ${
                        isProfileVerified ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {isProfileVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {isProfileVerified
                      ? 'All 4 identity and security requirements are complete.'
                      : 'Complete all 4 required steps below to mark your profile as Verified.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-medium text-slate-500">
                  <span className="font-mono-tabular font-semibold text-slate-900">{completedStepsCount}</span> of{' '}
                  <span className="font-mono-tabular">{totalStepsCount}</span> steps
                </span>
                <span
                  className={`text-sm font-bold font-mono-tabular ${
                    isProfileVerified ? 'text-emerald-600' : 'text-blue-600'
                  }`}
                >
                  {verificationPct}%
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div
              className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={verificationPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profile verification progress"
            >
              <div
                style={{ width: `${verificationPct}%` }}
                className={`h-full rounded-full transition-all duration-500 ${
                  isProfileVerified ? 'bg-emerald-500' : 'bg-blue-600'
                }`}
              />
            </div>
          </div>

          {/* 4 Verification Steps Grid */}
          <div className="border-t border-slate-200 grid grid-cols-1 md:grid-cols-2">
            {verificationStepList.map((step, idx) => {
              const borderClasses = [
                idx < 2 ? 'md:border-b' : '',
                idx % 2 === 0 ? 'md:border-r' : '',
                idx < verificationStepList.length - 1 ? 'border-b md:border-b-0' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={step.key}
                  className={`px-5 py-3.5 border-slate-200 flex items-start justify-between gap-3 ${borderClasses} ${
                    step.completed ? 'bg-emerald-50/25' : 'bg-white'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {step.completed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-slate-300 bg-slate-50 text-[10px] font-mono-tabular font-bold text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                        {step.stepNumber}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900">{step.title}</div>
                      <p
                        className={`text-[11px] mt-0.5 leading-relaxed ${
                          step.completed ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {step.summary}
                      </p>
                    </div>
                  </div>

                  {step.completed ? (
                    <span className="text-[11px] font-semibold text-emerald-600 whitespace-nowrap shrink-0 mt-0.5">
                      Done
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={step.onAction}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline whitespace-nowrap shrink-0 mt-0.5"
                    >
                      {step.actionLabel}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 1: PERSONAL INFORMATION */}
      {subTab === 'PERSONAL' && (
        <form
          ref={personalDetailsRef}
          noValidate
          onSubmit={handleSavePersonalInfo}
          className="border border-slate-200 rounded-xl bg-white overflow-hidden"
        >
          <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
            <div className="flex items-center gap-2.5">
              <UserIcon className="w-4 h-4 text-blue-600" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">Personal Details</h2>
                <p className="text-xs text-slate-500">
                  All fields below are required for identity verification.
                </p>
              </div>
            </div>

            {!editingInfo ? (
              <button
                type="button"
                onClick={() => {
                  setPersonalFieldErrors({});
                  setEditingInfo(true);
                }}
                className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
              >
                Edit Profile
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3.5 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap"
                >
                  {savingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>

          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.full_name ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!editingInfo}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (personalFieldErrors.full_name) {
                    setPersonalFieldErrors((prev) => ({ ...prev, full_name: undefined }));
                  }
                }}
                className={`w-full h-10 px-3 text-sm border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.full_name
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.full_name && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.full_name}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.email ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                disabled={!editingInfo}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (personalFieldErrors.email) {
                    setPersonalFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }
                }}
                className={`w-full h-10 px-3 text-sm border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.email
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.email && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.email}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.phone ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Phone Number <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                disabled={!editingInfo}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (personalFieldErrors.phone) {
                    setPersonalFieldErrors((prev) => ({ ...prev, phone: undefined }));
                  }
                }}
                placeholder="+1 555 019 4820"
                className={`w-full h-10 px-3 text-sm font-mono-tabular border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.phone
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.phone && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.phone}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.country ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Country / Region <span className="text-red-500">*</span>
              </label>
              <CountrySelect
                disabled={!editingInfo}
                value={country}
                hasError={editingInfo && Boolean(personalFieldErrors.country)}
                onChange={(val) => {
                  setCountry(val);
                  if (personalFieldErrors.country && val.trim()) {
                    setPersonalFieldErrors((prev) => ({ ...prev, country: undefined }));
                  }
                }}
                placeholder="Select Country / Region"
              />
              {editingInfo && personalFieldErrors.country && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.country}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.date_of_birth ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Date of Birth <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                disabled={!editingInfo}
                value={dob}
                onChange={(e) => {
                  setDob(e.target.value);
                  if (personalFieldErrors.date_of_birth) {
                    setPersonalFieldErrors((prev) => ({ ...prev, date_of_birth: undefined }));
                  }
                }}
                className={`w-full h-10 px-3 text-sm font-mono-tabular border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.date_of_birth
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.date_of_birth && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.date_of_birth}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.occupation ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Occupation <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!editingInfo}
                value={occupation}
                onChange={(e) => {
                  setOccupation(e.target.value);
                  if (personalFieldErrors.occupation) {
                    setPersonalFieldErrors((prev) => ({ ...prev, occupation: undefined }));
                  }
                }}
                placeholder="Software Engineer / Business Owner"
                className={`w-full h-10 px-3 text-sm border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.occupation
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.occupation && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.occupation}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-xs font-medium mb-1.5 ${
                  editingInfo && personalFieldErrors.address ? 'text-red-600' : 'text-slate-600'
                }`}
              >
                Residential Address <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!editingInfo}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  if (personalFieldErrors.address) {
                    setPersonalFieldErrors((prev) => ({ ...prev, address: undefined }));
                  }
                }}
                placeholder="House 14, Road 6, Dhanmondi, Dhaka"
                className={`w-full h-10 px-3 text-sm border rounded-lg focus:outline-none ${
                  !editingInfo
                    ? 'bg-slate-50/80 text-slate-700 border-slate-200'
                    : personalFieldErrors.address
                    ? 'bg-red-50/40 border-red-500 focus:border-red-600 text-slate-900'
                    : 'bg-white border-slate-200 focus:border-blue-600'
                }`}
              />
              {editingInfo && personalFieldErrors.address && (
                <p className="mt-1 text-[11px] font-medium text-red-600">{personalFieldErrors.address}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Bio / Trading Desk Note <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                disabled={!editingInfo}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Spot & treasury participant"
                className="w-full h-10 px-3 text-sm bg-white disabled:bg-slate-50/80 disabled:text-slate-700 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        </form>
      )}

      {/* DOCUMENT KYC VERIFICATION (PERSONAL INFO) */}
      {subTab === 'PERSONAL' && (() => {
        const latestKyc = kycSubmissions[0] || user.kyc_submission || null;
        const hasPending = latestKyc?.status === 'PENDING';
        const isDocApproved = latestKyc?.status === 'APPROVED';

        return (
          <section className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <FileCheck2 className="w-4 h-4 text-blue-600" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Government ID &amp; KYC Document Verification</h2>
                  <p className="text-xs text-slate-500">
                    Submit your National ID, Passport, or Driving License for institutional identity approval.
                  </p>
                </div>
              </div>
              <span
                className={`text-xs font-semibold ${
                  isDocApproved
                    ? 'text-emerald-600'
                    : hasPending
                    ? 'text-amber-600'
                    : latestKyc?.status === 'REJECTED'
                    ? 'text-red-600'
                    : 'text-slate-500'
                }`}
              >
                {latestKyc ? `Status: ${latestKyc.status}` : 'Not Submitted'}
              </span>
            </div>

            {latestKyc && (
              <div className="px-5 py-3.5 bg-slate-50/70 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="font-semibold text-slate-900">
                    {latestKyc.doc_type.replace('_', ' ')} · {latestKyc.legal_name} ·{' '}
                    <span className="font-mono-tabular">#{latestKyc.doc_number}</span>
                  </div>
                  <div className="text-slate-500 font-mono-tabular">
                    Submitted {formatDateTime(latestKyc.created_at)}
                    {latestKyc.admin_note ? ` · Admin Note: ${latestKyc.admin_note}` : ''}
                  </div>
                </div>
                {latestKyc.status === 'REJECTED' && (
                  <span className="inline-flex items-center gap-1 text-red-600 font-medium shrink-0">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Resubmit clear photos below</span>
                  </span>
                )}
              </div>
            )}

            {!hasPending && !isDocApproved && (
              <form onSubmit={handleKycSubmit} className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Document Type</label>
                    <SelectDropdown
                      value={kycDocType}
                      onChange={(val) => setKycDocType(val)}
                      options={[
                        { value: 'NID', label: 'National ID (NID)' },
                        { value: 'PASSPORT', label: 'Passport' },
                        { value: 'DRIVING_LICENSE', label: 'Driving License' },
                      ]}
                      buttonClassName="w-full h-10 px-3 text-xs font-medium bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 text-slate-900"
                      menuClassName="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Legal Full Name (as on ID)</label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={kycLegalName}
                      onChange={(e) => setKycLegalName(e.target.value)}
                      placeholder="Full legal name as on ID"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">Document ID Number</label>
                    <input
                      type="text"
                      required
                      minLength={4}
                      value={kycDocNumber}
                      onChange={(e) => setKycDocNumber(e.target.value)}
                      placeholder="e.g. 1995401298841"
                      className="w-full h-10 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Front Photo of Government ID <span className="text-red-500">*</span>
                    </label>
                    <label className="h-11 px-3 flex items-center justify-between border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <span className="text-xs text-slate-600 truncate">
                        {kycFrontData ? 'ID front image attached' : 'Upload ID Front (PNG/JPG/WebP)'}
                      </span>
                      <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleKycImagePick(e, 'FRONT')}
                        className="hidden"
                      />
                    </label>
                    {kycFrontData && (
                      <img
                        src={kycFrontData}
                        alt="ID front preview"
                        className="h-24 w-40 object-cover rounded-lg border border-slate-200"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-700">
                      Selfie with ID <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <label className="h-11 px-3 flex items-center justify-between border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                      <span className="text-xs text-slate-600 truncate">
                        {kycSelfieData ? 'Selfie image attached' : 'Upload Selfie (PNG/JPG/WebP)'}
                      </span>
                      <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => handleKycImagePick(e, 'SELFIE')}
                        className="hidden"
                      />
                    </label>
                    {kycSelfieData && (
                      <img
                        src={kycSelfieData}
                        alt="Selfie preview"
                        className="h-24 w-40 object-cover rounded-lg border border-slate-200"
                      />
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingKyc || !kycFrontData}
                    className="px-4 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                  >
                    {submittingKyc ? 'Submitting Documents...' : 'Submit KYC Verification'}
                  </button>
                </div>
              </form>
            )}
          </section>
        );
      })()}

      {/* TAB 2: PAYMENT METHODS (2FA PROTECTED) */}
      {subTab === 'PAYMENT' && (() => {
        const fieldMeta = getPaymentMethodFieldMeta(pmMethod);
        return (
          <div className="space-y-6">
            {!user.two_fa_enabled && (
              <div className="border border-amber-200 bg-amber-50/70 rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-amber-950">
                    2FA Verification Required for Payment Methods
                  </div>
                  <p className="text-xs text-amber-900/90 leading-relaxed">
                    To set, update, or remove a payment method, your 6-digit Authenticator app (2FA) must be enabled first.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('2FA');
                    setNotice(null);
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Setup 2FA Authenticator
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Add / Edit Payment Method Form */}
              <form
                onSubmit={handlePaymentMethodSubmit}
                className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-6 space-y-5"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-2.5">
                    <CreditCard className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        {editingMethodId ? 'Update Payment Method' : 'Set Payment Method'}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        2FA Authenticator confirmation required to save
                      </p>
                    </div>
                  </div>
                  {editingMethodId && (
                    <button
                      type="button"
                      onClick={resetPaymentMethodForm}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900 whitespace-nowrap"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Select Payment Method
                  </label>
                  <SelectDropdown
                    value={pmMethod}
                    onChange={(val) => setPmMethod(val)}
                    options={PAYMENT_METHOD_OPTIONS.map((opt) => ({
                      value: opt,
                      label: opt,
                      icon: <GatewayLogo gateway={opt} size="xs" showText={false} />,
                    }))}
                    buttonClassName="w-full h-10 px-3 text-sm font-medium bg-white border border-slate-200 rounded-lg hover:border-slate-300 focus:outline-none focus:border-blue-600 text-slate-900"
                    menuClassName="w-full max-h-64 overflow-y-auto"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    {fieldMeta.labelTitle}
                  </label>
                  <input
                    type="text"
                    required
                    value={pmLabel}
                    onChange={(e) => setPmLabel(e.target.value)}
                    placeholder={fieldMeta.labelPlaceholder}
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    {fieldMeta.numberTitle}
                  </label>
                  <input
                    type="text"
                    required
                    value={pmNumber}
                    onChange={(e) => setPmNumber(e.target.value)}
                    placeholder={fieldMeta.numberPlaceholder}
                    className="w-full h-10 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    {fieldMeta.detailsTitle}
                  </label>
                  <input
                    type="text"
                    required={fieldMeta.detailsRequired}
                    value={pmDetails}
                    onChange={(e) => setPmDetails(e.target.value)}
                    placeholder={fieldMeta.detailsPlaceholder}
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>

                <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={pmDefault}
                    onChange={(e) => setPmDefault(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Set as default settlement payment method</span>
                </label>

                <button
                  type="submit"
                  disabled={savingMethod}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap"
                >
                  {savingMethod
                    ? 'Saving...'
                    : editingMethodId
                    ? 'Update & Confirm with 2FA'
                    : 'Set Payment Method & Confirm 2FA'}
                </button>
              </form>

              {/* Right: Saved Payment Methods List */}
              <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Saved Payment Methods</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {paymentMethods.length} configured ·{' '}
                      <span className={user.two_fa_enabled ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                        {user.two_fa_enabled ? '2FA Verified Actions Active' : 'Enable 2FA Required'}
                      </span>
                    </p>
                  </div>
                </div>

                {loadingMethods ? (
                  <div className="p-6 space-y-3">
                    <div className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                    <div className="h-14 rounded-lg bg-slate-100 animate-pulse" />
                  </div>
                ) : paymentMethods.length === 0 ? (
                  <div className="px-6 py-12 text-center space-y-2">
                    <p className="text-sm font-medium text-slate-900">No payment methods configured yet</p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Add your Binance Pay, Bybit Pay, Nagad, bKash, Rocket, or Bank Wire details on the left. Setting or removing any method requires 6-digit 2FA confirmation.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {paymentMethods.map((pm) => {
                      const isEditingThis = editingMethodId === pm.id;
                      return (
                        <div
                          key={pm.id}
                          className={`px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                            isEditingThis ? 'bg-blue-50/40' : 'hover:bg-slate-50/60'
                          }`}
                        >
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className="pt-0.5 shrink-0">
                              <GatewayLogo gateway={pm.method} size="md" showText={false} />
                            </div>
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="text-sm font-semibold text-slate-900">{pm.method}</span>
                                {Boolean(pm.is_default) && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-300">·</span>
                                    <span className="font-semibold text-blue-600">Default</span>
                                  </>
                                )}
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="text-slate-600 truncate">{pm.account_label}</span>
                              </div>
                              <div className="text-sm font-mono-tabular font-medium text-slate-900 break-all">
                                {pm.account_number}
                              </div>
                              <div className="text-xs text-slate-500">
                                {pm.extra_details ? (
                                  <>
                                    <span>{pm.extra_details}</span>
                                    <span className="mx-1.5 text-slate-300">·</span>
                                  </>
                                ) : null}
                                <span className="font-mono-tabular">Updated {formatDateTime(pm.updated_at)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!pm.is_default && (
                              <button
                                type="button"
                                disabled={savingMethod}
                                onClick={() => setConfirmAction({ type: 'PM_SET_DEFAULT', item: pm })}
                                className="px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
                              >
                                Set Default
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={savingMethod}
                              onClick={() => handleStartEditPaymentMethod(pm)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              disabled={savingMethod}
                              onClick={() => setConfirmAction({ type: 'PM_REMOVE', item: pm })}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-red-200 bg-white hover:bg-red-50 text-red-600 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* TAB 3: PASSWORD & LOGIN SESSIONS */}
      {subTab === 'SECURITY' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handlePasswordSubmit}
            className="lg:col-span-5 border border-slate-200 rounded-xl bg-white p-6 flex flex-col justify-between space-y-5"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-slate-200 pb-4">
                <div className="flex items-center gap-2.5">
                  <Lock className="w-4 h-4 text-blue-600" />
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {user.has_password ? 'Change Account Password' : 'Set Account Password'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {user.two_fa_enabled
                        ? 'Verified via Authenticator · '
                        : 'Verified via current Password · '}
                      <span
                        className={
                          user.strong_password_set
                            ? 'font-semibold text-emerald-600'
                            : 'text-amber-600 font-semibold'
                        }
                      >
                        {user.strong_password_set ? 'Strong Password Active' : 'Upgrade to Strong Password'}
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  New Strong Password (min 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    minLength={8}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter strong password (e.g. Trader@2026!)"
                    className="w-full h-10 pl-3 pr-10 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                    aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Live Strong Password Checklist & Strength Bar */}
                <div className="mt-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-slate-600">Password Strength</span>
                    <span
                      className={`font-semibold ${
                        !newPassword
                          ? 'text-slate-400'
                          : passwordRuleCount === 5
                          ? 'text-emerald-600'
                          : passwordRuleCount >= 3
                          ? 'text-amber-600'
                          : 'text-red-600'
                      }`}
                    >
                      {!newPassword
                        ? 'Not entered'
                        : passwordRuleCount === 5
                        ? 'Strong'
                        : passwordRuleCount >= 3
                        ? 'Fair'
                        : 'Weak'}
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {[1, 2, 3, 4, 5].map((lvl) => (
                      <div
                        key={lvl}
                        className={`h-1 rounded-full transition-colors ${
                          passwordRuleCount >= lvl
                            ? passwordRuleCount === 5
                              ? 'bg-emerald-500'
                              : passwordRuleCount >= 3
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pt-1 text-[11px]">
                    {[
                      { ok: passwordChecks.length, label: 'At least 8 characters' },
                      { ok: passwordChecks.upper, label: 'Uppercase letter (A-Z)' },
                      { ok: passwordChecks.lower, label: 'Lowercase letter (a-z)' },
                      { ok: passwordChecks.number, label: 'Number (0-9)' },
                      { ok: passwordChecks.special, label: 'Special character (!@#$)' },
                    ].map((rule) => (
                      <div
                        key={rule.label}
                        className={`flex items-center gap-1.5 ${
                          rule.ok ? 'text-emerald-700 font-medium' : 'text-slate-500'
                        }`}
                      >
                        <CheckCircle2
                          className={`w-3 h-3 shrink-0 ${rule.ok ? 'text-emerald-600' : 'text-slate-300'}`}
                        />
                        <span>{rule.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    minLength={8}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter strong password"
                    className="w-full h-10 pl-3 pr-10 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="w-full h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors"
            >
              {savingPassword
                ? 'Updating...'
                : user.has_password
                ? 'Update Account Password'
                : 'Set Account Password'}
            </button>
          </form>

          {/* Right: Active Sessions & Login History */}
          <div className="lg:col-span-7 border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Monitor className="w-4 h-4 text-blue-600" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Active Sessions &amp; Login History</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review devices signed into your account and terminate unknown sessions
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={revokingSessions || sessions.filter((s) => !s.is_revoked && !s.is_current).length === 0}
                onClick={handleRevokeOtherSessions}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-red-200 bg-white hover:bg-red-50 disabled:opacity-50 text-red-600 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{revokingSessions ? 'Revoking...' : 'Log Out All Other Sessions'}</span>
              </button>
            </div>

            {loadingSessions ? (
              <div className="p-6 space-y-3">
                <div className="h-12 bg-slate-100 rounded-lg animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No recent login sessions recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {sessions.map((ses) => (
                  <div key={ses.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 truncate max-w-md">{ses.device_info}</span>
                        {ses.is_current && !ses.is_revoked && (
                          <span className="font-semibold text-emerald-600">· Current Session</span>
                        )}
                        {ses.is_revoked && (
                          <span className="font-semibold text-slate-400">· Signed Out</span>
                        )}
                      </div>
                      <div className="font-mono-tabular text-slate-500">
                        IP: {ses.ip_address} · Last active {formatDateTime(ses.last_active_at)}
                      </div>
                    </div>

                    {!ses.is_current && !ses.is_revoked && (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(ses.id)}
                        className="px-3 py-1.5 border border-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-slate-700 font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: AUTHENTICATOR VERIFICATION */}
      {subTab === '2FA' && (
        <div className="border border-slate-200 rounded-xl bg-white p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className={`w-5 h-5 ${user.two_fa_enabled ? 'text-emerald-600' : 'text-blue-600'}`} />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Authenticator App Verification (2FA)
                </h2>
                <p className="text-xs text-slate-500">
                  Protect logins, deposits, withdrawals, P2P transfers, and account changes with time-based 6-digit codes (Google Authenticator, Authy, 1Password, or Microsoft Authenticator).
                </p>
              </div>
            </div>
            <div className="text-xs font-semibold">
              Status:{' '}
              <span className={user.two_fa_enabled ? 'text-emerald-600' : 'text-amber-600'}>
                {user.two_fa_enabled ? 'Active & Protected' : 'Not Configured'}
              </span>
            </div>
          </div>

          {user.two_fa_enabled ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 bg-emerald-50/70 border border-emerald-200 rounded-xl p-5 space-y-2">
                <div className="text-sm font-semibold text-emerald-900">Authenticator Protection Active</div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Your account ({user.email}) is protected with RFC 6238 TOTP Authenticator verification. Logins and sensitive actions (deposits, withdrawals, transfers, and profile changes) require a live 6-digit verification code.
                </p>
              </div>

              <form
                onSubmit={handleDisable2fa}
                className="lg:col-span-6 border border-slate-200 rounded-xl p-5 space-y-4 bg-slate-50/60"
              >
                <div className="text-sm font-semibold text-slate-900">Disable Authenticator</div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">6-Digit Authenticator Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-full h-9 px-3 text-sm font-mono-tabular bg-white border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy2fa}
                  className="px-4 py-2 text-xs font-semibold border border-red-200 bg-white hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                >
                  {busy2fa ? 'Verifying...' : 'Disable Authenticator'}
                </button>
              </form>
            </div>
          ) : !setupSecret ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 border border-slate-200 rounded-xl p-5">
              <div className="space-y-1 max-w-xl">
                <div className="text-sm font-semibold text-slate-900">Enable Authenticator App Verification</div>
                <p className="text-xs text-slate-600">
                  Generate a dedicated Base32 secret key and QR code to pair your authenticator app with your Nepefy account.
                </p>
              </div>
              <button
                type="button"
                disabled={busy2fa}
                onClick={handleStart2faSetup}
                className="px-4 py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {busy2fa ? 'Generating...' : 'Setup 2FA Authenticator'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-6 bg-slate-50 border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row items-center gap-5">
                {setupQrDataUrl ? (
                  <img
                    src={setupQrDataUrl}
                    alt="2FA Authenticator QR Code"
                    className="w-40 h-40 rounded-lg border border-slate-200 bg-white p-2 shrink-0"
                  />
                ) : null}
                <div className="space-y-3 min-w-0">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">Step 1: Scan QR or Copy Secret Key</div>
                    <p className="text-xs text-slate-600 mt-1">
                      Scan this QR code in Google Authenticator / Authy, or enter the manual setup key below.
                    </p>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-mono-tabular font-bold text-slate-900 break-all">
                      {setupSecret}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy('SECRET', setupSecret)}
                      className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                    >
                      {copiedKey === 'SECRET' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              <form
                onSubmit={handleVerifyEnable2fa}
                className="lg:col-span-6 border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-900">Step 2: Enter 6-Digit Verification Code</div>
                  <p className="text-xs text-slate-500 mt-1">
                    Enter the current 6-digit code displayed in your authenticator app to confirm and activate 2FA.
                  </p>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  value={totpVerifyCode}
                  onChange={(e) => setTotpVerifyCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full h-11 px-3 text-base font-mono-tabular tracking-[0.25em] text-center bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSetupSecret(null);
                      setSetupQrDataUrl(null);
                      setTotpVerifyCode('');
                    }}
                    className="px-4 py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy2fa || totpVerifyCode.length !== 6}
                    className="flex-1 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg"
                  >
                    {busy2fa ? 'Verifying Code...' : 'Verify & Activate 2FA'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      <SecurityConfirmModal
        open={confirmAction !== null}
        title={
          confirmAction?.type === 'PASSWORD'
            ? 'Authorize Password Update'
            : confirmAction?.type === 'DISABLE_2FA'
            ? 'Authorize Disable Authenticator'
            : confirmAction?.type === 'AVATAR_SET'
            ? 'Authorize Profile Picture Change'
            : confirmAction?.type === 'PM_CREATE'
            ? 'Confirm 2FA to Set Payment Method'
            : confirmAction?.type === 'PM_UPDATE'
            ? 'Confirm 2FA to Update Payment Method'
            : confirmAction?.type === 'PM_SET_DEFAULT'
            ? 'Confirm 2FA to Change Default Method'
            : confirmAction?.type === 'PM_REMOVE'
            ? `Confirm 2FA to Remove ${confirmAction.item.method}`
            : 'Authorize Personal Info Update'
        }
        description={
          confirmAction?.type === 'PM_CREATE' ||
          confirmAction?.type === 'PM_UPDATE' ||
          confirmAction?.type === 'PM_SET_DEFAULT' ||
          confirmAction?.type === 'PM_REMOVE'
            ? '2FA Verification is strictly required to set, update, or remove a payment method.'
            : user.two_fa_enabled
            ? 'Verify with your 6-digit Authenticator code to apply this account change.'
            : 'Verify with your Account Password to apply this account change.'
        }
        authenticatorEnabled={Boolean(user.two_fa_enabled)}
        require2fa={
          confirmAction?.type === 'PM_CREATE' ||
          confirmAction?.type === 'PM_UPDATE' ||
          confirmAction?.type === 'PM_SET_DEFAULT' ||
          confirmAction?.type === 'PM_REMOVE'
        }
        onGoTo2faSetup={() => {
          setSubTab('2FA');
          setNotice(null);
        }}
        onClose={() => setConfirmAction(null)}
        onAuthorize={executeConfirmedAction}
      />

      <AvatarCropModal
        open={cropImageSrc !== null}
        imageSrc={cropImageSrc}
        onClose={() => setCropImageSrc(null)}
        onApply={handleApplyCroppedAvatar}
      />
    </div>
  );
};
