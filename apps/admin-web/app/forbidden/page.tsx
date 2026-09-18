import Link from 'next/link';
export default function Forbidden() {
  return (
    <main id="contenido" className="auth-card">
      <h1>Acceso no permitido</h1>
      <p>No tienes acceso a esta sección.</p>
      <Link href="/dashboard">Volver al inicio</Link>
    </main>
  );
}
