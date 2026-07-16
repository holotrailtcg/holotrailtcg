import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { resolveR2Config, buildR2FileProviderOptions } from './src/modules/trading-cards/images/r2-config'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// Disabled by default: local Medusa file behaviour is preserved unless
// R2_IMAGES_ENABLED is the exact string "true", and resolveR2Config fails
// closed (throws) rather than booting with a partially configured provider.
const r2Config = resolveR2Config(process.env)

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  // Off by default (no change to normal dev/production behaviour). Only the
  // Stage 2C.6 HTTP integration test harness sets MEDUSA_ADMIN_DISABLE=true
  // (integration-tests/http/support/bootstrap.ts), since that suite boots
  // the real Medusa app to exercise the newsletter routes and has no
  // built Admin UI available to serve.
  admin: {
    disable: process.env.MEDUSA_ADMIN_DISABLE === "true",
  },
  modules: [
    {
      resolve: "./src/modules/newsletter",
    },
    {
      resolve: "./src/modules/trading-cards",
    },
    {
      resolve: "./src/modules/trading-card-inventory",
    },
    // Only overrides Medusa's default local file provider when Stage 4B.1
    // R2 configuration is enabled and fully valid; otherwise local file
    // behaviour is untouched (no module override registered at all).
    ...(r2Config.enabled
      ? [
          {
            resolve: "@medusajs/medusa/file",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/file-s3",
                  id: "r2",
                  // Exact snake_case option names required by the real
                  // S3FileService provider (see buildR2FileProviderOptions);
                  // there are no camelCase aliases.
                  options: buildR2FileProviderOptions(r2Config),
                },
              ],
            },
          },
        ]
      : []),
  ],
})
