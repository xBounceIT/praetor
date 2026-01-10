
export type UserRole = 'admin' | 'manager' | 'user';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  avatarInitials: string;
  username: string;
  password?: string;
}

export interface Client {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  color: string;
  description?: string;
}

export interface ProjectTask {
  id: string;
  name: string;
  projectId: string;
  description?: string;
  isRecurring?: boolean;
  recurrencePattern?: 'daily' | 'weekly' | 'monthly';
  recurrenceStart?: string;
  recurrenceEnd?: string;
}

export interface TimeEntry {
  id: string;
  userId: string;
  date: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  task: string;
  notes?: string;
  duration: number;
  createdAt: number;
  isPlaceholder?: boolean;
}

export type View = 'tracker' | 'reports' | 'projects' | 'tasks' | 'clients' | 'settings' | 'users' | 'recurring';
