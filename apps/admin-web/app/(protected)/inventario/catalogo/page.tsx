import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Catalog } from '../../../../components/catalog/catalog';
export default async function CatalogPage() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('inventory.read'))
    redirect('/forbidden');
  return <Catalog />;
}
