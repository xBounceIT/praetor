import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileText,
  FlaskConical,
  Lightbulb,
  Loader2,
  MessageSquareText,
  Mic,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import DeleteConfirmModal from '@/components/shared/DeleteConfirmModal';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import api from '../../services/api';
import type { ReportChatMessage, ReportChatSessionSummary } from '../../types';
import { buildPermission, hasPermission } from '../../utils/permissions';
import {
  AiReportingVisualization,
  AiReportingVisualizationPending,
} from './AiReportingVisualization';
import {
  AI_REPORTING_ATTACHMENT_ACCEPT,
  AI_REPORTING_MAX_ATTACHMENT_BYTES,
  AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS,
  AI_REPORTING_MAX_ATTACHMENTS,
  AI_REPORTING_MAX_MESSAGE_CHARS,
  AI_REPORTING_MAX_TOTAL_ATTACHMENT_CONTENT_CHARS,
  type AiReportingAttachmentError,
  type AiReportingMessageAttachment,
  type AiReportingPendingAttachment,
  parseAiReportingMessage,
  readAiReportingAttachments,
  serializeAiReportingMessage,
} from './aiReportingAttachments';
import {
  type AiReportingSessionGroupKey,
  filterAndGroupAiReportingSessions,
} from './aiReportingSessions';
import {
  type AiReportingVisualizationParseResult,
  getAiReportingAssistantCopyText,
  parseAiReportingVisualizations,
} from './aiReportingVisualizations';
import { type AiReportingDictationError, useAiReportingDictation } from './useAiReportingDictation';

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

