import { afterEach, describe, expect, test } from 'bun:test';
import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import { DEFAULT_SIEM_CONFIG, type SiemConfig } from '../../repositories/siemRepo.ts';
import { SiemTransport } from '../../services/siem.ts';
import { encrypt } from '../../utils/crypto.ts';
import {
  SIEM_TEST_CA,
  SIEM_TEST_CLIENT_CERT,
  SIEM_TEST_CLIENT_KEY,
  SIEM_TEST_SERVER_CERT,
  SIEM_TEST_SERVER_KEY,
} from '../fixtures/siemTlsCertificates.ts';

const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

const config = (overrides: Partial<SiemConfig>): SiemConfig => ({
  ...DEFAULT_SIEM_CONFIG,
  host: '127.0.0.1',
  ...overrides,
});

const createTcpCollector = (expected: string) => {
  let payload = '';
  let connections = 0;
  let resolveReceived!: (value: string) => void;
  const received = new Promise<string>((resolve) => {
    resolveReceived = resolve;
  });
  const collector = net.createServer((socket) => {
    connections += 1;
    socket.on('data', (chunk) => {
      payload += chunk.toString('utf8');
      if (payload === expected) resolveReceived(payload);
    });
  });
  return { collector, received, getConnectionCount: () => connections };
};

describe('SIEM native transports', () => {
  test('sends an accepted UDP datagram', async () => {
    const collector = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => collector.bind(0, '127.0.0.1', resolve));
    closers.push(() => {
      collector.close();
    });
    const address = collector.address();
    if (typeof address === 'string') throw new Error('Expected UDP address info');

    const received = new Promise<string>((resolve) => {
      collector.once('message', (message) => resolve(message.toString('utf8')));
    });
    const transport = new SiemTransport();
    closers.push(() => transport.close());

    await transport.send('LEEF UDP', config({ protocol: 'udp', port: address.port }));
    expect(await received).toBe('LEEF UDP');
  });

  test('keeps a TCP socket and applies newline framing', async () => {
    const { collector, received, getConnectionCount } = createTcpCollector('first\nsecond\n');
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => collector.close(() => resolve())));
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address info');
    const transport = new SiemTransport();
    closers.push(() => transport.close());
    const tcpConfig = config({ protocol: 'tcp', port: address.port, tcpFraming: 'newline' });

    await Promise.all([transport.send('first', tcpConfig), transport.send('second', tcpConfig)]);
    expect(await received).toBe('first\nsecond\n');
    expect(getConnectionCount()).toBe(1);
  });

  test('uses RFC 6587 octet-counting framing for stream transports', async () => {
    const { collector, received } = createTcpCollector('5 hello');
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => collector.close(() => resolve())));
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address info');
    const transport = new SiemTransport();
    closers.push(() => transport.close());

    await transport.send(
      'hello',
      config({ protocol: 'tcp', port: address.port, tcpFraming: 'octet-counting' }),
    );
    expect(await received).toBe('5 hello');
  });

  test('verifies a TLS collector against a private CA', async () => {
    const server = tls.createServer({
      key: SIEM_TEST_SERVER_KEY,
      cert: SIEM_TEST_SERVER_CERT,
      minVersion: 'TLSv1.2',
    });
    const tlsMessage = new Promise<string>((resolve) => {
      server.on('secureConnection', (socket) =>
        socket.once('data', (chunk) => resolve(chunk.toString('utf8'))),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TLS address info');
    const transport = new SiemTransport();
    closers.push(() => transport.close());

    await transport.send(
      'secure',
      config({
        protocol: 'tls',
        port: address.port,
        serverName: 'localhost',
        caPem: SIEM_TEST_CA,
      }),
    );

    expect(await tlsMessage).toBe('secure\n');
  });

  test('rejects a TLS collector signed by an untrusted CA', async () => {
    const collector = tls.createServer({ key: SIEM_TEST_SERVER_KEY, cert: SIEM_TEST_SERVER_CERT });
    collector.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => collector.close(() => resolve())));
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Expected TLS address info');
    const transport = new SiemTransport();
    closers.push(() => transport.close());

    await expect(
      transport.send(
        'untrusted',
        config({ protocol: 'tls', port: address.port, serverName: 'localhost', caPem: '' }),
      ),
    ).rejects.toThrow();
  });

  test('presents the configured mTLS client certificate', async () => {
    const collector = tls.createServer({
      key: SIEM_TEST_SERVER_KEY,
      cert: SIEM_TEST_SERVER_CERT,
      ca: SIEM_TEST_CA,
      requestCert: true,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
    collector.on('tlsClientError', () => undefined);
    const received = new Promise<{ message: string; commonName: string | undefined }>((resolve) => {
      collector.on('secureConnection', (socket) => {
        socket.once('data', (chunk) => {
          const commonName = socket.getPeerCertificate().subject?.CN;
          resolve({
            message: chunk.toString('utf8'),
            commonName: Array.isArray(commonName) ? commonName[0] : commonName,
          });
        });
      });
    });
    await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise<void>((resolve) => collector.close(() => resolve())));
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Expected TLS address info');
    const transport = new SiemTransport();
    closers.push(() => transport.close());
    const previousKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'siem-transport-test-encryption-key';

    try {
      await transport.send(
        'mutual',
        config({
          protocol: 'tls',
          port: address.port,
          serverName: 'localhost',
          caPem: SIEM_TEST_CA,
          clientCertPem: SIEM_TEST_CLIENT_CERT,
          clientKey: encrypt(SIEM_TEST_CLIENT_KEY),
        }),
      );
      expect(await received).toEqual({
        message: 'mutual\n',
        commonName: 'praetor-test-client',
      });
    } finally {
      if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = previousKey;
    }
  });
});
