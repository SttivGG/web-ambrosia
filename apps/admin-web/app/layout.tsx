import type { Metadata } from 'next';
import 'sweetalert2/dist/sweetalert2.min.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'Ambrosia | Panel administrativo',
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
