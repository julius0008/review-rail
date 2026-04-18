import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Review Rail",
  description:
    "Queue-backed GitHub pull request review assistant with deterministic analyzers and optional local-first LLM augmentation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
