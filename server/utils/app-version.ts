import serverPackage from '../package.json' with { type: 'json' };

export const APP_VERSION = serverPackage.version;
