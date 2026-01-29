import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';

interface SessionTimeoutHandlerProps {
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
  const [, setLastActivity] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimers = useCallback(() => {
    setLastActivity(Date.now());
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
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];

    const handleActivity = () => {
      if (!showWarning) {
        resetTimers();
      }
    };

    events.forEach((event) => {
      window.addEventListener(event, handleActivity);
    });

    // Only reset timers on initial mount
    if (!showWarning) {
      resetTimers();
    }

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [resetTimers, showWarning]);

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
    <Modal
      isOpen={showWarning}
      onClose={() => {}}
      closeOnBackdrop={false}
      closeOnEsc={false}
      zIndex={100}
      backdropClass="bg-slate-900/60 backdrop-blur-md"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200">
        <div className="p-8 text-center">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <i className="fa-solid fa-hourglass-half text-amber-500 text-3xl animate-pulse"></i>
          </div>

          <h3 className="text-2xl font-black text-slate-800 mb-2 tracking-tight">
            {t('sessionTimeout.title')}
          </h3>
          <p className="text-slate-500 leading-relaxed mb-8">{t('sessionTimeout.message')}</p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleStayLoggedIn}
              disabled={isRefreshing}
              className="w-full py-4 bg-praetor text-white rounded-2xl font-bold hover:shadow-lg hover:shadow-praetor/30 transition-all flex items-center justify-center gap-2 group"
            >
              {isRefreshing ? (
                <i className="fa-solid fa-circle-notch fa-spin"></i>
              ) : (
                <i className="fa-solid fa-check group-hover:scale-110 transition-transform"></i>
              )}
              {t('sessionTimeout.stayLoggedIn')}
            </button>

            <button
              onClick={onLogout}
              className="w-full py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold hover:bg-slate-100 transition-colors"
            >
              {t('sessionTimeout.logout')}
            </button>
          </div>
        </div>

        <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex justify-center">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <i className="fa-solid fa-shield-halved"></i>
            {t('sessionTimeout.secure')}
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default SessionTimeoutHandler;
