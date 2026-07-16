import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http, { type RequestOptions as HttpRequestOptions, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { addAbortSignal, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const BLOCKED_METADATA_HOSTNAMES = new Set([
  'instance-data',
  'metadata',
  'metadata.azure.internal',
  'metadata.google.internal',
]);
const BLOCKED_METADATA_IPV4 = '100.100.100.200';
const BLOCKED_METADATA_IPV6 = 'fd20:ce::254';

const invalidBaseUrl = (message: string) => ({ ok: false as const, message });

export const normalizeLocalAiBaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, value: '' };
  if (trimmed.length > 2048) {
    return invalidBaseUrl('localBaseUrl must be 2048 characters or fewer');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return invalidBaseUrl('localBaseUrl must be a valid absolute URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalidBaseUrl('localBaseUrl must use http or https');
  }
  if (parsed.username || parsed.password) {
    return invalidBaseUrl('localBaseUrl must not contain credentials');
  }
  if (parsed.search || parsed.hash) {
    return invalidBaseUrl('localBaseUrl must not contain a query string or fragment');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return { ok: true as const, value: parsed.href.replace(/\/$/, '') };
};

const ipv4Octets = (address: string): number[] | null => {
  const mapped = address.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const candidate = mapped || address;
  if (isIP(candidate) === 4) return candidate.split('.').map(Number);

  const mappedHex = address.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!mappedHex) return null;
  const high = Number.parseInt(mappedHex[1], 16);
  const low = Number.parseInt(mappedHex[2], 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
};

export const isBlockedLocalAiAddress = (address: string): boolean => {
  const octets = ipv4Octets(address);
  if (octets) {
    return (octets[0] === 169 && octets[1] === 254) || octets.join('.') === BLOCKED_METADATA_IPV4;
  }

  if (isIP(address) !== 6) return false;
  const firstHextet = Number.parseInt(address.split(':')[0] || '0', 16);
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  return (firstHextet & 0xffc0) === 0xfe80 || normalized === BLOCKED_METADATA_IPV6;
};

const localAiHostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '');

const resolveSafeLocalAiAddresses = async (url: URL): Promise<LookupAddress[]> => {
  const hostname = localAiHostname(url).toLowerCase().replace(/\.$/, '');
  if (BLOCKED_METADATA_HOSTNAMES.has(hostname)) {
    throw new Error('Local AI endpoint targets a blocked metadata host');
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Unable to resolve Local AI endpoint');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedLocalAiAddress(address))) {
    throw new Error('Local AI endpoint resolves to a blocked link-local address');
  }
  return addresses;
};

export const assertSafeLocalAiBaseUrl = async (baseUrl: string): Promise<void> => {
  await resolveSafeLocalAiAddresses(new URL(baseUrl));
};

const responseFromIncoming = (incoming: IncomingMessage, request: Request): Response => {
  const responseHeaders = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
  }

  const status = incoming.statusCode ?? 500;
  const hasBody = request.method !== 'HEAD' && ![204, 205, 304].includes(status);
  const contentEncoding = responseHeaders.get('content-encoding')?.trim().toLowerCase();
  let responseBody: Readable = incoming;
  if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
    responseBody = incoming.pipe(createGunzip());
  } else if (contentEncoding === 'deflate') {
    responseBody = incoming.pipe(createInflate());
  } else if (contentEncoding === 'br') {
    responseBody = incoming.pipe(createBrotliDecompress());
  }
  if (responseBody !== incoming) {
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseBody.once('close', () => incoming.destroy());
  }
  addAbortSignal(request.signal, responseBody);

  return new Response(
    hasBody ? (Readable.toWeb(responseBody) as ReadableStream<Uint8Array>) : null,
    {
      headers: responseHeaders,
      status,
      statusText: incoming.statusMessage,
    },
  );
};

type PinnedRequestOptions = HttpRequestOptions & {
  autoSelectFamily: true;
  servername?: string;
};

/**
 * Fetches a local AI endpoint through only the addresses vetted above. The custom lookup prevents
 * a second DNS resolution from rebinding the request to a blocked metadata address.
 */
export const fetchLocalAi = async (
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const url = input instanceof URL ? input : new URL(input);
  const addresses = await resolveSafeLocalAiAddresses(url);
  const request = new Request(url.href, init);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  const hostname = localAiHostname(url);

  return new Promise<Response>((resolve, reject) => {
    const requestOptions: PinnedRequestOptions = {
      agent: false,
      autoSelectFamily: true,
      headers: Object.fromEntries(headers.entries()),
      hostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      method: request.method,
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      servername: url.protocol === 'https:' && isIP(hostname) === 0 ? hostname : undefined,
      signal: request.signal,
    };
    const client = url.protocol === 'https:' ? https : http;
    const outbound = client.request(requestOptions, (incoming) => {
      try {
        resolve(responseFromIncoming(incoming, request));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    outbound.once('error', (error) => {
      reject(request.signal.aborted ? error : new Error('Local AI endpoint is unavailable'));
    });
    outbound.end(body);
  });
};

export const localAiEndpointUrl = (baseUrl: string, path: 'models' | 'chat/completions') =>
  new URL(path, `${baseUrl}/`).href;

export const localAiHeaders = (apiKey: string): Record<string, string> => ({
  ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  'Content-Type': 'application/json',
});
