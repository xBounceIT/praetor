import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { CopyButton } from '@/components/ui/copy-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import api from '../../services/api';
import type { ReportChatMessage, ReportChatSessionSummary } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import Modal from '../shared/Modal';
import SelectControl from '../shared/SelectControl';
import StatusBadge from '../shared/StatusBadge';

export interface AiReportingViewProps {
  currentUserId: string;
  permissions: string[];
  enableAiReporting: boolean;
}

type MarkdownRendererProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentPropsWithoutRef<Tag> & {
    children?: React.ReactNode;
  };

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

const normalizeTableCellText = (value: string) =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      return trimmed ? [trimmed] : [];
    })
    .join(' <br> ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|');

const toMarkdownTableRow = (cells: string[]) => `| ${cells.join(' | ')} |`;

const tableElementToMarkdown = (table: HTMLTableElement) => {
  const rows = Array.from(table.querySelectorAll('tr')).reduce<string[][]>((acc, row) => {
    const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
      normalizeTableCellText(cell.textContent || ''),
    );
    if (cells.length > 0) acc.push(cells);
    return acc;
  }, []);

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

type AttemptSelectionAction = { type: 'set'; groupId: string; index: number } | { type: 'reset' };
type StateUpdate<T> = T | ((prev: T) => T);

type AiReportingState = {
  sessions: ReportChatSessionSummary[];
  activeSessionId: string;
  isNewChat: boolean;
  messages: ReportChatMessage[];
  draft: string;
  isLoadingSessions: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  isCreatingSession: boolean;
  isSending: boolean;
  error: string;
  isDeleteConfirmOpen: boolean;
  sessionToDelete: ReportChatSessionSummary | null;
  isDeletingSession: boolean;
  isAtBottom: boolean;
  hasNewText: boolean;
  expandedThoughtMessageIds: string[];
  editingMessageId: string;
  editingDraft: string;
};

type AiReportingStateInit = Pick<AiReportingViewProps, 'currentUserId' | 'enableAiReporting'>;

type AiReportingSetAction = {
  [Key in keyof AiReportingState]: {
    type: 'set';
    key: Key;
    update: StateUpdate<AiReportingState[Key]>;
  };
}[keyof AiReportingState];

type AiReportingStateAction =
  | AiReportingSetAction
  | ({ type: 'resetForReportingSession' } & AiReportingStateInit)
  | { type: 'syncLoadedActiveSession'; activeSessionId: string };

const attemptSelectionReducer = (
  state: Record<string, number>,
  action: AttemptSelectionAction,
): Record<string, number> => {
  switch (action.type) {
    case 'set':
      return { ...state, [action.groupId]: action.index };
    case 'reset':
      return {};
    default:
      return state;
  }
};

const resolveStateUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const createAiReportingState = ({
  currentUserId,
  enableAiReporting,
}: AiReportingStateInit): AiReportingState => ({
  sessions: [],
  activeSessionId: '',
  isNewChat: false,
  messages: [],
  draft: '',
  isLoadingSessions: Boolean(currentUserId && enableAiReporting),
  isLoadingMessages: false,
  isLoadingOlderMessages: false,
  hasOlderMessages: false,
  isCreatingSession: false,
  isSending: false,
  error: '',
  isDeleteConfirmOpen: false,
  sessionToDelete: null,
  isDeletingSession: false,
  isAtBottom: true,
  hasNewText: false,
  expandedThoughtMessageIds: [],
  editingMessageId: '',
  editingDraft: '',
});

const applyAiReportingFieldUpdate = (
  state: AiReportingState,
  action: AiReportingSetAction,
): AiReportingState => {
  const current = state[action.key];
  return {
    ...state,
    [action.key]: resolveStateUpdate(current, action.update as StateUpdate<typeof current>),
  };
};

