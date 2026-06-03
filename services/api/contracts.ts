import type { User } from '../../types';

export interface LoginResponse {
  token: string;
  user: User;
}

// Lowercase English weekday names — the only days a RIL row can be filled in.
export type RilWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

// Per-weekday default RIL "Trasferta" (location) value. Sparse: only carries configured days.
export type RilWeekdayTransferDefaults = Partial<Record<RilWeekday, string>>;

export interface Settings {
  fullName: string;
  email: string;
  language?: 'en' | 'it' | 'auto';
  rilWeekdayTransferDefaults?: RilWeekdayTransferDefaults;
}

// The five user-editable fields of one RIL row, persisted as a draft.
export interface RilDraftRow {
  entrance: string;
  exit: string;
  notes: string;
  transfer: string;
  code: string;
}

export interface RilDraft {
  monthKey: string;
  // Keyed by day-of-month (stringified 1..31); sparse.
  rows: Record<string, RilDraftRow>;
  updatedAt: string | null;
}

export interface PersonalAccessToken {
  tokenPrefix: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  token?: string;
}

export type ReportChatStreamStartEvent = {
  sessionId: string;
  messageId: string;
};

export type ReportChatStreamDoneEvent = {
  sessionId: string;
  text: string;
  thoughtContent?: string;
};

export type ReportChatStreamHandlers = {
  onStart?: (payload: ReportChatStreamStartEvent) => void;
  onThoughtDelta?: (delta: string) => void;
  onAnswerDelta?: (delta: string) => void;
  onThoughtDone?: () => void;
};
