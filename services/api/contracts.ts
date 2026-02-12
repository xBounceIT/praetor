import type { User } from '../../types';

export interface LoginResponse {
  token: string;
  user: User;
}

export interface Settings {
  fullName: string;
  email: string;
  language?: 'en' | 'it' | 'auto';
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
