import { MedusaService } from "@medusajs/framework/utils"
import Subscriber from "./models/subscriber"
import RateLimitBucket from "./models/rate-limit-bucket"

/**
 * Low-level persistence service for the newsletter module. This exposes
 * only storage-level lookups on top of the standard `MedusaService`
 * CRUD methods; subscriber lifecycle orchestration (subscribe, confirm,
 * unsubscribe), token generation/hashing and rate-limit increments belong
 * to later stages (see docs/decisions/0005-newsletter-backend-design.md).
 */
class NewsletterModuleService extends MedusaService({
  Subscriber,
  RateLimitBucket,
}) {
  async retrieveSubscriberByNormalisedEmail(normalisedEmail: string) {
    const [subscriber] = await this.listSubscribers({
      normalised_email: normalisedEmail,
    })
    return subscriber ?? null
  }

  async retrieveSubscriberByConfirmationTokenHash(
    confirmationTokenHash: string
  ) {
    const [subscriber] = await this.listSubscribers({
      confirmation_token_hash: confirmationTokenHash,
    })
    return subscriber ?? null
  }

  async retrieveSubscriberByUnsubscribeTokenHash(unsubscribeTokenHash: string) {
    const [subscriber] = await this.listSubscribers({
      unsubscribe_token_hash: unsubscribeTokenHash,
    })
    return subscriber ?? null
  }
}

export default NewsletterModuleService
