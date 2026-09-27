import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@ambrosia/nest-auth';
import {
  inventoryReconciliationPageV1Schema,
  reportingSnapshotQueryV1Schema,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { parse } from '../purchases/domain';
import { financeInternalAuth } from '../finance/internal.controller';
import { itemSnapshot, movementSnapshot } from './snapshots';

@ApiExcludeController()
@Controller({ path: 'internal/reporting', version: '1' })
export class ReportingInternalController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  @Public()
  @Get('inventory')
  async inventory(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Query() query: unknown,
  ) {
    financeInternalAuth(token, cookie);
    const q = parse(reportingSnapshotQueryV1Schema, query);
    const skip = (q.page - 1) * q.pageSize;
    const [items, movements, itemCount, movementCount] =
      await this.db.$transaction(
        [
          this.db.catalogItem.findMany({
            where: { trackInventory: true },
            include: { balance: true },
            orderBy: { id: 'asc' },
            skip,
            take: q.pageSize,
          }),
          this.db.inventoryMovement.findMany({
            include: { item: true },
            orderBy: { id: 'asc' },
            skip,
            take: q.pageSize,
          }),
          this.db.catalogItem.count({ where: { trackInventory: true } }),
          this.db.inventoryMovement.count(),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
    const totalItems = Math.max(itemCount, movementCount);
    return inventoryReconciliationPageV1Schema.parse({
      items: items.map(itemSnapshot),
      movements: movements.map(movementSnapshot),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / q.pageSize),
      },
    });
  }
}
