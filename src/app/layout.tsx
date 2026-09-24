import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Agentation } from "agentation";
import "./globals.css";

// Lunchtype (OFL, github.com/fontalternative/lunchtype) ships 300/400/500
// only. Medium covers 500–700 so font-semibold / font-bold use the real
// Medium cut instead of a browser-synthesised bold.
const lunchtype = localFont({
  src: [
    { path: "./fonts/lunchtype/lunchtype22-light-webfont.woff2", weight: "300", style: "normal" },
    { path: "./fonts/lunchtype/lunchtype23-light-italic-webfont.woff2", weight: "300", style: "italic" },
    { path: "./fonts/lunchtype/lunchtype22-regular-webfont.woff2", weight: "400", style: "normal" },
    { path: "./fonts/lunchtype/lunchtype23-regular-italic-webfont.woff2", weight: "400", style: "italic" },
    { path: "./fonts/lunchtype/lunchtype22-medium-webfont.woff2", weight: "500 700", style: "normal" },
    { path: "./fonts/lunchtype/lunchtype23-medium-italic-webfont.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-lunchtype",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  // matches the tab title the thread keeps (ThreadProvider), so it doesn't
  // change case on hydration
  title: "Curio",
  description:
    "Public-domain paintings from five museums' open collections. Ask for an artist, a mood or something stranger, and Curio curates a small exhibit. Every work downloads at full resolution.",
  openGraph: {
    title: "Curio",
    description:
      "Public-domain paintings from five museums' open collections, curated by an agent.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Font variables live on <html>: globals.css defines --font-sans on :root
    // as var(--font-lunchtype), which resolves to nothing if the variable is
    // only set further down on <body>.
    <html lang="en" className={`${lunchtype.variable} ${geistMono.variable}`}>
      <body>
        {children}
        {process.env.NODE_ENV === "development" && (
          <Agentation endpoint="http://localhost:4747" />
        )}
      </body>
    </html>
  );
}