const AI_REPORTING_NUMBER_FORMATTER = new Intl.NumberFormat();

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
    <Key extends keyof AiReportingState>(key: Key, update: StateUpdate<AiReportingState[Key]>) => {
      dispatchReportingState({ type: 'set', key, update } as AiReportingStateAction);
    },
    [],
  );
  const setSessions = useCallback(
    (update: StateUpdate<AiReportingState['sessions']>) => setReportingState('sessions', update),
    [setReportingState],
  );
  const setActiveSessionId = useCallback(
    (update: StateUpdate<AiReportingState['activeSessionId']>) =>
      setReportingState('activeSessionId', update),
    [setReportingState],
  );
  const setIsNewChat = useCallback(
    (update: StateUpdate<AiReportingState['isNewChat']>) => setReportingState('isNewChat', update),
    [setReportingState],
  );
  const setMessages = useCallback(
    (update: StateUpdate<AiReportingState['messages']>) => setReportingState('messages', update),
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
    (update: StateUpdate<AiReportingState['isSending']>) => setReportingState('isSending', update),
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
  const sessionsLoadTokenRef = useRef(0);
  const loadTokenRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const sendRunIdRef = useRef(0);
  const activeAssistantMessageIdRef = useRef('');
  const pendingEmptySessionIdRef = useRef('');
  const [pendingRetryAutoSelectGroupId, setPendingRetryAutoSelectGroupId] = useState('');
  const tableRefs = useRef<Record<string, HTMLTableElement | null>>({});
  const [loadedActiveSessionId, setLoadedActiveSessionId] = useState(activeSessionId);
  if (loadedActiveSessionId !== activeSessionId) {
    setLoadedActiveSessionId(activeSessionId);
    dispatchAttemptSelection({ type: 'reset' });
    dispatchReportingState({ type: 'syncLoadedActiveSession', activeSessionId });
  }

  useEffect(() => {
    void activeSessionId;
    setPendingRetryAutoSelectGroupId('');
  }, [activeSessionId]);

  const canSend =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'create'));
  const canArchive =
    enableAiReporting &&
    hasPermission(permissions, buildPermission('reports.ai_reporting', 'view'));

  const assistantAttemptGroups = useMemo(() => buildAssistantAttemptGroups(messages), [messages]);
  const selectedAttemptIndexByGroup = useMemo(() => {
    const next: Record<string, number> = {};
    const pendingGroupId = pendingRetryAutoSelectGroupId;

    for (const group of assistantAttemptGroups) {
      const maxIndex = group.assistantAttempts.length - 1;
      if (maxIndex < 0) continue;
      let index = Math.min(attemptSelectionByGroup[group.id] ?? 0, maxIndex);
      if (pendingGroupId && pendingGroupId === group.id) {
        index = maxIndex;
      }
      next[group.id] = index;
    }

    return next;
  }, [assistantAttemptGroups, attemptSelectionByGroup, pendingRetryAutoSelectGroupId]);
  useEffect(() => {
    if (!pendingRetryAutoSelectGroupId) return;
    const group = assistantAttemptGroups.find(
      (candidate) => candidate.id === pendingRetryAutoSelectGroupId,
    );
    if (!group || group.assistantAttempts.length === 0) return;
    dispatchAttemptSelection({
      type: 'set',
      groupId: group.id,
      index: group.assistantAttempts.length - 1,
    });
    setPendingRetryAutoSelectGroupId('');
  }, [assistantAttemptGroups, pendingRetryAutoSelectGroupId]);
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
      const token = ++sessionsLoadTokenRef.current;
      setIsLoadingSessions(true);
      setError('');
      try {
        const data = await api.reports.listSessions();
        if (token !== sessionsLoadTokenRef.current) return;
        setSessions(data);
        setActiveSessionId((prev) => {
          // When a new session is created by the first send, the sessions list can lag behind due
          // to caching/version bump timing. Pin the UI to the newly created session id so we don't
          // accidentally "jump" to the most recently updated existing session.
          if (opts.preferredSessionId) return opts.preferredSessionId;
          if (activeAssistantMessageIdRef.current && prev) return prev;
          if (isNewChat) return '';
          if (prev && data.some((s) => s.id === prev)) return prev;
          return data[0]?.id || '';
        });
      } catch (err) {
        if (token === sessionsLoadTokenRef.current) {
          setError((err as Error).message || t('aiReporting.error'));
        }
      } finally {
        if (token === sessionsLoadTokenRef.current) setIsLoadingSessions(false);
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

    const token = ++loadTokenRef.current;
    setIsLoadingOlderMessages(true);
    setError('');
    try {
      const older = await api.reports.getSessionMessages(activeSessionId, {
        limit: MESSAGES_PAGE_SIZE,
        before: oldestLoaded.createdAt,
      });
      if (token !== loadTokenRef.current) return;
      setMessages((prev) => {
        if (older.length === 0) return prev;
        const existingIds = new Set(prev.map((m) => m.id));
        const prepend = older.filter((m) => !existingIds.has(m.id));
        return prepend.length > 0 ? [...prepend, ...prev] : prev;
      });
      setHasOlderMessages(older.length >= MESSAGES_PAGE_SIZE);
    } catch (err) {
      if (token === loadTokenRef.current) {
        setError((err as Error).message || t('aiReporting.error'));
      }
    } finally {
      if (token === loadTokenRef.current) setIsLoadingOlderMessages(false);
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
    if (!content || isSending || abortRef.current || !canSend) return;

    const abortController = new AbortController();
    const runId = ++sendRunIdRef.current;
    abortRef.current = abortController;

    // A history load already in flight must never replace the optimistic user/assistant pair
    // used by stream callbacks.
    loadTokenRef.current += 1;
    setIsLoadingMessages(false);
    setIsLoadingOlderMessages(false);

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
                    technicalInfo: streamed.technicalInfo,
                    sessionId: streamed.sessionId || m.sessionId,
                  }
                : m,
            ),
          );
          if (activeAssistantMessageIdRef.current === assistantMessageId) {
            activeAssistantMessageIdRef.current = '';
          }
          await Promise.all([
            loadMessages(streamed.sessionId, { forceScroll: false }),
            loadSessions({ preferredSessionId: streamed.sessionId }),
          ]);
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
              await Promise.all([
                loadMessages(fallback.sessionId, { forceScroll: false }),
                loadSessions({ preferredSessionId: fallback.sessionId }),
              ]);
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

  const handleSend = async (
    attachments: readonly AiReportingMessageAttachment[] = [],
  ): Promise<boolean> => {
    const text =
      draft.trim() ||
      (attachments.length > 0
        ? t('aiReporting.attachmentOnlyPrompt', {
            defaultValue: 'Analyze the attached files.',
          })
        : '');
    const content = serializeAiReportingMessage(text, attachments);
    if (!content) return false;
    if (content.length > AI_REPORTING_MAX_MESSAGE_CHARS) {
      setError(
        t('aiReporting.messageTooLong', {
          max: AI_REPORTING_MAX_MESSAGE_CHARS,
          defaultValue: 'The message and attachments exceed {{max}} characters.',
        }),
      );
      return false;
    }
    await sendMessage(content, { clearDraft: true });
    return true;
  };

  const handleEditSend = async (userMessage: ReportChatMessage) => {
    if (!enableAiReporting || !canSend || isSending || abortRef.current) return;
    const originalMessage = parseAiReportingMessage(userMessage.content);
    const editedText =
      editingDraft.trim() ||
      (originalMessage.attachments.length > 0
        ? t('aiReporting.attachmentOnlyPrompt', {
            defaultValue: 'Analyze the attached files.',
          })
        : '');
    const content = serializeAiReportingMessage(editedText, originalMessage.attachments);
    if (!content) return;
    if (content.length > AI_REPORTING_MAX_MESSAGE_CHARS) {
      setError(
        t('aiReporting.messageTooLong', {
          max: AI_REPORTING_MAX_MESSAGE_CHARS,
          defaultValue: 'The message and attachments exceed {{max}} characters.',
        }),
      );
      return;
    }

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
        await Promise.all([
          loadMessages(streamed.sessionId, { forceScroll: false }),
          loadSessions({ preferredSessionId: streamed.sessionId }),
        ]);
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
        activeAssistantMessageIdRef.current = '';
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
      setPendingRetryAutoSelectGroupId(attemptGroupId);
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
    if (activeSessionId) {
      void loadMessages(activeSessionId, { forceScroll: false });
    }
  };

  useEffect(
    () => () => {
      sessionsLoadTokenRef.current += 1;
      loadTokenRef.current += 1;
      sendRunIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

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
    // The first stream assigns its server session id before the assistant answer is persisted.
    // Loading that session here would replace the optimistic pair and orphan subsequent deltas.
    if (activeAssistantMessageIdRef.current) return;
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

  const handleRenameSession = useCallback(
    async (sessionId: string, title: string): Promise<boolean> => {
      if (!canArchive) return false;
      const normalizedTitle = title.trim();
      if (!normalizedTitle) return false;

      setError('');
      try {
        await api.reports.renameSession(sessionId, normalizedTitle);
        setSessions((currentSessions) =>
          currentSessions.map((session) =>
            session.id === sessionId ? { ...session, title: normalizedTitle } : session,
          ),
        );
        return true;
      } catch (err) {
        setError((err as Error).message || t('aiReporting.error'));
        return false;
      }
    },
    [canArchive, setError, setSessions, t],
  );

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeTitle = isNewChat
    ? t('aiReporting.newChat', { defaultValue: 'New Chat' })
    : activeSession?.title || t('aiReporting.newChat', { defaultValue: 'New Chat' });
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
    activeSessionId,
    isNewChat,
    language: i18n.language,
    isLoadingSessions,
    sessions,
    isCreatingSession,
    isNewChatDisabled,
    confirmDeleteSession,
    handleRenameSession,
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
type AiReportingSetter<Key extends keyof AiReportingState> = (
  update: StateUpdate<AiReportingState[Key]>,
) => void;

const AiReportingView: React.FC<AiReportingViewProps> = (props) => {
  // react-doctor-disable-next-line react-doctor/no-impure-state-updater -- Custom-hook invocation is misclassified as a state updater.
  const controller = useAiReportingController(props);
  return <AiReportingLayout controller={controller} />;
};

const AiReportingLayout: React.FC<{ controller: AiReportingController }> = ({ controller }) => {
  const {
    t,
    enableAiReporting,
    activeTitle,
    activeSessionId,
    language,
    isLoadingSessions,
    sessions,
    isCreatingSession,
    isNewChatDisabled,
    confirmDeleteSession,
    handleRenameSession,
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
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [showTechnicalInfo, setShowTechnicalInfo] = useState(false);
  const latestTechnicalInfo = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return messages[index].technicalInfo;
    }
    return undefined;
  }, [messages]);

  const handleSelectSession = (sessionId: string) => {
    setIsNewChat(false);
    setActiveSessionId(sessionId);
    setHasNewText(false);
    setIsHistoryOpen(false);
  };

  const sidebar = (
    <AiReportingSidebar
      t={t}
      sessions={sessions}
      activeSessionId={activeSessionId}
      isLoadingSessions={isLoadingSessions}
      isCreatingSession={isCreatingSession}
      isNewChatDisabled={isNewChatDisabled}
      canArchive={canArchive}
      isDeletingSession={isDeletingSession}
      onSelectSession={handleSelectSession}
      onConfirmDeleteSession={confirmDeleteSession}
      onRenameSession={handleRenameSession}
      onNewChat={() => {
        setIsHistoryOpen(false);
        void handleNewChat();
      }}
    />
  );

  return (
    <>
      <Card className="h-[calc(100dvh-140px)] min-h-[560px] gap-0 overflow-hidden bg-background py-0 text-foreground">
        <div className="grid h-full min-h-0 md:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="hidden min-h-0 border-r border-border md:flex">{sidebar}</aside>

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <AiReportingHeader
              t={t}
              activeTitle={activeTitle}
              technicalInfo={latestTechnicalInfo}
              showTechnicalInfo={showTechnicalInfo}
              onShowTechnicalInfoChange={setShowTechnicalInfo}
              onOpenHistory={() => setIsHistoryOpen(true)}
            />

            <AiReportingAlerts
              t={t}
              error={error}
              enableAiReporting={enableAiReporting}
              canSend={canSend}
            />

            <div className="relative flex min-h-0 flex-1">
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
                  language,
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

              {(showGoToBottom || enableAiReporting) && (
                <div
                  data-slot="ai-reporting-composer"
                  className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-3 md:px-8 md:pb-5"
                >
                  <div
                    aria-hidden="true"
                    data-slot="ai-reporting-composer-backdrop"
                    className={cn(
                      'absolute bottom-0 left-1/2 w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 bg-gradient-to-b from-background/0 via-background/70 to-background/95 backdrop-blur-md md:w-[calc(100%-4rem)]',
                      showGoToBottom ? 'top-[3.875rem]' : 'top-3.5',
                    )}
                  />
                  <div className="relative mx-auto w-full max-w-3xl">
                    <div className="relative z-10">
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
                          language={language}
                          canSend={canSend}
                          isSending={isSending}
                          footerHintWithPeriod={footerHintWithPeriod}
                          aiWarning={aiWarning}
                          setDraft={setDraft}
                          onSend={handleSend}
                          onStop={handleStop}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </Card>

      <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <SheetContent side="left" className="w-[min(22rem,90vw)] gap-0 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>
              {t('aiReporting.chatHistory', { defaultValue: 'Chat history' })}
            </SheetTitle>
            <SheetDescription>
              {t('aiReporting.chatHistoryDescription', {
                defaultValue: 'Search and select an AI Reporting conversation.',
              })}
            </SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>

      <DeleteConfirmModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          if (isDeletingSession) return;
          setIsDeleteConfirmOpen(false);
          setSessionToDelete(null);
        }}
        onConfirm={() => void handleArchiveSession()}
        isDeleting={isDeletingSession}
        title={t('aiReporting.deleteChatTitle', { defaultValue: 'Delete chat' })}
        description={t('aiReporting.deleteChatConfirm', {
          name: sessionToDelete
            ? toOptionLabel(sessionToDelete) ||
              t('aiReporting.newChat', { defaultValue: 'New Chat' })
            : '',
          defaultValue: 'This will remove "{{name}}" from your chat history.',
        })}
      />
    </>
  );
};

