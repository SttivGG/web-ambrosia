import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { categorySlug, normalizeName } from './domain';
import { randomUUID } from 'node:crypto';
export async function seedCatalog(db: Pick<PrismaService, 'category'>) {
  for (const name of [
    'Leche y cultivos',
    'Ingredientes',
    'Empaques',
    'Productos terminados',
    'Subproductos',
    'Suministros',
  ]) {
    const id = randomUUID();
    await db.category.upsert({
      where: { normalizedName: normalizeName(name) },
      update: {},
      create: {
        id,
        name,
        normalizedName: normalizeName(name),
        slug: categorySlug(name, id),
      },
    });
  }
}
async function main() {
  const db = new PrismaService(
    new ConfigService({
      DATABASE_URL:
        process.env.DATABASE_URL ?? process.env.INVENTORY_DATABASE_URL,
    }),
  );
  try {
    await seedCatalog(db);
    console.log('Categorías iniciales verificadas.');
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error('No se pudo completar el seed de categorías.');
    process.exitCode = 1;
  });
