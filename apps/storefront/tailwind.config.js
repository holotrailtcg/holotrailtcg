const path = require("path")

module.exports = {
  darkMode: "class",
  presets: [require("@medusajs/ui-preset")],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/pages/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/modules/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      transitionProperty: {
        width: "width margin",
        height: "height",
        bg: "background-color",
        display: "display opacity",
        visibility: "visibility",
        padding: "padding-top padding-right padding-bottom padding-left",
      },
      colors: {
        grey: {
          0: "#FFFFFF",
          5: "#F9FAFB",
          10: "#F3F4F6",
          20: "#E5E7EB",
          30: "#D1D5DB",
          40: "#9CA3AF",
          50: "#6B7280",
          60: "#4B5563",
          70: "#374151",
          80: "#1F2937",
          90: "#111827",
        },
        /*
         * Holo Trail brand palette. Every value reads from a CSS custom
         * property defined in styles/globals.css (the source of truth).
         * Do not hard-code the underlying hex in components.
         */
        page: "var(--ht-background-page)",
        store: "var(--ht-background-store)",
        surface: {
          DEFAULT: "var(--ht-surface)",
          alt: "var(--ht-surface-alt)",
        },
        ink: {
          DEFAULT: "var(--ht-text-primary)",
          muted: "var(--ht-text-muted)",
          "on-dark": "var(--ht-text-on-dark)",
        },
        line: {
          DEFAULT: "var(--ht-border)",
          strong: "var(--ht-border-strong)",
        },
        action: {
          DEFAULT: "var(--ht-action-primary)",
          hover: "var(--ht-action-primary-hover)",
          active: "var(--ht-action-primary-active)",
          text: "var(--ht-action-primary-text)",
        },
        accent: "var(--ht-accent-secondary)",
        navy: "var(--ht-navigation)",
        signal: "var(--ht-signal-cyan)",
        focus: "var(--ht-focus-ring)",
        /* Functional UI status colours (not brand accents). */
        success: {
          DEFAULT: "var(--ht-status-success)",
          surface: "var(--ht-status-success-surface)",
        },
        warning: {
          DEFAULT: "var(--ht-status-warning)",
          surface: "var(--ht-status-warning-surface)",
        },
        danger: {
          DEFAULT: "var(--ht-status-error)",
          surface: "var(--ht-status-error-surface)",
        },
        info: {
          DEFAULT: "var(--ht-status-info)",
          surface: "var(--ht-status-info-surface)",
        },
      },
      /*
       * Square corners globally (Brand Guidelines v3). All box radii resolve to
       * 0 so the theme owns the rule; components do not override per instance.
       * `full`/`circle` are retained only for genuine circles (spinners,
       * country flags), which are not "corners".
       */
      borderRadius: {
        none: "0px",
        sm: "0px",
        DEFAULT: "0px",
        md: "0px",
        lg: "0px",
        xl: "0px",
        "2xl": "0px",
        "3xl": "0px",
        soft: "0px",
        base: "0px",
        rounded: "0px",
        large: "0px",
        full: "9999px",
        circle: "9999px",
      },
      maxWidth: {
        "8xl": "100rem",
        content: "var(--ht-content-width)",
      },
      screens: {
        "2xsmall": "320px",
        xsmall: "512px",
        small: "1024px",
        medium: "1280px",
        large: "1440px",
        xlarge: "1680px",
        "2xlarge": "1920px",
      },
      fontSize: {
        "3xl": "2rem",
      },
      fontFamily: {
        /* Source Sans 3 (var injected by next/font) is the interface default. */
        sans: [
          "var(--font-body)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Ubuntu",
          "sans-serif",
        ],
        /* Barlow Condensed for display/headings. */
        display: [
          "var(--font-display)",
          "Arial Narrow",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      keyframes: {
        ring: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "fade-in-right": {
          "0%": {
            opacity: "0",
            transform: "translateX(10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateX(0)",
          },
        },
        "fade-in-top": {
          "0%": {
            opacity: "0",
            transform: "translateY(-10px)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0)",
          },
        },
        "fade-out-top": {
          "0%": {
            height: "100%",
          },
          "99%": {
            height: "0",
          },
          "100%": {
            visibility: "hidden",
          },
        },
        "accordion-slide-up": {
          "0%": {
            height: "var(--radix-accordion-content-height)",
            opacity: "1",
          },
          "100%": {
            height: "0",
            opacity: "0",
          },
        },
        "accordion-slide-down": {
          "0%": {
            "min-height": "0",
            "max-height": "0",
            opacity: "0",
          },
          "100%": {
            "min-height": "var(--radix-accordion-content-height)",
            "max-height": "none",
            opacity: "1",
          },
        },
        enter: {
          "0%": { transform: "scale(0.9)", opacity: 0 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
        leave: {
          "0%": { transform: "scale(1)", opacity: 1 },
          "100%": { transform: "scale(0.9)", opacity: 0 },
        },
        "slide-in": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        ring: "ring 2.2s cubic-bezier(0.5, 0, 0.5, 1) infinite",
        "fade-in-right":
          "fade-in-right 0.3s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "fade-in-top": "fade-in-top 0.2s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "fade-out-top":
          "fade-out-top 0.2s cubic-bezier(0.5, 0, 0.5, 1) forwards",
        "accordion-open":
          "accordion-slide-down 300ms cubic-bezier(0.87, 0, 0.13, 1) forwards",
        "accordion-close":
          "accordion-slide-up 300ms cubic-bezier(0.87, 0, 0.13, 1) forwards",
        enter: "enter 200ms ease-out",
        "slide-in": "slide-in 1.2s cubic-bezier(.41,.73,.51,1.02)",
        leave: "leave 150ms ease-in forwards",
      },
    },
  },
  plugins: [require("tailwindcss-radix")()],
}
