import { GlobalRegistrator } from '@happy-dom/global-registrator';

// Register with an explicit absolute URL so window.location.href is always a valid
// URL from the start. Components that read it via `new URL(window.location.href)`
// (e.g. components/Login.tsx) throw on an empty/relative href, and the whole frontend
// suite shares one registered window — see the afterEach reset in ./setup.ts.
GlobalRegistrator.register({ url: 'http://localhost/' });

// TEMP DIAG (remove): confirm the registered window/location state at process start.
{
  const w = (globalThis as { window?: { location?: { href?: unknown }; happyDOM?: unknown } })
    .window;
  console.error(
    `[diag-register] href=${JSON.stringify(w?.location?.href)} happyDOM=${typeof w?.happyDOM} hasGlobalWindow=${typeof w}`,
  );
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
