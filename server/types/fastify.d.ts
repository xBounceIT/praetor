import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      name: string;
      username: string;
      role: string;
      avatar_initials?: string | null;
      permissions?: string[];
    };
  }
}
