import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backlog Buster",
  description: "Keep your next game in sight.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
