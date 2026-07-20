import { z } from "@medusajs/framework/zod"

const commonUserAccessTokenFields = {
  access_token: z.string().min(1).max(8192),
  expires_in: z.number().int().positive().max(86_400),
  token_type: z.literal("User Access Token"),
  scope: z.string().max(8192).optional(),
}

// eBay's current authorization-code contract requires a refresh token.
// Unknown response fields are deliberately stripped by z.object.
export const ebayAuthorisationTokenResponseSchema = z.object({
  ...commonUserAccessTokenFields,
  refresh_token: z.string().min(1).max(8192),
  refresh_token_expires_in: z.number().int().positive().optional(),
})

// eBay's current refresh contract returns a new access token and does not
// document refresh-token rotation. Any unknown refresh_token field is ignored.
export const ebayRefreshTokenResponseSchema = z.object(commonUserAccessTokenFields)

export const ebayIdentityResponseSchema = z.object({
  userId: z.string().min(1).max(255),
  username: z.string().min(1).max(255).optional(),
  accountType: z.string().max(64).optional(),
  registrationMarketplaceId: z.string().max(64).optional(),
})

export type EbayAuthorisationTokenResponse = z.infer<typeof ebayAuthorisationTokenResponseSchema>
export type EbayRefreshTokenResponse = z.infer<typeof ebayRefreshTokenResponseSchema>
export type EbayIdentityResponse = z.infer<typeof ebayIdentityResponseSchema>