const aiReportingStateReducer = (
  state: AiReportingState,
  action: AiReportingStateAction,
): AiReportingState => {
  switch (action.type) {
    case 'set':
      return applyAiReportingFieldUpdate(state, action);
    case 'resetForReportingSession':
      return createAiReportingState(action);
    case 'syncLoadedActiveSession':
      return action.activeSessionId
        ? { ...state, isNewChat: false, hasNewText: false }
        : {
            ...state,
            messages: [],
            hasOlderMessages: false,
            isLoadingOlderMessages: false,
          };
  }
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

const useAiReportingController = ({
  currentUserId,
  permissions,
  enableAiReporting,
}: AiReportingViewProps) => {
  const { t, i18n } = useTranslation(['reports', 'common']);
  const [reportingState, dispatchReportingState] = useReducer(
    aiReportingStateReducer,
    { currentUserId, enableAiReporting },
    createAiReportingState,
  );
  const {
    sessions,
    activeSessionId,
    isNewChat,
    messages,
    draft,
    isLoadingSessions,
    isLoadingMessages,
    isLoadingOlderMessages,
    hasOlderMessages,
    isCreatingSession,
    isSending,
    error,
    isDeleteConfirmOpen,
    sessionToDelete,
    isDeletingSession,
    isAtBottom,
    hasNewText,
    expandedThoughtMessageIds,
    editingMessageId,
    editingDraft,
  } = reportingState;
  const setReportingState = useCallback(
    <Key extends keyof AiReportingState>(
      key: Key,
      update: StateUpdate<AiReportingState[Key]>,
    ) => {
      dispatchReportingState({ type: 'set', key, update } as AiReportingStateAction);
    },
    [],
  );
  const setSessions = useCallback(
    (update: StateUpdate<AiReportingState['sessions']>) =>
      setReportingState('sessions', update),
    [setReportingState],
  );
  const setActiveSessionId = useCallback(
    (update: StateUpdate<AiReportingState['activeSessionId']>) =>
      setReportingState('activeSessionId', update),
    [setReportingState],
  );
  const setIsNewChat = useCallback(
    (update: StateUpdate<AiReportingState['isNewChat']>) =>
      setReportingState('isNewChat', update),
    [setReportingState],
  );
  const setMessages = useCallback(
    (update: StateUpdate<AiReportingState['messages']>) =>
      setReportingState('messages', update),
    [setReportingState],
  );
  const setDraft = useCallback(
    (update: StateUpdate<AiReportingState['draft']>) => setReportingState('draft', update),
    [setReportingState],
  );
  const setIsLoadingSessions = useCallback(
    (update: StateUpdate<AiReportingState['isLoadingSessions']>) =>
      setReportingState('isLoadingSessions', update),
    [setReportingState],
  );
  const setIsLoadingMessages = useCallback(
    (update: StateUpdate<AiReportingState['isLoadingMessages']>) =>
      setReportingState('isLoadingMessages', update),
    [setReportingState],
  );
  const setIsLoadingOlderMessages = useCallback(
    (update: StateUpdate<AiReportingState['isLoadingOlderMessages']>) =>
      setReportingState('isLoadingOlderMessages', update),
    [setReportingState],
  );
  const setHasOlderMessages = useCallback(
    (update: StateUpdate<AiReportingState['hasOlderMessages']>) =>
      setReportingState('hasOlderMessages', update),
    [setReportingState],
  );
  const setIsCreatingSession = useCallback(
    (update: StateUpdate<AiReportingState['isCreatingSession']>) =>
      setReportingState('isCreatingSession', update),
    [setReportingState],
  );
  const setIsSending = useCallback(
    (update: StateUpdate<AiReportingState['isSending']>) =>
      setReportingState('isSending', update),
    [setReportingState],
  );
  const setError = useCallback(
    (update: StateUpdate<AiReportingState['error']>) => setReportingState('error', update),
    [setReportingState],
  );
  const setIsDeleteConfirmOpen = useCallback(
    (update: StateUpdate<AiReportingState['isDeleteConfirmOpen']>) =>
      setReportingState('isDeleteConfirmOpen', update),
    [setReportingState],
  );
  const setSessionToDelete = useCallback(
    (update: StateUpdate<AiReportingState['sessionToDelete']>) =>
      setReportingState('sessionToDelete', update),
    [setReportingState],
  );
  const setIsDeletingSession = useCallback(
    (update: StateUpdate<AiReportingState['isDeletingSession']>) =>
      setReportingState('isDeletingSession', update),
    [setReportingState],
  );
  const setIsAtBottom = useCallback(
    (update: StateUpdate<AiReportingState['isAtBottom']>) =>
      setReportingState('isAtBottom', update),
    [setReportingState],
  );
  const setHasNewText = useCallback(
    (update: StateUpdate<AiReportingState['hasNewText']>) =>
      setReportingState('hasNewText', update),
    [setReportingState],
  );
  const setExpandedThoughtMessageIds = useCallback(
    (update: StateUpdate<AiReportingState['expandedThoughtMessageIds']>) =>
      setReportingState('expandedThoughtMessageIds', update),
    [setReportingState],
  );
  const setEditingMessageId = useCallback(
    (update: StateUpdate<AiReportingState['editingMessageId']>) =>
      setReportingState('editingMessageId', update),
    [setReportingState],
  );
  const setEditingDraft = useCallback(
    (update: StateUpdate<AiReportingState['editingDraft']>) =>
      setReportingState('editingDraft', update),
    [setReportingState],
  );
  const [attemptSelectionByGroup, dispatchAttemptSelection] = useReducer(
    attemptSelectionReducer,
    {},
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const loadTokenRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sendRunIdRef = useRef(0);
  const activeAssistantMessageIdRef = useRef('');
  const pendingEmptySessionIdRef = useRef('');
  const pendingRetryAutoSelectGroupRef = useRef('');
  const tableRefs = useRef<Record<string, HTMLTableElement | null>>({});
  const reportingSessionKey = `${currentUserId}|${enableAiReporting ? 'enabled' : 'disabled'}`;
  const loadedReportingSessionKeyRef = useRef(reportingSessionKey);
  const loadedActiveSessionIdRef = useRef(activeSessionId);

  if (loadedReportingSessionKeyRef.current !== reportingSessionKey) {
    sendRunIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    activeAssistantMessageIdRef.current = '';
    loadedReportingSessionKeyRef.current = reportingSessionKey;
    loadedActiveSessionIdRef.current = '';
    setSessions([]);
    setActiveSessionId('');
    setIsNewChat(false);
    setMessages([]);
    setDraft('');
    setError('');
    setIsLoadingSessions(Boolean(currentUserId && enableAiReporting));
    setIsLoadingMessages(false);
    setIsLoadingOlderMessages(false);
    setIsSending(false);
    setHasNewText(false);
    setHasOlderMessages(false);
    setExpandedThoughtMessageIds([]);
    pendingEmptySessionIdRef.current = '';
    dispatchAttemptSelection({ type: 'reset' });
  }

  if (loadedActiveSessionIdRef.current !== activeSessionId) {
    pendingRetryAutoSelectGroupRef.current = '';
    loadedActiveSessionIdRef.current = activeSessionId;
    dispatchAttemptSelection({ type: 'reset' });
    if (activeSessionId) {
      setIsNewChat(false);
      setHasNewText(false);
    } else {
      setMessages([]);
      setHasOlderMessages(false);
      setIsLoadingOlderMessages(false);
    }
  }

  const canSend =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'create'));
  const canArchive =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'view'));

  const assistantAttemptGroups = useMemo(() => buildAssistantAttemptGroups(messages), [messages]);
  const selectedAttemptIndexByGroup = useMemo(() => {
    const next: Record<string, number> = {};
    const pendingGroupId = pendingRetryAutoSelectGroupRef.current;
    let autoSelectApplied = false;

    for (const group of assistantAttemptGroups) {
      const maxIndex = group.assistantAttempts.length - 1;
      if (maxIndex < 0) continue;
      let index = Math.min(attemptSelectionByGroup[group.id] ?? 0, maxIndex);
      if (pendingGroupId && pendingGroupId === group.id) {
        index = maxIndex;
        autoSelectApplied = true;
      }
      next[group.id] = index;
    }

    if (autoSelectApplied) pendingRetryAutoSelectGroupRef.current = '';
    return next;
  }, [assistantAttemptGroups, attemptSelectionByGroup]);
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
  }, [getIsAtBottom, setHasNewText, setIsAtBottom]);

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

      const markTextArrived = () => {
        if (isAtBottomRef.current) {
          requestAnimationFrame(scrollToBottom);
        } else {
          setHasNewText(true);
        }
      };

      const animateText = (
        text: string,
        chunkSize: number,
        applyChunk: (value: string) => void,
      ): Promise<boolean> =>
        new Promise((resolve) => {
          let index = 0;
          let next = '';
          const tick = () => {
            if (!shouldContinue()) {
              resolve(false);
              return;
            }
            if (index >= text.length) {
              resolve(true);
              return;
            }
            next += text.slice(index, index + chunkSize);
            index += chunkSize;
            applyChunk(next);
            markTextArrived();
            window.setTimeout(tick, speedMs);
          };
          tick();
        });

      const thoughtTyped = await animateText(finalThought, thoughtChunks, (nextThought) => {
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
      });
      if (!thoughtTyped) return false;

      const answerTyped = await animateText(finalContent, answerChunks, (nextAnswer) => {
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
      });
      if (!answerTyped) return false;

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
    [scrollToBottom, setHasNewText, setMessages],
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
    [isNewChat, setActiveSessionId, setError, setIsLoadingSessions, setSessions, t],
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
        if (token === loadTokenRef.current) {
          const pendingEmptySessionId = pendingEmptySessionIdRef.current;
          if (
            pendingEmptySessionId &&
            sessionId === pendingEmptySessionId &&
            data.some((message) => message.sessionId === pendingEmptySessionId)
          ) {
            pendingEmptySessionIdRef.current = '';
          }
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
        }
      } catch (err) {
        if (token === loadTokenRef.current) {
          setError((err as Error).message || t('aiReporting.error'));
          setHasOlderMessages(false);
        }
      } finally {
        if (token === loadTokenRef.current) setIsLoadingMessages(false);
      }
    },
    [
      t,
      scrollToBottom,
      setError,
      setHasNewText,
      setHasOlderMessages,
      setIsLoadingMessages,
      setIsLoadingOlderMessages,
      setMessages,
      updateAtBottom,
    ],
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
    setError,
    setHasOlderMessages,
    setIsLoadingOlderMessages,
    setMessages,
    t,
  ]);

  const handleNewChat = async () => {
    if (!enableAiReporting) return;
    if (!canSend || isCreatingSession || isSending || isLoadingMessages || isEmptySession) return;

    const pendingEmptySessionId = pendingEmptySessionIdRef.current;
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
      pendingEmptySessionIdRef.current = session.id;
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
    const thinkingLabel = t('aiReporting.thinking', { defaultValue: 'Thinking...' });
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
        if (!isRunActive()) return;
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
              if (
                pendingEmptySessionIdRef.current &&
                sessionId === pendingEmptySessionIdRef.current
              ) {
                pendingEmptySessionIdRef.current = '';
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

        if (isRunActive()) {
          syncAssistantSession(streamed.sessionId);
          closeThoughtPanel();

          if (!hadSession && streamed.sessionId) {
            setActiveSessionId(streamed.sessionId);
            setIsNewChat(false);
          }
          if (
            pendingEmptySessionIdRef.current &&
            streamed.sessionId === pendingEmptySessionIdRef.current
          ) {
            pendingEmptySessionIdRef.current = '';
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
        }
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
          if (!isRunActive()) return;
          const fallback = await api.reports.chat(
            {
              sessionId: activeSessionId || undefined,
              message: content,
              language: i18n.language,
            },
            abortController.signal,
          );
          if (isRunActive()) {
            if (!hadSession) {
              setActiveSessionId(fallback.sessionId);
              setIsNewChat(false);
            }
            if (
              pendingEmptySessionIdRef.current &&
              fallback.sessionId === pendingEmptySessionIdRef.current
            ) {
              pendingEmptySessionIdRef.current = '';
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
            if (completed && isRunActive()) {
              if (activeAssistantMessageIdRef.current === assistantMessageId) {
                activeAssistantMessageIdRef.current = '';
              }
              setExpandedThoughtMessageIds((prev) =>
                prev.filter((id) => id !== assistantMessageId),
              );
              await loadSessions({ preferredSessionId: fallback.sessionId });
            } else {
              cleanupCancelledAssistant();
            }
          } else {
            cleanupCancelledAssistant();
          }
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

    const thinkingLabel = t('aiReporting.thinking', { defaultValue: 'Thinking...' });
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

      if (!isRunActive()) return;
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

      if (isRunActive()) {
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
      }
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

  const resolveTableMarkdown = useCallback((tableId: string): string | null => {
    const tableElement = tableRefs.current[tableId];
    if (!tableElement) return null;
    return tableElementToMarkdown(tableElement) || null;
  }, []);

  useEffect(() => {
    if (!currentUserId || !enableAiReporting) return;
    void loadSessions();
  }, [currentUserId, enableAiReporting, loadSessions]);

  useEffect(() => {
    if (!enableAiReporting) return;
    if (!activeSessionId) return;
    void loadMessages(activeSessionId, { forceScroll: true });
  }, [activeSessionId, enableAiReporting, loadMessages]);

  const confirmDeleteSession = useCallback(
    (session: ReportChatSessionSummary) => {
      setSessionToDelete(session);
      setIsDeleteConfirmOpen(true);
    },
    [setIsDeleteConfirmOpen, setSessionToDelete],
  );

  const handleArchiveSession = useCallback(async () => {
    if (!canArchive) return;
    if (!sessionToDelete) return;
    if (isDeletingSession) return;

    setIsDeletingSession(true);
    setError('');
    try {
      await api.reports.archiveSession(sessionToDelete.id);
      if (sessionToDelete.id === pendingEmptySessionIdRef.current) {
        pendingEmptySessionIdRef.current = '';
      }
      setIsDeleteConfirmOpen(false);
      setSessionToDelete(null);
      await loadSessions();
    } catch (err) {
      setError((err as Error).message || t('aiReporting.error'));
    } finally {
      setIsDeletingSession(false);
    }
  }, [
    canArchive,
    isDeletingSession,
    loadSessions,
    sessionToDelete,
    setError,
    setIsDeleteConfirmOpen,
    setIsDeletingSession,
    setSessionToDelete,
    t,
  ]);

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

  return {
    t,
    enableAiReporting,
    activeTitle,
    sessionOptions,
    activeSessionId,
    isNewChat,
    isLoadingSessions,
    sessions,
    canDeleteActive,
    activeSession,
    isCreatingSession,
    isNewChatDisabled,
    confirmDeleteSession,
    handleNewChat,
    setIsNewChat,
    setActiveSessionId,
    setHasNewText,
    error,
    canSend,
    scrollRef,
    endRef,
    updateAtBottom,
    showLoadOlderButton,
    isLoadingOlderMessages,
    isLoadingMessages,
    messages,
    assistantAttemptGroups,
    selectedAttemptIndexByGroup,
    expandedThoughtMessageIds,
    loadOlderMessages,
    isSending,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    setEditingMessageId,
    setExpandedThoughtMessageIds,
    handleEditSend,
    handleRetryMessage,
    getRetryMessageContent,
    resolveTableMarkdown,
    tableRefs,
    dispatchAttemptSelection,
    showGoToBottom,
    hasNewText,
    scrollToBottom,
    draft,
    footerHintWithPeriod,
    aiWarning,
    setDraft,
    handleSend,
    handleStop,
    isDeleteConfirmOpen,
    sessionToDelete,
    canArchive,
    isDeletingSession,
    setIsDeleteConfirmOpen,
    setSessionToDelete,
    handleArchiveSession,
  };
};

type AiReportingController = ReturnType<typeof useAiReportingController>;
type TranslationFn = ReturnType<typeof useTranslation>['t'];
type SessionOption = { id: string; name: string };
type AiReportingSetter<Key extends keyof AiReportingState> = (
  update: StateUpdate<AiReportingState[Key]>,
) => void;

const AiReportingView: React.FC<AiReportingViewProps> = (props) => {
  const controller = useAiReportingController(props);
  return <AiReportingLayout controller={controller} />;
};

const AiReportingLayout: React.FC<{ controller: AiReportingController }> = ({ controller }) => {
  const {
    t,
    enableAiReporting,
    activeTitle,
    sessionOptions,
    activeSessionId,
    isNewChat,
    isLoadingSessions,
    sessions,
    canDeleteActive,
    activeSession,
    isCreatingSession,
    isNewChatDisabled,
    confirmDeleteSession,
    handleNewChat,
    setIsNewChat,
    setActiveSessionId,
    setHasNewText,
    error,
    canSend,
    scrollRef,
    endRef,
    updateAtBottom,
    showLoadOlderButton,
    isLoadingOlderMessages,
    isLoadingMessages,
    messages,
    assistantAttemptGroups,
    selectedAttemptIndexByGroup,
    expandedThoughtMessageIds,
    loadOlderMessages,
    isSending,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    setEditingMessageId,
    setExpandedThoughtMessageIds,
    handleEditSend,
    handleRetryMessage,
    getRetryMessageContent,
    resolveTableMarkdown,
    tableRefs,
    dispatchAttemptSelection,
    showGoToBottom,
    hasNewText,
    scrollToBottom,
    draft,
    footerHintWithPeriod,
    aiWarning,
    setDraft,
    handleSend,
    handleStop,
    isDeleteConfirmOpen,
    sessionToDelete,
    canArchive,
    isDeletingSession,
    setIsDeleteConfirmOpen,
    setSessionToDelete,
    handleArchiveSession,
  } = controller;

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[560px]">
      <div className="flex-1 flex flex-col min-w-0 relative">
        <AiReportingHeader
          t={t}
          activeTitle={activeTitle}
          sessionOptions={sessionOptions}
          activeSessionId={activeSessionId}
          state={{
            isNewChat,
            isLoadingSessions,
            sessionsCount: sessions.length,
            canDeleteActive,
            isCreatingSession,
            isNewChatDisabled,
          }}
          activeSession={activeSession}
          onConfirmDeleteSession={confirmDeleteSession}
          onNewChat={() => void handleNewChat()}
          setIsNewChat={setIsNewChat}
          setActiveSessionId={setActiveSessionId}
          setHasNewText={setHasNewText}
        />

        <AiReportingAlerts
          t={t}
          error={error}
          enableAiReporting={enableAiReporting}
          canSend={canSend}
        />

        <AiReportingConversation
          t={t}
          state={{
            isEnabled: enableAiReporting,
            showLoadOlderButton,
            isLoadingOlderMessages,
            isLoadingMessages,
          }}
          scrollRef={scrollRef}
          endRef={endRef}
          onScroll={updateAtBottom}
          messages={messages}
          assistantAttemptGroups={assistantAttemptGroups}
          selectedAttemptIndexByGroup={selectedAttemptIndexByGroup}
          expandedThoughtMessageIds={expandedThoughtMessageIds}
          onLoadOlderMessages={() => void loadOlderMessages()}
          interactions={{
            t,
            canSend,
            isSending,
            editingMessageId,
            editingDraft,
            setEditingDraft,
            setEditingMessageId,
            setExpandedThoughtMessageIds,
            handleEditSend,
            handleRetryMessage,
            getRetryMessageContent,
            resolveTableMarkdown,
            tableRefs,
            dispatchAttemptSelection,
          }}
        />

        {showGoToBottom && (
          <AiReportingScrollButton
            t={t}
            hasNewText={hasNewText}
            onGoToBottom={() => {
              scrollToBottom();
              setHasNewText(false);
            }}
          />
        )}

        {enableAiReporting && (
          <AiReportingComposer
            t={t}
            draft={draft}
            canSend={canSend}
            isSending={isSending}
            footerHintWithPeriod={footerHintWithPeriod}
            aiWarning={aiWarning}
            setDraft={setDraft}
            onSend={() => void handleSend()}
            onStop={handleStop}
          />
        )}
      </div>

      <AiReportingDeleteModal
        t={t}
        isOpen={isDeleteConfirmOpen}
        sessionToDelete={sessionToDelete}
        canArchive={canArchive}
        isDeletingSession={isDeletingSession}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setSessionToDelete(null);
        }}
        onArchive={() => void handleArchiveSession()}
      />
    </div>
  );
};

