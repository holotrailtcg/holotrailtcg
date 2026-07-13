import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

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
  ],
})
