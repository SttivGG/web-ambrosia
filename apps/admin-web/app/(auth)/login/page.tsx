import { redirect } from 'next/navigation';
import { getServerSession } from '../../../lib/auth/server';
import { safeReturnTo } from '../../../lib/auth/return-to';
import { LoginForm } from '../../../components/auth/login-form';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession();
  if (session.status === 'authenticated') redirect('/dashboard');
  const query = await searchParams;
  const notice =
    query.reason === 'password-changed'
      ? 'Contraseña actualizada. Inicia sesión nuevamente.'
      : query.reason === 'expired'
        ? 'Tu sesión ha vencido. Inicia sesión nuevamente.'
        : session.status === 'unavailable'
          ? 'El servicio de acceso no está disponible temporalmente.'
          : undefined;
  return (
    <main id="contenido" className="login-layout">
      <section className="login-brand">
        <p className="brand">ambrosia.</p>
        <p className="eyebrow">PRODUCCIÓN ARTESANAL</p>
        <h2>Sistema de control de producción</h2>
        <p>Todo listo para continuar con tu día.</p>
      </section>
      <section className="auth-card">
        <LoginForm returnTo={safeReturnTo(query.returnTo)} notice={notice} />
      </section>
    </main>
  );
}
