import { getBaseURL } from "@lib/util/env"
import { fontBody, fontDisplay } from "@lib/fonts"
import { Metadata } from "next"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="light"
      className={`${fontBody.variable} ${fontDisplay.variable}`}
    >
      <body>
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <main id="main-content" className="relative">
          {props.children}
        </main>
      </body>
    </html>
  )
}
