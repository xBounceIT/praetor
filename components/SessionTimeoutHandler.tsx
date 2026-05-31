import { Clock, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '../services/api';

export interface SessionTimeoutHandlerProps {
  onLogout: () => void;
  warnAfterMs?: number;
  logoutAfterMs?: number;
}

const SessionTimeoutHandler: React.FC<SessionTimeoutHandlerProps> = ({
  onLogout,
  warnAfterMs = 20 * 60 * 1000,
  logoutAfterMs = 30 * 60 * 1000,
}) => {
  const { t } = useTranslation('auth');
  const [showWarning, setShowWarning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const showWarningRef = useRef(false);
  const resetTimersRef = useRef<() => void>(() => {});

  useEffect(() => {
    showWarningRef.current = showWarning;
  }, [showWarning]);

  const resetTimers = useCallback(() => {
    setShowWarning(false);

    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
    }, warnAfterMs);

    logoutTimerRef.current = setTimeout(() => {
      onLogout();
    }, logoutAfterMs);
  }, [onLogout, warnAfterMs, logoutAfterMs]);

  useEffect(() => {
    resetTimersRef.current = resetTimers;
  }, [resetTimers]);

  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'] as const;

    const handleActivity = () => {
      if (!showWarningRef.current) {
        resetTimersRef.current();
      }
    };

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    resetTimersRef.current();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, []);

  const handleStayLoggedIn = async () => {
    setIsRefreshing(true);
    try {
      // Call any API endpoint to refresh the token (sliding window logic in backend)
      await api.auth.me();
      resetTimers();
    } catch (err) {
      console.error('Failed to extend session:', err);
      onLogout();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Dialog open={showWarning}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="z-[100] bg-black/60 backdrop-blur-sm"
        className="z-[101] gap-0 overflow-hidden p-0 sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="border-b border-border bg-muted/40 px-6 py-5">
          <DialogHeader className="gap-0 text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                <Clock className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base leading-6">
                  {t('sessionTimeout.title')}
                </DialogTitle>
                <DialogDescription className="mt-1 leading-6">
                  {t('sessionTimeout.message')}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('sessionTimeout.secure')}</span>
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/20 px-6 py-4">
          <Button type="button" variant="outline" onClick={onLogout}>
            <LogOut data-icon="inline-start" />
            {t('sessionTimeout.logout')}
          </Button>
          <Button type="button" onClick={handleStayLoggedIn} disabled={isRefreshing}>
            {isRefreshing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <ShieldCheck data-icon="inline-start" />
            )}
            {t('sessionTimeout.stayLoggedIn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SessionTimeoutHandler;
