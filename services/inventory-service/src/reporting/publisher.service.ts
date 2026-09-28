import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { REPORTING_SUBJECTS_V1 } from '@ambrosia/contracts';
import { EventBusService } from '../event-bus.service';
import { PrismaService } from '../prisma.service';
import { itemSnapshot, movementSnapshot, purchaseSnapshot } from './snapshots';

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
      const [items, movements, purchases] = await Promise.all([
        this.db.catalogItem.findMany({
          where: { trackInventory: true },
          include: { balance: true },
          orderBy: { id: 'asc' },
        }),
        this.db.inventoryMovement.findMany({
          include: { item: true },
          orderBy: { id: 'asc' },
        }),
        this.db.purchaseLine.findMany({
          include: {
            item: { include: { category: true } },
            purchase: { include: { supplier: true } },
            movements: true,
          },
          orderBy: { id: 'asc' },
        }),
      ]);
      for (const row of items)
        await this.events.publishReporting(
          REPORTING_SUBJECTS_V1.inventory,
          itemSnapshot(row),
        );
      for (const row of movements)
        await this.events.publishReporting(
          REPORTING_SUBJECTS_V1.inventory,
          movementSnapshot(row),
        );
      for (const row of purchases)
        await this.events.publishReporting(
          REPORTING_SUBJECTS_V1.inventory,
          purchaseSnapshot(row),
        );
    } catch {
      this.logger.warn(
        'No se publicaron snapshots de Reporting; se reintentará sin afectar Inventory.',
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