interface AiReportingHeaderProps {
  t: TranslationFn;
  activeTitle: string;
  sessionOptions: SessionOption[];
  activeSessionId: string;
  state: {
    isNewChat: boolean;
    isLoadingSessions: boolean;
    sessionsCount: number;
    canDeleteActive: boolean;
    isCreatingSession: boolean;
    isNewChatDisabled: boolean;
  };
  activeSession: ReportChatSessionSummary | null;
  onConfirmDeleteSession: (session: ReportChatSessionSummary) => void;
  onNewChat: () => void;
  setIsNewChat: AiReportingSetter<'isNewChat'>;
  setActiveSessionId: AiReportingSetter<'activeSessionId'>;
  setHasNewText: AiReportingSetter<'hasNewText'>;
}

const AiReportingHeader: React.FC<AiReportingHeaderProps> = ({
  t,
  activeTitle,
  sessionOptions,
  activeSessionId,
  state,
  activeSession,
  onConfirmDeleteSession,
  onNewChat,
  setIsNewChat,
  setActiveSessionId,
  setHasNewText,
}) => {
  const {
    isNewChat,
    isLoadingSessions,
    sessionsCount,
    canDeleteActive,
    isCreatingSession,
    isNewChatDisabled,
  } = state;

  return (
    <div className="flex items-start justify-between gap-4 mb-4 px-4 md:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-black text-zinc-400 uppercase tracking-widest">
            {t('aiReporting.session', { defaultValue: 'Session' })}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-base font-extrabold text-zinc-900 truncate">{activeTitle}</div>
            <StatusBadge type="experimental" label="EXPERIMENTAL" className="shrink-0" />
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-3">
        <div className="w-48 sm:w-56 md:w-72">
          <SelectControl
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
            disabled={isLoadingSessions || sessionsCount === 0}
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
            onConfirmDeleteSession(activeSession);
          }}
          className={`size-11 rounded-xl flex items-center justify-center transition-colors ${
            canDeleteActive
              ? 'bg-white border border-zinc-200 text-red-600 hover:text-red-600 hover:bg-red-50'
              : 'bg-zinc-100 border border-zinc-200 text-zinc-300 cursor-not-allowed'
          }`}
        >
          <i className="fa-solid fa-trash text-sm" />
        </button>

        <button
          type="button"
          onClick={onNewChat}
          disabled={isNewChatDisabled}
          className={`px-5 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2 ${
            !isNewChatDisabled
              ? 'bg-praetor text-white shadow-xl shadow-zinc-200 hover:bg-[var(--color-primary-hover)] active:scale-95'
              : 'bg-zinc-100 border border-zinc-200 text-zinc-400 shadow-none cursor-not-allowed active:scale-100'
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
  );
};

interface AiReportingAlertsProps {
  t: TranslationFn;
  error: string;
  enableAiReporting: boolean;
  canSend: boolean;
}

const AiReportingAlerts: React.FC<AiReportingAlertsProps> = ({
  t,
  error,
  enableAiReporting,
  canSend,
}) => (
  <>
    {error && (
      <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300 mx-4 md:mx-6">
        {error}
      </div>
    )}

    {!enableAiReporting && (
      <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 mx-4 md:mx-6">
        {t('aiReporting.disabledByAdmin', {
          defaultValue: 'AI Reporting is disabled by administration.',
        })}
      </div>
    )}

    {enableAiReporting && !canSend && (
      <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 mx-4 md:mx-6">
        {t('aiReporting.noPermissionToSend', { defaultValue: 'You do not have permission.' })}
      </div>
    )}
  </>
);

interface AiReportingMessageInteractions {
  t: TranslationFn;
  canSend: boolean;
  isSending: boolean;
  editingMessageId: string;
  editingDraft: string;
  setEditingDraft: AiReportingSetter<'editingDraft'>;
  setEditingMessageId: AiReportingSetter<'editingMessageId'>;
  setExpandedThoughtMessageIds: AiReportingSetter<'expandedThoughtMessageIds'>;
  handleEditSend: (userMessage: ReportChatMessage) => Promise<void>;
  handleRetryMessage: (assistantMessageId: string) => Promise<void>;
  getRetryMessageContent: (assistantMessageId: string) => string;
  resolveTableMarkdown: (tableId: string) => string | null;
  tableRefs: React.MutableRefObject<Record<string, HTMLTableElement | null>>;
  dispatchAttemptSelection: React.Dispatch<AttemptSelectionAction>;
}

interface AiReportingConversationProps {
  t: TranslationFn;
  state: {
    isEnabled: boolean;
    showLoadOlderButton: boolean;
    isLoadingOlderMessages: boolean;
    isLoadingMessages: boolean;
  };
  scrollRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  messages: ReportChatMessage[];
  assistantAttemptGroups: AssistantAttemptGroup[];
  selectedAttemptIndexByGroup: Record<string, number>;
  expandedThoughtMessageIds: string[];
  onLoadOlderMessages: () => void;
  interactions: AiReportingMessageInteractions;
}

const AiReportingConversation: React.FC<AiReportingConversationProps> = ({
  t,
  state,
  scrollRef,
  endRef,
  onScroll,
  messages,
  assistantAttemptGroups,
  selectedAttemptIndexByGroup,
  expandedThoughtMessageIds,
  onLoadOlderMessages,
  interactions,
}) => {
  const { isEnabled, showLoadOlderButton, isLoadingOlderMessages, isLoadingMessages } = state;

  return isEnabled ? (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 md:px-6 pb-52">
      <div className="mx-auto w-full max-w-[760px]">
        {showLoadOlderButton && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={onLoadOlderMessages}
              disabled={isLoadingOlderMessages || isLoadingMessages}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                isLoadingOlderMessages || isLoadingMessages
                  ? 'cursor-not-allowed border-zinc-200 text-zinc-400 bg-zinc-50'
                  : 'border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50'
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
          <div className="text-sm text-zinc-500">{t('aiReporting.thinking')}</div>
        )}

        {!isLoadingMessages && messages.length === 0 && <AiReportingEmptyState t={t} />}

        <div className="space-y-7">
          {assistantAttemptGroups.map((group) => (
            <AiReportingMessageGroup
              key={group.id}
              group={group}
              selectedAttemptIndex={selectedAttemptIndexByGroup[group.id] ?? 0}
              expandedThoughtMessageIds={expandedThoughtMessageIds}
              interactions={interactions}
            />
          ))}
        </div>
      </div>
      <div ref={endRef} />
    </div>
  ) : (
    <AiReportingDisabledPane t={t} />
  );
};

const AiReportingEmptyState: React.FC<{ t: TranslationFn }> = ({ t }) => (
  <div className="min-h-[45vh] flex items-center justify-center px-4">
    <div className="max-w-xl text-center">
      <div className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">
        {t('aiReporting.emptyPlaceholderTitle', {
          defaultValue: 'What should we build together now?',
        })}
      </div>
      <div className="mt-3 text-sm md:text-base text-zinc-500 leading-relaxed">
        {t('aiReporting.emptyPlaceholderBody', {
          defaultValue:
            'Start with a question about your business data. I will use your reports to help you.',
        })}
      </div>
    </div>
  </div>
);

const AiReportingDisabledPane: React.FC<{ t: TranslationFn }> = ({ t }) => (
  <div className="flex-1 px-4 md:px-6 pb-52">
    <div className="mx-auto w-full max-w-[760px] pt-10">
      <div className="rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 p-6">
        <div className="text-sm font-black text-zinc-900">
          {t('aiReporting.disabledTitle', { defaultValue: 'AI Reporting disabled' })}
        </div>
        <div className="mt-2 text-sm text-zinc-600">
          {t('aiReporting.disabledBody', {
            defaultValue:
              'This feature has been disabled by administration. Contact an admin to enable it in General Administration.',
          })}
        </div>
      </div>
    </div>
  </div>
);

interface AiReportingMessageGroupProps {
  group: AssistantAttemptGroup;
  selectedAttemptIndex: number;
  expandedThoughtMessageIds: string[];
  interactions: AiReportingMessageInteractions;
}

const AiReportingMessageGroup: React.FC<AiReportingMessageGroupProps> = ({
  group,
  selectedAttemptIndex,
  expandedThoughtMessageIds,
  interactions,
}) => {
  const userMessage = group.userMessage;
  const attemptCount = group.assistantAttempts.length;
  const safeSelectedIndex = Math.max(0, Math.min(selectedAttemptIndex, Math.max(0, attemptCount - 1)));
  const assistantMessage = attemptCount > 0 ? group.assistantAttempts[safeSelectedIndex] : null;
  const isThoughtExpanded = assistantMessage
    ? expandedThoughtMessageIds.includes(assistantMessage.id)
    : false;
  const retryContent = assistantMessage
    ? interactions.getRetryMessageContent(assistantMessage.id)
    : '';
  const canRetryAssistantMessage =
    Boolean(assistantMessage) && Boolean(retryContent) && interactions.canSend && !interactions.isSending;

  return (
    <div className="space-y-4">
      {userMessage && <AiReportingUserMessage message={userMessage} interactions={interactions} />}
      {assistantMessage && (
        <AiReportingAssistantMessage
          groupId={group.id}
          message={assistantMessage}
          attemptCount={attemptCount}
          selectedAttemptIndex={safeSelectedIndex}
          isThoughtExpanded={isThoughtExpanded}
          canRetry={canRetryAssistantMessage}
          interactions={interactions}
        />
      )}
    </div>
  );
};

interface AiReportingUserMessageProps {
  message: ReportChatMessage;
  interactions: AiReportingMessageInteractions;
}

const AiReportingUserMessage: React.FC<AiReportingUserMessageProps> = ({
  message,
  interactions,
}) => {
  const {
    t,
    canSend,
    isSending,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    setEditingMessageId,
    handleEditSend,
  } = interactions;
  const isEditing = editingMessageId === message.id;
  const editDisabled = isSending || !canSend || editingMessageId !== '' || message.id.startsWith('tmp-');

  return (
    <div className="group w-full flex justify-end">
      {isEditing ? (
        <div className="w-full">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <textarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.target.value)}
              rows={3}
              aria-label={t('aiReporting.editMessage', {
                defaultValue: 'Edit message',
              })}
              className="w-full resize-none bg-transparent outline-none text-sm leading-relaxed text-zinc-800"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setEditingMessageId('');
                  setEditingDraft('');
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleEditSend(message);
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
                className="px-4 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-800 hover:bg-zinc-200 rounded-full transition-colors"
              >
                {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={() => void handleEditSend(message)}
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
            {message.content}
          </div>
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-all">
            <Tooltip>
              <TooltipTrigger asChild>
                <CopyButton
                  iconOnly
                  variant="ghost"
                  size="icon-sm"
                  value={message.content}
                  aria-label={t('common:buttons.copy', { defaultValue: 'Copy' })}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.copy', { defaultValue: 'Copy' })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingMessageId(message.id);
                      setEditingDraft(message.content);
                    }}
                    disabled={editDisabled}
                    aria-label={t('common:buttons.edit', { defaultValue: 'Edit' })}
                    className={`p-1.5 rounded-lg transition-colors ${
                      editDisabled
                        ? 'text-zinc-300 cursor-not-allowed'
                        : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
                    }`}
                  >
                    <i className="fa-regular fa-pen-to-square" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.edit', { defaultValue: 'Edit' })}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
};

interface AiReportingAssistantMessageProps {
  groupId: string;
  message: ReportChatMessage;
  attemptCount: number;
  selectedAttemptIndex: number;
  isThoughtExpanded: boolean;
  canRetry: boolean;
  interactions: AiReportingMessageInteractions;
}

const AiReportingAssistantMessage: React.FC<AiReportingAssistantMessageProps> = ({
  groupId,
  message,
  attemptCount,
  selectedAttemptIndex,
  isThoughtExpanded,
  canRetry,
  interactions,
}) => {
  const { t, setExpandedThoughtMessageIds, handleRetryMessage, dispatchAttemptSelection } =
    interactions;

  return (
    <div className="group w-full flex justify-start">
      <div className="w-full text-sm leading-relaxed text-zinc-800">
        {message.thoughtContent?.trim() && (
          <AiReportingThoughtPanel
            t={t}
            message={message}
            isExpanded={isThoughtExpanded}
            setExpandedThoughtMessageIds={setExpandedThoughtMessageIds}
          />
        )}
        <AiMarkdownMessage message={message} interactions={interactions} />
        <div className="mt-2 flex justify-start items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                iconOnly
                variant="ghost"
                size="icon-sm"
                value={message.content}
                aria-label={t('common:buttons.copy', { defaultValue: 'Copy' })}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            </TooltipTrigger>
            <TooltipContent>{t('common:buttons.copy', { defaultValue: 'Copy' })}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <button
                  type="button"
                  onClick={() => void handleRetryMessage(message.id)}
                  disabled={!canRetry}
                  className={`p-1.5 rounded-lg transition-colors ${
                    canRetry
                      ? 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                      : 'text-zinc-300 cursor-not-allowed'
                  }`}
                  aria-label={t('aiReporting.retry', { defaultValue: 'Retry' })}
                >
                  <i className="fa-solid fa-rotate-right" />
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t('aiReporting.retry', { defaultValue: 'Retry' })}</TooltipContent>
          </Tooltip>
          {attemptCount > 1 && (
            <AiReportingAttemptPager
              t={t}
              groupId={groupId}
              attemptCount={attemptCount}
              selectedAttemptIndex={selectedAttemptIndex}
              dispatchAttemptSelection={dispatchAttemptSelection}
            />
          )}
        </div>
      </div>
    </div>
  );
};

interface AiReportingThoughtPanelProps {
  t: TranslationFn;
  message: ReportChatMessage;
  isExpanded: boolean;
  setExpandedThoughtMessageIds: AiReportingSetter<'expandedThoughtMessageIds'>;
}

const AiReportingThoughtPanel: React.FC<AiReportingThoughtPanelProps> = ({
  t,
  message,
  isExpanded,
  setExpandedThoughtMessageIds,
}) => (
  <div className="mb-3 rounded-2xl border border-zinc-200/80 bg-zinc-50/70 backdrop-blur-sm">
    <button
      type="button"
      onClick={() =>
        setExpandedThoughtMessageIds((prev) =>
          prev.includes(message.id) ? prev.filter((id) => id !== message.id) : [...prev, message.id],
        )
      }
      className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-zinc-600 hover:text-zinc-800 transition-colors"
    >
      <span className="inline-flex items-center gap-2">
        <i className="fa-regular fa-lightbulb text-zinc-500" />
        {t('aiReporting.thoughtLabel', { defaultValue: 'Thought process' })}
      </span>
      <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`} />
    </button>
    <div
      className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="overflow-hidden">
        <div
          className={`border-t text-xs leading-relaxed text-zinc-600 whitespace-pre-wrap transition-[opacity,padding,border-color,transform] duration-300 ease-out ${
            isExpanded
              ? 'border-zinc-200/80 px-3 py-2.5 opacity-100 translate-y-0'
              : 'border-transparent px-3 py-0 opacity-0 -translate-y-1'
          }`}
        >
          {message.thoughtContent}
        </div>
      </div>
    </div>
  </div>
);

