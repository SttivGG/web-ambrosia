import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Inject,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '@ambrosia/nest-auth';
import {
  formulaV1Schema,
  productionReconciliationPageV1Schema,
  productionReportingEventV1Schema,
  reportingSnapshotQueryV1Schema,
} from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { parse } from '../production/domain';
import { deterministicEventId } from './snapshots';

function authorize(value: string, cookie: string) {
  const key = process.env.REPORTING_PRODUCTION_TOKEN;
  const match = /^Bearer ([A-Za-z0-9_-]{64,256})$/.exec(value ?? '');
  if (
    !key ||
    cookie ||
    !match ||
    match[1]!.length !== key.length ||
    !timingSafeEqual(Buffer.from(match[1]!), Buffer.from(key))
  )
    throw new UnauthorizedException();
}

@ApiExcludeController()
@Controller({ path: 'internal/reporting', version: '1' })
export class ReportingInternalController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  @Public()
  @Get('production')
  async production(
    @Headers('authorization') token: string,
    @Headers('cookie') cookie: string,
    @Query() query: unknown,
  ) {
    authorize(token, cookie);
    const q = parse(reportingSnapshotQueryV1Schema, query);
    const skip = (q.page - 1) * q.pageSize;
    const [orders, packaging, orderCount, packagingCount] =
      await this.db.$transaction(
        [
          this.db.productionOrder.findMany({
            include: {
              formulaRevision: true,
              operations: { orderBy: { updatedAt: 'desc' } },
              yields: { orderBy: { updatedAt: 'desc' } },
              packagingOperations: { orderBy: { updatedAt: 'desc' } },
            },
            orderBy: { id: 'asc' },
            skip,
            take: q.pageSize,
          }),
          this.db.packagingOperation.findMany({
            include: { order: true },
            orderBy: { id: 'asc' },
            skip,
            take: q.pageSize,
          }),
          this.db.productionOrder.count(),
          this.db.packagingOperation.count(),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
    const batches = orders.map((row) => {
      const formula = formulaV1Schema.parse(row.formulaRevision.snapshot);
      const result = row.yields.find((entry) => entry.status === 'CONFIRMED');
      const packages = row.packagingOperations.filter(
        (entry) => entry.status === 'CONFIRMED',
      );
      const updatedAt = [
        row.updatedAt,
        ...row.yields.map((entry) => entry.updatedAt),
        ...row.packagingOperations.map((entry) => entry.updatedAt),
      ].reduce((a, b) => (b > a ? b : a));
      return productionReportingEventV1Schema.parse({
        kind: 'BATCH_SNAPSHOT',
        sourceService: 'production-service',
        sourceEntityId: row.id,
        sourceVersion: updatedAt.getTime(),
        operationId: row.operations[0]?.id ?? null,
        eventId: deterministicEventId(
          `production:batch:${row.id}:${updatedAt.getTime()}`,
        ),
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
        sellableCost:
          packages.length && packages.every((entry) => entry.totalCost !== null)
            ? packages
                .reduce(
                  (sum, entry) => sum.plus(entry.totalCost!),
                  new Prisma.Decimal(0),
                )
                .toFixed()
            : null,
        packagingOutputQuantity: packages.length
          ? packages
              .reduce(
                (sum, entry) => sum.plus(entry.unitsPackaged),
                new Prisma.Decimal(0),
              )
              .toFixed()
          : null,
      });
    });
    const packageEvents = packaging.map((entry) =>
      productionReportingEventV1Schema.parse({
        kind: 'PACKAGING_SNAPSHOT',
        sourceService: 'production-service',
        sourceEntityId: entry.id,
        sourceVersion: entry.updatedAt.getTime(),
        operationId: entry.operationId,
        eventId: deterministicEventId(
          `production:packaging:${entry.id}:${entry.updatedAt.getTime()}`,
        ),
        occurredAt: entry.updatedAt.toISOString(),
        packagingOperationId: entry.id,
        batchId: entry.orderId,
        batch: entry.order.batch,
        finishedProductId: entry.presentationProductId,
        units: entry.unitsPackaged.toFixed(),
        netContentPerUnit: entry.productQuantityPerUnit.toFixed(),
        netContentTotal: entry.productQuantityUsed.toFixed(),
        unit: entry.baseUnit,
        bulkCost: entry.bulkProductCost?.toFixed() ?? null,
        materialsCost: entry.packagingMaterialsCost?.toFixed() ?? null,
        totalCost: entry.totalCost?.toFixed() ?? null,
        finishedUnitCost: entry.unitCost?.toFixed() ?? null,
        status: entry.status,
        packagedAt: entry.occurredAt.toISOString(),
      }),
    );
    const totalItems = Math.max(orderCount, packagingCount);
    return productionReconciliationPageV1Schema.parse({
      batches,
      packaging: packageEvents,
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / q.pageSize),
      },
    });
  }
}
