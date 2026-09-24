import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Stocks } from '../../../../components/purchases/stock';
export default async function Page() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('inventory.read'))
    redirect('/forbidden');
  return <Stocks />;
}
