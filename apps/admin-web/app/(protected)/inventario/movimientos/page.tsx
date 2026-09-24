import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Movements } from '../../../../components/purchases/stock';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string }>;
}) {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('inventory.read'))
    redirect('/forbidden');
  return <Movements initialItemId={(await searchParams).itemId ?? ''} />;
}
