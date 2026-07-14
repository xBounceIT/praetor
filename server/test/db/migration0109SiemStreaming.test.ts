import { describe, expect, test } from 'bun:test';

const migrationSql = await Bun.file(
  new URL('../../db/migrations/0109_add_siem_streaming.sql', import.meta.url),
).text();

describe('migration 0109 SIEM streaming', () => {
  test('creates a disabled singleton with bounded transport and queue settings', () => {
    expect(migrationSql).toContain('CREATE TABLE "siem_config"');
    expect(migrationSql).toContain('"enabled" boolean DEFAULT false NOT NULL');
    expect(migrationSql).toContain('CONSTRAINT "siem_config_id_check"');
    expect(migrationSql).toContain("IN ('udp', 'tcp', 'tls')");
    expect(migrationSql).toContain('"retention_days" BETWEEN 1 AND 30');
    expect(migrationSql).toContain('"max_events" BETWEEN 10000 AND 1000000');
    expect(migrationSql).toContain('VALUES (1) ON CONFLICT ("id") DO NOTHING');
  });

  test('creates the durable outbox with claim, retry, and scheduling fields', () => {
    expect(migrationSql).toContain('CREATE TABLE "siem_outbox"');
    expect(migrationSql).toContain('"payload" jsonb NOT NULL');
    expect(migrationSql).toContain('"attempts" integer DEFAULT 0 NOT NULL');
    expect(migrationSql).toContain('"available_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL');
    expect(migrationSql).toContain('"claim_token" varchar(100)');
    expect(migrationSql).toContain('"claimed_at" timestamp');
    expect(migrationSql).toContain('CREATE INDEX "idx_siem_outbox_available"');
  });

  test('does not pin destination information on queued events', () => {
    const outboxSql = migrationSql.slice(migrationSql.indexOf('CREATE TABLE "siem_outbox"'));
    expect(outboxSql).not.toContain('"host"');
    expect(outboxSql).not.toContain('"port"');
    expect(outboxSql).not.toContain('"protocol"');
  });
});
