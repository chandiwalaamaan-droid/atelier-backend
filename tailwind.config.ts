import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1c1320",
        plum: "#2b1a3d",
        "plum-deep": "#1e1129",
        parchment: "#f6efe3",
        gold: "#c9a227",
        "gold-light": "#e8c547",
        "gold-bright": "#f5d76e",
        rose: "#b5657a",
        "rose-light": "#d97a9a",
        "rose-deep": "#8a3d54",
        void: "#0a0a0c",
        "void-light": "#0f0f14",
        "surface-raised": "#121218",
        "surface-card": "#18181f",
        "surface-hover": "#1e1e26",
        // Accent colors for character variety
        amber: "#f59e0b",
        violet: "#8b5cf6",
        fuchsia: "#d946ef",
        cyan: "#06b6d4",
        emerald: "#10b981",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
      animation: {
        "float": "float 6s ease-in-out infinite",
        "float-slow": "float 8s ease-in-out infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.6s ease-out forwards",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "shine": "shine 6s ease-in-out infinite",
        "sparkle": "sparkle 2s ease-in-out infinite",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "aurora": "aurora 12s ease-in-out infinite",
        "aurora-slow": "aurora 20s ease-in-out infinite",
        "pulse-glow": "pulse-glow 2.5s ease-in-out infinite",
        "gradient-shift": "gradient-shift 8s ease infinite",
        "bounce-slow": "bounce-slow 3s ease-in-out infinite",
        "wiggle": "wiggle 0.5s ease-in-out",
        "shimmer-text": "shimmer-text 3s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 40px rgba(201, 162, 39, 0.15)" },
          "50%": { boxShadow: "0 0 60px rgba(201, 162, 39, 0.3)" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shine: {
          "0%": { backgroundPosition: "-200% center" },
          "100%": { backgroundPosition: "200% center" },
        },
        sparkle: {
          "0%, 100%": { opacity: "0.3", transform: "scale(0.8)" },
          "50%": { opacity: "1", transform: "scale(1.2)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(30px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        aurora: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)", opacity: "0.3" },
          "33%": { transform: "translate(30px, -30px) scale(1.1)", opacity: "0.5" },
          "66%": { transform: "translate(-20px, 20px) scale(0.95)", opacity: "0.4" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(201, 162, 39, 0.2), 0 0 40px rgba(201, 162, 39, 0.1)" },
          "50%": { boxShadow: "0 0 30px rgba(201, 162, 39, 0.4), 0 0 60px rgba(201, 162, 39, 0.2)" },
        },
        "gradient-shift": {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        "bounce-slow": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(0deg)" },
          "25%": { transform: "rotate(-3deg)" },
          "75%": { transform: "rotate(3deg)" },
        },
        "shimmer-text": {
          "0%, 100%": { backgroundPosition: "0% center" },
          "50%": { backgroundPosition: "100% center" },
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gold-shine": "linear-gradient(135deg, #c9a227 0%, #e8c547 50%, #c9a227 100%)",
        "mesh-1": "radial-gradient(at 0% 0%, rgba(201, 162, 39, 0.15) 0%, transparent 50%), radial-gradient(at 100% 0%, rgba(181, 101, 122, 0.12) 0%, transparent 50%), radial-gradient(at 50% 100%, rgba(139, 92, 246, 0.1) 0%, transparent 50%)",
      },
    },
  },
  plugins: [],
};
export default config;