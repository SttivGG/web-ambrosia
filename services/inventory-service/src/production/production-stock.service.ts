import { Inject, Injectable } from '@nestjs/common';
import {
  consumptionRequestV1Schema,
  consumptionResultV1Schema,
  type ConsumptionRequestV1,
  type ConsumptionResultV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from '../purchases/stock.service';
import { PurchaseError, databaseError, parse } from '../purchases/domain';
@Injectable()
export class ProductionStockService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}
  async get(id: string) {
    const row = await this.db.productionStockOperation.findUnique({
      where: { id },
    });
    if (!row)
      throw new PurchaseError(
        'ITEM_NOT_FOUND',
        404,
        'Operación no encontrada.',
      );
    return consumptionResultV1Schema.parse(row.result);
  }
  async execute(input: ConsumptionRequestV1) {
    const data = parse(consumptionRequestV1Schema, input);
    data.lines.sort((a, b) => a.itemId.localeCompare(b.itemId));
    try {
      return await this.db.$transaction(
        async (tx) => {
          // All operations for the same production serialize, including alternate operation IDs.
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${data.productionId}, 0))`,
          );
          const existing = await tx.productionStockOperation.findUnique({
            where: { id: data.operationId },
          });
          if (existing) {
            const original = parse(
              consumptionRequestV1Schema,
              existing.payload,
            );
            if (JSON.stringify(original) !== JSON.stringify(data))
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra solicitud.',
              );
            return consumptionResultV1Schema.parse(existing.result);
          }
          const result: ConsumptionResultV1 = {
            operationId: data.operationId,
            productionId: data.productionId,
            status: 'CONFIRMED',
            error: null,
            movements: [],
          };
          const previous = await tx.productionStockOperation.findMany({
            where: { productionId: data.productionId },
          });
          const confirmed = previous.filter(
            (p) =>
              consumptionResultV1Schema.parse(p.result).status === 'CONFIRMED',
          );
          const original = data.originalOperationId
            ? previous.find(
                (p) =>
                  p.id === data.originalOperationId &&
                  p.kind === 'CONSUME' &&
                  consumptionResultV1Schema.parse(p.result).status ===
                    'CONFIRMED',
              )
            : null;
          let originals: Awaited<
            ReturnType<typeof tx.inventoryMovement.findMany>
          > = [];
          try {
            if (
              data.kind === 'CONSUME' &&
              confirmed.some((p) => p.kind === 'CONSUME')
            )
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'La producción ya consumió inventario.',
              );
            if (data.kind === 'REVERSE') {
              if (!original || confirmed.some((p) => p.kind === 'REVERSE'))
                throw new PurchaseError(
                  'DUPLICATE_OPERATION',
                  409,
                  'Consumo inexistente o ya compensado.',
                );
              const request = parse(
                consumptionRequestV1Schema,
                original.payload,
              );
              if (JSON.stringify(request.lines) !== JSON.stringify(data.lines))
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Los insumos deben coincidir con el consumo original.',
                );
              originals = await tx.inventoryMovement.findMany({
                where: { productionOperationId: original.id },
                orderBy: { itemId: 'asc' },
              });
            }
            const items = await this.stock.lockItems(
              tx,
              data.lines.map((l) => l.itemId),
            );
            const Exact = Prisma.Decimal.clone({ precision: 80 });
            for (const line of data.lines) {
              const item = items.find((i) => i.id === line.itemId)!;
              if (data.kind === 'CONSUME') this.stock.requireTracked(item);
              if (item.inventoryBaseUnit !== line.baseUnit)
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'La unidad del insumo cambió.',
                );
              const balance = await tx.inventoryBalance.findUnique({
                where: { itemId: line.itemId },
              });
              const current = new Exact(balance?.quantity.toFixed() ?? '0');
              if (data.kind === 'CONSUME' && current.lt(line.quantity))
                throw new PurchaseError(
                  'INSUFFICIENT_STOCK',
                  409,
                  'Existencias insuficientes para todos los insumos.',
                );
              if (
                data.kind === 'REVERSE' &&
                current.plus(line.quantity).gte('100000000000000')
              )
                throw new PurchaseError(
                  'DECIMAL_OVERFLOW',
                  409,
                  'La compensación excedería la precisión del saldo.',
                );
            }
          } catch (e) {
            if (!(e instanceof PurchaseError)) throw e;
            result.status = 'REJECTED';
            result.error = (e.getResponse() as { message: string }).message;
          }
          await tx.productionStockOperation.create({
            data: {
              id: data.operationId,
              productionId: data.productionId,
              kind: data.kind,
              originalOperationId:
                result.status === 'CONFIRMED' ? data.originalOperationId : null,
              payload: data,
              result: result as unknown as Prisma.InputJsonValue,
            },
          });
          if (result.status === 'CONFIRMED') {
            for (const line of data.lines)
              result.movements.push(
                await this.stock.record(tx, {
                  ...line,
                  type:
                    data.kind === 'CONSUME'
                      ? 'PRODUCTION_OUT'
                      : 'PRODUCTION_RETURN',
                  origin: 'PRODUCTION',
                  reference: data.productionId,
                  reason: data.reason,
                  actorId: data.actorId,
                  productionOperationId: data.operationId,
                  ...(data.kind === 'REVERSE'
                    ? {
                        reversesId: originals.find(
                          (m) => m.itemId === line.itemId,
                        )!.id,
                      }
                    : {}),
                }),
              );
            await tx.productionStockOperation.update({
              where: { id: data.operationId },
              data: { result: result as unknown as Prisma.InputJsonValue },
            });
          }
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 10000,
        },
      );
    } catch (e) {
      databaseError(e);
    }
  }
}
