import type { Metadata } from "next";
import { Instrument_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "curio",
  description:
    "Search, curate and download public-domain paintings from five museums' open collections, sized for hero backdrops.",
  openGraph: {
    title: "curio",
    description:
      "Public-domain paintings from five museums' open collections, sized for hero backdrops.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${instrument.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
