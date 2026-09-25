import { redirect } from 'next/navigation';
import { getServerSession } from '../../../../lib/auth/server';
import { Production } from '../../../../components/production/production';
export default async function Page() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  if (!session.user.permissions.includes('production.read'))
    redirect('/forbidden');
  return <Production formulas={true} />;
}
