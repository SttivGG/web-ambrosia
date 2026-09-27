'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  financeMovementListV1Schema,
  financeMovementV1Schema,
  moneyAccountListV1Schema,
  moneyAccountV1Schema,
  purchasePaymentListV1Schema,
  purchasePaymentV1Schema,
  saleListV1Schema,
  saleV1Schema,
  saleableItemListV1Schema,
  type MoneyAccountV1,
  type SaleableItemV1,
} from '@ambrosia/contracts';
import { useSession } from '../auth/session-provider';
import { financeRequest } from '../../lib/api/finance';
import {
  confirmInventoryEffect,
  notifySuccess,
} from '../../lib/ui/notifications';
import { ErrorBox, Pager, cop, date, message } from '../purchases/common';

type Tab = 'accounts' | 'movements' | 'payments' | 'sales';
const labels: Record<Tab, string> = {
  accounts: 'Cuentas',
  movements: 'Movimientos',
  payments: 'Pagos',
  sales: 'Ventas',
};
const methods = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  OTHER: 'Otro',
};
const movementNames = {
  ADDITIONAL_INCOME: 'Ingreso adicional',
  EXPENSE: 'Gasto',
  PURCHASE_PAYMENT: 'Pago de compra',
  SALE_INCOME: 'Ingreso por venta',
  SALE_REFUND: 'Devolución de venta',
};
const saleStates = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  REJECTED: 'Rechazada',
  CANCELLATION_PENDING: 'Anulación pendiente',
  CANCELLED: 'Anulada',
};
const localValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const iso = (value: string) => new Date(value).toISOString();
function useFinanceList<T>(
  path: string,
  schema: { parse(value: unknown): T },
  revision: number,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolvedKey, setResolvedKey] = useState('');
  const key = path + ':' + revision;
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      financeRequest(path, schema)
        .then((value) => {
          if (current) setData(value);
        })
        .catch((reason) => {
          if (current) setError(message(reason));
        })
        .finally(() => {
          if (current) {
            setLoading(false);
            setResolvedKey(key);
          }
        });
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path, schema, revision, key]);
  return {
    data,
    loading: loading || resolvedKey !== key,
    error: resolvedKey === key ? error : '',
  };
}
function AccountSelect({
  accounts,
  value,
  change,
}: {
  accounts: MoneyAccountV1[];
  value: string;
  change(value: string): void;
}) {
  return (
    <select
      required
      value={value}
      onChange={(event) => change(event.target.value)}
    >
      <option value="">Selecciona una cuenta</option>
      {accounts
        .filter((account) => account.active)
        .map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} — {account.name} ({cop(account.balance)})
          </option>
        ))}
    </select>
  );
}
function Accounts({
  write,
  search,
  page,
  setPage,
  revision,
  refresh,
}: {
  write: boolean;
  search: string;
  page: number;
  setPage(value: number): void;
  revision: number;
  refresh(): void;
}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(search ? { search } : {}),
  });
  const result = useFinanceList(
    'finance/accounts?' + query,
    moneyAccountListV1Schema,
    revision,
  );
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'CASH',
    description: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await financeRequest('finance/accounts', moneyAccountV1Schema, 'POST', {
        ...form,
        description: form.description || null,
      });
      setForm({ code: '', name: '', type: 'CASH', description: '' });
      refresh();
      await notifySuccess('La cuenta quedó disponible.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function active(row: MoneyAccountV1) {
    const title = row.active
      ? '¿Archivar esta cuenta?'
      : '¿Restaurar esta cuenta?';
    if (
      !(await confirmInventoryEffect(
        title,
        'Los movimientos históricos y el saldo se conservan.',
      ))
    )
      return;
    try {
      await financeRequest(
        'finance/accounts/' +
          row.id +
          '/' +
          (row.active ? 'archive' : 'restore'),
        moneyAccountV1Schema,
        'POST',
        { expectedVersion: row.version },
      );
      refresh();
    } catch (reason) {
      setError(message(reason));
    }
  }
  return (
    <div>
      {write && (
        <form className="finance-form" onSubmit={submit}>
          <h2>Nueva cuenta de dinero</h2>
          <ErrorBox text={error} />
          <label>
            Código
            <input
              required
              minLength={3}
              maxLength={40}
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Nombre
            <input
              required
              minLength={2}
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Tipo
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="CASH">Caja</option>
              <option value="BANK">Banco</option>
              <option value="OTHER">Otra</option>
            </select>
          </label>
          <label className="finance-wide">
            Descripción
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Guardando…' : 'Crear cuenta'}
          </button>
        </form>
      )}
      <ErrorBox text={result.error} />
      {result.loading ? (
        <p role="status">Cargando cuentas…</p>
      ) : (
        <>
          <ul className="finance-list">
            {result.data?.data.map((row) => (
              <li key={row.id}>
                <div>
                  <h2>{row.name}</h2>
                  <p>
                    {row.code} · {row.active ? 'Activa' : 'Archivada'} · versión{' '}
                    {row.version}
                  </p>
                  <strong>{cop(row.balance)}</strong>
                </div>
                {write && (
                  <button onClick={() => void active(row)}>
                    {row.active ? 'Archivar' : 'Restaurar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!result.data?.data.length && (
            <p className="finance-empty">No hay cuentas para esta búsqueda.</p>
          )}
          <Pager
            page={page}
            pages={result.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
    </div>
  );
}
function Movements({
  write,
  accounts,
  search,
  page,
  setPage,
  revision,
  refresh,
}: {
  write: boolean;
  accounts: MoneyAccountV1[];
  search: string;
  page: number;
  setPage(value: number): void;
  revision: number;
  refresh(): void;
}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(search ? { search } : {}),
  });
  const result = useFinanceList(
    'finance/movements?' + query,
    financeMovementListV1Schema,
    revision,
  );
  const [form, setForm] = useState({
    accountId: '',
    kind: 'ADDITIONAL_INCOME',
    amount: '',
    paymentMethod: 'CASH',
    occurredAt: localValue(),
    reference: '',
    description: '',
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const confirmed = await confirmInventoryEffect(
      form.kind === 'EXPENSE'
        ? '¿Registrar este gasto?'
        : '¿Registrar este ingreso?',
      'El movimiento confirmado afectará el saldo y no se editará ni eliminará.',
    );
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      await financeRequest(
        'finance/movements',
        financeMovementV1Schema,
        'POST',
        {
          operationId: crypto.randomUUID(),
          ...form,
          occurredAt: iso(form.occurredAt),
          reference: form.reference || null,
        },
      );
      setForm({ ...form, amount: '', reference: '', description: '' });
      refresh();
      await notifySuccess('El movimiento quedó confirmado.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {write && (
        <form className="finance-form" onSubmit={submit}>
          <h2>Registrar ingreso o gasto</h2>
          <ErrorBox text={error} />
          <label>
            Cuenta
            <AccountSelect
              accounts={accounts}
              value={form.accountId}
              change={(accountId) => setForm({ ...form, accountId })}
            />
          </label>
          <label>
            Tipo
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
            >
              <option value="ADDITIONAL_INCOME">Ingreso adicional</option>
              <option value="EXPENSE">Gasto</option>
            </select>
          </label>
          <label>
            Importe COP
            <input
              required
              inputMode="decimal"
              pattern="(0|[1-9]\d*)(\.\d{1,2})?"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label>
            Método
            <select
              value={form.paymentMethod}
              onChange={(e) =>
                setForm({ ...form, paymentMethod: e.target.value })
              }
            >
              {Object.entries(methods).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              required
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </label>
          <label>
            Referencia opcional
            <input
              maxLength={120}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </label>
          <label className="finance-wide">
            Descripción
            <textarea
              required
              minLength={3}
              maxLength={500}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Registrando…' : 'Confirmar movimiento'}
          </button>
        </form>
      )}
      <ErrorBox text={result.error} />
      {result.loading ? (
        <p role="status">Cargando movimientos…</p>
      ) : (
        <>
          <ul className="finance-list">
            {result.data?.data.map((row) => (
              <li key={row.id}>
                <div>
                  <h2>{movementNames[row.kind]}</h2>
                  <p>
                    {row.account.name} · {date(row.occurredAt)} ·{' '}
                    {methods[row.paymentMethod]}
                  </p>
                  <p>{row.description}</p>
                </div>
                <strong>
                  {row.direction === 'CREDIT' ? '+' : '−'} {cop(row.amount)}
                </strong>
              </li>
            ))}
          </ul>
          {!result.data?.data.length && (
            <p className="finance-empty">No hay movimientos confirmados.</p>
          )}
          <Pager
            page={page}
            pages={result.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
    </div>
  );
}
function Payments({
  write,
  accounts,
  search,
  page,
  setPage,
  revision,
  refresh,
}: {
  write: boolean;
  accounts: MoneyAccountV1[];
  search: string;
  page: number;
  setPage(value: number): void;
  revision: number;
  refresh(): void;
}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(search ? { purchaseId: search } : {}),
  });
  const result = useFinanceList(
    'finance/payments?' + query,
    purchasePaymentListV1Schema,
    revision,
  );
  const [form, setForm] = useState({
    purchaseId: '',
    accountId: '',
    amount: '',
    paymentMethod: 'BANK_TRANSFER',
    occurredAt: localValue(),
    reference: '',
    description: '',
  });
  const [notes, setNotes] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !(await confirmInventoryEffect(
        '¿Registrar este pago?',
        'Finance verificará la compra en Inventory y rechazará cualquier importe que exceda su total pendiente.',
      ))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await financeRequest(
        'finance/payments',
        purchasePaymentV1Schema,
        'POST',
        {
          operationId: crypto.randomUUID(),
          ...form,
          occurredAt: iso(form.occurredAt),
          reference: form.reference || null,
          description: form.description || null,
        },
      );
      setForm({ ...form, amount: '', reference: '', description: '' });
      refresh();
      await notifySuccess('El pago y su movimiento quedaron confirmados.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, kind: 'check' | 'regularize') {
    setError('');
    try {
      await financeRequest(
        'finance/payments/' + id + '/' + kind,
        purchasePaymentV1Schema,
        'POST',
        kind === 'regularize' ? { note: notes[id] ?? '' } : undefined,
      );
      refresh();
    } catch (reason) {
      setError(message(reason));
    }
  }
  return (
    <div>
      {write && (
        <form className="finance-form" onSubmit={submit}>
          <h2>Pago de compra recibida</h2>
          <ErrorBox text={error} />
          <label>
            Identificador de compra
            <input
              required
              pattern="[0-9a-fA-F-]{36}"
              value={form.purchaseId}
              onChange={(e) => setForm({ ...form, purchaseId: e.target.value })}
            />
          </label>
          <label>
            Cuenta
            <AccountSelect
              accounts={accounts}
              value={form.accountId}
              change={(accountId) => setForm({ ...form, accountId })}
            />
          </label>
          <label>
            Importe COP
            <input
              required
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label>
            Método
            <select
              value={form.paymentMethod}
              onChange={(e) =>
                setForm({ ...form, paymentMethod: e.target.value })
              }
            >
              {Object.entries(methods).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              required
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </label>
          <label>
            Referencia opcional
            <input
              maxLength={120}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </label>
          <label className="finance-wide">
            Descripción opcional
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <button disabled={busy}>
            {busy ? 'Verificando…' : 'Registrar pago parcial o total'}
          </button>
        </form>
      )}
      <ErrorBox text={result.error || error} />
      {result.loading ? (
        <p role="status">Cargando pagos y comprobando discrepancias…</p>
      ) : (
        <>
          <ul className="finance-list">
            {result.data?.data.map((row) => (
              <li key={row.id}>
                <div>
                  <h2>Compra {row.purchaseSnapshot.reference}</h2>
                  <p>
                    {row.purchaseSnapshot.supplier.name} ·{' '}
                    {date(row.occurredAt)}
                  </p>
                  <strong>{cop(row.amount)}</strong>
                  {row.discrepancy && (
                    <div role="alert" className="finance-warning">
                      <strong>Requiere regularización</strong>
                      <p>{row.discrepancyReason}</p>
                      {row.regularizedAt && (
                        <p>Registrada: {row.regularizationNote}</p>
                      )}
                    </div>
                  )}
                </div>
                {write && (
                  <div className="finance-actions">
                    <button onClick={() => void action(row.id, 'check')}>
                      Comprobar compra
                    </button>
                    {row.discrepancy && !row.regularizedAt && (
                      <>
                        <label>
                          Nota de regularización
                          <input
                            minLength={3}
                            maxLength={500}
                            value={notes[row.id] ?? ''}
                            onChange={(e) =>
                              setNotes({ ...notes, [row.id]: e.target.value })
                            }
                          />
                        </label>
                        <button
                          disabled={(notes[row.id] ?? '').trim().length < 3}
                          onClick={() => void action(row.id, 'regularize')}
                        >
                          Registrar regularización
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!result.data?.data.length && (
            <p className="finance-empty">No hay pagos registrados.</p>
          )}
          <Pager
            page={page}
            pages={result.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
    </div>
  );
}
function Sales({
  write,
  accounts,
  search,
  page,
  setPage,
  revision,
  refresh,
}: {
  write: boolean;
  accounts: MoneyAccountV1[];
  search: string;
  page: number;
  setPage(value: number): void;
  revision: number;
  refresh(): void;
}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(search ? { search } : {}),
  });
  const result = useFinanceList(
    'finance/sales?' + query,
    saleListV1Schema,
    revision,
  );
  const items = useFinanceList(
    'finance/saleable-items?page=1&pageSize=100',
    saleableItemListV1Schema,
    revision,
  );
  const [form, setForm] = useState({
    accountId: '',
    paymentMethod: 'CASH',
    occurredAt: localValue(),
    reference: '',
    description: '',
  });
  const [lines, setLines] = useState([
    { itemId: '', quantity: '1', unitPrice: '' },
  ]);
  const [reasons, setReasons] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const available: SaleableItemV1[] = items.data?.data ?? [];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !(await confirmInventoryEffect(
        '¿Confirmar esta venta?',
        'Inventory descontará existencias primero. Finance solo registrará el ingreso después de recibir la confirmación.',
      ))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await financeRequest('finance/sales', saleV1Schema, 'POST', {
        operationId: crypto.randomUUID(),
        ...form,
        occurredAt: iso(form.occurredAt),
        reference: form.reference || null,
        description: form.description || null,
        lines,
      });
      setLines([{ itemId: '', quantity: '1', unitPrice: '' }]);
      setForm({ ...form, reference: '', description: '' });
      refresh();
      await notifySuccess('La venta fue procesada; consulta su estado.');
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }
  async function saleAction(
    id: string,
    version: number,
    kind: 'cancel' | 'reconcile',
  ) {
    if (
      kind === 'cancel' &&
      !(await confirmInventoryEffect(
        '¿Anular esta venta?',
        'Se registrarán una devolución de inventario y una devolución financiera, sin borrar los hechos originales.',
      ))
    )
      return;
    setError('');
    try {
      await financeRequest(
        'finance/sales/' + id + '/' + kind,
        saleV1Schema,
        'POST',
        kind === 'cancel'
          ? {
              operationId: crypto.randomUUID(),
              expectedVersion: version,
              reason: reasons[id] ?? '',
            }
          : undefined,
      );
      refresh();
    } catch (reason) {
      setError(message(reason));
    }
  }
  return (
    <div>
      {write && (
        <form className="finance-form" onSubmit={submit}>
          <h2>Nueva venta manual</h2>
          <p className="finance-wide">
            El servidor calcula subtotales y total. Solo se aceptan productos
            terminados por unidad.
          </p>
          <ErrorBox text={error || items.error} />
          <label>
            Cuenta de cobro
            <AccountSelect
              accounts={accounts}
              value={form.accountId}
              change={(accountId) => setForm({ ...form, accountId })}
            />
          </label>
          <label>
            Método
            <select
              value={form.paymentMethod}
              onChange={(e) =>
                setForm({ ...form, paymentMethod: e.target.value })
              }
            >
              {Object.entries(methods).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Fecha
            <input
              required
              type="datetime-local"
              value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })}
            />
          </label>
          <label>
            Referencia opcional
            <input
              maxLength={120}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </label>
          <label className="finance-wide">
            Descripción opcional
            <textarea
              maxLength={500}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>
          <fieldset className="finance-wide">
            <legend>Artículos vendidos</legend>
            {lines.map((line, index) => (
              <div className="sale-line" key={index}>
                <label>
                  Artículo
                  <select
                    required
                    value={line.itemId}
                    onChange={(e) =>
                      setLines(
                        lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, itemId: e.target.value }
                            : candidate,
                        ),
                      )
                    }
                  >
                    <option value="">Selecciona</option>
                    {available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sku} — {item.name} · disponibles{' '}
                        {item.availableQuantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Cantidad entera
                  <input
                    required
                    inputMode="numeric"
                    pattern="[1-9]\d*"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, quantity: e.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Precio unitario COP
                  <input
                    required
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) =>
                      setLines(
                        lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, unitPrice: e.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setLines(lines.filter((_, i) => i !== index))
                    }
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setLines([
                  ...lines,
                  { itemId: '', quantity: '1', unitPrice: '' },
                ])
              }
            >
              Añadir artículo
            </button>
          </fieldset>
          <button disabled={busy || items.loading}>
            {busy ? 'Procesando…' : 'Confirmar venta'}
          </button>
        </form>
      )}
      <ErrorBox text={result.error || error} />
      {result.loading ? (
        <p role="status">Cargando ventas…</p>
      ) : (
        <>
          <ul className="finance-list">
            {result.data?.data.map((row) => (
              <li key={row.id}>
                <div>
                  <h2>{row.reference || 'Venta ' + row.id.slice(0, 8)}</h2>
                  <p>
                    <span className={'finance-state state-' + row.status}>
                      {saleStates[row.status]}
                    </span>{' '}
                    · {date(row.occurredAt)} · versión {row.version}
                  </p>
                  <p>
                    {row.lines
                      .map((line) => line.name + ' × ' + line.quantity)
                      .join(', ')}
                  </p>
                  <strong>{cop(row.total)}</strong>
                  {row.costOfGoodsSold !== null && (
                    <div>
                      <p>COGS: {cop(row.costOfGoodsSold)}</p>
                      <p>
                        <strong>Margen bruto: {cop(row.grossMargin!)}</strong> ·{' '}
                        {row.grossMarginPercent}%
                      </p>
                    </div>
                  )}
                  {row.operations.map(
                    (operation) =>
                      operation.status === 'PENDING' && (
                        <p role="status" key={operation.id}>
                          Operación{' '}
                          {operation.kind === 'CONFIRM'
                            ? 'de confirmación'
                            : 'de anulación'}{' '}
                          pendiente:{' '}
                          {operation.error || 'en reconciliación automática'}
                        </p>
                      ),
                  )}
                </div>
                {write && (
                  <div className="finance-actions">
                    {row.operations.some(
                      (operation) => operation.status === 'PENDING',
                    ) && (
                      <button
                        onClick={() =>
                          void saleAction(row.id, row.version, 'reconcile')
                        }
                      >
                        Reconciliar ahora
                      </button>
                    )}
                    {row.status === 'CONFIRMED' && (
                      <>
                        <label>
                          Motivo de anulación
                          <input
                            minLength={3}
                            maxLength={500}
                            value={reasons[row.id] ?? ''}
                            onChange={(e) =>
                              setReasons({
                                ...reasons,
                                [row.id]: e.target.value,
                              })
                            }
                          />
                        </label>
                        <button
                          disabled={(reasons[row.id] ?? '').trim().length < 3}
                          onClick={() =>
                            void saleAction(row.id, row.version, 'cancel')
                          }
                        >
                          Anular venta
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!result.data?.data.length && (
            <p className="finance-empty">No hay ventas para estos filtros.</p>
          )}
          <Pager
            page={page}
            pages={result.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
    </div>
  );
}
export function Finance() {
  const { permissions } = useSession();
  const write = permissions.includes('finance.write');
  const [tab, setTab] = useState<Tab>('accounts'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const accountsResult = useFinanceList(
    'finance/accounts?page=1&pageSize=100&active=true',
    moneyAccountListV1Schema,
    revision,
  );
  const accounts = accountsResult.data?.data ?? [];
  const refresh = () => setRevision((value) => value + 1);
  const shared = useMemo(
    () => ({ write, search, page, setPage, revision, refresh }),
    [write, search, page, revision],
  );
  return (
    <section className="finance">
      <div className="page-intro">
        <p className="eyebrow">ADMINISTRACIÓN</p>
        <h1>Finanzas</h1>
        <p>
          Cuentas, movimientos confirmados en COP, pagos de compras y ventas
          manuales reconciliables.
        </p>
      </div>
      <div
        className="finance-tabs"
        role="tablist"
        aria-label="Secciones de finanzas"
      >
        {(Object.keys(labels) as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setSearch('');
              setPage(1);
            }}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <div className="finance-toolbar">
        <label>
          Buscar en {labels[tab].toLowerCase()}
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={
              tab === 'payments'
                ? 'UUID de compra'
                : 'Referencia, nombre o código'
            }
          />
        </label>
        <button onClick={refresh}>Actualizar</button>
      </div>
      <ErrorBox text={accountsResult.error} />
      {tab === 'accounts' && <Accounts {...shared} />}
      {tab === 'movements' && <Movements {...shared} accounts={accounts} />}
      {tab === 'payments' && <Payments {...shared} accounts={accounts} />}
      {tab === 'sales' && <Sales {...shared} accounts={accounts} />}
    </section>
  );
}
