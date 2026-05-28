import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
