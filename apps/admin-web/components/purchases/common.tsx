'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { purchaseRequest } from '../../lib/api/purchases';
export const states = {
  DRAFT: 'Borrador',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
};
export const types = {
  PURCHASE_IN: 'Entrada por compra',
  ADJUSTMENT_IN: 'Ajuste positivo',
  ADJUSTMENT_OUT: 'Ajuste negativo',
  REVERSAL: 'Reversión',
  PRODUCTION_OUT: 'Consumo de producción',
  PRODUCTION_RETURN: 'Devolución de producción',
};
export const units = { UNIT: 'unidades', GRAM: 'g', MILLILITER: 'ml' };
export const date = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
export const day = (value: string) =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
export const cop = (value: string) => {
  const [whole, decimal = '00'] = value.split('.');
  return (
    '$ ' +
    whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '.') +
    ',' +
    decimal.padEnd(2, '0') +
    ' COP'
  );
};
export const message = (e: unknown) =>
  e instanceof Error ? e.message : 'No se pudo completar la operación.';
export function preview(lines: { quantity: string; unitCost: string }[]) {
  try {
    const scale = (v: string, n: number) => {
      const [a, b = ''] = v.split('.');
      return BigInt(a!) * 10n ** BigInt(n) + BigInt(b.padEnd(n, '0'));
    };
    let total = 0n;
    for (const l of lines) {
      if (
        !/^(0|[1-9]\d{0,13})(\.\d{1,10})?$/.test(l.quantity) ||
        !/^(0|[1-9]\d{0,21})(\.\d{1,2})?$/.test(l.unitCost)
      )
        return null;
      total +=
        (scale(l.quantity, 10) * scale(l.unitCost, 2) + 5000000000n) /
        10000000000n;
    }
    return (
      (total / 100n).toString() +
      '.' +
      (total % 100n).toString().padStart(2, '0')
    );
  } catch {
    return null;
  }
}
export function useList<T>(
  path: string,
  schema: { parse(value: unknown): T },
  revision = 0,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [resolvedKey, setResolvedKey] = useState('');
  const key = path + ':' + revision;
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      purchaseRequest(path, schema)
        .then((v) => {
          if (current) setData(v);
        })
        .catch((e) => {
          if (current) setError(message(e));
        })
        .finally(() => {
          if (current) {
            setLoading(false);
            setResolvedKey(key);
          }
        });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path, schema, revision, key]);
  return {
    data,
    error: resolvedKey === key ? error : '',
    loading: loading || resolvedKey !== key,
  };
}
export function Pager({
  page,
  pages,
  change,
  disabled = false,
}: {
  page: number;
  pages: number;
  change(p: number): void;
  disabled?: boolean;
}) {
  return (
    <div className="catalog-pagination">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => change(page - 1)}
      >
        Anterior
      </button>
      <span>
        Página {page} de {Math.max(1, pages)}
      </span>
      <button
        type="button"
        disabled={disabled || page >= pages}
        onClick={() => change(page + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="catalog-dialog supplier-dialog purchases"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
export function ErrorBox({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (text) ref.current?.focus();
  }, [text]);
  return text ? (
    <p role="alert" tabIndex={-1} ref={ref}>
      {text}
    </p>
  ) : null;
}
