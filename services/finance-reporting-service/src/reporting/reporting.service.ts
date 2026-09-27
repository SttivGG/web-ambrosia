import { Inject, Injectable } from '@nestjs/common';
import {
  financeReportingEventV1Schema,
  inventoryReportingEventV1Schema,
  productionReportingEventV1Schema,
  reportFinanceListV1Schema,
  reportInventoryListV1Schema,
  reportMovementListV1Schema,
  reportProductionListV1Schema,
  type FinanceReportingEventV1,
  type InventoryReportingEventV1,
  type ProductionReportingEventV1,
  type ReportFinanceFiltersV1,
  type ReportInventoryFiltersV1,
  type ReportMovementFiltersV1,
  type ReportProductionFiltersV1,
} from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { pagination } from '../finance/domain';

type ReportingEvent =
  | InventoryReportingEventV1
  | ProductionReportingEventV1
  | FinanceReportingEventV1;

const dates = (from?: string, to?: string) => ({
  ...(from ? { gte: new Date(from) } : {}),
  ...(to ? { lt: new Date(to) } : {}),
});
const newer = (
  current: { sourceVersion: bigint; occurredAt: Date } | null,
  event: ReportingEvent,
) =>
  !current ||
  BigInt(event.sourceVersion) > current.sourceVersion ||
  (BigInt(event.sourceVersion) === current.sourceVersion &&
    new Date(event.occurredAt) > current.occurredAt);
const meta = (event: ReportingEvent) => ({
  sourceService: event.sourceService,
  sourceEntityId: event.sourceEntityId,
  sourceVersion: BigInt(event.sourceVersion),
  operationId: event.operationId,
  eventId: event.eventId,
  occurredAt: new Date(event.occurredAt),
  processedAt: new Date(),
});
const commonDto = <
  T extends {
    sourceVersion: bigint;
    occurredAt: Date;
    processedAt: Date;
  },
>(
  row: T,
) => ({
  ...row,
  sourceVersion: Number(row.sourceVersion),
  occurredAt: row.occurredAt.toISOString(),
  processedAt: row.processedAt.toISOString(),
});

