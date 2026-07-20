import { redactEbayCallbackQueryFromRequestLog } from "../request-logging"

describe("redactEbayCallbackQueryFromRequestLog", () => {
  it.each(["SANDBOX", "PRODUCTION"])("redacts only the %s callback logging URL", (environment) => {
    const secretQuery = "state=state-value&code=authorisation-code&error_description=provider-detail&arbitrary=value"
    const req = {
      originalUrl: `/admin/ebay/connections/callback/${environment}?${secretQuery}`,
      url: `/admin/ebay/connections/callback/${environment}?${secretQuery}`,
      query: { state: "state-value", code: "authorisation-code", error_description: "provider-detail", arbitrary: "value" },
      params: { environment },
    }
    const next = jest.fn()

    redactEbayCallbackQueryFromRequestLog(req as never, {} as never, next)

    expect(req.originalUrl).toBe(`/admin/ebay/connections/callback/${environment}`)
    expect(req.originalUrl).not.toContain("?")
    for (const value of ["authorisation-code", "state-value", "provider-detail", "value"]) {
      expect(req.originalUrl).not.toContain(value)
    }
    expect(req.url).toContain(secretQuery)
    expect(req.query.code).toBe("authorisation-code")
    expect(req.params.environment).toBe(environment)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("fails closed for malformed logging URLs", () => {
    const req = { originalUrl: "http://[bad?code=authorisation-code" }
    redactEbayCallbackQueryFromRequestLog(req as never, {} as never, jest.fn())
    expect(req.originalUrl).toBe("/admin/ebay/connections/callback")
  })
})
