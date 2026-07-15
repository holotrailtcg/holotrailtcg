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
  /** Clear page headline describing the planned shop. */
  heroHeadline: "A better way to buy Pokémon singles is on the way",

  /** Supporting copy for collectors in the UK. */
  heroSupporting:
    "We’re building a straightforward UK shop for collectors who care about card condition. Expect carefully checked singles, clear grading and secure UK delivery.",

  /** Short intro above the benefit list. */
  benefitsIntro: "Join the list and we’ll send you:",

  /** What subscribers receive. Keep factual — no urgency or scarcity. */
  benefits: [
    { key: "launch", text: "A note when the shop opens" },
    { key: "stock", text: "Useful stock updates" },
    { key: "discount", text: "10% off your first order" },
  ] as ComingSoonBenefit[],

  building: {
    heading: "What we’re building",
    items: [
      {
        key: "checked-singles",
        heading: "Carefully checked singles",
        body: "Every card will be checked before it’s listed, with its condition explained clearly.",
      },
      {
        key: "clear-condition",
        heading: "Clear card condition",
        body: "You’ll know what to expect before you buy, with honest grading and useful photos where they matter.",
      },
      {
        key: "secure-delivery",
        heading: "Secure UK delivery",
        body: "Your cards will be packed with care and sent securely from the UK.",
      },
    ],
  },

  faq: {
    heading: "A few things you might be wondering",
    items: [
      {
        key: "stock",
        question: "What will Holo Trail sell?",
        answer:
          "We’ll focus on genuine Pokémon single cards for collectors in the UK. We’ll share more about sets and stock as we get closer to opening.",
      },
      {
        key: "opening",
        question: "When will the shop open?",
        answer:
          "We don’t have a date to share just yet. Join the list and we’ll let you know when everything’s ready.",
      },
      {
        key: "delivery",
        question: "Where will you deliver?",
        answer:
          "We’ll start with UK delivery. Full delivery options and prices will be available when the shop opens.",
      },
      {
        key: "email",
        question: "What will you email me about?",
        answer:
          "We’ll email you about the launch and useful stock updates. You can unsubscribe whenever you like.",
      },
    ],
  },

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

  trademarkDisclaimer:
    "Pokémon and Pokémon character names are trademarks of Nintendo. Holo Trail TCG is an independent retailer and is not affiliated with or endorsed by Nintendo, Creatures Inc., GAME FREAK inc. or The Pokémon Company.",
} as const

export type ComingSoonContent = typeof comingSoonContent
