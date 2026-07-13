const checkEnvVariables = require("./check-env-variables")

checkEnvVariables()

/**
 * Medusa Cloud-related environment variables
 */
const S3_HOSTNAME = process.env.MEDUSA_CLOUD_S3_HOSTNAME
const S3_PATHNAME = process.env.MEDUSA_CLOUD_S3_PATHNAME

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  logging: {
    // Next 15 logs incoming request URLs verbatim in development. Ignore only
    // the two token-bearing routes; unrelated operational request logging stays
    // enabled. Fetch logging remains at Next's default-off setting because its
    // `fullUrl: false` option truncates query values rather than redacting them.
    incomingRequests: {
      ignore: [
        /^\/(?:[a-z]{2}\/)?newsletter\/(?:confirm|unsubscribe)(?:\?|$)/,
      ],
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "*.s3.*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
      },
      ...(S3_HOSTNAME && S3_PATHNAME
        ? [
            {
              protocol: "https",
              hostname: S3_HOSTNAME,
              pathname: S3_PATHNAME,
            },
          ]
        : []),
    ],
  },
  async headers() {
    const tokenResultHeaders = [
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]

    return [
      {
        source: "/:countryCode/newsletter/confirm",
        headers: tokenResultHeaders,
      },
      {
        source: "/:countryCode/newsletter/unsubscribe",
        headers: tokenResultHeaders,
      },
    ]
  },
}

module.exports = nextConfig
