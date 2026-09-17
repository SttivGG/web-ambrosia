import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { createInterface } from 'node:readline/promises';
import { PrismaService } from './database/prisma.service';
import { bootstrapOwner } from './users/bootstrap';
async function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error('Se requiere terminal interactiva para contraseña');
  process.stdout.write('Contraseña (no visible): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') {
          finish();
          reject(new Error('Cancelado'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 129) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function run() {
  let email: string, name: string, password: string;
  const automated = process.argv.includes('--test');
  if (automated) {
    if (process.env.NODE_ENV !== 'test')
      throw new Error('Modo automatizado restringido a NODE_ENV=test');
    email = process.env.AUTH_TEST_OWNER_EMAIL ?? '';
    name = process.env.AUTH_TEST_OWNER_NAME ?? '';
    password = process.env.AUTH_TEST_OWNER_PASSWORD ?? '';
  } else {
    if (!process.stdin.isTTY)
      throw new Error('Ejecutar con terminal interactiva');
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    email = await rl.question('Correo: ');
    name = await rl.question('Nombre: ');
    rl.close();
    password = await hiddenPassword();
  }
  const db = new PrismaService(
    new ConfigService({
      DATABASE_URL:
        process.env.DATABASE_URL ?? process.env.IDENTITY_DATABASE_URL,
    }),
  );
  try {
    await bootstrapOwner(db, email, name, password);
    process.stdout.write('Propietario creado.\n');
  } finally {
    await db.$disconnect();
  }
}
void run().catch(() => {
  process.stderr.write(
    'No se creó el propietario: verificar datos, conexión o OWNER existente.\n',
  );
  process.exitCode = 1;
});
