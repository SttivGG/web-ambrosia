import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  REPORTING_SUBJECTS_V1,
  financeReportingEventV1Schema,
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
const Exact = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});

@Injectable()
export class FinanceReportingPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(FinanceReportingPublisherService.name);
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
      const rows = await this.db.sale.findMany({
        where: { status: { in: ['CONFIRMED', 'CANCELLED'] } },
        include: { lines: true, operations: true },
        orderBy: { id: 'asc' },
      });
      for (const sale of rows) {
        const operation = sale.operations.find(
          (entry) => entry.kind === 'CONFIRM',
        );
        const version = sale.updatedAt.getTime();
        for (const line of sale.lines) {
          const revenue = new Exact(line.subtotal.toFixed());
          const cogs =
            line.costSubtotal === null
              ? null
              : new Exact(line.costSubtotal.toFixed());
          const margin = cogs === null ? null : revenue.minus(cogs);
          const marginPercent =
            margin === null || revenue.isZero()
              ? null
              : margin.mul(100).div(revenue).toDecimalPlaces(10);
          const event = financeReportingEventV1Schema.parse({
            kind: 'SALE_MARGIN_SNAPSHOT',
            sourceService: 'finance-reporting-service',
            sourceEntityId: line.id,
            sourceVersion: version,
            operationId: operation?.id ?? null,
            eventId: eventId(`finance:sale-line:${line.id}:${version}`),
            occurredAt: sale.occurredAt.toISOString(),
            saleId: sale.id,
            saleLineId: line.id,
            status: sale.status,
            productId: line.itemId,
            productNameSnapshot: line.name,
            quantity: String(line.quantity),
            revenue: revenue.toFixed(),
            cogs: cogs?.toFixed() ?? null,
            grossMargin: margin?.toFixed() ?? null,
            grossMarginPercent: marginPercent?.toFixed() ?? null,
          });
          await this.events.publishReporting(
            REPORTING_SUBJECTS_V1.finance,
            event,
          );
        }
      }
    } catch {
      this.logger.warn(
        'No se publicaron snapshots de margen; se reintentará sin afectar Finance.',
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
