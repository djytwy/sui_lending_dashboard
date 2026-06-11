import type { Metadata } from "next";
import "@mysten/dapp-kit/dist/index.css";
import "./globals.css";
import Providers from "./components/Providers";

export const metadata: Metadata = {
  title: "Sui Stablecoin Yield Dashboard",
  description: "Live APR, APY, deposits, withdrawals, and rewards for stablecoin yield opportunities on Sui.",
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
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
