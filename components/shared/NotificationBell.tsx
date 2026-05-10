import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Notification } from '../../types';

export interface NotificationBellProps {
  notifications: Notification[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onDelete: (id: string) => void;
}

const getNotificationIconClass = (type: string) =>
  type === 'admin_password_warning' ? 'fa-triangle-exclamation' : 'fa-folder-tree';

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
        className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
        aria-label={t('notifications.title', 'Notifications')}
      >
        <i className="fa-solid fa-bell text-lg"></i>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-background shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-3 w-80 origin-top-right overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-popover px-4 py-3">
            <h3 className="text-sm font-semibold text-popover-foreground">
              {t('notifications.title', 'Notifications')}
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => {
                  onMarkAllAsRead();
                }}
                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
              >
                {t('notifications.markAllAsRead', 'Mark all as read')}
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <i className="fa-solid fa-bell-slash text-2xl mb-2 opacity-50"></i>
                <p>{t('notifications.noNotifications', 'No notifications')}</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`group cursor-pointer border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-accent hover:text-accent-foreground ${
                    notification.isRead
                      ? 'bg-popover text-popover-foreground'
                      : 'bg-accent text-accent-foreground'
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex-shrink-0 size-8 rounded-full flex items-center justify-center ${
                        notification.isRead
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      <i
                        className={`fa-solid ${getNotificationIconClass(notification.type)} text-sm`}
                      ></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-sm flex-1 ${
                            notification.isRead
                              ? 'text-muted-foreground'
                              : 'text-accent-foreground font-medium'
                          }`}
                        >
                          {getLocalizedTitle(notification)}
                        </p>
                        {!notification.isRead && (
                          <span className="size-2 rounded-full bg-primary flex-shrink-0"></span>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <button
                                onClick={(e) => handleDelete(e, notification.id)}
                                className="flex size-6 flex-shrink-0 items-center justify-center rounded-full text-destructive opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                aria-label={t('notifications.delete', 'Delete notification')}
                              >
                                <i className="fa-solid fa-xmark text-xs"></i>
                              </button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t('notifications.delete', 'Delete notification')}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
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
                            <ul className="space-y-1 border-l-2 border-border pl-3 text-xs text-muted-foreground">
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
                            className="mt-1 flex items-center gap-1 text-xs text-primary hover:text-primary/80"
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
