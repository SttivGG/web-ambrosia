import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  REPORTING_SUBJECTS_V1,
  productionReconciliationPageV1Schema,
} from '@ambrosia/contracts';
import { ReportingService } from './reporting.service';

@Injectable()
export class ProductionReconciliationService {
  constructor(private readonly reporting: ReportingService) {}
  private async page(page: number) {
    const token = process.env.REPORTING_PRODUCTION_TOKEN;
    if (!token || token.length < 64)
      throw new ServiceUnavailableException(
        'La conexión técnica con Production no está configurada.',
      );
    try {
      const base =
        process.env.PRODUCTION_INTERNAL_URL ?? 'http://127.0.0.1:3002';
      const query = new URLSearchParams({
        page: String(page),
        pageSize: '100',
      });
      const response = await fetch(
        base + '/api/v1/internal/reporting/production?' + query,
        {
          headers: { Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(5_000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('upstream');
      return productionReconciliationPageV1Schema.parse(await response.json());
    } catch {
      throw new ServiceUnavailableException(
        'Production no está disponible para reconciliar Reporting.',
      );
    }
  }
  async reconcile() {
    let page = 1,
      totalPages = 1,
      applied = 0,
      duplicates = 0,
      stale = 0;
    do {
      const snapshot = await this.page(page);
      totalPages = snapshot.pagination.totalPages;
      for (const event of [...snapshot.batches, ...snapshot.packaging]) {
        const result = await this.reporting.apply(
          REPORTING_SUBJECTS_V1.production,
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
    const cleared = await this.reporting.clearProduction();
    const reconciled = await this.reconcile();
    return { status: 'ok', cleared, reconciled };
  }
}
