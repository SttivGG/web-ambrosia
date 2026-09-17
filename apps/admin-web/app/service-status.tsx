'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { checkService, services, type Status } from './status';
const labels: Record<Status, string> = {
  checking: 'Verificando',
  available: 'Disponible',
  unavailable: 'No disponible',
};
export function ServiceStatus() {
  const [statuses, setStatuses] = useState<Status[]>([
    'checking',
    'checking',
    'checking',
  ]);
  const [checkedAt, setCheckedAt] = useState<string>();
  const [busy, setBusy] = useState(true);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setStatuses(services.map(() => 'checking'));
    const next = await Promise.all(
      services.map((s) => checkService(s.id, s.service)),
    );
    setStatuses(next);
    setCheckedAt(new Date().toISOString());
    setBusy(false);
    running.current = false;
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <section className="mt-14" aria-labelledby="services-title">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h2 id="services-title" className="text-xl font-semibold">
          Estado de los servicios
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="refresh"
        >
          {busy ? 'Verificando…' : 'Actualizar estado'}
          <span aria-hidden="true"> ↻</span>
        </button>
      </div>
      <div
        className="grid gap-5 md:grid-cols-3"
        aria-live="polite"
        aria-busy={busy}
      >
        {services.map((s, i) => (
          <article key={s.id} className="service-card">
            <span className="text-sm text-stone-500" aria-hidden="true">
              0{i + 1}
            </span>
            <h3 className="mt-7 text-2xl font-medium">{s.name}</h3>
            <p className="mt-3 min-h-12 text-stone-600">{s.description}</p>
            <div className={'status status-' + statuses[i]}>
              <span className="status-dot" aria-hidden="true" />
              {labels[statuses[i] ?? 'checking']}
            </div>
          </article>
        ))}
      </div>
      <p className="mt-6 text-sm text-stone-600" role="status">
        {checkedAt
          ? 'Última comprobación: ' +
            new Intl.DateTimeFormat('es-CO', {
              dateStyle: 'medium',
              timeStyle: 'medium',
              timeZone: 'America/Bogota',
            }).format(new Date(checkedAt)) +
            ' (Colombia)'
          : 'Comprobando disponibilidad…'}
      </p>
    </section>
  );
}
