import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      sessionStart?: number;
      sessionVersion?: number;
      source?: 'session' | 'personalAccessToken';
    };
    user?: {
      id: string;
      name: string;
      username: string;
      role: string;
      avatarInitials: string;
      authMethod?: 'local' | 'ldap' | 'oidc' | 'saml';
      permissions: string[];
    };
    // Set by the `requireEnrollOrSession` guard when the request carries a valid
    // `totp_enroll` purpose token instead of a full session. `user`/`auth` stay
    // unpopulated in that case — the only thing the request is authorized to do is
    // complete its own 2FA enrollment.
    enrollUserId?: string;
    // The `sessionVersion` claim carried by the enroll token (set alongside enrollUserId). Handlers
    // that mint a session compare it to the user's current sessionVersion to reject a token left
    // outstanding across a credential/session rotation.
    enrollSessionVersion?: number;
  }
}
