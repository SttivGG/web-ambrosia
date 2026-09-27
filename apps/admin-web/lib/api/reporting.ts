import {
  reportHealthV1Schema,
  reportInventoryListV1Schema,
} from '@ambrosia/contracts';
import { authenticatedFetch } from './authenticated-fetch';

async function request(path: string) {
  const response = await authenticatedFetch('/api/finance/reports/' + path);
  if (response.status === 403) throw new Error('forbidden');
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
export const reportingApi = {
  health: async () => reportHealthV1Schema.parse(await request('health')),
  inventory: async () =>
    reportInventoryListV1Schema.parse(
      await request('inventory?page=1&pageSize=5'),
    ),
};
