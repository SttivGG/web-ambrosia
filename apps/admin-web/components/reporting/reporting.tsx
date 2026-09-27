'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  type ReportHealthV1,
  type ReportInventoryListV1,
} from '@ambrosia/contracts';
import { useSession } from '../auth/session-provider';
import { reportingApi } from '../../lib/api/reporting';

export function ReportingInfrastructure() {
  const { permissions } = useSession();
  const allowed = permissions.includes('reports.read');
  const [state, setState] = useState<
    | { status: 'loading' }
    | {
        status: 'ready';
        health: ReportHealthV1;
        inventory: ReportInventoryListV1;
      }
    | { status: 'empty'; health: ReportHealthV1 }
    | { status: 'forbidden' }
    | { status: 'error' }
  >({ status: 'loading' });
  const load = useCallback(async () => {
    if (!allowed) {
      setState({ status: 'forbidden' });
      return;
    }
    setState({ status: 'loading' });
    try {
      const [health, inventory] = await Promise.all([
        reportingApi.health(),
        reportingApi.inventory(),
      ]);
      setState(
        inventory.data.length
          ? { status: 'ready', health, inventory }
          : { status: 'empty', health },
      );
    } catch (error) {
      setState({
        status:
          error instanceof Error && error.message === 'forbidden'
            ? 'forbidden'
            : 'error',
      });
    }
  }, [allowed]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <section className="reports" aria-labelledby="reports-title">
      <header className="page-intro">
        <p className="eyebrow">INFRAESTRUCTURA · FASE 8A</p>
        <h1 id="reports-title">Reportes</h1>
        <p>
          Estado de las proyecciones derivadas. Los dominios operativos siguen
          siendo la fuente de verdad.
        </p>
      </header>
      {state.status === 'loading' && (
        <div className="reports-state" role="status" aria-live="polite">
          <span className="reports-loader" aria-hidden="true" />
          <div>
            <h2>Consultando Reporting</h2>
            <p>Validamos el servicio y sus proyecciones.</p>
          </div>
        </div>
      )}
      {state.status === 'forbidden' && (
        <div className="reports-state" role="alert">
          <p className="eyebrow">ACCESO RESTRINGIDO</p>
          <h2>No tienes permiso para consultar reportes</h2>
          <p>Solicita el permiso reports.read a un administrador.</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="reports-state" role="alert">
          <p className="eyebrow">SERVICIO NO DISPONIBLE</p>
          <h2>No pudimos consultar Reporting</h2>
          <p>Las operaciones de inventario, producción y finanzas continúan.</p>
          <button type="button" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      )}
      {state.status === 'empty' && (
        <div className="reports-state">
          <p className="eyebrow">SERVICIO ACTIVO</p>
          <h2>Aún no hay datos proyectados</h2>
          <p>
            Reporting responde correctamente. Los datos aparecerán después de
            publicar o reconciliar snapshots operativos.
          </p>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          <div className="reports-summary" aria-label="Conteo de proyecciones">
            {[
              ['Artículos', state.health.projections.inventoryItems],
              ['Movimientos', state.health.projections.inventoryMovements],
              ['Lotes', state.health.projections.productionBatches],
              ['Márgenes', state.health.projections.saleMargins],
            ].map(([label, value]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <section
            className="reports-preview"
            aria-labelledby="inventory-title"
          >
            <div>
              <p className="eyebrow">VISTA DE INFRAESTRUCTURA</p>
              <h2 id="inventory-title">Inventario proyectado</h2>
            </div>
            <ul>
              {state.inventory.data.map((item) => (
                <li key={item.itemId}>
                  <div>
                    <strong>{item.itemNameSnapshot}</strong>
                    <span>{item.unit}</span>
                  </div>
                  <div>
                    <strong>{item.onHand}</strong>
                    <span>
                      {item.valuationStatus === 'UNVALUED'
                        ? 'Sin valorar'
                        : item.valuationStatus === 'EMPTY'
                          ? 'Sin existencias'
                          : 'Valorado'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </section>
  );
}
