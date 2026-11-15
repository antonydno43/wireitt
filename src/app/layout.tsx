import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WireItt — Wire up your automations",
  description:
    "WireItt is a visual automation platform. Connect triggers to actions on a wiring canvas and let your daily tasks run themselves — webhooks, schedules, HTTP calls, smart routing and more.",
  keywords: ["automation", "workflow", "no-code", "webhooks", "scheduler", "Zapier alternative", "WireItt"],
  authors: [{ name: "WireItt" }],
  openGraph: {
    title: "WireItt — Wire up your automations",
    description: "Build automations by wiring triggers to actions. Fast, visual, powerful.",
    siteName: "WireItt",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        {children}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
