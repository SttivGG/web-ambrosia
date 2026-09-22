import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Suppliers } from '../../../../components/suppliers/suppliers';
export default async function SuppliersPage() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('inventory.read'))
    redirect('/forbidden');
  return <Suppliers />;
}
