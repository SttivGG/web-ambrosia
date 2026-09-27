import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  saleStockRequestV1Schema,
  saleStockResultV1Schema,
  type SaleStockRequestV1,
  type SaleStockResultV1,
} from '@ambrosia/contracts';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../generated/prisma/client';
import { StockService } from '../purchases/stock.service';
import { PurchaseError, databaseError, parse } from '../purchases/domain';

@Injectable()
export class SaleStockService {
  private readonly logger = new Logger(SaleStockService.name);

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StockService) private readonly stock: StockService,
  ) {}
  async execute(input: SaleStockRequestV1) {
    const data = parse(saleStockRequestV1Schema, input);
    data.lines.sort((a, b) => a.itemId.localeCompare(b.itemId));
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${data.saleId}, 0))`,
          );
          const existing = await tx.saleStockOperation.findUnique({
            where: { id: data.operationId },
          });
          if (existing) {
            const original = parse(saleStockRequestV1Schema, existing.payload);
            if (JSON.stringify(original) !== JSON.stringify(data))
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'El identificador pertenece a otra solicitud.',
              );
            return saleStockResultV1Schema.parse(existing.result);
          }
          const prior = await tx.saleStockOperation.findMany({
            where: { saleId: data.saleId },
          });
          const confirmed = prior.filter(
            (row) =>
              saleStockResultV1Schema.parse(row.result).status === 'CONFIRMED',
          );
          const original =
            data.kind === 'CANCEL'
              ? prior.find(
                  (row) =>
                    row.id === data.originalOperationId &&
                    row.kind === 'CONFIRM' &&
                    saleStockResultV1Schema.parse(row.result).status ===
                      'CONFIRMED',
                )
              : undefined;
          const result: SaleStockResultV1 = {
            operationId: data.operationId,
            saleId: data.saleId,
            status: 'CONFIRMED',
            error: null,
            movements: [],
          };
          let originals: Awaited<
            ReturnType<typeof tx.inventoryMovement.findMany>
          > = [];
          try {
            if (
              data.kind === 'CONFIRM' &&
              confirmed.some((row) => row.kind === 'CONFIRM')
            )
              throw new PurchaseError(
                'DUPLICATE_OPERATION',
                409,
                'La venta ya descontó existencias.',
              );
            if (data.kind === 'CANCEL') {
              if (!original || confirmed.some((row) => row.kind === 'CANCEL'))
                throw new PurchaseError(
                  'DUPLICATE_OPERATION',
                  409,
                  'La venta no existe o ya devolvió existencias.',
                );
              const originalPayload = parse(
                saleStockRequestV1Schema,
                original.payload,
              );
              if (
                JSON.stringify(originalPayload.lines) !==
                JSON.stringify(data.lines)
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Los artículos no coinciden con la venta original.',
                );
              originals = await tx.inventoryMovement.findMany({
                where: { saleOperationId: original.id },
                orderBy: { itemId: 'asc' },
              });
            }
            const items = await this.stock.lockItems(
              tx,
              data.lines.map((line) => line.itemId),
            );
            for (const line of data.lines) {
              const item = items.find(
                (candidate) => candidate.id === line.itemId,
              )!;
              if (
                item.itemType !== 'FINISHED_PRODUCT' ||
                item.inventoryBaseUnit !== 'UNIT' ||
                !item.trackInventory
              )
                throw new PurchaseError(
                  'VALIDATION_ERROR',
                  400,
                  'Solo pueden venderse productos terminados controlados por unidad.',
                );
              if (data.kind === 'CONFIRM') {
                this.stock.requireTracked(item);
                const balance = await tx.inventoryBalance.findUnique({
                  where: { itemId: line.itemId },
                });
                if (
                  new Prisma.Decimal(balance?.quantity.toFixed() ?? '0').lt(
                    line.quantity,
                  )
                )
                  throw new PurchaseError(
                    'INSUFFICIENT_STOCK',
                    409,
                    'Existencias insuficientes para confirmar la venta.',
                  );
              }
            }
          } catch (error) {
            if (!(error instanceof PurchaseError)) throw error;
            result.status = 'REJECTED';
            result.error = (error.getResponse() as { message: string }).message;
          }
          await tx.saleStockOperation.create({
            data: {
              id: data.operationId,
              saleId: data.saleId,
              kind: data.kind,
              originalOperationId:
                result.status === 'CONFIRMED' && data.kind === 'CANCEL'
                  ? data.originalOperationId
                  : null,
              payload: data,
              result: result as unknown as Prisma.InputJsonValue,
            },
          });
          if (result.status === 'CONFIRMED') {
            for (const line of data.lines) {
              const movement = await this.stock.record(tx, {
                ...line,
                baseUnit: 'UNIT',
                type: data.kind === 'CONFIRM' ? 'SALE_OUT' : 'SALE_RETURN',
                origin: 'SALE',
                reference: data.saleId,
                reason: data.reason,
                actorId: data.actorId,
                saleOperationId: data.operationId,
                ...(data.kind === 'CANCEL'
                  ? {
                      reversesId: originals.find(
                        (row) => row.itemId === line.itemId,
                      )!.id,
                    }
                  : {}),
              });
              result.movements.push(movement.id);
            }
            await tx.saleStockOperation.update({
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
    } catch (error) {
      if (!(error instanceof PurchaseError))
        this.logger.error(
          'Fallo inesperado coordinando existencias de una venta.',
          error instanceof Error ? error.stack : undefined,
        );
      databaseError(error);
    }
  }
}
