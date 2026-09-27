import { redirect } from 'next/navigation';
import { getServerSession } from '../../../lib/auth/server';
import { Finance } from '../../../components/finance/finance';
export default async function Page() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('finance.read'))
    redirect('/forbidden');
  return <Finance />;
}
