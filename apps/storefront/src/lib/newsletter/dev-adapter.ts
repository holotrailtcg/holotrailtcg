import type {
  NewsletterAdapter,
  NewsletterResult,
  NewsletterSubmission,
} from "./types"

/**
 * Development-safe placeholder adapter.
 *
 * This DOES NOT persist anything, call Neon, or send email. It exists only so
 * the coming-soon form UI has realistic states (loading, success, error) before
 * the Stage 2C backend exists. It runs entirely client-side.
 *
 * It fails closed outside development: simulated success is only ever returned
 * when `NODE_ENV === "development"`. Every other value — production, test,
 * unset, empty or a custom/staging-like value — must never report a fake
 * success, because that would tell a real visitor they are subscribed when
 * nothing was stored. Instead it returns the existing recoverable error state,
 * which the form surfaces as "try again", with no simulated latency and no
 * logging on that path.
 *
 * Stage 2C replaces this with an adapter that POSTs to the storefront API
 * route; the UI does not change because it depends on `NewsletterAdapter`.
 */

const SIMULATED_LATENCY_MS = 700

export const devNewsletterAdapter: NewsletterAdapter = {
  async submit(submission: NewsletterSubmission): Promise<NewsletterResult> {
    // Fail closed everywhere except development: this placeholder never
    // persists or emails, so reporting success would be dishonest anywhere it
    // could be reached by a real visitor (production, test, unset or a
    // custom/staging value). Return the recoverable error state instead, with
    // no latency simulation and no logging on this path.
    if (process.env.NODE_ENV !== "development") {
      void submission
      return { status: "error" }
    }

    // Simulate network latency so the loading state is exercised.
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_LATENCY_MS))

    // Make the placeholder nature obvious in development, without logging the
    // email address itself (avoid logging unnecessary personal data).
    // eslint-disable-next-line no-console
    console.info(
      "[dev newsletter adapter] received a submission (not persisted). " +
        "Replace with the Stage 2C API adapter."
    )

    // Duplicate-safe success in development only. The real adapter must not
    // reveal whether the address already existed either.
    void submission
    return { status: "success" }
  },
}
