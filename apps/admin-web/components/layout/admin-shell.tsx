'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '../auth/session-provider';
import { UserMenu } from '../auth/user-menu';
const roleNames = {
  OWNER: 'Propietario',
  ADMIN: 'Administrador',
  OPERATOR: 'Operador',
  VIEWER: 'Consulta',
};
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, status, permissions } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('sessionChecked')) {
      url.searchParams.delete('sessionChecked');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="admin-header">
        <Link className="brand" href="/dashboard">
          ambrosia.
        </Link>
        <div className="user-info">
          <strong>{user?.displayName}</strong>
          <span>
            {user && roleNames[user.role]} ·{' '}
            {status === 'authenticated'
              ? 'Sesión activa'
              : 'Verificando sesión'}
          </span>
        </div>
        <UserMenu />
      </header>
      <div className="admin-grid">
        <aside className="sidebar">
          <button
            className="mobile-menu"
            aria-expanded={open}
            aria-controls="navigation"
            onClick={() => setOpen(!open)}
          >
            Menú {open ? '−' : '+'}
          </button>
          <nav
            id="navigation"
            aria-label="Navegación principal"
            className={open ? 'nav-open' : ''}
          >
            <Link
              href="/dashboard"
              aria-current={pathname === '/dashboard' ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              Inicio
            </Link>
            {permissions.includes('inventory.read') && (
              <Link
                href="/inventario/catalogo"
                aria-current={
                  pathname === '/inventario/catalogo' ? 'page' : undefined
                }
                onClick={() => setOpen(false)}
              >
                Inventario <small>Catálogo</small>
              </Link>
            )}
            {['Compras', 'Producción', 'Finanzas', 'Informes'].map((name) => (
              <span className="nav-coming" key={name}>
                {name}
                <small>Próximamente</small>
              </span>
            ))}
          </nav>
          <p className="sidebar-note">Sistema de control de producción</p>
        </aside>
        <main id="contenido" className="dashboard-main">
          {children}
        </main>
      </div>
    </>
  );
}
