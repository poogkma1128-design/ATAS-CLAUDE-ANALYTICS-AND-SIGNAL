import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATAS Signal Board",
  description: "Order flow signals streamed from ATAS, scored automatically.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
