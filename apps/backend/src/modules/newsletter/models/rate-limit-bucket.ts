import { model } from "@medusajs/framework/utils"

/**
 * A fixed-window rate-limit counter for the newsletter subscribe endpoint
 * (Stage 2C.3+). `request_key` must only ever hold an HMAC-derived
 * pseudonymous value — never a raw IP address. Key derivation and the
 * atomic increment operation are implemented in a later stage; this model
 * only establishes the storage contract and its constraints.
 */
const RateLimitBucket = model
  .define(
    { name: "RateLimitBucket", tableName: "newsletter_rate_limit_bucket" },
    {
      id: model.id({ prefix: "nlrl" }).primaryKey(),
      request_key: model.text(),
      window_start: model.dateTime(),
      count: model.number().default(0),
    }
  )
  .checks([
    {
      name: "CK_newsletter_rate_limit_bucket_count_non_negative",
      expression: (columns) => `${columns.count} >= 0`,
    },
  ])
  .indexes([
    {
      name: "IDX_newsletter_rate_limit_bucket_request_key_window_start",
      on: ["request_key", "window_start"],
      unique: true,
    },
    {
      name: "IDX_newsletter_rate_limit_bucket_window_start",
      on: ["window_start"],
    },
  ])

export default RateLimitBucket
