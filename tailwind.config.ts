import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Core backgrounds (base.css :root) ────────────────────────────
        background: "#080C14",    // --bg
        surface:    "#0D1520",    // --bg2
        card: {
          DEFAULT:    "#111D2B",  // --bg3
          foreground: "#E8F4FF",
        },
        border: "#1A2D42",        // --border

        // ── Text ─────────────────────────────────────────────────────────
        foreground: "#E8F4FF",    // --text
        muted: {
          DEFAULT:    "#7A9BB5",  // --muted
          foreground: "#3A5568",  // --dim
        },

        // ── Primary interactive — cyan ────────────────────────────────────
        primary: {
          DEFAULT:    "#00D4FF",  // --cyan
          foreground: "#080C14",
        },

        // ── Accent — gold ─────────────────────────────────────────────────
        accent: {
          DEFAULT:    "#FFB800",  // --accent
          foreground: "#080C14",
        },

        // ── Status ───────────────────────────────────────────────────────
        "green-live":   "#00FF88",  // --green  (live count)
        "green-active": "#22C55E",  // --ag     (active dot)
        destructive: {
          DEFAULT:    "#FF3D6B",    // --red
          foreground: "#E8F4FF",
        },
        blue: "#3b82f6",

        // ── Vehicle class colors ──────────────────────────────────────────
        "cls-car":   "#29B6F6",
        "cls-truck": "#FF7043",
        "cls-bus":   "#AB47BC",
        "cls-moto":  "#FFD600",

        // ── shadcn/ui semantic aliases ────────────────────────────────────
        secondary: {
          DEFAULT:    "#111D2B",
          foreground: "#7A9BB5",
        },
        popover: {
          DEFAULT:    "#0D1520",
          foreground: "#E8F4FF",
        },
        input: "#1A2D42",
        ring:  "#00D4FF",
      },

      fontFamily: {
        sans:    ["Inter", "Manrope", "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "monospace"],
        display: ["Archivo", "sans-serif"],
        label:   ["Rajdhani", "Archivo", "sans-serif"],
      },

      borderRadius: {
        DEFAULT: "8px",
        lg:      "8px",
        md:      "6px",
        sm:      "4px",
        full:    "9999px",
      },

      screens: {
        xs:    "375px",
        sm:    "480px",
        md:    "768px",
        lg:    "1024px",
        xl:    "1280px",
        "2xl": "1440px",
      },

      boxShadow: {
        DEFAULT: "0 4px 24px rgba(0,0,0,0.5)",
        cyan:    "0 0 20px rgba(0,212,255,0.25)",
        green:   "0 0 20px rgba(0,255,136,0.25)",
        card:    "0 2px 12px rgba(0,0,0,0.4)",
      },

      animation: {
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "hdr-scan":  "hdr-scan 7s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
      },

      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.4" },
        },
        "hdr-scan": {
          "0%, 100%": { opacity: "0.25" },
          "50%":      { opacity: "0.72" },
        },
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
