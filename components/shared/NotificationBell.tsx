import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Notification } from '../../types';

interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onDelete,
}) => {
  const { t } = useTranslation('layout');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Store current time in state to avoid impure Date.now() calls during render
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Update current time periodically while dropdown is open
  useEffect(() => {
    if (isOpen) {
      const interval = setInterval(() => setCurrentTime(Date.now()), 60000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const handleToggleDropdown = () => {
    if (!isOpen) {
      // Update time when opening the dropdown
      setCurrentTime(Date.now());
    }
    setIsOpen(!isOpen);
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }
    setExpandedId(expandedId === notification.id ? null : notification.id);
  };

  const handleDelete = (e: React.MouseEvent, notificationId: string) => {
    e.stopPropagation();
    onDelete(notificationId);
  };

  const formatTimeAgo = useCallback(
    (timestamp: number) => {
      const diff = currentTime - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return t('notifications.justNow', 'Just now');
      if (minutes < 60)
        return t('notifications.minutesAgo', '{{count}} min ago', { count: minutes });
      if (hours < 24) return t('notifications.hoursAgo', '{{count}}h ago', { count: hours });
      return t('notifications.daysAgo', '{{count}}d ago', { count: days });
    },
    [currentTime, t],
  );

  const getLocalizedTitle = (notification: Notification): string => {
    if (notification.type === 'new_projects') {
      const projectCount = notification.data?.projectNames?.length || 1;
      if (projectCount === 1) {
        return t('notifications.newProject', '1 new project available');
      }
      return t('notifications.newProjects', '{{count}} new projects available', {
        count: projectCount,
      });
    }
    // Fallback to the original title for unknown types
    return notification.title;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleDropdown}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors focus:outline-none"
        aria-label={t('notifications.title', 'Notifications')}
      >
        <i className="fa-solid fa-bell text-lg"></i>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 animate-in fade-in zoom-in-95 duration-200 origin-top-right overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <h3 className="font-semibold text-slate-800 text-sm">
              {t('notifications.title', 'Notifications')}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => {
                  onMarkAllAsRead();
                }}
                className="text-xs text-praetor hover:text-praetor/80 font-medium transition-colors"
              >
                {t('notifications.markAllAsRead', 'Mark all as read')}
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-slate-400 text-sm">
                <i className="fa-solid fa-bell-slash text-2xl mb-2 opacity-50"></i>
                <p>{t('notifications.noNotifications', 'No notifications')}</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`px-4 py-3 border-b border-slate-100 last:border-b-0 cursor-pointer transition-colors ${
                    notification.isRead ? 'bg-white' : 'bg-blue-50/50'
                  } hover:bg-slate-50 group`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        notification.isRead
                          ? 'bg-slate-100 text-slate-400'
                          : 'bg-praetor/10 text-praetor'
                      }`}
                    >
                      <i className="fa-solid fa-folder-tree text-sm"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-sm flex-1 ${
                            notification.isRead ? 'text-slate-600' : 'text-slate-800 font-medium'
                          }`}
                        >
                          {getLocalizedTitle(notification)}
                        </p>
                        {!notification.isRead && (
                          <span className="w-2 h-2 bg-praetor rounded-full flex-shrink-0"></span>
                        )}
                        <button
                          onClick={(e) => handleDelete(e, notification.id)}
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          aria-label={t('notifications.delete', 'Delete notification')}
                          title={t('notifications.delete', 'Delete notification')}
                        >
                          <i className="fa-solid fa-xmark text-xs"></i>
                        </button>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatTimeAgo(notification.createdAt)}
                        {notification.data?.clientName && (
                          <span> · {notification.data.clientName}</span>
                        )}
                      </p>

                      {/* Expandable project list */}
                      {notification.type === 'new_projects' &&
                        notification.data?.projectNames &&
                        notification.data.projectNames.length > 0 && (
                          <div
                            className={`mt-2 overflow-hidden transition-all duration-200 ${
                              expandedId === notification.id ? 'max-h-40' : 'max-h-0'
                            }`}
                          >
                            <ul className="text-xs text-slate-500 space-y-1 pl-3 border-l-2 border-slate-200">
                              {notification.data.projectNames.map((name, idx) => (
                                <li key={idx} className="truncate">
                                  {name}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      {notification.type === 'new_projects' &&
                        notification.data?.projectNames &&
                        notification.data.projectNames.length > 0 && (
                          <button
                            className="text-xs text-praetor hover:text-praetor/80 mt-1 flex items-center gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(
                                expandedId === notification.id ? null : notification.id,
                              );
                            }}
                          >
                            <i
                              className={`fa-solid fa-chevron-down text-[8px] transition-transform ${
                                expandedId === notification.id ? 'rotate-180' : ''
                              }`}
                            ></i>
                            {expandedId === notification.id
                              ? t('notifications.hideProjects', 'Hide projects')
                              : t('notifications.showProjects', 'Show projects')}
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
