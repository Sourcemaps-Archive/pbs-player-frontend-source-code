function getSentryConfig() {
  const contextBridge = window['contextBridge'] || window['livePlayerContextBridge'];
  return {
    dsn: contextBridge?.sentry_dsn || '',
    environment: contextBridge?.sentry_environment || 'production',
  };
}

const DEV = location.hostname.includes('localhost');
const SENTRY_CONFIG = getSentryConfig();
const MUX_ENV_KEY = 'sh1cu4rhemjbphkph1bvpjsji';
const MUX_CUSTOM_DOMAIN = 'qoe.pbs.org';

const env = {
  DEV,
  SENTRY_DSN: SENTRY_CONFIG.dsn,
  SENTRY_ENVIRONMENT: SENTRY_CONFIG.environment,
  MUX_ENV_KEY,
  MUX_CUSTOM_DOMAIN,
};

export default env;
