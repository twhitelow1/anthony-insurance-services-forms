import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Anthony Insurance Services — Applications",
  description: "Secure online insurance applications for Anthony Insurance Services.",
  robots: { index: false, follow: false },
  // The AIS "ais" box, as on anthonyinsuranceservices.com (swap for a bundled file when we have the original).
  icons: { icon: "https://anthonyinsuranceservices.com/favicon.ico", apple: "https://anthonyinsuranceservices.com/favicon.ico" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
