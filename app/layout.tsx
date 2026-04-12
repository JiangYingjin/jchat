import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import "./styles/monaco-editor-global.css"; // 🚀 Monaco Editor全局样式
import "./styles/monaco-editor.module.scss"; // 🚀 Monaco Editor模块化样式
import type { Metadata, Viewport } from "next";
import { Noto_Sans } from "next/font/google";
import { AutoBackupScheduler } from "./components/auto-backup-scheduler";

const notoSans = Noto_Sans({
  weight: ["300", "400", "700", "900"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-noto-sans",
  adjustFontFallback: true,
});

export const metadata: Metadata = {
  title: "JChat",
  appleWebApp: {
    title: "JChat",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fafafa",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={notoSans.variable}>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <link rel="manifest" href="/site.webmanifest"></link>
        <script src="/serviceWorkerRegister.js" defer></script>
      </head>
      <body>
        {children}
        <AutoBackupScheduler />
      </body>
    </html>
  );
}
