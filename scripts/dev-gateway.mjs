export function developmentGateway(config, env) {
  for (const [name, key, fallback] of [
    ['inventory-service', 'INVENTORY_SERVICE_PORT', 3001],
    ['production-service', 'PRODUCTION_SERVICE_PORT', 3002],
    ['finance-reporting-service', 'FINANCE_REPORTING_SERVICE_PORT', 3003],
    ['identity-service', 'IDENTITY_SERVICE_PORT', 3004],
    ['admin-web', 'ADMIN_WEB_PORT', 3000],
  ]) {
    const port = Number(env[key] ?? fallback);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Puerto inválido: ' + key);
    config = config.replaceAll(
      name + ':' + fallback,
      'host.docker.internal:' + port,
    );
  }
  return config;
}
