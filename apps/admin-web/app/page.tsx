import { redirect } from 'next/navigation';
import { getServerSession } from '../lib/auth/server';
export default async function Home() {
  const session = await getServerSession();
  redirect(session.status === 'anonymous' ? '/login' : '/dashboard');
}
