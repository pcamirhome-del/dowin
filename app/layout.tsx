import type { Metadata, Viewport } from 'next';
import { Cairo, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-cairo',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#070B19',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: 'نبض ستريم برو — محمل الفيديو والصوت 4K متعدد المسارات',
  description:
    'تطبيق ويب تقدمي (PWA) لتحميل الفيديوهات بدقة 4K و 1080p والصوتيات MP3 من يوتيوب، فيسبوك، إنستغرام، تيك توك، وإكس عبر 8 مسارات متوازية مع دعم الإيقاف والاستكمال الدائم.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'نبض ستريم',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/api/icon?size=180',
  },
  openGraph: {
    title: 'نبض ستريم برو — محمل الفيديو والصوت 4K متعدد المسارات',
    description:
      'تحميل فيديوهات يوتيوب وفيسبوك وإنستغرام وتيك توك وإكس بالجودة الحقيقية حتى 4K و MP3 مع تقسيم التحميل إلى 8 مسارات متوازية ودعم الحفظ في الاستوديو.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'نبض ستريم برو — محمل الفيديو والصوت 4K متعدد المسارات',
    description:
      'تحميل فيديوهات يوتيوب وفيسبوك وإنستغرام وتيك توك وإكس بالجودة الحقيقية حتى 4K و MP3 مع تقسيم التحميل إلى 8 مسارات متوازية.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${jetbrainsMono.variable} dark`}>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#070B19] text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-200"
        style={{ fontFamily: 'var(--font-cairo), sans-serif' }}
      >
        {children}
      </body>
    </html>
  );
}
