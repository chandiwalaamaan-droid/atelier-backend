import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Rolichat — craft a companion",
  description: "Create custom AI characters and talk with them.",
};

// Without this, mobile browsers (Chrome on Android in particular) overlay
// the on-screen keyboard on top of the page instead of resizing it — the
// browser just auto-scrolls the focused input into view while the layout
// viewport (and therefore `h-dvh`) stays the same full-screen height.
// That's what produces the empty gap between the message box and the
// keyboard in the chat composer. `resizes-content` makes the browser
// actually shrink the viewport when the keyboard opens, so `h-dvh`
// recalculates and the composer sits flush above the keyboard.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${inter.variable} font-body bg-void text-parchment antialiased`}>
        {children}
      </body>
    </html>
  );
}
