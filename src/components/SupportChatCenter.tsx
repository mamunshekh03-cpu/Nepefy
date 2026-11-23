import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Headphones,
  ImagePlus,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { apiFetch, formatDateTime, formatUsd } from '../lib/api';
import type {
  SupportLiveSignal,
  SupportMessage,
  SupportThread,
  SupportThreadCategory,
  UserProfile,
} from '../types';
import { SelectDropdown } from './SelectDropdown';

interface SupportChatCenterProps {
  mode: 'USER' | 'ADMIN';
  currentUser: UserProfile;
  liveSignal: SupportLiveSignal | null;
  allUsers?: UserProfile[];
  initialUserId?: string | null;
  onClearInitialUser?: () => void;
  onUnreadChange?: (count: number) => void;
}

const CATEGORY_OPTIONS: { value: SupportThreadCategory; label: string }[] = [
  { value: 'GENERAL', label: 'General Support' },
  { value: 'DEPOSIT_WITHDRAW', label: 'Deposit & Withdrawal' },
  { value: 'P2P_DISPUTE', label: 'P2P Order & Appeal' },
  { value: 'ACCOUNT_KYC', label: 'Account & Verification' },
  { value: 'TRADING', label: 'Spot & Staking' },
];

const CATEGORY_LABELS: Record<SupportThreadCategory, string> = {
  GENERAL: 'General',
  DEPOSIT_WITHDRAW: 'Funding',
  P2P_DISPUTE: 'P2P Appeal',
  ACCOUNT_KYC: 'Account & KYC',
  TRADING: 'Trading',
};