const AiMarkdownMessage: React.FC<{
  message: ReportChatMessage;
  interactions: AiReportingMessageInteractions;
}> = ({ message, interactions }) => {
  const { t, resolveTableMarkdown, tableRefs } = interactions;
  let tableRenderIndex = 0;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        a: ({ children, href }: MarkdownRendererProps<'a'>) => {
          const safe = safeHref(href);
          if (!safe) return <>{children}</>;
          return (
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2 text-zinc-900 hover:text-zinc-700"
            >
              {children}
            </a>
          );
        },
        img: ({ alt, src }: MarkdownRendererProps<'img'>) => {
          const safe = safeHref(src);
          const label = alt?.trim() ? alt.trim() : src || 'image';
          if (!safe) return <span className="text-zinc-500">[Image: {label}]</span>;
          return (
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline underline-offset-2 text-zinc-900 hover:text-zinc-700"
            >
              [Image: {label}]
            </a>
          );
        },
        p: ({ children }: MarkdownRendererProps<'p'>) => (
          <p className="my-2 first:mt-0 last:mb-0">{children}</p>
        ),
        h1: ({ children }: MarkdownRendererProps<'h1'>) => (
          <h1 className="mt-4 mb-2 text-lg font-semibold text-zinc-900">{children}</h1>
        ),
        h2: ({ children }: MarkdownRendererProps<'h2'>) => (
          <h2 className="mt-4 mb-2 text-base font-semibold text-zinc-900">{children}</h2>
        ),
        h3: ({ children }: MarkdownRendererProps<'h3'>) => (
          <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-900">{children}</h3>
        ),
        ul: ({ children }: MarkdownRendererProps<'ul'>) => (
          <ul className="my-2 list-disc pl-5 marker:text-zinc-400">{children}</ul>
        ),
        ol: ({ children }: MarkdownRendererProps<'ol'>) => (
          <ol className="my-2 list-decimal pl-5 marker:text-zinc-400">{children}</ol>
        ),
        li: ({ children }: MarkdownRendererProps<'li'>) => <li className="my-1">{children}</li>,
        blockquote: ({ children }: MarkdownRendererProps<'blockquote'>) => (
          <blockquote className="my-2 border-l-4 border-zinc-200 pl-3 text-zinc-700">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-zinc-200" />,
        table: ({ children }: MarkdownRendererProps<'table'>) => {
          tableRenderIndex += 1;
          const tableId = `${message.id}-table-${tableRenderIndex}`;
          return (
            <div className="my-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-end border-b border-zinc-200 px-2 py-1.5">
                <CopyButton
                  iconOnly
                  variant="ghost"
                  size="icon-xs"
                  value={() => resolveTableMarkdown(tableId)}
                  aria-label={t('aiReporting.copyTable', { defaultValue: 'Copy table' })}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                />
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
                  className="w-max min-w-full border-collapse text-left text-[13px] leading-relaxed text-zinc-700"
                >
                  {children}
                </table>
              </div>
            </div>
          );
        },
        th: ({ children }: MarkdownRendererProps<'th'>) => (
          <th className="align-top whitespace-nowrap border border-zinc-200 bg-zinc-50 px-3 py-2 font-semibold text-zinc-700">
            {children}
          </th>
        ),
        td: ({ children }: MarkdownRendererProps<'td'>) => (
          <td className="align-top break-words border border-zinc-200/80 px-3 py-2">{children}</td>
        ),
        pre: ({ children }: MarkdownRendererProps<'pre'>) => (
          <pre className="my-2 overflow-x-auto rounded-xl bg-zinc-950 p-3 text-zinc-100">
            {children}
          </pre>
        ),
        code: (props: MarkdownRendererProps<'code'> & { inline?: boolean }) => {
          // react-markdown provides `inline` here, but it is not represented in the
          // published `Components` typing (intrinsic `code` props only).
          const { inline, className, children } = props;

          if (inline === false) {
            return (
              <code
                className={`font-mono text-[12px] leading-relaxed text-zinc-100 ${
                  className ?? ''
                }`}
              >
                {children}
              </code>
            );
          }

          return (
            <code className="font-mono text-[12px] rounded bg-zinc-100 px-1 py-0.5 text-zinc-900">
              {children}
            </code>
          );
        },
      }}
    >
      {message.content}
    </ReactMarkdown>
  );
};

