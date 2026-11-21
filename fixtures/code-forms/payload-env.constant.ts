export const WORKER_PAYLOAD_ENV = {
  redisPassword: 'REDIS_PASSWORD',
  forward: {
    REDIS_PASSWORD: 'REDIS_PASSWORD',
    UPSTREAM_HOST: 'UPSTREAM_HOST',
    UPSTREAM_PORT: 'UPSTREAM_PORT',
  },
  prefix: 'WORKER_ENV_',
} as const;