export const SupportChatCenter: React.FC<SupportChatCenterProps> = ({
  mode,
  currentUser,
  liveSignal,
  allUsers = [],
  initialUserId = null,
  onClearInitialUser,
  onUnreadChange,
}) => {
  const isAdminMode = mode === 'ADMIN';

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED' | 'UNREAD'>('ALL');
  const [error, setError] = useState<string | null>(null);

  // New conversation modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newCategory, setNewCategory] = useState<SupportThreadCategory>('GENERAL');
  const [newMessage, setNewMessage] = useState('');
  const [newTargetUserId, setNewTargetUserId] = useState('');
  const [creatingThread, setCreatingThread] = useState(false);

  // Composer state
  const [draftText, setDraftText] = useState('');
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [copiedTicketId, setCopiedTicketId] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedThreadIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  const computeUnreadTotal = useCallback(
    (list: SupportThread[]) =>
      list.reduce((sum, t) => sum + Number(isAdminMode ? t.admin_unread || 0 : t.user_unread || 0), 0),
    [isAdminMode]
  );

  useEffect(() => {
    onUnreadChange?.(computeUnreadTotal(threads));
  }, [threads, computeUnreadTotal, onUnreadChange]);

  const fetchThreads = useCallback(
    async (silent = false) => {
      if (!silent) setRefreshing(true);
      try {
        const endpoint = isAdminMode ? '/api/admin/support/threads' : '/api/support/threads';
        const res = await apiFetch<{ threads?: SupportThread[] }>(endpoint);
        const list = Array.isArray(res?.threads) ? res.threads : [];
        setThreads(list);
        return list;
      } catch (err: any) {
        setError(err?.message || 'Unable to load support conversations.');
        return [];
      } finally {
        setLoadingThreads(false);
        setRefreshing(false);
      }
    },
    [isAdminMode]
  );

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await apiFetch<{ thread?: SupportThread; messages?: SupportMessage[] }>(
        `/api/support/threads/${threadId}/messages`
      );
      if (Array.isArray(res?.messages)) {
        setMessages(res.messages);
      }
      if (res?.thread) {
        setThreads((prev) => prev.map((t) => (t.id === res.thread!.id ? res.thread! : t)));
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads().then((list) => {
      if (list.length > 0 && !selectedThreadIdRef.current && !initialUserId) {
        setSelectedThreadId(list[0].id);
      }
    });
  }, [fetchThreads, initialUserId]);

  // If Admin navigated here from Users table with a target user ID
  useEffect(() => {
    if (!isAdminMode || !initialUserId || loadingThreads) return;
    const existing = threads.find((t) => t.user_id === initialUserId);
    if (existing) {
      setSelectedThreadId(existing.id);
    } else {
      setNewTargetUserId(initialUserId);
      setNewCategory('GENERAL');
      setNewSubject('Account Support Message');
      setNewMessage('');
      setShowNewModal(true);
    }
    onClearInitialUser?.();
  }, [isAdminMode, initialUserId, loadingThreads, threads, onClearInitialUser]);

  useEffect(() => {
    if (!selectedThreadId) {
      setMessages([]);
      return;
    }
    loadMessages(selectedThreadId);
  }, [selectedThreadId, loadMessages]);

  // Real-time WebSocket updates
  useEffect(() => {
    if (!liveSignal) return;
    const incomingThread = liveSignal.thread;
    const incomingMsg = liveSignal.message;

    if (incomingThread) {
      if (!isAdminMode && incomingThread.user_id !== currentUser.id) return;

      setThreads((prev) => {
        const exists = prev.some((t) => t.id === incomingThread.id);
        const updated = exists
          ? prev.map((t) => (t.id === incomingThread.id ? incomingThread : t))
          : [incomingThread, ...prev];
        return [...updated].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      });
    }

    if (
      liveSignal.type === 'SUPPORT_CHAT_MESSAGE' &&
      incomingMsg &&
      selectedThreadIdRef.current &&
      incomingMsg.thread_id === selectedThreadIdRef.current
    ) {
      setMessages((prev) => (prev.some((m) => m.id === incomingMsg.id) ? prev : [...prev, incomingMsg]));

      const isFromCounterparty = isAdminMode
        ? incomingMsg.sender_role === 'USER'
        : incomingMsg.sender_role === 'ADMIN';
      if (isFromCounterparty) {
        apiFetch<{ thread?: SupportThread }>(`/api/support/threads/${incomingMsg.thread_id}/read`, {
          method: 'POST',
        })
          .then((res) => {
            if (res?.thread) {
              setThreads((prev) => prev.map((t) => (t.id === res.thread!.id ? res.thread! : t)));
            }
          })
          .catch(() => {});
      }
    }
  }, [liveSignal, isAdminMode, currentUser.id]);

  // Auto-scroll message feed
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages.length, selectedThreadId]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === selectedThreadId) || null,
    [threads, selectedThreadId]
  );

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return threads.filter((t) => {
      if (statusFilter === 'OPEN' && t.status !== 'OPEN') return false;
      if (statusFilter === 'RESOLVED' && t.status !== 'RESOLVED') return false;
      const unread = isAdminMode ? Number(t.admin_unread || 0) : Number(t.user_unread || 0);
      if (statusFilter === 'UNREAD' && unread === 0) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.user_name || '').toLowerCase().includes(q) ||
        (t.user_email || '').toLowerCase().includes(q) ||
        (t.user_uid || '').toLowerCase().includes(q) ||
        (t.last_message || '').toLowerCase().includes(q)
      );
    });
  }, [threads, searchQuery, statusFilter, isAdminMode]);

  const selectableUsers = useMemo(
    () =>
      allUsers
        .filter((u) => u.id !== currentUser.id && u.role !== 'ADMIN')
        .map((u) => ({
          value: u.id,
          label: `${u.full_name} (${u.email})`,
        })),
    [allUsers, currentUser.id]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Please choose a PNG, JPG, GIF, or WebP image.');
      return;
    }
    if (file.size > 1_500_000) {
      setError('Attachment image must be smaller than 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setError(null);
        setDraftImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateThread = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isAdminMode && !newTargetUserId) {
      setError('Please select a user to start the conversation.');
      return;
    }
    if (!newSubject.trim()) {
      setError('Please enter a conversation subject.');
      return;
    }
    setCreatingThread(true);
    try {
      const endpoint = isAdminMode ? '/api/admin/support/threads' : '/api/support/threads';
      const payload = isAdminMode
        ? {
            user_id: newTargetUserId,
            subject: newSubject.trim(),
            category: newCategory,
            initial_message: newMessage.trim(),
          }
        : {
            subject: newSubject.trim(),
            category: newCategory,
            initial_message: newMessage.trim(),
          };
      const res = await apiFetch<{ thread: SupportThread }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res?.thread) {
        setThreads((prev) =>
          prev.some((t) => t.id === res.thread.id) ? prev : [res.thread, ...prev]
        );
        setSelectedThreadId(res.thread.id);
      }
      setShowNewModal(false);
      setNewSubject('');
      setNewMessage('');
      setNewCategory('GENERAL');
    } catch (err: any) {
      setError(err?.message || 'Unable to start support conversation.');
    } finally {
      setCreatingThread(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeThread || sending) return;
    const text = draftText.trim();
    if (!text && !draftImage) return;

    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ thread: SupportThread; message: SupportMessage }>(
        `/api/support/threads/${activeThread.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: text,
            ...(draftImage ? { attachment_data: draftImage } : {}),
          }),
        }
      );
      setDraftText('');
      setDraftImage(null);
      if (res?.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
        );
      }
      if (res?.thread) {
        setThreads((prev) => {
          const next = prev.map((t) => (t.id === res.thread.id ? res.thread : t));
          return [...next].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!activeThread || updatingStatus) return;
    const nextStatus = activeThread.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
    setUpdatingStatus(true);
    setError(null);
    try {
      const res = await apiFetch<{ thread: SupportThread; message?: SupportMessage }>(
        `/api/support/threads/${activeThread.id}/status`,
        {
          method: 'POST',
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      if (res?.thread) {
        setThreads((prev) => prev.map((t) => (t.id === res.thread.id ? res.thread : t)));
      }
      if (res?.message) {
        setMessages((prev) =>
          prev.some((m) => m.id === res.message!.id) ? prev : [...prev, res.message!]
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to update conversation status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const totalUnread = computeUnreadTotal(threads);

  return (
    <div className="space-y-4">
      {/* Top Header Strip */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Headphones className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-slate-900">
                {isAdminMode ? 'Admin Support Chat Center' : 'User-to-Admin Support Chat Center'}
              </h2>
              {totalUnread > 0 && (
                <span className="px-2 py-0.5 text-[11px] font-semibold font-mono-tabular bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
                  {totalUnread} unread
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAdminMode
                ? 'Respond in real time to user inquiries, deposit/withdrawal checks, KYC questions, and P2P appeals.'
                : 'Direct real-time chat with Nepefy Support Administrators for deposits, withdrawals, P2P disputes, and account help.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchThreads()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              if (isAdminMode && !newTargetUserId && selectableUsers.length > 0) {
                setNewTargetUserId(selectableUsers[0].value);
              }
              setShowNewModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAdminMode ? 'Message a User' : 'New Support Chat'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-4 py-2.5 rounded-lg flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Split 2-Column Chat Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-slate-200 rounded-xl bg-white overflow-hidden min-h-[580px] lg:h-[640px]">
        {/* Left Sidebar: Thread Inbox */}
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col bg-slate-50/40 min-h-[260px] lg:min-h-0">
          <div className="p-3.5 border-b border-slate-200 space-y-2.5 bg-white">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isAdminMode
                    ? 'Search Ticket ID (SUP-...), user, UID, subject...'
                    : 'Search by Ticket ID (SUP-...) or subject...'
                }
                className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {(isAdminMode
                ? (['ALL', 'UNREAD', 'OPEN', 'RESOLVED'] as const)
                : (['ALL', 'OPEN', 'RESOLVED'] as const)
              ).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setStatusFilter(tabKey)}
                  className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    statusFilter === tabKey
                      ? 'bg-white text-slate-900 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tabKey === 'ALL'
                    ? 'All'
                    : tabKey === 'UNREAD'
                    ? 'Unread'
                    : tabKey === 'OPEN'
                    ? 'Open'
                    : 'Resolved'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-200/80">
            {loadingThreads ? (
              <div className="p-6 text-center text-xs text-slate-500">Loading conversations...</div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <MessageSquare className="w-7 h-7 text-slate-300 mx-auto" />
                <div className="text-xs font-medium text-slate-800">No conversations found</div>
                <p className="text-[11px] text-slate-500">
                  {isAdminMode
                    ? 'User support messages will appear here immediately.'
                    : 'Start a new support chat to talk directly with an administrator.'}
                </p>
              </div>
            ) : (
              filteredThreads.map((t) => {
                const active = t.id === selectedThreadId;
                const unread = isAdminMode ? Number(t.admin_unread || 0) : Number(t.user_unread || 0);
                const initials = (t.user_name || 'U')
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase())
                  .join('') || 'U';
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedThreadId(t.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors flex items-start gap-3 ${
                      active ? 'bg-blue-50/70' : 'hover:bg-white'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg border border-slate-200 bg-white flex items-center justify-center shrink-0 text-xs font-bold text-slate-700 overflow-hidden">
                      {isAdminMode ? (
                        t.user_avatar_url ? (
                          <img src={t.user_avatar_url} alt={t.user_name} className="w-full h-full object-cover" />
                        ) : (
                          initials
                        )
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-blue-600" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 truncate">
                          {isAdminMode ? t.user_name || t.user_email : t.subject}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono-tabular shrink-0">
                          {new Date(t.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-600">
                        <span className="text-slate-400 font-sans">Ticket ID:</span>
                        <span className="font-semibold text-slate-700 truncate">{t.id}</span>
                      </div>

                      {isAdminMode && (
                        <div className="text-[11px] font-medium text-slate-700 truncate">{t.subject}</div>
                      )}

                      <div className="text-[11px] text-slate-500 truncate">
                        {t.last_message || 'No messages yet'}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                            {CATEGORY_LABELS[t.category] || t.category}
                          </span>
                          <span
                            className={`font-semibold ${
                              t.status === 'RESOLVED' ? 'text-emerald-600' : 'text-amber-600'
                            }`}
                          >
                            {t.status}
                          </span>
                        </div>
                        {unread > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold font-mono-tabular bg-blue-600 text-white rounded-md">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Pane: Active Conversation */}
        <section className="lg:col-span-8 flex flex-col bg-white min-h-[420px] lg:min-h-0">
          {!activeThread ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-slate-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Select or Start a Conversation</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">
                  {isAdminMode
                    ? 'Choose any user support ticket on the left or click "Message a User" to start a live chat.'
                    : 'Choose an existing conversation on the left or click "New Support Chat" to message an admin.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Conversation Header */}
              <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-white">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 truncate">{activeThread.subject}</h3>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(activeThread.id);
                        setCopiedTicketId(true);
                        setTimeout(() => setCopiedTicketId(false), 1800);
                      }}
                      title="Copy Ticket ID"
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono-tabular bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 rounded-md transition-colors"
                    >
                      <span className="font-sans text-slate-500">Ticket ID:</span>
                      <span className="font-semibold text-slate-900">{activeThread.id}</span>
                      {copiedTicketId ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-400" />
                      )}
                    </button>
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                        activeThread.status === 'RESOLVED'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-amber-50 border-amber-200 text-amber-700'
                      }`}
                    >
                      {activeThread.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                    {isAdminMode ? (
                      <>
                        <span className="font-medium text-slate-700">{activeThread.user_name}</span>
                        <span>·</span>
                        <span>{activeThread.user_email}</span>
                        <span>·</span>
                        <span className="font-mono-tabular">UID: {activeThread.user_uid || activeThread.user_id}</span>
                        <span>·</span>
                        <span className="font-mono-tabular text-slate-700">
                          Balance: ${formatUsd(Number(activeThread.user_main_balance || 0))}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <ShieldCheck className="w-3.5 h-3.5" /> Nepefy Official Support Desk
                        </span>
                        <span>·</span>
                        <span>Category: {CATEGORY_LABELS[activeThread.category] || activeThread.category}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={updatingStatus}
                  onClick={handleToggleStatus}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                    activeThread.status === 'RESOLVED'
                      ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{activeThread.status === 'RESOLVED' ? 'Reopen Chat' : 'Mark Resolved'}</span>
                </button>
              </div>

              {/* Message Feed */}
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50/40"
              >
                {loadingMessages ? (
                  <div className="text-center py-10 text-xs text-slate-500">Loading chat history...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-10 text-xs text-slate-500">
                    No messages yet. Send the first message below.
                  </div>
                ) : (
                  messages.map((m) => {
                    if (m.sender_role === 'SYSTEM') {
                      return (
                        <div key={m.id} className="flex justify-center my-1">
                          <div className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-500 text-center max-w-md">
                            {m.body}
                          </div>
                        </div>
                      );
                    }

                    const isMine = isAdminMode ? m.sender_role === 'ADMIN' : m.sender_role === 'USER';
                    return (
                      <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">
                            {m.sender_role === 'ADMIN'
                              ? `${m.sender_name || 'Administrator'} · Admin`
                              : m.sender_name || 'User'}
                          </span>
                          <span>·</span>
                          <span className="font-mono-tabular">{formatDateTime(m.created_at)}</span>
                        </div>

                        <div
                          className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-xs space-y-2 ${
                            isMine
                              ? 'bg-blue-600 text-white'
                              : m.sender_role === 'ADMIN'
                              ? 'bg-white border border-blue-200 text-slate-900 shadow-2xs'
                              : 'bg-white border border-slate-200 text-slate-900 shadow-2xs'
                          }`}
                        >
                          {m.body && <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>}
                          {m.attachment_data && (
                            <button
                              type="button"
                              onClick={() => setPreviewImg(m.attachment_data || null)}
                              className="block border border-black/10 rounded-lg overflow-hidden bg-white"
                            >
                              <img
                                src={m.attachment_data}
                                alt="Chat attachment"
                                className="max-h-48 object-contain"
                              />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Message Composer */}
              <form
                onSubmit={handleSendMessage}
                className="p-3.5 border-t border-slate-200 bg-white space-y-2.5"
              >
                {draftImage && (
                  <div className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <img src={draftImage} alt="Attachment preview" className="h-12 w-12 object-cover rounded border border-slate-200" />
                    <span className="text-xs text-slate-600 flex-1">Screenshot ready to send</span>
                    <button
                      type="button"
                      onClick={() => setDraftImage(null)}
                      className="p-1 text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach screenshot"
                    className="h-10 w-10 shrink-0 inline-flex items-center justify-center border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg transition-colors"
                  >
                    <ImagePlus className="w-4 h-4" />
                  </button>

                  <input
                    type="text"
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder={
                      isAdminMode
                        ? 'Write a reply to the user...'
                        : 'Type your message to Support Admin...'
                    }
                    className="flex-1 h-10 px-3.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                  />

                  <button
                    type="submit"
                    disabled={sending || (!draftText.trim() && !draftImage)}
                    className="h-10 px-4 inline-flex items-center gap-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{sending ? 'Sending...' : 'Send'}</span>
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {/* Modal: Start New Conversation */}
      {showNewModal && (
        <div
          onClick={() => !creatingThread && setShowNewModal(false)}
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {isAdminMode ? 'Start Direct Chat with User' : 'New Support Conversation'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {isAdminMode
                    ? 'Send a direct real-time support message to any registered account.'
                    : 'Describe your issue and our admin support team will respond in real time.'}
                </p>
              </div>
              <button
                type="button"
                disabled={creatingThread}
                onClick={() => setShowNewModal(false)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateThread} className="space-y-3.5">
              {isAdminMode && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Select User</label>
                  <SelectDropdown
                    value={newTargetUserId}
                    onChange={(val) => setNewTargetUserId(val)}
                    options={
                      selectableUsers.length > 0
                        ? selectableUsers
                        : [{ value: '', label: 'No registered users found' }]
                    }
                    buttonClassName="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                    menuClassName="max-h-60 overflow-y-auto"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Topic Category</label>
                <SelectDropdown
                  value={newCategory}
                  onChange={(val) => setNewCategory(val)}
                  options={CATEGORY_OPTIONS}
                  buttonClassName="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="e.g., Deposit TrxID verification or P2P order help"
                  className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Message</label>
                <textarea
                  rows={3}
                  required
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Write your message..."
                  className="w-full p-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={creatingThread}
                  onClick={() => setShowNewModal(false)}
                  className="px-4 h-9 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingThread}
                  className="px-4 h-9 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg"
                >
                  {creatingThread ? 'Starting...' : 'Start Chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Image Preview Lightbox */}
      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-4 space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <span className="text-xs font-semibold text-slate-900">Attachment Preview</span>
              <button
                type="button"
                onClick={() => setPreviewImg(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewImg}
              alt="Full size attachment"
              className="w-full max-h-[75vh] object-contain rounded-lg border border-slate-200"
            />
          </div>
        </div>
      )}
    </div>
  );
};
