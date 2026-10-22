import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import "./halloween.css";
import ThemeProvider from "@/components/ThemeProvider";

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
    <html lang="en" className={terminalFont.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem("backlogbuster:theme")==="halloween"?"halloween":"cyberpunk"}catch{}` }} />
      </head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
