import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Ambrosia | Estado del sistema',
  description: 'Sistema de control de producción de Ambrosia',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-CO">
      <body>{children}</body>
    </html>
  );
}