interface AiReportingAttemptPagerProps {
  t: TranslationFn;
  groupId: string;
  attemptCount: number;
  selectedAttemptIndex: number;
  dispatchAttemptSelection: React.Dispatch<AttemptSelectionAction>;
}

const AiReportingAttemptPager: React.FC<AiReportingAttemptPagerProps> = ({
  t,
  groupId,
  attemptCount,
  selectedAttemptIndex,
  dispatchAttemptSelection,
}) => (
  <div className="inline-flex items-center gap-1">
    <button
      type="button"
      onClick={() =>
        dispatchAttemptSelection({
          type: 'set',
          groupId,
          index: Math.max(0, selectedAttemptIndex - 1),
        })
      }
      disabled={selectedAttemptIndex <= 0}
      aria-label={t('aiReporting.previousVersion', { defaultValue: 'Previous version' })}
      className={`p-1 text-xs rounded transition-colors ${
        selectedAttemptIndex > 0
          ? 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
          : 'text-zinc-300 cursor-not-allowed'
      }`}
    >
      <i className="fa-solid fa-chevron-left text-[10px]" />
    </button>
    <span className="text-xs text-zinc-500 min-w-[36px] text-center">
      {selectedAttemptIndex + 1}/{attemptCount}
    </span>
    <button
      type="button"
      onClick={() =>
        dispatchAttemptSelection({
          type: 'set',
          groupId,
          index: Math.min(attemptCount - 1, selectedAttemptIndex + 1),
        })
      }
      disabled={selectedAttemptIndex >= attemptCount - 1}
      aria-label={t('aiReporting.nextVersion', { defaultValue: 'Next version' })}
      className={`p-1 text-xs rounded transition-colors ${
        selectedAttemptIndex < attemptCount - 1
          ? 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
          : 'text-zinc-300 cursor-not-allowed'
      }`}
    >
      <i className="fa-solid fa-chevron-right text-[10px]" />
    </button>
  </div>
);