@Injectable()
export class ReportingService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async apply(
    subject: string,
    raw: unknown,
  ): Promise<'applied' | 'stale' | 'duplicate'> {
    const event =
      subject === 'inventory.reporting.v1'
        ? inventoryReportingEventV1Schema.parse(raw)
        : subject === 'production.reporting.v1'
          ? productionReportingEventV1Schema.parse(raw)
          : financeReportingEventV1Schema.parse(raw);
    if (
      await this.db.reportProcessedEvent.findUnique({
        where: { eventId: event.eventId },
      })
    )
      return 'duplicate';
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.reportProcessedEvent.create({
            data: {
              eventId: event.eventId,
              subject,
              sourceService: event.sourceService,
              sourceEntityId: event.sourceEntityId,
              operationId: event.operationId,
              occurredAt: new Date(event.occurredAt),
            },
          });
          if (event.kind === 'ITEM_SNAPSHOT') {
            const current = await tx.reportInventoryItem.findUnique({
              where: { sourceEntityId: event.sourceEntityId },
            });
            if (!newer(current, event)) return 'stale';
            const data = {
              ...meta(event),
              itemId: event.itemId,
              itemNameSnapshot: event.itemNameSnapshot,
              itemType: event.itemType,
              unit: event.unit,
              onHand: event.onHand,
              valuationStatus: event.valuationStatus,
              weightedAverageCost: event.weightedAverageCost,
              inventoryValue: event.inventoryValue,
              active: event.active,
              updatedAt: new Date(event.updatedAt),
            };
            await tx.reportInventoryItem.upsert({
              where: { sourceEntityId: event.sourceEntityId },
              create: data,
              update: data,
            });
          } else if (event.kind === 'MOVEMENT') {
            const current = await tx.reportInventoryMovement.findUnique({
              where: { sourceEntityId: event.sourceEntityId },
            });
            if (!newer(current, event)) return 'stale';
            const data = {
              ...meta(event),
              movementId: event.movementId,
              itemId: event.itemId,
              itemNameSnapshot: event.itemNameSnapshot,
              movementType: event.movementType,
              reference: event.reference,
              quantityIn: event.quantityIn,
              quantityOut: event.quantityOut,
              balanceAfter: event.balanceAfter,
              unitCost: event.unitCost,
              totalCost: event.totalCost,
              averageCostAfter: event.averageCostAfter,
            };
            await tx.reportInventoryMovement.upsert({
              where: { sourceEntityId: event.sourceEntityId },
              create: data,
              update: data,
            });
          } else if (event.kind === 'BATCH_SNAPSHOT') {
            const current = await tx.reportProductionBatch.findUnique({
              where: { sourceEntityId: event.sourceEntityId },
            });
            if (!newer(current, event)) return 'stale';
            const data = {
              ...meta(event),
              batchId: event.batchId,
              batch: event.batch,
              productId: event.productId,
              productNameSnapshot: event.productNameSnapshot,
              status: event.status,
              startedAt: event.startedAt ? new Date(event.startedAt) : null,
              completedAt: event.completedAt
                ? new Date(event.completedAt)
                : null,
              inputQuantity: event.inputQuantity,
              outputQuantity: event.outputQuantity,
              yieldPercentage: event.yieldPercentage,
              wasteQuantity: event.wasteQuantity,
              accumulatedCost: event.accumulatedCost,
              sellableCost: event.sellableCost,
              packagingOutputQuantity: event.packagingOutputQuantity,
            };
            await tx.reportProductionBatch.upsert({
              where: { sourceEntityId: event.sourceEntityId },
              create: data,
              update: data,
            });
          } else {
            const current = await tx.reportSaleMargin.findUnique({
              where: { sourceEntityId: event.sourceEntityId },
            });
            if (!newer(current, event)) return 'stale';
            const data = {
              ...meta(event),
              saleId: event.saleId,
              saleLineId: event.saleLineId,
              status: event.status,
              productId: event.productId,
              productNameSnapshot: event.productNameSnapshot,
              quantity: event.quantity,
              revenue: event.revenue,
              cogs: event.cogs,
              grossMargin: event.grossMargin,
              grossMarginPercent: event.grossMarginPercent,
            };
            await tx.reportSaleMargin.upsert({
              where: { sourceEntityId: event.sourceEntityId },
              create: data,
              update: data,
            });
          }
          return 'applied';
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return 'duplicate';
      throw error;
    }
  }

  async inventory(query: ReportInventoryFiltersV1) {
    const where: Prisma.ReportInventoryItemWhereInput = {
      itemType: query.itemType,
      valuationStatus: query.valuationStatus,
      ...(query.search
        ? { itemNameSnapshot: { contains: query.search, mode: 'insensitive' } }
        : {}),
      ...(query.from || query.to
        ? { updatedAt: dates(query.from, query.to) }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.reportInventoryItem.findMany({
        where,
        orderBy: [{ itemNameSnapshot: 'asc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportInventoryItem.count({ where }),
    ]);
    return reportInventoryListV1Schema.parse({
      data: rows.map((row) => ({
        ...commonDto(row),
        onHand: row.onHand.toFixed(),
        weightedAverageCost: row.weightedAverageCost?.toFixed() ?? null,
        inventoryValue: row.inventoryValue?.toFixed() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      pagination: pagination(query, total),
    });
  }

  async movements(query: ReportMovementFiltersV1) {
    const where: Prisma.ReportInventoryMovementWhereInput = {
      itemId: query.itemId,
      movementType: query.movementType,
      ...(query.from || query.to
        ? { occurredAt: dates(query.from, query.to) }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.reportInventoryMovement.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportInventoryMovement.count({ where }),
    ]);
    return reportMovementListV1Schema.parse({
      data: rows.map((row) => ({
        ...commonDto(row),
        quantityIn: row.quantityIn.toFixed(),
        quantityOut: row.quantityOut.toFixed(),
        balanceAfter: row.balanceAfter?.toFixed() ?? null,
        unitCost: row.unitCost?.toFixed() ?? null,
        totalCost: row.totalCost?.toFixed() ?? null,
        averageCostAfter: row.averageCostAfter?.toFixed() ?? null,
      })),
      pagination: pagination(query, total),
    });
  }

  async production(query: ReportProductionFiltersV1) {
    const where: Prisma.ReportProductionBatchWhereInput = {
      status: query.status,
      productId: query.productId,
      ...(query.from || query.to
        ? { occurredAt: dates(query.from, query.to) }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.reportProductionBatch.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportProductionBatch.count({ where }),
    ]);
    return reportProductionListV1Schema.parse({
      data: rows.map((row) => ({
        ...commonDto(row),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        inputQuantity: row.inputQuantity.toFixed(),
        outputQuantity: row.outputQuantity?.toFixed() ?? null,
        yieldPercentage: row.yieldPercentage?.toFixed() ?? null,
        wasteQuantity: row.wasteQuantity?.toFixed() ?? null,
        accumulatedCost: row.accumulatedCost?.toFixed() ?? null,
        sellableCost: row.sellableCost?.toFixed() ?? null,
        packagingOutputQuantity: row.packagingOutputQuantity?.toFixed() ?? null,
      })),
      pagination: pagination(query, total),
    });
  }

  async finance(query: ReportFinanceFiltersV1) {
    const where: Prisma.ReportSaleMarginWhereInput = {
      status: query.status,
      productId: query.productId,
      ...(query.from || query.to
        ? { occurredAt: dates(query.from, query.to) }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.reportSaleMargin.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportSaleMargin.count({ where }),
    ]);
    return reportFinanceListV1Schema.parse({
      data: rows.map((row) => ({
        ...commonDto(row),
        quantity: row.quantity.toFixed(),
        revenue: row.revenue.toFixed(),
        cogs: row.cogs?.toFixed() ?? null,
        grossMargin: row.grossMargin?.toFixed() ?? null,
        grossMarginPercent: row.grossMarginPercent?.toFixed() ?? null,
      })),
      pagination: pagination(query, total),
    });
  }

  async health() {
    const [inventoryItems, inventoryMovements, productionBatches, saleMargins] =
      await Promise.all([
        this.db.reportInventoryItem.count(),
        this.db.reportInventoryMovement.count(),
        this.db.reportProductionBatch.count(),
        this.db.reportSaleMargin.count(),
      ]);
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
      projections: {
        inventoryItems,
        inventoryMovements,
        productionBatches,
        saleMargins,
      },
    };
  }

  async clearInventory() {
    return this.db.$transaction(async (tx) => {
      const movements = await tx.reportInventoryMovement.deleteMany();
      const items = await tx.reportInventoryItem.deleteMany();
      await tx.reportProcessedEvent.deleteMany({
        where: { sourceService: 'inventory-service' },
      });
      return { items: items.count, movements: movements.count };
    });
  }
}
