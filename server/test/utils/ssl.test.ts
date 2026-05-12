import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import realFs from 'fs';
import realSelfsigned from 'selfsigned';

// Suppress the "Generated self-signed SSL certificate" log line so test output stays clean.
const ORIGINAL_CONSOLE_LOG = console.log;
console.log = () => undefined;

// Snapshot real exports before installing mocks (mock.module inside beforeAll is not hoisted).
const fsSnapshot = { ...realFs };
const selfsignedSnapshot = { ...realSelfsigned };

const existsSyncMock = mock<(p: string) => boolean>(() => false);
const readFileSyncMock = mock<(p: string) => Buffer>(() => Buffer.from(''));
const writeFileSyncMock = mock<(p: string, data: string | Buffer) => void>(() => undefined);
const mkdirSyncMock = mock<(p: string, opts?: unknown) => void>(() => undefined);
const generateMock = mock<(attrs: unknown, opts: unknown) => { private: string; cert: string }>(
  () => ({ private: 'GENERATED-KEY', cert: 'GENERATED-CERT' }),
);

beforeAll(() => {
  // ssl.ts only consumes these four named exports from `fs`; preserve the rest verbatim
  // so any other module loaded by the test harness keeps working.
  mock.module('fs', () => ({
    ...fsSnapshot,
    existsSync: existsSyncMock,
    readFileSync: readFileSyncMock,
    writeFileSync: writeFileSyncMock,
    mkdirSync: mkdirSyncMock,
  }));
  mock.module('selfsigned', () => ({
    ...selfsignedSnapshot,
    default: { ...selfsignedSnapshot, generate: generateMock },
    generate: generateMock,
  }));
});

afterAll(() => {
  mock.module('fs', () => ({ ...fsSnapshot, default: fsSnapshot }));
  mock.module('selfsigned', () => ({ ...selfsignedSnapshot, default: selfsignedSnapshot }));
  console.log = ORIGINAL_CONSOLE_LOG;
});

beforeEach(() => {
  existsSyncMock.mockReset().mockImplementation(() => false);
  readFileSyncMock.mockReset().mockImplementation(() => Buffer.from(''));
  writeFileSyncMock.mockReset().mockImplementation(() => undefined);
  mkdirSyncMock.mockReset().mockImplementation(() => undefined);
  generateMock
    .mockReset()
    .mockImplementation(() => ({ private: 'GENERATED-KEY', cert: 'GENERATED-CERT' }));
});

describe('getSSLConfig', () => {
  test('returns existing certs from disk when both files exist', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');

    existsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('server.key')) return true;
      if (p.endsWith('server.cert')) return true;
      return false;
    });
    readFileSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('server.key')) return Buffer.from('EXISTING-KEY');
      if (p.endsWith('server.cert')) return Buffer.from('EXISTING-CERT');
      return Buffer.from('');
    });

    const result = await getSSLConfig('example.com');

    expect(result.key.toString()).toBe('EXISTING-KEY');
    expect(result.cert.toString()).toBe('EXISTING-CERT');
    expect(generateMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(mkdirSyncMock).not.toHaveBeenCalled();
  });

  test('generates and writes new certs when neither file exists', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');

    existsSyncMock.mockImplementation(() => false);

    const result = await getSSLConfig('example.com');

    expect(generateMock).toHaveBeenCalledTimes(1);
    const generateCall = generateMock.mock.calls[0] as unknown as [
      Array<{ name: string; value: string }>,
      { keySize: number; algorithm: string; extensions: Array<Record<string, unknown>> },
    ];
    const [attrs, opts] = generateCall;
    expect(attrs).toEqual([{ name: 'commonName', value: 'example.com' }]);
    expect(opts.keySize).toBe(2048);
    expect(opts.algorithm).toBe('sha256');
    const subjectAltName = opts.extensions.find((e) => e.name === 'subjectAltName');
    expect(subjectAltName).toBeDefined();
    expect(
      (subjectAltName as { altNames: Array<{ type: number; value?: string; ip?: string }> })
        .altNames,
    ).toEqual([
      { type: 2, value: 'example.com' },
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
    ]);

    expect(mkdirSyncMock).toHaveBeenCalledTimes(1);
    const mkdirCall = mkdirSyncMock.mock.calls[0] as unknown as [string, { recursive: boolean }];
    const [mkdirPath, mkdirOpts] = mkdirCall;
    expect(mkdirPath).toMatch(/certs$/);
    expect(mkdirOpts).toEqual({ recursive: true });

    expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
    const writePaths = writeFileSyncMock.mock.calls.map(
      (call) => (call as unknown as [string, unknown])[0],
    );
    expect(writePaths.some((p) => p.endsWith('server.key'))).toBe(true);
    expect(writePaths.some((p) => p.endsWith('server.cert'))).toBe(true);

    expect(result.key.toString()).toBe('GENERATED-KEY');
    expect(result.cert.toString()).toBe('GENERATED-CERT');
  });

  test('does not call mkdirSync if certs directory already exists', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');

    existsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('server.key') || p.endsWith('server.cert')) return false;
      return true; // certs dir exists
    });

    await getSSLConfig('example.com');

    expect(mkdirSyncMock).not.toHaveBeenCalled();
    expect(writeFileSyncMock).toHaveBeenCalledTimes(2);
  });

  test('regenerates when only the key file is missing', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');

    existsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('server.key')) return false;
      if (p.endsWith('server.cert')) return true;
      return false;
    });

    await getSSLConfig('example.com');

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test('regenerates when only the cert file is missing', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');

    existsSyncMock.mockImplementation((p: string) => {
      if (p.endsWith('server.key')) return true;
      if (p.endsWith('server.cert')) return false;
      return false;
    });

    await getSSLConfig('example.com');

    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  test('returns Buffer instances even when generator returns strings', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');
    existsSyncMock.mockImplementation(() => false);

    const result = await getSSLConfig('foo.test');

    expect(Buffer.isBuffer(result.key)).toBe(true);
    expect(Buffer.isBuffer(result.cert)).toBe(true);
  });

  test('uses the provided domain as the commonName', async () => {
    const { getSSLConfig } = await import('../../utils/ssl.ts');
    existsSyncMock.mockImplementation(() => false);

    await getSSLConfig('praetor.local');

    const call = generateMock.mock.calls[0] as unknown as [
      Array<{ name: string; value: string }>,
      {
        extensions: Array<{
          name: string;
          altNames?: Array<{ type: number; value?: string; ip?: string }>;
        }>;
      },
    ];
    const [attrs, opts] = call;
    expect(attrs[0]).toEqual({ name: 'commonName', value: 'praetor.local' });
    const san = opts.extensions.find((e) => e.name === 'subjectAltName');
    expect(san?.altNames?.[0]).toEqual({ type: 2, value: 'praetor.local' });
  });
});
