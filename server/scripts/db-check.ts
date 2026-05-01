import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const stripEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}/gu, '');

// shell: true is required on Windows to resolve drizzle-kit's .cmd shim in
// node_modules/.bin. Args are hardcoded so there's no injection surface.
const child = spawn('drizzle-kit', ['check'], {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true,
});

const stdoutDecoder = new StringDecoder('utf8');
const stderrDecoder = new StringDecoder('utf8');

child.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(stripEmoji(stdoutDecoder.write(chunk)));
});

child.stderr.on('data', (chunk: Buffer) => {
  process.stderr.write(stripEmoji(stderrDecoder.write(chunk)));
});

child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.stdout.write(stripEmoji(stdoutDecoder.end()));
  process.stderr.write(stripEmoji(stderrDecoder.end()));
  process.exit(code ?? (signal ? 128 : 1));
});
