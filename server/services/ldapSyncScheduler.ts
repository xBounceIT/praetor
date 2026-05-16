import type { Logger } from 'pino';
import { serializeError } from '../utils/logger.ts';

interface LdapServiceLike {
  loadConfig: () => Promise<unknown> | unknown;
  readonly config: { enabled?: boolean } | null | undefined;
  syncUsers: () => Promise<unknown>;
}

export interface LdapSyncSchedulerOptions {
  ldapService: LdapServiceLike;
  logger: Logger;
  intervalMs: number;
}

export interface LdapSyncSchedulerHandle {
  stop(): void;
}

export const startLdapSyncScheduler = ({
  ldapService,
  logger,
  intervalMs,
}: LdapSyncSchedulerOptions): LdapSyncSchedulerHandle => {
  let stopped = false;
  let inFlight = false;

  const handle = setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await ldapService.loadConfig();
      if (stopped) return;
      if (ldapService.config?.enabled) {
        logger.info('Running periodic LDAP sync');
        await ldapService.syncUsers();
      }
    } catch (err) {
      if (stopped) return;
      logger.error({ err: serializeError(err) }, 'Periodic LDAP sync error');
    } finally {
      inFlight = false;
    }
  }, intervalMs);

  handle.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
};
