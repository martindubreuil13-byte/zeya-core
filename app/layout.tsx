import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-zeya-sans",
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-zeya-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zeya",
  description: "A cinematic AI voice companion experience.",
};

export const viewport: Viewport = {
  themeColor: "#0a0709",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${cormorant.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
