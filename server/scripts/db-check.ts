import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

const stripEmoji = (s: string) => s.replace(/\p{Extended_Pictographic}/gu, '');

// shell: true is required on Windows to resolve drizzle-kit's .cmd shim in
// node_modules/.bin. Args are hardcoded so there's no injection surface.
// Tradeoff: ENOENT surfaces via shell exit 127 + stderr rather than Node's
// 'error' event, but the user still sees a clear failure either way.
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

// With shell: true this only fires if the shell itself fails to start
// (missing /bin/sh, inaccessible cmd.exe). drizzle-kit-not-found surfaces
// as a shell exit 127 + stderr instead, handled by the close handler below.
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});

// process.once so a second Ctrl+C falls through to Node's default
// (terminate the parent) if the child ignores or hangs on the first signal.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => child.kill(signal));
}

// 'close' (not 'exit') waits until stdout/stderr are fully drained so the
// final flush of the StringDecoder doesn't truncate trailing output.
child.on('close', (code, signal) => {
  process.stdout.write(stripEmoji(stdoutDecoder.end()));
  process.stderr.write(stripEmoji(stderrDecoder.end()));
  if (signal) {
    process.exit(128 + (constants.signals[signal] ?? 0));
  }
  process.exit(code ?? 0);
});
