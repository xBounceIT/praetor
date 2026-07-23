import { describe, expect, test } from 'bun:test';

const dockerfile = await Bun.file(new URL('../../Dockerfile', import.meta.url)).text();
const caddyfile = await Bun.file(new URL('../../Caddyfile', import.meta.url)).text();
const compose = await Bun.file(new URL('../../docker-compose.yml', import.meta.url)).text();
const customerCompose = await Bun.file(
  new URL('../../deploy/docker-compose.customer.yml', import.meta.url),
).text();
const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));

describe('frontend container hardening', () => {
  test('runs Caddy as the dedicated Praetor user without inherited bind capability', () => {
    expect(runtimeStage).toContain('addgroup -S -g 10001 praetor');
    expect(runtimeStage).toContain('adduser -S -D -H -u 10001 -G praetor praetor');
    expect(runtimeStage).toContain('setcap -r /usr/bin/caddy');
    const userDirectives = runtimeStage.match(/^USER\s+.+$/gm);
    expect(userDirectives?.at(-1)?.trim()).toBe('USER praetor:praetor');
  });

  test('limits runtime write access to Caddy state directories', () => {
    expect(runtimeStage).toContain('chown -R praetor:praetor /data /config');
    expect(runtimeStage).toContain('chmod -R u=rwX,go= /data /config');
  });

  test('serves through an unprivileged container port', () => {
    expect(caddyfile).toMatch(/(?:^|\n):8080 \{/);
    expect(runtimeStage).toContain('EXPOSE 8080');
    expect(compose).toContain(`- '3000:8080'`);
    expect(customerCompose).toContain(`- '\${FRONTEND_PORT:-3000}:8080'`);
  });
});
