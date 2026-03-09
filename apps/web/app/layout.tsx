import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SourcePilot Agents",
  description: "Configure and monitor autonomous procurement agents."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
