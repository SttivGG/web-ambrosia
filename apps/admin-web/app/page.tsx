import Link from 'next/link';
import { ServiceStatus } from './service-status';
export default function Home() {
  return (
    <>
      <header className="border-b border-stone-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Link className="brand" href="/">
            ambrosia<span className="brand-dot">.</span>
          </Link>
          <span className="text-sm text-stone-600">Panel administrativo</span>
        </div>
      </header>
      <main id="contenido" className="mx-auto max-w-6xl px-6 py-12 md:py-20">
        <p className="eyebrow">AMBROSIA · PRODUCCIÓN ARTESANAL</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-tight tracking-tight md:text-6xl">
          Sistema de control
          <br className="hidden md:block" /> de producción
        </h1>
        <p className="mt-6 max-w-xl text-lg text-stone-600">
          Un lugar para acompañar cada etapa. Consulta la disponibilidad de los
          servicios de Ambrosia.
        </p>
        <ServiceStatus />
        <footer className="mt-16 border-t border-stone-200 pt-6 text-sm text-stone-600">
          Ambrosia · Fundación técnica{' '}
          <span className="float-right">Fase 0</span>
        </footer>
      </main>
    </>
  );
}
