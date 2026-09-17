import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service';
import { EventBusService } from '../event-bus/event-bus.service';
import { HealthController } from './health.controller';

describe('health identity-service', () => {
  const make = (database: boolean, nats: boolean) =>
    new HealthController(
      { isReady: async () => database } as PrismaService,
      { isReady: async () => nats } as EventBusService,
    );

  it('liveness no depende de infraestructura', () =>
    expect(make(false, false).live().status).toBe('ok'));

  it('ready con ambas dependencias', async () =>
    expect((await make(true, true).ready()).status).toBe('ok'));

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
