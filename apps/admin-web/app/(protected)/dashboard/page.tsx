import { ServiceStatus } from '../../service-status';
import { getServerSession } from '../../../lib/auth/server';
export default async function Dashboard() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  return (
    <>
      <p className="eyebrow">PANEL ADMINISTRATIVO</p>
      <h1>Inicio</h1>
      <p className="muted">
        Consulta la disponibilidad de los servicios de Ambrosia.
      </p>
      <ServiceStatus />
    </>
  );
}
