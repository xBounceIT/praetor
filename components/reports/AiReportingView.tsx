import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const copyTextToClipboard = async (text: string) => {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch {
    return false;
  }
};

const normalizeTableCellText = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' <br> ')
    .replace(/\|/g, '\\|');

const toMarkdownTableRow = (cells: string[]) => `| ${cells.join(' | ')} |`;

const tableElementToMarkdown = (table: HTMLTableElement) => {
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.querySelectorAll('th, td')).map((cell) =>
        normalizeTableCellText(cell.textContent || ''),
      ),
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) return '';

  const columnCount = Math.max(...rows.map((row) => row.length));
  if (columnCount <= 0) return '';

  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, columnIndex) => row[columnIndex] || ''),
  );
  const header = normalizedRows[0];
  const body = normalizedRows.slice(1);
  const separator = Array.from({ length: columnCount }, () => '---');

  return [
    toMarkdownTableRow(header),
    toMarkdownTableRow(separator),
    ...body.map(toMarkdownTableRow),
  ].join('\n');
};

type AssistantAttemptGroup = {
  id: string;
  userMessage: ReportChatMessage | null;
  assistantAttempts: ReportChatMessage[];
};

const MESSAGES_PAGE_SIZE = 200;

const mapNumberRecordEqual = (a: Record<string, number>, b: Record<string, number>) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
};

