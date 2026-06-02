import type { User } from '../../types';

export interface LoginResponse {
  token: string;
  user: User;
}

export type LoginResult =
  | LoginResponse
  | { totpRequired: true; challengeToken: string }
  | { totpEnrollmentRequired: true; enrollToken: string };

export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
  qrDataUri: string;
  backupCodes: string[];
}

export interface TotpConfirmResponse {
  enabled: true;
  token?: string;
  user?: User;
}

export interface TotpStatusResponse {
  enabled: boolean;
  applicable: boolean;
}

export interface TotpBackupCodesResponse {
  backupCodes: string[];
}

export interface Settings {
  fullName: string;
  email: string;
  language?: 'en' | 'it' | 'auto';
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
