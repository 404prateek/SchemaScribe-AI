import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SchemaScribe AI | Intelligent Data Intelligence Platform",
  description:
    "Upload any dataset or connect a live database to get AI-powered schema documentation, ERD diagrams, data quality reports, SQL DDL generation, and natural language chat.",
  keywords: ["data dictionary", "schema profiling", "ERD diagram", "AI data analysis", "database documentation"],
  openGraph: {
    title: "SchemaScribe AI",
    description: "Turn any database or dataset into instant intelligence.",
    type: "website",
  },
};

import { ThemeProvider } from "@/components/ThemeProvider";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">
        <SessionProvider session={session}>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
