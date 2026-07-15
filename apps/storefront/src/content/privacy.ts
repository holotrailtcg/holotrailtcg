/**
 * Facts the business owner must confirm before treating this notice as final.
 * They are deliberately kept out of the public copy rather than guessed.
 */
export const PRIVACY_NOTICE_PUBLICATION_BLOCKERS = [
  "Confirm the controller's full legal identity and postal address; the repository only establishes the Holo Trail TCG trading identity.",
  "Approve and operationalise a documented retention schedule for pending, confirmed and unsubscribed subscriber records.",
  "Confirm the international transfer locations and safeguards used for Resend, Google, hosting and database services.",
] as const

// Keep the notice out of search results until the business-owned facts above
// have been confirmed. The page remains public and linked at data collection.
export const PRIVACY_NOTICE_INDEXABLE = false

export const privacyContent = {
  heading: "Privacy notice",
  lastUpdated: "15 July 2026",
  introduction:
    "Here is the straightforward version of how Holo Trail TCG uses your personal information while the shop is in its coming-soon stage. This notice covers this website and its mailing list. We will update it before accounts, orders or payments go live.",
  sections: {
    controller: {
      heading: "Who we are",
      paragraphs: [
        "The business operating Holo Trail TCG decides why and how the personal information described in this notice is used. Its full legal identity and postal address still need to be added before this notice is treated as final.",
        "For now, you can send a private message through one of the official Holo Trail TCG social profiles linked below. Please do not post personal information publicly, and only include what we need to deal with your request.",
      ],
    },
    information: {
      heading: "What we collect",
      paragraphs: [
        "When you join the mailing list, we collect your first name, email address and your confirmation that you agreed to receive launch and stock-update emails. We also record the consent wording version, when and where you signed up, your confirmation status and when you unsubscribe.",
        "We keep records needed to run the double opt-in process and first-order discount, including confirmation-delivery status and hashed confirmation and unsubscribe tokens. Joining the list does not create a shop customer account.",
        "For security, we process technical information such as your network address, browser or device information, reCAPTCHA token and anti-bot signals. Our server turns the network address into a keyed pseudonymous rate-limit value; it does not store the raw address in the newsletter rate-limit table.",
      ],
    },
    purposes: {
      heading: "Why we use it and our lawful bases",
      paragraphs: [
        "We use your name and email to confirm your request and, once confirmed, send the launch and useful stock updates you asked for. We rely on your consent under UK GDPR and PECR. You do not join the marketing list until you click the confirmation link.",
        "We use consent, unsubscribe and delivery records to manage your choice, show what happened and stop messages when you opt out. This supports our legitimate interest in keeping an accurate record of mailing-list choices and dealing with disputes.",
        "We use rate limiting, a hidden anti-bot field and Google reCAPTCHA to keep the form secure and prevent misuse. We rely on our legitimate interests in protecting the site and mailing list. We only use information that is reasonably necessary for that purpose.",
      ],
    },
    marketing: {
      heading: "Marketing and withdrawing consent",
      paragraphs: [
        "You can change your mind whenever you like. Use the unsubscribe link provided with mailing-list messages or send a private message through one of the official profiles linked below. Withdrawing consent will not affect anything lawfully done before you withdrew it.",
        "Unsubscribing stops marketing but does not instantly erase every compliance record. You can separately ask us to erase your information; we will do so where the law requires and explain if we need to keep a limited record, for example to honour your opt-out or deal with a legal claim.",
        "We do not sell your personal information and we do not add you to unrelated marketing lists.",
      ],
    },
    cookies: {
      heading: "Cookies and local storage",
      paragraphs: [
        "The site uses an essential _medusa_cache_id cookie for cache and region handling. It lasts for up to 24 hours. We do not need cookie consent for storage that is strictly necessary to provide the site, but we still tell you about it here.",
        "Your analytics choice is saved in your browser's local storage as ht_consent so the site can remember it. Analytics stays off unless you actively accept it, and you can reopen Cookie preferences at any time. No analytics service is currently loaded on the coming-soon site.",
        "Google reCAPTCHA helps protect the signup form and may set or read a necessary cookie. Google may receive technical information such as your network address, browser or device information and the page referring you to its service. Google's privacy policy and terms apply to that processing.",
      ],
    },
    providers: {
      heading: "Who we share information with",
      paragraphs: [
        "Resend receives the name, email address and email content needed to deliver the confirmation email. Google receives the information needed to provide reCAPTCHA. Hosting, database and technical service providers process information where needed to operate and secure the service.",
        "We may also disclose information to professional advisers, courts, regulators or law-enforcement bodies where it is reasonably necessary or the law requires it. We require service providers acting for us to protect the information and use it only for the agreed service.",
      ],
    },
    transfers: {
      heading: "Transfers outside the UK",
      paragraphs: [
        "Resend and Google are international services and may process information outside the UK. Their privacy information explains where and how they process information.",
        "The exact transfer locations and safeguards used by Holo Trail TCG still need to be confirmed before this notice is treated as final. You can ask about them using the private contact routes below.",
      ],
    },
    retention: {
      heading: "How long we keep information",
      paragraphs: [
        "The newsletter currently has no automated deletion schedule. Pending, confirmed and unsubscribed records remain in the database until they are manually removed. A documented schedule still needs to be approved and implemented before this notice is treated as final.",
        "Short-lived, pseudonymous rate-limit records are removed by an hourly cleanup after three completed configured rate-limit windows. Confirmation links expire after a short configured period, and the database stores their tokens as hashes rather than readable links.",
        "Google and our other providers keep information under their own documented retention controls where they act as independent controllers. You can follow the provider links below for more detail.",
      ],
    },
    decisions: {
      heading: "Security and automated checks",
      paragraphs: [
        "We use access controls, strict input validation, expiring links, hashed tokens and pseudonymous rate-limit keys. No online service can promise perfect security, but we limit the information used by each part of the signup process.",
        "reCAPTCHA produces an automated risk assessment and a submission may be refused if it appears to be automated or abusive. This security check does not make a decision with legal or similarly significant effects. If you are a genuine visitor and the form will not work, email us and we will help.",
      ],
    },
    rights: {
      heading: "Your data protection rights",
      paragraphs: [
        "Depending on the circumstances, you can ask for a copy of your personal information, ask us to correct or erase it, restrict how it is used, object to processing, or ask for information you gave us in a portable format. Where we rely on consent, you can withdraw it at any time.",
        "These rights sometimes have legal limits. We may need to confirm your identity, and we normally have one month to respond. If an exemption applies, we will explain why.",
      ],
    },
    contact: {
      heading: "Contact us or complain",
      paragraphs: [
        "Send a private message through an official Holo Trail TCG social profile with a privacy question, request or complaint. We would appreciate the chance to put things right, but you do not have to contact us before complaining to the Information Commissioner's Office (ICO).",
        "The ICO is the UK's data-protection regulator. Its address is Information Commissioner's Office, Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF, and its helpline is 0303 123 1113.",
      ],
    },
    changes: {
      heading: "Changes to this notice",
      paragraphs: [
        "We will update this notice when the site or our use of personal information changes. The date at the top tells you when it was last revised. If a change materially affects something you have consented to, we will ask again where the law requires it.",
      ],
    },
  },
} as const