interface AiReportingScrollButtonProps {
  t: TranslationFn;
  hasNewText: boolean;
  onGoToBottom: () => void;
}

const AiReportingScrollButton: React.FC<AiReportingScrollButtonProps> = ({
  t,
  hasNewText,
  onGoToBottom,
}) => (
  <button
    type="button"
    onClick={onGoToBottom}
    aria-label={t('aiReporting.goToBottom', { defaultValue: 'Go to bottom' })}
    className="absolute left-1/2 -translate-x-1/2 bottom-32 z-[3] size-11 rounded-full bg-white border border-zinc-200 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 transition-colors flex items-center justify-center"
  >
    <i className="fa-solid fa-arrow-down" />
    {hasNewText && (
      <span className="absolute -top-1 -right-1 size-3 rounded-full bg-praetor border-2 border-white" />
    )}
  </button>
);

interface AiReportingComposerProps {
  t: TranslationFn;
  draft: string;
  canSend: boolean;
  isSending: boolean;
  footerHintWithPeriod: string;
  aiWarning: string;
  setDraft: AiReportingSetter<'draft'>;
  onSend: () => void;
  onStop: () => void;
}

const AiReportingComposer: React.FC<AiReportingComposerProps> = ({
  t,
  draft,
  canSend,
  isSending,
  footerHintWithPeriod,
  aiWarning,
  setDraft,
  onSend,
  onStop,
}) => (
  <>
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
          <div className="rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t('aiReporting.placeholder')}
                aria-label={t('aiReporting.placeholder')}
                disabled={!canSend || isSending}
                rows={1}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  if (event.shiftKey) return;
                  event.preventDefault();
                  onSend();
                }}
                className="flex-1 resize-none bg-transparent outline-none text-sm text-zinc-900 placeholder:text-zinc-400 p-2 max-h-40 disabled:cursor-not-allowed"
              />

              {isSending ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="shrink-0 size-10 rounded-full flex items-center justify-center transition-colors bg-red-600 text-white hover:bg-red-700"
                  aria-label={t('aiReporting.stop', { defaultValue: 'Stop' })}
                >
                  <i className="fa-solid fa-stop text-sm" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend || !draft.trim()}
                  className={`shrink-0 size-10 rounded-full flex items-center justify-center transition-colors ${
                    !canSend || !draft.trim()
                      ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
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
          <div className="text-[11px] text-zinc-400">
            {footerHintWithPeriod ? `${footerHintWithPeriod} ${aiWarning}` : aiWarning}
          </div>
        </div>
      </div>
    </div>
  </>
);

interface AiReportingDeleteModalProps {
  t: TranslationFn;
  isOpen: boolean;
  sessionToDelete: ReportChatSessionSummary | null;
  canArchive: boolean;
  isDeletingSession: boolean;
  onClose: () => void;
  onArchive: () => void;
}

const AiReportingDeleteModal: React.FC<AiReportingDeleteModalProps> = ({
  t,
  isOpen,
  sessionToDelete,
  canArchive,
  isDeletingSession,
  onClose,
  onArchive,
}) => (
  <Modal isOpen={isOpen} onClose={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
      <div className="p-6 text-center space-y-4">
        <div className="size-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
          <i className="fa-solid fa-triangle-exclamation text-xl"></i>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-800">
            {t('aiReporting.deleteChatTitle', { defaultValue: 'Delete chat' })}
          </h3>
          <p className="text-sm text-zinc-500 mt-2 leading-relaxed">
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
            onClick={onClose}
            className="flex-1 py-3 text-sm font-bold text-zinc-500 hover:bg-zinc-50 rounded-xl transition-colors"
          >
            {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={!canArchive || isDeletingSession || !sessionToDelete}
            onClick={onArchive}
            className={`flex-1 py-3 text-white text-sm font-bold rounded-xl shadow-lg transition-all active:scale-95 ${
              !canArchive || isDeletingSession || !sessionToDelete
                ? 'bg-zinc-300 shadow-none cursor-not-allowed'
                : 'bg-red-600 shadow-red-200 hover:bg-red-700'
            }`}
          >
            {t('common:buttons.delete', { defaultValue: 'Delete' })}
          </button>
        </div>
      </div>
    </div>
  </Modal>
);

export default AiReportingView;
