"use client"

import Script from "next/script"

import {
  markRecaptchaScriptFailed,
  markRecaptchaScriptReady,
} from "@lib/newsletter/recaptcha-client"

export function RecaptchaScript({ siteKey }: { siteKey: string }) {
  if (!siteKey) return null

  return (
    <Script
      id="holo-trail-recaptcha-v3"
      src={`https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`}
      strategy="afterInteractive"
      onReady={markRecaptchaScriptReady}
      onError={markRecaptchaScriptFailed}
    />
  )
}
