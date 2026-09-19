import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
// Test runner only. Code executes within Identity with its own Prisma client and database.
export function fixtureUser(action, email, password, role = 'OWNER') {
  assert.match(email, /^fase(?:1[abc]|2a)\.[a-z0-9.]+@ambrosia\.test$/);
  assert.ok(['create', 'delete'].includes(action));
  assert.ok(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].includes(role));
  const code = `const {PrismaService}=require('./dist/database/prisma.service');const {ConfigService}=require('@nestjs/config');const {hashPassword}=require('./dist/auth/password');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',async()=>{const p=JSON.parse(input);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{if(p.action==='create'){await db.user.create({data:{email:p.email,displayName:'Propietaria Fase 1B',role:p.role,passwordHash:await hashPassword(p.password)}});}else{await db.$transaction(async tx=>{const user=await tx.user.findUnique({where:{email:p.email}});if(user){await tx.authAuditLog.deleteMany({where:{userId:user.id}});await tx.refreshSession.deleteMany({where:{userId:user.id}});await tx.user.delete({where:{id:user.id}});}});if(await db.user.count({where:{email:p.email}}))throw Error();}}catch{process.exitCode=1;}finally{await db.$disconnect();}});`;
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'infrastructure/docker-compose.yml',
      'exec',
      '-T',
      'identity-service',
      'node',
      '-e',
      code,
    ],
    {
      encoding: 'utf8',
      input: JSON.stringify({ action, email, password, role }),
    },
  );
  assert.equal(
    result.status,
    0,
    'Fixture Identity debe completarse sin exponer credenciales',
  );
}
