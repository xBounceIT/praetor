import { describe, expect, test } from 'bun:test';
import path from 'node:path';

type ModuleFormat = 'import' | 'require';

// Use a separate process to avoid the Nodemailer mock in email.test.ts and to
// terminate a vulnerable parser even when it blocks the JavaScript event loop.
const runNodemailer = async (moduleFormat: ModuleFormat, script: string) => {
  const source = `
    const assert = require('node:assert/strict');
    const load = async (specifier) => {
      const loaded = ${moduleFormat === 'import' ? 'await import(specifier)' : 'require(specifier)'};
      return loaded.default ?? loaded;
    };
    ${script}
  `;
  const child = Bun.spawn([process.execPath, '-e', source], {
    cwd: path.resolve(import.meta.dir, '../..'),
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 5_000,
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, stderr || 'Nodemailer regression process timed out').toBe(0);
};

describe.each([
  'import',
  'require',
] as const)('Nodemailer security regressions (%s)', (moduleFormat) => {
  test('parses adversarial free text without blocking (GHSA-v53p-9fqp-m79j)', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const addressparser = await load('nodemailer/lib/addressparser');
      const run = '[x]'.repeat(40_000);
      for (const payload of [' >' + '>[x][x]'.repeat(40_000), run, run + '@', '@' + run]) {
        assert.ok(Array.isArray(addressparser(payload)));
      }
      assert.ok(addressparser(run + ' recipient@example.test').some(
        ({ address }) => address === 'recipient@example.test',
      ));
      assert.deepEqual(addressparser('Praetor <sender@example.test>'), [
        { name: 'Praetor', address: 'sender@example.test' },
      ]);
    `,
    );
  }, 10_000);

  test('flattens deeply nested recipients without stack exhaustion (GHSA-8vvx-rff5-p5rq)', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const nodemailer = await load('nodemailer');
      const depth = 25_000;
      const recipient = JSON.parse(
        '['.repeat(depth) + '"recipient@example.test"' + ']'.repeat(depth),
      );
      const transport = nodemailer.createTransport({ jsonTransport: true });
      for (const field of ['to', 'cc', 'bcc', 'replyTo', 'envelope']) {
        const message = {
          from: 'sender@example.test',
          to: 'primary@example.test',
          subject: 'Nested recipient',
          text: 'Test message',
        };
        message[field] = field === 'envelope'
          ? { from: 'sender@example.test', to: recipient }
          : recipient;
        const info = await transport.sendMail(message);
        const expectedRecipients = field === 'replyTo'
          ? ['primary@example.test']
          : ['recipient@example.test'];
        if (field === 'cc' || field === 'bcc') {
          expectedRecipients.unshift('primary@example.test');
        }
        assert.deepEqual(info.envelope.to, expectedRecipients);
        if (field !== 'envelope') {
          assert.deepEqual(JSON.parse(info.message)[field].map(({ address }) => address), [
            'recipient@example.test',
          ]);
        }
      }
    `,
    );
  }, 10_000);

  test('handles cyclic recipient arrays without recursion or input mutation', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const nodemailer = await load('nodemailer');
      const recipient = [];
      recipient.push(recipient, { name: 'Recipient', address: 'recipient@example.test' });
      const transport = nodemailer.createTransport({ jsonTransport: true });
      const info = await transport.sendMail({
        from: 'sender@example.test',
        to: recipient,
        subject: 'Cyclic recipient',
        text: 'Test message',
      });
      assert.deepEqual(info.envelope.to, ['recipient@example.test']);
      assert.equal(recipient[0], recipient);
      assert.equal(recipient.length, 2);
    `,
    );
  }, 10_000);

  test('keeps TLS identities separate on DNS cache hits (GHSA-6vj9-mwq6-2f5v)', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const { promisify } = require('node:util');
      const shared = await load('nodemailer/lib/shared');
      const host = 'smtp.gateway.example.test';
      shared.dnsCache.set(host, {
        value: { addresses: ['192.0.2.1'], servername: 'tenant-a.example.test' },
        expires: Date.now() + 60_000,
      });
      const resolve = promisify(shared.resolveHostname);
      const tenantB = await resolve({ host, servername: 'tenant-b.example.test' });
      assert.equal(tenantB.cached, true);
      assert.equal(tenantB.host, '192.0.2.1');
      assert.equal(tenantB.servername, 'tenant-b.example.test');
      const defaultIdentity = await resolve({ host });
      assert.equal(defaultIdentity.servername, host);
    `,
    );
  }, 10_000);

  test('preserves the TLS identity when DNS falls back to an expired cache entry', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const { promisify } = require('node:util');
      const dns = require('node:dns');
      // Simulate a stalled DNS lookup without accessing the network.
      dns.Resolver = class {
        resolve4() {}
        resolve6() {}
        cancel() {}
      };
      dns.lookup = () => {};
      const shared = await load('nodemailer/lib/shared');
      const host = 'smtp.gateway.example.test';
      shared.dnsCache.set(host, {
        value: { addresses: ['192.0.2.1'], servername: 'tenant-a.example.test' },
        expires: Date.now() - 60_000,
      });
      const tenantB = await promisify(shared.resolveHostname)({
        host,
        servername: 'tenant-b.example.test',
        timeout: 25,
      });
      assert.equal(tenantB.cached, true);
      assert.equal(tenantB.host, '192.0.2.1');
      assert.equal(tenantB.servername, 'tenant-b.example.test');
      assert.equal(tenantB.error.code, dns.TIMEOUT);
    `,
    );
  }, 10_000);

  test('preserves ordinary Praetor email composition with the real transport', async () => {
    await runNodemailer(
      moduleFormat,
      `
      const nodemailer = await load('nodemailer');
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const info = await transport.sendMail({
        from: '"Praetor" <sender@example.test>',
        to: 'recipient@example.test',
        subject: 'Praetor Email Configuration Test',
        text: 'Plain text body',
        html: '<p>HTML body</p>',
      });
      assert.equal(info.envelope.from, 'sender@example.test');
      assert.deepEqual(info.envelope.to, ['recipient@example.test']);
      assert.ok(info.messageId);
      assert.ok(Buffer.isBuffer(info.message));
      const message = info.message.toString();
      assert.ok(message.includes('From: Praetor <sender@example.test>'));
      assert.ok(message.includes('To: recipient@example.test'));
      assert.ok(message.includes('Subject: Praetor Email Configuration Test'));
      assert.ok(message.includes('Content-Type: multipart/alternative;'));
      assert.ok(message.includes('Plain text body'));
      assert.ok(message.includes('<p>HTML body</p>'));
    `,
    );
  }, 10_000);
});
