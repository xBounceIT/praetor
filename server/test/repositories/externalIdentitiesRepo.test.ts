import { beforeEach, describe, expect, test } from 'bun:test';
import type { DbExecutor } from '../../db/drizzle.ts';
import * as externalIdentitiesRepo from '../../repositories/externalIdentitiesRepo.ts';
import { type FakeExecutor, setupTestDb } from '../helpers/fakeExecutor.ts';

let exec: FakeExecutor;
let testDb: DbExecutor;

beforeEach(() => {
  ({ exec, testDb } = setupTestDb());
});

describe('insert', () => {
  test('ignores only conflicts on the external identity business key', async () => {
    exec.enqueue({ rows: [] });

    await externalIdentitiesRepo.insert(
      {
        id: 'eid-1',
        providerId: 'sso-1',
        protocol: 'oidc',
        issuer: 'https://issuer.example',
        subject: 'subject-1',
        userId: 'user-1',
      },
      testDb,
    );

    expect(exec.calls[0].sql.toLowerCase()).toContain(
      'on conflict ("provider_id","protocol","issuer","subject") do nothing',
    );
  });
});
