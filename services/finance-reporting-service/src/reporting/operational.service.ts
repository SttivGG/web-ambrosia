import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  reportPackagingListV1Schema,
  reportProductionListV1Schema,
  reportPurchaseListV1Schema,
  reportSupplierListV1Schema,
  type ReportPackagingFiltersV1,
  type ReportProductionFiltersV1,
  type ReportPurchaseFiltersV1,
  type ReportSupplierFiltersV1,
} from '@ambrosia/contracts';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { pagination } from '../finance/domain';

const range = (from?: string, to?: string) => ({
  ...(from ? { gte: new Date(from) } : {}),
  ...(to ? { lt: new Date(to) } : {}),
});
const decimal = (value: Prisma.Decimal | null, finance: boolean) =>
  finance ? (value?.toFixed() ?? null) : null;
const metadata = <
  T extends { sourceVersion: bigint; occurredAt: Date; processedAt: Date },
>(
  row: T,
) => ({
  ...row,
  sourceVersion: Number(row.sourceVersion),
  occurredAt: row.occurredAt.toISOString(),
  processedAt: row.processedAt.toISOString(),
});
const change = (current: Prisma.Decimal, previous: Prisma.Decimal) => ({
  current: current.toFixed(),
  previous: previous.toFixed(),
  changePercent: previous.isZero()
    ? null
    : current
        .minus(previous)
        .div(previous)
        .mul(100)
        .toDecimalPlaces(10)
        .toFixed(),
});
const previousRange = (from?: string, to?: string) => {
  if (!from || !to) return null;
  const start = new Date(from),
    end = new Date(to),
    duration = end.getTime() - start.getTime();
  return { gte: new Date(start.getTime() - duration), lt: start };
};

