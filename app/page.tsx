'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  ClipboardPaste,
  Copy,
  Check,
  Play,
  Pause,
  Trash2,
  FolderOpen,
  Share2,
  Layers,
  History,
  Cpu,
  Music,
  Film,
  Sparkles,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  ListPlus,
  Sliders,
  Globe,
  ExternalLink,
  HardDrive,
  ListVideo,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PwaInstaller } from '@/components/PwaInstaller';
import type {
  ExtractedMediaResult,
  ExtractedPlaylistResult,
  MediaFormatOption,
  PlaylistVideoItem,
  SupportedPlatform,
} from '@/app/api/extract/route';
import {
  DownloadQueueManager,
  DownloadTaskSnapshot,
  HistoryRecord,
  SaveMethod,
  clearAllDownloadHistory,
  deleteHistoryItem,
  formatBytes,
  formatDuration,
  getDownloadHistory,
  resaveFromHistory,
  NUM_THREADS,
} from '@/lib/idmDownloader';

interface BatchQueueItem {
  id: string;
  url: string;
  platform: SupportedPlatform;
  status: 'pending' | 'probing' | 'ready' | 'queued' | 'error';
  title?: string;
  author?: string;
  thumbnail?: string;
  duration?: number;
  extracted?: ExtractedMediaResult;
  selectedFormatId?: string;
  error?: string;
}

const PLATFORM_NAMES: Record<SupportedPlatform, string> = {
  youtube: 'YouTube · يوتيوب',
  facebook: 'Facebook · فيسبوك',
  instagram: 'Instagram · إنستغرام',
  tiktok: 'TikTok · تيك توك',
  twitter: 'X (Twitter) · إكس',
  direct: 'Direct Stream · رابط مباشر',
};

function detectClientPlatform(url: string): SupportedPlatform {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.includes('instagram.com') || lower.includes('instagr.am')) return 'instagram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
  return 'direct';
}

function isYouTubePlaylistUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (lower.includes('youtube.com') || lower.includes('youtu.be')) && /[?&]list=[a-z0-9_-]+/i.test(url);
}

