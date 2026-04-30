import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      sessionStart: number;
    };
    user?: {
      id: string;
      name: string;
      username: string;
      role: string;
      avatarInitials: string;
      permissions?: string[];
    };
  }
}
