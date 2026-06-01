import type { Client, Project, ProjectTask, User } from './types';

export const DEFAULT_USERS: User[] = [
  {
    id: 'u1',
    name: 'Admin User',
    role: 'admin',
    avatarInitials: 'AD',
    username: 'admin',
    password: 'password',
  },
  {
    id: 'u2',
    name: 'Manager User',
    role: 'manager',
    avatarInitials: 'MG',
    username: 'manager',
    password: 'password',
  },
  {
    id: 'u3',
    name: 'Standard User',
    role: 'user',
    avatarInitials: 'US',
    username: 'user',
    password: 'password',
  },
];

export const DEFAULT_CLIENTS: Client[] = [
  { id: 'c1', name: 'Acme Corp' },
  { id: 'c2', name: 'Global Tech' },
];

export const DEFAULT_PROJECTS: Project[] = [
  {
    id: 'p1',
    name: 'Website Redesign',
    clientId: 'c1',
    description: 'Complete overhaul of the main marketing site.',
  },
  {
    id: 'p2',
    name: 'Mobile App',
    clientId: 'c1',
    description: 'Native iOS and Android application development.',
  },
  {
    id: 'p3',
    name: 'Internal Research',
    clientId: 'c2',
    description: 'Ongoing research into new market trends.',
  },
];

export const DEFAULT_TASKS: ProjectTask[] = [
  {
    id: 't1',
    name: 'Initial Design',
    projectId: 'p1',
    description: 'Lo-fi wireframes and moodboards.',
  },
  {
    id: 't2',
    name: 'Frontend Dev',
    projectId: 'p1',
    description: 'React component implementation.',
  },
  {
    id: 't3',
    name: 'API Integration',
    projectId: 'p2',
    description: 'Connecting the app to the backend services.',
  },
  {
    id: 't4',
    name: 'General Support',
    projectId: 'p3',
    description: 'Misc administrative tasks and support.',
  },
];
