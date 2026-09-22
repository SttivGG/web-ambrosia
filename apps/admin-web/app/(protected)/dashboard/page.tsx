import Link from 'next/link';
import { ServiceStatus } from '../../service-status';
import { getServerSession } from '../../../lib/auth/server';
export default async function Dashboard() {
  const session = await getServerSession();
  if (session.status !== 'authenticated') return null;
  return (
    <>
      <div className="dashboard-intro">
        <div>
          <p className="eyebrow">TU ESPACIO DE TRABAJO</p>
          <h1>Inicio</h1>
          <p className="muted">Todo en su lugar, para cuidar cada detalle.</p>
        </div>
        <span className="workspace-caption">
          Ambrosia / Panel administrativo
        </span>
      </div>
      {session.user.permissions.includes('inventory.read') && (
        <section
          className="workspace-overview"
          aria-labelledby="workspace-title"
        >
          <div>
            <p className="eyebrow">INVENTARIO</p>
            <h2 id="workspace-title">
              Lo que necesitas,
              <br />
              <em>a mano.</em>
            </h2>
            <p>
              Organiza los artículos de tu catálogo y consulta quién los
              suministra.
            </p>
          </div>
          <div className="workspace-links">
            <Link href="/inventario/catalogo">
              <span>01 / Catálogo</span>
              <strong>
                Artículos y categorías <span aria-hidden="true">↗</span>
              </strong>
            </Link>
            <Link href="/inventario/proveedores">
              <span>02 / Proveedores</span>
              <strong>
                Contactos y suministros <span aria-hidden="true">↗</span>
              </strong>
            </Link>
          </div>
        </section>
      )}
      <ServiceStatus />
    </>
  );
}
