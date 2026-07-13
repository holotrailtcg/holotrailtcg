import { redactNewsletterTokenQueryFromRequestLog } from "../request-logging"

describe("redactNewsletterTokenQueryFromRequestLog", () => {
  it("removes the query from the logging URL without changing the request URL", () => {
    const req = {
      originalUrl: "/store/newsletter/confirm?token=sensitive-token",
      url: "/store/newsletter/confirm?token=sensitive-token",
      query: { token: "sensitive-token" },
    }
    const next = jest.fn()

    redactNewsletterTokenQueryFromRequestLog(req as never, {} as never, next)

    expect(req.originalUrl).toBe("/store/newsletter/confirm")
    expect(req.url).toContain("sensitive-token")
    expect(req.query.token).toBe("sensitive-token")
    expect(next).toHaveBeenCalledTimes(1)
  })
})