interface AiReportingSidebarProps {
  t: TranslationFn;
  sessions: ReportChatSessionSummary[];
  activeSessionId: string;
  isLoadingSessions: boolean;
  isCreatingSession: boolean;
  isNewChatDisabled: boolean;
  canArchive: boolean;
  isDeletingSession: boolean;
  onSelectSession: (sessionId: string) => void;
  onConfirmDeleteSession: (session: ReportChatSessionSummary) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onNewChat: () => void;
}

const getSessionGroupLabel = (t: TranslationFn, groupKey: AiReportingSessionGroupKey) => {
  switch (groupKey) {
    case 'today':
      return t('aiReporting.sessionGroups.today', { defaultValue: 'Today' });
    case 'yesterday':
      return t('aiReporting.sessionGroups.yesterday', { defaultValue: 'Yesterday' });
    case 'lastSevenDays':
      return t('aiReporting.sessionGroups.lastSevenDays', { defaultValue: 'Last 7 days' });
    case 'older':
      return t('aiReporting.sessionGroups.older', { defaultValue: 'Older' });
  }
};

export const AiReportingSidebar: React.FC<AiReportingSidebarProps> = ({
  t,
  sessions,
  activeSessionId,
  isLoadingSessions,
  isCreatingSession,
  isNewChatDisabled,
  canArchive,
  isDeletingSession,
  onSelectSession,
  onConfirmDeleteSession,
  onRenameSession,
  onNewChat,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState('');

  const cancelRename = () => {
    if (renamingSessionId) return;
    setEditingSessionId('');
    setEditingTitle('');
  };

  const beginRename = (session: ReportChatSessionSummary, title: string) => {
    setEditingSessionId(session.id);
    setEditingTitle(title);
  };

  const handleRenameSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = editingTitle.trim();
    if (!editingSessionId || !normalizedTitle || renamingSessionId) return;

    setRenamingSessionId(editingSessionId);
    const didRename = await onRenameSession(editingSessionId, normalizedTitle);
    setRenamingSessionId('');
    if (didRename) {
      setEditingSessionId('');
      setEditingTitle('');
    }
  };
  const sessionGroups = useMemo(
    () => filterAndGroupAiReportingSessions(sessions, searchQuery),
    [searchQuery, sessions],
  );
  const hasSearchResults = sessionGroups.length > 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sidebar-foreground">
              {t('aiReporting.title', { defaultValue: 'AI Reporting' })}
            </div>
            <Badge
              variant="secondary"
              className="mt-1 bg-sidebar-accent text-sidebar-accent-foreground uppercase tracking-wide hover:bg-sidebar-accent"
            >
              <FlaskConical />
              {t('aiReporting.experimental', { defaultValue: 'Experimental' })}
            </Badge>
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sidebar-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('aiReporting.searchChats', { defaultValue: 'Search chats...' })}
            aria-label={t('aiReporting.searchChats', { defaultValue: 'Search chats...' })}
            className="border-sidebar-border bg-sidebar-accent/70 pl-9 text-sidebar-foreground placeholder:text-sidebar-foreground/60 focus-visible:ring-sidebar-ring"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-3">
          {isLoadingSessions && (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-sidebar-foreground/70">
              <Loader2 className="size-4 animate-spin" />
              {t('aiReporting.loadingSessions', { defaultValue: 'Loading...' })}
            </div>
          )}

          {!isLoadingSessions && sessions.length === 0 && (
            <Empty className="border-0 px-3 py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sidebar-foreground">
                  {t('aiReporting.noSessions', { defaultValue: 'No chats yet.' })}
                </EmptyTitle>
                <EmptyDescription className="text-sidebar-foreground/70">
                  {t('aiReporting.noSessionsDescription', {
                    defaultValue: 'Start a new conversation to analyze your business data.',
                  })}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {!isLoadingSessions && sessions.length > 0 && !hasSearchResults && (
            <Empty className="border-0 px-3 py-10">
              <EmptyHeader>
                <EmptyTitle className="text-sidebar-foreground">
                  {t('aiReporting.noSearchResults', { defaultValue: 'No chats found' })}
                </EmptyTitle>
                <EmptyDescription className="text-sidebar-foreground/70">
                  {t('aiReporting.noSearchResultsDescription', {
                    defaultValue: 'Try a different search term.',
                  })}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {!isLoadingSessions &&
            sessionGroups.map((group) => (
              <div key={group.key}>
                <div className="mb-1 px-3 text-xs font-medium text-sidebar-foreground/70">
                  {getSessionGroupLabel(t, group.key)}
                </div>
                <div className="space-y-1">
                  {group.sessions.map((session) => {
                    const isActive = session.id === activeSessionId;
                    const title =
                      toOptionLabel(session) ||
                      t('aiReporting.newChat', { defaultValue: 'New Chat' });
                    if (editingSessionId === session.id) {
                      return (
                        <form
                          key={session.id}
                          onSubmit={(event) => void handleRenameSubmit(event)}
                          className="flex min-h-10 items-center gap-1 rounded-md bg-sidebar-accent p-1 text-sidebar-accent-foreground"
                        >
                          <MessageSquareText className="ml-2 size-4 shrink-0 text-sidebar-accent-foreground/70" />
                          <Input
                            autoFocus
                            value={editingTitle}
                            maxLength={80}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Escape') return;
                              event.preventDefault();
                              cancelRename();
                            }}
                            aria-label={t('aiReporting.renameChatInput', {
                              defaultValue: 'Chat title',
                            })}
                            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-sidebar-accent-foreground shadow-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
                          />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon-xs"
                            disabled={!editingTitle.trim() || renamingSessionId === session.id}
                            aria-label={t('aiReporting.saveChatTitle', {
                              defaultValue: 'Save chat title',
                            })}
                            className="text-sidebar-accent-foreground hover:bg-sidebar-primary/10 hover:text-sidebar-accent-foreground"
                          >
                            {renamingSessionId === session.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Check />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={renamingSessionId === session.id}
                            onClick={cancelRename}
                            aria-label={t('aiReporting.cancelRename', {
                              defaultValue: 'Cancel rename',
                            })}
                            className="text-sidebar-accent-foreground hover:bg-sidebar-primary/10 hover:text-sidebar-accent-foreground"
                          >
                            <X />
                          </Button>
                        </form>
                      );
                    }

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'group/session relative grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => onSelectSession(session.id)}
                          className="h-auto w-full min-w-0 justify-start bg-transparent px-3 py-2.5 font-normal text-inherit hover:bg-transparent hover:text-inherit"
                        >
                          <MessageSquareText className="size-4 shrink-0 text-current opacity-70" />
                          <span className="w-0 min-w-0 flex-1 truncate text-left">{title}</span>
                        </Button>
                        <div
                          className={cn(
                            'z-10 flex items-center gap-0.5 pr-1 transition-opacity',
                            isActive
                              ? 'opacity-100'
                              : 'md:opacity-0 md:group-focus-within/session:opacity-100 md:group-hover/session:opacity-100',
                          )}
                        >
                          <Tooltip disableHoverableContent>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={
                                    !canArchive || isDeletingSession || Boolean(renamingSessionId)
                                  }
                                  onClick={() => beginRename(session, title)}
                                  className="text-sidebar-foreground/70 hover:bg-sidebar-primary/10 hover:text-sidebar-foreground"
                                  aria-label={t('aiReporting.renameChatAria', {
                                    name: title,
                                    defaultValue: 'Rename chat {{name}}',
                                  })}
                                >
                                  <Pencil />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('aiReporting.renameChatTitle', { defaultValue: 'Rename chat' })}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip disableHoverableContent>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={
                                    !canArchive || isDeletingSession || Boolean(renamingSessionId)
                                  }
                                  onClick={() => onConfirmDeleteSession(session)}
                                  className="text-sidebar-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                                  aria-label={t('aiReporting.deleteChatAria', {
                                    name: title,
                                    defaultValue: 'Delete chat {{name}}',
                                  })}
                                >
                                  <Trash2 />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t('aiReporting.deleteChatTitle', { defaultValue: 'Delete chat' })}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        <Button
          type="button"
          onClick={onNewChat}
          disabled={isNewChatDisabled}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isCreatingSession ? <Loader2 className="animate-spin" /> : <Plus />}
          {t('aiReporting.newChat', { defaultValue: 'New Chat' })}
        </Button>
      </div>
    </div>
  );
};

interface AiReportingHeaderProps {
  t: TranslationFn;
  activeTitle: string;
  technicalInfo?: ReportChatMessage['technicalInfo'];
  showTechnicalInfo: boolean;
  onShowTechnicalInfoChange: (checked: boolean) => void;
  onOpenHistory: () => void;
}

const AiReportingHeader: React.FC<AiReportingHeaderProps> = ({
  t,
  activeTitle,
  technicalInfo,
  showTechnicalInfo,
  onShowTechnicalInfoChange,
  onOpenHistory,
}) => {
  const contextPercentage = technicalInfo
    ? Math.round((technicalInfo.contextTokensUsed / technicalInfo.contextWindowTokens) * 100)
    : 0;
  const isContextWarning = contextPercentage > 80;

  return (
    <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="md:hidden"
          onClick={onOpenHistory}
          aria-label={t('aiReporting.openChatHistory', { defaultValue: 'Open chat history' })}
        >
          <PanelLeftOpen />
        </Button>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            {t('aiReporting.session', { defaultValue: 'Session' })}
          </div>
          <div className="truncate font-semibold text-foreground">{activeTitle}</div>
        </div>
      </div>

      <div className="ml-auto flex min-w-0 flex-col items-end gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          {t('aiReporting.technicalInfo', { defaultValue: 'Technical info' })}
          <Switch
            checked={showTechnicalInfo}
            onCheckedChange={onShowTechnicalInfoChange}
            aria-label={t('aiReporting.technicalInfoToggle', {
              defaultValue: 'Show technical information',
            })}
          />
        </label>

        {showTechnicalInfo && (
          <div className="flex max-w-full flex-wrap justify-end gap-2" aria-live="polite">
            {technicalInfo ? (
              <>
                <Badge variant="secondary" className="max-w-full truncate font-normal">
                  {technicalInfo.provider} · {technicalInfo.modelId}
                </Badge>
                <Badge
                  variant={isContextWarning ? 'destructive' : 'outline'}
                  className="gap-1.5 font-normal tabular-nums"
                >
                  {t('aiReporting.contextWindow', { defaultValue: 'Context' })}{' '}
                  {AI_REPORTING_NUMBER_FORMATTER.format(technicalInfo.contextTokensUsed)} /{' '}
                  {AI_REPORTING_NUMBER_FORMATTER.format(technicalInfo.contextWindowTokens)} (
                  {contextPercentage}%)
                  {isContextWarning && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="-m-1 size-5 cursor-help hover:bg-foreground/10 hover:text-current"
                          aria-label={t('aiReporting.contextWindowWarningLabel', {
                            defaultValue: 'Context window warning',
                          })}
                        >
                          <TriangleAlert className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t('aiReporting.contextWindowWarning', {
                          defaultValue:
                            'The context window is almost full. Performance may deteriorate; consider starting a new chat.',
                        })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </Badge>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('aiReporting.technicalInfoUnavailable', {
                  defaultValue: 'Available after the next AI response.',
                })}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
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
  <div className="space-y-2 px-4 pt-3 md:px-6 empty:hidden">
    {error && (
      <Alert variant="destructive">
        <TriangleAlert />
        {error}
      </Alert>
    )}

    {!enableAiReporting && (
      <Alert>
        {t('aiReporting.disabledByAdmin', {
          defaultValue: 'AI Reporting is disabled by administration.',
        })}
      </Alert>
    )}

    {enableAiReporting && !canSend && (
      <Alert>
        {t('aiReporting.noPermissionToSend', { defaultValue: 'You do not have permission.' })}
      </Alert>
    )}
  </div>
);

interface AiReportingMessageInteractions {
  t: TranslationFn;
  language: string;
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
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-slot="ai-reporting-conversation-scroll"
      className="min-h-0 flex-1 overflow-y-auto px-4 pt-6 pb-28 [scrollbar-gutter:stable_both-edges] md:px-8 md:pb-32"
    >
      <div className="mx-auto w-full max-w-3xl">
        {showLoadOlderButton && (
          <div className="mb-4 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLoadOlderMessages}
              disabled={isLoadingOlderMessages || isLoadingMessages}
              className="rounded-full"
            >
              {isLoadingOlderMessages && <Loader2 className="animate-spin" />}
              {isLoadingOlderMessages
                ? t('aiReporting.loadingOlder', { defaultValue: 'Loading older messages...' })
                : t('aiReporting.loadOlder', { defaultValue: 'Load older messages' })}
            </Button>
          </div>
        )}

        {isLoadingMessages && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('aiReporting.thinking')}
          </div>
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
  <Empty className="min-h-[45vh] border-0 px-4">
    <EmptyHeader className="max-w-xl">
      <EmptyMedia className="mb-4">
        <img
          src="/praetor-logo.png"
          alt=""
          aria-hidden="true"
          className="h-20 w-auto object-contain dark:brightness-0 dark:invert"
        />
      </EmptyMedia>
      <EmptyTitle className="text-2xl font-semibold tracking-tight md:text-3xl">
        {t('aiReporting.emptyPlaceholderTitle', {
          defaultValue: 'What should we build together now?',
        })}
      </EmptyTitle>
      <EmptyDescription className="text-sm md:text-base">
        {t('aiReporting.emptyPlaceholderBody', {
          defaultValue:
            'Start with a question about your business data. I will use your reports to help you.',
        })}
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const AiReportingDisabledPane: React.FC<{ t: TranslationFn }> = ({ t }) => (
  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-10 md:px-8">
    <Card className="mx-auto max-w-3xl">
      <CardContent>
        <CardTitle>
          {t('aiReporting.disabledTitle', { defaultValue: 'AI Reporting disabled' })}
        </CardTitle>
        <CardDescription className="mt-2">
          {t('aiReporting.disabledBody', {
            defaultValue:
              'This feature has been disabled by administration. Contact an admin to enable it in General Administration.',
          })}
        </CardDescription>
      </CardContent>
    </Card>
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
  const safeSelectedIndex = Math.max(
    0,
    Math.min(selectedAttemptIndex, Math.max(0, attemptCount - 1)),
  );
  const assistantMessage = attemptCount > 0 ? group.assistantAttempts[safeSelectedIndex] : null;
  const isThoughtExpanded = assistantMessage
    ? expandedThoughtMessageIds.includes(assistantMessage.id)
    : false;
  const retryContent = assistantMessage
    ? interactions.getRetryMessageContent(assistantMessage.id)
    : '';
  const canRetryAssistantMessage =
    Boolean(assistantMessage) &&
    Boolean(retryContent) &&
    interactions.canSend &&
    !interactions.isSending;

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
  const parsedMessage = useMemo(() => parseAiReportingMessage(message.content), [message.content]);
  const copyValue = [
    parsedMessage.text,
    ...parsedMessage.attachments.map((attachment) => attachment.name),
  ]
    .filter(Boolean)
    .join('\n');
  const editDisabled =
    isSending || !canSend || editingMessageId !== '' || message.id.startsWith('tmp-');

  return (
    <div className="group w-full flex justify-end">
      {isEditing ? (
        <div className="w-full">
          <Card className="gap-3 rounded-2xl bg-muted/30 p-3 py-3">
            {parsedMessage.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {parsedMessage.attachments.map((attachment) => (
                  <Badge key={attachment.name} variant="secondary">
                    <FileText />
                    <span className="max-w-52 truncate">{attachment.name}</span>
                  </Badge>
                ))}
              </div>
            )}
            <Textarea
              value={editingDraft}
              onChange={(event) => setEditingDraft(event.target.value)}
              rows={3}
              aria-label={t('aiReporting.editMessage', {
                defaultValue: 'Edit message',
              })}
              className="resize-none text-sm leading-relaxed"
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingMessageId('');
                  setEditingDraft('');
                }}
              >
                {t('common:buttons.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleEditSend(message)}
                disabled={!editingDraft.trim() && parsedMessage.attachments.length === 0}
              >
                {t('common:buttons.send', { defaultValue: 'Send' })}
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col items-end max-w-[85%]">
          <div className="space-y-2 rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-primary-foreground">
            {parsedMessage.text && <div className="whitespace-pre-wrap">{parsedMessage.text}</div>}
            {parsedMessage.attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {parsedMessage.attachments.map((attachment) => (
                  <Badge
                    key={attachment.name}
                    className="max-w-full border-primary-foreground/20 bg-primary-foreground/15 text-primary-foreground"
                  >
                    <FileText />
                    <span className="max-w-52 truncate">{attachment.name}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <Tooltip>
              <TooltipTrigger asChild>
                <CopyButton
                  iconOnly
                  variant="ghost"
                  size="icon-sm"
                  value={copyValue}
                  aria-label={t('common:buttons.copy', { defaultValue: 'Copy' })}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              </TooltipTrigger>
              <TooltipContent>{t('common:buttons.copy', { defaultValue: 'Copy' })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setEditingMessageId(message.id);
                      setEditingDraft(parsedMessage.text);
                    }}
                    disabled={editDisabled}
                    aria-label={t('common:buttons.edit', { defaultValue: 'Edit' })}
                    className="text-muted-foreground"
                  >
                    <Pencil />
                  </Button>
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
  const parsedContent = useMemo(
    () => parseAiReportingVisualizations(message.content),
    [message.content],
  );
  const copyText = useMemo(() => getAiReportingAssistantCopyText(parsedContent), [parsedContent]);

  return (
    <div className="group w-full flex justify-start">
      <div className="w-full text-sm leading-relaxed text-foreground">
        {message.thoughtContent?.trim() && (
          <AiReportingThoughtPanel
            t={t}
            message={message}
            isExpanded={isThoughtExpanded}
            setExpandedThoughtMessageIds={setExpandedThoughtMessageIds}
          />
        )}
        <AiMarkdownMessage
          message={message}
          interactions={interactions}
          parsedContent={parsedContent}
        />
        <div className="mt-2 flex justify-start items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                iconOnly
                variant="ghost"
                size="icon-sm"
                value={copyText}
                aria-label={t('common:buttons.copy', { defaultValue: 'Copy' })}
                className="text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            </TooltipTrigger>
            <TooltipContent>{t('common:buttons.copy', { defaultValue: 'Copy' })}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleRetryMessage(message.id)}
                  disabled={!canRetry}
                  className="text-muted-foreground"
                  aria-label={t('aiReporting.retry', { defaultValue: 'Retry' })}
                >
                  <RefreshCw />
                </Button>
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
  <Card className="mb-3 gap-0 overflow-hidden rounded-2xl bg-muted/30 py-0">
    <Button
      type="button"
      variant="ghost"
      onClick={() =>
        setExpandedThoughtMessageIds((prev) =>
          prev.includes(message.id)
            ? prev.filter((id) => id !== message.id)
            : [...prev, message.id],
        )
      }
      className="h-auto w-full justify-between rounded-none px-3 py-2.5 text-xs"
    >
      <span className="inline-flex items-center gap-2">
        <Lightbulb className="size-4 text-muted-foreground" />
        {t('aiReporting.thoughtLabel', { defaultValue: 'Thought process' })}
      </span>
      {isExpanded ? <ChevronUp /> : <ChevronDown />}
    </Button>
    <div
      className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div className="overflow-hidden">
        <div
          className={`border-t text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap transition-[opacity,padding,border-color,transform] duration-300 ease-out ${
            isExpanded
              ? 'border-border px-3 py-2.5 opacity-100 translate-y-0'
              : 'border-transparent px-3 py-0 opacity-0 -translate-y-1'
          }`}
        >
          {message.thoughtContent}
        </div>
      </div>
    </div>
  </Card>
);

const AiMarkdownMessage: React.FC<{
  message: ReportChatMessage;
  interactions: AiReportingMessageInteractions;
  parsedContent: AiReportingVisualizationParseResult;
}> = ({ message, interactions, parsedContent }) => {
  const { t, language, resolveTableMarkdown, tableRefs } = interactions;
  let tableRenderIndex = 0;

  return (
    <>
      {parsedContent.markdown ? (
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
                  className="font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80"
                >
                  {children}
                </a>
              );
            },
            img: ({ alt, src }: MarkdownRendererProps<'img'>) => {
              const safe = safeHref(src);
              const label = alt?.trim() ? alt.trim() : src || 'image';
              if (!safe) return <span className="text-muted-foreground">[Image: {label}]</span>;
              return (
                <a
                  href={safe}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-foreground underline underline-offset-2 hover:text-foreground/80"
                >
                  [Image: {label}]
                </a>
              );
            },
            p: ({ children }: MarkdownRendererProps<'p'>) => (
              <p className="my-2 first:mt-0 last:mb-0">{children}</p>
            ),
            h1: ({ children }: MarkdownRendererProps<'h1'>) => (
              <h1 className="mt-4 mb-2 text-lg font-semibold text-foreground">{children}</h1>
            ),
            h2: ({ children }: MarkdownRendererProps<'h2'>) => (
              <h2 className="mt-4 mb-2 text-base font-semibold text-foreground">{children}</h2>
            ),
            h3: ({ children }: MarkdownRendererProps<'h3'>) => (
              <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground">{children}</h3>
            ),
            ul: ({ children }: MarkdownRendererProps<'ul'>) => (
              <ul className="my-2 list-disc pl-5 marker:text-muted-foreground">{children}</ul>
            ),
            ol: ({ children }: MarkdownRendererProps<'ol'>) => (
              <ol className="my-2 list-decimal pl-5 marker:text-muted-foreground">{children}</ol>
            ),
            li: ({ children }: MarkdownRendererProps<'li'>) => <li className="my-1">{children}</li>,
            blockquote: ({ children }: MarkdownRendererProps<'blockquote'>) => (
              <blockquote className="my-2 border-l-4 border-border pl-3 text-muted-foreground">
                {children}
              </blockquote>
            ),
            hr: () => <hr className="my-3 border-border" />,
            table: ({ children }: MarkdownRendererProps<'table'>) => {
              tableRenderIndex += 1;
              const tableId = `${message.id}-table-${tableRenderIndex}`;
              return (
                <Card className="my-3 gap-0 overflow-hidden rounded-2xl py-0">
                  <div className="flex items-center justify-end border-b border-border px-2 py-1.5">
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
                      className="w-max min-w-full border-collapse text-left text-[13px] leading-relaxed text-foreground"
                    >
                      {children}
                    </table>
                  </div>
                </Card>
              );
            },
            th: ({ children }: MarkdownRendererProps<'th'>) => (
              <th className="align-top whitespace-nowrap border border-border bg-muted px-3 py-2 font-semibold text-foreground">
                {children}
              </th>
            ),
            td: ({ children }: MarkdownRendererProps<'td'>) => (
              <td className="align-top break-words border border-border px-3 py-2">{children}</td>
            ),
            pre: ({ children }: MarkdownRendererProps<'pre'>) => (
              <pre className="my-2 overflow-x-auto rounded-xl bg-muted p-3 text-foreground">
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
                    className={`font-mono text-[12px] leading-relaxed text-foreground ${className ?? ''}`}
                  >
                    {children}
                  </code>
                );
              }

              return (
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">
                  {children}
                </code>
              );
            },
          }}
        >
          {parsedContent.markdown}
        </ReactMarkdown>
      ) : null}
      {parsedContent.visualizations.map((visualization, index) => (
        <AiReportingVisualization
          key={`${message.id}-visualization-${index}`}
          visualization={visualization}
          language={language}
        />
      ))}
      {parsedContent.hasPendingVisualization ? <AiReportingVisualizationPending /> : null}
      {parsedContent.invalidVisualizationCount > 0 ? (
        <Alert variant="destructive" className="my-3">
          <TriangleAlert aria-hidden="true" />
          <span>
            {t('aiReporting.visualizationInvalid', {
              defaultValue: 'The AI returned a visualization that could not be rendered safely.',
            })}
          </span>
        </Alert>
      ) : null}
    </>
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
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={() =>
        dispatchAttemptSelection({
          type: 'set',
          groupId,
          index: Math.max(0, selectedAttemptIndex - 1),
        })
      }
      disabled={selectedAttemptIndex <= 0}
      aria-label={t('aiReporting.previousVersion', { defaultValue: 'Previous version' })}
      className="text-muted-foreground"
    >
      <ChevronLeft />
    </Button>
    <span className="min-w-[36px] text-center text-xs text-muted-foreground">
      {selectedAttemptIndex + 1}/{attemptCount}
    </span>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={() =>
        dispatchAttemptSelection({
          type: 'set',
          groupId,
          index: Math.min(attemptCount - 1, selectedAttemptIndex + 1),
        })
      }
      disabled={selectedAttemptIndex >= attemptCount - 1}
      aria-label={t('aiReporting.nextVersion', { defaultValue: 'Next version' })}
      className="text-muted-foreground"
    >
      <ChevronRight />
    </Button>
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
  <div className="mb-2 flex justify-center">
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      onClick={onGoToBottom}
      aria-label={t('aiReporting.goToBottom', { defaultValue: 'Go to bottom' })}
      className="pointer-events-auto relative rounded-full bg-background/80 text-muted-foreground shadow-md backdrop-blur-xl"
    >
      <ArrowDown />
      {hasNewText && (
        <span className="absolute -top-1 -right-1 size-3 rounded-full border-2 border-background bg-primary" />
      )}
    </Button>
  </div>
);

interface AiReportingComposerProps {
  t: TranslationFn;
  draft: string;
  language: string;
  canSend: boolean;
  isSending: boolean;
  footerHintWithPeriod: string;
  aiWarning: string;
  setDraft: AiReportingSetter<'draft'>;
  onSend: (attachments?: readonly AiReportingMessageAttachment[]) => Promise<boolean>;
  onStop: () => void;
}

const getAttachmentErrorMessage = (t: TranslationFn, error: AiReportingAttachmentError) => {
  switch (error.code) {
    case 'tooManyFiles':
      return t('aiReporting.attachmentTooMany', {
        max: AI_REPORTING_MAX_ATTACHMENTS,
        defaultValue: 'You can attach up to {{max}} files.',
      });
    case 'unsupportedType':
      return t('aiReporting.attachmentUnsupported', {
        name: error.fileName,
        defaultValue: '“{{name}}” is not a supported text file.',
      });
    case 'fileTooLarge':
      return t('aiReporting.attachmentTooLarge', {
        name: error.fileName,
        max: Math.round(AI_REPORTING_MAX_ATTACHMENT_BYTES / 1024),
        defaultValue: '“{{name}}” is too large. The limit is {{max}} KB per file.',
      });
    case 'fileContentTooLong':
      return t('aiReporting.attachmentContentTooLong', {
        name: error.fileName,
        max: AI_REPORTING_MAX_ATTACHMENT_CONTENT_CHARS,
        defaultValue: '“{{name}}” contains more than {{max}} text characters.',
      });
    case 'totalContentTooLarge':
      return t('aiReporting.attachmentTotalTooLarge', {
        max: AI_REPORTING_MAX_TOTAL_ATTACHMENT_CONTENT_CHARS,
        defaultValue: 'Attached file content cannot exceed {{max}} characters in total.',
      });
    case 'readFailed':
      return t('aiReporting.attachmentReadFailed', {
        defaultValue: 'One or more files could not be read.',
      });
  }
};

const AiReportingComposer: React.FC<AiReportingComposerProps> = ({
  t,
  draft,
  language,
  canSend,
  isSending,
  footerHintWithPeriod,
  aiWarning,
  setDraft,
  onSend,
  onStop,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<AiReportingPendingAttachment[]>([]);
  const [composerError, setComposerError] = useState('');
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);

  const appendTranscript = useCallback(
    (transcript: string) => {
      const normalizedTranscript = transcript.trim();
      if (!normalizedTranscript) return;
      setDraft((currentDraft) => {
        const separator = currentDraft && !/\s$/.test(currentDraft) ? ' ' : '';
        return `${currentDraft}${separator}${normalizedTranscript}`;
      });
    },
    [setDraft],
  );
  const handleDictationError = useCallback(
    (error: AiReportingDictationError) => {
      const messages: Record<AiReportingDictationError, { key: string; fallback: string }> = {
        'microphone-permission': {
          key: 'aiReporting.dictationPermissionDenied',
          fallback:
            'Microphone access was denied. Allow it in your browser settings and try again.',
        },
        'microphone-unavailable': {
          key: 'aiReporting.dictationMicrophoneUnavailable',
          fallback: 'No available microphone was found.',
        },
        'recording-failed': {
          key: 'aiReporting.dictationError',
          fallback: 'Voice recording could not be started.',
        },
        'no-speech': {
          key: 'aiReporting.dictationNoSpeech',
          fallback: 'No speech was detected. Try again and speak closer to the microphone.',
        },
        'transcription-unavailable': {
          key: 'aiReporting.dictationTranscriptionUnavailable',
          fallback: 'Voice transcription is not configured for the selected AI provider.',
        },
        'transcription-failed': {
          key: 'aiReporting.dictationTranscriptionFailed',
          fallback: 'The recording could not be transcribed. Please try again.',
        },
      };
      const message = messages[error];
      setComposerError(t(message.key, { defaultValue: message.fallback }));
    },
    [t],
  );
  const transcribeDictation = useCallback(
    async (audio: Blob, dictationLanguage: string) =>
      (await api.reports.transcribeAudio(audio, dictationLanguage)).text,
    [],
  );
  const {
    isListening,
    isTranscribing,
    isSupported: isDictationSupported,
    stop: stopDictation,
    toggle: toggleDictation,
  } = useAiReportingDictation({
    language,
    onError: handleDictationError,
    onTranscript: appendTranscript,
    transcribe: transcribeDictation,
  });

  const handleAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;

    setComposerError('');
    setIsReadingAttachments(true);
    const result = await readAiReportingAttachments(files, attachments);
    setIsReadingAttachments(false);

    if (result.error) {
      setComposerError(getAttachmentErrorMessage(t, result.error));
      return;
    }
    setAttachments((currentAttachments) => [...currentAttachments, ...result.attachments]);
  };

  const attachmentOnlyPrompt = t('aiReporting.attachmentOnlyPrompt', {
    defaultValue: 'Analyze the attached files.',
  });
  const canSubmit =
    canSend &&
    !isSending &&
    !isReadingAttachments &&
    !isTranscribing &&
    (Boolean(draft.trim()) || attachments.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const content = serializeAiReportingMessage(draft.trim() || attachmentOnlyPrompt, attachments);
    if (content.length > AI_REPORTING_MAX_MESSAGE_CHARS) {
      setComposerError(
        t('aiReporting.messageTooLong', {
          max: AI_REPORTING_MAX_MESSAGE_CHARS,
          defaultValue: 'The message and attachments exceed {{max}} characters.',
        }),
      );
      return;
    }

    stopDictation();
    setComposerError('');
    if (await onSend(attachments)) {
      setAttachments([]);
    }
  };

  return (
    <>
      {attachments.length > 0 && (
        <div className="pointer-events-auto mb-2 flex flex-wrap gap-2 px-2">
          {attachments.map((attachment) => (
            <Badge key={attachment.id} variant="secondary" className="max-w-full gap-1 pl-2">
              <FileText />
              <span className="max-w-48 truncate">{attachment.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() =>
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((item) => item.id !== attachment.id),
                  )
                }
                aria-label={t('aiReporting.removeAttachment', {
                  name: attachment.name,
                  defaultValue: 'Remove attachment {{name}}',
                })}
                className="-mr-1 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      <InputGroup
        data-disabled={!canSend || isSending ? true : undefined}
        className="pointer-events-auto min-h-14 items-center overflow-hidden rounded-[1.75rem] border-border/80 bg-background/80 shadow-lg shadow-background/20 backdrop-blur-xl transition-[box-shadow,background-color] supports-[backdrop-filter]:bg-background/70 dark:bg-background/75"
      >
        <InputGroupAddon align="inline-start" className="self-center py-0 pr-1 pl-3">
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept={AI_REPORTING_ATTACHMENT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            disabled={!canSend || isSending || isReadingAttachments}
            onChange={(event) => void handleAttachmentChange(event)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <InputGroupButton
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canSend || isSending || isReadingAttachments}
                  aria-label={t('aiReporting.attachFiles', {
                    defaultValue: 'Attach text files',
                  })}
                  className="rounded-full"
                >
                  {isReadingAttachments ? <Loader2 className="animate-spin" /> : <Paperclip />}
                </InputGroupButton>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t('aiReporting.attachFilesHelp', {
                max: AI_REPORTING_MAX_ATTACHMENTS,
                defaultValue: 'Attach up to {{max}} text files',
              })}
            </TooltipContent>
          </Tooltip>
        </InputGroupAddon>

        <InputGroupTextarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('aiReporting.placeholder')}
          aria-label={t('aiReporting.placeholder')}
          aria-invalid={Boolean(composerError)}
          disabled={!canSend || isSending}
          rows={1}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            void handleSubmit();
          }}
          className={cn(
            'field-sizing-content min-h-12 overflow-y-auto px-2 py-3 leading-6',
            draft ? 'max-h-40' : 'max-h-12',
          )}
        />

        <InputGroupAddon align="inline-end" className="self-center gap-1.5 py-0 pr-5 pl-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <InputGroupButton
                  size="icon-sm"
                  onClick={toggleDictation}
                  disabled={!canSend || isSending || isTranscribing || !isDictationSupported}
                  aria-pressed={isListening}
                  aria-label={t(
                    isListening ? 'aiReporting.stopDictation' : 'aiReporting.startDictation',
                    {
                      defaultValue: isListening ? 'Stop voice dictation' : 'Start voice dictation',
                    },
                  )}
                  className={`rounded-full ${isListening ? 'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive' : ''}`}
                >
                  {isTranscribing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Mic className={isListening ? 'animate-pulse' : undefined} />
                  )}
                </InputGroupButton>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isTranscribing
                ? t('aiReporting.transcribingDictation', {
                    defaultValue: 'Transcribing voice dictation...',
                  })
                : isDictationSupported
                  ? t(isListening ? 'aiReporting.stopDictation' : 'aiReporting.startDictation', {
                      defaultValue: isListening ? 'Stop voice dictation' : 'Start voice dictation',
                    })
                  : t('aiReporting.dictationUnsupported', {
                      defaultValue: 'Voice dictation is not supported by this browser.',
                    })}
            </TooltipContent>
          </Tooltip>

          {isSending ? (
            <InputGroupButton
              variant="destructive"
              size="icon-sm"
              onClick={onStop}
              className="rounded-full"
              aria-label={t('aiReporting.stop', { defaultValue: 'Stop' })}
            >
              <Square />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              variant="default"
              size="icon-sm"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="rounded-full"
              aria-label={t('common:buttons.send', { defaultValue: 'Send' })}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>

      {composerError && (
        <p
          role="alert"
          className="pointer-events-auto mx-auto mt-1.5 w-fit max-w-full rounded-full bg-destructive/10 px-2.5 py-1 text-center text-xs text-destructive backdrop-blur-md"
        >
          {composerError}
        </p>
      )}
      <p className="mx-auto mt-1 w-fit max-w-full rounded-full bg-background/60 px-2.5 py-1 text-center text-[10px] text-muted-foreground backdrop-blur-md">
        {footerHintWithPeriod ? [footerHintWithPeriod, aiWarning].join(' ') : aiWarning}
      </p>
    </>
  );
};

export default AiReportingView;
