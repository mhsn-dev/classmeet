import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Vazirmatn is loaded via CDN at runtime (works everywhere, including Iran);
// a system-font fallback stack is defined in globals.css.
const VAZIRMATN_CDN =
  "https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css";

export const metadata: Metadata = {
  title: "کلاس‌میت | برگزاری کلاس آنلاین",
  description:
    "سیستم برگزاری کلاس آنلاین مشابه گوگل میت؛ سبک و کم‌مصرف با ویدئوکنفرانس، چت زنده و اشتراک صفحه تا ۱۸ نفر",
  keywords: ["کلاس آنلاین", "ویدئوکنفرانس", "کلاس مجازی", "WebRTC", "جلسه آنلاین"],
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1f21",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href={VAZIRMATN_CDN} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
