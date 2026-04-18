import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Observer",
  description:
    "Observer is a pull request oversight workspace that auto-publishes review findings to GitHub and keeps the deeper triage context in one place.",
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
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
