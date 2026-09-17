import {
  PERMISSIONS_V1,
  type RoleV1,
  type PermissionV1,
  type PublicUserV1,
} from '@ambrosia/contracts';
export const ROLE_PERMISSIONS: Record<RoleV1, readonly PermissionV1[]> = {
  OWNER: PERMISSIONS_V1,
  ADMIN: PERMISSIONS_V1.filter((p) => p !== 'users.manage'),
  OPERATOR: [
    'inventory.read',
    'inventory.write',
    'production.read',
    'production.write',
    'reports.read',
  ],
  VIEWER: ['inventory.read', 'production.read', 'finance.read', 'reports.read'],
};
export function publicUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: RoleV1;
}): PublicUserV1 {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    permissions: [...ROLE_PERMISSIONS[user.role]],
  };
}