export default function HomePage() {
  // Navigation & Mode State
  const [activeTab, setActiveTab] = useState<'single' | 'batch' | 'active' | 'history'>('single');
  const [dir, setDir] = useState<'rtl' | 'ltr'>('rtl');

  // Single Link Extraction State
  const [singleUrl, setSingleUrl] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [extractedMedia, setExtractedMedia] = useState<ExtractedMediaResult | null>(null);
  const [selectedFormatId, setSelectedFormatId] = useState<string>('');
  const [saveMethod, setSaveMethod] = useState<SaveMethod>('auto');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<Record<string, boolean>>({});

  // Batch Queue & YouTube Playlist Extraction State (Up to 50 Links)
  const [batchRawText, setBatchRawText] = useState('');
  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isExtractingPlaylist, setIsExtractingPlaylist] = useState(false);
  const [playlistFeedback, setPlaylistFeedback] = useState<{
    type: 'loading' | 'success' | 'error';
    message: string;
    subMessage?: string;
  } | null>(null);
  const [globalDefaultQuality, setGlobalDefaultQuality] = useState<string>('best');
  const [queueMode, setQueueMode] = useState<'sequential' | 'concurrent'>('sequential');
  const [concurrencyLimit, setConcurrencyLimit] = useState<number>(2);

  // Active IDM Tasks & History State
  const queueManagerRef = useRef<DownloadQueueManager | null>(null);
  const [tasks, setTasks] = useState<DownloadTaskSnapshot[]>([]);
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    const manager = new DownloadQueueManager();
    queueManagerRef.current = manager;

    const unsubscribe = manager.subscribe((updatedTasks) => {
      setTasks([...updatedTasks]);
      getDownloadHistory()
        .then((hist) => setHistoryList(hist))
        .catch(() => {});
    });

    manager.restoreIncompleteTasksFromIndexedDB().catch(() => {});
    getDownloadHistory()
      .then((hist) => setHistoryList(hist))
      .catch(() => {});

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!queueManagerRef.current) return;
    const effectiveLimit = queueMode === 'sequential' ? 1 : concurrencyLimit;
    queueManagerRef.current.setConcurrency(effectiveLimit);
  }, [queueMode, concurrencyLimit]);

  useEffect(() => {
    if (!queueManagerRef.current) return;
    queueManagerRef.current.setSaveMethod(saveMethod);
  }, [saveMethod]);

  const copyToClipboard = async (text: string, key: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      showToast('تم نسخ الرابط إلى الحافظة بنجاح');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      showToast('تعذر النسخ تلقائياً — يرجى النسخ يدوياً');
    }
  };

  const handlePasteClipboard = async (target: 'single' | 'batch') => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showToast('الحافظة فارغة حالياً');
        return;
      }
      if (target === 'single') {
        const clean = text.trim().split(/\r?\n/)[0].trim();
        setSingleUrl(clean);
        showToast('تم لصق الرابط — جاري الفحص...');
        await handleProbeSingleUrl(clean);
      } else {
        const pasted = text.trim();
        const nextRaw = batchRawText ? `${batchRawText}\n${pasted}` : pasted;
        setBatchRawText(nextRaw);
        showToast('تم لصق الرابط في قائمة الدفعة');

        // Auto-detect if user pasted a YouTube Playlist link into the batch queue
        const pastedLines = pasted
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('http://') || l.startsWith('https://'));
        if (pastedLines.some((l) => isYouTubePlaylistUrl(l))) {
          await handleExpandPlaylistsInBatch(nextRaw, false);
        }
      }
    } catch {
      showToast('يرجى السماح بصلاحية الحافظة أو اللصق المباشر باستخدام Ctrl+V');
    }
  };

  const handleProbeSingleUrl = async (overrideUrl?: string) => {
    const urlToProbe = (overrideUrl ?? singleUrl).trim();
    if (!urlToProbe) {
      setProbeError('يرجى لصق رابط فيديو من يوتيوب، فيسبوك، إنستغرام، تيك توك، أو إكس أولاً.');
      return;
    }

    setIsProbing(true);
    setProbeError(null);
    setExtractedMedia(null);

    const isPl = isYouTubePlaylistUrl(urlToProbe);
    if (isPl) {
      setIsExtractingPlaylist(true);
      setPlaylistFeedback({
        type: 'loading',
        message: 'Extracting Playlist... please wait',
        subMessage: 'جاري استخراج قائمة التشغيل وفك جميع الفيديوهات... يرجى الانتظار',
      });
    }

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlToProbe }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'تعذر استخراج الجودات من هذا الرابط.');
      }

      // Check if backend detected and returned a YouTube Playlist
      if (data.isPlaylist === true && Array.isArray(data.items)) {
        const plData = data as ExtractedPlaylistResult;
        const expandedVideos = plData.items.slice(0, 50);
        const expandedUrls = expandedVideos.map((v) => v.url).join('\n');

        setBatchRawText(expandedUrls);
        const newBatchItems: BatchQueueItem[] = expandedVideos.map((v, idx) => ({
          id: `pl-${Date.now()}-${idx}`,
          url: v.url,
          platform: 'youtube',
          status: 'pending',
          title: v.title,
          author: v.author,
          thumbnail: v.thumbnail,
          duration: v.duration,
        }));
        setBatchItems(newBatchItems);
        setPlaylistFeedback({
          type: 'success',
          message: `Added ${expandedVideos.length} videos from playlist`,
          subMessage: `تمت إضافة ${expandedVideos.length} فيديو من قائمة التشغيل "${plData.title}" إلى الطابور بنجاح`,
        });
        showToast(`Added ${expandedVideos.length} videos from playlist (${plData.title})`);
        setActiveTab('batch');
        return;
      }

      const result = data as ExtractedMediaResult;
      setExtractedMedia(result);
      if (result.formats.length > 0) {
        setSelectedFormatId(result.formats[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بمحرك الاستخراج.';
      setProbeError(msg);
      if (isPl) {
        setPlaylistFeedback({
          type: 'error',
          message: msg,
        });
      }
    } finally {
      setIsProbing(false);
      setIsExtractingPlaylist(false);
    }
  };

  const handleStartSingleDownload = (formatOverride?: MediaFormatOption) => {
    if (!extractedMedia || !queueManagerRef.current) return;
    const chosenFormat =
      formatOverride ||
      extractedMedia.formats.find((f) => f.id === selectedFormatId) ||
      extractedMedia.formats[0];

    if (!chosenFormat) return;

    queueManagerRef.current.enqueueTask({
      sourceUrl: extractedMedia.url,
      title: extractedMedia.title,
      author: extractedMedia.author,
      thumbnail: extractedMedia.thumbnail,
      platform: extractedMedia.platform,
      format: chosenFormat,
      autoStart: true,
    });

    showToast(`بدأ تحميل "${extractedMedia.title.slice(0, 35)}..." عبر 8 مسارات متوازية`);
    setActiveTab('active');
  };

  // ============================================================================
  // BATCH QUEUE & YOUTUBE PLAYLIST AUTO-EXPANSION (UP TO 50 LINKS)
  // ============================================================================
  const parsedBatchLines = batchRawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('http://') || l.startsWith('https://'))
    .slice(0, 50);

  const hasPlaylistInBatchInput = parsedBatchLines.some((l) => isYouTubePlaylistUrl(l));

  const pickBestFormatForPreference = (
    formats: MediaFormatOption[],
    preference: string
  ): MediaFormatOption => {
    if (preference === 'MP3') {
      const mp3 = formats.find((f) => f.type === 'audio' || f.resolution === 'MP3');
      if (mp3) return mp3;
    }
    if (preference !== 'best') {
      const targetHeight = parseInt(preference, 10);
      if (!isNaN(targetHeight)) {
        const exact = formats.find((f) => f.height === targetHeight);
        if (exact) return exact;
        const lowerOrEqual = formats
          .filter((f) => f.type === 'video' && (f.height || 0) <= targetHeight)
          .sort((a, b) => (b.height || 0) - (a.height || 0));
        if (lowerOrEqual.length > 0) return lowerOrEqual[0];
      }
    }
    return formats.find((f) => f.type === 'video') || formats[0];
  };

  /**
   * Detects any YouTube playlist links (`list=`) in the batch textarea, calls `/api/extract`,
   * auto-expands up to 50 individual video links, updates the textarea & queue items,
   * and optionally proceeds to probe/download all expanded items.
   */
  const handleExpandPlaylistsInBatch = async (
    rawInputOverride?: string,
    probeFormatsAfterExpand = false,
    autoEnqueueAll = false
  ): Promise<BatchQueueItem[] | null> => {
    const sourceText = rawInputOverride ?? batchRawText;
    const rawLines = sourceText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http://') || l.startsWith('https://'));

    if (rawLines.length === 0) {
      showToast('يرجى إدخال رابط واحد على الأقل يبدأ بـ https://');
      return null;
    }

    const containsPlaylist = rawLines.some((l) => isYouTubePlaylistUrl(l));

    if (containsPlaylist) {
      setIsExtractingPlaylist(true);
      setPlaylistFeedback({
        type: 'loading',
        message: 'Extracting Playlist... please wait',
        subMessage: 'جاري استخراج قائمة التشغيل وفك الروابط الفردية... يرجى الانتظار',
      });
    }

    const expandedList: Array<{
      url: string;
      platform: SupportedPlatform;
      meta?: PlaylistVideoItem;
    }> = [];
    let totalAddedFromPlaylists = 0;
    let lastPlaylistTitle = '';

    try {
      for (const lineUrl of rawLines) {
        if (expandedList.length >= 50) break;

        if (isYouTubePlaylistUrl(lineUrl)) {
          const res = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: lineUrl }),
          });
          const data = await res.json();

          if (!res.ok || data.error) {
            throw new Error(data.error || 'تعذر استخراج قائمة التشغيل');
          }

          if (data.isPlaylist === true && Array.isArray(data.items)) {
            const pl = data as ExtractedPlaylistResult;
            lastPlaylistTitle = pl.title;
            const remainingSlots = Math.max(0, 50 - expandedList.length);
            const slice = pl.items.slice(0, remainingSlots);
            for (const videoItem of slice) {
              expandedList.push({
                url: videoItem.url,
                platform: 'youtube',
                meta: videoItem,
              });
            }
            totalAddedFromPlaylists += slice.length;
          } else {
            // Single video fallback
            const single = data as ExtractedMediaResult;
            expandedList.push({
              url: single.url || lineUrl,
              platform: single.platform || detectClientPlatform(lineUrl),
              meta: {
                id: single.id,
                url: single.url || lineUrl,
                title: single.title,
                author: single.author,
                duration: single.duration,
                thumbnail: single.thumbnail,
              },
            });
          }
        } else {
          expandedList.push({
            url: lineUrl,
            platform: detectClientPlatform(lineUrl),
          });
        }
      }

      const finalExpanded = expandedList.slice(0, 50);

      // Update textarea with expanded individual video URLs
      setBatchRawText(finalExpanded.map((item) => item.url).join('\n'));

      const populatedItems: BatchQueueItem[] = finalExpanded.map((entry, idx) => ({
        id: `batch-${Date.now()}-${idx}`,
        url: entry.url,
        platform: entry.platform,
        status: probeFormatsAfterExpand ? 'probing' : 'pending',
        title: entry.meta?.title,
        author: entry.meta?.author,
        thumbnail: entry.meta?.thumbnail,
        duration: entry.meta?.duration,
      }));

      setBatchItems(populatedItems);

      if (totalAddedFromPlaylists > 0) {
        const successMsg = `Added ${totalAddedFromPlaylists} videos from playlist`;
        setPlaylistFeedback({
          type: 'success',
          message: successMsg,
          subMessage: `تمت إضافة ${totalAddedFromPlaylists} فيديو من قائمة التشغيل${
            lastPlaylistTitle ? ` "${lastPlaylistTitle}"` : ''
          } إلى طابور الدفعات بنجاح`,
        });
        showToast(`${successMsg} · تمت إضافة ${totalAddedFromPlaylists} فيديو للطابور`);
      }

      setIsExtractingPlaylist(false);

      if (probeFormatsAfterExpand) {
        await probeBatchQueueItems(populatedItems, autoEnqueueAll);
      }

      return populatedItems;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'تعذر استخراج قائمة التشغيل';
      setIsExtractingPlaylist(false);
      setPlaylistFeedback({
        type: 'error',
        message: msg,
      });
      showToast(msg);
      return null;
    }
  };

  const probeBatchQueueItems = async (itemsToProbe: BatchQueueItem[], autoEnqueueAll: boolean) => {
    setIsBatchProcessing(true);

    setBatchItems((prev) =>
      prev.map((p) =>
        itemsToProbe.some((target) => target.id === p.id) ? { ...p, status: 'probing' } : p
      )
    );

    for (let i = 0; i < itemsToProbe.length; i++) {
      const item = itemsToProbe[i];
      try {
        const res = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url, ignorePlaylist: true }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error || 'فشل استخراج الرابط');
        }
        const extracted = data as ExtractedMediaResult;
        const chosenFormat = pickBestFormatForPreference(extracted.formats, globalDefaultQuality);

        setBatchItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? {
                  ...p,
                  status: autoEnqueueAll ? 'queued' : 'ready',
                  title: extracted.title || p.title,
                  author: extracted.author || p.author,
                  thumbnail: extracted.thumbnail || p.thumbnail,
                  duration: extracted.duration || p.duration,
                  extracted,
                  selectedFormatId: chosenFormat.id,
                }
              : p
          )
        );

        if (autoEnqueueAll && queueManagerRef.current && chosenFormat) {
          queueManagerRef.current.enqueueTask({
            sourceUrl: extracted.url,
            title: extracted.title,
            author: extracted.author,
            thumbnail: extracted.thumbnail,
            platform: extracted.platform,
            format: chosenFormat,
            autoStart: true,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'تعذر استخراج الرابط';
        setBatchItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: msg } : p))
        );
      }
    }

    setIsBatchProcessing(false);
    if (autoEnqueueAll) {
      showToast(`تمت جدولة الدفعة (${itemsToProbe.length} فيديو) في محرك التحميل`);
      setActiveTab('active');
    } else {
      showToast('اكتمل فحص روابط الدفعة — يمكنك تخصيص الجودات أو بدء التحميل الكامل');
    }
  };

  const handleProbeBatchLinks = async (autoEnqueueAll = false) => {
    if (parsedBatchLines.length === 0) {
      showToast('يرجى إدخال رابط واحد على الأقل يبدأ بـ https://');
      return;
    }

    // If any line is a YouTube playlist, auto-expand first and then probe/enqueue
    if (hasPlaylistInBatchInput) {
      await handleExpandPlaylistsInBatch(batchRawText, true, autoEnqueueAll);
      return;
    }

    // If we already have expanded batchItems matching the current URLs, probe those directly
    const currentUrlsKey = parsedBatchLines.join('|');
    const existingUrlsKey = batchItems.map((b) => b.url).join('|');

    if (batchItems.length > 0 && currentUrlsKey === existingUrlsKey) {
      await probeBatchQueueItems(batchItems, autoEnqueueAll);
      return;
    }

    const initialItems: BatchQueueItem[] = parsedBatchLines.map((url, idx) => ({
      id: `batch-${Date.now()}-${idx}`,
      url,
      platform: detectClientPlatform(url),
      status: 'probing',
    }));
    setBatchItems(initialItems);
    await probeBatchQueueItems(initialItems, autoEnqueueAll);
  };

  const handleProbeSingleBatchItem = async (item: BatchQueueItem, autoStartDownload = false) => {
    setBatchItems((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: 'probing', error: undefined } : p))
    );

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, ignorePlaylist: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'تعذر استخراج الجودات');
      }
      const extracted = data as ExtractedMediaResult;
      const chosenFormat = pickBestFormatForPreference(extracted.formats, globalDefaultQuality);

      setBatchItems((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? {
                ...p,
                status: autoStartDownload ? 'queued' : 'ready',
                title: extracted.title || p.title,
                author: extracted.author || p.author,
                thumbnail: extracted.thumbnail || p.thumbnail,
                duration: extracted.duration || p.duration,
                extracted,
                selectedFormatId: chosenFormat.id,
              }
            : p
        )
      );

      if (autoStartDownload && queueManagerRef.current && chosenFormat) {
        queueManagerRef.current.enqueueTask({
          sourceUrl: extracted.url,
          title: extracted.title,
          author: extracted.author,
          thumbnail: extracted.thumbnail,
          platform: extracted.platform,
          format: chosenFormat,
          autoStart: true,
        });
        showToast(`تم إرسال "${extracted.title.slice(0, 30)}..." إلى محرك التحميل`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل الفحص';
      setBatchItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: 'error', error: msg } : p))
      );
    }
  };

  const handleStartReadyBatchItems = async () => {
    if (!queueManagerRef.current) return;

    // If there are pending (unprobed) items from an expanded playlist, probe & enqueue them automatically
    const pendingItems = batchItems.filter((item) => item.status === 'pending');
    const readyItems = batchItems.filter(
      (item) => (item.status === 'ready' || item.status === 'queued') && item.extracted
    );

    let count = 0;
    for (const item of readyItems) {
      if (item.extracted) {
        const fmt =
          item.extracted.formats.find((f) => f.id === item.selectedFormatId) ||
          pickBestFormatForPreference(item.extracted.formats, globalDefaultQuality);
        if (fmt) {
          queueManagerRef.current.enqueueTask({
            sourceUrl: item.extracted.url,
            title: item.extracted.title,
            author: item.extracted.author,
            thumbnail: item.extracted.thumbnail,
            platform: item.extracted.platform,
            format: fmt,
            autoStart: true,
          });
          count++;
        }
      }
    }

    if (count > 0) {
      setBatchItems((prev) =>
        prev.map((p) => (p.status === 'ready' ? { ...p, status: 'queued' } : p))
      );
      showToast(`تم إرسال ${count} فيديو إلى طابور التحميل المتعدد`);
    }

    if (pendingItems.length > 0) {
      await probeBatchQueueItems(pendingItems, true);
      return;
    }

    if (count > 0) {
      setActiveTab('active');
    }
  };

  // Active metrics summary
  const activeDownloadingTasks = tasks.filter(
    (t) => t.status === 'downloading' || t.status === 'probing' || t.status === 'muxing'
  );
  const totalSpeedBps = activeDownloadingTasks.reduce((acc, t) => acc + (t.speedBps || 0), 0);

  return (
    <div
      dir={dir}
      className="w-full max-w-full min-h-screen bg-[#070B19] text-slate-100 relative overflow-x-hidden flex flex-col"
    >
      {/* Ambient Deep Navy & Cyan Glow Backdrop (No hardcoded pixel widths) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden w-full max-w-full"
      >
        <div className="absolute -top-24 right-1/4 w-64 h-64 sm:w-96 sm:h-96 max-w-full rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-64 h-64 sm:w-96 sm:h-96 max-w-full rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-20 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-50 max-w-md mx-auto px-4 py-2.5 rounded-xl backdrop-blur-xl bg-slate-900/95 border border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.3)] text-xs sm:text-sm font-medium text-cyan-100 flex items-center gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="break-words">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Navigation Bar (Mobile-First Safe Wrapping) */}
      <header className="sticky top-0 z-40 w-full max-w-full backdrop-blur-xl bg-[#070B19]/85 border-b border-cyan-500/20">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 min-h-16 py-2.5 flex items-center justify-between gap-2 sm:gap-6">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('single');
            }}
            className="text-base sm:text-xl font-bold tracking-tight text-white hover:text-cyan-300 transition-colors truncate"
          >
            نبض ستريم برو
          </a>

          {/* Zone 2: Desktop Workspace Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              type="button"
              onClick={() => setActiveTab('single')}
              className={`py-1 transition-colors cursor-pointer border-b-2 ${
                activeTab === 'single'
                  ? 'text-cyan-400 border-cyan-400'
                  : 'border-transparent hover:text-white'
              }`}
            >
              التحميل الفردي
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('batch')}
              className={`py-1 transition-colors cursor-pointer border-b-2 ${
                activeTab === 'batch'
                  ? 'text-cyan-400 border-cyan-400'
                  : 'border-transparent hover:text-white'
              }`}
            >
              الدفعات وقوائم التشغيل (50 رابط)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`py-1 transition-colors cursor-pointer border-b-2 ${
                activeTab === 'active'
                  ? 'text-cyan-400 border-cyan-400'
                  : 'border-transparent hover:text-white'
              }`}
            >
              مُسرّع المسارات ({tasks.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`py-1 transition-colors cursor-pointer border-b-2 ${
                activeTab === 'history'
                  ? 'text-cyan-400 border-cyan-400'
                  : 'border-transparent hover:text-white'
              }`}
            >
              سجل التحميلات ({historyList.length})
            </button>
          </nav>

          {/* Zone 3: Smart Universal PWA Installer */}
          <div className="flex items-center shrink-0 max-w-full">
            <PwaInstaller />
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-5 sm:py-10 space-y-6 sm:space-y-8 overflow-x-hidden">
        {/* Hero Header & Mode Switcher */}
        <section className="w-full flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-5 sm:pb-6 border-b border-slate-800/80">
          <div className="space-y-2.5 w-full max-w-2xl">
            <p className="text-xs sm:text-sm font-medium text-cyan-400 break-words">
              YouTube (Videos & Playlists) · Facebook · Instagram · TikTok · X (Twitter)
            </p>
            <h1 className="text-xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight leading-snug break-words">
              محرك التحميل المتوازي 8-Threads بدقة 4K الحقيقية ودمج FFmpeg.wasm
            </h1>
            <p className="text-xs sm:text-base text-slate-300 leading-relaxed break-words">
              فحص فوري للجودات الفعلية المتوفرة على الفيديو من 144p حتى 2160p (4K) و MP3 320kbps،
              مع استخراج قوائم تشغيل يوتيوب الكاملة وتقسيم الملف إلى 8 أجزاء متوازية في IndexedDB.
            </p>
          </div>

          {/* Mobile-First Mode Switcher (2x2 Grid on Mobile, Row on sm+) & RTL/LTR Toggle */}
          <div className="w-full lg:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            <div className="w-full sm:w-auto grid grid-cols-2 sm:flex sm:flex-row items-stretch sm:items-center gap-1.5 p-1.5 rounded-xl bg-slate-900/80 border border-cyan-500/25">
              <button
                type="button"
                onClick={() => setActiveTab('single')}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  activeTab === 'single'
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                رابط فردي
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('batch')}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  activeTab === 'batch'
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                دفعة / Playlist
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  activeTab === 'active'
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                المسارات ({tasks.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                  activeTab === 'history'
                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                السجل ({historyList.length})
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDir((d) => (d === 'rtl' ? 'ltr' : 'rtl'))}
              className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-cyan-500/40 text-xs font-medium text-slate-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              title="تبديل اتجاه الواجهة RTL / LTR"
            >
              <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>{dir === 'rtl' ? 'RTL · عربي' : 'LTR · اتجاه'}</span>
            </button>
          </div>
        </section>

        {/* Global Save Destination & Active Speed Bar */}
        <section className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 shadow-[0_0_25px_rgba(6,182,212,0.12)] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="w-full lg:w-auto flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
            <span className="text-xs font-semibold text-slate-300 flex items-center gap-2 shrink-0">
              <FolderOpen className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>وجهة حفظ الملفات على جهازك:</span>
            </span>
            <div className="w-full sm:w-auto flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSaveMethod('auto');
                  showToast('تم تفعيل الحفظ الذكي التلقائي');
                }}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-center break-words ${
                  saveMethod === 'auto'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                حفظ ذكي تلقائي
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveMethod('picker');
                  showToast('سيتم فتح نافذة اختيار المسار والمجلد (showSaveFilePicker) عند الحفظ');
                }}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-center break-words ${
                  saveMethod === 'picker'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                اختيار مسار ومجلد مخصص (PC / Android)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveMethod('share');
                  showToast('سيتم فتح مشاركة وحفظ الاستوديو / المعرض (iOS & Android Gallery)');
                }}
                className={`w-full sm:w-auto px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer text-center break-words ${
                  saveMethod === 'share'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-950/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                حفظ للاستوديو / مدير الملفات (الجوال)
              </button>
            </div>
          </div>

          <div className="w-full lg:w-auto flex flex-wrap items-center justify-between sm:justify-start gap-3 sm:gap-5 text-xs text-slate-300 font-mono tabular-nums border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800">
            <div>
              <span className="text-slate-400 font-sans">السرعة الإجمالية: </span>
              <span className="text-cyan-400 font-semibold">
                {(totalSpeedBps / (1024 * 1024)).toFixed(2)} MB/s
              </span>
            </div>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <div>
              <span className="text-slate-400 font-sans">المسارات المتوازية: </span>
              <span className="text-white font-semibold">{NUM_THREADS} Threads / File</span>
            </div>
          </div>
        </section>

        {/* ===================================================================== */}
        {/* TAB 1: SINGLE VIDEO / AUDIO DOWNLOADER & DYNAMIC QUALITY PROBER       */}
        {/* ===================================================================== */}
        {activeTab === 'single' && (
          <div className="w-full max-w-full space-y-6">
            <div className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 shadow-[0_0_25px_rgba(6,182,212,0.18)] p-4 sm:p-6 md:p-7 space-y-5 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label htmlFor="single-url-input" className="text-sm sm:text-base font-bold text-white break-words">
                  أدخل رابط الفيديو أو قائمة التشغيل للفحص الفوري
                </label>
                <span className="text-xs text-slate-400 break-words">
                  {singleUrl
                    ? isYouTubePlaylistUrl(singleUrl)
                      ? 'تم اكتشاف: قائمة تشغيل يوتيوب (YouTube Playlist)'
                      : `المنصة المكتشفة: ${PLATFORM_NAMES[detectClientPlatform(singleUrl)]}`
                    : 'يدعم روابط YouTube (فيديو أو Playlist), Facebook, Instagram, TikTok, X'}
                </span>
              </div>

              {/* Mobile-First Input & Action Buttons Stack */}
              <div className="w-full flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
                <div className="relative w-full flex-1 min-w-0 flex items-center">
                  <input
                    id="single-url-input"
                    type="url"
                    dir="ltr"
                    value={singleUrl}
                    onChange={(e) => setSingleUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleProbeSingleUrl();
                    }}
                    placeholder="https://www.youtube.com/watch?v=... أو رابط Playlist / فيسبوك / تيك توك"
                    className="w-full max-w-full h-12 sm:h-13 pl-3 sm:pl-4 pr-16 rounded-xl bg-[#070B19]/90 border border-cyan-500/30 focus:border-cyan-400 focus:outline-none text-xs sm:text-sm text-white placeholder:text-slate-500 font-mono transition-colors"
                  />
                  {singleUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setSingleUrl('');
                        setExtractedMedia(null);
                        setProbeError(null);
                      }}
                      className="absolute right-2.5 px-2 py-1 rounded-md text-xs text-slate-400 hover:text-white bg-slate-800/90 cursor-pointer"
                    >
                      مسح
                    </button>
                  )}
                </div>

                {/* Responsive Buttons: Stacked on mobile, row on sm+ */}
                <div className="w-full lg:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                  <div className="grid grid-cols-2 sm:flex sm:flex-row gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => handlePasteClipboard('single')}
                      className="w-full sm:w-auto h-11 sm:h-13 px-3.5 sm:px-4 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-cyan-500/30 text-cyan-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
                    >
                      <ClipboardPaste className="w-4 h-4 shrink-0" />
                      <span>لصق الرابط</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => copyToClipboard(singleUrl, 'single-input')}
                      disabled={!singleUrl}
                      className="w-full sm:w-auto h-11 sm:h-13 px-3.5 sm:px-4 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 disabled:opacity-40 border border-slate-700 text-slate-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer"
                    >
                      {copiedKey === 'single-input' ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <Copy className="w-4 h-4 shrink-0" />
                      )}
                      <span>نسخ الرابط</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleProbeSingleUrl()}
                    disabled={isProbing}
                    className="w-full sm:w-auto h-12 sm:h-13 px-5 sm:px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 text-slate-950 font-bold text-xs sm:text-sm shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {isProbing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                        <span>
                          {isExtractingPlaylist ? 'Extracting Playlist...' : 'جاري فحص الجودات...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 shrink-0" />
                        <span>فحص الجودات والتحميل</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Real Test Streams Bar */}
              <div className="w-full flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2 pt-1 text-xs text-slate-400">
                <span className="font-medium text-slate-300">روابط حقيقية للتجربة السريعة:</span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const testUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
                      setSingleUrl(testUrl);
                      handleProbeSingleUrl(testUrl);
                    }}
                    className="text-cyan-400 hover:underline cursor-pointer text-right break-words"
                  >
                    فيديو يوتيوب 4K (Big Buck Bunny 60fps)
                  </button>
                  <span aria-hidden="true" className="hidden sm:inline">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
                      setSingleUrl(testUrl);
                      handleProbeSingleUrl(testUrl);
                    }}
                    className="text-cyan-400 hover:underline cursor-pointer text-right break-words"
                  >
                    فيديو يوتيوب كلاسيكي (Me at the zoo)
                  </button>
                  <span aria-hidden="true" className="hidden sm:inline">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const testUrl =
                        'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
                      setSingleUrl(testUrl);
                      handleProbeSingleUrl(testUrl);
                    }}
                    className="text-cyan-400 hover:underline cursor-pointer text-right break-words"
                  >
                    بث مباشر فائق السرعة (HTTP 206 Range MP4)
                  </button>
                </div>
              </div>

              {probeError && (
                <div className="w-full rounded-xl bg-red-950/50 border border-red-500/40 p-4 flex items-start gap-3 text-red-200 text-sm">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="font-semibold break-words">تعذر استخراج الجودات</p>
                    <p className="text-xs text-red-300 leading-relaxed break-words">{probeError}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Probed Video Metadata & Dynamically Filtered Qualities */}
            {extractedMedia && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.2)] p-4 sm:p-6 md:p-7 space-y-6 overflow-hidden"
              >
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  {/* Thumbnail & Source Info */}
                  <div className="lg:col-span-5 space-y-4 w-full min-w-0">
                    <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                      {extractedMedia.thumbnail && !thumbFailed[extractedMedia.id] ? (
                        <img
                          src={`/api/proxy?url=${encodeURIComponent(extractedMedia.thumbnail)}`}
                          alt={extractedMedia.title}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setThumbFailed((prev) => ({ ...prev, [extractedMedia.id]: true }))
                          }
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-[#070B19] to-cyan-950/40 p-4 text-center">
                          <Film className="w-10 h-10 text-cyan-400 mb-2 shrink-0" />
                          <span className="text-xs text-slate-300 line-clamp-2 break-words">
                            {extractedMedia.title}
                          </span>
                        </div>
                      )}
                      {extractedMedia.duration > 0 && (
                        <div className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-md bg-slate-950/85 text-white font-mono text-xs tabular-nums">
                          {formatDuration(extractedMedia.duration)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-cyan-400 break-words">
                        <span>{PLATFORM_NAMES[extractedMedia.platform]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{extractedMedia.author}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-400">{extractedMedia.resolverEngine}</span>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-white leading-snug break-words">
                        {extractedMedia.title}
                      </h2>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(extractedMedia.url, 'extracted-url')}
                          className="text-xs text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                          <span>نسخ رابط المصدر</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Dynamic Quality Selection Grid */}
                  <div className="lg:col-span-7 space-y-5 w-full min-w-0">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm sm:text-base font-bold text-white break-words">
                          الجودات الفعلية المتوفرة لهذا الفيديو ({extractedMedia.formats.length})
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5 break-words">
                          يتم عرض الدقات المتاحة حقيقياً فقط من المصدر الأصلي مع حجم كل جودة
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                      {extractedMedia.formats.map((fmt) => {
                        const isSelected = fmt.id === selectedFormatId;
                        const isAudio = fmt.type === 'audio';
                        return (
                          <div
                            key={fmt.id}
                            onClick={() => setSelectedFormatId(fmt.id)}
                            className={`w-full rounded-xl p-3 sm:p-3.5 border transition-all cursor-pointer flex items-center justify-between gap-2.5 ${
                              isSelected
                                ? 'bg-cyan-500/15 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]'
                                : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0 ${
                                  isAudio
                                    ? 'bg-purple-500/15 text-purple-300'
                                    : 'bg-cyan-500/15 text-cyan-300'
                                }`}
                              >
                                {isAudio ? (
                                  <Music className="w-4 h-4 sm:w-5 sm:h-5" />
                                ) : (
                                  <Film className="w-4 h-4 sm:w-5 sm:h-5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-bold text-white truncate">
                                  {fmt.resolution}{' '}
                                  <span className="text-xs font-normal text-slate-400">
                                    · {fmt.ext.toUpperCase()}
                                  </span>
                                </div>
                                <div className="text-[11px] sm:text-xs text-slate-400 flex flex-wrap items-center gap-1 font-mono tabular-nums mt-0.5">
                                  <span>{formatBytes(fmt.filesize)}</span>
                                  {fmt.needsMuxing && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-cyan-400 font-sans">
                                        دمج 4K/HD
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFormatId(fmt.id);
                                handleStartSingleDownload(fmt);
                              }}
                              className="px-2.5 sm:px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5 shrink-0" />
                              <span>تحميل</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
                      <button
                        type="button"
                        onClick={() => handleStartSingleDownload()}
                        className="w-full py-3.5 px-4 sm:px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs sm:text-sm shadow-[0_0_25px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 transition-all cursor-pointer text-center"
                      >
                        <Download className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                        <span className="break-words">
                          بدء التحميل بأقصى سرعة (8 مسارات متوازية IDM)
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 2: 50-LINK BATCH QUEUE & YOUTUBE PLAYLIST EXTRACTION              */}
        {/* ===================================================================== */}
        {activeTab === 'batch' && (
          <div className="w-full max-w-full space-y-6">
            <div className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 shadow-[0_0_25px_rgba(6,182,212,0.18)] p-4 sm:p-6 md:p-7 space-y-5 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-xl font-bold text-white flex items-center gap-2 break-words">
                    <Layers className="w-5 h-5 text-cyan-400 shrink-0" />
                    <span>نظام الدفعات واستخراج قوائم تشغيل YouTube (حتى 50 فيديو)</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1 break-words">
                    الصق رابط قائمة تشغيل يوتيوب (`list=`) ليتم فك جميع فيديوهاتها تلقائياً في الطابور، أو
                    ضع حتى 50 رابط فيديو مباشر (رابط في كل سطر).
                  </p>
                </div>

                <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                  <span className="text-xs font-mono tabular-nums text-cyan-300 text-center sm:text-right">
                    {parsedBatchLines.length} / 50 رابط
                  </span>
                  <button
                    type="button"
                    onClick={() => handlePasteClipboard('batch')}
                    className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ClipboardPaste className="w-4 h-4 shrink-0" />
                    <span>لصق رابط Playlist أو دفعة</span>
                  </button>
                </div>
              </div>

              {/* Playlist Extraction Loading / Success / Error Banner */}
              <AnimatePresence>
                {(isExtractingPlaylist || playlistFeedback) && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`w-full rounded-xl p-4 border flex items-start justify-between gap-3 ${
                      isExtractingPlaylist || playlistFeedback?.type === 'loading'
                        ? 'bg-cyan-950/40 border-cyan-400/50 shadow-[0_0_25px_rgba(6,182,212,0.25)] text-cyan-100'
                        : playlistFeedback?.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.2)] text-emerald-100'
                          : 'bg-red-950/50 border-red-500/40 text-red-200'
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      {isExtractingPlaylist || playlistFeedback?.type === 'loading' ? (
                        <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin shrink-0 mt-0.5" />
                      ) : playlistFeedback?.type === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                      )}
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-xs sm:text-sm font-bold break-words">
                          {isExtractingPlaylist
                            ? 'Extracting Playlist... please wait'
                            : playlistFeedback?.message}
                        </p>
                        {playlistFeedback?.subMessage && (
                          <p className="text-xs text-slate-300 break-words">
                            {playlistFeedback.subMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    {!isExtractingPlaylist && (
                      <button
                        type="button"
                        onClick={() => setPlaylistFeedback(null)}
                        className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded cursor-pointer shrink-0"
                      >
                        إخفاء
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Queue Concurrency & Default Quality Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                {/* Mode: Sequential vs Concurrent */}
                <div className="w-full rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 sm:p-4 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-300">نظام طابور التحميل:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setQueueMode('sequential')}
                      className={`w-full py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                        queueMode === 'sequential'
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      متسلسل (1 تلو الآخر)
                    </button>
                    <button
                      type="button"
                      onClick={() => setQueueMode('concurrent')}
                      className={`w-full py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-center ${
                        queueMode === 'concurrent'
                          ? 'bg-cyan-500 text-slate-950'
                          : 'bg-slate-900 text-slate-300 hover:text-white'
                      }`}
                    >
                      متوازي (عدة فيديوهات)
                    </button>
                  </div>
                </div>

                {/* Concurrency Slider (2 to 4 simultaneous videos) */}
                <div className="w-full rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 sm:p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                    <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>عدد الفيديوهات المتزامنة:</span>
                    </span>
                    <span className="font-mono tabular-nums text-cyan-400 font-bold">
                      {queueMode === 'sequential' ? '1 فيديو' : `${concurrencyLimit} فيديوهات معاً`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={4}
                    step={1}
                    disabled={queueMode === 'sequential'}
                    value={concurrencyLimit}
                    onChange={(e) => setConcurrencyLimit(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-400 disabled:opacity-40 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>2 متوازي</span>
                    <span>3 متوازي</span>
                    <span>4 متوازي</span>
                  </div>
                </div>

                {/* Global Default Quality Selector */}
                <div className="w-full rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 sm:p-4 space-y-2.5">
                  <label htmlFor="batch-quality-select" className="text-xs font-semibold text-slate-300 block">
                    الجودة الافتراضية لجميع الروابط:
                  </label>
                  <select
                    id="batch-quality-select"
                    value={globalDefaultQuality}
                    onChange={(e) => setGlobalDefaultQuality(e.target.value)}
                    className="w-full max-w-full h-10 px-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="best">أفضل جودة متاحة تلقائياً (حتى 4K)</option>
                    <option value="2160">2160p (4K Ultra HD) إن توفرت</option>
                    <option value="1440">1440p (2K QHD) إن توفرت</option>
                    <option value="1080">1080p (Full HD)</option>
                    <option value="720">720p (HD)</option>
                    <option value="480">480p (SD توفير البيانات)</option>
                    <option value="MP3">صوت فقط MP3 (320kbps)</option>
                  </select>
                </div>
              </div>

              {/* Multi-Line Textarea for up to 50 links or YouTube Playlist URL */}
              <div className="w-full space-y-2">
                <textarea
                  rows={6}
                  dir="ltr"
                  value={batchRawText}
                  onChange={(e) => setBatchRawText(e.target.value)}
                  placeholder={
                    'https://www.youtube.com/playlist?list=PL...\nhttps://www.youtube.com/watch?v=aqz-KE-bpKQ\nالصق رابط قائمة تشغيل يوتيوب (list=) لفك جميع الفيديوهات تلقائياً، أو ضع حتى 50 رابط فيديو...'
                  }
                  className="w-full max-w-full p-3.5 sm:p-4 rounded-xl bg-[#070B19]/90 border border-cyan-500/30 focus:border-cyan-400 focus:outline-none text-xs sm:text-sm text-white font-mono leading-relaxed placeholder:text-slate-500"
                />
              </div>

              <div className="w-full flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      const plUrl =
                        'https://www.youtube.com/playlist?list=PL590L5WQmH8eYTXiTTjzo4YnK7vkCqZTI';
                      setBatchRawText(plUrl);
                      handleExpandPlaylistsInBatch(plUrl, false, false);
                    }}
                    className="text-cyan-400 hover:underline cursor-pointer text-right font-medium"
                  >
                    تجربة استخراج قائمة تشغيل YouTube كاملة (Playlist)
                  </button>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchRawText(
                        'https://www.youtube.com/watch?v=aqz-KE-bpKQ\nhttps://www.youtube.com/watch?v=jNQXAC9IVRw'
                      );
                    }}
                    className="text-slate-400 hover:text-cyan-300 hover:underline cursor-pointer text-right"
                  >
                    ملء بروابط فردية تجريبية
                  </button>
                </div>

                <div className="w-full lg:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  {hasPlaylistInBatchInput && (
                    <button
                      type="button"
                      onClick={() => handleExpandPlaylistsInBatch(batchRawText, false, false)}
                      disabled={isExtractingPlaylist || isBatchProcessing}
                      className="w-full sm:w-auto px-4 py-3 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-50 border border-cyan-400/50 text-cyan-200 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      {isExtractingPlaylist ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                          <span>Extracting Playlist...</span>
                        </>
                      ) : (
                        <>
                          <ListVideo className="w-4 h-4 shrink-0" />
                          <span>فك واستخراج قائمة التشغيل فقط</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleProbeBatchLinks(false)}
                    disabled={
                      isBatchProcessing || isExtractingPlaylist || parsedBatchLines.length === 0
                    }
                    className="w-full sm:w-auto px-4 sm:px-5 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-cyan-500/30 text-cyan-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <ListPlus className="w-4 h-4 shrink-0" />
                    <span>
                      {hasPlaylistInBatchInput
                        ? 'استخراج القائمة وفحص الجودات'
                        : `فحص وتخصيص الدفعة (${parsedBatchLines.length})`}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProbeBatchLinks(true)}
                    disabled={
                      isBatchProcessing || isExtractingPlaylist || parsedBatchLines.length === 0
                    }
                    className="w-full sm:w-auto px-5 sm:px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-slate-950 font-bold text-xs sm:text-sm shadow-[0_0_25px_rgba(6,182,212,0.35)] flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {isBatchProcessing || isExtractingPlaylist ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                        <span>
                          {isExtractingPlaylist
                            ? 'Extracting Playlist...'
                            : 'جاري معالجة الدفعة...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 shrink-0" />
                        <span>بدء تحميل الدفعة بالكامل فوراً</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Batch & Expanded Playlist Items List */}
            {batchItems.length > 0 && (
              <div className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 p-4 sm:p-6 md:p-7 space-y-4 overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                  <div className="space-y-0.5">
                    <h3 className="text-sm sm:text-base font-bold text-white">
                      عناصر الطابور والقوائم المستخرجة ({batchItems.length} فيديو)
                    </h3>
                    <p className="text-xs text-slate-400">
                      كل فيديو مستخرج أدناه جاهز للفحص أو التحميل المباشر بشكل مستقل أو جماعي
                    </p>
                  </div>
                  <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={() => probeBatchQueueItems(batchItems, false)}
                      disabled={isBatchProcessing}
                      className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-cyan-500/30 text-cyan-300 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span>فحص جودات الكل</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleStartReadyBatchItems}
                      disabled={isBatchProcessing}
                      className="w-full sm:w-auto px-4 sm:px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Play className="w-4 h-4 shrink-0" />
                      <span>تحميل جميع عناصر الطابور ({batchItems.length})</span>
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-800/80">
                  {batchItems.map((item, idx) => {
                    const displayTitle = item.extracted?.title || item.title || item.url;
                    const displayThumb = item.extracted?.thumbnail || item.thumbnail;
                    const displayDuration = item.extracted?.duration || item.duration || 0;

                    return (
                      <div
                        key={item.id}
                        className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                          <span className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 font-mono text-xs flex items-center justify-center shrink-0 tabular-nums">
                            {idx + 1}
                          </span>

                          {displayThumb && !thumbFailed[item.id] && (
                            <div className="w-20 h-12 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 shrink-0 hidden sm:flex items-center justify-center">
                              <img
                                src={`/api/proxy?url=${encodeURIComponent(displayThumb)}`}
                                alt={displayTitle}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setThumbFailed((prev) => ({ ...prev, [item.id]: true }))
                                }
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="text-xs sm:text-sm font-semibold text-white break-words">
                              {displayTitle}
                            </div>
                            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                              <span>{PLATFORM_NAMES[item.platform]}</span>
                              {displayDuration > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">
                                    {formatDuration(displayDuration)}
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span
                                className={`break-words ${
                                  item.status === 'ready'
                                    ? 'text-emerald-400'
                                    : item.status === 'queued'
                                      ? 'text-cyan-400'
                                      : item.status === 'error'
                                        ? 'text-red-400'
                                        : 'text-slate-400'
                                }`}
                              >
                                {item.status === 'pending' && 'مستخرج من القائمة — جاهز للفحص أو التحميل'}
                                {item.status === 'probing' && 'جاري فحص الجودات...'}
                                {item.status === 'ready' && 'تم فحص الجودات — جاهز للتحميل'}
                                {item.status === 'queued' && 'تمت الإضافة لطابور التحميل'}
                                {item.status === 'error' && (item.error || 'خطأ في الرابط')}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="w-full md:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                          {item.extracted && item.extracted.formats.length > 0 ? (
                            <>
                              <select
                                value={item.selectedFormatId}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setBatchItems((prev) =>
                                    prev.map((p) =>
                                      p.id === item.id ? { ...p, selectedFormatId: val } : p
                                    )
                                  );
                                }}
                                className="w-full sm:w-auto max-w-full h-9 px-3 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white"
                              >
                                {item.extracted.formats.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.resolution} ({f.ext.toUpperCase()}) — {formatBytes(f.filesize)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!item.extracted || !queueManagerRef.current) return;
                                  const fmt =
                                    item.extracted.formats.find(
                                      (f) => f.id === item.selectedFormatId
                                    ) || item.extracted.formats[0];
                                  if (fmt) {
                                    queueManagerRef.current.enqueueTask({
                                      sourceUrl: item.extracted.url,
                                      title: item.extracted.title,
                                      author: item.extracted.author,
                                      thumbnail: item.extracted.thumbnail,
                                      platform: item.extracted.platform,
                                      format: fmt,
                                      autoStart: true,
                                    });
                                    setBatchItems((prev) =>
                                      prev.map((p) =>
                                        p.id === item.id ? { ...p, status: 'queued' } : p
                                      )
                                    );
                                    showToast(`بدأ تحميل "${item.extracted.title.slice(0, 30)}..."`);
                                  }
                                }}
                                className="w-full sm:w-auto h-9 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5 shrink-0" />
                                <span>تحميل</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleProbeSingleBatchItem(item, true)}
                              disabled={item.status === 'probing'}
                              className="w-full sm:w-auto h-9 px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              {item.status === 'probing' ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                              ) : (
                                <Download className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>فحص وتحميل</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => copyToClipboard(item.url, item.id)}
                            className="w-full sm:w-auto h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            {copiedKey === item.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>نسخ الرابط</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 3: IDM 8-THREAD MULTI-CHUNK DOWNLOADER & PAUSE/RESUME MANAGER     */}
        {/* ===================================================================== */}
        {activeTab === 'active' && (
          <div className="w-full max-w-full space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base sm:text-xl font-bold text-white flex items-center gap-2 break-words">
                  <Cpu className="w-5 h-5 text-cyan-400 shrink-0" />
                  <span>مُسرّع التحميل متعدد المسارات (IDM 8-Thread Range Engine)</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5 break-words">
                  يتم حفظ كل جزء محمّل فورياً داخل قاعدة بيانات المتصفح (IndexedDB) لدعم الإيقاف المؤقت
                  والاستكمال حتى بعد إغلاق المتصفح.
                </p>
              </div>
            </div>

            {tasks.length === 0 ? (
              <div className="w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/25 p-6 sm:p-12 text-center space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400">
                  <Download className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white">لا توجد مهام تحميل نشطة حالياً</h3>
                  <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto break-words">
                    ابدأ بلصق رابط فيديو في قسم التحميل الفردي أو استخرج قائمة تشغيل يوتيوب كاملة في قسم
                    الدفعات.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('single')}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs sm:text-sm transition-colors cursor-pointer"
                >
                  بدء تحميل جديد
                </button>
              </div>
            ) : (
              <div className="space-y-4 w-full">
                {tasks.map((task) => {
                  const isDownloading =
                    task.status === 'downloading' ||
                    task.status === 'probing' ||
                    task.status === 'muxing';

                  return (
                    <div
                      key={task.id}
                      className={`w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/65 border transition-all p-4 sm:p-5 space-y-4 overflow-hidden ${
                        isDownloading
                          ? 'border-cyan-400/50 shadow-[0_0_30px_rgba(6,182,212,0.22)]'
                          : 'border-slate-800'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-cyan-400 break-words">
                            <span>{PLATFORM_NAMES[task.platform]}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">
                              {task.format.resolution} ({task.format.ext.toUpperCase()})
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-300 break-words">{task.statusMessage}</span>
                          </div>
                          <h3 className="text-sm sm:text-base font-bold text-white break-words">
                            {task.title}
                          </h3>
                        </div>

                        {/* Action Controls: Pause, Resume, Copy Link, Re-Save, Delete */}
                        <div className="w-full md:w-auto flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                          {task.status === 'downloading' && (
                            <button
                              type="button"
                              onClick={() => queueManagerRef.current?.pauseTask(task.id)}
                              className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Pause className="w-4 h-4 shrink-0" />
                              <span>إيقاف مؤقت (Pause)</span>
                            </button>
                          )}

                          {(task.status === 'paused' || task.status === 'error') && (
                            <button
                              type="button"
                              onClick={() => queueManagerRef.current?.resumeTask(task.id)}
                              className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Play className="w-4 h-4 shrink-0" />
                              <span>استكمال التحميل (Resume)</span>
                            </button>
                          )}

                          {task.status === 'completed' && (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await resaveFromHistory(task.id, 'picker');
                                  if (ok) showToast('تم حفظ الملف في المسار المحدد');
                                }}
                                className="w-full sm:w-auto px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                <span>حفظ في مجلد</span>
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await resaveFromHistory(task.id, 'share');
                                  if (ok) showToast('تم فتح المشاركة للاستوديو / المعرض');
                                }}
                                className="w-full sm:w-auto px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Share2 className="w-3.5 h-3.5 shrink-0" />
                                <span>حفظ للاستوديو</span>
                              </button>
                            </>
                          )}

                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(task.sourceUrl, task.id)}
                              className="flex-1 sm:flex-initial p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center gap-1.5 text-xs cursor-pointer"
                              title="نسخ الرابط الأصلي"
                            >
                              {copiedKey === task.id ? (
                                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                              ) : (
                                <Copy className="w-4 h-4 shrink-0" />
                              )}
                              <span className="sm:hidden">نسخ الرابط</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => queueManagerRef.current?.removeTask(task.id)}
                              className="flex-1 sm:flex-initial p-2 rounded-xl bg-slate-800 hover:bg-red-950/70 text-slate-400 hover:text-red-300 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
                              title="إلغاء وحذف المهمة"
                            >
                              <Trash2 className="w-4 h-4 shrink-0" />
                              <span className="sm:hidden">حذف</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Overall Progress & Telemetry Row */}
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs font-mono tabular-nums">
                          <div className="flex items-center gap-3 text-slate-300">
                            <span className="text-cyan-400 font-bold text-sm">
                              {task.progress}%
                            </span>
                            <span>
                              {formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-slate-300">
                            <span>
                              السرعة:{' '}
                              <strong className="text-cyan-300">
                                {(task.speedBps / (1024 * 1024)).toFixed(2)} MB/s
                              </strong>
                            </span>
                            <span>
                              الوقت المتبقي:{' '}
                              <strong className="text-white">
                                {task.etaSeconds > 0 ? `${task.etaSeconds} ثانية` : '--'}
                              </strong>
                            </span>
                          </div>
                        </div>

                        {/* Master Progress Bar */}
                        <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-200"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </div>

                      {/* 8-Segment IDM Parallel Byte-Range Visualizer */}
                      {task.chunks.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] text-slate-400">
                            <span>حالة المسارات المتوازية (8 Parallel HTTP 206 Streams):</span>
                            <span className="font-mono">IndexedDB Persistent Chunks</span>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                            {task.chunks.map((chunk) => {
                              const chunkTotal = Math.max(1, chunk.end - chunk.start + 1);
                              const chunkPct =
                                chunk.status === 'completed'
                                  ? 100
                                  : chunk.end > 0
                                    ? Math.min(100, Math.round((chunk.downloaded / chunkTotal) * 100))
                                    : task.progress;
                              return (
                                <div
                                  key={chunk.index}
                                  className="rounded-lg bg-slate-950/90 border border-slate-800/90 p-2 space-y-1.5"
                                >
                                  <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                                    <span className="text-slate-400">مسار #{chunk.index + 1}</span>
                                    <span className="text-cyan-300 font-semibold">{chunkPct}%</span>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
                                    <div
                                      className={`h-full transition-all duration-150 ${
                                        chunk.status === 'completed'
                                          ? 'bg-emerald-400'
                                          : chunk.status === 'paused'
                                            ? 'bg-amber-400'
                                            : 'bg-cyan-400'
                                      }`}
                                      style={{ width: `${chunkPct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===================================================================== */}
        {/* TAB 4: PERSISTENT DOWNLOAD HISTORY & STORAGE MANAGER (INDEXEDDB)      */}
        {/* ===================================================================== */}
        {activeTab === 'history' && (
          <div className="w-full max-w-full space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base sm:text-xl font-bold text-white flex items-center gap-2 break-words">
                  <History className="w-5 h-5 text-cyan-400 shrink-0" />
                  <span>سجل التحميلات المحفوظة ومدير التخزين المحلي (IndexedDB)</span>
                </h2>
                <p className="text-xs sm:text-sm text-slate-400 mt-0.5 break-words">
                  جميع الملفات المحملة متاحة لإعادة الحفظ الفوري في الاستوديو أو مدير الملفات دون إعادة
                  استهلاك الإنترنت.
                </p>
              </div>

              {historyList.length > 0 && (
                <button
                  type="button"
                  onClick={async () => {
                    await clearAllDownloadHistory();
                    setHistoryList([]);
                    showToast('تم مسح سجل التحميلات والذاكرة المؤقتة بالكامل');
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-red-950/60 hover:bg-red-900/60 border border-red-500/30 text-red-200 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>مسح السجل بالكامل</span>
                </button>
              )}
            </div>

            {historyList.length === 0 ? (
              <div className="w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/25 p-6 sm:p-12 text-center space-y-3">
                <HardDrive className="w-10 h-10 text-slate-500 mx-auto" />
                <h3 className="text-base font-bold text-white">سجل التحميلات فارغ</h3>
                <p className="text-xs sm:text-sm text-slate-400 break-words">
                  ستظهر هنا جميع الفيديوهات والصوتيات التي قمت بتحميلها مع إمكانية حفظها للاستوديو أو
                  نسخ روابطها في أي وقت.
                </p>
              </div>
            ) : (
              <div className="w-full max-w-full rounded-2xl backdrop-blur-xl bg-slate-900/60 border border-cyan-500/30 divide-y divide-slate-800/80 overflow-hidden">
                {historyList.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-900/80 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5 min-w-0 flex-1">
                      <div className="w-full sm:w-28 aspect-video sm:aspect-auto sm:h-16 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center">
                        {item.thumbnail && !thumbFailed[item.id] ? (
                          <img
                            src={`/api/proxy?url=${encodeURIComponent(item.thumbnail)}`}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setThumbFailed((prev) => ({ ...prev, [item.id]: true }))
                            }
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Film className="w-6 h-6 text-cyan-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 className="text-sm sm:text-base font-bold text-white break-words">
                          {item.title}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-mono tabular-nums">
                          <span className="text-cyan-400 font-sans">
                            {PLATFORM_NAMES[item.platform]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {item.resolution} {item.ext}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatBytes(item.totalBytes)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{new Date(item.completedAt).toLocaleDateString('ar-EG')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="w-full lg:w-auto flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await resaveFromHistory(item.id, 'picker');
                          if (ok) {
                            showToast('تم حفظ الملف مجدداً على جهازك');
                          } else {
                            showToast('الملف غير موجود في الذاكرة المؤقتة — أعد تحميله');
                          }
                        }}
                        className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 shrink-0" />
                        <span>حفظ للجهاز</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await resaveFromHistory(item.id, 'share');
                          if (ok) showToast('تم فتح الحفظ إلى الاستوديو / المعرض');
                        }}
                        className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5 shrink-0" />
                        <span>حفظ للاستوديو</span>
                      </button>

                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(item.sourceUrl, `hist-${item.id}`)}
                          className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedKey === `hist-${item.id}` ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>نسخ الرابط</span>
                        </button>

                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center"
                          title="فتح الرابط الأصلي"
                        >
                          <ExternalLink className="w-4 h-4 shrink-0" />
                        </a>

                        <button
                          type="button"
                          onClick={async () => {
                            await deleteHistoryItem(item.id);
                            setHistoryList((prev) => prev.filter((h) => h.id !== item.id));
                            showToast('تم حذف العنصر من السجل');
                          }}
                          className="p-2 rounded-xl bg-slate-800 hover:bg-red-950/70 text-slate-400 hover:text-red-300 flex items-center justify-center cursor-pointer"
                          title="حذف من السجل"
                        >
                          <Trash2 className="w-4 h-4 shrink-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="relative z-10 w-full max-w-full border-t border-slate-800/80 py-5 px-4 sm:px-6 text-xs text-slate-400 mt-10">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-right break-words">
          <span>نبض ستريم برو — تطبيق ويب تقدمي (PWA) لتحميل الفيديو والصوت متعدد المسارات</span>
          <span>يدعم الحفظ المباشر عبر File System Access API و Web Share API و IndexedDB</span>
        </div>
      </footer>
    </div>
  );
}
