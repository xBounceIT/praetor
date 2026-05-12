import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      sessionStart?: number;
      source?: 'session' | 'personalAccessToken';
    };
    user?: {
      id: string;
      name: string;
      username: string;
      role: string;
      avatarInitials: string;
      permissions: string[];
    };
  }
}
