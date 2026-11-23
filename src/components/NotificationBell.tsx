import React, { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Volume2, VolumeX } from 'lucide-react';
import { formatDateTime } from '../lib/api';
import { isNotificationSoundEnabled, playNotificationSound, setNotificationSoundEnabled } from '../lib/sound';
import type { UserNotification } from '../types';

interface NotificationBellProps {
  notifications: UserNotification[];
  unreadCount: number;
  onMarkRead: (id?: string) => Promise<void>;
  onNavigateTab: (tab: string) => void;
  onOpen?: () => void;
}

function getCategoryStyle(category: UserNotification['category']): { label: string; color: string } {
  switch (category) {
    case 'FUNDING':
      return { label: 'Funding', color: 'text-emerald-600' };
    case 'TRADING':
      return { label: 'Spot Trade', color: 'text-blue-600' };
    case 'STAKING':
      return { label: 'Staking', color: 'text-indigo-600' };
    case 'KYC':
      return { label: 'Identity KYC', color: 'text-amber-600' };
    case 'REWARDS':
      return { label: 'Rewards', color: 'text-emerald-600' };
    case 'P2P':
      return { label: 'P2P Escrow', color: 'text-blue-600' };
    case 'SECURITY':
      return { label: 'Security', color: 'text-red-600' };
    default:
      return { label: 'System', color: 'text-slate-600' };
  }
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  unreadCount,
  onMarkRead,
  onNavigateTab,
  onOpen,
}) => {
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isNotificationSoundEnabled());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setNotificationSoundEnabled(next);
    if (next) {
      playNotificationSound('success');
    }
  };

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const handleMarkAll = async () => {
    if (unreadCount <= 0 || markingAll) return;
    setMarkingAll(true);
    try {
      await onMarkRead();
    } finally {
      setMarkingAll(false);
    }
  };

  const handleItemClick = async (item: UserNotification) => {
    if (item.is_read === 0) {
      await onMarkRead(item.id).catch(() => {});
    }
    if (item.link_tab) {
      onNavigateTab(item.link_tab);
    }
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            const next = !v;
            if (next) onOpen?.();
            return next;
          })
        }
        aria-label="Notifications"
        aria-expanded={open}
        className="relative h-9 px-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
      >
        <Bell className="w-4 h-4 text-slate-600" />
        {unreadCount > 0 && (
          <span className="font-mono-tabular text-[11px] font-bold text-white bg-blue-600 rounded px-1.5 py-0.5 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">Notifications</h3>
              <p className="text-[11px] text-slate-500 font-mono-tabular">
                {unreadCount > 0 ? `${unreadCount} unread alert${unreadCount === 1 ? '' : 's'}` : 'All caught up'}
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={toggleSound}
                title={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
                  soundEnabled
                    ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                }`}
              >
                {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                <span>{soundEnabled ? 'Sound On' : 'Muted'}</span>
              </button>
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={markingAll}
                  onClick={handleMarkAll}
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>{markingAll ? 'Marking...' : 'Mark all read'}</span>
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-200">
            {notifications.length === 0 ? (
              <div className="py-10 px-4 text-center text-xs text-slate-500">
                No alerts yet. Deposits, staking yields, KYC reviews, and trade settlements appear here.
              </div>
            ) : (
              notifications.map((n) => {
                const cat = getCategoryStyle(n.category);
                const isUnread = n.is_read === 0;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`w-full text-left px-4 py-3 transition-colors block ${
                      isUnread ? 'bg-blue-50/40 hover:bg-blue-50/70' : 'bg-white hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={`font-semibold ${cat.color}`}>{cat.label}</span>
                      <span className="font-mono-tabular text-slate-400">{formatDateTime(n.created_at)}</span>
                    </div>
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <span className={`text-xs ${isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>
                        {n.title}
                      </span>
                      {isUnread && (
                        <span className="text-[10px] font-semibold text-blue-600 shrink-0">NEW</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{n.message}</p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
