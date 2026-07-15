import { resolveR2Config, buildR2FileProviderOptions, type R2EnabledConfig } from "../r2-config"

const FAKE_ACCOUNT_ID = "abcdef0123456789abcdef0123456789"

const enabledEnv = () => ({
  R2_IMAGES_ENABLED: "true",
  R2_ACCOUNT_ID: FAKE_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: "test-only-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-only-secret-access-key",
  R2_BUCKET_NAME: "holo-trail-card-images-test",
  R2_S3_ENDPOINT: `https://${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  R2_PUBLIC_BASE_URL: "https://images.test.holotrailtcg.invalid",
})

describe("resolveR2Config", () => {
  it("is disabled when R2_IMAGES_ENABLED is unset", () => {
    expect(resolveR2Config({})).toEqual({ enabled: false })
  })

  it("is disabled for any value other than the exact string \"true\"", () => {
    expect(resolveR2Config({ R2_IMAGES_ENABLED: "false" })).toEqual({ enabled: false })
    expect(resolveR2Config({ R2_IMAGES_ENABLED: "TRUE" })).toEqual({ enabled: false })
    expect(resolveR2Config({ R2_IMAGES_ENABLED: "1" })).toEqual({ enabled: false })
    expect(resolveR2Config({ R2_IMAGES_ENABLED: " true " })).toEqual({ enabled: false })
  })

  it("resolves a fully valid enabled configuration", () => {
    const config = resolveR2Config(enabledEnv())
    expect(config).toEqual({
      enabled: true,
      accountId: FAKE_ACCOUNT_ID,
      accessKeyId: "test-only-access-key-id",
      secretAccessKey: "test-only-secret-access-key",
      bucketName: "holo-trail-card-images-test",
      endpoint: `https://${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      publicBaseUrl: "https://images.test.holotrailtcg.invalid",
      region: "auto",
      cacheControl: "public, max-age=31536000, immutable",
      acl: false,
    })
  })

  it("accepts the EU jurisdiction-specific endpoint", () => {
    const config = resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://${FAKE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`,
    })
    expect(config).toMatchObject({ enabled: true, endpoint: `https://${FAKE_ACCOUNT_ID}.eu.r2.cloudflarestorage.com` })
  })

  it("accepts the FedRAMP jurisdiction-specific endpoint", () => {
    const config = resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://${FAKE_ACCOUNT_ID}.fedramp.r2.cloudflarestorage.com`,
    })
    expect(config).toMatchObject({ enabled: true, endpoint: `https://${FAKE_ACCOUNT_ID}.fedramp.r2.cloudflarestorage.com` })
  })

  it("rejects the FIPS endpoint, which R2 does not support", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://${FAKE_ACCOUNT_ID}.fips.r2.cloudflarestorage.com`,
    })).toThrow(/R2_S3_ENDPOINT/)
  })

  it("rejects a malformed hostname with an extra subdomain", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://extra.${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    })).toThrow(/R2_S3_ENDPOINT/)
  })

  it("rejects a hostname missing the .r2.cloudflarestorage.com suffix", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://${FAKE_ACCOUNT_ID}.cloudflarestorage.com`,
    })).toThrow(/R2_S3_ENDPOINT/)
  })

  it.each([
    "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_S3_ENDPOINT", "R2_PUBLIC_BASE_URL",
  ])("throws when %s is missing", (missingKey) => {
    const env = enabledEnv() as Record<string, string | undefined>
    delete env[missingKey]
    expect(() => resolveR2Config(env)).toThrow()
  })

  it("throws when R2_ACCOUNT_ID is not 32-character hex", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_ACCOUNT_ID: "not-hex" })).toThrow(/R2_ACCOUNT_ID/)
  })

  it("throws when R2_BUCKET_NAME is not a valid bucket name", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_BUCKET_NAME: "UPPERCASE_not_allowed" })).toThrow(/R2_BUCKET_NAME/)
  })

  it("throws on a malformed R2_S3_ENDPOINT", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_S3_ENDPOINT: "not a url" })).toThrow(/R2_S3_ENDPOINT/)
  })

  it("throws when R2_S3_ENDPOINT is not https", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `http://${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    })).toThrow(/https/)
  })

  it("throws when R2_S3_ENDPOINT is not an R2 host", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_S3_ENDPOINT: "https://example.com" })).toThrow(/R2_S3_ENDPOINT/)
  })

  it("throws when the R2_S3_ENDPOINT account ID does not match R2_ACCOUNT_ID", () => {
    const otherAccountId = "11111111111111111111111111111111"
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://${otherAccountId}.r2.cloudflarestorage.com`,
    })).toThrow(/account ID must match/)
  })

  it("throws on a malformed R2_PUBLIC_BASE_URL", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_PUBLIC_BASE_URL: "not a url" })).toThrow(/R2_PUBLIC_BASE_URL/)
  })

  it("throws when R2_PUBLIC_BASE_URL is not https", () => {
    expect(() => resolveR2Config({ ...enabledEnv(), R2_PUBLIC_BASE_URL: "http://images.example.com" })).toThrow(/https/)
  })

  it("throws when R2_PUBLIC_BASE_URL contains a path", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_PUBLIC_BASE_URL: "https://images.example.com/card-images",
    })).toThrow(/bare origin/)
  })

  it("throws when R2_S3_ENDPOINT embeds credentials", () => {
    expect(() => resolveR2Config({
      ...enabledEnv(), R2_S3_ENDPOINT: `https://user:pass@${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    })).toThrow(/credentials/)
  })

  it("never includes a secret value in a thrown error message", () => {
    const env = enabledEnv() as Record<string, string | undefined>
    delete env.R2_ACCESS_KEY_ID
    env.R2_SECRET_ACCESS_KEY = "super-secret-marker-should-not-leak"
    try {
      resolveR2Config(env)
      throw new Error("expected resolveR2Config to throw")
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("super-secret-marker-should-not-leak")
    }
  })
})

describe("buildR2FileProviderOptions", () => {
  const fakeEnabledConfig: R2EnabledConfig = {
    enabled: true,
    accountId: FAKE_ACCOUNT_ID,
    accessKeyId: "test-only-access-key-id",
    secretAccessKey: "test-only-secret-access-key",
    bucketName: "holo-trail-card-images-test",
    endpoint: `https://${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    publicBaseUrl: "https://images.test.holotrailtcg.invalid",
    region: "auto",
    cacheControl: "public, max-age=31536000, immutable",
    acl: false,
  }

  it("builds the exact snake_case option shape the real S3FileService provider reads", () => {
    const options = buildR2FileProviderOptions(fakeEnabledConfig)
    expect(options).toEqual({
      file_url: "https://images.test.holotrailtcg.invalid",
      access_key_id: "test-only-access-key-id",
      secret_access_key: "test-only-secret-access-key",
      region: "auto",
      bucket: "holo-trail-card-images-test",
      endpoint: `https://${FAKE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      cache_control: "public, max-age=31536000, immutable",
      acl: false,
    })
  })

  it("never produces camelCase option keys that the real provider would silently ignore", () => {
    const options = buildR2FileProviderOptions(fakeEnabledConfig) as unknown as Record<string, unknown>
    expect(options).not.toHaveProperty("fileUrl")
    expect(options).not.toHaveProperty("accessKeyId")
    expect(options).not.toHaveProperty("secretAccessKey")
    expect(options).not.toHaveProperty("cacheControl")
    expect(Object.keys(options).sort()).toEqual(
      ["access_key_id", "acl", "bucket", "cache_control", "endpoint", "file_url", "region", "secret_access_key"].sort()
    )
  })
})
