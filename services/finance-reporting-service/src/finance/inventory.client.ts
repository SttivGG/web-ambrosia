import { Injectable } from '@nestjs/common';
import {
  purchaseSnapshotV1Schema,
  saleStockResultV1Schema,
  saleableItemListV1Schema,
  saleableItemV1Schema,
  type SaleStockRequestV1,
} from '@ambrosia/contracts';
import { FinanceError } from './domain';

@Injectable()
export class InventoryClient {
  private async request(path: string, body?: unknown) {
    const token = process.env.FINANCE_INVENTORY_TOKEN;
    if (!token || token.length < 64)
      throw new FinanceError(
        'INVENTORY_UNAVAILABLE',
        503,
        'La conexión técnica con Inventory no está configurada.',
      );
    try {
      const base =
        process.env.INVENTORY_INTERNAL_URL ?? 'http://127.0.0.1:3001';
      const response = await fetch(base + '/api/v1/internal/finance/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('upstream');
      return await response.json();
    } catch {
      throw new FinanceError(
        'INVENTORY_UNAVAILABLE',
        503,
        'Inventory no confirmó la solicitud. La operación pendiente conserva su identificador para reconciliar.',
      );
    }
  }
  async purchase(id: string) {
    const value = await this.request('purchases/' + encodeURIComponent(id));
    const parsed = purchaseSnapshotV1Schema.safeParse(value);
    if (!parsed.success)
      throw new FinanceError(
        'PURCHASE_NOT_PAYABLE',
        409,
        'La compra no existe o no está disponible para pago.',
      );
    return parsed.data;
  }
  async item(id: string) {
    const parsed = saleableItemV1Schema.safeParse(
      await this.request('saleable-items/' + encodeURIComponent(id)),
    );
    if (!parsed.success)
      throw new FinanceError(
        'VALIDATION_ERROR',
        400,
        'Selecciona únicamente productos terminados activos controlados por unidad.',
        ['lines'],
      );
    return parsed.data;
  }
  async items(search = '', page = 1, pageSize = 100) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (search) query.set('search', search);
    return saleableItemListV1Schema.parse(
      await this.request('saleable-items?' + query),
    );
  }
  async execute(payload: SaleStockRequestV1) {
    return saleStockResultV1Schema.parse(
      await this.request('sales/operations', payload),
    );
  }
}
