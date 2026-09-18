import { JwtVerifier } from '@ambrosia/nest-auth';
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { EventBusService } from './event-bus.service';
describe('health inventory-service', () => {
  const make = (database: boolean, nats: boolean, jwks = true) =>
    new HealthController(
      { isReady: async () => database } as PrismaService,
      { isReady: async () => nats } as EventBusService,
      { isReady: async () => jwks } as JwtVerifier,
    );
  it('liveness no depende de infraestructura', () =>
    expect(make(false, false).live().status).toBe('ok'));
  it('ready con ambas dependencias', async () =>
    expect((await make(true, true).ready()).status).toBe('ok'));
  it('readiness falla sin JWKS y liveness sigue vivo', async () => {
    expect(make(true, true, false).live().status).toBe('ok');
    await expect(make(true, true, false).ready()).rejects.toMatchObject({
      status: 503,
      response: { dependencies: { jwks: false } },
    });
  });
  it.each([
    [false, true],
    [true, false],
    [false, false],
  ])('503 database=%s nats=%s', async (database, nats) => {
    await expect(make(database, nats).ready()).rejects.toMatchObject({
      status: 503,
      response: { status: 'unavailable', dependencies: { database, nats } },
    });
  });
});
