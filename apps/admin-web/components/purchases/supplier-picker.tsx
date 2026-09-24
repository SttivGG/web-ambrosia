'use client';
import { useState } from 'react';
import { supplierListV1Schema, type SupplierV1 } from '@ambrosia/contracts';
import { Pager, useList } from './common';
export function SupplierPicker({
  selected,
  change,
  active = true,
}: {
  selected: SupplierV1 | null;
  change(v: SupplierV1 | null): void;
  active?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const result = useList(
    'suppliers?' +
      new URLSearchParams({
        search,
        page: String(page),
        pageSize: '5',
        ...(active ? { active: 'true' } : {}),
      }),
    supplierListV1Schema,
    retry,
  );
  return (
    <fieldset className="supplier-selector">
      <legend>Proveedor</legend>
      {selected && (
        <p>
          Seleccionado: <strong>{selected.name}</strong>{' '}
          <button type="button" onClick={() => change(null)}>
            Quitar proveedor
          </button>
        </p>
      )}
      <label>
        Buscar proveedor
        <input
          maxLength={120}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {result.loading ? (
        <p role="status">Buscando proveedores…</p>
      ) : result.error ? (
        <p role="alert">
          {result.error}
          <button type="button" onClick={() => setRetry(retry + 1)}>
            Reintentar proveedores
          </button>
        </p>
      ) : (
        <ul>
          {result.data?.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-pressed={selected?.id === s.id}
                onClick={() => change(s)}
              >
                {s.code} — {s.name}
              </button>
            </li>
          ))}
          {!result.data?.data.length && (
            <li>No hay proveedores para esta búsqueda.</li>
          )}
        </ul>
      )}
      <Pager
        page={page}
        pages={result.data?.pagination.totalPages ?? 0}
        change={setPage}
        disabled={result.loading}
      />
    </fieldset>
  );
}