const buildAssistantAttemptGroups = (allMessages: ReportChatMessage[]): AssistantAttemptGroup[] => {
  const groups: AssistantAttemptGroup[] = [];
  let index = 0;

  while (index < allMessages.length) {
    const current = allMessages[index];
    if (current.role !== 'user') {
      groups.push({
        id: current.id,
        userMessage: null,
        assistantAttempts: [current],
      });
      index += 1;
      continue;
    }

    const normalizedUserText = current.content.trim();
    const attempts: ReportChatMessage[] = [];
    let cursor = index + 1;

    if (cursor < allMessages.length && allMessages[cursor].role === 'assistant') {
      attempts.push(allMessages[cursor]);
      cursor += 1;
    }

    // Retry sends the same user message again before a new assistant response.
    // Collapse contiguous repeated user+assistant pairs into attempt versions.
    while (cursor + 1 < allMessages.length) {
      const repeatedUser = allMessages[cursor];
      const repeatedAssistant = allMessages[cursor + 1];
      if (repeatedUser.role !== 'user' || repeatedAssistant.role !== 'assistant') break;
      if (repeatedUser.content.trim() !== normalizedUserText) break;
      attempts.push(repeatedAssistant);
      cursor += 2;
    }

    groups.push({
      id: current.id,
      userMessage: current,
      assistantAttempts: attempts,
    });
    index = cursor;
  }

  // Merge pass: collapse non-contiguous groups with matching user message content.
  // After loadMessages reloads from the server, retry messages appear chronologically
  // at the end, non-contiguous with the original group. Merge them here.
  const merged: AssistantAttemptGroup[] = [];
  const seenUserContent = new Map<string, number>();

  for (const group of groups) {
    const userText = group.userMessage?.content.trim() ?? '';
    if (userText && seenUserContent.has(userText)) {
      const earlierIndex = seenUserContent.get(userText);
      if (earlierIndex !== undefined) {
        merged[earlierIndex].assistantAttempts.push(...group.assistantAttempts);
      }
    } else {
      if (userText) {
        seenUserContent.set(userText, merged.length);
      }
      merged.push(group);
    }
  }

  return merged;
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
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
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
  const [copiedTableId, setCopiedTableId] = useState('');
  const [editingMessageId, setEditingMessageId] = useState('');
  const [editingDraft, setEditingDraft] = useState('');
  const [selectedAttemptIndexByGroup, setSelectedAttemptIndexByGroup] = useState<
    Record<string, number>
  >({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loadTokenRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sendRunIdRef = useRef(0);
  const activeAssistantMessageIdRef = useRef('');
  const pendingRetryAutoSelectGroupRef = useRef('');
  const tableRefs = useRef<Record<string, HTMLTableElement | null>>({});

  const canSend =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'create'));
  const canArchive =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'view'));

  const assistantAttemptGroups = useMemo(() => buildAssistantAttemptGroups(messages), [messages]);
  const assistantGroupByMessageId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const group of assistantAttemptGroups) {
      for (const attempt of group.assistantAttempts) {
        map[attempt.id] = group.id;
      }
    }
    return map;
  }, [assistantAttemptGroups]);

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
      setIsLoadingOlderMessages(false);
      setError('');
      try {
        const data = await api.reports.getSessionMessages(sessionId, {
          limit: MESSAGES_PAGE_SIZE,
        });
        if (token !== loadTokenRef.current) return;
        setMessages(data);
        setHasOlderMessages(data.length >= MESSAGES_PAGE_SIZE);
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
        setHasOlderMessages(false);
      } finally {
        if (token === loadTokenRef.current) setIsLoadingMessages(false);
      }
    },
    [t, scrollToBottom, updateAtBottom],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!enableAiReporting) return;
    if (!activeSessionId || isLoadingMessages || isLoadingOlderMessages || !hasOlderMessages)
      return;

    const oldestLoaded = messages[0];
    if (!oldestLoaded) {
      setHasOlderMessages(false);
      return;
    }

    setIsLoadingOlderMessages(true);
    setError('');
    try {
      const older = await api.reports.getSessionMessages(activeSessionId, {
        limit: MESSAGES_PAGE_SIZE,
        before: oldestLoaded.createdAt,
      });
      setMessages((prev) => {
        if (older.length === 0) return prev;
        const existingIds = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !existingIds.has(m.id));
        return prepend.length > 0 ? [...prepend, ...prev] : prev;
      });
      setHasOlderMessages(older.length >= MESSAGES_PAGE_SIZE);
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, [
    activeSessionId,
    enableAiReporting,
    hasOlderMessages,
    isLoadingMessages,
    isLoadingOlderMessages,
    messages,
    t,
  ]);

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

  const sendMessage = async (
    rawContent: string,
    opts: { clearDraft?: boolean; retryInsertAfterGroupId?: string } = {},
  ) => {
    if (!enableAiReporting) return;
    const content = rawContent.trim();
    if (!content || isSending || !canSend) return;

    const abortController = new AbortController();
    const runId = ++sendRunIdRef.current;
    abortRef.current = abortController;

    setIsSending(true);
    setError('');
    if (opts.clearDraft) {
      setDraft('');
    }

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
    setMessages((prev) => {
      if (opts.retryInsertAfterGroupId) {
        // Find the group's last assistant attempt and insert right after it
        const groups = buildAssistantAttemptGroups(prev);
        const targetGroup = groups.find((g) => g.id === opts.retryInsertAfterGroupId);
        if (targetGroup && targetGroup.assistantAttempts.length > 0) {
          const lastAttempt =
            targetGroup.assistantAttempts[targetGroup.assistantAttempts.length - 1];
          const lastAttemptIndex = prev.findIndex((m) => m.id === lastAttempt.id);
          if (lastAttemptIndex >= 0) {
            const updated = [...prev];
            updated.splice(lastAttemptIndex + 1, 0, optimisticUser, optimisticAssistant);
            return updated;
          }
        }
      }
      return [...prev, optimisticUser, optimisticAssistant];
    });
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

  const handleSend = async () => {
    await sendMessage(draft, { clearDraft: true });
  };

  const handleEditSend = async (userMessage: ReportChatMessage) => {
    if (!enableAiReporting || !canSend || isSending) return;
    const content = editingDraft.trim();
    if (!content) return;

    // If content unchanged, just cancel edit
    if (content === userMessage.content.trim()) {
      setEditingMessageId('');
      setEditingDraft('');
      return;
    }

    // Find the currently displayed assistant message paired with this user message
    const group = assistantAttemptGroups.find((g) => g.userMessage?.id === userMessage.id);
    const attemptCount = group?.assistantAttempts.length ?? 0;
    const safeIdx = Math.max(
      0,
      Math.min(selectedAttemptIndexByGroup[group?.id || ''] ?? 0, Math.max(0, attemptCount - 1)),
    );
    const pairedAssistant = group && attemptCount > 0 ? group.assistantAttempts[safeIdx] : null;

    const abortController = new AbortController();
    const runId = ++sendRunIdRef.current;
    abortRef.current = abortController;

    setIsSending(true);
    setError('');
    setEditingMessageId('');
    setEditingDraft('');

    const thinkingLabel = t('aiReporting.thinking', { defaultValue: 'Thinking…' });
    const placeholderId = pairedAssistant?.id || `tmp-asst-edit-${Date.now()}`;
    activeAssistantMessageIdRef.current = placeholderId;

    // Optimistically update user message content and replace assistant with thinking placeholder
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.id === userMessage.id) return { ...m, content };
        if (pairedAssistant && m.id === pairedAssistant.id)
          return { ...m, content: '', thoughtContent: thinkingLabel };
        return m;
      });
      // If no paired assistant, inject a placeholder after the user message
      if (!pairedAssistant) {
        const userIdx = updated.findIndex((m) => m.id === userMessage.id);
        if (userIdx >= 0) {
          const placeholder: ReportChatMessage = {
            id: placeholderId,
            sessionId: activeSessionId || 'tmp',
            role: 'assistant',
            content: '',
            thoughtContent: thinkingLabel,
            createdAt: userMessage.createdAt + 1,
          };
          updated.splice(userIdx + 1, 0, placeholder);
        }
      }
      return updated;
    });
    setExpandedThoughtMessageIds((prev) =>
      prev.includes(placeholderId) ? prev : [...prev, placeholderId],
    );

    const isRunActive = () =>
      sendRunIdRef.current === runId &&
      abortRef.current === abortController &&
      !abortController.signal.aborted;

    const cleanupPlaceholder = () => {
      if (!pairedAssistant) {
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      }
      setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== placeholderId));
      if (activeAssistantMessageIdRef.current === placeholderId) {
        activeAssistantMessageIdRef.current = '';
      }
    };

    try {
      let thoughtDoneClosed = false;

      const closeThoughtPanel = () => {
        if (thoughtDoneClosed || !isRunActive()) return;
        thoughtDoneClosed = true;
        setExpandedThoughtMessageIds((prev) => prev.filter((id) => id !== placeholderId));
      };

      const streamed = await api.reports.editMessageStream(
        {
          sessionId: activeSessionId,
          messageId: userMessage.id,
          content,
          language: i18n.language,
        },
        {
          onStart: ({ messageId }) => {
            if (!isRunActive()) return;
            // Replace placeholder ID with the real assistant message ID from server
            if (messageId && messageId !== placeholderId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholderId ? { ...m, id: messageId } : m)),
              );
              setExpandedThoughtMessageIds((prev) =>
                prev.map((id) => (id === placeholderId ? messageId : id)),
              );
              if (activeAssistantMessageIdRef.current === placeholderId) {
                activeAssistantMessageIdRef.current = messageId;
              }
            }
          },
          onThoughtDelta: (delta) => {
            if (!delta || !isRunActive()) return;
            const targetId = activeAssistantMessageIdRef.current || placeholderId;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                const previousThought = String(m.thoughtContent || '');
                const nextThought =
                  previousThought === thinkingLabel ? delta : `${previousThought}${delta}`;
                return { ...m, thoughtContent: nextThought };
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
            const targetId = activeAssistantMessageIdRef.current || placeholderId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === targetId && m.thoughtContent === thinkingLabel
                  ? { ...m, thoughtContent: undefined }
                  : m,
              ),
            );
          },
          onAnswerDelta: (delta) => {
            if (!delta || !isRunActive()) return;
            closeThoughtPanel();
            const targetId = activeAssistantMessageIdRef.current || placeholderId;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                const nextContent = `${m.content}${delta}`;
                const cleanedThought =
                  m.thoughtContent === thinkingLabel ? undefined : m.thoughtContent;
                return { ...m, content: nextContent, thoughtContent: cleanedThought };
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
      closeThoughtPanel();

      const finalId = activeAssistantMessageIdRef.current || placeholderId;
      const finalThought = String(streamed.thoughtContent || '').trim();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === finalId
            ? { ...m, content: streamed.text, thoughtContent: finalThought || undefined }
            : m,
        ),
      );
      if (activeAssistantMessageIdRef.current === finalId) {
        activeAssistantMessageIdRef.current = '';
      }
      await loadSessions({ preferredSessionId: streamed.sessionId });
    } catch (err) {
      if (!isRunActive()) {
        cleanupPlaceholder();
        return;
      }

      if ((err as Error).name === 'AbortError') {
        cleanupPlaceholder();
      } else {
        setError((err as Error).message || t('aiReporting.error'));
        // Reload canonical messages to restore consistent state
        if (activeSessionId) {
          await loadMessages(activeSessionId, { forceScroll: false });
        }
      }
    } finally {
      if (isRunActive()) {
        if (activeAssistantMessageIdRef.current === placeholderId) {
          activeAssistantMessageIdRef.current = '';
        }
        abortRef.current = null;
        setIsSending(false);
      }
    }
  };

  const getRetryMessageContent = useCallback(
    (assistantMessageId: string) => {
      const assistantIndex = messages.findIndex(
        (message) => message.id === assistantMessageId && message.role === 'assistant',
      );
      if (assistantIndex <= 0) return '';

      const assistantMessage = messages[assistantIndex];
      for (let index = assistantIndex - 1; index >= 0; index--) {
        const candidate = messages[index];
        if (candidate.role !== 'user') continue;
        if (candidate.sessionId !== assistantMessage.sessionId) continue;
        const trimmed = candidate.content.trim();
        if (trimmed) return trimmed;
      }
      return '';
    },
    [messages],
  );

  const handleRetryMessage = async (assistantMessageId: string) => {
    if (!enableAiReporting || !canSend || isSending) return;
    const retryContent = getRetryMessageContent(assistantMessageId);
    if (!retryContent) return;
    const attemptGroupId = assistantGroupByMessageId[assistantMessageId];
    if (attemptGroupId) {
      pendingRetryAutoSelectGroupRef.current = attemptGroupId;
    }
    await sendMessage(retryContent, { retryInsertAfterGroupId: attemptGroupId });
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
    const didCopy = await copyTextToClipboard(text);
    if (!didCopy) return;
    setCopiedMessageId(messageId);
    setTimeout(
      () =>
        setCopiedMessageId((currentMessageId) =>
          currentMessageId === messageId ? '' : currentMessageId,
        ),
      1500,
    );
  }, []);

  const handleCopyTable = useCallback(async (tableId: string) => {
    const tableElement = tableRefs.current[tableId];
    if (!tableElement) return;

    const markdown = tableElementToMarkdown(tableElement);
    if (!markdown) return;

    const didCopy = await copyTextToClipboard(markdown);
    if (!didCopy) return;

    setCopiedTableId(tableId);
    setTimeout(
      () =>
        setCopiedTableId((currentTableId) => (currentTableId === tableId ? '' : currentTableId)),
      1500,
    );
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
      setIsLoadingOlderMessages(false);
      setIsSending(false);
      setHasNewText(false);
      setHasOlderMessages(false);
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
    setHasOlderMessages(false);
    setIsLoadingOlderMessages(false);
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
    if (!activeSessionId) {
      setMessages([]);
      setHasOlderMessages(false);
      setIsLoadingOlderMessages(false);
    }
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

  useEffect(() => {
    setSelectedAttemptIndexByGroup((prev) => {
      const next: Record<string, number> = {};
      const pendingGroupId = pendingRetryAutoSelectGroupRef.current;
      let autoSelectApplied = false;

      for (const group of assistantAttemptGroups) {
        const maxIndex = group.assistantAttempts.length - 1;
        if (maxIndex < 0) continue;
        let index = Math.min(prev[group.id] ?? 0, maxIndex);
        if (pendingGroupId && pendingGroupId === group.id) {
          index = maxIndex;
          autoSelectApplied = true;
        }
        next[group.id] = index;
      }

      if (autoSelectApplied) pendingRetryAutoSelectGroupRef.current = '';
      return mapNumberRecordEqual(prev, next) ? prev : next;
    });
  }, [assistantAttemptGroups]);

  useEffect(() => {
    pendingRetryAutoSelectGroupRef.current = '';
    setSelectedAttemptIndexByGroup({});
    if (!activeSessionId) return;
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
  const showLoadOlderButton =
    enableAiReporting &&
    Boolean(activeSessionId) &&
    messages.length > 0 &&
    (hasOlderMessages || isLoadingOlderMessages);
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
              {showLoadOlderButton && (
                <div className="mb-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlderMessages()}
                    disabled={isLoadingOlderMessages || isLoadingMessages}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                      isLoadingOlderMessages || isLoadingMessages
                        ? 'cursor-not-allowed border-slate-200 text-slate-400 bg-slate-50'
                        : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    {isLoadingOlderMessages && <i className="fa-solid fa-spinner fa-spin" />}
                    {isLoadingOlderMessages
                      ? t('aiReporting.loadingOlder', { defaultValue: 'Loading older messages...' })
                      : t('aiReporting.loadOlder', { defaultValue: 'Load older messages' })}
                  </button>
                </div>
              )}

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

              <div className="space-y-7">
                {assistantAttemptGroups.map((group) => {
                  const userMessage = group.userMessage;
                  const attemptCount = group.assistantAttempts.length;
                  const safeSelectedIndex = Math.max(
                    0,
                    Math.min(
                      selectedAttemptIndexByGroup[group.id] ?? 0,
                      Math.max(0, attemptCount - 1),
                    ),
                  );
                  const assistantMessage =
                    attemptCount > 0 ? group.assistantAttempts[safeSelectedIndex] : null;
                  const isThoughtExpanded = assistantMessage
                    ? expandedThoughtMessageIds.includes(assistantMessage.id)
                    : false;
                  const retryContent = assistantMessage
                    ? getRetryMessageContent(assistantMessage.id)
                    : '';
                  const canRetryAssistantMessage =
                    Boolean(assistantMessage) && Boolean(retryContent) && canSend && !isSending;
                  let tableRenderIndex = 0;

                  return (
                    <div key={group.id} className="space-y-4">
                      {userMessage && (
                        <div className="group w-full flex justify-end">
                          {editingMessageId === userMessage.id ? (
                            <div className="w-full">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <textarea
                                  value={editingDraft}
                                  onChange={(e) => setEditingDraft(e.target.value)}
                                  rows={3}
                                  className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed text-slate-800"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      setEditingMessageId('');
                                      setEditingDraft('');
                                    } else if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      void handleEditSend(userMessage);
                                    }
                                  }}
                                />
                                <div className="flex justify-end gap-2 mt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingMessageId('');
                                      setEditingDraft('');
                                    }}
                                    className="px-4 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-full transition-colors"
                                  >
                                    {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleEditSend(userMessage)}
                                    disabled={!editingDraft.trim()}
                                    className="px-4 py-1.5 text-xs font-medium text-white bg-praetor hover:bg-praetor/90 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {t('common:buttons.send', { defaultValue: 'Send' })}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end max-w-[85%]">
                              <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed bg-praetor text-white rounded-br-md whitespace-pre-wrap">
                                {userMessage.content}
                              </div>
                              <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all">
                                <Tooltip
                                  label={
                                    copiedMessageId === userMessage.id
                                      ? t('notifications:copied', {
                                          defaultValue: 'Copied to clipboard',
                                        })
                                      : t('common:buttons.copy', { defaultValue: 'Copy' })
                                  }
                                >
                                  {() => (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleCopy(userMessage.id, userMessage.content)
                                      }
                                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                                    >
                                      <i
                                        className={
                                          copiedMessageId === userMessage.id
                                            ? 'fa-solid fa-check text-green-500'
                                            : 'fa-regular fa-copy'
                                        }
                                      />
                                    </button>
                                  )}
                                </Tooltip>
                                <Tooltip label={t('common:buttons.edit', { defaultValue: 'Edit' })}>
                                  {() => (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingMessageId(userMessage.id);
                                        setEditingDraft(userMessage.content);
                                      }}
                                      disabled={
                                        isSending ||
                                        !canSend ||
                                        editingMessageId !== '' ||
                                        userMessage.id.startsWith('tmp-')
                                      }
                                      className={`p-1.5 rounded-lg transition-colors ${
                                        isSending ||
                                        !canSend ||
                                        editingMessageId !== '' ||
                                        userMessage.id.startsWith('tmp-')
                                          ? 'text-slate-300 cursor-not-allowed'
                                          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <i className="fa-regular fa-pen-to-square" />
                                    </button>
                                  )}
                                </Tooltip>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {assistantMessage && (
                        <div className="group w-full flex justify-start">
                          <div className="w-full text-sm leading-relaxed text-slate-800">
                            {assistantMessage.thoughtContent?.trim() && (
                              <div className="mb-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 backdrop-blur-sm">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedThoughtMessageIds((prev) =>
                                      prev.includes(assistantMessage.id)
                                        ? prev.filter((id) => id !== assistantMessage.id)
                                        : [...prev, assistantMessage.id],
                                    )
                                  }
                                  className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <i className="fa-regular fa-lightbulb text-slate-500" />
                                    {t('aiReporting.thoughtLabel', {
                                      defaultValue: 'Thought process',
                                    })}
                                  </span>
                                  <i
                                    className={`fa-solid ${
                                      isThoughtExpanded ? 'fa-chevron-up' : 'fa-chevron-down'
                                    }`}
                                  />
                                </button>
                                <div
                                  className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
                                    isThoughtExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                                  }`}
                                >
                                  <div className="overflow-hidden">
                                    <div
                                      className={`border-t text-xs leading-relaxed text-slate-600 whitespace-pre-wrap transition-[opacity,padding,border-color,transform] duration-300 ease-out ${
                                        isThoughtExpanded
                                          ? 'border-slate-200/80 px-3 py-2.5 opacity-100 translate-y-0'
                                          : 'border-transparent px-3 py-0 opacity-0 -translate-y-1'
                                      }`}
                                    >
                                      {assistantMessage.thoughtContent}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
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
                                table: ({ children }) => {
                                  tableRenderIndex += 1;
                                  const tableId = `${assistantMessage.id}-table-${tableRenderIndex}`;
                                  const copied = copiedTableId === tableId;
                                  return (
                                    <div className="my-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                      <div className="flex items-center justify-end border-b border-slate-200 px-2 py-1.5">
                                        <button
                                          type="button"
                                          onClick={() => void handleCopyTable(tableId)}
                                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                          aria-label={t('aiReporting.copyTable', {
                                            defaultValue: 'Copy table',
                                          })}
                                        >
                                          <i
                                            className={
                                              copied
                                                ? 'fa-solid fa-check text-green-500'
                                                : 'fa-regular fa-copy'
                                            }
                                          />
                                          {copied
                                            ? t('aiReporting.copiedTable', {
                                                defaultValue: 'Copied',
                                              })
                                            : t('aiReporting.copyTable', {
                                                defaultValue: 'Copy table',
                                              })}
                                        </button>
                                      </div>
                                      <div className="max-w-full overflow-x-auto">
                                        <table
                                          ref={(tableElement) => {
                                            if (tableElement) {
                                              tableRefs.current[tableId] = tableElement;
                                            } else {
                                              delete tableRefs.current[tableId];
                                            }
                                          }}
                                          className="w-max min-w-full border-collapse text-left text-[13px] leading-relaxed text-slate-700"
                                        >
                                          {children}
                                        </table>
                                      </div>
                                    </div>
                                  );
                                },
                                th: ({ children }) => (
                                  <th className="align-top whitespace-nowrap border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">
                                    {children}
                                  </th>
                                ),
                                td: ({ children }) => (
                                  <td className="align-top break-words border border-slate-200/80 px-3 py-2">
                                    {children}
                                  </td>
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
                              {assistantMessage.content}
                            </ReactMarkdown>
                            <div className="mt-2 flex justify-start items-center gap-1.5">
                              <Tooltip
                                label={
                                  copiedMessageId === assistantMessage.id
                                    ? t('notifications:copied', {
                                        defaultValue: 'Copied to clipboard',
                                      })
                                    : t('common:buttons.copy', { defaultValue: 'Copy' })
                                }
                              >
                                {() => (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCopy(assistantMessage.id, assistantMessage.content)
                                    }
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                                    aria-label={t('common:buttons.copy', { defaultValue: 'Copy' })}
                                  >
                                    <i
                                      className={
                                        copiedMessageId === assistantMessage.id
                                          ? 'fa-solid fa-check text-green-500'
                                          : 'fa-regular fa-copy'
                                      }
                                    />
                                  </button>
                                )}
                              </Tooltip>
                              <Tooltip label={t('aiReporting.retry', { defaultValue: 'Retry' })}>
                                {() => (
                                  <button
                                    type="button"
                                    onClick={() => void handleRetryMessage(assistantMessage.id)}
                                    disabled={!canRetryAssistantMessage}
                                    className={`p-1.5 rounded-lg transition-colors ${
                                      canRetryAssistantMessage
                                        ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                                        : 'text-slate-300 cursor-not-allowed'
                                    }`}
                                    aria-label={t('aiReporting.retry', { defaultValue: 'Retry' })}
                                  >
                                    <i className="fa-solid fa-rotate-right" />
                                  </button>
                                )}
                              </Tooltip>
                              {attemptCount > 1 && (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedAttemptIndexByGroup((prev) => ({
                                        ...prev,
                                        [group.id]: Math.max(0, safeSelectedIndex - 1),
                                      }))
                                    }
                                    disabled={safeSelectedIndex <= 0}
                                    aria-label={t('aiReporting.previousVersion', {
                                      defaultValue: 'Previous version',
                                    })}
                                    className={`p-1 text-xs rounded transition-colors ${
                                      safeSelectedIndex > 0
                                        ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                                        : 'text-slate-300 cursor-not-allowed'
                                    }`}
                                  >
                                    <i className="fa-solid fa-chevron-left text-[10px]" />
                                  </button>
                                  <span className="text-xs text-slate-500 min-w-[36px] text-center">
                                    {safeSelectedIndex + 1}/{attemptCount}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSelectedAttemptIndexByGroup((prev) => ({
                                        ...prev,
                                        [group.id]: Math.min(
                                          attemptCount - 1,
                                          safeSelectedIndex + 1,
                                        ),
                                      }))
                                    }
                                    disabled={safeSelectedIndex >= attemptCount - 1}
                                    aria-label={t('aiReporting.nextVersion', {
                                      defaultValue: 'Next version',
                                    })}
                                    className={`p-1 text-xs rounded transition-colors ${
                                      safeSelectedIndex < attemptCount - 1
                                        ? 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                                        : 'text-slate-300 cursor-not-allowed'
                                    }`}
                                  >
                                    <i className="fa-solid fa-chevron-right text-[10px]" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
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
