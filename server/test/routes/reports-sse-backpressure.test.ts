import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { writeSseChunk, writeSseEvent } from '../../routes/reports.ts';

// Minimal fake of `reply.raw` that mimics Node's `http.ServerResponse` surface
// touched by `writeSseChunk` / `writeSseEvent`: `write(chunk)` plus EventEmitter
// methods for `'drain' | 'close' | 'error'`. The `write` impl is controllable so
// tests can simulate a full internal buffer (return false) and trigger drain/close.
class FakeRaw extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];
  // When false, every `.write` returns false (buffer "full") until `drain` is emitted.
  // When true (default), writes succeed synchronously.
  writeReturns = true;
  // When true, `.write` throws — exercises the catch path in writeSseChunk.
  throwOnWrite = false;

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('mock write failure');
    this.writes.push(chunk);
    return this.writeReturns;
  }
}

// Cast through `unknown` because Node's `ServerResponse.once` returns `this`, which TS
// resolves as `ServerResponse` (not `FakeRaw`); the structural shape needed by
// writeSseChunk (write + once/off for drain/close/error) is satisfied either way.
type RawArg = Parameters<typeof writeSseChunk>[0];
const asRaw = (raw: FakeRaw): RawArg => raw as unknown as RawArg;
const fakeReply = (raw: FakeRaw): FastifyReply => ({ raw }) as unknown as FastifyReply;

describe('writeSseChunk backpressure', () => {
  test('resolves immediately to true when write returns true', async () => {
    const raw = new FakeRaw();
    const result = await writeSseChunk(asRaw(raw), 'hello');
    expect(result).toBe(true);
    expect(raw.writes).toEqual(['hello']);
  });

  test('waits for drain when write returns false', async () => {
    const raw = new FakeRaw();
    raw.writeReturns = false;

    let resolved = false;
    const pending = writeSseChunk(asRaw(raw), 'slow-chunk').then((v) => {
      resolved = true;
      return v;
    });

    // Yield once so the chunk write executes and listeners attach.
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    expect(raw.listenerCount('drain')).toBe(1);
    expect(raw.listenerCount('close')).toBe(1);
    expect(raw.listenerCount('error')).toBe(1);

    raw.emit('drain');
    expect(await pending).toBe(true);
    // Listeners removed on resolution.
    expect(raw.listenerCount('drain')).toBe(0);
    expect(raw.listenerCount('close')).toBe(0);
    expect(raw.listenerCount('error')).toBe(0);
  });

  test('resolves to false when close fires before drain (client disconnect mid-buffer)', async () => {
    const raw = new FakeRaw();
    raw.writeReturns = false;

    const pending = writeSseChunk(asRaw(raw), 'doomed-chunk');
    await new Promise((r) => setImmediate(r));

    raw.emit('close');
    expect(await pending).toBe(false);
    expect(raw.listenerCount('drain')).toBe(0);
    expect(raw.listenerCount('close')).toBe(0);
    expect(raw.listenerCount('error')).toBe(0);
  });

  test('resolves to false when error fires before drain', async () => {
    const raw = new FakeRaw();
    raw.writeReturns = false;

    const pending = writeSseChunk(asRaw(raw), 'will-error');
    await new Promise((r) => setImmediate(r));

    raw.emit('error', new Error('socket hangup'));
    expect(await pending).toBe(false);
  });

  test('resolves to false when write throws', async () => {
    const raw = new FakeRaw();
    raw.throwOnWrite = true;
    const result = await writeSseChunk(asRaw(raw), 'thrower');
    expect(result).toBe(false);
  });
});

describe('writeSseEvent backpressure', () => {
  test('returns false immediately when raw.destroyed', async () => {
    const raw = new FakeRaw();
    raw.destroyed = true;
    const result = await writeSseEvent(fakeReply(raw), 'msg', { x: 1 });
    expect(result).toBe(false);
    expect(raw.writes).toHaveLength(0);
  });

  test('returns false immediately when raw.writableEnded', async () => {
    const raw = new FakeRaw();
    raw.writableEnded = true;
    const result = await writeSseEvent(fakeReply(raw), 'msg', { x: 1 });
    expect(result).toBe(false);
    expect(raw.writes).toHaveLength(0);
  });

  test('writes both event and data chunks in SSE wire format', async () => {
    const raw = new FakeRaw();
    const result = await writeSseEvent(fakeReply(raw), 'answer_delta', { delta: 'hi' });
    expect(result).toBe(true);
    expect(raw.writes).toEqual(['event: answer_delta\n', 'data: {"delta":"hi"}\n\n']);
  });

  test('does not resolve until drain when write returns false (regression for #413)', async () => {
    const raw = new FakeRaw();
    raw.writeReturns = false;

    let resolved = false;
    const pending = writeSseEvent(fakeReply(raw), 'answer_delta', { delta: 'hi' }).then((v) => {
      resolved = true;
      return v;
    });

    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    // First chunk written but write returned false, so we're parked on drain.
    expect(raw.writes).toEqual(['event: answer_delta\n']);

    // Simulate buffer flush by allowing further writes to succeed, then emit drain.
    raw.writeReturns = true;
    raw.emit('drain');
    expect(await pending).toBe(true);
    expect(raw.writes).toEqual(['event: answer_delta\n', 'data: {"delta":"hi"}\n\n']);
  });

  test('returns false when client disconnects (close fires) mid-event', async () => {
    const raw = new FakeRaw();
    raw.writeReturns = false;

    const pending = writeSseEvent(fakeReply(raw), 'answer_delta', { delta: 'hi' });
    await new Promise((r) => setImmediate(r));
    raw.emit('close');
    expect(await pending).toBe(false);
  });
});
