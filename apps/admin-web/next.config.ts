import { identityOrigin } from './lib/auth/config';
import type { NextConfig } from 'next';
identityOrigin(process.env.IDENTITY_INTERNAL_URL);
const config: NextConfig = { output: 'standalone', poweredByHeader: false };
export default config;
