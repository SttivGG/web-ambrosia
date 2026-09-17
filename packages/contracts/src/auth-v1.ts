import { z } from 'zod';
export const PERMISSIONS_V1 = [
  'users.manage',
  'inventory.read',
  'inventory.write',
  'production.read',
  'production.write',
  'finance.read',
  'finance.write',
  'reports.read',
] as const;
export const ROLES_V1 = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type RoleV1 = (typeof ROLES_V1)[number];
export type PermissionV1 = (typeof PERMISSIONS_V1)[number];
export const userClaimsV1Schema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().uuid(),
  jti: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  typ: z.literal('user'),
  sid: z.string().uuid(),
  role: z.enum(ROLES_V1),
  permissions: z.array(z.enum(PERMISSIONS_V1)),
});
export type UserClaimsV1 = z.infer<typeof userClaimsV1Schema>;
export interface PublicUserV1 {
  id: string;
  email: string;
  displayName: string;
  role: RoleV1;
  permissions: PermissionV1[];
}
