/**
 * Replaceable copy and configuration for the coming-soon page.
 *
 * All temporary page wording lives here so it can be edited without touching
 * the presentational components. Do not scatter copy through components.
 * No launch date, no urgency, no scarcity — see the Brand Guidelines.
 */

export type ComingSoonBenefit = {
  /** Stable key for lists. */
  key: string
  /** Short benefit text shown to the subscriber. */
  text: string
}

export const comingSoonContent = {
  /** Small status label near the logo. */
  status: "Coming soon",

  /** Placeholder hero headline (temporary). */
  heroHeadline: "A specialist home for collectable trading cards",

  /** Placeholder supporting copy (temporary). */
  heroSupporting:
    "We are building a calm, careful place to browse and buy single cards, with honest condition grading and secure UK dispatch. Join the list to be the first to know when the doors open.",

  /** Short intro above the benefit list. */
  benefitsIntro: "Subscribers will receive:",

  /** What subscribers receive. Keep factual — no urgency or scarcity. */
  benefits: [
    { key: "launch", text: "Launch notifications" },
    { key: "stock", text: "Stock updates" },
    { key: "discount", text: "10% off their first purchase" },
  ] as ComingSoonBenefit[],

  /** Form section heading and helper copy. */
  form: {
    heading: "Join the list",
    firstNameLabel: "First name",
    firstNameHelp: "So we can address emails to you.",
    emailLabel: "Email",
    emailHelp: "We will only use this to email you about the launch.",
    /** Consent wording shown beside the checkbox. */
    consentLabel:
      "I agree to receive launch and stock update emails from Holo Trail TCG, and I understand I can unsubscribe at any time.",
    submitLabel: "Notify me",
    /** Generic, duplicate-safe success wording (never confirms an email was sent). */
    successTitle: "Thank you",
    successBody:
      "If the details are valid, check your inbox for a confirmation email.",
    successSupporting:
      "You will not receive updates until you confirm your email address.",
    /** Safe, generic, recoverable error wording. */
    errorTitle: "Something went wrong",
    errors: {
      rate_limited: "Too many attempts. Please wait before trying again.",
      verification_failure:
        "We could not verify the request. Please try again.",
      temporarily_unavailable:
        "We could not process your request right now. Please try again later.",
    },
  },

  /** Privacy note shown under the form. */
  privacyNote: {
    lead: "We take your privacy seriously.",
    linkLabel: "Read our privacy notice",
  },
} as const

export type ComingSoonContent = typeof comingSoonContent
