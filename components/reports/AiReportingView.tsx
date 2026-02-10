import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import api from '../../services/api';
import type { ReportChatMessage, ReportChatSessionSummary } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Modal from '../shared/Modal';
import StatusBadge from '../shared/StatusBadge';

export interface AiReportingViewProps {
  currentUserId: string;
  permissions: string[];
}

const toOptionLabel = (session: ReportChatSessionSummary) => {
  const title = session.title?.trim() ? session.title.trim() : 'AI Reporting';
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

const AiReportingView: React.FC<AiReportingViewProps> = ({ currentUserId, permissions }) => {
  const { t } = useTranslation(['reports', 'common']);
  const [sessions, setSessions] = useState<ReportChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ReportChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string>('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ReportChatSessionSummary | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const loadTokenRef = useRef(0);

  const canSend = hasPermission(permissions, buildPermission('reports.ai_reporting_ai', 'create'));
  const canArchive = hasPermission(permissions, buildPermission('reports.ai_reporting', 'view'));

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setError('');
    try {
      const data = await api.reports.listSessions();
      setSessions(data);
      setActiveSessionId((prev) => {
        if (prev && data.some((s) => s.id === prev)) return prev;
        return data[0]?.id || '';
      });
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [t]);

  const loadMessages = useCallback(
    async (sessionId: string) => {
      const token = ++loadTokenRef.current;
      setIsLoadingMessages(true);
      setError('');
      try {
        const data = await api.reports.getSessionMessages(sessionId);
        if (token !== loadTokenRef.current) return;
        setMessages(data);
        queueMicrotask(scrollToBottom);
      } catch (err) {
        if (token !== loadTokenRef.current) return;
        setError((err as Error).message || t('aiReporting.error'));
      } finally {
        if (token === loadTokenRef.current) setIsLoadingMessages(false);
      }
    },
    [t, scrollToBottom],
  );

  const handleNewChat = async () => {
    if (!canSend) return;
    setError('');
    try {
      const { id } = await api.reports.createSession({
        title: t('aiReporting.session', { defaultValue: 'Session' }),
      });
      await loadSessions();
      setActiveSessionId(id);
      setMessages([]);
      setDraft('');
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    }
  };

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || isSending || !canSend) return;

    setIsSending(true);
    setError('');
    setDraft('');

    const now = Date.now();
    const optimisticUser: ReportChatMessage = {
      id: `tmp-user-${now}`,
      sessionId: activeSessionId || 'tmp',
      role: 'user',
      content,
      createdAt: now,
    };
    const optimisticAssistant: ReportChatMessage = {
      id: `tmp-asst-${now}`,
      sessionId: activeSessionId || 'tmp',
      role: 'assistant',
      content: t('aiReporting.thinking', { defaultValue: 'Thinking…' }),
      createdAt: now + 1,
    };
    setMessages((prev) => [...prev, optimisticUser, optimisticAssistant]);
    queueMicrotask(scrollToBottom);

    try {
      const res = await api.reports.chat({
        sessionId: activeSessionId || undefined,
        message: content,
      });

      if (!activeSessionId) setActiveSessionId(res.sessionId);
      await Promise.all([loadSessions(), loadMessages(res.sessionId)]);
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
      // Reload canonical messages if possible.
      if (activeSessionId) {
        await loadMessages(activeSessionId);
      } else {
        setMessages([]);
      }
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (!currentUserId) return;
    setActiveSessionId('');
    setMessages([]);
    setDraft('');
    void loadSessions();
  }, [currentUserId, loadSessions]);

  useEffect(() => {
    if (!activeSessionId) return;
    void loadMessages(activeSessionId);
  }, [activeSessionId, loadMessages]);

  useEffect(() => {
    if (!activeSessionId) setMessages([]);
  }, [activeSessionId]);

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
      setIsDeleteConfirmOpen(false);
      setSessionToDelete(null);
      await loadSessions();
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsDeletingSession(false);
    }
  }, [canArchive, isDeletingSession, loadSessions, sessionToDelete, t]);

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title || 'AI Reporting';

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[560px] gap-6">
      {/* Sessions sidebar (desktop/tablet) */}
      <aside className="hidden md:flex w-72 shrink-0 h-full flex-col bg-white rounded-2xl shadow-xl border border-slate-200">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100">
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
            Sessions
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingSessions && <div className="text-xs text-slate-400 px-2 py-3">Loading…</div>}
          {!isLoadingSessions && sessions.length === 0 && (
            <div className="text-xs text-slate-400 px-2 py-3">
              {t('aiReporting.noSessions', { defaultValue: 'No chats yet.' })}
            </div>
          )}
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-2 w-full rounded-xl px-3 py-2.5 transition-colors ${
                  isActive ? 'bg-praetor' : 'hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveSessionId(s.id)}
                  className={`flex-1 text-left text-sm font-semibold truncate outline-none ${
                    isActive ? 'text-white' : 'text-slate-700'
                  }`}
                >
                  {toOptionLabel(s)}
                </button>

                <button
                  type="button"
                  aria-label="Delete chat"
                  disabled={!canArchive || isDeletingSession}
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmDeleteSession(s);
                  }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    !canArchive || isDeletingSession
                      ? 'opacity-40 cursor-not-allowed'
                      : isActive
                        ? 'text-white/90 hover:text-white hover:bg-white/10'
                        : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                >
                  <i className="fa-solid fa-trash text-xs" />
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main chat column */}
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

          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={!canSend}
            className={`shrink-0 px-5 py-2.5 rounded-xl text-sm font-black shadow-xl transition-all active:scale-95 flex items-center gap-2 ${
              canSend
                ? 'bg-praetor text-white shadow-slate-200 hover:bg-[var(--color-primary-hover)]'
                : 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed'
            }`}
          >
            <i className="fa-solid fa-plus text-xs" />
            {t('aiReporting.newChat', { defaultValue: 'New chat' })}
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mx-4 md:mx-6">
            {error}
          </div>
        )}

        {!canSend && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 mx-4 md:mx-6">
            {t('aiReporting.noPermissionToSend', { defaultValue: 'You do not have permission.' })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-52">
          {isLoadingMessages && (
            <div className="text-sm text-slate-500">{t('aiReporting.thinking')}</div>
          )}

          {!isLoadingMessages && messages.length === 0 && (
            <div className="text-sm text-slate-500">{t('aiReporting.noSessions')}</div>
          )}

          <div className="space-y-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`w-full flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[980px] 2xl:max-w-[1100px] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'bg-praetor text-white rounded-br-md whitespace-pre-wrap'
                      : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md'
                  }`}
                >
                  {m.role === 'user' ? (
                    m.content
                  ) : (
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
                          <ul className="my-2 list-disc pl-5 marker:text-slate-400">{children}</ul>
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
                            <table className="w-full border-collapse text-left">{children}</table>
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
                            typeof children === 'string' ? children.replace(/\n$/, '') : children;

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
                  )}
                </div>
              </div>
            ))}
          </div>
          <div ref={endRef} />
        </div>

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

                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!canSend || isSending || !draft.trim()}
                  className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                    !canSend || isSending || !draft.trim()
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-praetor text-white hover:bg-[var(--color-primary-hover)]'
                  }`}
                  aria-label="Send"
                >
                  <i className="fa-solid fa-arrow-up text-sm" />
                </button>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 mt-2 px-2">
              {t('aiReporting.footerHint', {
                defaultValue: 'Enter to send, Shift+Enter for a new line.',
              })}
            </div>
          </div>
        </div>
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
                  name: sessionToDelete ? toOptionLabel(sessionToDelete) : '',
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
                {t('common:buttons.cancel')}
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
                {t('common:buttons.delete')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AiReportingView;
