import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  REPORTING_SUBJECTS_V1,
  formulaV1Schema,
  productionReportingEventV1Schema,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { EventBusService } from '../event-bus.service';
import { Prisma } from '../generated/prisma/client';

const eventId = (value: string) => {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
};

@Injectable()
export class ReportingPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ReportingPublisherService.name);
  constructor(
    private readonly db: PrismaService,
    private readonly events: EventBusService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.publishOnce(), 15_000);
    setTimeout(() => void this.publishOnce(), 2_000);
  }
  async publishOnce() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.db.productionOrder.findMany({
        include: {
          formulaRevision: true,
          operations: { orderBy: { updatedAt: 'desc' } },
          yields: { orderBy: { updatedAt: 'desc' } },
          packagingOperations: { orderBy: { updatedAt: 'desc' } },
        },
        orderBy: { id: 'asc' },
      });
      for (const row of rows) {
        const formula = formulaV1Schema.parse(row.formulaRevision.snapshot);
        const result = row.yields.find((entry) => entry.status === 'CONFIRMED');
        const packages = row.packagingOperations.filter(
          (entry) => entry.status === 'CONFIRMED',
        );
        const updatedAt = [
          row.updatedAt,
          ...row.yields.map((entry) => entry.updatedAt),
          ...row.packagingOperations.map((entry) => entry.updatedAt),
        ].reduce((latest, value) => (value > latest ? value : latest));
        const version = updatedAt.getTime();
        const packagedQuantity = packages.length
          ? packages
              .reduce(
                (sum, entry) => sum.plus(entry.unitsPackaged),
                new Prisma.Decimal(0),
              )
              .toFixed()
          : null;
        const sellableCost =
          packages.length && packages.every((entry) => entry.totalCost !== null)
            ? packages
                .reduce(
                  (sum, entry) => sum.plus(entry.totalCost!),
                  new Prisma.Decimal(0),
                )
                .toFixed()
            : null;
        const event = productionReportingEventV1Schema.parse({
          kind: 'BATCH_SNAPSHOT',
          sourceService: 'production-service',
          sourceEntityId: row.id,
          sourceVersion: version,
          operationId: row.operations[0]?.id ?? null,
          eventId: eventId(`production:batch:${row.id}:${version}`),
          occurredAt: updatedAt.toISOString(),
          batchId: row.id,
          batch: row.batch,
          productId: formula.productId,
          productNameSnapshot: null,
          status: row.status,
          startedAt: row.startedAt?.toISOString() ?? null,
          completedAt: row.completedAt?.toISOString() ?? null,
          inputQuantity: row.quantity.toFixed(),
          outputQuantity: result?.actualQuantity.toFixed() ?? null,
          yieldPercentage: result?.yieldPercentage.toFixed() ?? null,
          wasteQuantity: result?.wasteQuantity.toFixed() ?? null,
          accumulatedCost: result?.totalCost?.toFixed() ?? null,
          sellableCost,
          packagingOutputQuantity: packagedQuantity,
        });
        await this.events.publishReporting(
          REPORTING_SUBJECTS_V1.production,
          event,
        );
      }
    } catch {
      this.logger.warn(
        'No se publicaron snapshots de Reporting; se reintentará sin afectar Production.',
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
