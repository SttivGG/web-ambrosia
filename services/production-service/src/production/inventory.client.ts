import { Injectable } from '@nestjs/common';
import {
  consumptionResultV1Schema,
  type ProductionStockRequestV1,
  type FormulaInputV1,
} from '@ambrosia/contracts';
import { ProductionError } from './domain';
@Injectable()
export class InventoryClient {
  async request(path: string, body?: unknown): Promise<unknown> {
    const key = process.env.PRODUCTION_INVENTORY_TOKEN;
    if (!key || key.length < 64)
      throw new ProductionError(
        'INVENTORY_UNAVAILABLE',
        503,
        'La conexión con inventario no está configurada.',
      );
    try {
      const url = process.env.INVENTORY_INTERNAL_URL ?? 'http://127.0.0.1:3001';
      const r = await fetch(url + '/api/v1/internal/production/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!r.ok) throw new Error('upstream');
      return await r.json();
    } catch {
      throw new ProductionError(
        'INVENTORY_UNAVAILABLE',
        503,
        'Inventario no confirmó la solicitud. La operación se conserva para reconciliar.',
      );
    }
  }
  async execute(payload: ProductionStockRequestV1) {
    return consumptionResultV1Schema.parse(
      await this.request('operations', payload),
    );
  }
  async item(id: string) {
    return (await this.request('items/' + id)) as {
      id: string;
      active: boolean;
      trackInventory: boolean;
      inventoryBaseUnit: 'UNIT' | 'GRAM' | 'MILLILITER';
      itemType:
        | 'RAW_MATERIAL'
        | 'PACKAGING'
        | 'FINISHED_PRODUCT'
        | 'BYPRODUCT'
        | 'SUPPLY';
      nominalCapacityValue: string | null;
      nominalCapacityUnit: 'MILLILITER' | 'FLUID_OUNCE' | 'GRAM' | null;
    } | null;
  }
  async validateFormula(data: FormulaInputV1) {
    const entries = [
      { itemId: data.productId, baseUnit: data.baseUnit, product: true },
      ...data.ingredients.map((i) => ({ ...i, product: false })),
    ];
    if (data.ingredients.some((i) => i.itemId === data.productId))
      throw new ProductionError(
        'VALIDATION_ERROR',
        400,
        'El producto no puede ser su propio insumo.',
      );
    for (const entry of entries) {
      const item = await this.item(entry.itemId);
      if (
        !item ||
        !item.active ||
        item.inventoryBaseUnit !== entry.baseUnit ||
        (entry.product
          ? item.itemType !== 'FINISHED_PRODUCT'
          : !item.trackInventory)
      )
        throw new ProductionError(
          'VALIDATION_ERROR',
          400,
          'Selecciona un producto terminado e insumos activos con unidades compatibles.',
        );
    }
  }
}
