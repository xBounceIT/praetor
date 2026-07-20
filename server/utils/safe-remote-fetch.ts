import type { LookupAddress } from 'node:dns';
import dns from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import https, { type RequestOptions as HttpsRequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { addAbortSignal, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

type AutoSelectingHttpsRequestOptions = HttpsRequestOptions & { autoSelectFamily: true };

const remoteUrlHostname = (url: URL): string => url.hostname.replace(/^\[|\]$/g, '');

const parseIpv4 = (ip: string): [number, number, number, number] | null => {
  if (isIP(ip) !== 4) return null;
  return ip.split('.').map(Number) as [number, number, number, number];
};

const parseIpv6 = (ip: string): bigint | null => {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < (halves.length === 2 ? 1 : 0)) return null;
  const parts = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
};

const ipv4FromMappedIpv6 = (value: bigint): string | null => {
  if (value >> 32n !== 0xffffn) return null;
  const embedded = Number(value & 0xffff_ffffn);
  return [embedded >>> 24, (embedded >>> 16) & 0xff, (embedded >>> 8) & 0xff, embedded & 0xff].join(
    '.',
  );
};

const inIpv6Cidr = (value: bigint, base: bigint, prefix: number): boolean => {
  const shift = BigInt(128 - prefix);
  return value >> shift === base >> shift;
};

const IPV6_GLOBAL_UNICAST = [0x20000000000000000000000000000000n, 3] as const;
const BLOCKED_IPV6_GLOBAL_RANGES: ReadonlyArray<readonly [bigint, number]> = [
  [0x20010000000000000000000000000000n, 32], // Teredo
  [0x20010002000000000000000000000000n, 48], // Benchmarking
  [0x20010010000000000000000000000000n, 28], // Deprecated ORCHID
  [0x20010db8000000000000000000000000n, 32], // Documentation
  [0x20020000000000000000000000000000n, 16], // 6to4
  [0x3fff0000000000000000000000000000n, 20], // Documentation
];

/**
 * Returns true for an IP that is not safe as a public server-side request destination. Besides
 * loopback, private, link-local, and shared ranges, this blocks IANA-reserved documentation,
 * benchmarking, multicast, transition, and future-use space. Invalid input fails closed.
 */
export const isPrivateIp = (ip: string): boolean => {
  const normalized = ip.toLowerCase().split('%')[0];
  const v4 = parseIpv4(normalized);
  if (v4) {
    const [a, b, c] = v4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (isIP(normalized) !== 6) return true;
  const v6 = parseIpv6(normalized);
  if (v6 === null) return true;
  const mapped = ipv4FromMappedIpv6(v6);
  if (mapped) return isPrivateIp(mapped);
  if (!inIpv6Cidr(v6, ...IPV6_GLOBAL_UNICAST)) return true;
  return BLOCKED_IPV6_GLOBAL_RANGES.some(([base, prefix]) => inIpv6Cidr(v6, base, prefix));
};

/**
 * Resolve the destination exactly once and return only addresses that the subsequent connection
 * may use. Rejecting the whole result when any answer is unsafe prevents mixed-answer rebinding.
 */
export const resolveSafeRemoteAddresses = async (url: URL): Promise<LookupAddress[]> => {
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch non-HTTPS URL: ${url.protocol}//...`);
  }
  if (url.username || url.password) {
    throw new Error('Refusing to fetch URL with embedded credentials');
  }
  const hostname = remoteUrlHostname(url);
  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host ${url.hostname}`);
  }
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`Refusing to fetch URL with private/loopback/reserved host: ${url.hostname}`);
  }
  return addresses;
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

/**
 * Perform one HTTPS request through the already-vetted addresses while retaining the original
 * hostname for the Host header, SNI, and certificate verification. No redirect is followed here.
 */
export const fetchPinnedRemoteUrl = async (
  url: URL,
  addresses: LookupAddress[],
  options: RequestInit = {},
): Promise<Response> => {
  if (addresses.length === 0) throw new Error('Cannot fetch a remote URL without a vetted address');
  const request = new Request(url.href, options);
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers = new Headers(request.headers);
  headers.set('host', url.host);
  headers.set('accept-encoding', 'gzip, deflate, br');
  const originalHostname = remoteUrlHostname(url);

  return new Promise<Response>((resolve, reject) => {
    const requestOptions: AutoSelectingHttpsRequestOptions = {
      agent: false,
      autoSelectFamily: true,
      headers: Object.fromEntries(headers.entries()),
      hostname: originalHostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions.all) {
          callback(null, addresses);
          return;
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      method: request.method,
      path: `${url.pathname}${url.search}`,
      port: url.port ? Number(url.port) : 443,
      servername: isIP(originalHostname) === 0 ? originalHostname : undefined,
      signal: request.signal,
    };
    const outbound = https.request(requestOptions, (incoming) => {
      try {
        resolve(responseFromIncoming(incoming, request));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    outbound.once('error', reject);
    outbound.end(body);
  });
};
