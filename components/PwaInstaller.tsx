'use client';

import React, { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, Smartphone, Monitor, CheckCircle2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function PwaInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [swRegistered, setSwRegistered] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Register Service Worker for full PWA compliance
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(() => setSwRegistered(true))
        .catch(() => {});
    }

    const mql = window.matchMedia('(display-mode: standalone)');
    const syncPlatformState = () => {
      const standalone =
        mql.matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standalone);

      const ua = window.navigator.userAgent.toLowerCase();
      const iosDetected =
        /iphone|ipad|ipod/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      setIsIOS(iosDetected);
    };

    const timer = window.setTimeout(syncPlatformState, 0);
    mql.addEventListener('change', syncPlatformState);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowModal(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.clearTimeout(timer);
      mql.removeEventListener('change', syncPlatformState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
      return;
    }
    // Open guided installation modal for iOS Safari or desktop browsers
    setShowModal(true);
  };

  if (isInstalled) {
    return (
      <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>التطبيق مثبّت</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="group relative inline-flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-semibold text-xs sm:text-sm shadow-[0_0_25px_rgba(6,182,212,0.35)] hover:shadow-[0_0_35px_rgba(6,182,212,0.6)] hover:from-cyan-400 hover:to-blue-500 active:scale-[0.98] transition-all cursor-pointer shrink-0 max-w-full"
      >
        <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-950 shrink-0 transition-transform group-hover:-translate-y-0.5" />
        <span className="truncate">
          تثبيت التطبيق<span className="hidden sm:inline"> (Install App)</span>
        </span>
      </button>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              dir="rtl"
              className="relative w-full max-w-md rounded-2xl backdrop-blur-xl bg-slate-900/90 border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.25)] p-6 text-slate-100"
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    {isIOS ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">
                      تثبيت نبض ستريم برو على جهازك
                    </h3>
                    <p className="text-xs text-slate-400">
                      تطبيق ويب تقدمي (PWA) يعمل بكامل الشاشة ويدعم الاستكمال التلقائي
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors"
                  aria-label="إغلاق"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-3">
                  <div className="text-xs font-semibold text-cyan-400">
                    خطوات التثبيت على iPhone / iPad (متصفح Safari):
                  </div>
                  <div className="flex items-start gap-3 text-sm text-slate-200">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 font-mono text-xs flex items-center justify-center shrink-0 mt-0.5">
                      1
                    </span>
                    <p className="leading-relaxed">
                      اضغط على أيقونة <strong>المشاركة (Share)</strong>{' '}
                      <Share className="inline w-4 h-4 text-cyan-400 mx-1" /> في الشريط السفلي لمتصفح
                      سفاري.
                    </p>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-slate-200">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 font-mono text-xs flex items-center justify-center shrink-0 mt-0.5">
                      2
                    </span>
                    <p className="leading-relaxed">
                      مرّر للأسفل واختر{' '}
                      <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>{' '}
                      <PlusSquare className="inline w-4 h-4 text-cyan-400 mx-1" />.
                    </p>
                  </div>
                  <div className="flex items-start gap-3 text-sm text-slate-200">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/20 text-cyan-300 font-mono text-xs flex items-center justify-center shrink-0 mt-0.5">
                      3
                    </span>
                    <p className="leading-relaxed">
                      اضغط على <strong>إضافة (Add)</strong> في أعلى الزاوية ليظهر التطبيق فوراً ضمن
                      تطبيقاتك.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-2">
                  <div className="text-xs font-semibold text-sky-400">
                    على أجهزة Android و الكمبيوتر (Chrome / Edge):
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    اضغط على أيقونة التثبيت في شريط العنوان العلوي للمتصفح أو افتح قائمة المتصفح (⋮)
                    واختر <strong>تثبيت التطبيق (Install App)</strong>.
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>
                    حالة Service Worker: {swRegistered ? 'نشط وجاهز (Active)' : 'قيد التفعيل'}
                  </span>
                  <span>Manifest v1.0</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="mt-5 w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                حسناً، فهمت
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
