import { ImageResponse } from "next/og"

import { COMING_SOON_SOCIAL_IMAGE_ALT } from "@lib/seo/coming-soon"

export const alt = COMING_SOON_SOCIAL_IMAGE_ALT
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#0d1b33",
          color: "#f7f4ee",
          display: "flex",
          height: "100%",
          padding: "64px",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#2d65eb",
            height: "10px",
            left: 0,
            position: "absolute",
            top: 0,
            width: "72%",
          }}
        />
        <div
          style={{
            background: "#54d9ed",
            height: "10px",
            position: "absolute",
            right: 0,
            top: 0,
            width: "28%",
          }}
        />

        <div
          style={{
            border: "2px solid rgba(247, 244, 238, 0.28)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "48px 52px",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              fontSize: "26px",
              fontWeight: 700,
              letterSpacing: "7px",
            }}
          >
            <span style={{ color: "#54d9ed", marginRight: "18px" }}>HT</span>
            HOLO TRAIL TCG
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                color: "#54d9ed",
                display: "flex",
                fontSize: "22px",
                fontWeight: 700,
                letterSpacing: "4px",
                marginBottom: "18px",
                textTransform: "uppercase",
              }}
            >
              UK collectors
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "72px",
                fontWeight: 800,
                letterSpacing: "-2px",
                lineHeight: 1.05,
                maxWidth: "920px",
              }}
            >
              Pokémon singles, coming soon
            </div>
          </div>

          <div
            style={{
              color: "rgba(247, 244, 238, 0.76)",
              display: "flex",
              fontSize: "24px",
            }}
          >
            Clear condition grading · Secure UK delivery
          </div>
        </div>
      </div>
    ),
    size
  )
}
