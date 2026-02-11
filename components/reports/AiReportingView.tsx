import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import api from '../../services/api';
import type { ReportChatMessage, ReportChatSessionSummary } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import CustomSelect from '../shared/CustomSelect';
import Modal from '../shared/Modal';
import StatusBadge from '../shared/StatusBadge';
import Tooltip from '../shared/Tooltip';

export interface AiReportingViewProps {
  currentUserId: string;
  permissions: string[];
  enableAiReporting: boolean;
}

const toOptionLabel = (session: ReportChatSessionSummary) => {
  const title = session.title?.trim() ? session.title.trim() : '';
  return title;
};

const safeHref = (href: string | undefined) => {
  if (!href) return null;
  try {
    // Support both absolute and relative URLs.
    const parsed = new URL(href, window.location.origin);
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'mailto:'
    ) {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
};

const AiReportingView: React.FC<AiReportingViewProps> = ({
  currentUserId,
  permissions,
  enableAiReporting,
}) => {
  const { t, i18n } = useTranslation(['reports', 'common']);
  const [sessions, setSessions] = useState<ReportChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isNewChat, setIsNewChat] = useState(false);
  const [messages, setMessages] = useState<ReportChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingEmptySessionId, setPendingEmptySessionId] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ReportChatSessionSummary | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [hasNewText, setHasNewText] = useState(false);
  const [expandedThoughtMessageIds, setExpandedThoughtMessageIds] = useState<string[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loadTokenRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sendRunIdRef = useRef(0);
  const activeAssistantMessageIdRef = useRef('');

  const canSend =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'create'));
  const canArchive =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'view'));

  const getIsAtBottom = useCallback((el: HTMLDivElement) => {
    const threshold = 80;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  }, []);

  const updateAtBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = getIsAtBottom(el);
    isAtBottomRef.current = next;
    setIsAtBottom(next);
    if (next) setHasNewText(false);
  }, [getIsAtBottom]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    requestAnimationFrame(updateAtBottom);
  }, [updateAtBottom]);

  const typeAssistantMessage = useCallback(
    async (
      messageId: string,
      finalContent: string,
      thoughtContent?: string,
      opts: { sessionId?: string; shouldContinue?: () => boolean } = {},
    ) => {
      const shouldContinue = opts.shouldContinue || (() => true);
      const speedMs = 8;
      const thoughtChunks = 3;
      const answerChunks = 2;
      const finalThought = String(thoughtContent || '');
      let nextThought = '';
      let thoughtIndex = 0;

      while (thoughtIndex < finalThought.length) {
        if (!shouldContinue()) return false;
        if (thoughtIndex < finalThought.length) {
          nextThought += finalThought.slice(thoughtIndex, thoughtIndex + thoughtChunks);
          thoughtIndex += thoughtChunks;
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: '',
                  thoughtContent: nextThought || undefined,
                  sessionId: opts.sessionId || m.sessionId,
                }
              : m,
          ),
        );
        if (isAtBottomRef.current) {
          requestAnimationFrame(scrollToBottom);
        } else {
          setHasNewText(true);
        }
        await new Promise((resolve) => setTimeout(resolve, speedMs));
      }

      let nextAnswer = '';
      let answerIndex = 0;

      while (answerIndex < finalContent.length) {
        if (!shouldContinue()) return false;
        if (answerIndex < finalContent.length) {
          nextAnswer += finalContent.slice(answerIndex, answerIndex + answerChunks);
          answerIndex += answerChunks;
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: nextAnswer,
                  thoughtContent: finalThought || undefined,
                  sessionId: opts.sessionId || m.sessionId,
                }
              : m,
          ),
        );
        if (isAtBottomRef.current) {
          requestAnimationFrame(scrollToBottom);
        } else {
          setHasNewText(true);
        }
        await new Promise((resolve) => setTimeout(resolve, speedMs));
      }

      if (!shouldContinue()) return false;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                content: finalContent,
                thoughtContent: finalThought || undefined,
                sessionId: opts.sessionId || m.sessionId,
              }
            : m,
        ),
      );
      return true;
    },
    [scrollToBottom],
  );

  const loadSessions = useCallback(
    async (opts: { preferredSessionId?: string } = {}) => {
      setIsLoadingSessions(true);
      setError('');
      try {
        const data = await api.reports.listSessions();
        setSessions(data);
        setActiveSessionId((prev) => {
          // When a new session is created by the first send, the sessions list can lag behind due
          // to caching/version bump timing. Pin the UI to the newly created session id so we don't
          // accidentally "jump" to the most recently updated existing session.
          if (opts.preferredSessionId) return opts.preferredSessionId;
          if (isNewChat) return '';
          if (prev && data.some((s) => s.id === prev)) return prev;
          return data[0]?.id || '';
        });
      } catch (err) {
        setError((err as Error).message || t('aiReporting.error'));
      } finally {
        setIsLoadingSessions(false);
      }
    },
    [isNewChat, t],
  );

  const loadMessages = useCallback(
    async (sessionId: string, opts: { forceScroll?: boolean } = {}) => {
      const token = ++loadTokenRef.current;
      setIsLoadingMessages(true);
      setError('');
      try {
        const data = await api.reports.getSessionMessages(sessionId);
        if (token !== loadTokenRef.current) return;
        setMessages(data);
        queueMicrotask(() => {
          if (opts.forceScroll || isAtBottomRef.current) {
            scrollToBottom();
            setHasNewText(false);
          } else {
            setHasNewText(true);
          }
          updateAtBottom();
        });
      } catch (err) {
        if (token !== loadTokenRef.current) return;
        setError((err as Error).message || t('aiReporting.error'));
      } finally {
        if (token === loadTokenRef.current) setIsLoadingMessages(false);
      }
    },
    [t, scrollToBottom, updateAtBottom],
  );

  const handleNewChat = async () => {
    if (!enableAiReporting) return;
    if (!canSend || isCreatingSession || isSending || isLoadingMessages || isEmptySession) return;

    if (pendingEmptySessionId && sessions.some((session) => session.id === pendingEmptySessionId)) {
      setIsNewChat(false);
      setActiveSessionId(pendingEmptySessionId);
      setHasNewText(false);
      setExpandedThoughtMessageIds([]);
      return;
    }

    setError('');
    setDraft('');
    setHasNewText(false);
    setIsAtBottom(true);
    isAtBottomRef.current = true;

    setIsCreatingSession(true);
    try {
      const now = Date.now();
      const res = await api.reports.createSession();
      const session: ReportChatSessionSummary = {
        id: res.id,
        title: '',
        createdAt: now,
        updatedAt: now,
      };

      // Optimistically insert so it shows up immediately in the dropdown, then refresh canonical list.
      setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
      setMessages([]);
      setIsNewChat(false);
      setActiveSessionId(session.id);
      setPendingEmptySessionId(session.id);
      await loadSessions({ preferredSessionId: session.id });
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleSend = async () => {
    if (!enableAiReporting) return;
    const content = draft.trim();
    if (!content || isSending || !canSend) return;

    const abortController = new AbortController();
    const runId = ++sendRunIdRef.current;
    abortRef.current = abortController;

    setIsSending(true);
    setError('');
    setDraft('');

    const now = Date.now();
    const assistantMessageId = `tmp-asst-${now}`;
    const thinkingLabel = t('aiReporting.thinking', { defaultValue: 'Thinking…' });
    const optimisticUser: ReportChatMessage = {
      id: `tmp-user-${now}`,
      sessionId: activeSessionId || 'tmp',
      role: 'user',
      content,
      createdAt: now,
    };
    const optimisticAssistant: ReportChatMessage = {
      id: assistantMessageId,
      sessionId: activeSessionId || 'tmp',
      role: 'assistant',
      content: '',
      thoughtContent: thinkingLabel,
      createdAt: now + 1,
    };
    activeAssistantMessageIdRef.current = assistantMessageId;
    setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
    setExpandedThoughtMessageIds((prev) =>
      prev.includes(assistantMessageId) ? prev : [...prev, assistantMessageId],
    );
    queueMicrotask(() => {
      if (isAtBottomRef.current) {
        scrollToBottom();
      } else {
        setHasNewText(true);
      }
    });

    const isRunActive = () =>
      sendRunIdRef.current === runId &&
      abortRef.current === abortController &&
      !abortController.signal.aborted;

    const cleanupCancelledAssistant = () => {
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
      setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== assistantMessageId));
      if (activeAssistantMessageIdRef.current === assistantMessageId) {
        activeAssistantMessageIdRef.current = '';
      }
    };

    try {
      const hadSession = Boolean(activeSessionId);
      let resolvedSessionId = activeSessionId || '';
      let thoughtDoneClosed = false;
      let streamStarted = false;
      let streamProducedOutput = false;

      const syncAssistantSession = (sessionId: string) => {
        if (!sessionId || !isRunActive()) return;
        resolvedSessionId = sessionId;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMessageId ? { ...m, sessionId } : m)),
        );
      };

      const closeThoughtPanel = () => {
        if (thoughtDoneClosed || !isRunActive()) return;
        thoughtDoneClosed = true;
        setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== assistantMessageId));
      };

      try {
        const streamed = await api.reports.chatStream(
          {
            sessionId: activeSessionId || undefined,
            message: content,
            language: i18n.language,
          },
          {
            onStart: ({ sessionId }) => {
              if (!isRunActive()) return;
              streamStarted = true;
              syncAssistantSession(sessionId);
              if (!hadSession && sessionId) {
                setActiveSessionId(sessionId);
                setIsNewChat(false);
              }
              if (pendingEmptySessionId && sessionId === pendingEmptySessionId) {
                setPendingEmptySessionId('');
              }
            },
            onThoughtDelta: (delta) => {
              if (!delta || !isRunActive()) return;
              streamProducedOutput = true;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMessageId) return m;
                  const previousThought = String(m.thoughtContent || '');
                  const nextThought =
                    previousThought === thinkingLabel ? delta : `${previousThought}${delta}`;
                  return {
                    ...m,
                    thoughtContent: nextThought,
                    sessionId: resolvedSessionId || m.sessionId,
                  };
                }),
              );
              if (isAtBottomRef.current) {
                requestAnimationFrame(scrollToBottom);
              } else {
                setHasNewText(true);
              }
            },
            onThoughtDone: () => {
              if (!isRunActive()) return;
              closeThoughtPanel();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId && m.thoughtContent === thinkingLabel
                    ? { ...m, thoughtContent: undefined }
                    : m,
                ),
              );
            },
            onAnswerDelta: (delta) => {
              if (!delta || !isRunActive()) return;
              streamProducedOutput = true;
              closeThoughtPanel();
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMessageId) return m;
                  const nextContent = `${m.content}${delta}`;
                  const cleanedThought =
                    m.thoughtContent === thinkingLabel ? undefined : m.thoughtContent;
                  return {
                    ...m,
                    content: nextContent,
                    thoughtContent: cleanedThought,
                    sessionId: resolvedSessionId || m.sessionId,
                  };
                }),
              );
              if (isAtBottomRef.current) {
                requestAnimationFrame(scrollToBottom);
              } else {
                setHasNewText(true);
              }
            },
          },
          abortController.signal,
        );

        if (!isRunActive()) return;
        syncAssistantSession(streamed.sessionId);
        closeThoughtPanel();

        if (!hadSession && streamed.sessionId) {
          setActiveSessionId(streamed.sessionId);
          setIsNewChat(false);
        }
        if (pendingEmptySessionId && streamed.sessionId === pendingEmptySessionId) {
          setPendingEmptySessionId('');
        }

        const finalThought = String(streamed.thoughtContent || '').trim();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? {
                  ...m,
                  content: streamed.text,
                  thoughtContent: finalThought || undefined,
                  sessionId: streamed.sessionId || m.sessionId,
                }
              : m,
          ),
        );
        if (activeAssistantMessageIdRef.current === assistantMessageId) {
          activeAssistantMessageIdRef.current = '';
        }
        await loadSessions({ preferredSessionId: streamed.sessionId });
      } catch (streamErr) {
        if (!isRunActive()) {
          cleanupCancelledAssistant();
          return;
        }

        if ((streamErr as Error).name === 'AbortError') {
          cleanupCancelledAssistant();
        } else if (!streamStarted && !streamProducedOutput) {
          if (!isRunActive()) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId
                ? { ...m, content: '', thoughtContent: thinkingLabel }
                : m,
            ),
          );
          const fallback = await api.reports.chat(
            {
              sessionId: activeSessionId || undefined,
              message: content,
              language: i18n.language,
            },
            abortController.signal,
          );
          if (!isRunActive()) {
            cleanupCancelledAssistant();
            return;
          }

          if (!hadSession) {
            setActiveSessionId(fallback.sessionId);
            setIsNewChat(false);
          }
          if (pendingEmptySessionId && fallback.sessionId === pendingEmptySessionId) {
            setPendingEmptySessionId('');
          }

          const completed = await typeAssistantMessage(
            assistantMessageId,
            fallback.text,
            fallback.thoughtContent,
            {
              sessionId: fallback.sessionId,
              shouldContinue: isRunActive,
            },
          );
          if (!completed || !isRunActive()) {
            cleanupCancelledAssistant();
            return;
          }
          if (activeAssistantMessageIdRef.current === assistantMessageId) {
            activeAssistantMessageIdRef.current = '';
          }
          setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== assistantMessageId));
          await loadSessions({ preferredSessionId: fallback.sessionId });
        } else {
          if (!isRunActive()) return;
          setError((streamErr as Error).message || t('aiReporting.error'));
          if (resolvedSessionId) {
            await loadMessages(resolvedSessionId, { forceScroll: false });
          }
        }
      }
    } catch (err) {
      if (!isRunActive()) {
        cleanupCancelledAssistant();
        return;
      }

      if ((err as Error).name === 'AbortError') {
        cleanupCancelledAssistant();
      } else {
        setError((err as Error).message || t('aiReporting.error'));
        // Reload canonical messages if possible.
        if (activeSessionId) {
          await loadMessages(activeSessionId, { forceScroll: false });
        } else {
          setMessages([]);
        }
      }
    } finally {
      if (isRunActive()) {
        if (activeAssistantMessageIdRef.current === assistantMessageId) {
          activeAssistantMessageIdRef.current = '';
        }
        abortRef.current = null;
        setIsSending(false);
      }
    }
  };

  const handleStop = () => {
    const controller = abortRef.current;
    if (!controller) return;
    sendRunIdRef.current += 1;
    abortRef.current = null;
    setIsSending(false);
    const activeAssistantId = activeAssistantMessageIdRef.current;
    if (activeAssistantId) {
      setMessages((prev) => prev.filter((m) => m.id !== activeAssistantId));
      setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== activeAssistantId));
      activeAssistantMessageIdRef.current = '';
    }
    controller.abort();
  };

  const handleCopy = useCallback(async (messageId: string, text: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(''), 1500);
    } catch {
      /* silently fail */
    }
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    if (!enableAiReporting) {
      sendRunIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      activeAssistantMessageIdRef.current = '';
      setSessions([]);
      setActiveSessionId('');
      setIsNewChat(false);
      setMessages([]);
      setDraft('');
      setError('');
      setIsLoadingSessions(false);
      setIsLoadingMessages(false);
      setIsSending(false);
      setHasNewText(false);
      setExpandedThoughtMessageIds([]);
      return;
    }
    sendRunIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeAssistantMessageIdRef.current = '';
    setActiveSessionId('');
    setIsNewChat(false);
    setMessages([]);
    setExpandedThoughtMessageIds([]);
    setDraft('');
    void loadSessions();
    setPendingEmptySessionId('');
  }, [currentUserId, enableAiReporting, loadSessions]);

  useEffect(() => {
    if (!enableAiReporting) return;
    if (!activeSessionId) return;
    setIsNewChat(false);
    setHasNewText(false);
    void loadMessages(activeSessionId, { forceScroll: true });
  }, [activeSessionId, enableAiReporting, loadMessages]);

  useEffect(() => {
    if (!activeSessionId) setMessages([]);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !pendingEmptySessionId) return;
    if (activeSessionId !== pendingEmptySessionId) return;
    if (isLoadingMessages) return;
    const hasPendingMessages = messages.some(
      (message) => message.sessionId === pendingEmptySessionId,
    );
    if (hasPendingMessages) {
      setPendingEmptySessionId('');
    }
  }, [activeSessionId, isLoadingMessages, messages, pendingEmptySessionId]);

  const confirmDeleteSession = useCallback((session: ReportChatSessionSummary) => {
    setSessionToDelete(session);
    setIsDeleteConfirmOpen(true);
  }, []);

  const handleArchiveSession = useCallback(async () => {
    if (!canArchive) return;
    if (!sessionToDelete) return;
    if (isDeletingSession) return;

    setIsDeletingSession(true);
    setError('');
    try {
      await api.reports.archiveSession(sessionToDelete.id);
      if (sessionToDelete.id === pendingEmptySessionId) {
        setPendingEmptySessionId('');
      }
      setIsDeleteConfirmOpen(false);
      setSessionToDelete(null);
      await loadSessions();
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsDeletingSession(false);
    }
  }, [canArchive, isDeletingSession, loadSessions, pendingEmptySessionId, sessionToDelete, t]);

  const activeTitle = isNewChat
    ? t('aiReporting.newChat', { defaultValue: 'New Chat' })
    : sessions.find((s) => s.id === activeSessionId)?.title ||
      t('aiReporting.newChat', { defaultValue: 'New Chat' });
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const sessionOptions = sessions.map((s) => ({
    id: s.id,
    name: toOptionLabel(s) || t('aiReporting.newChat', { defaultValue: 'New Chat' }),
  }));
  const canDeleteActive =
    Boolean(activeSession) && canArchive && !isDeletingSession && !isLoadingSessions;
  const isEmptySession = Boolean(activeSessionId) && !isLoadingMessages && messages.length === 0;
  const isNewChatDisabled = !canSend || isCreatingSession || isEmptySession || isLoadingMessages;
  const showGoToBottom = messages.length > 0 && (!isAtBottom || hasNewText);
  const footerHint = t('aiReporting.footerHint', {
    defaultValue: 'Enter to send, Shift+Enter for a new line.',
  });
  const aiWarning = t('aiReporting.aiWarning', {
    defaultValue: 'AI can make mistakes. Verify important information.',
  });
  const footerHintWithPeriod = (() => {
    const trimmed = footerHint.trim();
    if (!trimmed) return '';
    return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
  })();

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[560px]">
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4 px-4 md:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-praetor text-white flex items-center justify-center shadow-sm">
              <i className="fa-solid fa-wand-magic-sparkles text-sm"></i>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest">
                {t('aiReporting.session', { defaultValue: 'Session' })}
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-base font-extrabold text-slate-900 truncate">
                  {activeTitle}
                </div>
                <StatusBadge type="experimental" label="EXPERIMENTAL" className="shrink-0" />
              </div>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <div className="w-48 sm:w-56 md:w-72">
              <CustomSelect
                options={sessionOptions}
                value={activeSessionId}
                onChange={(value) => {
                  setIsNewChat(false);
                  setActiveSessionId(value as string);
                  setHasNewText(false);
                }}
                placeholder={
                  isLoadingSessions
                    ? t('aiReporting.loadingSessions', { defaultValue: 'Loading...' })
                    : t('aiReporting.selectSession', { defaultValue: 'Select chat' })
                }
                displayValue={
                  isNewChat ? t('aiReporting.newChat', { defaultValue: 'New Chat' }) : undefined
                }
                disabled={isLoadingSessions || sessions.length === 0}
                searchable
                buttonClassName="py-2.5 text-sm font-semibold"
              />
            </div>

            <button
              type="button"
              aria-label={t('aiReporting.deleteActiveChatAria', {
                defaultValue: 'Delete active chat',
              })}
              disabled={!canDeleteActive}
              onClick={() => {
                if (!activeSession) return;
                confirmDeleteSession(activeSession);
              }}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                canDeleteActive
                  ? 'bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50'
                  : 'bg-slate-100 border border-slate-200 text-slate-300 cursor-not-allowed'
              }`}
            >
              <i className="fa-solid fa-trash text-sm" />
            </button>

            <button
              type="button"
              onClick={() => void handleNewChat()}
              disabled={isNewChatDisabled}
              className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
                !isNewChatDisabled
                  ? 'bg-praetor text-white shadow-xl shadow-slate-200 hover:bg-[var(--color-primary-hover)] active:scale-95'
                  : 'bg-slate-100 border border-slate-200 text-slate-400 shadow-none cursor-not-allowed active:scale-100'
              }`}
            >
              <i
                className={`${
                  isCreatingSession ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-plus'
                } text-xs`}
              />
              {t('aiReporting.newChat', { defaultValue: 'New Chat' })}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mx-4 md:mx-6">
            {error}
          </div>
        )}

        {!enableAiReporting && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 mx-4 md:mx-6">
            {t('aiReporting.disabledByAdmin', {
              defaultValue: 'AI Reporting is disabled by administration.',
            })}
          </div>
        )}

        {enableAiReporting && !canSend && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 mx-4 md:mx-6">
            {t('aiReporting.noPermissionToSend', { defaultValue: 'You do not have permission.' })}
          </div>
        )}

        {enableAiReporting ? (
          <div
            ref={scrollRef}
            onScroll={updateAtBottom}
            className="flex-1 overflow-y-auto px-4 md:px-6 pb-52"
          >
            <div className="mx-auto w-full max-w-[760px]">
              {isLoadingMessages && (
                <div className="text-sm text-slate-500">{t('aiReporting.thinking')}</div>
              )}

              {!isLoadingMessages && messages.length === 0 && (
                <div className="min-h-[45vh] flex items-center justify-center px-4">
                  <div className="max-w-xl text-center">
                    <div className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                      {t('aiReporting.emptyPlaceholderTitle', {
                        defaultValue: 'What should we build together now?',
                      })}
                    </div>
                    <div className="mt-3 text-sm md:text-base text-slate-500 leading-relaxed">
                      {t('aiReporting.emptyPlaceholderBody', {
                        defaultValue:
                          'Start with a question about your business data. I will use your reports to help you.',
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`group w-full flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'user' ? (
                      <div className="flex items-start gap-1.5">
                        <Tooltip
                          label={
                            copiedMessageId === m.id
                              ? t('notifications:copied', { defaultValue: 'Copied to clipboard' })
                              : t('common:buttons.copy', { defaultValue: 'Copy' })
                          }
                        >
                          {() => (
                            <button
                              type="button"
                              onClick={() => void handleCopy(m.id, m.content)}
                              className="mt-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <i
                                className={
                                  copiedMessageId === m.id
                                    ? 'fa-solid fa-check text-green-500'
                                    : 'fa-regular fa-copy'
                                }
                              />
                            </button>
                          )}
                        </Tooltip>
                        <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed bg-praetor text-white rounded-br-md whitespace-pre-wrap">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div className="w-full text-sm leading-relaxed text-slate-800 relative">
                        <div className="absolute -top-1 right-0 opacity-0 group-hover:opacity-100 transition-all">
                          <Tooltip
                            label={
                              copiedMessageId === m.id
                                ? t('notifications:copied', { defaultValue: 'Copied to clipboard' })
                                : t('common:buttons.copy', { defaultValue: 'Copy' })
                            }
                          >
                            {() => (
                              <button
                                type="button"
                                onClick={() => void handleCopy(m.id, m.content)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                              >
                                <i
                                  className={
                                    copiedMessageId === m.id
                                      ? 'fa-solid fa-check text-green-500'
                                      : 'fa-regular fa-copy'
                                  }
                                />
                              </button>
                            )}
                          </Tooltip>
                        </div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={{
                            a: ({ children, href }) => {
                              const safe = safeHref(href);
                              if (!safe) return <>{children}</>;
                              return (
                                <a
                                  href={safe}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold underline underline-offset-2 text-slate-900 hover:text-slate-700"
                                >
                                  {children}
                                </a>
                              );
                            },
                            img: ({ alt, src }) => {
                              const safe = safeHref(src);
                              const label = alt?.trim() ? alt.trim() : src || 'image';
                              if (!safe)
                                return <span className="text-slate-500">[Image: {label}]</span>;
                              return (
                                <a
                                  href={safe}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-semibold underline underline-offset-2 text-slate-900 hover:text-slate-700"
                                >
                                  [Image: {label}]
                                </a>
                              );
                            },
                            p: ({ children }) => (
                              <p className="my-2 first:mt-0 last:mb-0">{children}</p>
                            ),
                            h1: ({ children }) => (
                              <h1 className="mt-4 mb-2 text-lg font-extrabold text-slate-900">
                                {children}
                              </h1>
                            ),
                            h2: ({ children }) => (
                              <h2 className="mt-4 mb-2 text-base font-extrabold text-slate-900">
                                {children}
                              </h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="mt-3 mb-1 text-sm font-extrabold text-slate-900">
                                {children}
                              </h3>
                            ),
                            ul: ({ children }) => (
                              <ul className="my-2 list-disc pl-5 marker:text-slate-400">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="my-2 list-decimal pl-5 marker:text-slate-400">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => <li className="my-1">{children}</li>,
                            blockquote: ({ children }) => (
                              <blockquote className="my-2 border-l-4 border-slate-200 pl-3 text-slate-700">
                                {children}
                              </blockquote>
                            ),
                            hr: () => <hr className="my-3 border-slate-200" />,
                            table: ({ children }) => (
                              <div className="my-2 overflow-x-auto">
                                <table className="w-full border-collapse text-left">
                                  {children}
                                </table>
                              </div>
                            ),
                            th: ({ children }) => (
                              <th className="border border-slate-200 bg-slate-50 px-2 py-1 font-extrabold">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="border border-slate-200 px-2 py-1">{children}</td>
                            ),
                            pre: ({ children }) => (
                              <pre className="my-2 overflow-x-auto rounded-xl bg-slate-950 p-3 text-slate-100">
                                {children}
                              </pre>
                            ),
                            code: (props) => {
                              // react-markdown provides `inline` here, but it is not represented in the
                              // published `Components` typing (intrinsic `code` props only).
                              const { inline, className, children } = props as unknown as {
                                inline?: boolean;
                                className?: string;
                                children?: React.ReactNode;
                              };

                              const value =
                                typeof children === 'string'
                                  ? children.replace(/\n$/, '')
                                  : children;

                              if (inline === false) {
                                return (
                                  <code
                                    className={`font-mono text-[12px] leading-relaxed text-slate-100 ${
                                      className ?? ''
                                    }`}
                                  >
                                    {value}
                                  </code>
                                );
                              }

                              return (
                                <code className="font-mono text-[12px] rounded bg-slate-100 px-1 py-0.5 text-slate-900">
                                  {value}
                                </code>
                              );
                            },
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                        {m.thoughtContent?.trim() && (
                          <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 backdrop-blur-sm">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThoughtMessageIds((prev) =>
                                  prev.includes(m.id)
                                    ? prev.filter((id) => id !== m.id)
                                    : [...prev, m.id],
                                )
                              }
                              className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
                            >
                              <span className="inline-flex items-center gap-2">
                                <i className="fa-regular fa-lightbulb text-slate-500" />
                                {t('aiReporting.thoughtLabel', { defaultValue: 'Thought process' })}
                              </span>
                              <i
                                className={`fa-solid ${
                                  expandedThoughtMessageIds.includes(m.id)
                                    ? 'fa-chevron-up'
                                    : 'fa-chevron-down'
                                }`}
                              />
                            </button>
                            {expandedThoughtMessageIds.includes(m.id) && (
                              <div className="border-t border-slate-200/80 px-3 py-2.5 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">
                                {m.thoughtContent}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div ref={endRef} />
          </div>
        ) : (
          <div className="flex-1 px-4 md:px-6 pb-52">
            <div className="mx-auto w-full max-w-[760px] pt-10">
              <div className="rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 p-6">
                <div className="text-sm font-black text-slate-900">
                  {t('aiReporting.disabledTitle', { defaultValue: 'AI Reporting disabled' })}
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {t('aiReporting.disabledBody', {
                    defaultValue:
                      'This feature has been disabled by administration. Contact an admin to enable it in General Administration.',
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {showGoToBottom && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom();
              setHasNewText(false);
            }}
            aria-label={t('aiReporting.goToBottom', { defaultValue: 'Go to bottom' })}
            className="absolute left-1/2 -translate-x-1/2 bottom-32 z-[3] w-11 h-11 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors flex items-center justify-center"
          >
            <i className="fa-solid fa-arrow-down" />
            {hasNewText && (
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-praetor border-2 border-white" />
            )}
          </button>
        )}

        {enableAiReporting && (
          <>
            {/* Gradient overlay */}
            <div
              className="absolute left-0 right-0 bottom-0 h-32 pointer-events-none z-[1]"
              style={{
                background:
                  'linear-gradient(to top, rgb(249 250 251) 0%, rgba(249,250,251,0.8) 40%, transparent 100%)',
              }}
            />

            <div className="absolute left-0 right-0 bottom-0 z-[2]">
              <div className="w-full px-4 md:px-6 pb-6">
                <div className="mx-auto w-full max-w-[760px]">
                  <div className="rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 p-3">
                    <div className="flex items-end gap-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={t('aiReporting.placeholder')}
                        disabled={!canSend || isSending}
                        rows={1}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          if (e.shiftKey) return;
                          e.preventDefault();
                          void handleSend();
                        }}
                        className="flex-1 resize-none bg-transparent outline-none text-sm text-slate-900 placeholder:text-slate-400 px-2 py-2 max-h-40 disabled:cursor-not-allowed"
                      />

                      {isSending ? (
                        <button
                          type="button"
                          onClick={handleStop}
                          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-red-600 text-white hover:bg-red-700"
                          aria-label={t('aiReporting.stop', { defaultValue: 'Stop' })}
                        >
                          <i className="fa-solid fa-stop text-sm" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSend()}
                          disabled={!canSend || !draft.trim()}
                          className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                            !canSend || !draft.trim()
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : 'bg-praetor text-white hover:bg-[var(--color-primary-hover)]'
                          }`}
                          aria-label="Send"
                        >
                          <i className="fa-solid fa-arrow-up text-sm" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mx-auto w-full max-w-[760px] mt-2 px-2">
                  <div className="text-[11px] text-slate-400">
                    {footerHintWithPeriod ? `${footerHintWithPeriod} ${aiWarning}` : aiWarning}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setSessionToDelete(null);
        }}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">
                {t('aiReporting.deleteChatTitle', { defaultValue: 'Delete chat' })}
              </h3>
              <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                {t('aiReporting.deleteChatConfirm', {
                  name: sessionToDelete
                    ? toOptionLabel(sessionToDelete) ||
                      t('aiReporting.newChat', { defaultValue: 'New Chat' })
                    : '',
                  defaultValue: 'This will remove "{{name}}" from your chat history.',
                })}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteConfirmOpen(false);
                  setSessionToDelete(null);
                }}
                className="flex-1 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 rounded-xl transition-colors"
              >
                {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                disabled={!canArchive || isDeletingSession || !sessionToDelete}
                onClick={() => void handleArchiveSession()}
                className={`flex-1 py-3 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
                  !canArchive || isDeletingSession || !sessionToDelete
                    ? 'bg-slate-300 shadow-none cursor-not-allowed'
                    : 'bg-red-600 shadow-red-200 hover:bg-red-700'
                }`}
              >
                {t('common:buttons.delete', { defaultValue: 'Delete' })}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AiReportingView;
