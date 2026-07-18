import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vigil — AI Order Supervisor",
  description: "AI-powered order supervision with Temporal workflows and Groq LLM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
