import {
  reportHealthV1Schema,
  reportInventoryListV1Schema,
  reportMovementListV1Schema,
  reportPackagingListV1Schema,
  reportProductionListV1Schema,
  reportPurchaseListV1Schema,
  reportSupplierListV1Schema,
  reportSummaryV1Schema,
} from '@ambrosia/contracts';
import { authenticatedFetch } from './authenticated-fetch';

async function request(path: string) {
  const response = await authenticatedFetch('/api/finance/reports/' + path);
  if (response.status === 403) throw new Error('forbidden');
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
const query = (path: string, values: URLSearchParams) =>
  request(path + '?' + values.toString());
export const reportingApi = {
  health: async () => reportHealthV1Schema.parse(await request('health')),
  inventory: async (
    values = new URLSearchParams({ page: '1', pageSize: '20' }),
  ) => reportInventoryListV1Schema.parse(await query('inventory', values)),
  inventorySummary: async (values: URLSearchParams) =>
    reportSummaryV1Schema.parse(await query('inventory/summary', values)),
  movements: async (values: URLSearchParams) =>
    reportMovementListV1Schema.parse(
      await query('inventory/movements', values),
    ),
  purchases: async (values: URLSearchParams) =>
    reportPurchaseListV1Schema.parse(await query('purchases', values)),
  purchaseSummary: async (values: URLSearchParams) =>
    reportSummaryV1Schema.parse(await query('purchases/summary', values)),
  suppliers: async (values: URLSearchParams) =>
    reportSupplierListV1Schema.parse(await query('suppliers', values)),
  production: async (values: URLSearchParams) =>
    reportProductionListV1Schema.parse(await query('production', values)),
  productionSummary: async (values: URLSearchParams) =>
    reportSummaryV1Schema.parse(await query('production/summary', values)),
  yield: async (values: URLSearchParams) =>
    reportProductionListV1Schema.parse(await query('yield', values)),
  yieldSummary: async (values: URLSearchParams) =>
    reportSummaryV1Schema.parse(await query('yield/summary', values)),
  waste: async (values: URLSearchParams) =>
    reportProductionListV1Schema.parse(await query('waste', values)),
  wasteSummary: async (values: URLSearchParams) =>
    reportSummaryV1Schema.parse(await query('waste/summary', values)),
  packaging: async (values: URLSearchParams) =>
    reportPackagingListV1Schema.parse(await query('packaging', values)),
};
