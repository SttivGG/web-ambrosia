import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  REPORTING_SUBJECTS_V1,
  inventoryReconciliationPageV1Schema,
} from '@ambrosia/contracts';
import { ReportingService } from './reporting.service';

@Injectable()
export class InventoryReconciliationService {
  constructor(private readonly reporting: ReportingService) {}
  private async page(page: number) {
    const token = process.env.FINANCE_INVENTORY_TOKEN;
    if (!token || token.length < 64)
      throw new ServiceUnavailableException(
        'La conexión técnica con Inventory no está configurada.',
      );
    try {
      const base =
        process.env.INVENTORY_INTERNAL_URL ?? 'http://127.0.0.1:3001';
      const query = new URLSearchParams({
        page: String(page),
        pageSize: '100',
      });
      const response = await fetch(
        base + '/api/v1/internal/reporting/inventory?' + query,
        {
          headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(5_000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('upstream');
      return inventoryReconciliationPageV1Schema.parse(await response.json());
    } catch {
      throw new ServiceUnavailableException(
        'Inventory no está disponible para reconciliar Reporting.',
      );
    }
  }
  async reconcile() {
    let page = 1;
    let totalPages = 1;
    let applied = 0;
    let duplicates = 0;
    let stale = 0;
    do {
      const snapshot = await this.page(page);
      totalPages = snapshot.pagination.totalPages;
      for (const event of [...snapshot.items, ...snapshot.movements]) {
        const result = await this.reporting.apply(
          REPORTING_SUBJECTS_V1.inventory,
          event,
        );
        if (result === 'applied') applied += 1;
        else if (result === 'duplicate') duplicates += 1;
        else stale += 1;
      }
      page += 1;
    } while (page <= totalPages);
    return { status: 'ok', applied, duplicates, stale };
  }
  async rebuild() {
    const cleared = await this.reporting.clearInventory();
    const reconciled = await this.reconcile();
    return { status: 'ok', cleared, reconciled };
  }
}
