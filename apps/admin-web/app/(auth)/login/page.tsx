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
        <h2>
          El cuidado está
          <br />
          en cada <em>detalle.</em>
        </h2>
        <p className="login-intro">
          Tu catálogo, tus proveedores y tu equipo.
          <br />
          Un lugar para organizar el día a día de Ambrosia.
        </p>
        <div className="login-note">
          <span className="eyebrow">HECHO CON CUIDADO</span>
          <p>
            De los buenos ingredientes
            <br />a una mejor organización.
          </p>
          <span>Sistema de control de producción</span>
        </div>
      </section>
      <section className="auth-card">
        <LoginForm returnTo={safeReturnTo(query.returnTo)} notice={notice} />
      </section>
    </main>
  );
}