@Injectable()
export class OperationalReportsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private purchaseWhere(
    query: ReportPurchaseFiltersV1,
  ): Prisma.ReportPurchaseItemWhereInput {
    return {
      supplierId: query.supplierId,
      itemId: query.itemId,
      categoryId: query.categoryId,
      status: query.status,
      ...(query.from || query.to
        ? { purchasedAt: range(query.from, query.to) }
        : {}),
    };
  }
  async purchases(query: ReportPurchaseFiltersV1, finance: boolean) {
    const where = this.purchaseWhere(query);
    const [rows, total] = await this.db.$transaction([
      this.db.reportPurchaseItem.findMany({
        where,
        orderBy: [{ purchasedAt: 'desc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportPurchaseItem.count({ where }),
    ]);
    return reportPurchaseListV1Schema.parse({
      data: rows.map((row) => ({
        ...metadata(row),
        purchasedAt: row.purchasedAt.toISOString(),
        quantity: row.quantity.toFixed(),
        unitCost: decimal(row.unitCost, finance),
        subtotal: decimal(row.subtotal, finance),
      })),
      pagination: pagination(query, total),
    });
  }
  async purchaseSummary(query: ReportPurchaseFiltersV1, finance: boolean) {
    const rows = await this.db.reportPurchaseItem.findMany({
      where: this.purchaseWhere(query),
    });
    const purchases = new Set(rows.map((row) => row.purchaseId));
    const suppliers = new Set(rows.map((row) => row.supplierId));
    const quantity = rows.reduce(
      (sum, row) => sum.plus(row.quantity),
      new Prisma.Decimal(0),
    );
    const total = rows.reduce(
      (sum, row) => sum.plus(row.subtotal),
      new Prisma.Decimal(0),
    );
    const average = quantity.isZero() ? null : total.div(quantity);
    const prior = previousRange(query.from, query.to);
    let comparison: Record<string, ReturnType<typeof change>> | undefined;
    if (prior) {
      const previousRows = await this.db.reportPurchaseItem.findMany({
        where: {
          ...this.purchaseWhere({ ...query, from: undefined, to: undefined }),
          purchasedAt: prior,
        },
      });
      const previousTotal = previousRows.reduce(
        (sum, row) => sum.plus(row.subtotal),
        new Prisma.Decimal(0),
      );
      comparison = { totalComprado: change(total, previousTotal) };
    }
    return {
      metrics: {
        totalComprado: finance ? total.toFixed() : null,
        numeroCompras: purchases.size,
        proveedores: suppliers.size,
        costoPromedioPonderado: finance ? (average?.toFixed() ?? null) : null,
      },
      ...(finance && comparison ? { comparison } : {}),
    };
  }
  async suppliers(
    query: ReportSupplierFiltersV1,
    finance: boolean,
    supplierId?: string,
  ) {
    const rows = await this.db.reportPurchaseItem.findMany({
      where: {
        supplierId,
        ...(query.search
          ? {
              supplierNameSnapshot: {
                contains: query.search,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query.from || query.to
          ? { purchasedAt: range(query.from, query.to) }
          : {}),
      },
      orderBy: [{ supplierNameSnapshot: 'asc' }, { purchasedAt: 'desc' }],
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows)
      groups.set(row.supplierId, [...(groups.get(row.supplierId) ?? []), row]);
    const data = [...groups.entries()].map(([supplierId, entries]) => {
      const items = new Map<string, typeof entries>();
      for (const entry of entries)
        items.set(entry.itemId, [...(items.get(entry.itemId) ?? []), entry]);
      return {
        supplierId,
        supplierName: entries[0]!.supplierNameSnapshot,
        totalPurchases: finance
          ? entries
              .reduce(
                (sum, row) => sum.plus(row.subtotal),
                new Prisma.Decimal(0),
              )
              .toFixed()
          : null,
        purchaseCount: new Set(entries.map((row) => row.purchaseId)).size,
        lastPurchaseAt: entries
          .reduce(
            (latest, row) =>
              row.purchasedAt > latest ? row.purchasedAt : latest,
            entries[0]!.purchasedAt,
          )
          .toISOString(),
        suppliedItems: items.size,
        averageCosts: [...items.entries()].map(([itemId, values]) => {
          const qty = values.reduce(
            (sum, row) => sum.plus(row.quantity),
            new Prisma.Decimal(0),
          );
          const total = values.reduce(
            (sum, row) => sum.plus(row.subtotal),
            new Prisma.Decimal(0),
          );
          return {
            itemId,
            itemName: values[0]!.itemNameSnapshot,
            weightedAverageCost:
              finance && !qty.isZero() ? total.div(qty).toFixed() : null,
          };
        }),
        priceHistory: entries.map((row) => ({
          itemId: row.itemId,
          itemName: row.itemNameSnapshot,
          purchasedAt: row.purchasedAt.toISOString(),
          unitCost: decimal(row.unitCost, finance),
        })),
      };
    });
    const start = (query.page - 1) * query.pageSize;
    return reportSupplierListV1Schema.parse({
      data: data.slice(start, start + query.pageSize),
      pagination: pagination(query, data.length),
    });
  }
  async supplier(id: string, finance: boolean) {
    const result = await this.suppliers({ page: 1, pageSize: 1 }, finance, id);
    const value = result.data[0];
    if (!value)
      throw new NotFoundException('Proveedor no encontrado en Reporting.');
    return value;
  }
  private productionWhere(
    query: ReportProductionFiltersV1,
  ): Prisma.ReportProductionBatchWhereInput {
    return {
      status: query.status,
      productId: query.productId,
      ...(query.from || query.to
        ? { occurredAt: range(query.from, query.to) }
        : {}),
    };
  }
  async production(query: ReportProductionFiltersV1, finance: boolean) {
    const where = this.productionWhere(query);
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
        ...metadata(row),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        inputQuantity: row.inputQuantity.toFixed(),
        outputQuantity: row.outputQuantity?.toFixed() ?? null,
        yieldPercentage: row.yieldPercentage?.toFixed() ?? null,
        wasteQuantity: row.wasteQuantity?.toFixed() ?? null,
        accumulatedCost: decimal(row.accumulatedCost, finance),
        sellableCost: decimal(row.sellableCost, finance),
        packagingOutputQuantity: row.packagingOutputQuantity?.toFixed() ?? null,
      })),
      pagination: pagination(query, total),
    });
  }
  async productionSummary(query: ReportProductionFiltersV1, finance: boolean) {
    const rows = await this.db.reportProductionBatch.findMany({
      where: this.productionWhere(query),
    });
    const outputs = rows.filter((row) => row.outputQuantity !== null);
    const totalOutput = outputs.reduce(
      (sum, row) => sum.plus(row.outputQuantity!),
      new Prisma.Decimal(0),
    );
    const yields = rows.filter((row) => row.yieldPercentage !== null);
    const yieldAverage = yields.length
      ? yields
          .reduce(
            (sum, row) => sum.plus(row.yieldPercentage!),
            new Prisma.Decimal(0),
          )
          .div(yields.length)
      : null;
    const waste = rows.reduce(
      (sum, row) => sum.plus(row.wasteQuantity ?? 0),
      new Prisma.Decimal(0),
    );
    const costs = rows.reduce(
      (sum, row) => sum.plus(row.accumulatedCost ?? 0),
      new Prisma.Decimal(0),
    );
    const prior = previousRange(query.from, query.to);
    let comparison: Record<string, ReturnType<typeof change>> | undefined;
    if (prior) {
      const previous = await this.db.reportProductionBatch.findMany({
        where: {
          ...this.productionWhere({ ...query, from: undefined, to: undefined }),
          occurredAt: prior,
        },
      });
      const previousOutput = previous.reduce(
        (sum, row) => sum.plus(row.outputQuantity ?? 0),
        new Prisma.Decimal(0),
      );
      comparison = { cantidadProducida: change(totalOutput, previousOutput) };
    }
    return {
      metrics: {
        lotes: rows.length,
        cantidadProducida: totalOutput.toFixed(),
        rendimientoPromedio: yieldAverage?.toFixed() ?? null,
        mermaTotal: waste.toFixed(),
        costoAcumulado: finance ? costs.toFixed() : null,
      },
      ...(comparison ? { comparison } : {}),
    };
  }
  async yieldSummary(query: ReportProductionFiltersV1) {
    const rows = (
      await this.db.reportProductionBatch.findMany({
        where: this.productionWhere(query),
      })
    ).filter((row) => row.yieldPercentage !== null);
    const values = rows.map((row) => row.yieldPercentage!);
    const average = values.length
      ? values
          .reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
          .div(values.length)
      : null;
    return {
      metrics: {
        promedio: average?.toFixed() ?? null,
        minimo: values.length ? Prisma.Decimal.min(...values).toFixed() : null,
        maximo: values.length ? Prisma.Decimal.max(...values).toFixed() : null,
        lotes: rows.length,
      },
    };
  }
  async wasteSummary(query: ReportProductionFiltersV1) {
    const rows = await this.db.reportProductionBatch.findMany({
      where: this.productionWhere(query),
    });
    const waste = rows.reduce(
      (sum, row) => sum.plus(row.wasteQuantity ?? 0),
      new Prisma.Decimal(0),
    );
    const percentages = rows
      .filter((row) => row.inputQuantity.gt(0) && row.wasteQuantity !== null)
      .map((row) => row.wasteQuantity!.div(row.inputQuantity).mul(100));
    const average = percentages.length
      ? percentages
          .reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))
          .div(percentages.length)
      : null;
    const prior = previousRange(query.from, query.to);
    let comparison: Record<string, ReturnType<typeof change>> | undefined;
    if (prior) {
      const previous = await this.db.reportProductionBatch.findMany({
        where: {
          ...this.productionWhere({ ...query, from: undefined, to: undefined }),
          occurredAt: prior,
        },
      });
      const previousWaste = previous.reduce(
        (sum, row) => sum.plus(row.wasteQuantity ?? 0),
        new Prisma.Decimal(0),
      );
      comparison = { mermaTotal: change(waste, previousWaste) };
    }
    return {
      metrics: {
        mermaTotal: waste.toFixed(),
        mermaPromedioPorcentual: average?.toFixed() ?? null,
        lotesAnalizados: rows.length,
      },
      ...(comparison ? { comparison } : {}),
    };
  }
  async packaging(query: ReportPackagingFiltersV1, finance: boolean) {
    const where: Prisma.ReportPackagingOperationWhereInput = {
      finishedProductId: query.productId,
      status: query.status,
      ...(query.from || query.to
        ? { packagedAt: range(query.from, query.to) }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.reportPackagingOperation.findMany({
        where,
        orderBy: [{ packagedAt: 'desc' }, { sourceEntityId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.reportPackagingOperation.count({ where }),
    ]);
    return reportPackagingListV1Schema.parse({
      data: rows.map((row) => ({
        ...metadata(row),
        packagedAt: row.packagedAt.toISOString(),
        units: row.units.toFixed(),
        netContentPerUnit: row.netContentPerUnit.toFixed(),
        netContentTotal: row.netContentTotal.toFixed(),
        bulkCost: decimal(row.bulkCost, finance),
        materialsCost: decimal(row.materialsCost, finance),
        totalCost: decimal(row.totalCost, finance),
        finishedUnitCost: decimal(row.finishedUnitCost, finance),
      })),
      pagination: pagination(query, total),
    });
  }
}
