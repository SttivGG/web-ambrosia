import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Purchases } from '../../../../components/purchases/purchases';
export default async function Page() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('purchases.read'))
    redirect('/forbidden');
  return <Purchases />;
}
