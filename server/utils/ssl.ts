import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SSLConfig {
  key: Buffer;
  cert: Buffer;
}

export async function getSSLConfig(domain: string): Promise<SSLConfig> {
  const certsDir = resolve(__dirname, '../../certs');
  const keyPath = resolve(certsDir, 'server.key');
  const certPath = resolve(certsDir, 'server.cert');

  // Check if certificates already exist
  if (existsSync(keyPath) && existsSync(certPath)) {
    return {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    };
  }

  // Generate new self-signed certificates
  const { generate } = await import('selfsigned');

  const attrs = [{ name: 'commonName', value: domain }];
  const pems = generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: domain },
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  // Create certs directory if it doesn't exist
  if (!existsSync(certsDir)) {
    mkdirSync(certsDir, { recursive: true });
  }

  // Write certificates to disk
  writeFileSync(keyPath, pems.private);
  writeFileSync(certPath, pems.cert);

  console.log(`Generated self-signed SSL certificate for domain: ${domain}`);

  return {
    key: Buffer.from(pems.private),
    cert: Buffer.from(pems.cert),
  };
}
