import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? process.env.FINANCE_REPORTING_DATABASE_URL,
  },
});
