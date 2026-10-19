import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";

const terminalFont = VT323({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-terminal",
});

export const metadata: Metadata = {
  title: "Backlog Buster",
  description: "Keep your next game in sight.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={terminalFont.variable}>
      <body>{children}</body>
    </html>
  );
}
