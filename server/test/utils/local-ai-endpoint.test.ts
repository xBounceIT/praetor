import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertSafeLocalAiBaseUrl,
  fetchLocalAi,
  isBlockedLocalAiAddress,
  localAiEndpointUrl,
  localAiHeaders,
  normalizeLocalAiBaseUrl,
} from '../../utils/local-ai-endpoint.ts';

describe('local AI endpoint utilities', () => {
  test('normalizes an HTTP(S) base URL while preserving its API path', () => {
    expect(normalizeLocalAiBaseUrl(' http://inference:11434/v1/ ')).toEqual({
      ok: true,
      value: 'http://inference:11434/v1',
    });
    expect(localAiEndpointUrl('http://inference:11434/v1', 'chat/completions')).toBe(
      'http://inference:11434/v1/chat/completions',
    );
  });

  test('rejects unsupported protocols, credentials, query strings, and fragments', () => {
    for (const value of [
      'file:///tmp/model',
      'http://user:pass@inference/v1',
      'http://inference/v1?tenant=x',
      'http://inference/v1#models',
    ]) {
      expect(normalizeLocalAiBaseUrl(value).ok).toBe(false);
    }
  });

  test('blocks metadata and link-local addresses but permits loopback and private LAN addresses', () => {
    expect(isBlockedLocalAiAddress('169.254.169.254')).toBe(true);
    expect(isBlockedLocalAiAddress('100.100.100.200')).toBe(true);
    expect(isBlockedLocalAiAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isBlockedLocalAiAddress('fe80::1')).toBe(true);
    expect(isBlockedLocalAiAddress('fd00:ec2::254')).toBe(true);
    expect(isBlockedLocalAiAddress('fd00:0ec2:0000:0000:0000:0000:0000:0254')).toBe(true);
    expect(isBlockedLocalAiAddress('fd20:00ce:0000:0000:0000:0000:0000:0254')).toBe(true);
    expect(isBlockedLocalAiAddress('127.0.0.1')).toBe(false);
    expect(isBlockedLocalAiAddress('10.0.0.8')).toBe(false);
    expect(isBlockedLocalAiAddress('192.168.1.20')).toBe(false);
  });

  test('blocks metadata hostnames even when written as an absolute DNS name', async () => {
    await expect(assertSafeLocalAiBaseUrl('http://metadata.google.internal./v1')).rejects.toThrow(
      /blocked metadata host/,
    );
  });

  test('adds Authorization only for a non-empty token', () => {
    expect(localAiHeaders('')).toEqual({ 'Content-Type': 'application/json' });
    expect(localAiHeaders(' token ')).toEqual({
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    });
  });

  test('uses the vetted connection and never follows redirects', async () => {
    let redirectedRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/target' });
        response.end();
        return;
      }
      if (request.url === '/target') redirectedRequests += 1;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'llama3.2' }] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const { port } = server.address() as AddressInfo;
      const modelsResponse = await fetchLocalAi(`http://127.0.0.1:${port}/models`);
      expect(await modelsResponse.json()).toEqual({ data: [{ id: 'llama3.2' }] });

      const redirectResponse = await fetchLocalAi(`http://127.0.0.1:${port}/redirect`, {
        redirect: 'error',
      });
      expect(redirectResponse.status).toBe(302);
      expect(redirectedRequests).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
