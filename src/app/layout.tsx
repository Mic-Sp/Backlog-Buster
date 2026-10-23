import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import "./halloween.css";
import "./fantasy.css";
import { appearanceStartupScript } from "@/lib/appearance";
import ThemeProvider from "@/components/ThemeProvider";

const terminalFont = VT323({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-terminal",
});

const siteDescription =
  "Turn your gaming backlog into your next adventure. Track your games, choose what to play next, and earn XP as you complete your library.";
const shareTitle = "Backlog Buster | Your Gaming Backlog Tracker";
const shareImage = {
  url: "/hud-logo.png",
  width: 190,
  height: 189,
  alt: "Backlog Buster logo",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://backlog-buster-chi.vercel.app"),
  title: "Backlog Buster",
  description: siteDescription,
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Backlog Buster",
    title: shareTitle,
    description: siteDescription,
    images: [shareImage],
  },
  twitter: {
    card: "summary",
    title: shareTitle,
    description: siteDescription,
    images: [shareImage],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={terminalFont.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceStartupScript }} />
      </head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
