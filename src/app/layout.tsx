import type { Metadata } from "next";
import { VT323 } from "next/font/google";
import "./globals.css";
import "./halloween.css";
import "./fantasy.css";
import { appearanceStartupScript } from "@/lib/appearance";
import ThemeProvider from "@/components/ThemeProvider";
import { getCurrentPlayer } from "@/lib/player";

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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const currentPlayer = await getCurrentPlayer();
  const player = currentPlayer && !currentPlayer.isLocal
    ? { id: currentPlayer.id, preferredLayoutMode: currentPlayer.preferredLayoutMode } : null;
  return (
    <html lang="en" className={terminalFont.variable} data-player-layout={player?.preferredLayoutMode} data-layout-mode={player?.preferredLayoutMode} data-theme={player?.preferredLayoutMode} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceStartupScript }} />
      </head>
      <body><ThemeProvider player={player}>{children}</ThemeProvider></body>
    </html>
  );
}
