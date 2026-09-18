import { redirect } from 'next/navigation';
import { getServerSession } from '../../lib/auth/server';
import { SessionGate } from '../../components/auth/session-gate';
import { SessionProvider } from '../../components/auth/session-provider';
import { AdminShell } from '../../components/layout/admin-shell';
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (session.status === 'anonymous') redirect('/login?returnTo=%2Fdashboard');
  if (session.status !== 'authenticated')
    return <SessionGate recover={session.status === 'expired'} />;
  return (
    <SessionProvider initialUser={session.user}>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
